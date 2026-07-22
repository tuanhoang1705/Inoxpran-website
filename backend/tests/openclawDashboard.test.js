import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {
    OpenClawDashboardService,
    buildCapabilityMatrix,
    extractDashboardUrl,
    formatDockerUpdateStatus,
    getConfiguredDashboardUrl,
    probeOpenClawGateway,
    queueDockerUpdateRequest,
    redactForDashboard
} = require('../src/services/openclawDashboard.service');
const { BlogAutomationScheduleService } = require('../src/services/blogAutomationSchedule.service');

describe('openclaw dashboard service', () => {
    it('keeps enabled, configured, and availability as independent capability axes', () => {
        const telegramStatus = {
            tokenConfigured: true,
            allowlistConfigured: true,
            webhookSecretConfigured: true,
            adminBaseUrlConfigured: true
        };
        const capabilities = buildCapabilityMatrix({
            SEO_AGENT_ENABLED: 'false',
            API_KEY: 'set',
            SEO_AGENT_API_KEY: 'set',
            SEO_AGENT_HMAC_SECRET: 'set',
            OPENAI_API_KEY: 'set',
            SEARCH_CONSOLE_ENABLED: 'true',
            GOOGLE_APPLICATION_CREDENTIALS: '/run/secrets/google.json',
            CONTENT_TRENDS_ENABLED: 'true',
            CONTENT_TRENDS_PROVIDER: 'google_trends_rss',
            IMAGE_SEARCH_PROVIDER: 'disabled',
            IMAGE_SEARCH_API_KEY: 'set',
            TELEGRAM_BOT_ENABLED: 'false'
        }, telegramStatus);

        expect(capabilities.seoAgent).toMatchObject({
            enabled: false,
            configured: true,
            availability: 'unknown',
            reasonCode: 'disabled_by_configuration'
        });
        expect(capabilities.searchConsole).toMatchObject({
            enabled: true,
            configured: false,
            availability: 'unavailable',
            reasonCode: 'missing_configuration'
        });
        expect(capabilities.trends).toMatchObject({ enabled: true, configured: true });
        expect(capabilities.imageSearch).toMatchObject({ enabled: false, configured: false });
        expect(capabilities.telegram).toMatchObject({ enabled: false, configured: true });
    });

    it('redacts sensitive values from command output', () => {
        const output = redactForDashboard(
            'API_KEY=abc123 SEO_AGENT_HMAC_SECRET=hmac123 OPENAI_API_KEY=sk-testsecret123456 mongodb+srv://user:pass@example/db authorization: Bearer abc.def http://127.0.0.1:18789/?token=secret-token'
        );

        expect(output).not.toContain('abc123');
        expect(output).not.toContain('hmac123');
        expect(output).not.toContain('sk-testsecret123456');
        expect(output).not.toContain('user:pass');
        expect(output).not.toContain('abc.def');
        expect(output).not.toContain('secret-token');
        expect(output).toContain('[redacted');
    });

    it('rejects unsupported dashboard actions', () => {
        expect(() =>
            OpenClawDashboardService.startRun({
                action: 'rm -rf /'
            })
        ).toThrow('Unsupported OpenClaw action');
    });

    it('rejects unsafe profile names before spawning OpenClaw', () => {
        expect(() =>
            OpenClawDashboardService.startRun({
                action: 'status',
                profile: 'inoxpran; rm -rf /'
            })
        ).toThrow('Invalid OpenClaw profile');
    });

    it('prefers the token-authenticated OpenClaw dashboard URL when available', () => {
        const output = [
            'Dashboard URL: http://127.0.0.1:18789/',
            'OPENCLAW_DASHBOARD_URL=http://127.0.0.1:18789/?token=secret-token'
        ].join('\n');

        expect(extractDashboardUrl(output)).toBe('http://127.0.0.1:18789/?token=secret-token');
        expect(redactForDashboard(output)).not.toContain('secret-token');
    });

    it('builds an HTTPS Docker dashboard URL with the gateway token in the fragment', () => {
        const previous = {
            deploymentMode: process.env.OPENCLAW_DEPLOYMENT_MODE,
            dashboardUrl: process.env.OPENCLAW_DASHBOARD_URL,
            gatewayToken: process.env.OPENCLAW_GATEWAY_TOKEN
        };
        process.env.OPENCLAW_DEPLOYMENT_MODE = 'docker';
        process.env.OPENCLAW_DASHBOARD_URL = 'https://admin.inoxpran.com/openclaw-dashboard/';
        process.env.OPENCLAW_GATEWAY_TOKEN = 'gateway-secret';

        try {
            expect(getConfiguredDashboardUrl()).toBe(
                'https://admin.inoxpran.com/openclaw-dashboard/#token=gateway-secret'
            );
            expect(redactForDashboard(getConfiguredDashboardUrl())).not.toContain('gateway-secret');
        } finally {
            for (const [name, value] of Object.entries({
                OPENCLAW_DEPLOYMENT_MODE: previous.deploymentMode,
                OPENCLAW_DASHBOARD_URL: previous.dashboardUrl,
                OPENCLAW_GATEWAY_TOKEN: previous.gatewayToken
            })) {
                if (value === undefined) delete process.env[name];
                else process.env[name] = value;
            }
        }
    });

    it('checks Docker gateway liveness and readiness without spawning the OpenClaw CLI', async () => {
        const fetchImpl = vi.fn(async () => new Response('{"ok":true}', {
            status: 200,
            headers: { 'content-type': 'application/json' }
        }));
        const health = await probeOpenClawGateway({ fetchImpl });
        expect(health).toMatchObject({ reachable: true, live: true, ready: true });
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('reports an unreachable Docker gateway without throwing or leaking internals', async () => {
        const health = await probeOpenClawGateway({
            fetchImpl: vi.fn(async () => { throw new Error('connect ECONNREFUSED secret-host'); })
        });
        expect(health).toMatchObject({ reachable: false, live: false, ready: false });
        expect(health.error).toBe('gateway_unreachable');
    });

    it('runs Docker Daily Draft through a saved schedule without requiring a script or CLI', async () => {
        const previousMode = process.env.OPENCLAW_DEPLOYMENT_MODE;
        process.env.OPENCLAW_DEPLOYMENT_MODE = 'docker';
        const scheduleId = '507f1f77bcf86cd799439011';
        const executionId = '507f1f77bcf86cd799439012';
        const blogId = '507f1f77bcf86cd799439013';
        const listSchedules = vi.spyOn(BlogAutomationScheduleService, 'listSchedules').mockResolvedValue({
            schedules: [{ id: scheduleId, name: 'Daily draft', enabled: false }]
        });
        const runNow = vi.spyOn(BlogAutomationScheduleService, 'runNow').mockResolvedValue({
            queued: true,
            scheduleId,
            startedAt: new Date().toISOString(),
            message: 'queued'
        });
        const listExecutions = vi.spyOn(BlogAutomationScheduleService, 'listExecutions').mockResolvedValue({
            executions: [{
                id: executionId,
                scheduleId,
                status: 'draft_created',
                createdAt: new Date().toISOString(),
                completedAt: new Date().toISOString(),
                blogId,
                blogTitle: 'A safe draft',
                contentAction: 'new'
            }]
        });

        try {
            const started = OpenClawDashboardService.startRun({ action: 'daily-draft', profile: 'inoxpran' });
            expect(started.command).toContain('audited backend pipeline');
            expect(started.error).not.toContain('Missing script');
            await vi.waitFor(() => {
                expect(OpenClawDashboardService.getRun({ runId: started.id })).toMatchObject({
                    status: 'completed',
                    executionId,
                    blogId
                });
            });
            expect(listSchedules).toHaveBeenCalledOnce();
            expect(runNow).toHaveBeenCalledWith({ scheduleId });
            expect(listExecutions).toHaveBeenCalledWith({ scheduleId, limit: 20 });
        } finally {
            listSchedules.mockRestore();
            runNow.mockRestore();
            listExecutions.mockRestore();
            if (previousMode === undefined) delete process.env.OPENCLAW_DEPLOYMENT_MODE;
            else process.env.OPENCLAW_DEPLOYMENT_MODE = previousMode;
        }
    });

    it('queues exactly one structured Docker update request at a time', () => {
        const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-update-'));
        const runId = randomUUID();

        try {
            const queued = queueDockerUpdateRequest({ runId, runtimeDir });
            expect(JSON.parse(fs.readFileSync(queued.requestFile, 'utf8'))).toMatchObject({
                schemaVersion: 1,
                action: 'update-openclaw',
                requestId: runId
            });
            expect(JSON.parse(fs.readFileSync(queued.statusFile, 'utf8'))).toMatchObject({
                requestId: runId,
                state: 'queued'
            });
            expect(() => queueDockerUpdateRequest({ runId: randomUUID(), runtimeDir }))
                .toThrow('already queued or running');
        } finally {
            fs.rmSync(runtimeDir, { recursive: true, force: true });
        }
    });

    it('formats updater status without leaking provider keys', () => {
        const output = formatDockerUpdateStatus({
            message: 'pull complete',
            error: 'FIRECRAWL_API_KEY=fc-secretvalue123456 IMAGE_SEARCH_API_KEY=pexels-secret-value'
        });
        expect(output).toContain('pull complete');
        expect(output).not.toContain('fc-secretvalue123456');
        expect(output).not.toContain('pexels-secret-value');
    });
});
