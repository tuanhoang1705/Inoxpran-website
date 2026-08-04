import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { CAPABILITY_STATUSES, CapabilityHealthService, buildCapabilityDefinitions, buildCapabilityMatrix, probeOpenClawGateway, sanitizeSafeValue, stripSensitiveUrlParts } = require('../src/services/openclawCapabilityHealth.service');
const { getBlogAutomationSchedulerRuntime } = require('../src/services/blogAutomationScheduler.runtime');
const { BlogAutomationWorkerHeartbeat } = require('../src/models/blogAutomationExecution.model');

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
    adminBaseUrlConfigured: false,
    adminBaseUrlHttps: false
});

const createService = ({ env = configuredSeoEnv(), probes = {}, ...options } = {}) =>
    new CapabilityHealthService({
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
            checked: true,
            status: 'missing_config',
            expectedState: 'valid_boolean_configuration',
            reasonCode: 'invalid_boolean_configuration',
            safeDetails: {
                invalidConfigurationKeys: ['OPENCLAW_CAPABILITY_HEALTH_ENABLED']
            }
        });
        expect(probe).not.toHaveBeenCalled();
    });

    it('uses a fresh cached result and force refresh bypasses the cache', async () => {
        const probe = vi.fn(async () => ({
            status: 'healthy',
            reasonCode: 'runtime_verified',
            runtime: {
                serviceRegistered: true,
                latestArtifactStatus: 'draft_created'
            }
        }));
        const service = createService({
            probes: { seoAgent: probe },
            cacheMs: 30_000
        });

        const first = await service.checkOne({
            featureKey: 'seo_agent',
            force: false
        });
        const second = await service.checkOne({
            featureKey: 'seo_agent',
            force: false
        });
        const refreshed = await service.checkOne({
            featureKey: 'seo_agent',
            force: true
        });

        expect(first.status).toBe('healthy');
        expect(second).toEqual(first);
        expect(refreshed.status).toBe('healthy');
        expect(probe).toHaveBeenCalledTimes(2);
    });

    it('deduplicates concurrent forced probes for the same capability', async () => {
        let release;
        const probe = vi.fn(
            () =>
                new Promise((resolve) => {
                    release = resolve;
                })
        );
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

        expect(report).toMatchObject({
            healthEnabled: false,
            cacheSeconds: 30,
            timeoutMs: 10_000
        });
        expect(report.capabilities.seoAgent).toMatchObject({
            checked: false,
            status: 'pending_check',
            reasonCode: 'capability_health_disabled',
            lastCheckedAt: null,
            latencyMs: null
        });
        expect(probe).not.toHaveBeenCalled();
    });

    it('keeps missing required configuration visible when monitoring is disabled', async () => {
        const probe = vi.fn();
        const service = createService({
            env: {
                OPENCLAW_CAPABILITY_HEALTH_ENABLED: 'false',
                SEO_AGENT_ENABLED: 'true'
            },
            probes: { seoAgent: probe }
        });

        await expect(service.checkOne({ featureKey: 'seo_agent' })).resolves.toMatchObject({
            enabled: true,
            configured: false,
            checked: true,
            status: 'missing_config',
            reasonCode: 'missing_configuration'
        });
        expect(probe).not.toHaveBeenCalled();
    });

    it('uses the canonical analytics flag before the temporary legacy fallback', () => {
        const canonical = buildCapabilityDefinitions(
            {
                CONTENT_ANALYTICS_ENABLED: 'false',
                CONTENT_AGGREGATE_ANALYTICS_ENABLED: 'true'
            },
            telegramStatus()
        );
        const legacy = buildCapabilityDefinitions(
            {
                CONTENT_AGGREGATE_ANALYTICS_ENABLED: 'true'
            },
            telegramStatus()
        );

        expect(canonical.aggregateAnalytics).toMatchObject({
            enabled: false,
            configDetails: {}
        });
        expect(legacy.aggregateAnalytics).toMatchObject({
            enabled: true,
            configDetails: {
                legacyConfigurationFallback: true,
                deprecatedConfigurationKey: 'CONTENT_AGGREGATE_ANALYTICS_ENABLED',
                preferredConfigurationKey: 'CONTENT_ANALYTICS_ENABLED'
            }
        });
    });

    it('exposes safe legacy analytics deprecation details before probes complete', () => {
        const matrix = buildCapabilityMatrix(
            {
                CONTENT_AGGREGATE_ANALYTICS_ENABLED: 'true'
            },
            telegramStatus()
        );

        expect(matrix.aggregateAnalytics).toMatchObject({
            status: 'pending_check',
            reasonCode: 'check_pending',
            warnings: ['legacy_analytics_configuration_fallback'],
            safeDetails: {
                legacyConfigurationFallback: true,
                deprecatedConfigurationKey: 'CONTENT_AGGREGATE_ANALYTICS_ENABLED',
                preferredConfigurationKey: 'CONTENT_ANALYTICS_ENABLED'
            }
        });
    });

    it('invalidates cached probe results when monitoring configuration changes', async () => {
        const env = configuredSeoEnv();
        const probe = vi.fn(async () => ({
            status: 'healthy',
            reasonCode: 'runtime_verified'
        }));
        const service = new CapabilityHealthService({
            envProvider: () => env,
            telegramStatusProvider: telegramStatus,
            probeRegistry: { seoAgent: probe }
        });

        await expect(service.checkOne({ featureKey: 'seo_agent', force: false })).resolves.toMatchObject({
            status: 'healthy'
        });
        env.OPENCLAW_CAPABILITY_HEALTH_ENABLED = 'false';
        await expect(service.checkOne({ featureKey: 'seo_agent', force: false })).resolves.toMatchObject({
            checked: false,
            status: 'pending_check',
            reasonCode: 'capability_health_disabled'
        });
        expect(probe).toHaveBeenCalledTimes(1);
    });

    it('preserves the runtime reason and adds a safe deprecation warning when the legacy analytics fallback is active', async () => {
        const service = createService({
            env: configuredSeoEnv({ CONTENT_AGGREGATE_ANALYTICS_ENABLED: 'true' }),
            probes: {
                aggregateAnalytics: vi.fn(async () => ({
                    status: 'healthy',
                    reasonCode: 'runtime_verified',
                    safeDetails: { sourceRecordFound: true }
                }))
            }
        });

        await expect(service.checkOne({ featureKey: 'content_analytics' })).resolves.toMatchObject({
            enabled: true,
            checked: true,
            status: 'healthy',
            reasonCode: 'runtime_verified',
            warnings: ['legacy_analytics_configuration_fallback'],
            safeDetails: {
                legacyConfigurationFallback: true,
                deprecatedConfigurationKey: 'CONTENT_AGGREGATE_ANALYTICS_ENABLED',
                preferredConfigurationKey: 'CONTENT_ANALYTICS_ENABLED',
                sourceRecordFound: true
            }
        });
    });

    it('keeps the legacy analytics deprecation warning when its runtime probe fails', async () => {
        const service = createService({
            env: configuredSeoEnv({ CONTENT_AGGREGATE_ANALYTICS_ENABLED: 'true' }),
            probes: {
                aggregateAnalytics: vi.fn(async () => {
                    throw new Error('source failed');
                })
            }
        });

        await expect(service.checkOne({ featureKey: 'content_analytics' })).resolves.toMatchObject({
            status: 'failed',
            reasonCode: 'probe_failed',
            warnings: ['legacy_analytics_configuration_fallback'],
            safeDetails: {
                legacyConfigurationFallback: true,
                deprecatedConfigurationKey: 'CONTENT_AGGREGATE_ANALYTICS_ENABLED',
                preferredConfigurationKey: 'CONTENT_ANALYTICS_ENABLED'
            }
        });
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
        expect(stripSensitiveUrlParts('https://user:password@admin.inoxpran.com/openclaw/?token=secret&view=status#opaque-secret')).toBe('https://admin.inoxpran.com/openclaw/?view=status');
        expect(sanitizeSafeValue({ authorization: 'Bearer secret', safe: 'ok' })).toEqual({ safe: 'ok' });
    });

    it('keeps safe configured booleans while removing secret-valued fields', () => {
        expect(
            sanitizeSafeValue({
                tokenConfigured: true,
                webhookSecretConfigured: false,
                token: 'secret-value',
                credential: { value: 'secret-value' }
            })
        ).toEqual({
            tokenConfigured: true,
            webhookSecretConfigured: false
        });
    });

    it('refuses a public Gateway health URL without making an outbound request', async () => {
        const fetchImpl = vi.fn();

        await expect(
            probeOpenClawGateway({
                fetchImpl,
                env: { OPENCLAW_GATEWAY_HTTP_URL: 'https://example.com' }
            })
        ).resolves.toMatchObject({
            reachable: false,
            ready: false,
            error: 'gateway_url_invalid'
        });
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('verifies Gateway authentication through the read-only models endpoint without invoking an agent', async () => {
        const fetchImpl = vi.fn(
            async () =>
                new Response('{"ok":true}', {
                    status: 200,
                    headers: { 'content-type': 'application/json' }
                })
        );

        const health = await probeOpenClawGateway({
            fetchImpl,
            env: {
                OPENCLAW_GATEWAY_HTTP_URL: 'http://127.0.0.1:18789',
                OPENCLAW_GATEWAY_TOKEN: 'gateway-secret'
            }
        });

        expect(health).toMatchObject({
            reachable: true,
            live: true,
            ready: true,
            authenticated: true,
            authenticationStatus: 200,
            error: ''
        });
        expect(fetchImpl).toHaveBeenCalledTimes(3);
        expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual(['http://127.0.0.1:18789/healthz', 'http://127.0.0.1:18789/readyz', 'http://127.0.0.1:18789/v1/models']);
        expect(fetchImpl.mock.calls[2][1]).toMatchObject({
            headers: expect.objectContaining({
                authorization: 'Bearer gateway-secret'
            })
        });
        expect(fetchImpl.mock.calls[2][1]).not.toHaveProperty('body');
        expect(JSON.stringify(health)).not.toContain('gateway-secret');
    });

    it('does not report Gateway ready when its configured token is rejected', async () => {
        const fetchImpl = vi.fn(
            async (url) =>
                new Response(String(url).endsWith('/v1/models') ? '{"error":{"message":"unauthorized"}}' : '{"ok":true}', {
                    status: String(url).endsWith('/v1/models') ? 401 : 200,
                    headers: { 'content-type': 'application/json' }
                })
        );

        const health = await probeOpenClawGateway({
            fetchImpl,
            env: {
                OPENCLAW_GATEWAY_HTTP_URL: 'http://127.0.0.1:18789',
                OPENCLAW_GATEWAY_TOKEN: 'invalid-secret'
            }
        });

        expect(health).toMatchObject({
            reachable: true,
            live: true,
            ready: false,
            authenticated: false,
            livenessStatus: 200,
            readinessStatus: 200,
            authenticationStatus: 401,
            error: 'authentication_failed'
        });
        expect(JSON.stringify(health)).not.toContain('invalid-secret');
    });

    it('marks a live Gateway with rejected authentication as failed capability health', async () => {
        const service = createService({
            env: configuredSeoEnv({ OPENCLAW_GATEWAY_TOKEN: 'configured' }),
            gatewayProbe: vi.fn().mockResolvedValue({
                reachable: true,
                live: true,
                ready: false,
                authenticated: false,
                livenessStatus: 200,
                readinessStatus: 200,
                authenticationStatus: 401,
                checkedAt: '2026-07-28T01:00:00.000Z',
                error: 'authentication_failed'
            })
        });

        await expect(service.checkOne({ featureKey: 'openclaw_gateway' })).resolves.toMatchObject({
            status: 'failed',
            reasonCode: 'authentication_failed',
            runtime: {
                serviceRegistered: true,
                workerActive: true,
                latestArtifactStatus: 'authentication_failed'
            },
            safeDetails: {
                reachable: true,
                live: true,
                ready: false,
                authenticated: false,
                authenticationStatus: 401
            }
        });
    });

    it('marks configured Telegram as manual review without probing external delivery', async () => {
        const configuredTelegramStatus = () => ({
            enabled: true,
            mode: 'webhook',
            tokenConfigured: true,
            allowlistConfigured: true,
            webhookSecretConfigured: true,
            adminBaseUrlConfigured: true,
            adminBaseUrlHttps: true
        });
        const service = createService({
            env: configuredSeoEnv({
                TELEGRAM_BOT_ENABLED: 'true',
                TELEGRAM_NOTIFY_CHAT_IDS: 'configured'
            }),
            telegramStatusProvider: configuredTelegramStatus
        });

        await expect(service.checkOne({ featureKey: 'telegram_bot' })).resolves.toMatchObject({
            checked: true,
            status: 'manual_review',
            reasonCode: 'external_delivery_not_probed',
            safeDetails: { runtimeVerified: false }
        });
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
            status: 'manual_review',
            reasonCode: 'external_provider_not_probed',
            safeDetails: { providerConfigured: true, runtimeVerified: false }
        });
    });

    it('does not report the SEO agent healthy when the latest execution failed', async () => {
        const service = createService();
        service._latest = vi
            .fn()
            .mockResolvedValueOnce({
                status: 'failed',
                completedAt: new Date('2026-07-22T01:00:00Z')
            })
            .mockResolvedValueOnce({
                status: 'completed',
                completedAt: new Date('2026-07-21T01:00:00Z')
            });

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
            sourceHealth: [
                {
                    source: 'google_search_console',
                    status: 'available',
                    configured: true,
                    enabled: true,
                    checkedAt: new Date('2026-07-20T12:00:00Z')
                }
            ]
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
        const service = createService({
            now: () => new Date('2026-07-22T12:00:00Z')
        });
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
        service._latest = vi
            .fn()
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
        service._latest = vi
            .fn()
            .mockResolvedValueOnce({
                metadata: { imagePipelineStatus: 'pending' },
                updatedAt: new Date('2026-07-22T01:00:00Z')
            })
            .mockResolvedValueOnce(null);

        await expect(service._probeImagePipeline()).resolves.toMatchObject({
            status: 'degraded',
            reasonCode: 'latest_snapshot_not_complete',
            runtime: { latestArtifactStatus: 'pending' }
        });
        expect(service._latest).toHaveBeenNthCalledWith(
            1,
            expect.anything(),
            expect.objectContaining({
                filter: {
                    'metadata.imagePipelineStatus': {
                        $in: ['pending', 'partial', 'complete', 'failed']
                    }
                }
            })
        );
    });

    it('uses the newest agentic Blog artifact when recovered execution metadata is missing', async () => {
        const service = createService();
        service._latest = vi
            .fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({
                sourceType: 'agentic',
                agenticExecutionId: '507f1f77bcf86cd799439011',
                imagePipelineStatus: 'partial',
                createdAt: new Date('2026-07-30T06:22:21Z'),
                coverImage: {
                    status: 'needs_review',
                    reviewStatus: 'pending_review',
                    qualityReview: { manualReviewRequired: true }
                },
                contentImages: [
                    {
                        status: 'complete',
                        reviewStatus: 'pending_review',
                        qualityReview: { manualReviewRequired: false }
                    },
                    {
                        status: 'needs_review',
                        reviewStatus: 'pending_review',
                        qualityReview: { manualReviewRequired: true }
                    }
                ]
            })
            .mockResolvedValueOnce(null);

        await expect(service._probeImagePipeline()).resolves.toMatchObject({
            status: 'manual_review',
            reasonCode: 'image_approval_required',
            runtime: {
                latestArtifactStatus: 'partial'
            },
            warnings: ['image_manual_review_required'],
            safeDetails: {
                latestResultFound: true,
                evidenceSource: 'blog_artifact',
                imageCount: 3,
                manualReviewCount: 2,
                pendingGenerationCount: 0,
                failedImageCount: 0
            }
        });
    });

    it('does not classify provider failures as approval-only image work', async () => {
        const service = createService();
        service._latest = vi
            .fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({
                sourceType: 'agentic',
                agenticExecutionId: '507f1f77bcf86cd799439011',
                imagePipelineStatus: 'partial',
                createdAt: new Date('2026-07-30T06:22:21Z'),
                coverImage: {
                    status: 'pending_generation',
                    reviewStatus: 'pending_review',
                    qualityReview: { manualReviewRequired: false }
                },
                contentImages: []
            })
            .mockResolvedValueOnce(null);

        await expect(service._probeImagePipeline()).resolves.toMatchObject({
            status: 'degraded',
            reasonCode: 'latest_snapshot_not_complete',
            safeDetails: {
                evidenceSource: 'blog_artifact',
                pendingGenerationCount: 1
            }
        });
    });

    it('treats explicitly disabled content signals as an expected neutral state', async () => {
        const service = createService({
            env: configuredSeoEnv({ CONTENT_SIGNALS_ENABLED: 'false' })
        });
        const probe = vi.spyOn(service, '_probeContentSignals');

        await expect(service.checkOne({ featureKey: 'content_signals' })).resolves.toMatchObject({
            checked: true,
            status: 'expected_disabled',
            reasonCode: 'safe_rollout_disabled'
        });
        expect(probe).not.toHaveBeenCalled();
    });

    it('treats explicitly disabled Telegram as an expected neutral state', async () => {
        const service = createService({
            env: configuredSeoEnv({ TELEGRAM_BOT_ENABLED: 'false' })
        });
        const probe = vi.spyOn(service, '_probeTelegram');

        await expect(service.checkOne({ featureKey: 'telegram_bot' })).resolves.toMatchObject({
            checked: true,
            status: 'expected_disabled',
            reasonCode: 'safe_rollout_disabled'
        });
        expect(probe).not.toHaveBeenCalled();
    });

    it('rejects Telegram readiness when the admin URL is not HTTPS', () => {
        const definitions = buildCapabilityDefinitions(
            {
                TELEGRAM_BOT_ENABLED: 'true',
                TELEGRAM_NOTIFY_CHAT_IDS: 'configured'
            },
            {
                enabled: false,
                mode: 'webhook',
                tokenConfigured: true,
                allowlistConfigured: true,
                webhookSecretConfigured: true,
                adminBaseUrlConfigured: true,
                adminBaseUrlHttps: false
            }
        );

        expect(definitions.telegram).toMatchObject({
            enabled: true,
            configured: false
        });
        expect(definitions.telegram.configDetails).toMatchObject({
            adminBaseUrlConfigured: true,
            adminBaseUrlHttps: false
        });
    });

    it('rejects Telegram polling mode as configured readiness in production', () => {
        const definitions = buildCapabilityDefinitions(
            {
                NODE_ENV: 'production',
                TELEGRAM_BOT_ENABLED: 'true',
                TELEGRAM_NOTIFY_CHAT_IDS: 'configured'
            },
            {
                enabled: false,
                mode: 'polling',
                tokenConfigured: true,
                allowlistConfigured: true,
                webhookSecretConfigured: true,
                adminBaseUrlConfigured: true,
                adminBaseUrlHttps: true
            }
        );

        expect(definitions.telegram).toMatchObject({
            enabled: true,
            configured: false
        });
        expect(definitions.telegram.configDetails).toMatchObject({
            mode: 'polling',
            productionModeAllowed: false
        });
    });

    it('requires an explicit valid model, allowlist and gateway set for blog cron readiness', () => {
        const definitions = buildCapabilityDefinitions({
            NODE_ENV: 'production',
            OPENCLAW_BLOG_CRON_ENABLED: 'true',
            OPENAI_API_KEY: 'configured',
            OPENCLAW_GATEWAY_HTTP_URL: 'http://app_openclaw:18789',
            OPENCLAW_GATEWAY_TOKEN: 'g'.repeat(32),
            OPENAI_WRITER_MODEL: 'writer/model',
            OPENAI_IDEATION_MODEL: 'ideation/model',
            OPENCLAW_TOPIC_ALLOWED_RESOLVED_MODELS: 'provider/writer,provider/ideation',
            OPENCLAW_TOPIC_EXPECTED_RESOLVED_MODEL: 'provider/ideation'
        });

        expect(definitions.blogCron).toMatchObject({
            enabled: true,
            configured: true
        });
        expect(
            buildCapabilityDefinitions({
                ...{
                    NODE_ENV: 'production',
                    OPENCLAW_BLOG_CRON_ENABLED: 'true',
                    OPENAI_API_KEY: 'configured',
                    OPENCLAW_GATEWAY_HTTP_URL: 'http://app_openclaw:18789',
                    OPENCLAW_GATEWAY_TOKEN: 'g'.repeat(32),
                    OPENAI_WRITER_MODEL: 'writer/model',
                    OPENAI_IDEATION_MODEL: 'ideation/model',
                    OPENCLAW_TOPIC_EXPECTED_RESOLVED_MODEL: 'provider/ideation'
                },
                OPENCLAW_TOPIC_ALLOWED_RESOLVED_MODELS: ''
            }).blogCron
        ).toMatchObject({
            enabled: true,
            configured: false
        });
        expect(
            buildCapabilityDefinitions({
                NODE_ENV: 'production',
                OPENCLAW_BLOG_CRON_ENABLED: 'true',
                OPENAI_API_KEY: 'configured',
                OPENCLAW_GATEWAY_HTTP_URL: 'http://app_openclaw:18789',
                OPENCLAW_GATEWAY_TOKEN: 'g'.repeat(32),
                OPENAI_WRITER_MODEL: 'writer/model',
                OPENAI_IDEATION_MODEL: 'ideation/model',
                OPENCLAW_TOPIC_ALLOWED_RESOLVED_MODELS: 'provider/writer,provider/ideation',
                OPENCLAW_TOPIC_EXPECTED_RESOLVED_MODEL: 'provider/unreviewed'
            }).blogCron
        ).toMatchObject({
            enabled: true,
            configured: false,
            configDetails: {
                expectedResolvedModelConfigured: true,
                expectedResolvedModelAllowlisted: false
            }
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
        service._latest = vi
            .fn()
            .mockResolvedValueOnce({
                enabled: true,
                nextRunAt: new Date('2026-07-22T13:00:00Z')
            })
            .mockResolvedValueOnce(null);
        service._count = vi.fn().mockResolvedValue(1);

        await expect(service._probeBlogCron()).resolves.toMatchObject({
            status: 'degraded',
            reasonCode: 'stale_runtime'
        });
    });

    it('separates the next Blog schedule from the latest successful execution', async () => {
        const service = createService({
            now: () => new Date('2026-07-30T06:40:00Z'),
            schedulerRuntimeProvider: () => ({
                serviceRegistered: true,
                workerActive: false,
                schedulerActive: true,
                lastHeartbeatAt: '2026-07-30T06:39:50Z',
                pollIntervalMs: 30_000,
                enabledWorkloads: { blogCron: true },
                lastErrorCode: ''
            })
        });
        service._latest = vi
            .fn()
            .mockResolvedValueOnce({
                enabled: true,
                nextRunAt: new Date('2026-07-31T06:09:00Z'),
                lastRunAt: new Date('2026-07-30T04:26:00Z'),
                lastRunStatus: 'skipped',
                lastError: ''
            })
            .mockResolvedValueOnce({
                enabled: true,
                nextRunAt: new Date('2026-07-31T06:09:00Z'),
                lastRunAt: new Date('2026-07-30T06:36:06Z'),
                lastRunStatus: 'draft_created',
                lastError: ''
            })
            .mockResolvedValueOnce({
                status: 'draft_created',
                completedAt: new Date('2026-07-30T06:36:06Z'),
                createdAt: new Date('2026-07-30T06:20:00Z')
            })
            .mockResolvedValueOnce({
                status: 'draft_created',
                completedAt: new Date('2026-07-30T06:36:06Z'),
                createdAt: new Date('2026-07-30T06:20:00Z')
            });
        service._count = vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(2);

        await expect(service._probeBlogCron()).resolves.toMatchObject({
            status: 'healthy',
            reasonCode: 'runtime_verified',
            runtime: {
                workerActive: false,
                schedulerActive: true,
                lastSuccessfulRunAt: new Date('2026-07-30T06:36:06Z'),
                nextRunAt: new Date('2026-07-31T06:09:00Z'),
                latestArtifactStatus: 'draft_created'
            },
            safeDetails: {
                scheduleFound: true,
                latestRunScheduleFound: true,
                successfulExecutionFound: true
            }
        });
    });

    it('keeps persisted Blog activity non-green when process-local scheduler registration is unavailable', async () => {
        const service = createService({
            now: () => new Date('2026-07-30T06:40:00Z'),
            schedulerRuntimeProvider: () => ({
                serviceRegistered: false,
                schedulerActive: false,
                pollIntervalMs: 30_000,
                enabledWorkloads: { blogCron: true }
            })
        });
        service._latest = vi
            .fn()
            .mockResolvedValueOnce({
                enabled: true,
                nextRunAt: new Date('2026-07-31T06:09:00Z')
            })
            .mockResolvedValueOnce({
                enabled: true,
                lastRunAt: new Date('2026-07-30T06:36:06Z'),
                lastRunStatus: 'draft_created',
                lastError: ''
            })
            .mockResolvedValueOnce({
                status: 'draft_created',
                completedAt: new Date('2026-07-30T06:36:06Z')
            })
            .mockResolvedValueOnce({
                status: 'draft_created',
                completedAt: new Date('2026-07-30T06:36:06Z')
            });
        service._count = vi.fn().mockResolvedValue(1);

        await expect(service._probeBlogCron()).resolves.toMatchObject({
            status: 'degraded',
            reasonCode: 'scheduler_runtime_registration_unverified'
        });
    });

    it('uses a fresh dedicated-worker heartbeat when production API runtime is intentionally not embedded', async () => {
        const heartbeat = {
            state: 'running',
            acceptingClaims: true,
            workerActive: false,
            schedulerActive: true,
            pollIntervalMs: 30_000,
            lastHeartbeatAt: new Date('2026-07-30T06:39:50Z'),
            lastSuccessfulRunAt: new Date('2026-07-30T06:39:30Z'),
            lastErrorCode: '',
            enabledWorkloads: { blogCron: true },
            processRole: 'dedicated_worker'
        };
        const heartbeatQuery = {};
        heartbeatQuery.select = vi.fn(() => heartbeatQuery);
        heartbeatQuery.lean = vi.fn(() => heartbeatQuery);
        heartbeatQuery.maxTimeMS = vi.fn().mockResolvedValue(heartbeat);
        vi.spyOn(BlogAutomationWorkerHeartbeat, 'findById').mockReturnValue(heartbeatQuery);
        const service = createService({
            env: configuredSeoEnv({ OPENCLAW_EMBEDDED_WORKER: 'false' }),
            now: () => new Date('2026-07-30T06:40:00Z'),
            databaseReady: () => true,
            schedulerRuntimeProvider: () => ({
                serviceRegistered: false,
                schedulerActive: false,
                pollIntervalMs: 30_000,
                enabledWorkloads: { blogCron: true }
            })
        });
        service._latest = vi
            .fn()
            .mockResolvedValueOnce({
                enabled: true,
                nextRunAt: new Date('2026-07-31T06:09:00Z'),
                lastError: ''
            })
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(null);
        service._count = vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(1);

        await expect(service._probeBlogCron()).resolves.toMatchObject({
            status: 'healthy',
            reasonCode: 'runtime_verified',
            runtime: {
                serviceRegistered: true,
                schedulerActive: true,
                externalWorker: true,
                processRole: 'dedicated_worker',
                lastHeartbeatAt: '2026-07-30T06:39:50.000Z'
            }
        });
        expect(BlogAutomationWorkerHeartbeat.findById).toHaveBeenCalledWith(
            '0000000000000000000000b1'
        );
    });

    it('accepts a fresh strict Google Intelligence snapshot when its workload is registered', async () => {
        const service = createService({
            now: () => new Date('2026-07-30T06:40:00Z'),
            schedulerRuntimeProvider: () => ({
                serviceRegistered: true,
                schedulerActive: true,
                lastHeartbeatAt: '2026-07-30T06:39:50Z',
                pollIntervalMs: 30_000,
                enabledWorkloads: { googleIntelligence: true }
            })
        });
        service._latest = vi
            .fn()
            .mockResolvedValueOnce({
                enabled: true,
                strictGate: true,
                maxSnapshotAgeHours: 24,
                nextRunAt: new Date('2026-07-31T01:30:00Z'),
                lastRunAt: new Date('2026-07-30T01:30:07Z'),
                lastError: ''
            })
            .mockResolvedValueOnce({
                status: 'completed_with_changes',
                checkedAt: new Date('2026-07-30T01:30:07Z'),
                mandatorySourcesSucceeded: true,
                failedSources: 0
            })
            .mockResolvedValueOnce({
                status: 'completed_with_changes',
                completedAt: new Date('2026-07-30T01:30:21Z')
            });

        await expect(service._probeGoogleIntelligence()).resolves.toMatchObject({
            status: 'healthy',
            reasonCode: 'runtime_verified',
            runtime: {
                latestArtifactStatus: 'completed_with_changes'
            },
            safeDetails: {
                strictMode: true,
                snapshotStale: false,
                mandatorySourcesSucceeded: true,
                failedSourceCount: 0
            }
        });
    });

    it('keeps persisted Google Intelligence activity non-green when registration is process-local only', async () => {
        const service = createService({
            now: () => new Date('2026-07-30T06:40:00Z'),
            schedulerRuntimeProvider: () => ({
                serviceRegistered: false,
                schedulerActive: false,
                pollIntervalMs: 30_000,
                enabledWorkloads: { googleIntelligence: true }
            })
        });
        service._latest = vi
            .fn()
            .mockResolvedValueOnce({
                enabled: true,
                strictGate: true,
                maxSnapshotAgeHours: 24,
                nextRunAt: new Date('2026-07-31T01:30:00Z'),
                lastRunAt: new Date('2026-07-30T01:30:07Z'),
                lastError: ''
            })
            .mockResolvedValueOnce({
                status: 'completed_with_changes',
                checkedAt: new Date('2026-07-30T01:30:07Z'),
                mandatorySourcesSucceeded: true,
                failedSources: 0
            })
            .mockResolvedValueOnce({
                status: 'completed_with_changes',
                completedAt: new Date('2026-07-30T01:30:21Z')
            });

        await expect(service._probeGoogleIntelligence()).resolves.toMatchObject({
            status: 'degraded',
            reasonCode: 'scheduler_runtime_registration_unverified'
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
