'use strict';

const crypto = require('node:crypto');
const UserSession = require('../models/userSession.model');
const UserEvent = require('../models/userEvent.model');
const userModel = require('../models/user.model');
const { convertToObjectIdMongodb } = require('../utils');

const ALLOWED_EVENT_TYPES = new Set([
    'page_view',
    'product_view',
    'blog_view',
    'click',
    'scroll',
    'heartbeat',
    'page_leave',
    'session_end'
]);

const ACTIVE_TIME_EVENT_TYPES = new Set(['heartbeat', 'page_leave', 'session_end']);
const EVENT_BATCH_LIMIT = 25;
const MAX_TEXT_LEN = 240;
const MAX_URL_LEN = 1000;
const MAX_PATH_LEN = 300;
const MAX_IP_HISTORY = 8;
const MAX_VISITED_PATHS = 60;
const MAX_VIEWED_PRODUCTS = 60;
const MAX_RECENT_CLICKS = 40;
const MAX_DURATION_MS_PER_EVENT = 10 * 60 * 1000;
const ANONYMOUS_MAPPING_IP_LOOKBACK_HOURS = 24;
const ANONYMOUS_MAPPING_MAX_SESSIONS = 4;
const MAX_USER_TELEMETRY_SOURCES = 10;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const toStringOrNull = (value, { maxLength = MAX_TEXT_LEN } = {}) => {
    if (value == null) return null;
    const normalized = String(value).trim();
    if (!normalized) return null;
    return normalized.slice(0, maxLength);
};

const toNumberOrNull = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const toDateOrNow = (value) => {
    if (!value) return new Date();
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return new Date();
    const now = Date.now();
    const min = now - 1000 * 60 * 60 * 24 * 30;
    const max = now + 1000 * 60 * 10;
    if (date.getTime() < min || date.getTime() > max) return new Date();
    return date;
};

const sanitizeSessionId = (value) => {
    const raw = toStringOrNull(value, { maxLength: 120 });
    if (!raw) return null;
    const cleaned = raw.replace(/[^a-zA-Z0-9._:-]/g, '').slice(0, 120);
    return cleaned || null;
};

const generateSessionId = () => {
    if (typeof crypto.randomUUID === 'function') {
        return `sid_${crypto.randomUUID()}`;
    }
    return `sid_${crypto.randomBytes(16).toString('hex')}`;
};

const sanitizePath = (value) => {
    const pathValue = toStringOrNull(value, { maxLength: MAX_PATH_LEN });
    if (!pathValue) return null;
    const normalized = pathValue.startsWith('/') ? pathValue : `/${pathValue}`;
    return normalized.slice(0, MAX_PATH_LEN);
};

const sanitizeUrl = (value) => toStringOrNull(value, { maxLength: MAX_URL_LEN });

const sanitizeLocale = (value) => {
    const raw = toStringOrNull(value, { maxLength: 16 });
    if (!raw) return null;
    const lower = raw.toLowerCase();
    if (lower.startsWith('vi')) return 'vi';
    if (lower.startsWith('en')) return 'en';
    return lower;
};

const sanitizeIp = (value) => toStringOrNull(value, { maxLength: 80 });
const sanitizeUserAgent = (value) => toStringOrNull(value, { maxLength: 500 });
const sanitizeReferrer = (value) => sanitizeUrl(value);

const extractHostname = (value) => {
    const raw = toStringOrNull(value, { maxLength: MAX_URL_LEN });
    if (!raw) return null;
    try {
        const normalized = raw.startsWith('http://') || raw.startsWith('https://')
            ? raw
            : `https://${raw}`;
        const hostname = new URL(normalized).hostname || '';
        return toStringOrNull(hostname.replace(/^www\./i, ''), { maxLength: 120 });
    } catch {
        return null;
    }
};

const normalizeEventType = (value) => {
    const raw = toStringOrNull(value, { maxLength: 32 });
    if (!raw) return null;
    const normalized = raw.toLowerCase().replace(/[^a-z0-9_:-]/g, '_');
    if (!ALLOWED_EVENT_TYPES.has(normalized)) return null;
    return normalized;
};

const toObjectIdOrNull = (value) => {
    const objectId = convertToObjectIdMongodb(value);
    return objectId || null;
};

