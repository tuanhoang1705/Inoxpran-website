import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    CAPABILITY_STATUSES,
    CapabilityHealthService,
    probeOpenClawGateway,
    sanitizeSafeValue,
    stripSensitiveUrlParts
} = require('../src/services/openclawCapabilityHealth.service');
const { getBlogAutomationSchedulerRuntime } = require('../src/services/blogAutomationScheduler.runtime');

const configuredSeoEnv = (overrides = {}) => ({
    OPENCLAW_CAPABILITY_HEALTH_ENABLED: 'true',
    SEO_AGENT_ENABLED: 'true',
    API_KEY: 'configured',
    SEO_AGENT_API_KEY: 'configured',
    SEO_AGENT_HMAC_SECRET: 'configured',
    OPENAI_API_KEY: 'configured',
    ...overrides
});

const telegramStatus = () => ({
    enabled: false,
    mode: 'webhook',
    tokenConfigured: false,
    allowlistConfigured: false,
    webhookSecretConfigured: false,
    adminBaseUrlConfigured: false
});

const createService = ({ env = configuredSeoEnv(), probes = {}, ...options } = {}) => new CapabilityHealthService({
    envProvider: () => env,
    telegramStatusProvider: telegramStatus,
    probeRegistry: probes,
    databaseReady: () => {
        throw new Error('A unit capability probe attempted to access the database');
    },
    ...options
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('OpenClaw capability health service', () => {
    it('returns every canonical field for a disabled capability without probing', async () => {
        const probe = vi.fn();
        const service = createService({
            env: configuredSeoEnv({ SEO_AGENT_ENABLED: 'false' }),
            probes: { seoAgent: probe }
        });

        const capability = await service.checkOne({ featureKey: 'seo_agent' });

        expect(probe).not.toHaveBeenCalled();
        expect(capability).toMatchObject({
            featureKey: 'seo_agent',
            labelKey: 'openclaw.capabilities.seoAgent',
            configured: true,
            enabled: false,
            checked: true,
            status: 'disabled',
            expectedState: 'disabled',
            reasonCode: 'disabled_by_configuration',
            messageKey: 'openclaw.capabilities.disabled',
            latencyMs: 0,
            runtime: {
                serviceRegistered: true,
                schedulerActive: false
            },
            warnings: [],
            safeDetails: {}
        });
        expect(capability.lastCheckedAt).toEqual(expect.any(String));
        expect(CAPABILITY_STATUSES).toContain(capability.status);
    });

    it('distinguishes safe-rollout expected disabled from a failure', async () => {
        const service = createService({
            env: configuredSeoEnv({ OPENCLAW_BLOG_CRON_ENABLED: 'false' })
        });

        await expect(service.checkOne({ featureKey: 'blog_cron' })).resolves.toMatchObject({
            checked: true,
            status: 'expected_disabled',
            expectedState: 'disabled',
            reasonCode: 'safe_rollout_disabled'
        });
    });

    it('reports enabled capabilities with incomplete configuration without probing', async () => {
        const probe = vi.fn();
        const service = createService({
            env: {
                OPENCLAW_CAPABILITY_HEALTH_ENABLED: 'true',
                SEO_AGENT_ENABLED: 'true'
            },
            probes: { seoAgent: probe }
        });

        await expect(service.checkOne({ featureKey: 'seoAgent' })).resolves.toMatchObject({
            enabled: true,
            configured: false,
            checked: true,
            status: 'missing_config',
            reasonCode: 'missing_configuration'
        });
        expect(probe).not.toHaveBeenCalled();
    });

    it('reports an invalid feature boolean as configuration failure instead of disabled', async () => {
        const probe = vi.fn();
        const service = createService({
            env: configuredSeoEnv({ SEO_AGENT_ENABLED: 'ture' }),
            probes: { seoAgent: probe }
        });

        await expect(service.checkOne({ featureKey: 'seo_agent' })).resolves.toMatchObject({
            enabled: false,
            configured: false,
            checked: true,
            status: 'missing_config',
            expectedState: 'valid_boolean_configuration',
            reasonCode: 'invalid_boolean_configuration',
            warnings: ['invalid_boolean_configuration'],
            safeDetails: { invalidConfigurationKeys: ['SEO_AGENT_ENABLED'] }
        });
        expect(probe).not.toHaveBeenCalled();
    });

    it('fails capability checks safely when the master health boolean is invalid', async () => {
        const probe = vi.fn();
        const service = createService({
            env: configuredSeoEnv({ OPENCLAW_CAPABILITY_HEALTH_ENABLED: '2' }),
            probes: { seoAgent: probe }
        });

        const report = await service.getStatus({ featureKeys: ['seo_agent'] });

        expect(report).toMatchObject({
            healthEnabled: false,
            healthConfigurationValid: false,
            healthConfigurationReasonCode: 'invalid_boolean_configuration'
        });
        expect(report.capabilities.seoAgent).toMatchObject({
            status: 'unavailable',
            reasonCode: 'invalid_boolean_configuration',
            safeDetails: { invalidConfigurationKeys: ['OPENCLAW_CAPABILITY_HEALTH_ENABLED'] }
        });
        expect(probe).not.toHaveBeenCalled();
    });

    it('uses a fresh cached result and force refresh bypasses the cache', async () => {
        const probe = vi.fn(async () => ({
            status: 'healthy',
            reasonCode: 'runtime_verified',
            runtime: { serviceRegistered: true, latestArtifactStatus: 'draft_created' }
        }));
        const service = createService({ probes: { seoAgent: probe }, cacheMs: 30_000 });

        const first = await service.checkOne({ featureKey: 'seo_agent', force: false });
        const second = await service.checkOne({ featureKey: 'seo_agent', force: false });
        const refreshed = await service.checkOne({ featureKey: 'seo_agent', force: true });

        expect(first.status).toBe('healthy');
        expect(second).toEqual(first);
        expect(refreshed.status).toBe('healthy');
        expect(probe).toHaveBeenCalledTimes(2);
    });

    it('deduplicates concurrent forced probes for the same capability', async () => {
        let release;
        const probe = vi.fn(() => new Promise((resolve) => { release = resolve; }));
        const service = createService({ probes: { seoAgent: probe } });

        const first = service.checkOne({ featureKey: 'seo_agent', force: true });
        const second = service.checkOne({ featureKey: 'seo_agent', force: true });
        await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(1));
        release({ status: 'healthy', reasonCode: 'runtime_verified' });

        const [firstResult, secondResult] = await Promise.all([first, second]);
        expect(firstResult).toEqual(secondResult);
        expect(probe).toHaveBeenCalledTimes(1);
    });

    it('turns a timed-out check into a terminal failure instead of leaving pending_check indefinitely', async () => {
        const service = createService({
            probes: { seoAgent: () => new Promise(() => {}) },
            timeoutMs: 5
        });

        const capability = await service.checkOne({ featureKey: 'seo_agent' });

        expect(capability).toMatchObject({
            checked: true,
            status: 'failed',
            reasonCode: 'probe_timeout'
        });
        expect(capability.status).not.toBe('pending_check');
    });

    it('fails closed when a probe returns a malformed or unknown status', async () => {
        const service = createService({
            probes: { seoAgent: async () => ({ status: 'totally_green' }) }
        });

        await expect(service.checkOne({ featureKey: 'seo_agent' })).resolves.toMatchObject({
            checked: true,
            status: 'unavailable',
            reasonCode: 'invalid_probe_result',
            warnings: ['invalid_probe_result']
        });
    });

    it('makes an explicitly disabled health system deterministic and performs no probe', async () => {
        const probe = vi.fn();
        const service = createService({
            env: configuredSeoEnv({ OPENCLAW_CAPABILITY_HEALTH_ENABLED: 'false' }),
            probes: { seoAgent: probe }
        });

        const report = await service.getStatus({ featureKeys: ['seo_agent'] });

        expect(report).toMatchObject({ healthEnabled: false, cacheSeconds: 30, timeoutMs: 10_000 });
        expect(report.capabilities.seoAgent).toMatchObject({
            checked: true,
            status: 'unavailable',
            reasonCode: 'capability_health_disabled'
        });
        expect(probe).not.toHaveBeenCalled();
    });

    it('removes secrets and URL credentials from probe details', async () => {
        const service = createService({
            probes: {
                seoAgent: async () => ({
                    status: 'healthy',
                    safeDetails: {
                        OPENCLAW_GATEWAY_TOKEN: 'gateway-secret',
                        nested: { apiKey: 'api-secret', safe: true },
                        dashboardUrl: 'https://admin.inoxpran.com/openclaw/?access_token=url-secret#opaque-secret'
                    }
                })
            }
        });

        const capability = await service.checkOne({ featureKey: 'seo_agent' });
        const serialized = JSON.stringify(capability);

        expect(serialized).not.toContain('gateway-secret');
        expect(serialized).not.toContain('api-secret');
        expect(serialized).not.toContain('url-secret');
        expect(serialized).not.toContain('opaque-secret');
        expect(capability.safeDetails.nested).toEqual({ safe: true });
        expect(capability.safeDetails.dashboardUrl).toBe('https://admin.inoxpran.com/openclaw/');
    });

    it('strips userinfo, sensitive query parameters, and every fragment from URLs', () => {
        expect(stripSensitiveUrlParts(
            'https://user:password@admin.inoxpran.com/openclaw/?token=secret&view=status#opaque-secret'
        )).toBe('https://admin.inoxpran.com/openclaw/?view=status');
        expect(sanitizeSafeValue({ authorization: 'Bearer secret', safe: 'ok' })).toEqual({ safe: 'ok' });
    });

    it('keeps safe configured booleans while removing secret-valued fields', () => {
        expect(sanitizeSafeValue({
            tokenConfigured: true,
            webhookSecretConfigured: false,
            token: 'secret-value',
            credential: { value: 'secret-value' }
        })).toEqual({
            tokenConfigured: true,
            webhookSecretConfigured: false
        });
    });

    it('refuses a public Gateway health URL without making an outbound request', async () => {
        const fetchImpl = vi.fn();

        await expect(probeOpenClawGateway({
            fetchImpl,
            env: { OPENCLAW_GATEWAY_HTTP_URL: 'https://example.com' }
        })).resolves.toMatchObject({
            reachable: false,
            ready: false,
            error: 'gateway_url_invalid'
        });
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('does not report an image provider healthy when runtime probing is intentionally skipped', async () => {
        const service = createService({
            env: configuredSeoEnv({
                IMAGE_SEARCH_PROVIDER: 'pexels',
                IMAGE_SEARCH_API_KEY: 'configured'
            })
        });

        await expect(service.checkOne({ featureKey: 'image_search' })).resolves.toMatchObject({
            checked: true,
            status: 'degraded',
            reasonCode: 'external_provider_not_probed',
            safeDetails: { providerConfigured: true, runtimeVerified: false }
        });
    });

    it('does not report the SEO agent healthy when the latest execution failed', async () => {
        const service = createService();
        service._latest = vi.fn()
            .mockResolvedValueOnce({ status: 'failed', completedAt: new Date('2026-07-22T01:00:00Z') })
            .mockResolvedValueOnce({ status: 'completed', completedAt: new Date('2026-07-21T01:00:00Z') });

        await expect(service._probeExecutionHistory()).resolves.toMatchObject({
            status: 'failed',
            reasonCode: 'latest_execution_failed',
            runtime: {
                latestArtifactStatus: 'failed',
                lastSuccessfulRunAt: new Date('2026-07-21T01:00:00Z')
            }
        });
    });

    it('degrades an available persisted source when its successful check is stale', async () => {
        const service = createService({
            env: configuredSeoEnv({ CONTENT_OPERATIONS_SNAPSHOT_TTL_HOURS: '24' }),
            now: () => new Date('2026-07-22T12:00:00Z')
        });
        service._latest = vi.fn().mockResolvedValue({
            status: 'complete',
            checkedAt: new Date('2026-07-20T12:00:00Z'),
            sourceHealth: [{
                source: 'google_search_console',
                status: 'available',
                configured: true,
                enabled: true,
                checkedAt: new Date('2026-07-20T12:00:00Z')
            }]
        });

        await expect(service._probePersistedSource('google_search_console')).resolves.toMatchObject({
            status: 'degraded',
            reasonCode: 'persisted_source_stale',
            safeDetails: { adapterRegistered: true, stale: true }
        });
    });

    it('does not report content signals healthy when no persisted signal exists', async () => {
        const service = createService();
        service._latest = vi.fn().mockResolvedValue(null);

        await expect(service._probeContentSignals()).resolves.toMatchObject({
            status: 'degraded',
            reasonCode: 'no_content_signal_records',
            warnings: ['no_content_signal_records'],
            safeDetails: { latestRecordFound: false }
        });
    });

    it('does not report an expired or dismissed content signal healthy', async () => {
        const service = createService({ now: () => new Date('2026-07-22T12:00:00Z') });
        service._latest = vi.fn().mockResolvedValue({
            status: 'dismissed',
            expiresAt: new Date('2026-07-23T12:00:00Z'),
            createdAt: new Date('2026-07-22T01:00:00Z')
        });

        await expect(service._probeContentSignals()).resolves.toMatchObject({
            status: 'degraded',
            reasonCode: 'latest_content_signal_inactive',
            safeDetails: { latestRecordFound: true, usable: false }
        });
    });

    it('degrades persisted snapshots that contain warnings instead of presenting a false green', async () => {
        const service = createService();
        service._latest = vi.fn()
            .mockResolvedValueOnce({
                status: 'complete',
                checkedAt: new Date('2026-07-22T01:00:00Z'),
                warnings: ['source delayed']
            })
            .mockResolvedValueOnce(null);

        await expect(service._probeContentOperations()).resolves.toMatchObject({
            status: 'degraded',
            reasonCode: 'persisted_snapshot_warning',
            warnings: ['persisted_snapshot_warning']
        });
    });

    it('requires a completed image-pipeline result before reporting healthy', async () => {
        const service = createService();
        service._latest = vi.fn().mockResolvedValue({
            imagePipelineStatus: 'pending',
            updatedAt: new Date('2026-07-22T01:00:00Z')
        });

        await expect(service._probeImagePipeline()).resolves.toMatchObject({
            status: 'degraded',
            reasonCode: 'latest_snapshot_not_complete',
            runtime: { latestArtifactStatus: 'pending' }
        });
    });

    it('degrades scheduler health when its heartbeat is stale', async () => {
        const service = createService({
            now: () => new Date('2026-07-22T12:00:00Z'),
            schedulerRuntimeProvider: () => ({
                serviceRegistered: true,
                schedulerActive: true,
                lastHeartbeatAt: '2026-07-22T11:00:00Z',
                pollIntervalMs: 30_000,
                enabledWorkloads: { blogCron: true }
            })
        });
        service._latest = vi.fn()
            .mockResolvedValueOnce({ enabled: true, nextRunAt: new Date('2026-07-22T13:00:00Z') })
            .mockResolvedValueOnce(null);
        service._count = vi.fn().mockResolvedValue(1);

        await expect(service._probeBlogCron()).resolves.toMatchObject({
            status: 'degraded',
            reasonCode: 'stale_runtime'
        });
    });

    it('exposes scheduler heartbeat fields without starting or stopping the runtime', () => {
        expect(getBlogAutomationSchedulerRuntime()).toMatchObject({
            serviceRegistered: expect.any(Boolean),
            workerActive: expect.any(Boolean),
            schedulerActive: expect.any(Boolean),
            tickCount: expect.any(Number),
            enabledWorkloads: {
                blogCron: expect.any(Boolean),
                googleIntelligence: expect.any(Boolean),
                contentOperationsCron: expect.any(Boolean),
                performanceMonitoring: expect.any(Boolean)
            }
        });
    });
});
