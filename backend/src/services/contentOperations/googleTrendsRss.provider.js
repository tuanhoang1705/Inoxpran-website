'use strict'

const GOOGLE_TRENDS_RSS_ENDPOINT = 'https://trends.google.com/trending/rss';
const GOOGLE_TRENDS_RSS_SOURCE = 'google-trends-rss';
const DEFAULT_GOOGLE_TRENDS_GEO = 'VN';
const DEFAULT_MAX_RESPONSE_BYTES = 512 * 1024;
const HARD_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_SIGNALS = 50;
const HARD_MAX_SIGNALS = 100;

const ERROR_CODES = Object.freeze({
    ABORTED: 'GOOGLE_TRENDS_REQUEST_ABORTED',
    FETCH_UNAVAILABLE: 'GOOGLE_TRENDS_FETCH_UNAVAILABLE',
    HTTP_ERROR: 'GOOGLE_TRENDS_HTTP_ERROR',
    INVALID_GEO: 'GOOGLE_TRENDS_INVALID_GEO',
    REQUEST_FAILED: 'GOOGLE_TRENDS_REQUEST_FAILED',
    RESPONSE_INVALID: 'GOOGLE_TRENDS_RESPONSE_INVALID',
    RESPONSE_READ_FAILED: 'GOOGLE_TRENDS_RESPONSE_READ_FAILED',
    RESPONSE_TOO_LARGE: 'GOOGLE_TRENDS_RESPONSE_TOO_LARGE'
});

const createProviderError = (code, extra = {}) => {
    const error = new Error(String(code || ERROR_CODES.REQUEST_FAILED).toLowerCase());
    error.code = code || ERROR_CODES.REQUEST_FAILED;
    Object.assign(error, extra);
    return error;
};

const normalizeGeo = (value = DEFAULT_GOOGLE_TRENDS_GEO) => {
    const candidate = String(value ?? '').trim() || DEFAULT_GOOGLE_TRENDS_GEO;
    if (!/^[a-z]{2}$/i.test(candidate)) {
        throw createProviderError(ERROR_CODES.INVALID_GEO);
    }
    return candidate.toUpperCase();
};

const boundedInteger = (value, { fallback, minimum, maximum }) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)));
};

const normalizeMaxResponseBytes = (value) => boundedInteger(value, {
    fallback: DEFAULT_MAX_RESPONSE_BYTES,
    minimum: 1024,
    maximum: HARD_MAX_RESPONSE_BYTES
});

const normalizeMaxSignals = (value) => boundedInteger(value, {
    fallback: DEFAULT_MAX_SIGNALS,
    minimum: 1,
    maximum: HARD_MAX_SIGNALS
});

const buildGoogleTrendsRssUrl = (geo = DEFAULT_GOOGLE_TRENDS_GEO) => {
    const url = new URL(GOOGLE_TRENDS_RSS_ENDPOINT);
    url.searchParams.set('geo', normalizeGeo(geo));
    return url.toString();
};

const assertNotAborted = (signal) => {
    if (signal?.aborted) throw createProviderError(ERROR_CODES.ABORTED);
};

