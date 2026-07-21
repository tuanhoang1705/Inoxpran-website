'use strict'

const DEFAULT_WINDOWS = Object.freeze([7, 28, 90]);
const { createGoogleAuthTokenProvider } = require('./googleAuthTokenProvider.service');

const DEFAULT_REQUEST_TIMEOUT_MS = 10 * 1000;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_PATTERN = /(?:^|\D)(?:\+?\d[\s().-]*){8,}(?:$|\D)/;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/;
const LONG_SECRET_PATTERN = /\b(?=[A-Za-z0-9_-]{24,}\b)(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]+\b/;
const SENSITIVE_LABEL_PATTERN = /(?:access[_-]?token|api[_-]?key|authorization|bearer|client[_-]?secret|private[_-]?key|password|passwd|secret|session[_-]?id|one[_-]?time[_-]?password|\botp\b|s\u1ed1\s*\u0111i\u1ec7n\s*tho\u1ea1i|so\s*dien\s*thoai|\u0111\u1ecba\s*ch\u1ec9|dia\s*chi|\u0111\u01a1n\s*h\u00e0ng|don\s*hang)/i;

const boundedTimeoutMs = (value, fallback = DEFAULT_REQUEST_TIMEOUT_MS) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(60 * 1000, Math.max(1, parsed)) : fallback;
};

const withAbortTimeout = async (operation, timeoutMs, code = 'SEARCH_CONSOLE_REQUEST_TIMEOUT') => {
    const controller = new AbortController();
    let timeout;
    try {
        return await Promise.race([
            Promise.resolve().then(() => operation(controller.signal)),
            new Promise((_, reject) => {
                timeout = setTimeout(() => {
                    controller.abort();
                    const error = new Error('search_console_request_timeout');
                    error.code = code;
                    reject(error);
                }, boundedTimeoutMs(timeoutMs));
            })
        ]);
    } finally {
        if (timeout) clearTimeout(timeout);
    }
};

const isoDate = (value) => new Date(value).toISOString().slice(0, 10);
const shiftDays = (value, days) => {
    const date = new Date(value);
    date.setUTCDate(date.getUTCDate() + days);
    return date;
};

const buildComparisonRanges = ({ now = new Date(), windows = DEFAULT_WINDOWS } = {}) => {
    const end = shiftDays(new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate()
    )), -1);
    return windows.map((days) => {
        const currentStart = shiftDays(end, -(days - 1));
        const previousEnd = shiftDays(currentStart, -1);
        const previousStart = shiftDays(previousEnd, -(days - 1));
        return {
            days,
            current: { startDate: isoDate(currentStart), endDate: isoDate(end) },
            previous: { startDate: isoDate(previousStart), endDate: isoDate(previousEnd) }
        };
    });
};

const finiteOrNull = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const boundedText = (value, max = 1000) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const round = (value, digits = 4) => Number(Number(value).toFixed(digits));

const decodedText = (value) => {
    try {
        return decodeURIComponent(String(value || '').replace(/\+/g, ' '));
    } catch (_error) {
        return String(value || '');
    }
};

const containsSensitiveSearchData = (value) => {
    const raw = boundedText(value, 4000);
    if (!raw) return false;
    const decoded = decodedText(raw);
    return [raw, decoded].some((candidate) =>
        EMAIL_PATTERN.test(candidate) ||
        PHONE_PATTERN.test(candidate) ||
        JWT_PATTERN.test(candidate) ||
        LONG_SECRET_PATTERN.test(candidate) ||
        SENSITIVE_LABEL_PATTERN.test(candidate)
    );
};

const sanitizeSearchQuery = (value) => {
    const query = boundedText(value, 500).replace(/\s+/g, ' ');
    return containsSensitiveSearchData(query) ? '' : query;
};

const sanitizeSearchPage = (value) => {
    const raw = boundedText(value, 2000);
    if (!raw || containsSensitiveSearchData(raw)) return '';
    try {
        const absolute = /^[a-z][a-z\d+.-]*:/i.test(raw);
        const url = new URL(raw, 'https://content-operations.invalid');
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
        if (containsSensitiveSearchData(url.pathname)) return '';
        return boundedText(absolute ? `${url.origin}${url.pathname}` : url.pathname, 1000);
    } catch (_error) {
        return '';
    }
};

