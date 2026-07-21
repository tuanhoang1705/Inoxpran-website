'use strict'

const UserEvent = require('../../models/userEvent.model');
const { buildComparisonRanges } = require('./searchConsole.adapter');

const finiteOrNull = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const text = (value, max = 1000) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const round = (value, digits = 4) => Number(Number(value).toFixed(digits));
const DEFAULT_QUERY_TIMEOUT_MS = 10 * 1000;

const boundedTimeoutMs = (value, fallback = DEFAULT_QUERY_TIMEOUT_MS) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(60 * 1000, Math.max(1, parsed)) : fallback;
};

const withQueryTimeout = async (promise, timeoutMs) => {
    let timeout;
    try {
        return await Promise.race([
            Promise.resolve(promise),
            new Promise((_, reject) => {
                timeout = setTimeout(() => {
                    const error = new Error('aggregate_analytics_query_timeout');
                    error.code = 'AGGREGATE_ANALYTICS_QUERY_TIMEOUT';
                    reject(error);
                }, boundedTimeoutMs(timeoutMs));
            })
        ]);
    } finally {
        if (timeout) clearTimeout(timeout);
    }
};

const normalizePath = (value) => {
    const path = text(value, 1000);
    if (!path) return '';
    if (path.startsWith('/')) return path.split(/[?#]/)[0];
    return `/blog/${encodeURIComponent(path)}`;
};

const defaultQueryProvider = async ({ start, end, timeoutMs = DEFAULT_QUERY_TIMEOUT_MS }) => UserEvent.aggregate([
    {
        $match: {
            occurredAt: { $gte: start, $lte: end },
            $or: [
                { path: { $regex: '^/blog/' } },
                { 'click.blogSlug': { $nin: [null, ''] } }
            ]
        }
    },
    {
        $group: {
            _id: { $ifNull: ['$click.blogSlug', '$path'] },
            views: {
                $sum: { $cond: [{ $in: ['$type', ['page_view', 'blog_view']] }, 1, 0] }
            },
            eventCount: { $sum: 1 },
            sessionIds: { $addToSet: '$sessionId' },
            engagedSessionIds: {
                $addToSet: {
                    $cond: [
                        { $or: [{ $gte: ['$durationMs', 10000] }, { $gte: ['$scrollDepthPercent', 50] }] },
                        '$sessionId',
                        null
                    ]
                }
            },
            engagementTimeMs: { $sum: { $ifNull: ['$durationMs', 0] } },
            productLinkClicks: {
                $sum: {
                    $cond: [
                        {
                            $and: [
                                { $eq: ['$type', 'click'] },
                                {
                                    $or: [
                                        { $ne: ['$click.productId', null] },
                                        { $not: [{ $in: ['$click.productSlug', [null, '']] }] },
                                        { $regexMatch: { input: { $ifNull: ['$click.href', ''] }, regex: '^/product/' } }
                                    ]
                                }
                            ]
                        },
                        1,
                        0
                    ]
                }
            }
        }
    },
    {
        $project: {
            _id: 0,
            path: '$_id',
            views: 1,
            eventCount: 1,
            sessions: { $size: '$sessionIds' },
            engagedSessions: {
                $size: { $setDifference: ['$engagedSessionIds', [null]] }
            },
            engagementTimeMs: 1,
            productLinkClicks: 1
        }
    },
    { $sort: { views: -1, eventCount: -1 } },
    { $limit: 1000 }
]).option({ maxTimeMS: boundedTimeoutMs(timeoutMs) });

const normalizeAggregateRows = (rows) => (Array.isArray(rows) ? rows : []).map((row) => ({
    path: normalizePath(row?.path),
    views: finiteOrNull(row?.views) ?? 0,
    events: finiteOrNull(row?.events ?? row?.eventCount) ?? 0,
    sessions: finiteOrNull(row?.sessions) ?? 0,
    engagedSessions: finiteOrNull(row?.engagedSessions) ?? 0,
    engagementTimeMs: finiteOrNull(row?.engagementTimeMs) ?? 0,
    productLinkClicks: finiteOrNull(row?.productLinkClicks) ?? 0
})).filter((row) => row.path.startsWith('/blog/')).slice(0, 1000);

const summarize = (rows) => {
    const totals = rows.reduce((result, row) => ({
        views: result.views + row.views,
        events: result.events + row.events,
        sessions: result.sessions + row.sessions,
        engagedSessions: result.engagedSessions + row.engagedSessions,
        engagementTimeMs: result.engagementTimeMs + row.engagementTimeMs,
        productLinkClicks: result.productLinkClicks + row.productLinkClicks
    }), { views: 0, events: 0, sessions: 0, engagedSessions: 0, engagementTimeMs: 0, productLinkClicks: 0 });
    return {
        ...totals,
        engagementRate: totals.sessions > 0 ? round(totals.engagedSessions / totals.sessions, 4) : 0,
        hasData: rows.length > 0
    };
};

const unavailablePeriod = (range) => ({
    days: range.days,
    ranges: { current: range.current, previous: range.previous },
    status: 'unavailable',
    current: null,
    previous: null,
    pages: []
});

const unavailableAggregateAnalyticsResult = ({ now = new Date(), config = {}, warning = 'aggregate_analytics_unavailable' } = {}) => ({
    source: 'first_party_aggregate_analytics',
    enabled: Boolean(config.enabled),
    configured: Boolean(config.enabled),
    status: 'unavailable',
    checkedAt: now.toISOString(),
    periods: buildComparisonRanges({ now, windows: config.windows || [7, 28, 90] }).map(unavailablePeriod),
    warnings: [warning]
});

class AggregateAnalyticsAdapter {
    constructor({ config = {}, queryProvider = defaultQueryProvider, now = () => new Date() } = {}) {
        this.config = { windows: [7, 28, 90], queryTimeoutMs: DEFAULT_QUERY_TIMEOUT_MS, ...config };
        this.queryProvider = queryProvider;
        this.now = now;
    }

    async read() {
        const checkedAt = this.now();
        if (!this.config.enabled) {
            return unavailableAggregateAnalyticsResult({ now: checkedAt, config: this.config, warning: 'aggregate_analytics_disabled' });
        }
        if (typeof this.queryProvider !== 'function') {
            return unavailableAggregateAnalyticsResult({ now: checkedAt, config: this.config, warning: 'aggregate_analytics_provider_missing' });
        }

        const ranges = buildComparisonRanges({ now: checkedAt, windows: this.config.windows });
        const periods = [];
        const warnings = [];
        for (const range of ranges) {
            try {
                const [currentSource, previousSource] = await Promise.all([
                    withQueryTimeout(this.queryProvider({
                        start: new Date(`${range.current.startDate}T00:00:00.000Z`),
                        end: new Date(`${range.current.endDate}T23:59:59.999Z`),
                        days: range.days,
                        period: 'current',
                        timeoutMs: boundedTimeoutMs(this.config.queryTimeoutMs)
                    }), this.config.queryTimeoutMs),
                    withQueryTimeout(this.queryProvider({
                        start: new Date(`${range.previous.startDate}T00:00:00.000Z`),
                        end: new Date(`${range.previous.endDate}T23:59:59.999Z`),
                        days: range.days,
                        period: 'previous',
                        timeoutMs: boundedTimeoutMs(this.config.queryTimeoutMs)
                    }), this.config.queryTimeoutMs)
                ]);
                const currentRows = normalizeAggregateRows(currentSource);
                const previousRows = normalizeAggregateRows(previousSource);
                periods.push({
                    days: range.days,
                    ranges: { current: range.current, previous: range.previous },
                    status: 'available',
                    current: summarize(currentRows),
                    previous: summarize(previousRows),
                    pages: currentRows.slice(0, 100)
                });
            } catch (error) {
                periods.push(unavailablePeriod(range));
                warnings.push(error?.code === 'AGGREGATE_ANALYTICS_QUERY_TIMEOUT'
                    ? 'aggregate_analytics_query_timeout'
                    : 'aggregate_analytics_query_failed');
            }
        }
        const available = periods.filter((period) => period.status === 'available').length;
        const status = available === periods.length ? 'available' : available > 0 ? 'partial' : 'unavailable';
        return {
            source: 'first_party_aggregate_analytics',
            enabled: true,
            configured: true,
            status,
            checkedAt: checkedAt.toISOString(),
            periods,
            warnings: Array.from(new Set(warnings))
        };
    }
}

const createAggregateAnalyticsAdapter = (options) => new AggregateAnalyticsAdapter(options);

module.exports = {
    AggregateAnalyticsAdapter,
    DEFAULT_QUERY_TIMEOUT_MS,
    boundedTimeoutMs,
    createAggregateAnalyticsAdapter,
    defaultQueryProvider,
    normalizeAggregateRows,
    summarizeAggregateRows: summarize,
    unavailableAggregateAnalyticsResult
};