const responseContentLength = (response) => {
    const raw = response?.headers && typeof response.headers.get === 'function'
        ? response.headers.get('content-length')
        : null;
    if (!raw || !/^\d+$/.test(String(raw).trim())) return null;
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

const toBuffer = (chunk) => {
    if (Buffer.isBuffer(chunk)) return chunk;
    if (chunk instanceof Uint8Array) return Buffer.from(chunk);
    if (chunk instanceof ArrayBuffer) return Buffer.from(chunk);
    if (typeof chunk === 'string') return Buffer.from(chunk, 'utf8');
    throw createProviderError(ERROR_CODES.RESPONSE_READ_FAILED);
};

const joinBoundedChunks = (chunks, totalBytes, maxResponseBytes) => {
    if (totalBytes > maxResponseBytes) {
        throw createProviderError(ERROR_CODES.RESPONSE_TOO_LARGE);
    }
    return Buffer.concat(chunks, totalBytes).toString('utf8');
};

const readWebStreamWithLimit = async ({ body, signal, maxResponseBytes }) => {
    const reader = body.getReader();
    const chunks = [];
    let totalBytes = 0;
    try {
        while (true) {
            assertNotAborted(signal);
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = toBuffer(value);
            totalBytes += chunk.byteLength;
            if (totalBytes > maxResponseBytes) {
                await reader.cancel().catch(() => {});
                throw createProviderError(ERROR_CODES.RESPONSE_TOO_LARGE);
            }
            chunks.push(chunk);
        }
    } finally {
        if (typeof reader.releaseLock === 'function') reader.releaseLock();
    }
    return joinBoundedChunks(chunks, totalBytes, maxResponseBytes);
};

const readAsyncIterableWithLimit = async ({ body, signal, maxResponseBytes }) => {
    const chunks = [];
    let totalBytes = 0;
    for await (const value of body) {
        assertNotAborted(signal);
        const chunk = toBuffer(value);
        totalBytes += chunk.byteLength;
        if (totalBytes > maxResponseBytes) {
            if (typeof body.destroy === 'function') body.destroy();
            throw createProviderError(ERROR_CODES.RESPONSE_TOO_LARGE);
        }
        chunks.push(chunk);
    }
    return joinBoundedChunks(chunks, totalBytes, maxResponseBytes);
};

const readResponseTextWithLimit = async ({ response, signal, maxResponseBytes }) => {
    assertNotAborted(signal);
    const declaredLength = responseContentLength(response);
    if (declaredLength !== null && declaredLength > maxResponseBytes) {
        throw createProviderError(ERROR_CODES.RESPONSE_TOO_LARGE);
    }

    try {
        if (response?.body && typeof response.body.getReader === 'function') {
            return await readWebStreamWithLimit({ body: response.body, signal, maxResponseBytes });
        }
        if (response?.body && typeof response.body[Symbol.asyncIterator] === 'function') {
            return await readAsyncIterableWithLimit({ body: response.body, signal, maxResponseBytes });
        }
        if (typeof response?.text !== 'function') {
            throw createProviderError(ERROR_CODES.RESPONSE_READ_FAILED);
        }
        const value = await response.text();
        assertNotAborted(signal);
        const bytes = Buffer.byteLength(String(value ?? ''), 'utf8');
        if (bytes > maxResponseBytes) throw createProviderError(ERROR_CODES.RESPONSE_TOO_LARGE);
        return String(value ?? '');
    } catch (error) {
        if (error?.code) throw error;
        if (signal?.aborted || error?.name === 'AbortError') {
            throw createProviderError(ERROR_CODES.ABORTED);
        }
        throw createProviderError(ERROR_CODES.RESPONSE_READ_FAILED);
    }
};

const decodeXmlEntities = (value) => String(value ?? '')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity) => {
        const lower = entity.toLowerCase();
        const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
        if (Object.prototype.hasOwnProperty.call(named, lower)) return named[lower];
        const codePoint = lower.startsWith('#x')
            ? Number.parseInt(lower.slice(2), 16)
            : Number.parseInt(lower.slice(1), 10);
        if (!Number.isInteger(codePoint)
            || codePoint <= 0
            || codePoint > 0x10ffff
            || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
            return ' ';
        }
        try {
            return String.fromCodePoint(codePoint);
        } catch (_error) {
            return ' ';
        }
    })
    .replace(/&[a-z][a-z0-9._:-]{0,31};/gi, ' ');

const sanitizeXmlText = (value, maxLength = 300) => {
    const withoutCdataMarkers = String(value ?? '')
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
        .replace(/<!\[CDATA\[|\]\]>/gi, ' ');
    return decodeXmlEntities(withoutCdataMarkers)
        .replace(/<[^>]*>/g, ' ')
        .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength);
};

const containsPrivateOrCredentialData = (value) => {
    const text = String(value ?? '');
    if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text)) return true;
    if (/(?:https?:\/\/|www\.)/i.test(text)) return true;
    if (/(?:access[_-]?token|api[_-]?key|client[_-]?secret|password|passwd|credential)\s*[:=]/i.test(text)) return true;
    const phoneLike = text.match(/(?:\+?\d[\d\s().-]{6,}\d)/g) || [];
    return phoneLike.some((candidate) => (candidate.match(/\d/g) || []).length >= 9);
};