const unavailableWindow = (range) => ({
    days: range.days,
    ranges: { current: range.current, previous: range.previous },
    status: 'unavailable',
    current: null,
    previous: null,
    change: null,
    topPages: [],
    topQueries: [],
    signals: {
        lowCtrPages: [],
        growingPages: [],
        decayingPages: [],
        nearPageOneQueries: [],
        cannibalization: [],
        queryGaps: [],
        risingTopics: [],
        titleMetadataOpportunities: []
    }
});

const normalizeRows = (rows) => (Array.isArray(rows) ? rows : []).map((row) => {
    const keys = Array.isArray(row?.keys) ? row.keys : [];
    return {
        date: boundedText(keys[0], 10),
        query: sanitizeSearchQuery(keys[1]),
        page: sanitizeSearchPage(keys[2]),
        clicks: finiteOrNull(row?.clicks),
        impressions: finiteOrNull(row?.impressions),
        ctr: finiteOrNull(row?.ctr),
        position: finiteOrNull(row?.position)
    };
}).filter((row) => row.date || row.query || row.page);

const summarizeRows = (rows) => {
    const clicks = rows.reduce((sum, row) => sum + (row.clicks ?? 0), 0);
    const impressions = rows.reduce((sum, row) => sum + (row.impressions ?? 0), 0);
    const weightedPosition = rows.reduce(
        (sum, row) => sum + ((row.position ?? 0) * (row.impressions ?? 0)),
        0
    );
    return {
        clicks: round(clicks, 2),
        impressions: round(impressions, 2),
        ctr: impressions > 0 ? round(clicks / impressions, 6) : 0,
        position: impressions > 0 ? round(weightedPosition / impressions, 4) : 0,
        hasData: rows.length > 0
    };
};

const aggregateBy = (rows, key) => {
    const grouped = new Map();
    rows.forEach((row) => {
        const name = row[key];
        if (!name) return;
        const current = grouped.get(name) || { key: name, clicks: 0, impressions: 0, weightedPosition: 0 };
        current.clicks += row.clicks ?? 0;
        current.impressions += row.impressions ?? 0;
        current.weightedPosition += (row.position ?? 0) * (row.impressions ?? 0);
        grouped.set(name, current);
    });
    return [...grouped.values()].map((item) => ({
        [key]: item.key,
        clicks: round(item.clicks, 2),
        impressions: round(item.impressions, 2),
        ctr: item.impressions > 0 ? round(item.clicks / item.impressions, 6) : 0,
        position: item.impressions > 0 ? round(item.weightedPosition / item.impressions, 4) : 0
    })).sort((left, right) => right.impressions - left.impressions);
};

const percentChange = (current, previous) => {
    if (!Number.isFinite(previous) || previous === 0) return null;
    return round((current - previous) / previous, 4);
};

