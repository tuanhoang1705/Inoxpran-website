import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    OpenClawDashboardService,
    extractDashboardUrl,
    redactForDashboard
} = require('../src/services/openclawDashboard.service');

describe('openclaw dashboard service', () => {
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
});
