'use strict'

const crypto = require('node:crypto');

const FIVE_MINUTES_MS = 5 * 60 * 1000;

const getHeader = (req, name) => {
    const value = req.headers[name.toLowerCase()];
    if (Array.isArray(value)) return value[0];
    return value;
};

const normalizeSignature = (value) =>
    String(value || '')
        .trim()
        .replace(/^sha256=/i, '')
        .toLowerCase();

const getRawBody = (req) => {
    if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
    if (typeof req.rawBody === 'string') return Buffer.from(req.rawBody);
    return Buffer.alloc(0);
};

const verifyTimingSafe = ({ expectedHex, providedHex }) => {
    const expected = Buffer.from(expectedHex, 'hex');
    const providedIsHex = /^[0-9a-f]+$/i.test(providedHex || '');
    const provided = providedIsHex ? Buffer.from(providedHex, 'hex') : Buffer.alloc(expected.length);
    if (provided.length !== expected.length) {
        crypto.timingSafeEqual(expected, expected);
        return false;
    }
    return crypto.timingSafeEqual(expected, provided);
};

const getClientIp = (req) => {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const ip = forwarded || req.ip || req.socket?.remoteAddress || '';
    return ip.replace(/^::ffff:/, '');
};

const isIpAllowed = (req) => {
    const configured = String(process.env.SEO_AGENT_ALLOWED_IPS || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    if (!configured.length) return true;
    return configured.includes(getClientIp(req));
};

const automationAuth = (req, res, next) => {
    if (process.env.SEO_AGENT_ENABLED !== 'true') {
        return res.status(404).json({ status: 'error', message: 'Not found' });
    }

    const expectedAgentKey = process.env.SEO_AGENT_API_KEY;
    const hmacSecret = process.env.SEO_AGENT_HMAC_SECRET;
    if (!expectedAgentKey || !hmacSecret) {
        return res.status(503).json({
            status: 'error',
            message: 'SEO automation credentials are not configured'
        });
    }

    if (!isIpAllowed(req)) {
        return res.status(403).json({ status: 'error', message: 'IP not allowed' });
    }

    const providedAgentKey = getHeader(req, 'x-seo-agent-key');
    if (!providedAgentKey || providedAgentKey !== expectedAgentKey) {
        return res.status(401).json({ status: 'error', message: 'Invalid automation key' });
    }

    const timestampValue = getHeader(req, 'x-openclaw-timestamp');
    const timestamp = Number(timestampValue);
    if (!Number.isFinite(timestamp)) {
        return res.status(401).json({ status: 'error', message: 'Invalid automation timestamp' });
    }

    const skew = Math.abs(Date.now() - timestamp);
    if (skew > FIVE_MINUTES_MS) {
        return res.status(401).json({ status: 'error', message: 'Automation timestamp expired' });
    }

    const providedSignature = normalizeSignature(getHeader(req, 'x-openclaw-signature'));
    if (!providedSignature) {
        return res.status(401).json({ status: 'error', message: 'Missing automation signature' });
    }

    const expectedSignature = crypto
        .createHmac('sha256', hmacSecret)
        .update(getRawBody(req))
        .digest('hex');

    if (!verifyTimingSafe({ expectedHex: expectedSignature, providedHex: providedSignature })) {
        return res.status(401).json({ status: 'error', message: 'Invalid automation signature' });
    }

    return next();
};

module.exports = {
    FIVE_MINUTES_MS,
    automationAuth,
    getRawBody,
    normalizeSignature,
    verifyTimingSafe
};
