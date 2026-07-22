import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { getContentOperationsConfig } = require('../src/config/contentOperations.config');
const { ContentOperationsDailySnapshot } = require('../src/models/contentOperationsDailySnapshot.model');
const { ContentInventorySnapshot } = require('../src/models/contentInventorySnapshot.model');
const { ContentInventoryItem } = require('../src/models/contentInventoryItem.model');
const { ContentSignal } = require('../src/models/contentSignal.model');
const {
    SearchConsoleAdapter,
    deriveSearchConsoleSignals,
    normalizeRows,
    unavailableSearchConsoleResult
} = require('../src/services/contentOperations/searchConsole.adapter');
const {
    AggregateAnalyticsAdapter,
    normalizeAggregateRows
} = require('../src/services/contentOperations/aggregateAnalytics.adapter');
const { TrendsAdapter } = require('../src/services/contentOperations/trends.adapter');
const {
    createConfiguredTrendsProvider
} = require('../src/services/contentOperations/contentOperationsIntelligence.service');
const {
    WEBMASTERS_READONLY_SCOPE,
    createGoogleAuthTokenProvider
} = require('../src/services/contentOperations/googleAuthTokenProvider.service');

const hasUniqueIndex = (model, expectedKeys) => model.schema.indexes().some(([keys, options]) =>
    options.unique && Object.entries(expectedKeys).every(([key, value]) => keys[key] === value));

describe('Content Operations configuration and persistence contracts', () => {
    it('is opt-in and honors documented env aliases', () => {
        const config = getContentOperationsConfig({
            CONTENT_OPERATIONS_ENABLED: 'true',
            CONTENT_OPERATIONS_CRON_ENABLED: 'true',
            CONTENT_OPERATIONS_WORK_ORDER_LEASE_MINUTES: '75',
            CONTENT_OPERATIONS_SNAPSHOT_TTL_HOURS: '42',
            CONTENT_INVENTORY_SNAPSHOT_TTL_HOURS: '18',
            CONTENT_SIGNAL_MAX_LENGTH: '800',
            CONTENT_MONITOR_WINDOWS: '1d,7d,90d',
            CONTENT_PERFORMANCE_MONITORING_ENABLED: 'true',
            CONTENT_LEARNING_ENABLED: 'true',
            CONTENT_LEARNING_MIN_AGE_DAYS: '21',
            CONTENT_LEARNING_MIN_IMPRESSIONS: '250',
            CONTENT_LEARNING_AUTO_APPLY: 'false',
            CONTENT_ANALYTICS_ENABLED: 'true',
            CONTENT_TRENDS_ENABLED: 'true',
            CONTENT_TRENDS_PROVIDER: 'google_trends_rss',
            CONTENT_TRENDS_GEO: 'vn',
            CONTENT_TRENDS_MAX_SIGNALS: '40',
            CONTENT_TRENDS_MAX_RESPONSE_BYTES: '262144',
            CONTENT_EXTERNAL_ADAPTER_TIMEOUT_MS: '1250',
            SEARCH_CONSOLE_REQUEST_TIMEOUT_MS: '2500',
            CONTENT_ACTION_WEIGHT_USER_DEMAND: '0.2'
        });
        const defaults = getContentOperationsConfig({});
        expect(defaults.enabled).toBe(false);
        expect(defaults.cronEnabled).toBe(false);
        expect(defaults.performanceMonitoring.enabled).toBe(false);
        expect(defaults.learning).toMatchObject({ enabled: false, autoApply: false });
        expect(defaults.snapshotMaxAgeHours).toBe(24);
        expect(defaults.inventory.maxAgeHours).toBe(24);
        expect(defaults.minimumUserValueScore).toBe(0.2);
        expect(config).toMatchObject({
            enabled: true,
            cronEnabled: true,
            snapshotMaxAgeHours: 42,
            workOrderLeaseMinutes: 75,
            monitoringWindows: ['1d', '7d', '90d']
        });
        expect(config.inventory.maxAgeHours).toBe(18);
        expect(config.contentSignals.maxTextLength).toBe(800);
        expect(config.aggregateAnalytics.enabled).toBe(true);
        expect(config.searchConsole.authTimeoutMs).toBe(1250);
        expect(config.searchConsole.requestTimeoutMs).toBe(2500);
        expect(config.aggregateAnalytics.queryTimeoutMs).toBe(1250);
        expect(config.trends.requestTimeoutMs).toBe(1250);
        expect(config.trends).toMatchObject({
            enabled: true,
            provider: 'google_trends_rss',
            geo: 'VN',
            maxSignals: 40,
            maxResponseBytes: 262144
        });
        expect(createConfiguredTrendsProvider(config.trends)).toMatchObject({
            geo: 'VN',
            maxSignals: 40,
            maxResponseBytes: 262144
        });
        expect(createConfiguredTrendsProvider({ provider: 'disabled' })).toBeNull();
        expect(config.performanceMonitoring.enabled).toBe(true);
        expect(config.learning).toEqual({
            enabled: true,
            minimumAgeDays: 21,
            minimumImpressions: 250,
            autoApply: false
        });
        expect(config.opportunityWeights.userDemand).toBe(0.2);
    });

    it('ships the required nine-factor default vector totaling one', () => {
        const weights = getContentOperationsConfig({}).opportunityWeights;
        expect(Object.keys(weights)).toEqual([
            'userDemand', 'contentGap', 'performance', 'business', 'freshness',
            'customerSignal', 'productCampaign', 'evidence', 'internalLink'
        ]);
        expect(Object.values(weights).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 10);
    });

    it('enforces one snapshot per local date and the requested signal enums', () => {
        expect(hasUniqueIndex(ContentOperationsDailySnapshot, { snapshotDate: 1, timezone: 1 })).toBe(true);
        expect(hasUniqueIndex(ContentInventorySnapshot, { snapshotDate: 1, timezone: 1 })).toBe(true);
        expect(hasUniqueIndex(ContentInventoryItem, { snapshotId: 1, blogId: 1 })).toBe(true);
        expect(ContentSignal.schema.path('sourceType').enumValues).toEqual([
            'sales', 'customer_support', 'product', 'inventory', 'campaign', 'manual', 'internal_search'
        ]);
        expect(ContentSignal.schema.path('priority').enumValues).toEqual(['low', 'medium', 'high', 'critical']);
    });
});