const deriveSearchConsoleSignals = ({ currentRows = [], previousRows = [] } = {}) => {
    const pages = aggregateBy(currentRows, 'page');
    const previousPageMap = new Map(aggregateBy(previousRows, 'page').map((page) => [page.page, page]));
    const queries = aggregateBy(currentRows, 'query');
    const previousQueryMap = new Map(aggregateBy(previousRows, 'query').map((query) => [query.query, query]));
    const pagesByQuery = new Map();
    currentRows.forEach((row) => {
        if (!row.query || !row.page) return;
        const pageSet = pagesByQuery.get(row.query) || new Set();
        pageSet.add(row.page);
        pagesByQuery.set(row.query, pageSet);
    });
    const lowCtrPages = pages
            .filter((page) => page.impressions >= 100 && page.ctr < 0.02)
            .slice(0, 50);
    return {
        lowCtrPages,
        growingPages: pages
            .map((page) => {
                const previous = previousPageMap.get(page.page);
                const previousClicks = previous?.clicks || 0;
                const clicksChange = percentChange(page.clicks, previousClicks);
                if (page.clicks < 5 && previousClicks < 5) return null;
                if (previousClicks > 0 && (clicksChange === null || clicksChange < 0.2)) return null;
                return { ...page, previousClicks, clicksChange };
            })
            .filter(Boolean)
            .sort((left, right) => (right.clicksChange ?? 1) - (left.clicksChange ?? 1))
            .slice(0, 50),
        decayingPages: pages
            .map((page) => {
                const previous = previousPageMap.get(page.page);
                if (!previous || previous.clicks < 5) return null;
                const clicksChange = percentChange(page.clicks, previous.clicks);
                if (clicksChange === null || clicksChange > -0.2) return null;
                return { ...page, previousClicks: previous.clicks, clicksChange };
            })
            .filter(Boolean)
            .sort((left, right) => left.clicksChange - right.clicksChange)
            .slice(0, 50),
        nearPageOneQueries: queries
            .filter((query) => query.impressions >= 10 && query.position >= 8 && query.position <= 20)
            .slice(0, 50),
        cannibalization: [...pagesByQuery.entries()]
            .filter(([, pageSet]) => pageSet.size > 1)
            .map(([query, pageSet]) => ({ query, pages: [...pageSet].slice(0, 10), pageCount: pageSet.size }))
            .slice(0, 50),
        queryGaps: queries
            .filter((query) => query.impressions >= 20 && query.clicks === 0)
            .slice(0, 50),
        risingTopics: queries
            .map((query) => {
                const previous = previousQueryMap.get(query.query);
                const previousImpressions = previous?.impressions || 0;
                const impressionsChange = percentChange(query.impressions, previousImpressions);
                if (query.impressions < 50 && previousImpressions < 10) return null;
                if (previousImpressions > 0 && (impressionsChange === null || impressionsChange < 0.3)) return null;
                return { ...query, previousImpressions, impressionsChange };
            })
            .filter(Boolean)
            .slice(0, 50),
        titleMetadataOpportunities: lowCtrPages.map((page) => ({ ...page, reason: 'high_impressions_low_ctr' }))
    };
};

const unavailableSearchConsoleResult = ({
    now = new Date(),
    config = {},
    warning = 'search_console_unavailable',
    configured = false
} = {}) => {
    const ranges = buildComparisonRanges({ now, windows: config.windows || DEFAULT_WINDOWS });
    return {
        source: 'google_search_console',
        enabled: Boolean(config.enabled),
        configured: Boolean(configured),
        status: 'unavailable',
        fallback: true,
        checkedAt: now.toISOString(),
        windows: ranges.map(unavailableWindow),
        warnings: [warning]
    };
};

const resolveToken = async (tokenProvider) => {
    if (typeof tokenProvider === 'function') return tokenProvider();
    if (tokenProvider && typeof tokenProvider.getAccessToken === 'function') return tokenProvider.getAccessToken();
    return '';
};

class SearchConsoleAdapter {
    constructor({ config = {}, fetchImpl = globalThis.fetch, tokenProvider, now = () => new Date() } = {}) {
        this.config = {
            endpoint: 'https://searchconsole.googleapis.com/webmasters/v3/sites',
            windows: [...DEFAULT_WINDOWS],
            rowLimit: 25000,
            authTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
            requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
            ...config
        };
        this.fetchImpl = fetchImpl;
        this.tokenProvider = tokenProvider === undefined
            ? createGoogleAuthTokenProvider({ timeoutMs: this.config.authTimeoutMs })
            : tokenProvider;
        this.now = now;
    }

