'use strict'

const crypto = require('node:crypto');
const { GoogleIntelligenceSource } = require('../models/googleIntelligenceSource.model');
const { GoogleIntelligenceRun } = require('../models/googleIntelligenceRun.model');
const { GoogleIntelligenceSnapshot } = require('../models/googleIntelligenceSnapshot.model');
const { GoogleIntelligenceChange } = require('../models/googleIntelligenceChange.model');
const { GoogleIntelligenceSchedule } = require('../models/googleIntelligenceSchedule.model');
const AdminAuditLog = require('../models/adminAuditLog.model');
const Admin = require('../models/admin.model');
const { BadRequestError, NotFoundError } = require('../core/error.response');
const { convertToObjectIdMongodb } = require('../utils');
const { normalizeString } = require('../utils/seoBlogSanitizer');
const { calculateNextRun, normalizeTimes, parseBoolean } = require('../utils/blogSchedule.util');
const {
    calculateSnapshotStatus,
    canonicalizeUrl,
    dateInTimezone,
    DEFAULT_TIMEZONE,
    isSnapshotAcceptable
} = require('../utils/googleIntelligence.util');
const { safeSourceFetch } = require('./safeSourceFetch.service');

const LEASE_MS = 10 * 60 * 1000;
const MAX_LIST_LIMIT = 100;
const DEFAULT_SOURCES = [
    {
        name: 'Google Search documentation updates',
        sourceType: 'documentation',
        baseUrl: 'https://developers.google.com/search/updates/search_docs_updates.rss',
        fetchMode: 'rss', official: true, required: true, priority: 1, sourceGroups: ['official', 'updates']
    },
    {
        name: 'Google Search Status Dashboard',
        sourceType: 'status', baseUrl: 'https://status.search.google.com/',
        official: true, required: true, priority: 1, sourceGroups: ['official', 'status']
    },
    {
        name: 'Google Search spam policies',
        sourceType: 'documentation', baseUrl: 'https://developers.google.com/search/docs/essentials/spam-policies',
        official: true, required: true, priority: 2, sourceGroups: ['official', 'policy']
    },
    {
        name: 'Helpful, reliable, people-first content',
        sourceType: 'documentation', baseUrl: 'https://developers.google.com/search/docs/fundamentals/creating-helpful-content',
        official: true, required: true, priority: 3, sourceGroups: ['official', 'content']
    },
    {
        name: 'Google Search Central Blog',
        sourceType: 'blog', baseUrl: 'https://developers.google.com/search/blog',
        official: true, required: false, priority: 10, sourceGroups: ['official', 'updates']
    },
    {
        name: 'AI features and your website',
        sourceType: 'documentation', baseUrl: 'https://developers.google.com/search/docs/appearance/ai-features',
        official: true, required: false, priority: 20, sourceGroups: ['official', 'ai-search']
    },
    {
        name: 'Structured data introduction',
        sourceType: 'documentation', baseUrl: 'https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data',
        official: true, required: false, priority: 30, sourceGroups: ['official', 'structured-data']
    },
    {
        name: 'Google Discover guidance',
        sourceType: 'documentation', baseUrl: 'https://developers.google.com/search/docs/appearance/google-discover',
        official: true, required: false, priority: 40, sourceGroups: ['official', 'discover']
    },
    {
        name: 'Search Console help', sourceType: 'search_console',
        baseUrl: 'https://support.google.com/webmasters/?hl=en',
        official: true, required: false, priority: 50, sourceGroups: ['official', 'search-console']
    }
];

