'use strict'

const dns = require('node:dns').promises;
const { canonicalizeUrl, isPrivateIp } = require('../utils/googleIntelligence.util');

const DEFAULT_MAX_BYTES = 750_000;
const BLOCKED_HOSTS = new Set(['localhost', 'localhost.localdomain', 'metadata.google.internal', '169.254.169.254']);
const ALLOWED_MIME = ['text/html', 'text/plain', 'application/json', 'application/xml', 'text/xml', 'application/rss+xml', 'application/atom+xml'];

const assertSafeUrl = async (input, { resolveHostname = dns.lookup, allowHttp = false } = {}) => {
    const canonicalUrl = canonicalizeUrl(input);
    const url = new URL(canonicalUrl);
    if (url.username || url.password) throw new Error('source_url_credentials_not_allowed');
    if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) throw new Error('source_url_https_required');
    const hostname = url.hostname.toLowerCase();
    if (BLOCKED_HOSTS.has(hostname) || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
        throw new Error('source_url_host_blocked');
    }
    if (isPrivateIp(hostname)) throw new Error('source_url_private_ip_blocked');
    const addresses = await resolveHostname(hostname, { all: true, verbatim: true });
    const list = Array.isArray(addresses) ? addresses : [addresses];
    if (!list.length || list.some((item) => isPrivateIp(item?.address || item))) {
        throw new Error('source_url_private_dns_blocked');
    }
    return canonicalUrl;
};

const isPathDisallowedByRobots = (robotsText, pathname) => {
    const lines = String(robotsText || '').split(/\r?\n/);
    let applies = false;
    for (const rawLine of lines) {
        const line = rawLine.replace(/#.*$/g, '').trim();
        if (!line) continue;
        const [rawKey, ...rest] = line.split(':');
        const key = rawKey.trim().toLowerCase();
        const value = rest.join(':').trim();
        if (key === 'user-agent') {
            applies = value === '*';
            continue;
        }
        if (applies && key === 'disallow' && value && pathname.startsWith(value)) return true;
    }
    return false;
};

const readLimitedBody = async (response, maxBytes = DEFAULT_MAX_BYTES) => {
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > maxBytes) throw new Error('source_response_too_large');
    if (!response.body?.getReader) {
        const text = await response.text();
        if (Buffer.byteLength(text) > maxBytes) throw new Error('source_response_too_large');
        return text;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
            await reader.cancel().catch(() => null);
            throw new Error('source_response_too_large');
        }
        chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString('utf8');
};

const safeSourceFetch = async ({
    url,
    timeoutMs = 15_000,
    maxBytes = DEFAULT_MAX_BYTES,
    fetchImpl = global.fetch,
    resolveHostname = dns.lookup,
    checkRobots = true,
    allowHttp = false
}) => {
    if (typeof fetchImpl !== 'function') throw new Error('fetch_not_available');
    const canonicalUrl = await assertSafeUrl(url, { resolveHostname, allowHttp });
    const target = new URL(canonicalUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 15_000));
    try {
        if (checkRobots) {
            const robotsUrl = `${target.origin}/robots.txt`;
            const robotsResponse = await fetchImpl(robotsUrl, {
                headers: { 'user-agent': 'InoxpranGoogleIntelligence/1.0 (+https://inoxpran.com)' },
                redirect: 'error',
                signal: controller.signal
            }).catch(() => null);
            if (robotsResponse?.ok) {
                const robotsText = await readLimitedBody(robotsResponse, 100_000);
                if (isPathDisallowedByRobots(robotsText, target.pathname)) throw new Error('source_disallowed_by_robots');
            }
        }

        const response = await fetchImpl(canonicalUrl, {
            headers: {
                accept: 'text/html,application/rss+xml,application/atom+xml,application/json,text/plain;q=0.8',
                'user-agent': 'InoxpranGoogleIntelligence/1.0 (+https://inoxpran.com)'
            },
            redirect: 'error',
            signal: controller.signal
        });
        if (!response.ok) throw new Error(`source_http_${response.status}`);
        const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (!ALLOWED_MIME.includes(contentType)) throw new Error('source_mime_not_allowed');
        return {
            canonicalUrl,
            contentType,
            body: await readLimitedBody(response, maxBytes),
            fetchedAt: new Date(),
            etag: String(response.headers.get('etag') || ''),
            lastModified: String(response.headers.get('last-modified') || '')
        };
    } catch (error) {
        if (error?.name === 'AbortError') throw new Error('source_request_timeout');
        throw error;
    } finally {
        clearTimeout(timeout);
    }
};

module.exports = {
    ALLOWED_MIME,
    assertSafeUrl,
    isPathDisallowedByRobots,
    readLimitedBody,
    safeSourceFetch
};