    async queryRange({ range, accessToken }) {
        const property = encodeURIComponent(this.config.property);
        const response = await withAbortTimeout((signal) => this.fetchImpl(
            `${this.config.endpoint}/${property}/searchAnalytics/query`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    startDate: range.startDate,
                    endDate: range.endDate,
                    dimensions: ['date', 'query', 'page'],
                    dataState: 'final',
                    rowLimit: this.config.rowLimit
                }),
                signal
            }
        ), this.config.requestTimeoutMs);
        if (!response?.ok) {
            const error = new Error('search_console_request_failed');
            error.code = `SEARCH_CONSOLE_HTTP_${Number(response?.status) || 'ERROR'}`;
            throw error;
        }
        const payload = await withAbortTimeout(() => response.json(), this.config.requestTimeoutMs);
        return normalizeRows(payload?.rows);
    }

    async read() {
        const checkedAt = this.now();
        if (!this.config.enabled) {
            return unavailableSearchConsoleResult({ now: checkedAt, config: this.config, warning: 'search_console_disabled' });
        }
        if (!this.config.property) {
            return unavailableSearchConsoleResult({ now: checkedAt, config: this.config, warning: 'search_console_property_missing' });
        }
        if (typeof this.fetchImpl !== 'function' || !this.tokenProvider) {
            return unavailableSearchConsoleResult({ now: checkedAt, config: this.config, warning: 'search_console_adapter_not_configured' });
        }

        let accessToken;
        try {
            accessToken = await withAbortTimeout(
                () => resolveToken(this.tokenProvider),
                this.config.authTimeoutMs,
                'SEARCH_CONSOLE_TOKEN_TIMEOUT'
            );
        } catch (error) {
            const warning = error?.code === 'SEARCH_CONSOLE_TOKEN_TIMEOUT'
                ? 'search_console_token_timeout'
                : 'search_console_token_unavailable';
            return unavailableSearchConsoleResult({ now: checkedAt, config: this.config, warning });
        }
        if (!accessToken || typeof accessToken !== 'string') {
            return unavailableSearchConsoleResult({ now: checkedAt, config: this.config, warning: 'search_console_token_unavailable' });
        }

        const ranges = buildComparisonRanges({ now: checkedAt, windows: this.config.windows });
        const windows = [];
        const warnings = [];
        for (const range of ranges) {
            try {
                const [currentRows, previousRows] = await Promise.all([
                    this.queryRange({ range: range.current, accessToken }),
                    this.queryRange({ range: range.previous, accessToken })
                ]);
                const current = summarizeRows(currentRows);
                const previous = summarizeRows(previousRows);
                windows.push({
                    days: range.days,
                    ranges: { current: range.current, previous: range.previous },
                    status: 'available',
                    current,
                    previous,
                    change: {
                        clicks: percentChange(current.clicks, previous.clicks),
                        impressions: percentChange(current.impressions, previous.impressions),
                        ctr: percentChange(current.ctr, previous.ctr),
                        position: previous.position === 0 ? null : round(current.position - previous.position, 4)
                    },
                    topPages: aggregateBy(currentRows, 'page').slice(0, 100),
                    topQueries: aggregateBy(currentRows, 'query').slice(0, 100),
                    signals: deriveSearchConsoleSignals({ currentRows, previousRows })
                });
            } catch (error) {
                windows.push(unavailableWindow(range));
                warnings.push(error?.code === 'SEARCH_CONSOLE_REQUEST_TIMEOUT'
                    ? 'search_console_request_timeout'
                    : boundedText(error?.code || 'search_console_request_failed', 120));
            }
        }

        const successfulWindows = windows.filter((window) => window.status === 'available').length;
        const status = successfulWindows === windows.length ? 'available' : successfulWindows > 0 ? 'partial' : 'unavailable';
        return {
            source: 'google_search_console',
            enabled: true,
            configured: true,
            status,
            fallback: status !== 'available',
            checkedAt: checkedAt.toISOString(),
            windows,
            warnings: Array.from(new Set(warnings))
        };
    }
}

const createSearchConsoleAdapter = (options) => new SearchConsoleAdapter(options);

module.exports = {
    SearchConsoleAdapter,
    aggregateBy,
    buildComparisonRanges,
    createSearchConsoleAdapter,
    deriveSearchConsoleSignals,
    normalizeRows,
    containsSensitiveSearchData,
    sanitizeSearchPage,
    sanitizeSearchQuery,
    summarizeRows,
    unavailableSearchConsoleResult
};