describe('Search Console adapter', () => {
    const now = new Date('2026-07-20T12:00:00.000Z');

    it('keeps disabled metrics unavailable instead of coercing them to zero', () => {
        const result = unavailableSearchConsoleResult({ now, config: { enabled: false, windows: [7] } });
        expect(result.status).toBe('unavailable');
        expect(result.windows[0].current).toBeNull();
        expect(result.windows[0].previous).toBeNull();
    });

    it('requests only the verified Search Console read-only OAuth scope', async () => {
        const getAccessToken = vi.fn(async () => ({ token: 'short-lived-token' }));
        const getClient = vi.fn(async () => ({ getAccessToken }));
        const GoogleAuthClass = vi.fn(function GoogleAuth(options) {
            this.options = options;
            this.getClient = getClient;
        });
        const provider = createGoogleAuthTokenProvider({ GoogleAuthClass });
        expect(await provider()).toBe('short-lived-token');
        expect(GoogleAuthClass).toHaveBeenCalledWith({ scopes: [WEBMASTERS_READONLY_SCOPE] });
        expect(WEBMASTERS_READONLY_SCOPE).toBe('https://www.googleapis.com/auth/webmasters.readonly');
    });

    it('bounds Google auth and fails closed when token acquisition stalls', async () => {
        const getClient = vi.fn(() => new Promise(() => {}));
        const GoogleAuthClass = vi.fn(function GoogleAuth() { this.getClient = getClient; });
        const provider = createGoogleAuthTokenProvider({ GoogleAuthClass, timeoutMs: 5 });
        await expect(provider()).rejects.toMatchObject({ code: 'GOOGLE_AUTH_CLIENT_TIMEOUT' });

        const result = await new SearchConsoleAdapter({
            config: {
                enabled: true,
                property: 'sc-domain:inoxpran.com',
                windows: [7],
                authTimeoutMs: 5
            },
            tokenProvider: () => new Promise(() => {}),
            fetchImpl: vi.fn(),
            now: () => now
        }).read();
        expect(result).toMatchObject({ status: 'unavailable', fallback: true });
        expect(result.warnings).toEqual(['search_console_token_timeout']);
    });

    it('treats a successful empty API response as an observed zero and never returns credentials', async () => {
        const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ rows: [] }) }));
        const adapter = new SearchConsoleAdapter({
            config: {
                enabled: true,
                property: 'sc-domain:inoxpran.com',
                endpoint: 'https://searchconsole.googleapis.com/webmasters/v3/sites',
                windows: [7],
                rowLimit: 100
            },
            tokenProvider: async () => 'secret-access-token',
            fetchImpl,
            now: () => now
        });
        const result = await adapter.read();
        expect(result.status).toBe('available');
        expect(result.windows[0].current).toMatchObject({ clicks: 0, impressions: 0, ctr: 0, hasData: false });
        expect(JSON.stringify(result)).not.toContain('secret-access-token');
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer secret-access-token');
    });

    it('times out stalled API reads and returns unavailable windows', async () => {
        const result = await new SearchConsoleAdapter({
            config: {
                enabled: true,
                property: 'sc-domain:inoxpran.com',
                windows: [7],
                requestTimeoutMs: 5
            },
            tokenProvider: async () => 'short-lived-token',
            fetchImpl: () => new Promise(() => {}),
            now: () => now
        }).read();
        expect(result.status).toBe('unavailable');
        expect(result.windows[0].current).toBeNull();
        expect(result.warnings).toEqual(['search_console_request_timeout']);
    });

    it('drops PII and credential-bearing query/page dimensions before aggregation', () => {
        const normalized = normalizeRows([
            {
                keys: [
                    '2026-07-19',
                    'email alice@example.com access_token=not-for-storage',
                    'https://inoxpran.com/blog/private?access_token=not-for-storage'
                ],
                clicks: 1,
                impressions: 2
            },
            {
                keys: ['2026-07-19', 'noi inox 304', 'https://inoxpran.com/blog/noi-inox?utm_source=search'],
                clicks: 3,
                impressions: 10
            }
        ]);
        expect(normalized[0]).toMatchObject({ query: '', page: '' });
        expect(normalized[1]).toMatchObject({ query: 'noi inox 304', page: 'https://inoxpran.com/blog/noi-inox' });
        expect(JSON.stringify(normalized)).not.toContain('alice@example.com');
        expect(JSON.stringify(normalized)).not.toContain('not-for-storage');
        expect(JSON.stringify(normalized)).not.toContain('utm_source');
    });

    it('derives low-CTR, decay, near-page-one, cannibalization and query-gap evidence', () => {
        const currentRows = [
            { query: 'noi inox', page: '/blog/a', clicks: 0, impressions: 120, position: 9 },
            { query: 'noi inox', page: '/blog/b', clicks: 0, impressions: 80, position: 12 }
        ];
        const previousRows = [
            { query: 'noi inox', page: '/blog/a', clicks: 10, impressions: 100, position: 7 }
        ];
        const signals = deriveSearchConsoleSignals({ currentRows, previousRows });
        expect(signals.lowCtrPages.map((item) => item.page)).toContain('/blog/a');
        expect(signals.decayingPages.map((item) => item.page)).toContain('/blog/a');
        expect(signals.nearPageOneQueries[0].query).toBe('noi inox');
        expect(signals.cannibalization[0]).toMatchObject({ query: 'noi inox', pageCount: 2 });
        expect(signals.queryGaps[0].query).toBe('noi inox');
    });
});

