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
    extractDocumentDates,
    officialHostAllowed,
    summarizeMaterialChange,
    stripMarkup
} = require('../src/services/googleIntelligence.service');
const { GoogleIntelligenceSnapshot } = require('../src/models/googleIntelligenceSnapshot.model');
const { GoogleIntelligenceRun } = require('../src/models/googleIntelligenceRun.model');
const { GoogleIntelligenceSchedule } = require('../src/models/googleIntelligenceSchedule.model');
const { GoogleIntelligenceChange } = require('../src/models/googleIntelligenceChange.model');

const publicDns = vi.fn(async () => [{ address: '142.250.72.14', family: 4 }]);

describe('Google Intelligence snapshot policy', () => {
    it('persists unique daily snapshots, execution keys, singleton schedules and change fingerprints', () => {
        const hasUniqueIndex = (model, expectedKeys) => model.schema.indexes().some(([keys, options]) =>
            options.unique && Object.entries(expectedKeys).every(([key, value]) => keys[key] === value));
        expect(hasUniqueIndex(GoogleIntelligenceSnapshot, { snapshotDate: 1, timezone: 1 })).toBe(true);
        expect(hasUniqueIndex(GoogleIntelligenceRun, { executionKey: 1 })).toBe(true);
        expect(hasUniqueIndex(GoogleIntelligenceSchedule, { singletonKey: 1 })).toBe(true);
        expect(hasUniqueIndex(GoogleIntelligenceChange, { fingerprint: 1 })).toBe(true);
    });

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

    it('extracts source publication and modification dates without storing full documents', () => {
        const dates = extractDocumentDates('<meta property="article:published_time" content="2026-07-10T01:00:00Z"><updated>2026-07-11T02:00:00Z</updated>');
        expect(dates.publishedAt.toISOString()).toBe('2026-07-10T01:00:00.000Z');
        expect(dates.updatedAt.toISOString()).toBe('2026-07-11T02:00:00.000Z');
    });

    it('distinguishes removed guidance and terminology changes from a plain hash change', () => {
        const result = summarizeMaterialChange({
            previousExcerpt: 'Structured data properties alpha beta gamma delta epsilon must remain visible and supported.',
            currentExcerpt: 'Structured data properties alpha remain visible.',
            isNew: false
        });
        expect(result.changeType).toBe('removed');
        expect(result.terminologyChanged).toBe(true);
        expect(result.removedTerms.length).toBeGreaterThan(0);
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

    it('accepts a valid RSS body when an official endpoint declares MIME as None', async () => {
        const fetchImpl = vi.fn(async (url) => {
            if (String(url).endsWith('/robots.txt')) return new Response('', { status: 404 });
            return new Response('<?xml version="1.0"?><rss version="2.0"><channel><title>Updates</title></channel></rss>', {
                status: 200,
                headers: { 'content-type': 'None' }
            });
        });
        const result = await safeSourceFetch({
            url: 'https://developers.google.com/search/updates/search_docs_updates.rss',
            fetchImpl,
            resolveHostname: publicDns,
            expectedMode: 'rss'
        });
        expect(result.contentType).toBe('application/rss+xml');
        expect(result.body).toContain('<rss');
    });

    it('does not MIME-sniff explicitly declared binary content', async () => {
        const fetchImpl = vi.fn(async (url) => String(url).endsWith('/robots.txt')
            ? new Response('', { status: 404 })
            : new Response('<?xml version="1.0"?><rss></rss>', {
                status: 200,
                headers: { 'content-type': 'application/octet-stream' }
            }));
        await expect(safeSourceFetch({
            url: 'https://developers.google.com/search/updates/search_docs_updates.rss',
            fetchImpl,
            resolveHostname: publicDns,
            expectedMode: 'rss'
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

    it('aborts a source request on timeout', async () => {
        const fetchImpl = (url, options) => {
            if (String(url).endsWith('/robots.txt')) return Promise.resolve(new Response('', { status: 404 }));
            return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
        };
        await expect(safeSourceFetch({
            url: 'https://developers.google.com/search/updates', fetchImpl,
            resolveHostname: publicDns, timeoutMs: 10
        })).rejects.toThrow('source_request_timeout');
    });

    it('rejects source bodies larger than the configured limit', async () => {
        const fetchImpl = vi.fn(async (url) => String(url).endsWith('/robots.txt')
            ? new Response('', { status: 404 })
            : new Response('0123456789', { status: 200, headers: { 'content-type': 'text/plain', 'content-length': '10' } }));
        await expect(safeSourceFetch({
            url: 'https://developers.google.com/search/updates', fetchImpl,
            resolveHostname: publicDns, maxBytes: 4
        })).rejects.toThrow('source_response_too_large');
    });
});
