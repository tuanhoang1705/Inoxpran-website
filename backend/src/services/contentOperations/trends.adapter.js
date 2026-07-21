'use strict'

const text = (value, max = 1000) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const DEFAULT_TRENDS_TIMEOUT_MS = 10 * 1000;
const SENSITIVE_QUERY_KEY = /(?:^|[_-])(?:access|auth|api|client|private|session|refresh)?[_-]?(?:token|key|secret|password|passwd|signature|credential|code)(?:$|[_-])/i;

const boundedTimeoutMs = (value, fallback = DEFAULT_TRENDS_TIMEOUT_MS) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(60 * 1000, Math.max(1, parsed)) : fallback;
};

const withProviderTimeout = async (provider, input, timeoutMs) => {
    const controller = new AbortController();
    let timeout;
    try {
        return await Promise.race([
            Promise.resolve().then(() => provider({ ...input, signal: controller.signal })),
            new Promise((_, reject) => {
                timeout = setTimeout(() => {
                    controller.abort();
                    const error = new Error('trends_provider_timeout');
                    error.code = 'TRENDS_PROVIDER_TIMEOUT';
                    reject(error);
                }, boundedTimeoutMs(timeoutMs));
            })
        ]);
    } finally {
        if (timeout) clearTimeout(timeout);
    }
};

const safeHttpsUrl = (value) => {
    try {
        const url = new URL(String(value || ''));
        if (url.protocol !== 'https:' || url.username || url.password) return '';
        for (const key of [...url.searchParams.keys()]) {
            if (SENSITIVE_QUERY_KEY.test(key)) url.searchParams.delete(key);
        }
        url.hash = '';
        return url.toString();
    } catch (_error) {
        return '';
    }
};

const normalizeTrendSignal = (signal, { providerName = '', checkedAt = new Date() } = {}) => ({
    topic: text(signal?.topic, 300),
    source: text(signal?.source || providerName, 120),
    sourceUrl: safeHttpsUrl(signal?.sourceUrl),
    checkedAt: signal?.checkedAt && !Number.isNaN(new Date(signal.checkedAt).getTime())
        ? new Date(signal.checkedAt).toISOString()
        : checkedAt.toISOString(),
    timeRange: text(signal?.timeRange, 120),
    confidence: ['low', 'medium', 'high'].includes(signal?.confidence) ? signal.confidence : 'low',
    classification: ['observed', 'inferred', 'verified'].includes(signal?.classification)
        ? signal.classification
        : 'observed',
    summary: text(signal?.summary, 1000)
});

const unavailableTrendsResult = ({ now = new Date(), config = {}, warning = 'trends_unavailable' } = {}) => ({
    source: 'trends',
    enabled: Boolean(config.enabled),
    configured: Boolean(config.enabled && config.provider && config.provider !== 'disabled'),
    status: 'unavailable',
    checkedAt: now.toISOString(),
    signals: [],
    warnings: [warning]
});

class TrendsAdapter {
    constructor({ config = {}, provider = null, now = () => new Date() } = {}) {
        this.config = { requestTimeoutMs: DEFAULT_TRENDS_TIMEOUT_MS, ...config };
        this.provider = provider;
        this.now = now;
    }

    async read() {
        const checkedAt = this.now();
        if (!this.config.enabled) {
            return unavailableTrendsResult({ now: checkedAt, config: this.config, warning: 'trends_disabled' });
        }
        const readProvider = typeof this.provider === 'function'
            ? this.provider
            : this.provider && typeof this.provider.readTrends === 'function'
                ? this.provider.readTrends.bind(this.provider)
                : null;
        if (!this.config.provider || this.config.provider === 'disabled' || !readProvider) {
            return unavailableTrendsResult({ now: checkedAt, config: this.config, warning: 'trends_provider_missing' });
        }
        try {
            const payload = await withProviderTimeout(
                readProvider,
                { checkedAt },
                this.config.requestTimeoutMs
            );
            const sourceSignals = Array.isArray(payload) ? payload : payload?.signals;
            const signals = (Array.isArray(sourceSignals) ? sourceSignals : [])
                .map((signal) => normalizeTrendSignal(signal, { providerName: this.config.provider, checkedAt }))
                .filter((signal) => signal.topic && signal.source)
                .slice(0, 200);
            return {
                source: 'trends',
                enabled: true,
                configured: true,
                status: 'available',
                checkedAt: checkedAt.toISOString(),
                signals,
                warnings: []
            };
        } catch (error) {
            const warning = error?.code === 'TRENDS_PROVIDER_TIMEOUT'
                ? 'trends_provider_timeout'
                : 'trends_provider_failed';
            return unavailableTrendsResult({ now: checkedAt, config: this.config, warning });
        }
    }
}

const createTrendsAdapter = (options) => new TrendsAdapter(options);

module.exports = {
    TrendsAdapter,
    DEFAULT_TRENDS_TIMEOUT_MS,
    boundedTimeoutMs,
    createTrendsAdapter,
    normalizeTrendSignal,
    safeHttpsUrl,
    unavailableTrendsResult
};
