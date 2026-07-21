'use strict'

const net = require('node:net');
const { normalizeString } = require('./seoBlogSanitizer');

const DEFAULT_TIMEZONE = 'Asia/Ho_Chi_Minh';
const ACCEPTABLE_STATUSES = new Set([
    'completed_with_changes',
    'completed_no_change',
    'partial',
    'manually_overridden'
]);
const SENSITIVE_SOURCE_QUERY_KEY = /(?:^|[_-])(?:access[_-]?token|token|auth(?:orization)?|api[_-]?key|key|client[_-]?secret|secret|signature|sig|credential|password|passcode|cookie|session|code|email|phone|mobile|customer)(?:$|[_-])/i;

const dateInTimezone = (date = new Date(), timezone = DEFAULT_TIMEZONE) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
};

const isPrivateIp = (address = '') => {
    const value = String(address || '').replace(/^::ffff:/, '').toLowerCase();
    if (!net.isIP(value)) return false;
    if (net.isIPv4(value)) {
        const [a, b, c] = value.split('.').map(Number);
        return a === 10 || a === 127 || a === 0 || a >= 224 ||
            (a === 100 && b >= 64 && b <= 127) ||
            (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && [0, 168].includes(b)) ||
            (a === 198 && [18, 19].includes(b)) ||
            (a === 198 && b === 51 && c === 100) ||
            (a === 203 && b === 0 && c === 113);
    }
    return value === '::1' || value === '::' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb') || value.startsWith('2001:db8');
};

const canonicalizeUrl = (input) => {
    const url = new URL(normalizeString(input));
    url.hash = '';
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid'].forEach((key) => url.searchParams.delete(key));
    url.hostname = url.hostname.toLowerCase();
    if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) url.port = '';
    return url.toString();
};

const sourceUrlError = (code) => {
    const error = new Error(code);
    error.code = code;
    return error;
};

const assertPersistableSourceUrl = (input) => {
    let rawUrl;
    try {
        rawUrl = new URL(String(input || '').trim());
    } catch (_error) {
        throw sourceUrlError('GOOGLE_SOURCE_URL_INVALID');
    }
    // Check the raw URL first. Canonicalization may intentionally remove benign
    // tracking parameters, but credentials and secrets must never be accepted.
    if (rawUrl.username || rawUrl.password) throw sourceUrlError('GOOGLE_SOURCE_URL_CREDENTIALS_NOT_ALLOWED');
    for (const key of rawUrl.searchParams.keys()) {
        if (SENSITIVE_SOURCE_QUERY_KEY.test(key)) throw sourceUrlError('GOOGLE_SOURCE_URL_SENSITIVE_QUERY_NOT_ALLOWED');
    }
    const canonicalUrl = canonicalizeUrl(rawUrl.toString());
    const url = new URL(canonicalUrl);
    if (url.username || url.password) throw sourceUrlError('GOOGLE_SOURCE_URL_CREDENTIALS_NOT_ALLOWED');
    for (const key of url.searchParams.keys()) {
        if (SENSITIVE_SOURCE_QUERY_KEY.test(key)) throw sourceUrlError('GOOGLE_SOURCE_URL_SENSITIVE_QUERY_NOT_ALLOWED');
    }
    return canonicalUrl;
};

const sanitizeSourceUrlForRead = (input) => {
    try {
        const url = new URL(canonicalizeUrl(input));
        if (!['https:', 'http:'].includes(url.protocol)) return '';
        url.username = '';
        url.password = '';
        for (const key of [...url.searchParams.keys()]) {
            if (SENSITIVE_SOURCE_QUERY_KEY.test(key)) url.searchParams.delete(key);
        }
        return url.toString();
    } catch (_error) {
        return '';
    }
};

const calculateSnapshotStatus = ({ successfulSources, failedSources, mandatorySourcesSucceeded, changesDetected }) => {
    if (!successfulSources || !mandatorySourcesSucceeded) return 'failed';
    if (failedSources > 0) return 'partial';
    return changesDetected > 0 ? 'completed_with_changes' : 'completed_no_change';
};

const isSnapshotFresh = ({ snapshot, now = new Date(), maxAgeHours = 24 }) => {
    const checkedAt = new Date(snapshot?.checkedAt || 0).getTime();
    return Number.isFinite(checkedAt) && checkedAt > 0 && now.getTime() - checkedAt <= Number(maxAgeHours || 24) * 60 * 60 * 1000;
};

const isSnapshotAcceptable = ({ snapshot, strictGate = true, maxAgeHours = 24, now = new Date() }) => {
    if (!snapshot || !ACCEPTABLE_STATUSES.has(snapshot.status)) return false;
    if (!isSnapshotFresh({ snapshot, now, maxAgeHours })) return false;
    if (strictGate && snapshot.status !== 'manually_overridden' && !snapshot.mandatorySourcesSucceeded) return false;
    return true;
};

module.exports = {
    ACCEPTABLE_STATUSES,
    DEFAULT_TIMEZONE,
    SENSITIVE_SOURCE_QUERY_KEY,
    assertPersistableSourceUrl,
    calculateSnapshotStatus,
    canonicalizeUrl,
    dateInTimezone,
    isPrivateIp,
    isSnapshotAcceptable,
    isSnapshotFresh,
    sanitizeSourceUrlForRead
};
