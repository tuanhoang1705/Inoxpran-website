'use strict'

const ACTIONS = Object.freeze({
    NEW: 'new',
    UPDATE: 'update',
    EXPAND: 'expand',
    MERGE: 'merge',
    METADATA_REFRESH: 'metadata_refresh',
    INTERNAL_LINK_MAINTENANCE: 'internal_link_maintenance',
    CONTENT_MAINTENANCE: 'content_maintenance',
    SKIP: 'skip'
});

const DEFAULT_MONITORING_WINDOWS = Object.freeze(['1d', '7d', '14d', '30d', '90d']);
const SEARCH_WINDOWS = Object.freeze([7, 28, 90]);
const DEFAULT_EXTERNAL_ADAPTER_TIMEOUT_MS = 10 * 1000;

const asBoolean = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};

const asNumber = (value, fallback, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {}) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
};

const asList = (value, fallback) => {
    if (!value) return [...fallback];
    const values = String(value).split(',').map((item) => item.trim()).filter(Boolean);
    return values.length ? Array.from(new Set(values)) : [...fallback];
};

const getContentOperationsConfig = (env = process.env) => ({
    enabled: asBoolean(env.CONTENT_OPERATIONS_ENABLED, false),
    cronEnabled: asBoolean(env.CONTENT_OPERATIONS_CRON_ENABLED, false),
    timezone: String(env.CONTENT_OPERATIONS_TIMEZONE || 'Asia/Ho_Chi_Minh').trim(),
    dailyTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(env.CONTENT_OPERATIONS_DAILY_TIME || '06:30').trim())
        ? String(env.CONTENT_OPERATIONS_DAILY_TIME || '06:30').trim()
        : '06:30',
    snapshotMaxAgeHours: asNumber(
        env.CONTENT_OPERATIONS_SNAPSHOT_TTL_HOURS ?? env.CONTENT_OPERATIONS_SNAPSHOT_MAX_AGE_HOURS,
        24,
        { min: 1, max: 168 }
    ),
    leaseMs: asNumber(env.CONTENT_OPERATIONS_LEASE_MS, 10 * 60 * 1000, { min: 30 * 1000, max: 60 * 60 * 1000 }),
    leaseWaitMs: asNumber(env.CONTENT_OPERATIONS_LEASE_WAIT_MS, 30 * 1000, { min: 0, max: 5 * 60 * 1000 }),
    leasePollMs: asNumber(env.CONTENT_OPERATIONS_LEASE_POLL_MS, 500, { min: 50, max: 10 * 1000 }),
    workOrderLeaseMinutes: asNumber(env.CONTENT_OPERATIONS_WORK_ORDER_LEASE_MINUTES, 60, { min: 10, max: 240 }),
    maxActionsPerDay: asNumber(env.CONTENT_OPERATIONS_MAX_ACTIONS_PER_DAY, 1, { min: 1, max: 24 }),
    minimumOpportunityScore: asNumber(env.CONTENT_OPERATIONS_MIN_OPPORTUNITY_SCORE, 0.65, { min: 0, max: 1 }),
    allowSkip: asBoolean(env.CONTENT_OPERATIONS_ALLOW_SKIP, true),
    monitoringWindows: asList(
        env.CONTENT_MONITOR_WINDOWS ?? env.CONTENT_OPERATIONS_MONITORING_WINDOWS,
        DEFAULT_MONITORING_WINDOWS
    ),
    opportunityWeights: Object.freeze({
        userDemand: asNumber(env.CONTENT_ACTION_WEIGHT_USER_DEMAND, 0.2, { min: 0, max: 1 }),
        contentGap: asNumber(env.CONTENT_ACTION_WEIGHT_CONTENT_GAP, 0.15, { min: 0, max: 1 }),
        performance: asNumber(env.CONTENT_ACTION_WEIGHT_PERFORMANCE, 0.15, { min: 0, max: 1 }),
        business: asNumber(env.CONTENT_ACTION_WEIGHT_BUSINESS, 0.15, { min: 0, max: 1 }),
        freshness: asNumber(env.CONTENT_ACTION_WEIGHT_FRESHNESS, 0.1, { min: 0, max: 1 }),
        customerSignal: asNumber(env.CONTENT_ACTION_WEIGHT_CUSTOMER_SIGNAL, 0.1, { min: 0, max: 1 }),
        productCampaign: asNumber(env.CONTENT_ACTION_WEIGHT_PRODUCT_CAMPAIGN, 0.05, { min: 0, max: 1 }),
        evidence: asNumber(env.CONTENT_ACTION_WEIGHT_EVIDENCE, 0.05, { min: 0, max: 1 }),
        internalLink: asNumber(env.CONTENT_ACTION_WEIGHT_INTERNAL_LINK, 0.05, { min: 0, max: 1 })
    }),
    opportunityPenalties: Object.freeze({
        cannibalization: asNumber(env.CONTENT_OPPORTUNITY_PENALTY_CANNIBALIZATION, 0.2, { min: 0, max: 1 }),
        weakEvidence: asNumber(env.CONTENT_OPPORTUNITY_PENALTY_WEAK_EVIDENCE, 0.25, { min: 0, max: 1 }),
        staleProductData: asNumber(env.CONTENT_OPPORTUNITY_PENALTY_STALE_PRODUCT_DATA, 0.2, { min: 0, max: 1 }),
        lowConfidence: asNumber(env.CONTENT_OPPORTUNITY_PENALTY_LOW_CONFIDENCE, 0.15, { min: 0, max: 1 })
    }),
    opportunitySkipThreshold: asNumber(
        env.CONTENT_OPERATIONS_MIN_OPPORTUNITY_SCORE ?? env.CONTENT_OPPORTUNITY_SKIP_THRESHOLD,
        0.65,
        { min: 0, max: 1 }
    ),
    minimumUserValueScore: asNumber(
        env.CONTENT_OPERATIONS_MIN_USER_VALUE_SCORE ?? env.CONTENT_OPPORTUNITY_MINIMUM_USER_VALUE_SCORE,
        0.2,
        { min: 0, max: 1 }
    ),
    inventory: Object.freeze({
        enabled: asBoolean(env.CONTENT_INVENTORY_ENABLED, true),
        maxAgeHours: asNumber(
            env.CONTENT_INVENTORY_SNAPSHOT_TTL_HOURS ?? env.CONTENT_INVENTORY_MAX_AGE_HOURS,
            24,
            { min: 1, max: 168 }
        ),
        staleDays: asNumber(env.CONTENT_INVENTORY_STALE_DAYS, 180, { min: 7, max: 3650 }),
        reviewDays: asNumber(env.CONTENT_INVENTORY_REVIEW_DAYS, 90, { min: 7, max: 3650 }),
        thinWordThreshold: asNumber(env.CONTENT_INVENTORY_THIN_WORD_THRESHOLD, 300, { min: 50, max: 5000 }),
        maxItems: asNumber(env.CONTENT_INVENTORY_MAX_ITEMS, 10000, { min: 1, max: 100000 })
    }),
    contentSignals: Object.freeze({
        enabled: asBoolean(env.CONTENT_SIGNALS_ENABLED, true),
        defaultTtlDays: asNumber(env.CONTENT_SIGNAL_DEFAULT_TTL_DAYS, 90, { min: 1, max: 730 }),
        maxTextLength: asNumber(
            env.CONTENT_SIGNAL_MAX_LENGTH ?? env.CONTENT_SIGNAL_MAX_TEXT_LENGTH,
            2000,
            { min: 100, max: 5000 }
        )
    }),
    searchConsole: Object.freeze({
        enabled: asBoolean(env.SEARCH_CONSOLE_ENABLED, false),
        property: String(
            env.SEARCH_CONSOLE_PROPERTY ||
            env.GOOGLE_SEARCH_CONSOLE_PROPERTY ||
            env.SEARCH_CONSOLE_SITE_URL ||
            ''
        ).trim(),
        endpoint: 'https://searchconsole.googleapis.com/webmasters/v3/sites',
        windows: [...SEARCH_WINDOWS],
        rowLimit: asNumber(env.SEARCH_CONSOLE_ROW_LIMIT, 25000, { min: 1, max: 25000 }),
        lookbackDays: asNumber(env.SEARCH_CONSOLE_LOOKBACK_DAYS, 90, { min: 7, max: 365 }),
        authTimeoutMs: asNumber(
            env.SEARCH_CONSOLE_AUTH_TIMEOUT_MS ?? env.CONTENT_EXTERNAL_ADAPTER_TIMEOUT_MS,
            DEFAULT_EXTERNAL_ADAPTER_TIMEOUT_MS,
            { min: 250, max: 60 * 1000 }
        ),
        requestTimeoutMs: asNumber(
            env.SEARCH_CONSOLE_REQUEST_TIMEOUT_MS ?? env.CONTENT_EXTERNAL_ADAPTER_TIMEOUT_MS,
            DEFAULT_EXTERNAL_ADAPTER_TIMEOUT_MS,
            { min: 250, max: 60 * 1000 }
        )
    }),
    aggregateAnalytics: Object.freeze({
        enabled: asBoolean(env.CONTENT_ANALYTICS_ENABLED ?? env.CONTENT_AGGREGATE_ANALYTICS_ENABLED, false),
        windows: [...SEARCH_WINDOWS],
        queryTimeoutMs: asNumber(
            env.CONTENT_ANALYTICS_QUERY_TIMEOUT_MS ?? env.CONTENT_EXTERNAL_ADAPTER_TIMEOUT_MS,
            DEFAULT_EXTERNAL_ADAPTER_TIMEOUT_MS,
            { min: 250, max: 60 * 1000 }
        )
    }),
    trends: Object.freeze({
        enabled: asBoolean(env.CONTENT_TRENDS_ENABLED, false),
        provider: String(env.CONTENT_TRENDS_PROVIDER || 'disabled').trim(),
        requestTimeoutMs: asNumber(
            env.CONTENT_TRENDS_REQUEST_TIMEOUT_MS ?? env.CONTENT_EXTERNAL_ADAPTER_TIMEOUT_MS,
            DEFAULT_EXTERNAL_ADAPTER_TIMEOUT_MS,
            { min: 250, max: 60 * 1000 }
        )
    }),
    performanceMonitoring: Object.freeze({
        enabled: asBoolean(env.CONTENT_PERFORMANCE_MONITORING_ENABLED, false)
    }),
    learning: Object.freeze({
        enabled: asBoolean(env.CONTENT_LEARNING_ENABLED, false),
        minimumAgeDays: asNumber(env.CONTENT_LEARNING_MIN_AGE_DAYS, 14, { min: 1, max: 3650 }),
        minimumImpressions: asNumber(env.CONTENT_LEARNING_MIN_IMPRESSIONS, 100, { min: 1, max: 1_000_000_000 }),
        autoApply: asBoolean(env.CONTENT_LEARNING_AUTO_APPLY, false)
    })
});

module.exports = {
    ACTIONS,
    DEFAULT_EXTERNAL_ADAPTER_TIMEOUT_MS,
    DEFAULT_MONITORING_WINDOWS,
    SEARCH_WINDOWS,
    buildContentOperationsConfig: getContentOperationsConfig,
    getContentOperationsConfig
};
