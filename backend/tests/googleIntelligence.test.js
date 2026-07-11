import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    calculateSnapshotStatus,
    canonicalizeUrl,
    dateInTimezone,
    isPrivateIp,
    isSnapshotAcceptable,
    isSnapshotFresh
} = require('../src/utils/googleIntelligence.util');
const {
    assertSafeUrl,
    isPathDisallowedByRobots,
    safeSourceFetch
} = require('../src/services/safeSourceFetch.service');
const {
    DEFAULT_SOURCES,
    classifySeverity,
    officialHostAllowed,
    stripMarkup
} = require('../src/services/googleIntelligence.service');

const publicDns = vi.fn(async () => [{ address: '142.250.72.14', family: 4 }]);

describe('Google Intelligence snapshot policy', () => {
    it('uses the configured Asia/Ho_Chi_Minh calendar date', () => {
        expect(dateInTimezone(new Date('2026-07-10T17:30:00.000Z'), 'Asia/Ho_Chi_Minh')).toBe('2026-07-11');
    });

    it('creates completed_no_change when all required sources succeed without changes', () => {
        expect(calculateSnapshotStatus({
            successfulSources: 4,
            failedSources: 0,
            mandatorySourcesSucceeded: true,
            changesDetected: 0
        })).toBe('completed_no_change');
    });

    it('calculates partial and failed statuses correctly', () => {
        expect(calculateSnapshotStatus({
            successfulSources: 3,
            failedSources: 1,
            mandatorySourcesSucceeded: true,
            changesDetected: 1
        })).toBe('partial');
        expect(calculateSnapshotStatus({
            successfulSources: 3,
            failedSources: 1,
            mandatorySourcesSucceeded: false,
            changesDetected: 1
        })).toBe('failed');
    });

    it('blocks stale and mandatory-source-failed snapshots in strict mode', () => {
        const now = new Date('2026-07-11T10:00:00.000Z');
        const stale = { status: 'completed_no_change', checkedAt: '2026-07-09T10:00:00.000Z', mandatorySourcesSucceeded: true };
        expect(isSnapshotFresh({ snapshot: stale, now, maxAgeHours: 24 })).toBe(false);
        expect(isSnapshotAcceptable({ snapshot: stale, now, maxAgeHours: 24, strictGate: true })).toBe(false);
        expect(isSnapshotAcceptable({
            snapshot: { status: 'partial', checkedAt: now, mandatorySourcesSucceeded: false },
            now,
            maxAgeHours: 24,
            strictGate: true
        })).toBe(false);
    });

    it('accepts an audited manual override while it is fresh', () => {
        const now = new Date('2026-07-11T10:00:00.000Z');
        expect(isSnapshotAcceptable({
            snapshot: { status: 'manually_overridden', checkedAt: now, mandatorySourcesSucceeded: false },
            now,
            maxAgeHours: 24,
            strictGate: true
        })).toBe(true);
    });
});

describe('Google Intelligence source hierarchy and analysis', () => {
    it('prioritizes required official sources and never labels third-party hosts official', () => {
        const required = DEFAULT_SOURCES.filter((source) => source.required);
        expect(required.length).toBeGreaterThanOrEqual(3);
        expect(required.every((source) => source.official && officialHostAllowed(source.baseUrl))).toBe(true);
        expect(officialHostAllowed('https://example.com/google-analysis')).toBe(false);
    });

    it('assigns high impact official spam changes a critical severity', () => {
        expect(classifySeverity({
            source: { official: true, required: true },
            text: 'Google Search spam policy and core update changed'
        })).toBe('critical');
    });

    it('keeps only normalized text needed for hashing and limited summaries', () => {
        expect(stripMarkup('<style>.x{}</style><script>bad()</script><h1>Useful &amp; original</h1>')).toBe('Useful & original');
    });
});

describe('safe source fetch controls', () => {
    it('blocks localhost, private IPs and metadata addresses', async () => {
        expect(isPrivateIp('127.0.0.1')).toBe(true);
        expect(isPrivateIp('10.0.0.2')).toBe(true);
        await expect(assertSafeUrl('https://localhost/private')).rejects.toThrow('source_url_host_blocked');
        await expect(assertSafeUrl('https://169.254.169.254/latest/meta-data')).rejects.toThrow();
    });

    it('canonicalizes tracking parameters and validates public DNS', async () => {
        await expect(assertSafeUrl(
            canonicalizeUrl('https://developers.google.com/search/updates?utm_source=test#latest'),
            { resolveHostname: publicDns }
        )).resolves.toBe('https://developers.google.com/search/updates');
    });

    it('respects robots.txt disallow rules', () => {
        expect(isPathDisallowedByRobots('User-agent: *\nDisallow: /private', '/private/report')).toBe(true);
        expect(isPathDisallowedByRobots('User-agent: *\nDisallow: /private', '/search/docs')).toBe(false);
    });

    it('rejects invalid MIME responses and never follows redirects', async () => {
        const fetchImpl = vi.fn(async (url) => {
            if (String(url).endsWith('/robots.txt')) return new Response('', { status: 404 });
            return new Response('binary', { status: 200, headers: { 'content-type': 'application/octet-stream' } });
        });
        await expect(safeSourceFetch({
            url: 'https://developers.google.com/search/updates',
            fetchImpl,
            resolveHostname: publicDns
        })).rejects.toThrow('source_mime_not_allowed');
    });

    it('returns bounded text for an allowed official response', async () => {
        const fetchImpl = vi.fn(async (url) => {
            if (String(url).endsWith('/robots.txt')) return new Response('User-agent: *\nDisallow:', { status: 200, headers: { 'content-type': 'text/plain' } });
            return new Response('<h1>Search update</h1>', { status: 200, headers: { 'content-type': 'text/html' } });
        });
        const result = await safeSourceFetch({
            url: 'https://developers.google.com/search/updates',
            fetchImpl,
            resolveHostname: publicDns,
            maxBytes: 10_000
        });
        expect(result.body).toContain('Search update');
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });
});
