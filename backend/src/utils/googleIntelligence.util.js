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
    calculateSnapshotStatus,
    canonicalizeUrl,
    dateInTimezone,
    isPrivateIp,
    isSnapshotAcceptable,
    isSnapshotFresh
};