const inferPathParts = (path) => {
    const normalizedPath = sanitizePath(path);
    if (!normalizedPath) return null;
    const productMatch = normalizedPath.match(/^\/product\/([^/?#]+)/i);
    if (productMatch) {
        return { productSlug: decodeURIComponent(productMatch[1]) };
    }
    const blogMatch = normalizedPath.match(/^\/blog\/([^/?#]+)/i);
    if (blogMatch) {
        return { blogSlug: decodeURIComponent(blogMatch[1]) };
    }
    return null;
};

const extractBlogSlugFromPath = (path) => {
    const normalizedPath = sanitizePath(path);
    if (!normalizedPath) return null;
    const match = normalizedPath.match(/^\/blog\/([^/?#]+)/i);
    if (!match) return null;
    try {
        return decodeURIComponent(match[1]);
    } catch {
        return match[1];
    }
};

const sanitizeMeta = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const output = {};
    for (const [key, raw] of Object.entries(value).slice(0, 20)) {
        const safeKey = toStringOrNull(key, { maxLength: 64 });
        if (!safeKey || raw == null) continue;
        if (typeof raw === 'boolean') {
            output[safeKey] = raw;
            continue;
        }
        if (typeof raw === 'number') {
            if (Number.isFinite(raw)) output[safeKey] = raw;
            continue;
        }
        output[safeKey] = toStringOrNull(raw, { maxLength: 200 });
    }
    return output;
};

const ensureArray = (value) => (Array.isArray(value) ? value : []);
const trimArray = (list, max) => (Array.isArray(list) && list.length > max ? list.slice(0, max) : list);
const uniqueStrings = (values = [], max = MAX_USER_TELEMETRY_SOURCES) => {
    const output = [];
    for (const value of ensureArray(values)) {
        const normalized = toStringOrNull(value, { maxLength: 180 });
        if (!normalized || output.includes(normalized)) continue;
        output.push(normalized);
        if (output.length >= max) break;
    }
    return output;
};

const sanitizeClickPayload = (click, fallbackPath) => {
    const source = click && typeof click === 'object' ? click : {};
    const href = sanitizeUrl(source.href);
    const inferred = inferPathParts(href || fallbackPath);
    return {
        label: toStringOrNull(source.label),
        href,
        element: toStringOrNull(source.element, { maxLength: 64 }),
        trackName: toStringOrNull(source.trackName, { maxLength: 80 }),
        trackSection: toStringOrNull(source.trackSection, { maxLength: 80 }),
        productId: toObjectIdOrNull(source.productId),
        productSlug: toStringOrNull(source.productSlug || inferred?.productSlug, { maxLength: 160 }),
        productName: toStringOrNull(source.productName, { maxLength: 180 }),
        blogSlug: toStringOrNull(source.blogSlug || inferred?.blogSlug, { maxLength: 160 })
    };
};

const sanitizeProductPayload = (product, fallbackPath) => {
    const source = product && typeof product === 'object' ? product : {};
    const inferred = inferPathParts(fallbackPath);
    return {
        productId: toObjectIdOrNull(source.productId),
        slug: toStringOrNull(source.slug || inferred?.productSlug, { maxLength: 160 }),
        name: toStringOrNull(source.name, { maxLength: 180 })
    };
};

const sanitizeEvent = (input, context = {}) => {
    const source = input && typeof input === 'object' ? input : {};
    const type = normalizeEventType(source.type);
    if (!type) return null;

    const path = sanitizePath(source.path || context.path);
    const scrollDepthRaw = toNumberOrNull(source.scrollDepthPercent);
    const scrollDepthPercent =
        scrollDepthRaw == null ? null : clamp(Math.round(scrollDepthRaw), 0, 100);
    const durationMsRaw = toNumberOrNull(source.durationMs);
    const durationMs =
        durationMsRaw == null ? 0 : clamp(Math.round(durationMsRaw), 0, MAX_DURATION_MS_PER_EVENT);
    const occurredAt = toDateOrNow(source.occurredAt || source.timestamp);

    const product = type === 'product_view' ? sanitizeProductPayload(source.product, path) : null;
    const click = type === 'click' ? sanitizeClickPayload(source.click, path) : null;

    return {
        type,
        occurredAt,
        path,
        url: sanitizeUrl(source.url),
        title: toStringOrNull(source.title, { maxLength: 200 }),
        referrer: sanitizeReferrer(source.referrer || context.referrer),
        locale: sanitizeLocale(source.locale || context.locale),
        scrollDepthPercent,
        durationMs: ACTIVE_TIME_EVENT_TYPES.has(type) ? durationMs : 0,
        product:
            product && (product.productId || product.slug || product.name)
                ? { productId: product.productId, slug: product.slug, name: product.name }
                : null,
        click:
            click &&
            (click.label ||
                click.href ||
                click.trackName ||
                click.productId ||
                click.productSlug ||
                click.blogSlug)
                ? click
                : null,
        meta: sanitizeMeta(source.meta)
    };
};

class TelemetryService {
    static resolveSessionId(input) {
        return sanitizeSessionId(input) || generateSessionId();
    }

    static async touchSession(context = {}) {
        const now = new Date();
        const sessionId = this.resolveSessionId(context.sessionId);
        const userId = toObjectIdOrNull(context.userId);
        const ip = sanitizeIp(context.ip);
        const userAgent = sanitizeUserAgent(context.userAgent);
        const locale = sanitizeLocale(context.locale);
        const referrer = sanitizeReferrer(context.referrer);
        const timezoneOffsetMinutes = toNumberOrNull(context.timezoneOffsetMinutes);
        const path = sanitizePath(context.path);

        const existing = await UserSession.findOne({ sessionId });
        const sessionDoc =
            existing ||
            new UserSession({
                sessionId,
                firstSeenAt: now,
                lastSeenAt: now,
                startedAnonymous: !Boolean(userId)
            });

        if (!sessionDoc.firstSeenAt) sessionDoc.firstSeenAt = now;
        sessionDoc.lastSeenAt = now;
        sessionDoc.status = 'active';
        if (ip) {
            if (!sessionDoc.firstIp) sessionDoc.firstIp = ip;
            sessionDoc.lastIp = ip;
            const ipHistory = ensureArray(sessionDoc.ipHistory);
            if (!ipHistory.includes(ip)) {
                sessionDoc.ipHistory = trimArray([ip, ...ipHistory], MAX_IP_HISTORY);
            } else {
                sessionDoc.ipHistory = [ip, ...ipHistory.filter((item) => item !== ip)].slice(
                    0,
                    MAX_IP_HISTORY
                );
            }
        }
        if (userAgent) sessionDoc.userAgent = userAgent;
        if (locale) sessionDoc.locale = locale;
        if (referrer) sessionDoc.referrer = referrer;
        if (path) sessionDoc.lastPath = path;
        if (timezoneOffsetMinutes != null) {
            sessionDoc.timezoneOffsetMinutes = clamp(Math.round(timezoneOffsetMinutes), -840, 840);
        }
        if (userId && !sessionDoc.user) {
            sessionDoc.user = userId;
            if (sessionDoc.startedAnonymous !== false && !sessionDoc.mappedUserAt) {
                sessionDoc.mappedUserAt = now;
                sessionDoc.mappedUserStrategy = 'session';
                sessionDoc.mappingConfidence = 'high';
                sessionDoc.mappedFromSessionId = sessionId;
                if (ip) sessionDoc.mappedFromIp = ip;
            }
        }
        if (typeof sessionDoc.startedAnonymous !== 'boolean') {
            sessionDoc.startedAnonymous = !Boolean(sessionDoc.user || userId);
        }

        await sessionDoc.save();

        if (userId) {
            await UserEvent.updateMany({ sessionId, user: null }, { $set: { user: userId } }).catch(
                () => null
            );
        }

        return {
            sessionId,
            sessionDoc,
            userId,
            ip,
            userAgent,
            locale,
            referrer
        };
    }

    static applyPathSummary(sessionDoc, path, occurredAt) {
        const normalizedPath = sanitizePath(path);
        if (!normalizedPath) return;
        const list = ensureArray(sessionDoc.visitedPaths);
        const found = list.find((item) => item?.path === normalizedPath);
        if (found) {
            found.count = (Number(found.count) || 0) + 1;
            found.lastSeenAt = occurredAt;
        } else {
            list.unshift({
                path: normalizedPath,
                count: 1,
                lastSeenAt: occurredAt
            });
        }
        list.sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime());
        sessionDoc.visitedPaths = trimArray(list, MAX_VISITED_PATHS);
    }

    static applyViewedProduct(sessionDoc, product, occurredAt) {
        if (!product) return;
        const productId = toObjectIdOrNull(product.productId);
        const slug = toStringOrNull(product.slug, { maxLength: 160 });
        const name = toStringOrNull(product.name, { maxLength: 180 });
        if (!productId && !slug && !name) return;

        const list = ensureArray(sessionDoc.viewedProducts);
        const found = list.find((item) => {
            if (productId && item?.productId && String(item.productId) === String(productId)) return true;
            if (slug && item?.slug && item.slug === slug) return true;
            return false;
        });

        if (found) {
            found.count = (Number(found.count) || 0) + 1;
            if (!found.firstViewedAt) found.firstViewedAt = occurredAt;
            found.lastViewedAt = occurredAt;
            if (slug && !found.slug) found.slug = slug;
            if (name && !found.name) found.name = name;
            if (productId && !found.productId) found.productId = productId;
        } else {
            list.unshift({
                productId,
                slug,
                name,
                count: 1,
                firstViewedAt: occurredAt,
                lastViewedAt: occurredAt
            });
        }

        list.sort((a, b) => {
            const countDiff = (Number(b.count) || 0) - (Number(a.count) || 0);
            if (countDiff) return countDiff;
            return new Date(b.lastViewedAt).getTime() - new Date(a.lastViewedAt).getTime();
        });
        sessionDoc.viewedProducts = trimArray(list, MAX_VIEWED_PRODUCTS);
    }

    static applyRecentClick(sessionDoc, click, path, occurredAt) {
        if (!click) return;
        const label = toStringOrNull(click.label);
        const href = sanitizeUrl(click.href);
        const trackName = toStringOrNull(click.trackName, { maxLength: 80 });
        const productId = toObjectIdOrNull(click.productId);
        const productSlug = toStringOrNull(click.productSlug, { maxLength: 160 });
        const productName = toStringOrNull(click.productName, { maxLength: 180 });
        if (!label && !href && !trackName && !productSlug && !click.blogSlug) return;

        const list = ensureArray(sessionDoc.recentClicks);
        list.unshift({
            label,
            href,
            trackName,
            path: sanitizePath(path),
            productId,
            productSlug,
            productName,
            at: occurredAt
        });
        sessionDoc.recentClicks = trimArray(list, MAX_RECENT_CLICKS);
    }

    static applyEventToSession(sessionDoc, event, context = {}) {
        const occurredAt = event.occurredAt instanceof Date ? event.occurredAt : new Date();
        sessionDoc.lastSeenAt = occurredAt;
        sessionDoc.lastEventAt = occurredAt;
        sessionDoc.lastEventType = event.type;
        if (event.path) sessionDoc.lastPath = event.path;
        if (context.ip) {
            if (!sessionDoc.firstIp) sessionDoc.firstIp = context.ip;
            sessionDoc.lastIp = context.ip;
        }
        if (context.userAgent) sessionDoc.userAgent = context.userAgent;
        if (event.locale) sessionDoc.locale = event.locale;
        if (event.referrer && !sessionDoc.referrer) sessionDoc.referrer = event.referrer;

        sessionDoc.eventCount = (Number(sessionDoc.eventCount) || 0) + 1;

        if (event.type === 'page_view') {
            sessionDoc.pageViewCount = (Number(sessionDoc.pageViewCount) || 0) + 1;
        }
        if (event.type === 'product_view') {
            sessionDoc.productViewCount = (Number(sessionDoc.productViewCount) || 0) + 1;
            this.applyViewedProduct(sessionDoc, event.product, occurredAt);
        }
        if (event.type === 'blog_view') {
            sessionDoc.blogViewCount = (Number(sessionDoc.blogViewCount) || 0) + 1;
        }
        if (event.type === 'click') {
            sessionDoc.clickCount = (Number(sessionDoc.clickCount) || 0) + 1;
            this.applyRecentClick(sessionDoc, event.click, event.path, occurredAt);
            if (event.click?.productId || event.click?.productSlug || event.click?.productName) {
                this.applyViewedProduct(
                    sessionDoc,
                    {
                        productId: event.click.productId,
                        slug: event.click.productSlug,
                        name: event.click.productName
                    },
                    occurredAt
                );
            }
        }
        if (event.type === 'scroll') {
            sessionDoc.scrollEventCount = (Number(sessionDoc.scrollEventCount) || 0) + 1;
        }
        if (ACTIVE_TIME_EVENT_TYPES.has(event.type) && event.durationMs > 0) {
            sessionDoc.totalActiveMs = (Number(sessionDoc.totalActiveMs) || 0) + event.durationMs;
        }
        if (event.scrollDepthPercent != null) {
            sessionDoc.maxScrollDepthPercent = Math.max(
                Number(sessionDoc.maxScrollDepthPercent) || 0,
                clamp(Number(event.scrollDepthPercent) || 0, 0, 100)
            );
        }
        if (event.path) {
            this.applyPathSummary(sessionDoc, event.path, occurredAt);
        }
        if (event.type === 'session_end') {
            sessionDoc.status = 'ended';
            sessionDoc.endedAt = occurredAt;
        }
    }

    static async captureEvents({ sessionContext = {}, events = [] } = {}) {
        const batch = ensureArray(events).slice(0, EVENT_BATCH_LIMIT);
        const touched = sessionContext.sessionDoc
            ? {
                sessionId: sessionContext.sessionId,
                sessionDoc: sessionContext.sessionDoc,
                userId: toObjectIdOrNull(sessionContext.userId),
                ip: sanitizeIp(sessionContext.ip),
                userAgent: sanitizeUserAgent(sessionContext.userAgent),
                locale: sanitizeLocale(sessionContext.locale),
                referrer: sanitizeReferrer(sessionContext.referrer)
            }
            : await this.touchSession(sessionContext);

        const normalizedEvents = batch
            .map((entry) =>
                sanitizeEvent(entry, {
                    path: sessionContext.path,
                    locale: touched.locale || sessionContext.locale,
                    referrer: touched.referrer || sessionContext.referrer
                })
            )
            .filter(Boolean);

        if (!normalizedEvents.length) {
            return {
                accepted: 0,
                sessionId: touched.sessionId
            };
        }

        const eventDocs = normalizedEvents.map((event) => ({
            sessionId: touched.sessionId,
            user: touched.userId || null,
            type: event.type,
            occurredAt: event.occurredAt,
            path: event.path,
            url: event.url,
            title: event.title,
            referrer: event.referrer,
            locale: event.locale,
            scrollDepthPercent: event.scrollDepthPercent,
            durationMs: event.durationMs,
            product: event.product,
            click: event.click,
            meta: event.meta,
            ip: touched.ip || null,
            userAgent: touched.userAgent || null
        }));

        await UserEvent.insertMany(eventDocs, { ordered: false }).catch((error) => {
            if (error?.writeErrors?.length) return;
            throw error;
        });

        const sessionDoc =
            touched.sessionDoc ||
            (await UserSession.findOne({ sessionId: touched.sessionId })) ||
            new UserSession({ sessionId: touched.sessionId });

        if (touched.userId && !sessionDoc.user) {
            sessionDoc.user = touched.userId;
        }

        normalizedEvents.forEach((event) => this.applyEventToSession(sessionDoc, event, touched));
        await sessionDoc.save();

        return {
            accepted: normalizedEvents.length,
            sessionId: touched.sessionId,
            lastEventAt: normalizedEvents[normalizedEvents.length - 1]?.occurredAt || null
        };
    }

    static async mapAnonymousTelemetryToUser({
        userId,
        sessionId,
        ip,
        userAgent,
        authEvent = 'first_login',
        allowIpFallback = true
    } = {}) {
        const userObjectId = convertToObjectIdMongodb(userId);
        if (!userObjectId) {
            return {
                mapped: false,
                reason: 'invalid_user',
                sessionIds: [],
                mappedSessionsCount: 0,
                mappedEventsCount: 0
            };
        }

        const normalizedSessionId = sanitizeSessionId(sessionId);
        const normalizedIp = sanitizeIp(ip);
        const normalizedUserAgent = sanitizeUserAgent(userAgent);
        const now = new Date();
        const ipLookbackCutoff = new Date(
            Date.now() - ANONYMOUS_MAPPING_IP_LOOKBACK_HOURS * 60 * 60 * 1000
        );

        const candidates = [];

        if (normalizedSessionId) {
            const exactSession = await UserSession.findOne({ sessionId: normalizedSessionId }).lean();
            if (exactSession?.user && String(exactSession.user) === String(userObjectId)) {
                return {
                    mapped: false,
                    reason: 'already_mapped_to_same_user',
                    sessionIds: [normalizedSessionId],
                    mappedSessionsCount: 0,
                    mappedEventsCount: 0
                };
            }
            if (exactSession?.user && String(exactSession.user) !== String(userObjectId)) {
                return {
                    mapped: false,
                    reason: 'session_already_mapped_to_other_user',
                    sessionIds: [normalizedSessionId],
                    mappedSessionsCount: 0,
                    mappedEventsCount: 0
                };
            }
            if (exactSession && !exactSession.user) {
                const ipMatches =
                    normalizedIp &&
                    [exactSession.lastIp, exactSession.firstIp, ...ensureArray(exactSession.ipHistory)].includes(
                        normalizedIp
                    );
                candidates.push({
                    sessionId: exactSession.sessionId,
                    strategy: ipMatches ? 'session+ip' : 'session',
                    confidence: 'high'
                });
            }
        }

        if (!candidates.length && allowIpFallback && normalizedIp) {
            const rawIpCandidates = await UserSession.find({
                user: null,
                lastSeenAt: { $gte: ipLookbackCutoff },
                $or: [{ lastIp: normalizedIp }, { firstIp: normalizedIp }, { ipHistory: normalizedIp }]
            })
                .sort({ lastSeenAt: -1 })
                .limit(ANONYMOUS_MAPPING_MAX_SESSIONS * 4)
                .lean();

            const withEvents = rawIpCandidates.filter((doc) => (Number(doc?.eventCount) || 0) > 0);
            let filtered = withEvents;

            if (normalizedUserAgent) {
                const exactUa = withEvents.filter(
                    (doc) =>
                        sanitizeUserAgent(doc?.userAgent) &&
                        sanitizeUserAgent(doc.userAgent) === normalizedUserAgent
                );
                if (exactUa.length) {
                    filtered = exactUa;
                }
            }

            filtered = filtered
                .filter((doc) => {
                    const sessionLastSeen = doc?.lastSeenAt ? new Date(doc.lastSeenAt) : null;
                    if (!sessionLastSeen || Number.isNaN(sessionLastSeen.getTime())) return false;
                    return sessionLastSeen >= ipLookbackCutoff;
                })
                .slice(0, normalizedUserAgent ? ANONYMOUS_MAPPING_MAX_SESSIONS : 1);

            if (filtered.length <= ANONYMOUS_MAPPING_MAX_SESSIONS) {
                filtered.forEach((doc) => {
                    candidates.push({
                        sessionId: doc.sessionId,
                        strategy: 'ip',
                        confidence: normalizedUserAgent ? 'high' : 'medium'
                    });
                });
            }
        }

        const uniqueCandidates = [];
        for (const candidate of candidates) {
            if (!candidate?.sessionId) continue;
            if (uniqueCandidates.some((item) => item.sessionId === candidate.sessionId)) continue;
            uniqueCandidates.push(candidate);
        }

        if (!uniqueCandidates.length) {
            return {
                mapped: false,
                reason: 'no_anonymous_sessions',
                sessionIds: [],
                mappedSessionsCount: 0,
                mappedEventsCount: 0
            };
        }

        const sessionIdList = uniqueCandidates.map((item) => item.sessionId);
        const sessionsToMap = await UserSession.find({
            sessionId: { $in: sessionIdList },
            user: null
        }).select({ _id: 1, sessionId: 1, lastIp: 1, firstIp: 1 });

        if (!sessionsToMap.length) {
            return {
                mapped: false,
                reason: 'sessions_already_identified',
                sessionIds: sessionIdList,
                mappedSessionsCount: 0,
                mappedEventsCount: 0
            };
        }

        const candidateById = new Map(uniqueCandidates.map((item) => [item.sessionId, item]));
        const sessionIdsUpdated = [];

        if (sessionsToMap.length) {
            const ops = sessionsToMap.map((doc) => {
                const candidate = candidateById.get(doc.sessionId) || {};
                sessionIdsUpdated.push(doc.sessionId);
                return {
                    updateOne: {
                        filter: { _id: doc._id, user: null },
                        update: {
                            $set: {
                                user: userObjectId,
                                mappedUserAt: now,
                                mappedUserStrategy: candidate.strategy || 'ip',
                                mappedByAuthEvent:
                                    authEvent === 'signup' ? 'signup' : 'first_login',
                                mappedFromIp: normalizedIp || doc.lastIp || doc.firstIp || null,
                                mappedFromSessionId: normalizedSessionId || doc.sessionId || null,
                                mappingConfidence: candidate.confidence || 'medium'
                            }
                        }
                    }
                };
            });
            if (ops.length) {
                await UserSession.bulkWrite(ops, { ordered: false });
            }
        }

        const eventUpdate = await UserEvent.updateMany(
            { sessionId: { $in: sessionIdsUpdated }, user: null },
            { $set: { user: userObjectId } }
        );

        const mappedEventsCount = Number(eventUpdate?.modifiedCount) || 0;
        const mappedSessionsCount = sessionIdsUpdated.length;

        const userDoc = await userModel.findById(userObjectId).select({ telemetryIdentity: 1 });
        if (userDoc) {
            const identity = userDoc.telemetryIdentity || {};
            const sourceIps = uniqueStrings([
                normalizedIp,
                ...(normalizedIp ? [normalizedIp] : []),
                ...ensureArray(identity.sourceIps)
            ]);
            const sourceSessionIds = uniqueStrings([
                ...sessionIdsUpdated,
                ...ensureArray(identity.sourceSessionIds)
            ]);

            userDoc.telemetryIdentity = {
                ...identity,
                firstMappedAt: identity.firstMappedAt || now,
                lastMappedAt: now,
                lastMappedIp: normalizedIp || identity.lastMappedIp || null,
                lastMappedSessionId:
                    normalizedSessionId || sessionIdsUpdated[0] || identity.lastMappedSessionId || null,
                lastMappedStrategy:
                    candidateById.get(normalizedSessionId)?.strategy ||
                    uniqueCandidates[0]?.strategy ||
                    identity.lastMappedStrategy ||
                    null,
                mappedSessionsCount: (Number(identity.mappedSessionsCount) || 0) + mappedSessionsCount,
                mappedEventsCount: (Number(identity.mappedEventsCount) || 0) + mappedEventsCount,
                sourceIps,
                sourceSessionIds
            };
            userDoc.markModified('telemetryIdentity');
            await userDoc.save();
        }

        return {
            mapped: mappedSessionsCount > 0,
            reason: mappedSessionsCount > 0 ? 'mapped' : 'no_updates',
            sessionIds: sessionIdsUpdated,
            mappedSessionsCount,
            mappedEventsCount,
            strategy:
                uniqueCandidates.find((item) => item.sessionId === normalizedSessionId)?.strategy ||
                uniqueCandidates[0]?.strategy ||
                null
        };
    }

    static async getUserListTelemetryMeta({ userIds = [] } = {}) {
        const normalizedIds = Array.from(
            new Set(
                ensureArray(userIds)
                    .map((value) => convertToObjectIdMongodb(value))
                    .filter(Boolean)
                    .map((value) => String(value))
            )
        );

        if (!normalizedIds.length) return {};

        const objectIds = normalizedIds.map((value) => convertToObjectIdMongodb(value)).filter(Boolean);
        const rows = await UserSession.aggregate([
            { $match: { user: { $in: objectIds } } },
            { $sort: { lastSeenAt: -1 } },
            {
                $group: {
                    _id: '$user',
                    latestSessionId: { $first: '$sessionId' },
                    lastSeenAt: { $first: '$lastSeenAt' },
                    lastIp: { $first: '$lastIp' },
                    firstIp: { $first: '$firstIp' },
                    totalSessions: { $sum: 1 },
                    anonymousMappedSessions: {
                        $sum: { $cond: [{ $ne: ['$mappedUserAt', null] }, 1, 0] }
                    },
                    lastMappedAt: { $max: '$mappedUserAt' },
                    totalActiveMs: { $sum: { $ifNull: ['$totalActiveMs', 0] } }
                }
            }
        ]);

        return rows.reduce((acc, row) => {
            const key = row?._id ? String(row._id) : null;
            if (!key) return acc;
            acc[key] = {
                sessionId: row.latestSessionId || null,
                lastSeenAt: row.lastSeenAt || null,
                lastIp: row.lastIp || row.firstIp || null,
                totalSessions: Number(row.totalSessions) || 0,
                anonymousMappedSessions: Number(row.anonymousMappedSessions) || 0,
                lastMappedAt: row.lastMappedAt || null,
                totalActiveMs: Number(row.totalActiveMs) || 0
            };
            return acc;
        }, {});
    }

    static normalizeAnonymousVisitorListItem(sessionDoc) {
        if (!sessionDoc) return null;
        const user = sessionDoc.user && typeof sessionDoc.user === 'object' ? sessionDoc.user : null;
        return {
            sessionId: sessionDoc.sessionId || null,
            startedAnonymous:
                typeof sessionDoc.startedAnonymous === 'boolean'
                    ? sessionDoc.startedAnonymous
                    : Boolean(sessionDoc.mappedUserAt || !sessionDoc.user),
            status: sessionDoc.status || 'active',
            firstSeenAt: sessionDoc.firstSeenAt || null,
            lastSeenAt: sessionDoc.lastSeenAt || null,
            endedAt: sessionDoc.endedAt || null,
            firstIp: sessionDoc.firstIp || null,
            lastIp: sessionDoc.lastIp || null,
            ipHistory: ensureArray(sessionDoc.ipHistory).slice(0, MAX_IP_HISTORY),
            userAgent: sessionDoc.userAgent || null,
            locale: sessionDoc.locale || null,
            lastPath: sessionDoc.lastPath || null,
            lastEventType: sessionDoc.lastEventType || null,
            eventCount: Number(sessionDoc.eventCount) || 0,
            pageViewCount: Number(sessionDoc.pageViewCount) || 0,
            productViewCount: Number(sessionDoc.productViewCount) || 0,
            blogViewCount: Number(sessionDoc.blogViewCount) || 0,
            clickCount: Number(sessionDoc.clickCount) || 0,
            scrollEventCount: Number(sessionDoc.scrollEventCount) || 0,
            totalActiveMs: Number(sessionDoc.totalActiveMs) || 0,
            totalTimeSeconds: Math.round((Number(sessionDoc.totalActiveMs) || 0) / 1000),
            maxScrollDepthPercent: clamp(
                Math.round(Number(sessionDoc.maxScrollDepthPercent) || 0),
                0,
                100
            ),
            mappedUserAt: sessionDoc.mappedUserAt || null,
            mappedUserStrategy: sessionDoc.mappedUserStrategy || null,
            mappedByAuthEvent: sessionDoc.mappedByAuthEvent || null,
            mappedFromIp: sessionDoc.mappedFromIp || null,
            mappedFromSessionId: sessionDoc.mappedFromSessionId || null,
            mappingConfidence: sessionDoc.mappingConfidence || null,
            user: user
                ? {
                    _id: user._id ? String(user._id) : null,
                    name: user.name || null,
                    email: user.email || null,
                    status: user.status || null,
                    loginCount: Number(user.loginCount) || 0
                }
                : null
        };
    }

    static async listAnonymousVisitors({ page = 1, limit = 20, mapped = '' } = {}) {
        const normalizedPage = Math.max(Number(page) || 1, 1);
        const normalizedLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
        const skip = (normalizedPage - 1) * normalizedLimit;
        const mappedFilter = String(mapped || '').trim().toLowerCase();

        const filter = {
            eventCount: { $gt: 0 },
            $or: [{ startedAnonymous: true }, { user: null }, { mappedUserAt: { $ne: null } }]
        };

        if (mappedFilter === 'mapped') {
            filter.user = { $ne: null };
            filter.mappedUserAt = { $ne: null };
        } else if (mappedFilter === 'unmapped') {
            filter.user = null;
        }

        const [items, total] = await Promise.all([
            UserSession.find(filter)
                .sort({ lastSeenAt: -1, _id: -1 })
                .skip(skip)
                .limit(normalizedLimit)
                .populate({
                    path: 'user',
                    select:
                        '_id name email status loginCount firstLoginAt lastLoginAt lastLoginIp telemetryIdentity'
                })
                .lean(),
            UserSession.countDocuments(filter)
        ]);

        const totalPages = Math.max(Math.ceil(total / normalizedLimit), 1);
        return {
            items: ensureArray(items)
                .map((doc) => this.normalizeAnonymousVisitorListItem(doc))
                .filter(Boolean),
            pagination: {
                page: normalizedPage,
                limit: normalizedLimit,
                total,
                totalPages,
                hasPrevPage: normalizedPage > 1,
                hasNextPage: normalizedPage < totalPages
            },
            filters: {
                mapped:
                    mappedFilter === 'mapped' || mappedFilter === 'unmapped' ? mappedFilter : ''
            }
        };
    }

    static async getAnonymousVisitorDetail({ sessionId }) {
        const normalizedSessionId = sanitizeSessionId(sessionId);
        if (!normalizedSessionId) return null;

        const sessionDoc = await UserSession.findOne({ sessionId: normalizedSessionId })
            .populate({
                path: 'user',
                select:
                    '_id name email status loginCount firstLoginAt lastLoginAt lastLoginIp telemetryIdentity'
            })
            .lean();
        if (!sessionDoc) return null;

        const isAnonymousVisitor =
            sessionDoc.startedAnonymous === true ||
            sessionDoc.user == null ||
            sessionDoc.mappedUserAt != null;
        if (!isAnonymousVisitor) return null;

        const since = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30);
        const [recentEvents, dailyTimeAgg] = await Promise.all([
            UserEvent.find({ sessionId: normalizedSessionId })
                .sort({ occurredAt: -1, createdAt: -1 })
                .limit(40)
                .select({
                    _id: 0,
                    type: 1,
                    occurredAt: 1,
                    path: 1,
                    url: 1,
                    scrollDepthPercent: 1,
                    durationMs: 1,
                    click: 1,
                    product: 1,
                    meta: 1
                })
                .lean(),
            UserEvent.aggregate([
                {
                    $match: {
                        sessionId: normalizedSessionId,
                        type: { $in: Array.from(ACTIVE_TIME_EVENT_TYPES) },
                        durationMs: { $gt: 0 },
                        createdAt: { $gte: since }
                    }
                },
                {
                    $addFields: {
                        effectiveAt: { $ifNull: ['$occurredAt', '$createdAt'] }
                    }
                },
                {
                    $group: {
                        _id: {
                            $dateToString: {
                                format: '%Y-%m-%d',
                                date: '$effectiveAt',
                                timezone: 'Asia/Ho_Chi_Minh'
                            }
                        },
                        totalDurationMs: { $sum: { $ifNull: ['$durationMs', 0] } },
                        eventCount: { $sum: 1 }
                    }
                },
                { $sort: { _id: -1 } },
                { $limit: 30 }
            ])
        ]);

        const sessionSummary = this.normalizeAnonymousVisitorListItem(sessionDoc);
        return {
            ...sessionSummary,
            sessionId: normalizedSessionId,
            visitedPaths: ensureArray(sessionDoc.visitedPaths)
                .slice(0, 30)
                .map((item) => ({
                    path: item?.path || null,
                    count: Number(item?.count) || 0,
                    lastSeenAt: item?.lastSeenAt || null
                })),
            viewedProducts: ensureArray(sessionDoc.viewedProducts)
                .slice(0, 25)
                .map((item) => ({
                    productId: item?.productId ? String(item.productId) : null,
                    slug: item?.slug || null,
                    name: item?.name || null,
                    count: Number(item?.count) || 0,
                    firstViewedAt: item?.firstViewedAt || null,
                    lastViewedAt: item?.lastViewedAt || null
                })),
            recentClicks: ensureArray(sessionDoc.recentClicks)
                .slice(0, 25)
                .map((item) => ({
                    at: item?.at || null,
                    path: item?.path || null,
                    label: item?.label || null,
                    href: item?.href || null,
                    trackName: item?.trackName || null,
                    productId: item?.productId ? String(item.productId) : null,
                    productSlug: item?.productSlug || null,
                    productName: item?.productName || null
                })),
            dailyActiveTime: ensureArray(dailyTimeAgg).map((row) => ({
                date: row?._id || null,
                totalDurationMs: Number(row?.totalDurationMs) || 0,
                totalDurationSeconds: Math.round((Number(row?.totalDurationMs) || 0) / 1000),
                totalDurationMinutes: Math.round((Number(row?.totalDurationMs) || 0) / 60000),
                eventCount: Number(row?.eventCount) || 0
            })),
            recentEvents: ensureArray(recentEvents).map((event) => ({
                type: event?.type || null,
                occurredAt: event?.occurredAt || null,
                path: event?.path || null,
                url: event?.url || null,
                scrollDepthPercent:
                    event?.scrollDepthPercent == null
                        ? null
                        : clamp(Math.round(Number(event.scrollDepthPercent) || 0), 0, 100),
                durationMs: Number(event?.durationMs) || 0,
                click: event?.click || null,
                product: event?.product || null,
                meta: event?.meta || {}
            }))
        };
    }

    static async getUserTelemetrySummary({ userId }) {
        const userObjectId = convertToObjectIdMongodb(userId);
        if (!userObjectId) return null;

        const since = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30);

        const [latestSession, totalsAgg, topProductsAgg, recentClicks, dailyTimeAgg] = await Promise.all([
            UserSession.findOne({ user: userObjectId }).sort({ lastSeenAt: -1 }).lean(),
            UserSession.aggregate([
                { $match: { user: userObjectId } },
                {
                    $group: {
                        _id: null,
                        totalSessions: { $sum: 1 },
                        pageViewCount: { $sum: { $ifNull: ['$pageViewCount', 0] } },
                        productViewCount: { $sum: { $ifNull: ['$productViewCount', 0] } },
                        blogViewCount: { $sum: { $ifNull: ['$blogViewCount', 0] } },
                        clickCount: { $sum: { $ifNull: ['$clickCount', 0] } },
                        scrollEventCount: { $sum: { $ifNull: ['$scrollEventCount', 0] } },
                        totalActiveMs: { $sum: { $ifNull: ['$totalActiveMs', 0] } },
                        maxScrollDepthPercent: { $max: { $ifNull: ['$maxScrollDepthPercent', 0] } }
                    }
                }
            ]),
            UserSession.aggregate([
                { $match: { user: userObjectId } },
                { $unwind: { path: '$viewedProducts', preserveNullAndEmptyArrays: false } },
                {
                    $group: {
                        _id: {
                            productId: '$viewedProducts.productId',
                            slug: '$viewedProducts.slug',
                            name: '$viewedProducts.name'
                        },
                        count: { $sum: { $ifNull: ['$viewedProducts.count', 0] } },
                        lastViewedAt: { $max: '$viewedProducts.lastViewedAt' },
                        firstViewedAt: { $min: '$viewedProducts.firstViewedAt' }
                    }
                },
                { $sort: { count: -1, lastViewedAt: -1 } },
                { $limit: 20 },
                {
                    $project: {
                        _id: 0,
                        productId: '$_id.productId',
                        slug: '$_id.slug',
                        name: '$_id.name',
                        count: 1,
                        lastViewedAt: 1,
                        firstViewedAt: 1
                    }
                }
            ]),
            UserEvent.find({ user: userObjectId, type: 'click' })
                .sort({ createdAt: -1 })
                .limit(20)
                .select({ _id: 0, occurredAt: 1, path: 1, click: 1 })
                .lean(),
            UserEvent.aggregate([
                {
                    $match: {
                        user: userObjectId,
                        type: { $in: Array.from(ACTIVE_TIME_EVENT_TYPES) },
                        durationMs: { $gt: 0 },
                        createdAt: { $gte: since }
                    }
                },
                {
                    $addFields: {
                        effectiveAt: { $ifNull: ['$occurredAt', '$createdAt'] }
                    }
                },
                {
                    $group: {
                        _id: {
                            $dateToString: {
                                format: '%Y-%m-%d',
                                date: '$effectiveAt',
                                timezone: 'Asia/Ho_Chi_Minh'
                            }
                        },
                        totalDurationMs: { $sum: { $ifNull: ['$durationMs', 0] } },
                        eventCount: { $sum: 1 }
                    }
                },
                { $sort: { _id: -1 } },
                { $limit: 30 }
            ])
        ]);

        const totals = totalsAgg?.[0] || {};
        const viewedProducts = ensureArray(topProductsAgg)
            .filter((item) => item && (item.productId || item.slug || item.name))
            .map((item) => ({
                productId: item.productId ? String(item.productId) : null,
                slug: item.slug || null,
                name: item.name || null,
                count: Number(item.count) || 0,
                lastViewedAt: item.lastViewedAt || null,
                firstViewedAt: item.firstViewedAt || null
            }));

        const recommendedProducts = viewedProducts.slice(0, 6).map((item, index) => ({
            ...item,
            priority: index + 1,
            reason:
                index === 0
                    ? 'Most viewed recently'
                    : item.count >= 3
                        ? 'Repeated interest from this customer'
                        : 'Recently browsed product'
        }));

        const recentClickItems = ensureArray(recentClicks).map((event) => ({
            at: event?.occurredAt || null,
            path: event?.path || null,
            label: event?.click?.label || null,
            href: event?.click?.href || null,
            trackName: event?.click?.trackName || null,
            trackSection: event?.click?.trackSection || null,
            productId: event?.click?.productId ? String(event.click.productId) : null,
            productSlug: event?.click?.productSlug || null,
            productName: event?.click?.productName || null,
            blogSlug: event?.click?.blogSlug || null
        }));

        const dailyActiveTime = ensureArray(dailyTimeAgg).map((row) => ({
            date: row?._id || null,
            totalDurationMs: Number(row?.totalDurationMs) || 0,
            totalDurationSeconds: Math.round((Number(row?.totalDurationMs) || 0) / 1000),
            totalDurationMinutes: Math.round((Number(row?.totalDurationMs) || 0) / 60000),
            eventCount: Number(row?.eventCount) || 0
        }));

        return {
            totalSessions: Number(totals.totalSessions) || 0,
            pageViewCount: Number(totals.pageViewCount) || 0,
            productViewCount: Number(totals.productViewCount) || 0,
            blogViewCount: Number(totals.blogViewCount) || 0,
            clickCount: Number(totals.clickCount) || 0,
            scrollEventCount: Number(totals.scrollEventCount) || 0,
            totalActiveMs: Number(totals.totalActiveMs) || 0,
            totalTimeSeconds: Math.round((Number(totals.totalActiveMs) || 0) / 1000),
            maxScrollDepthPercent: clamp(Math.round(Number(totals.maxScrollDepthPercent) || 0), 0, 100),
            lastSeenAt: latestSession?.lastSeenAt || null,
            lastIp: latestSession?.lastIp || latestSession?.firstIp || null,
            sessionId: latestSession?.sessionId || null,
            viewedProducts,
            recommendedProducts,
            recentClicks: recentClickItems,
            dailyActiveTime,
            visitedPaths: ensureArray(latestSession?.visitedPaths)
                .slice(0, 15)
                .map((item) => ({
                    path: item?.path || null,
                    count: Number(item?.count) || 0,
                    lastSeenAt: item?.lastSeenAt || null
                }))
        };
    }

    static async deleteUserTelemetry({ userId }) {
        const userObjectId = convertToObjectIdMongodb(userId);
        if (!userObjectId) return { deletedSessions: 0, deletedEvents: 0 };
        const [sessionsResult, eventsResult] = await Promise.all([
            UserSession.deleteMany({ user: userObjectId }),
            UserEvent.deleteMany({ user: userObjectId })
        ]);
        return {
            deletedSessions: Number(sessionsResult?.deletedCount) || 0,
            deletedEvents: Number(eventsResult?.deletedCount) || 0
        };
    }
}

module.exports = TelemetryService;