describe('Aggregate analytics and trends adapters', () => {
    const now = new Date('2026-07-20T12:00:00.000Z');

    it('returns aggregate-only allowlisted rows and observed zeros', async () => {
        expect(normalizeAggregateRows([{
            path: '/blog/a', views: 2, sessions: 1, engagedSessions: 1,
            ip: '10.0.0.1', user: 'private', sessionId: 'secret'
        }])[0]).toEqual({
            path: '/blog/a', views: 2, events: 0, sessions: 1, engagedSessions: 1,
            engagementTimeMs: 0, productLinkClicks: 0
        });
        const adapter = new AggregateAnalyticsAdapter({
            config: { enabled: true, windows: [7] },
            queryProvider: vi.fn(async () => []),
            now: () => now
        });
        const result = await adapter.read();
        expect(result.status).toBe('available');
        expect(result.periods[0].current).toMatchObject({ views: 0, sessions: 0, hasData: false });
    });

    it('keeps disabled aggregate analytics null', async () => {
        const result = await new AggregateAnalyticsAdapter({
            config: { enabled: false, windows: [7] },
            now: () => now
        }).read();
        expect(result.periods[0].current).toBeNull();
    });

    it('fails aggregate analytics closed when the query provider stalls', async () => {
        const result = await new AggregateAnalyticsAdapter({
            config: { enabled: true, windows: [7], queryTimeoutMs: 5 },
            queryProvider: () => new Promise(() => {}),
            now: () => now
        }).read();
        expect(result.status).toBe('unavailable');
        expect(result.periods[0].current).toBeNull();
        expect(result.warnings).toEqual(['aggregate_analytics_query_timeout']);
    });

    it('fails trends closed when its provider stalls', async () => {
        const result = await new TrendsAdapter({
            config: { enabled: true, provider: 'provider-a', requestTimeoutMs: 5 },
            provider: () => new Promise(() => {}),
            now: () => now
        }).read();
        expect(result.status).toBe('unavailable');
        expect(result.signals).toEqual([]);
        expect(result.warnings).toEqual(['trends_provider_timeout']);
    });

    it('removes credential-like trend URL parameters and fragments', async () => {
        const result = await new TrendsAdapter({
            config: { enabled: true, provider: 'provider-a' },
            provider: async () => [{
                topic: 'cookware', source: 'provider-a',
                sourceUrl: 'https://trends.example/topic?locale=vi&access_token=never-store#private'
            }],
            now: () => now
        }).read();
        expect(result.signals[0].sourceUrl).toBe('https://trends.example/topic?locale=vi');
    });

    it('preserves trend provenance while stripping non-HTTPS URLs', async () => {
        const adapter = new TrendsAdapter({
            config: { enabled: true, provider: 'provider-a' },
            provider: async () => [{
                topic: 'Bảo quản nồi inox',
                source: 'provider-a',
                sourceUrl: 'http://unsafe.example/topic',
                timeRange: '7d',
                confidence: 'high',
                classification: 'observed',
                summary: 'Observed aggregate interest.'
            }],
            now: () => now
        });
        const result = await adapter.read();
        expect(result.status).toBe('available');
        expect(result.signals[0]).toMatchObject({
            topic: 'Bảo quản nồi inox', source: 'provider-a', sourceUrl: '', classification: 'observed'
        });
    });
});