const sha256 = (value) => crypto.createHash('sha256').update(String(value || '')).digest('hex');
const stripMarkup = (value) => String(value || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();

const extractTitle = (body, fallback) => {
    const match = String(body || '').match(/<(?:title|h1|rss[^>]*>\s*<channel[^>]*>\s*<title)[^>]*>([\s\S]*?)<\/(?:title|h1)>/i);
    return stripMarkup(match?.[1] || fallback).slice(0, 300);
};

const classifyAffectedArea = (text) => {
    const value = String(text || '').toLowerCase();
    if (/spam|scaled content|site reputation|cloaking|doorway/.test(value)) return 'spam_risk';
    if (/structured data|schema|merchant listing|product/.test(value)) return 'structured_data';
    if (/crawl|index|robots|canonical/.test(value)) return 'crawling_indexing';
    if (/discover/.test(value)) return 'discover';
    if (/ai overview|generative ai|ai feature/.test(value)) return 'generative_search';
    if (/search console/.test(value)) return 'search_console';
    return 'content_quality';
};

const classifySeverity = ({ source, text }) => {
    const value = String(text || '').toLowerCase();
    if (/spam policy|manual action|core update|spam update|security incident/.test(value)) return source.required ? 'critical' : 'high';
    if (/removed|deprecated|require|must|not supported/.test(value)) return 'high';
    if (/structured data|indexing|crawl|discover|ai feature/.test(value)) return 'medium';
    return source.official ? 'low' : 'informational';
};

const officialHostAllowed = (url) => {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === 'google.com' || hostname.endsWith('.google.com');
};

const mapSource = (source) => ({
    id: String(source._id || source.id),
    name: source.name,
    sourceType: source.sourceType,
    baseUrl: source.baseUrl,
    canonicalUrl: source.canonicalUrl || source.baseUrl,
    official: Boolean(source.official),
    required: Boolean(source.required),
    priority: Number(source.priority || 100),
    enabled: Boolean(source.enabled),
    sourceGroups: source.sourceGroups || [],
    fetchMode: source.fetchMode || 'html',
    allowPaths: source.allowPaths || [],
    denyPaths: source.denyPaths || [],
    lastSuccessAt: source.lastSuccessAt,
    lastFailureAt: source.lastFailureAt,
    lastError: source.lastError || '',
    lastFetchedAt: source.lastFetchedAt,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt
});

const mapSnapshot = (snapshot) => snapshot ? {
    id: String(snapshot._id || snapshot.id),
    snapshotDate: snapshot.snapshotDate,
    timezone: snapshot.timezone,
    status: snapshot.status,
    checkedAt: snapshot.checkedAt,
    sourcesChecked: snapshot.sourcesChecked,
    successfulSources: snapshot.successfulSources,
    failedSources: snapshot.failedSources,
    mandatorySourcesSucceeded: Boolean(snapshot.mandatorySourcesSucceeded),
    noMaterialChanges: Boolean(snapshot.noMaterialChanges),
    sourceHealth: snapshot.sourceHealth || [],
    officialChanges: snapshot.officialChanges || [],
    thirdPartyObservations: snapshot.thirdPartyObservations || [],
    currentRules: snapshot.currentRules || [],
    recommendations: snapshot.recommendations || [],
    risks: snapshot.risks || [],
    requiredActions: snapshot.requiredActions || [],
    contentGuidance: snapshot.contentGuidance || {},
    reviewerResult: snapshot.reviewerResult || {},
    contentHash: snapshot.contentHash,
    override: snapshot.override || null,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt
} : null;

const buildDefaultSchedule = () => {
    const timezone = process.env.GOOGLE_INTELLIGENCE_TIMEZONE || DEFAULT_TIMEZONE;
    const enabled = parseBoolean(process.env.GOOGLE_INTELLIGENCE_ENABLED, false);
    const dailyTime = normalizeTimes(process.env.GOOGLE_INTELLIGENCE_DAILY_TIME || '05:30');
    const schedule = {
        singletonKey: 'default', name: 'Google Search Intelligence', enabled,
        timezone, scheduleType: 'daily', daily: { times: dailyTime.length ? dailyTime : ['05:30'] },
        interval: { value: 24, unit: 'hours' }, sourceGroups: ['official'],
        strictGate: parseBoolean(process.env.GOOGLE_INTELLIGENCE_STRICT_GATE, true),
        allowLastSuccessfulSnapshot: parseBoolean(process.env.GOOGLE_INTELLIGENCE_ALLOW_LAST_SUCCESSFUL, false),
        maxSnapshotAgeHours: Math.max(1, Number(process.env.GOOGLE_INTELLIGENCE_MAX_SNAPSHOT_AGE_HOURS || 24)),
        sourceTimeoutMs: Math.max(1000, Number(process.env.GOOGLE_INTELLIGENCE_SOURCE_TIMEOUT_MS || 15000)),
        retryPolicy: { count: Math.max(0, Number(process.env.GOOGLE_INTELLIGENCE_RETRY_COUNT || 2)), delayMs: 1000 }
    };
    schedule.nextRunAt = enabled ? calculateNextRun({ schedule }) : null;
    return schedule;
};

class GoogleIntelligenceService {
    static async seedDefaultSources() {
        await Promise.all(DEFAULT_SOURCES.map((source) => GoogleIntelligenceSource.updateOne(
            { baseUrl: source.baseUrl },
            { $setOnInsert: source },
            { upsert: true }
        )));
    }

    static async getOrCreateSchedule() {
        let schedule = await GoogleIntelligenceSchedule.findOne({ singletonKey: 'default' }).lean();
        if (!schedule) {
            const created = await GoogleIntelligenceSchedule.create(buildDefaultSchedule());
            schedule = created.toObject();
        }
        return schedule;
    }

    static async getGateConfig() {
        const schedule = await GoogleIntelligenceService.getOrCreateSchedule();
        return {
            enabled: Boolean(schedule.enabled) || parseBoolean(process.env.GOOGLE_INTELLIGENCE_ENABLED, false),
            timezone: schedule.timezone || DEFAULT_TIMEZONE,
            strictGate: Boolean(schedule.strictGate),
            allowLastSuccessfulSnapshot: Boolean(schedule.allowLastSuccessfulSnapshot),
            maxSnapshotAgeHours: Number(schedule.maxSnapshotAgeHours || 24),
            sourceTimeoutMs: Number(schedule.sourceTimeoutMs || 15000),
            retryCount: Number(schedule.retryPolicy?.count || 0),
            retryDelayMs: Number(schedule.retryPolicy?.delayMs || 1000)
        };
    }

    static async listSources() {
        await GoogleIntelligenceService.seedDefaultSources();
        const sources = await GoogleIntelligenceSource.find().sort({ official: -1, priority: 1, name: 1 }).lean();
        return { sources: sources.map(mapSource) };
    }

    static async createSource({ payload = {} }) {
        const baseUrl = canonicalizeUrl(payload.baseUrl);
        if (!['https:'].includes(new URL(baseUrl).protocol)) throw new BadRequestError('source URL must use HTTPS');
        const official = Boolean(payload.official);
        if (official && !officialHostAllowed(baseUrl)) throw new BadRequestError('official sources must use an official Google domain');
        const created = await GoogleIntelligenceSource.create({
            name: normalizeString(payload.name),
            sourceType: normalizeString(payload.sourceType || (official ? 'documentation' : 'third_party')),
            baseUrl, official, required: official && Boolean(payload.required),
            priority: Math.min(Math.max(Number(payload.priority || 100), 1), 1000),
            enabled: payload.enabled !== false,
            sourceGroups: Array.isArray(payload.sourceGroups) ? payload.sourceGroups.map(normalizeString).filter(Boolean) : [],
            fetchMode: normalizeString(payload.fetchMode || 'html'),
            allowPaths: Array.isArray(payload.allowPaths) ? payload.allowPaths : [],
            denyPaths: Array.isArray(payload.denyPaths) ? payload.denyPaths : []
        });
        return mapSource(created.toObject());
    }

    static async updateSource({ sourceId, payload = {} }) {
        const objectId = convertToObjectIdMongodb(sourceId);
        if (!objectId) throw new BadRequestError('Invalid source id');
        const allowed = ['name', 'enabled', 'required', 'priority', 'sourceGroups', 'fetchMode', 'allowPaths', 'denyPaths'];
        const update = Object.fromEntries(Object.entries(payload).filter(([key]) => allowed.includes(key)));
        const updated = await GoogleIntelligenceSource.findByIdAndUpdate(objectId, { $set: update }, { new: true, runValidators: true }).lean();
        if (!updated) throw new NotFoundError('Google Intelligence source not found');
        return mapSource(updated);
    }

    static async fetchSource({ source, fetchOptions = {} }) {
        const attempts = Math.max(1, Number(fetchOptions.retryCount || 0) + 1);
        let lastError;
        for (let attempt = 0; attempt < attempts; attempt += 1) {
            try {
                const fetched = await safeSourceFetch({
                    url: source.baseUrl,
                    timeoutMs: fetchOptions.timeoutMs,
                    fetchImpl: fetchOptions.fetchImpl,
                    resolveHostname: fetchOptions.resolveHostname,
                    checkRobots: fetchOptions.checkRobots !== false,
                    allowHttp: Boolean(fetchOptions.allowHttp)
                });
                const normalizedText = stripMarkup(fetched.body).slice(0, 120_000);
                const currentHash = sha256(normalizedText);
                const previousHash = source.lastContentHash || '';
                const changed = Boolean(previousHash && previousHash !== currentHash);
                const isNew = !previousHash;
                const title = extractTitle(fetched.body, source.name);
                await GoogleIntelligenceSource.updateOne({ _id: source._id }, {
                    $set: {
                        canonicalUrl: fetched.canonicalUrl, lastSuccessAt: fetched.fetchedAt,
                        lastFetchedAt: fetched.fetchedAt, lastError: '', lastContentHash: currentHash, lastTitle: title
                    }
                });
                return {
                    ok: true, sourceId: String(source._id), sourceName: source.name,
                    sourceUrl: fetched.canonicalUrl, official: Boolean(source.official), required: Boolean(source.required),
                    title, previousHash, currentHash, changed, isNew,
                    excerpt: normalizedText.slice(0, 1200), fetchedAt: fetched.fetchedAt
                };
            } catch (error) {
                lastError = error;
                if (attempt + 1 < attempts) {
                    await new Promise((resolve) => setTimeout(resolve, Math.max(100, Number(fetchOptions.retryDelayMs || 1000))));
                }
            }
        }
        const message = normalizeString(lastError?.message || 'source_fetch_failed').slice(0, 500);
        await GoogleIntelligenceSource.updateOne({ _id: source._id }, {
            $set: { lastFailureAt: new Date(), lastFetchedAt: new Date(), lastError: message }
        });
        return { ok: false, sourceId: String(source._id), sourceName: source.name, sourceUrl: source.baseUrl, official: Boolean(source.official), required: Boolean(source.required), error: message };
    }

    static async executeWorkflow({ now = new Date(), triggeredBy = 'gate', adminId = null, force = false, fetchOptions = {} } = {}) {
        await GoogleIntelligenceService.seedDefaultSources();
        const config = await GoogleIntelligenceService.getGateConfig();
        const timezone = fetchOptions.timezone || config.timezone;
        const snapshotDate = dateInTimezone(now, timezone);
        const existing = await GoogleIntelligenceSnapshot.findOne({ snapshotDate, timezone }).lean();
        if (!force && existing && isSnapshotAcceptable({ snapshot: existing, strictGate: config.strictGate, maxAgeHours: config.maxSnapshotAgeHours, now })) {
            return { snapshot: mapSnapshot(existing), reused: true };
        }

        const executionKey = triggeredBy === 'gate'
            ? `google-intelligence:${snapshotDate}:${timezone}`
            : `google-intelligence:${snapshotDate}:${triggeredBy}:${crypto.randomUUID()}`;
        let run;
        try {
            run = await GoogleIntelligenceRun.create({
                executionKey, scheduledAt: now, startedAt: new Date(), timezone, snapshotDate,
                status: 'running', triggeredBy, triggeredByAdminId: convertToObjectIdMongodb(adminId) || null,
                correlationId: crypto.randomUUID()
            });
        } catch (error) {
            if (error?.code !== 11000) throw error;
            for (let attempt = 0; attempt < 20; attempt += 1) {
                const completed = await GoogleIntelligenceSnapshot.findOne({ snapshotDate, timezone }).lean();
                if (completed) return { snapshot: mapSnapshot(completed), reused: true, concurrent: true };
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
            throw new BadRequestError('Google Intelligence snapshot is already running');
        }

        try {
            const sources = await GoogleIntelligenceSource.find({ enabled: true }).sort({ official: -1, priority: 1 }).select('+lastContentHash').lean();
            const results = [];
            for (const source of sources) {
                results.push(await GoogleIntelligenceService.fetchSource({
                    source,
                    fetchOptions: {
                        timeoutMs: fetchOptions.timeoutMs || config.sourceTimeoutMs,
                        retryCount: fetchOptions.retryCount ?? config.retryCount,
                        retryDelayMs: fetchOptions.retryDelayMs || config.retryDelayMs,
                        fetchImpl: fetchOptions.fetchImpl,
                        resolveHostname: fetchOptions.resolveHostname,
                        checkRobots: fetchOptions.checkRobots,
                        allowHttp: fetchOptions.allowHttp
                    }
                }));
            }

            const successful = results.filter((item) => item.ok);
            const failed = results.filter((item) => !item.ok);
            const changedResults = successful.filter((item) => item.changed || item.isNew);
            const requiredResults = results.filter((item) => item.required);
            const mandatorySourcesSucceeded = requiredResults.length > 0 && requiredResults.every((item) => item.ok);
            const status = calculateSnapshotStatus({
                successfulSources: successful.length,
                failedSources: failed.length,
                mandatorySourcesSucceeded,
                changesDetected: changedResults.length
            });
            const changeDrafts = changedResults.map((item) => {
                const source = sources.find((candidate) => String(candidate._id) === item.sourceId);
                const affectedArea = classifyAffectedArea(`${item.title} ${item.excerpt}`);
                const severity = classifySeverity({ source, text: `${item.title} ${item.excerpt}` });
                return {
                    fingerprint: sha256(`${item.sourceId}:${item.currentHash}`), sourceId: item.sourceId,
                    title: item.title, sourceUrl: item.sourceUrl, sourceLevel: item.official ? 'official' : 'third_party',
                    changeType: item.isNew ? 'new' : 'updated', severity, detectedAt: now,
                    previousHash: item.previousHash, currentHash: item.currentHash,
                    summary: item.excerpt.slice(0, 700),
                    officialStatement: item.official ? item.excerpt.slice(0, 700) : '',
                    analystInterpretation: item.official ? 'Review the verified source before changing editorial policy.' : 'Third-party observation; it cannot override official Google guidance.',
                    impactOnInoxpran: affectedArea === 'content_quality' ? 'Review people-first usefulness and source attribution.' : `Review the ${affectedArea.replace(/_/g, ' ')} implementation.`,
                    recommendedAction: severity === 'critical' || severity === 'high' ? 'Pause affected auto-publishing until an editor reviews this change.' : 'Monitor and include the verified guidance in the next strategy plan.',
                    affectedArea, confidence: item.official ? 1 : 0.6
                };
            });

            const snapshotPayload = {
                snapshotDate, timezone, status, checkedAt: now, sourcesChecked: results.length,
                successfulSources: successful.length, failedSources: failed.length, mandatorySourcesSucceeded,
                noMaterialChanges: changedResults.length === 0,
                sourceHealth: results.map((item) => ({
                    sourceId: item.sourceId, name: item.sourceName, url: item.sourceUrl,
                    official: item.official, required: item.required, ok: item.ok, error: item.error || '', fetchedAt: item.fetchedAt || now
                })),
                officialChanges: changeDrafts.filter((item) => item.sourceLevel === 'official').map((item) => ({ title: item.title, sourceUrl: item.sourceUrl, severity: item.severity, affectedArea: item.affectedArea, summary: item.summary })),
                thirdPartyObservations: changeDrafts.filter((item) => item.sourceLevel === 'third_party').map((item) => ({ title: item.title, sourceUrl: item.sourceUrl, severity: item.severity, affectedArea: item.affectedArea, summary: item.summary })),
                currentRules: [
                    { area: 'content_quality', rule: 'Create original, helpful, reliable, people-first content.' },
                    { area: 'spam_risk', rule: 'Do not create scaled low-value content or content intended to manipulate Search.' },
                    { area: 'source_policy', rule: 'Official Google guidance overrides third-party interpretation.' }
                ],
                recommendations: changeDrafts.map((item) => ({ area: item.affectedArea, severity: item.severity, action: item.recommendedAction, sourceUrl: item.sourceUrl })),
                risks: changeDrafts.filter((item) => ['critical', 'high'].includes(item.severity)).map((item) => ({ area: item.affectedArea, severity: item.severity, title: item.title })),
                requiredActions: changeDrafts.filter((item) => ['critical', 'high'].includes(item.severity)).map((item) => ({ action: item.recommendedAction, sourceUrl: item.sourceUrl })),
                contentGuidance: {
                    technicalSeo: 'Keep crawling, indexing, canonical, sitemap, and structured data behavior verifiable.',
                    content: 'Prioritize Vietnamese household usefulness, original analysis, accurate sourcing, and clear authorship.',
                    aiSearch: 'Use the same people-first SEO fundamentals; do not promise AI feature inclusion.',
                    structuredData: 'Use supported properties that match visible page content.',
                    spamRisk: 'Block copied, spun, doorway, keyword-stuffed, or scaled low-value drafts.'
                },
                reviewerResult: {
                    passed: mandatorySourcesSucceeded && successful.length > 0,
                    verifiedOfficialSources: successful.filter((item) => item.official).length,
                    unsupportedClaims: 0,
                    uncertainty: failed.length ? 'Some configured sources failed; inspect source health.' : ''
                },
                contentHash: sha256(JSON.stringify(results.map((item) => [item.sourceId, item.currentHash || item.error]))),
                runId: run._id
            };
            const snapshot = await GoogleIntelligenceSnapshot.findOneAndUpdate(
                { snapshotDate, timezone }, { $set: snapshotPayload }, { new: true, upsert: true, runValidators: true }
            ).lean();

            for (const draft of changeDrafts) {
                await GoogleIntelligenceChange.updateOne(
                    { fingerprint: draft.fingerprint },
                    { $setOnInsert: { ...draft, snapshotId: snapshot._id } },
                    { upsert: true }
                );
            }
            await GoogleIntelligenceRun.updateOne({ _id: run._id }, {
                $set: {
                    status, completedAt: new Date(), snapshotId: snapshot._id,
                    sourceResults: results.map((item) => ({ sourceId: item.sourceId, name: item.sourceName, ok: item.ok, official: item.official, required: item.required, changed: item.changed || item.isNew || false, error: item.error || '' })),
                    changesDetected: changeDrafts.length,
                    criticalChanges: changeDrafts.filter((item) => item.severity === 'critical').length
                }
            });
            return { snapshot: mapSnapshot(snapshot), reused: false, runId: String(run._id) };
        } catch (error) {
            await GoogleIntelligenceRun.updateOne({ _id: run._id }, { $set: { status: 'failed', completedAt: new Date(), error: normalizeString(error?.message).slice(0, 1000) } });
            throw error;
        }
    }

    static async ensureGoogleIntelligenceSnapshotForDate({ now = new Date(), fetchOptions = {} } = {}) {
        const config = await GoogleIntelligenceService.getGateConfig();
        const snapshotDate = dateInTimezone(now, config.timezone);
        let snapshot = await GoogleIntelligenceSnapshot.findOne({ snapshotDate, timezone: config.timezone }).lean();
        if (!isSnapshotAcceptable({ snapshot, strictGate: config.strictGate, maxAgeHours: config.maxSnapshotAgeHours, now })) {
            if (config.enabled) {
                const result = await GoogleIntelligenceService.executeWorkflow({ now, triggeredBy: 'gate', fetchOptions });
                snapshot = await GoogleIntelligenceSnapshot.findById(result.snapshot.id).lean();
            } else if (config.allowLastSuccessfulSnapshot) {
                snapshot = await GoogleIntelligenceSnapshot.findOne({ status: { $in: ['completed_with_changes', 'completed_no_change', 'partial', 'manually_overridden'] } }).sort({ checkedAt: -1 }).lean();
            }
        }
        if (!isSnapshotAcceptable({ snapshot, strictGate: config.strictGate, maxAgeHours: config.maxSnapshotAgeHours, now })) {
            throw new BadRequestError('Agentic content blocked: no acceptable Google Intelligence snapshot');
        }
        return mapSnapshot(snapshot);
    }

    static async getStatus() {
        const [config, latestSnapshot, latestRun, sourceCounts, schedule] = await Promise.all([
            GoogleIntelligenceService.getGateConfig(),
            GoogleIntelligenceSnapshot.findOne().sort({ checkedAt: -1 }).lean(),
            GoogleIntelligenceRun.findOne().sort({ createdAt: -1 }).lean(),
            GoogleIntelligenceSource.aggregate([{ $group: { _id: null, total: { $sum: 1 }, enabled: { $sum: { $cond: ['$enabled', 1, 0] } }, failing: { $sum: { $cond: [{ $ne: ['$lastError', ''] }, 1, 0] } } } }]),
            GoogleIntelligenceService.getOrCreateSchedule()
        ]);
        const gateOpen = isSnapshotAcceptable({ snapshot: latestSnapshot, strictGate: config.strictGate, maxAgeHours: config.maxSnapshotAgeHours });
        return {
            enabled: config.enabled, strictGate: config.strictGate, gateOpen,
            snapshot: mapSnapshot(latestSnapshot),
            latestRun: latestRun ? { id: String(latestRun._id), status: latestRun.status, startedAt: latestRun.startedAt, completedAt: latestRun.completedAt, changesDetected: latestRun.changesDetected, error: latestRun.error } : null,
            sourceSummary: sourceCounts[0] || { total: 0, enabled: 0, failing: 0 },
            schedule: GoogleIntelligenceService.mapSchedule(schedule),
            telegram: {
                enabled: parseBoolean(process.env.TELEGRAM_BOT_ENABLED, false),
                tokenConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
                allowlistConfigured: Boolean(process.env.TELEGRAM_ALLOWED_CHAT_IDS || process.env.TELEGRAM_ALLOWED_USER_IDS),
                mode: normalizeString(process.env.TELEGRAM_MODE || 'webhook'),
                webhookSecretConfigured: Boolean(process.env.TELEGRAM_WEBHOOK_SECRET),
                adminBaseUrlConfigured: Boolean(process.env.ADMIN_BASE_URL)
            }
        };
    }

    static async listSnapshots({ page = 1, limit = 20 } = {}) {
        const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), MAX_LIST_LIMIT);
        const safePage = Math.max(Number(page) || 1, 1);
        const [items, total] = await Promise.all([
            GoogleIntelligenceSnapshot.find().sort({ checkedAt: -1 }).skip((safePage - 1) * safeLimit).limit(safeLimit).lean(),
            GoogleIntelligenceSnapshot.countDocuments()
        ]);
        return { snapshots: items.map(mapSnapshot), pagination: { page: safePage, limit: safeLimit, total, pages: Math.max(1, Math.ceil(total / safeLimit)) } };
    }

    static async getSnapshot({ snapshotId }) {
        const objectId = convertToObjectIdMongodb(snapshotId);
        if (!objectId) throw new BadRequestError('Invalid snapshot id');
        const [snapshot, changes] = await Promise.all([
            GoogleIntelligenceSnapshot.findById(objectId).lean(),
            GoogleIntelligenceChange.find({ snapshotId: objectId }).sort({ severity: 1, detectedAt: -1 }).lean()
        ]);
        if (!snapshot) throw new NotFoundError('Google Intelligence snapshot not found');
        return { snapshot: mapSnapshot(snapshot), changes: changes.map((item) => ({ ...item, id: String(item._id), sourceId: String(item.sourceId), snapshotId: String(item.snapshotId) })) };
    }

    static mapSchedule(schedule) {
        return {
            id: String(schedule._id || schedule.id), name: schedule.name, enabled: Boolean(schedule.enabled),
            timezone: schedule.timezone, scheduleType: schedule.scheduleType, daily: schedule.daily || { times: [] },
            interval: schedule.interval || { value: 24, unit: 'hours' }, sourceGroups: schedule.sourceGroups || [],
            strictGate: Boolean(schedule.strictGate), allowLastSuccessfulSnapshot: Boolean(schedule.allowLastSuccessfulSnapshot),
            maxSnapshotAgeHours: schedule.maxSnapshotAgeHours, sourceTimeoutMs: schedule.sourceTimeoutMs,
            retryPolicy: schedule.retryPolicy || { count: 2, delayMs: 1000 }, lastRunAt: schedule.lastRunAt,
            nextRunAt: schedule.nextRunAt, lastRunStatus: schedule.lastRunStatus || '', lastError: schedule.lastError || ''
        };
    }

    static async getSchedule() {
        return GoogleIntelligenceService.mapSchedule(await GoogleIntelligenceService.getOrCreateSchedule());
    }

    static async updateSchedule({ payload = {}, adminId }) {
        const current = await GoogleIntelligenceService.getOrCreateSchedule();
        const scheduleType = normalizeString(payload.scheduleType || current.scheduleType || 'daily');
        if (!['daily', 'interval'].includes(scheduleType)) throw new BadRequestError('scheduleType must be daily or interval');
        const timezone = normalizeString(payload.timezone || current.timezone || DEFAULT_TIMEZONE);
        try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date()); } catch { throw new BadRequestError('timezone is invalid'); }
        const dailyTimes = normalizeTimes(payload.daily?.times ?? current.daily?.times ?? ['05:30']);
        if (scheduleType === 'daily' && !dailyTimes.length) throw new BadRequestError('daily schedule requires at least one HH:mm time');
        const update = {
            enabled: payload.enabled === undefined ? Boolean(current.enabled) : Boolean(payload.enabled),
            timezone, scheduleType, daily: { times: dailyTimes },
            interval: {
                value: Math.max(1, Number(payload.interval?.value ?? current.interval?.value ?? 24)),
                unit: normalizeString(payload.interval?.unit || current.interval?.unit || 'hours')
            },
            sourceGroups: Array.isArray(payload.sourceGroups) ? payload.sourceGroups.map(normalizeString).filter(Boolean) : current.sourceGroups,
            strictGate: payload.strictGate === undefined ? Boolean(current.strictGate) : Boolean(payload.strictGate),
            allowLastSuccessfulSnapshot: payload.allowLastSuccessfulSnapshot === undefined ? Boolean(current.allowLastSuccessfulSnapshot) : Boolean(payload.allowLastSuccessfulSnapshot),
            maxSnapshotAgeHours: Math.min(Math.max(Number(payload.maxSnapshotAgeHours ?? current.maxSnapshotAgeHours ?? 24), 1), 720),
            sourceTimeoutMs: Math.min(Math.max(Number(payload.sourceTimeoutMs ?? current.sourceTimeoutMs ?? 15000), 1000), 60000),
            retryPolicy: {
                count: Math.min(Math.max(Number(payload.retryPolicy?.count ?? current.retryPolicy?.count ?? 2), 0), 5),
                delayMs: Math.min(Math.max(Number(payload.retryPolicy?.delayMs ?? current.retryPolicy?.delayMs ?? 1000), 100), 60000)
            },
            createdBy: current.createdBy || convertToObjectIdMongodb(adminId) || null,
            leaseUntil: null, lockedBy: ''
        };
        update.nextRunAt = update.enabled ? calculateNextRun({ schedule: update }) : null;
        const updated = await GoogleIntelligenceSchedule.findOneAndUpdate({ singletonKey: 'default' }, { $set: update }, { new: true, runValidators: true }).lean();
        return GoogleIntelligenceService.mapSchedule(updated);
    }

    static async setScheduleEnabled({ enabled, adminId }) {
        const current = await GoogleIntelligenceService.getOrCreateSchedule();
        return GoogleIntelligenceService.updateSchedule({ payload: { ...current, enabled }, adminId });
    }

    static async runNow({ adminId }) {
        return GoogleIntelligenceService.executeWorkflow({ triggeredBy: 'manual', adminId, force: true });
    }

    static async runSourceNow({ sourceId }) {
        const objectId = convertToObjectIdMongodb(sourceId);
        if (!objectId) throw new BadRequestError('Invalid source id');
        const source = await GoogleIntelligenceSource.findById(objectId).select('+lastContentHash').lean();
        if (!source) throw new NotFoundError('Google Intelligence source not found');
        const config = await GoogleIntelligenceService.getGateConfig();
        return GoogleIntelligenceService.fetchSource({ source, fetchOptions: { timeoutMs: config.sourceTimeoutMs, retryCount: config.retryCount, retryDelayMs: config.retryDelayMs } });
    }

    static async overrideSnapshot({ snapshotId, reason, adminId }) {
        const objectId = convertToObjectIdMongodb(snapshotId);
        const adminObjectId = convertToObjectIdMongodb(adminId);
        const normalizedReason = normalizeString(reason);
        if (!objectId) throw new BadRequestError('Invalid snapshot id');
        if (!adminObjectId) throw new BadRequestError('Valid admin is required');
        if (normalizedReason.length < 10) throw new BadRequestError('Override reason must be at least 10 characters');
        const current = await GoogleIntelligenceSnapshot.findById(objectId).lean();
        if (!current) throw new NotFoundError('Google Intelligence snapshot not found');
        const updated = await GoogleIntelligenceSnapshot.findByIdAndUpdate(objectId, {
            $set: {
                status: 'manually_overridden',
                'override.reason': normalizedReason.slice(0, 1000),
                'override.adminId': adminObjectId,
                'override.overriddenAt': new Date(),
                'override.previousStatus': current.status
            }
        }, { new: true }).lean();
        const admin = await Admin.findById(adminObjectId).select('name email status roles').lean();
        const snapshot = { adminId: String(adminObjectId), name: admin?.name || '', email: admin?.email || '', status: admin?.status || '', roles: admin?.roles || [] };
        await AdminAuditLog.create({
            category: 'google_intelligence', action: 'override_gate', actorAdmin: adminObjectId,
            actorSnapshot: snapshot, targetAdmin: adminObjectId, targetSnapshot: snapshot,
            summary: `Google Intelligence gate overridden for ${current.snapshotDate}`,
            metadata: { snapshotId: String(objectId), previousStatus: current.status, reason: normalizedReason.slice(0, 1000) }
        });
        return mapSnapshot(updated);
    }

    static async listExecutions({ limit = 30 } = {}) {
        const runs = await GoogleIntelligenceRun.find().sort({ createdAt: -1 }).limit(Math.min(Math.max(Number(limit) || 30, 1), MAX_LIST_LIMIT)).lean();
        return { executions: runs.map((run) => ({
            id: String(run._id), executionKey: run.executionKey, snapshotDate: run.snapshotDate,
            timezone: run.timezone, status: run.status, startedAt: run.startedAt, completedAt: run.completedAt,
            changesDetected: run.changesDetected, criticalChanges: run.criticalChanges,
            triggeredBy: run.triggeredBy, error: run.error || '', sourceResults: run.sourceResults || []
        })) };
    }

    static async claimDueSchedule({ workerId, now = new Date() }) {
        if (!parseBoolean(process.env.GOOGLE_INTELLIGENCE_ENABLED, false)) return null;
        await GoogleIntelligenceService.getOrCreateSchedule();
        return GoogleIntelligenceSchedule.findOneAndUpdate(
            { singletonKey: 'default', enabled: true, nextRunAt: { $ne: null, $lte: now }, $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }] },
            { $set: { lockedBy: workerId, leaseUntil: new Date(now.getTime() + LEASE_MS) } },
            { new: true }
        ).lean();
    }

    static async runDueOnce({ workerId, now = new Date() }) {
        const schedule = await GoogleIntelligenceService.claimDueSchedule({ workerId, now });
        if (!schedule) return null;
        try {
            const result = await GoogleIntelligenceService.executeWorkflow({ now, triggeredBy: 'scheduled' });
            const nextRunAt = calculateNextRun({ schedule: { ...schedule, lastRunAt: now }, from: now });
            await GoogleIntelligenceSchedule.updateOne({ _id: schedule._id }, { $set: { lastRunAt: now, nextRunAt, lastRunStatus: result.snapshot.status, lastError: '', leaseUntil: null, lockedBy: '' } });
            return result;
        } catch (error) {
            const nextRunAt = calculateNextRun({ schedule: { ...schedule, lastRunAt: now }, from: now });
            await GoogleIntelligenceSchedule.updateOne({ _id: schedule._id }, { $set: { lastRunAt: now, nextRunAt, lastRunStatus: 'failed', lastError: normalizeString(error?.message).slice(0, 1000), leaseUntil: null, lockedBy: '' } });
            throw error;
        }
    }
}

module.exports = {
    DEFAULT_SOURCES,
    GoogleIntelligenceService,
    classifyAffectedArea,
    classifySeverity,
    extractTitle,
    officialHostAllowed,
    stripMarkup
};
