'use strict';

const TelemetryService = require('../services/telemetry.service');

const HEADER_CANDIDATES = ['cf-connecting-ip', 'x-forwarded-for', 'x-real-ip'];

const readHeader = (req, name) => {
    const value = req.headers?.[name];
    if (Array.isArray(value)) return value[0];
    return value;
};

const resolveClientIp = (req) => {
    for (const header of HEADER_CANDIDATES) {
        const value = readHeader(req, header);
        if (!value) continue;
        const first = String(value).split(',')[0]?.trim();
        if (first) return first;
    }
    const fallback = req.ip || req.socket?.remoteAddress || null;
    if (!fallback) return null;
    return String(fallback);
};

const resolveSessionId = (req) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    return (
        body.sessionId ||
        body.session_id ||
        readHeader(req, 'x-telemetry-session-id') ||
        req.query?.sessionId ||
        null
    );
};

const resolveRequestPath = (req) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const firstEvent = Array.isArray(body.events) ? body.events[0] : body.event;
    if (firstEvent && typeof firstEvent === 'object') {
        return firstEvent.path || firstEvent.pathname || null;
    }
    return body.path || body.pathname || null;
};

const telemetrySessionMiddleware = async (req, res, next) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const baseContext = {
        sessionId: resolveSessionId(req),
        userId: body.userId || readHeader(req, 'x-telemetry-user-id') || null,
        locale: body.locale || body.client?.locale || null,
        referrer: body.referrer || readHeader(req, 'referer') || null,
        timezoneOffsetMinutes:
            body.timezoneOffsetMinutes ??
            body.client?.timezoneOffsetMinutes ??
            body.context?.timezoneOffsetMinutes ??
            null,
        path: resolveRequestPath(req),
        ip: resolveClientIp(req),
        userAgent: readHeader(req, 'user-agent') || null
    };

    req.telemetryContext = baseContext;

    try {
        const touched = await TelemetryService.touchSession(baseContext);
        req.telemetryContext = {
            ...baseContext,
            ...touched,
            userId: touched.userId || baseContext.userId || null
        };
        req.telemetrySession = touched.sessionDoc;
        if (touched?.sessionId) {
            res.setHeader('x-telemetry-session-id', touched.sessionId);
        }
    } catch (error) {
        console.error('[telemetry] touchSession failed:', error?.message || error);
    }

    return next();
};

module.exports = telemetrySessionMiddleware;