const extractTagText = (block, tagName, maxLength) => {
    const escaped = String(tagName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = String(block ?? '').match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}\\s*>`, 'i'));
    return match ? sanitizeXmlText(match[1], maxLength) : '';
};

const normalizeApproximateTraffic = (value) => {
    const candidate = sanitizeXmlText(value, 40);
    return /^[~<>]?\s*\d[\d.,]*\s*(?:[kmb])?\+?$/i.test(candidate) ? candidate : '';
};

const normalizeCheckedAt = (value, fallback) => {
    const parsed = new Date(value || fallback);
    return Number.isNaN(parsed.getTime()) ? new Date(fallback).toISOString() : parsed.toISOString();
};

const parseGoogleTrendsRss = (xml, {
    geo = DEFAULT_GOOGLE_TRENDS_GEO,
    maxSignals = DEFAULT_MAX_SIGNALS,
    checkedAt = new Date()
} = {}) => {
    const source = String(xml ?? '').replace(/^\ufeff/, '').trim();
    if (!source
        || /<!DOCTYPE|<!ENTITY/i.test(source)
        || !/<rss(?:\s[^>]*)?>/i.test(source)
        || !/<channel(?:\s[^>]*)?>/i.test(source)
        || !/<\/channel\s*>/i.test(source)
        || !/<\/rss\s*>/i.test(source)) {
        throw createProviderError(ERROR_CODES.RESPONSE_INVALID);
    }

    const itemOpenCount = (source.match(/<item(?:\s[^>]*)?>/gi) || []).length;
    const itemCloseCount = (source.match(/<\/item\s*>/gi) || []).length;
    if (itemOpenCount !== itemCloseCount) {
        throw createProviderError(ERROR_CODES.RESPONSE_INVALID);
    }

    const normalizedGeo = normalizeGeo(geo);
    const boundedMaxSignals = normalizeMaxSignals(maxSignals);
    const sourceUrl = buildGoogleTrendsRssUrl(normalizedGeo);
    const observedAt = normalizeCheckedAt(checkedAt, new Date());
    const signals = [];
    const itemPattern = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item\s*>/gi;
    let itemMatch;
    while (signals.length < boundedMaxSignals && (itemMatch = itemPattern.exec(source))) {
        const metadataOnly = itemMatch[1]
            .replace(/<description(?:\s[^>]*)?>[\s\S]*?<\/description\s*>/gi, ' ')
            .replace(/<ht:news_item(?:\s[^>]*)?>[\s\S]*?<\/ht:news_item\s*>/gi, ' ');
        const topic = extractTagText(metadataOnly, 'title', 300);
        if (!topic || containsPrivateOrCredentialData(topic)) continue;
        const traffic = normalizeApproximateTraffic(extractTagText(metadataOnly, 'ht:approx_traffic', 40));
        signals.push({
            topic,
            source: GOOGLE_TRENDS_RSS_SOURCE,
            sourceUrl,
            checkedAt: observedAt,
            timeRange: 'trending-now',
            confidence: traffic ? 'high' : 'medium',
            classification: 'observed',
            summary: traffic
                ? `Observed in Google Trends Trending Now with approximately ${traffic} searches.`
                : 'Observed in Google Trends Trending Now.'
        });
    }
    return signals;
};

class GoogleTrendsRssProvider {
    constructor({
        fetchImpl = globalThis.fetch,
        geo = DEFAULT_GOOGLE_TRENDS_GEO,
        maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
        maxSignals = DEFAULT_MAX_SIGNALS,
        now = () => new Date()
    } = {}) {
        this.fetchImpl = fetchImpl;
        this.geo = normalizeGeo(geo);
        this.maxResponseBytes = normalizeMaxResponseBytes(maxResponseBytes);
        this.maxSignals = normalizeMaxSignals(maxSignals);
        this.now = now;
    }

    async readTrends({ checkedAt, signal } = {}) {
        assertNotAborted(signal);
        if (typeof this.fetchImpl !== 'function') {
            throw createProviderError(ERROR_CODES.FETCH_UNAVAILABLE);
        }

        const sourceUrl = buildGoogleTrendsRssUrl(this.geo);
        let response;
        try {
            response = await this.fetchImpl(sourceUrl, {
                method: 'GET',
                headers: {
                    Accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8'
                },
                redirect: 'error',
                signal
            });
        } catch (error) {
            if (signal?.aborted || error?.name === 'AbortError') {
                throw createProviderError(ERROR_CODES.ABORTED);
            }
            throw createProviderError(ERROR_CODES.REQUEST_FAILED);
        }

        if (!response?.ok) {
            throw createProviderError(ERROR_CODES.HTTP_ERROR, {
                status: Number.isInteger(response?.status) ? response.status : 0
            });
        }

        const xml = await readResponseTextWithLimit({
            response,
            signal,
            maxResponseBytes: this.maxResponseBytes
        });
        return {
            signals: parseGoogleTrendsRss(xml, {
                geo: this.geo,
                maxSignals: this.maxSignals,
                checkedAt: checkedAt || this.now()
            })
        };
    }
}

const createGoogleTrendsRssProvider = (options) => new GoogleTrendsRssProvider(options);

module.exports = {
    DEFAULT_GOOGLE_TRENDS_GEO,
    DEFAULT_MAX_RESPONSE_BYTES,
    DEFAULT_MAX_SIGNALS,
    ERROR_CODES,
    GOOGLE_TRENDS_RSS_ENDPOINT,
    GOOGLE_TRENDS_RSS_SOURCE,
    GoogleTrendsRssProvider,
    buildGoogleTrendsRssUrl,
    containsPrivateOrCredentialData,
    createGoogleTrendsRssProvider,
    decodeXmlEntities,
    normalizeGeo,
    parseGoogleTrendsRss,
    readResponseTextWithLimit,
    sanitizeXmlText
};
