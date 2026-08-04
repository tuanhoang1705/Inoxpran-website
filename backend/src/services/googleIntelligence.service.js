'use strict'

const crypto = require('node:crypto');
const { GoogleIntelligenceSource } = require('../models/googleIntelligenceSource.model');
const { GoogleIntelligenceRun } = require('../models/googleIntelligenceRun.model');
const { GoogleIntelligenceSnapshot } = require('../models/googleIntelligenceSnapshot.model');
const { GoogleIntelligenceChange } = require('../models/googleIntelligenceChange.model');
const { GoogleIntelligenceSchedule } = require('../models/googleIntelligenceSchedule.model');
const { blog: Blog } = require('../models/blog.model');
const AdminAuditLog = require('../models/adminAuditLog.model');
const Admin = require('../models/admin.model');
const { BadRequestError, NotFoundError } = require('../core/error.response');
const { convertToObjectIdMongodb } = require('../utils');
const { normalizeString } = require('../utils/seoBlogSanitizer');
const { safeErrorCode, safeStoredErrorCode } = require('../utils/httpError.util');
const {
    normalizeTrustedQaProvenance,
    qaExecutionScopeKey,
    qaProvenanceDocument,
    qaScopeFilter
} = require('../utils/qaProvenance.util');
const { calculateNextRun, normalizeTimes, parseBoolean } = require('../utils/blogSchedule.util');
const {
    calculateSnapshotStatus,
    dateInTimezone,
    DEFAULT_TIMEZONE,
    isSnapshotAcceptable,
    assertPersistableSourceUrl,
    sanitizeSourceUrlForRead
} = require('../utils/googleIntelligence.util');
const { safeSourceFetch } = require('./safeSourceFetch.service');

const LEASE_MS = 10 * 60 * 1000;
const CONCURRENT_SNAPSHOT_WAIT_MS = 30_000;
const CONCURRENT_SNAPSHOT_POLL_MS = 250;
const MAX_LIST_LIMIT = 100;
const DEFAULT_SOURCE_MAX_BYTES = 750_000;
const OFFICIAL_SOURCE_MAX_BYTES = 2_000_000;
const GOOGLE_BUILD_BUSY_CODE = 'GOOGLE_INTELLIGENCE_BUILD_BUSY';
const GOOGLE_BUILD_LEASE_LOST_CODE = 'GOOGLE_INTELLIGENCE_BUILD_LEASE_LOST';
const GOOGLE_BUILD_FAILED_CODE = 'GOOGLE_INTELLIGENCE_BUILD_FAILED';
const GOOGLE_SNAPSHOT_UNAVAILABLE_CODE = 'GOOGLE_INTELLIGENCE_SNAPSHOT_UNAVAILABLE';
const GOOGLE_HISTORICAL_ERROR_CODE = 'GOOGLE_INTELLIGENCE_HISTORICAL_ERROR';
const safeGoogleStoredError = (value) => safeStoredErrorCode(value, GOOGLE_HISTORICAL_ERROR_CODE);
const safeGoogleWriteError = (value, fallback) => safeErrorCode({ code: value || fallback }).toUpperCase();
const googleSnapshotUnavailableError = () => {
    const error = new BadRequestError('Agentic content blocked: no acceptable Google Intelligence snapshot');
    error.code = GOOGLE_SNAPSHOT_UNAVAILABLE_CODE;
    return error;
};
const sanitizeSourceHealth = (items) => (Array.isArray(items) ? items : []).map((item) => ({
    ...item,
    url: sanitizeSourceUrlForRead(item?.url),
    error: safeGoogleStoredError(item?.error)
}));
const sanitizeSourceUrlItems = (items) => (Array.isArray(items) ? items : []).map((item) => ({
    ...item,
    sourceUrl: sanitizeSourceUrlForRead(item?.sourceUrl)
}));
const normalizeExecutionKeyPart = (value, fallback) => String(value || fallback)
    .trim()
    .replace(/[^A-Za-z0-9_.:@+-]/g, '_')
    .slice(0, 160);
const buildGoogleExecutionSlotKey = ({ triggeredBy = 'gate', snapshotDate, timezone, dueAt, scopeKey = '' } = {}) => {
    const scopeSuffix = scopeKey ? `:${normalizeExecutionKeyPart(scopeKey, 'qa')}` : '';
    if (triggeredBy === 'scheduled') {
        const due = new Date(dueAt || 0);
        if (!Number.isFinite(due.getTime())) throw new Error('GOOGLE_INTELLIGENCE_DUE_SLOT_INVALID');
        return `google-intelligence:scheduled:${normalizeExecutionKeyPart(timezone, DEFAULT_TIMEZONE)}:${due.toISOString()}${scopeSuffix}`;
    }
    const base = `google-intelligence:${normalizeExecutionKeyPart(snapshotDate, 'unknown-date')}:${normalizeExecutionKeyPart(timezone, DEFAULT_TIMEZONE)}`;
    return `${base}:${normalizeExecutionKeyPart(triggeredBy, 'gate')}${scopeSuffix}`;
};
const buildGoogleExecutionKey = ({ generation, nonce, ...input } = {}) => {
    const slotKey = buildGoogleExecutionSlotKey(input);
    if (input.triggeredBy === 'scheduled') {
        // A due slot is a single logical execution even if its lease is reclaimed.
        return { executionKey: slotKey, executionSlotKey: slotKey };
    }
    const suffix = input.triggeredBy === 'manual'
        ? normalizeExecutionKeyPart(nonce || crypto.randomUUID(), 'manual')
        : `g${Math.max(0, Number(generation) || 0)}`;
    return { executionKey: `${slotKey}:${suffix}`, executionSlotKey: slotKey };
};
const createScheduleLeaseOwner = (workerId) => {
    const normalizedWorkerId = String(workerId || 'google-intelligence-worker').trim().slice(0, 150) || 'google-intelligence-worker';
    return `${normalizedWorkerId}:${crypto.randomUUID()}`.slice(0, 200);
};
const explicitOwnerUpdateFailed = (result) => Number.isFinite(result?.matchedCount)
    ? result.matchedCount === 0
    : result?.modifiedCount === 0;
const createGoogleScheduleLeaseHeartbeat = ({
    ScheduleModel = GoogleIntelligenceSchedule, scheduleId, ownerToken, leaseMs = LEASE_MS,
    heartbeatMs = Math.max(1_000, Math.floor(leaseMs / 3)), clock = () => new Date(),
    setIntervalFn = setInterval, clearIntervalFn = clearInterval
} = {}) => {
    let stopped = false;
    let ownershipLost = false;
    let pending = Promise.resolve();
    const renew = async () => {
        if (stopped || ownershipLost) return !ownershipLost;
        const heartbeatAt = new Date(clock());
        const result = await ScheduleModel.updateOne(
            { _id: scheduleId, lockedBy: ownerToken },
            { $set: { leaseUntil: new Date(heartbeatAt.getTime() + leaseMs) } }
        );
        if (explicitOwnerUpdateFailed(result)) ownershipLost = true;
        return !ownershipLost;
    };
    const timer = setIntervalFn(() => {
        pending = pending.then(renew).catch(() => { ownershipLost = true; });
    }, heartbeatMs);
    timer?.unref?.();
    return {
        beat: async () => {
            await pending;
            if (ownershipLost || stopped) return false;
            return renew();
        },
        stop: async () => {
            if (!stopped) {
                stopped = true;
                clearIntervalFn(timer);
            }
            await pending;
        },
        ownershipLost: () => ownershipLost
    };
};
const createGoogleBuildLeaseHeartbeat = ({
    SnapshotModel = GoogleIntelligenceSnapshot, snapshotKey, buildToken, buildGeneration,
    leaseMs = LEASE_MS, heartbeatMs = Math.max(1_000, Math.floor(leaseMs / 3)),
    clock = () => new Date(), setIntervalFn = setInterval, clearIntervalFn = clearInterval
} = {}) => {
    let stopped = false;
    let ownershipLost = false;
    let pending = Promise.resolve();
    const ownerFilter = {
        ...snapshotKey,
        status: 'building',
        buildToken,
        buildGeneration
    };
    const renew = async () => {
        if (stopped || ownershipLost) return !ownershipLost;
        const heartbeatAt = new Date(clock());
        const result = await SnapshotModel.updateOne(
            ownerFilter,
            { $set: { leaseUntil: new Date(heartbeatAt.getTime() + leaseMs) } }
        );
        if (explicitOwnerUpdateFailed(result)) ownershipLost = true;
        return !ownershipLost;
    };
    const timer = setIntervalFn(() => {
        pending = pending.then(renew).catch(() => { ownershipLost = true; });
    }, heartbeatMs);
    timer?.unref?.();
    return {
        beat: async () => {
            await pending;
            if (ownershipLost || stopped) return false;
            return renew();
        },
        stop: async () => {
            if (!stopped) {
                stopped = true;
                clearIntervalFn(timer);
            }
            await pending;
        },
        ownershipLost: () => ownershipLost
    };
};

const leanQuery = async (query) => typeof query?.lean === 'function' ? query.lean() : query;
const selectInternalBuildFields = (query) => typeof query?.select === 'function'
    ? query.select('+buildToken +buildGeneration +completedGeneration +leaseUntil +lastBuildError')
    : query;
const googleBuildError = (code) => {
    const error = new Error(code);
    error.code = code;
    return error;
};
const sourceGenerationFilter = ({ sourceId, snapshotDate, buildGeneration }) => ({
    _id: sourceId,
    $or: [
        { baselineSnapshotDate: { $exists: false } },
        { baselineSnapshotDate: '' },
        { baselineSnapshotDate: { $lt: snapshotDate } },
        { baselineSnapshotDate: snapshotDate, baselineGeneration: { $exists: false } },
        { baselineSnapshotDate: snapshotDate, baselineGeneration: { $lte: buildGeneration } }
    ]
});
const reconcileCompletedGoogleRun = async ({ RunModel = GoogleIntelligenceRun, snapshot, completedAt = new Date() } = {}) => {
    const status = ['completed_with_changes', 'completed_no_change', 'partial'].includes(snapshot?.status)
        ? snapshot.status
        : '';
    if (!status || !snapshot?._id || !snapshot?.runId) return false;
    const completedChanges = [
        ...(Array.isArray(snapshot.officialChanges) ? snapshot.officialChanges : []),
        ...(Array.isArray(snapshot.thirdPartyObservations) ? snapshot.thirdPartyObservations : [])
    ];
    const changedSourceUrls = new Set(completedChanges
        .map((item) => sanitizeSourceUrlForRead(item?.sourceUrl))
        .filter(Boolean));
    const sourceResults = (Array.isArray(snapshot.sourceHealth) ? snapshot.sourceHealth : [])
        .slice(0, MAX_LIST_LIMIT)
        .map((item) => ({
            sourceId: String(item?.sourceId || '').slice(0, 128),
            name: String(item?.name || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 180),
            ok: item?.ok === true,
            official: item?.official === true,
            required: item?.required === true,
            changed: changedSourceUrls.has(sanitizeSourceUrlForRead(item?.url)),
            error: safeGoogleStoredError(item?.error)
        }));
    const generation = Math.max(0, Number(snapshot.completedGeneration || 0));
    const generationFilter = generation > 0
        ? { snapshotGeneration: generation }
        : { $or: [{ snapshotGeneration: 0 }, { snapshotGeneration: { $exists: false } }] };
    const result = await RunModel.updateOne(
        {
            _id: snapshot.runId,
            status: 'running',
            snapshotId: snapshot._id,
            ...generationFilter
        },
        {
            $set: {
                status,
                completedAt,
                sourceResults,
                changesDetected: completedChanges.length,
                criticalChanges: completedChanges.filter((item) => item?.severity === 'critical').length,
                error: ''
            },
            $unset: { buildToken: '' }
        }
    );
    return !explicitOwnerUpdateFailed(result);
};
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

const extractDocumentDates = (body) => {
    const source = String(body || '');
    const findDate = (patterns) => {
        for (const pattern of patterns) {
            const value = stripMarkup(source.match(pattern)?.[1] || '');
            const parsed = value ? new Date(value) : null;
            if (parsed && Number.isFinite(parsed.getTime())) return parsed;
        }
        return null;
    };
    return {
        publishedAt: findDate([
            /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)/i,
            /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:published_time["']/i,
            /<(?:pubDate|published)\b[^>]*>([\s\S]*?)<\/(?:pubDate|published)>/i
        ]),
        updatedAt: findDate([
            /<meta[^>]+property=["']article:modified_time["'][^>]+content=["']([^"']+)/i,
            /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:modified_time["']/i,
            /<(?:updated|lastBuildDate)\b[^>]*>([\s\S]*?)<\/(?:updated|lastBuildDate)>/i
        ])
    };
};

const summarizeMaterialChange = ({ previousExcerpt = '', currentExcerpt = '', isNew = false } = {}) => {
    if (isNew || !previousExcerpt) return {
        changeType: 'new', addedTerms: [], removedTerms: [], terminologyChanged: false,
        summaryPrefix: 'New source material detected.'
    };
    const terms = (value) => new Set(String(value || '').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]{3,}/gu) || []);
    const previousTerms = terms(previousExcerpt);
    const currentTerms = terms(currentExcerpt);
    const addedTerms = [...currentTerms].filter((term) => !previousTerms.has(term)).slice(0, 12);
    const removedTerms = [...previousTerms].filter((term) => !currentTerms.has(term)).slice(0, 12);
    const removalDominates = currentExcerpt.length < previousExcerpt.length * 0.75 && removedTerms.length > addedTerms.length;
    const changeType = removalDominates ? 'removed' : 'updated';
    const parts = [changeType === 'removed'
        ? 'Previously observed guidance may have been removed or substantially shortened.'
        : 'Material source content changed.'];
    if (addedTerms.length) parts.push(`Added terminology: ${addedTerms.join(', ')}.`);
    if (removedTerms.length) parts.push(`Removed terminology: ${removedTerms.join(', ')}.`);
    return {
        changeType, addedTerms, removedTerms,
        terminologyChanged: Boolean(addedTerms.length || removedTerms.length),
        summaryPrefix: parts.join(' ')
    };
};

const assertConfiguredSourcePath = (source) => {
    const pathname = new URL(assertPersistableSourceUrl(source.baseUrl)).pathname;
    const allowPaths = Array.isArray(source.allowPaths) ? source.allowPaths.filter(Boolean) : [];
    const denyPaths = Array.isArray(source.denyPaths) ? source.denyPaths.filter(Boolean) : [];
    if (denyPaths.some((path) => pathname.startsWith(path))) throw new BadRequestError('source_path_denied');
    if (allowPaths.length && !allowPaths.some((path) => pathname.startsWith(path))) throw new BadRequestError('source_path_not_allowed');
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
    baseUrl: sanitizeSourceUrlForRead(source.baseUrl),
    canonicalUrl: sanitizeSourceUrlForRead(source.canonicalUrl || source.baseUrl),
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
    lastError: safeGoogleStoredError(source.lastError),
    lastFetchedAt: source.lastFetchedAt,
    lastPublishedAt: source.lastPublishedAt,
    lastDocumentUpdatedAt: source.lastDocumentUpdatedAt,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt
});

const mapSnapshot = (snapshot) => snapshot ? {
    id: String(snapshot._id || snapshot.id),
    isQaTest: snapshot.isQaTest === true,
    qaBatchId: snapshot.qaBatchId ? String(snapshot.qaBatchId) : '',
    qaCaseId: snapshot.qaCaseId ? String(snapshot.qaCaseId) : '',
    environment: snapshot.environment || '',
    executionMode: snapshot.executionMode || '',
    originalTopicSeed: snapshot.originalTopicSeed || '',
    normalizedTopicKey: snapshot.normalizedTopicKey || '',
    snapshotDate: snapshot.snapshotDate,
    timezone: snapshot.timezone,
    status: snapshot.status,
    checkedAt: snapshot.checkedAt,
    sourcesChecked: snapshot.sourcesChecked,
    successfulSources: snapshot.successfulSources,
    failedSources: snapshot.failedSources,
    mandatorySourcesSucceeded: Boolean(snapshot.mandatorySourcesSucceeded),
    noMaterialChanges: Boolean(snapshot.noMaterialChanges),
    sourceHealth: sanitizeSourceHealth(snapshot.sourceHealth),
    officialChanges: sanitizeSourceUrlItems(snapshot.officialChanges),
    thirdPartyObservations: sanitizeSourceUrlItems(snapshot.thirdPartyObservations),
    currentRules: snapshot.currentRules || [],
    recommendations: sanitizeSourceUrlItems(snapshot.recommendations),
    risks: snapshot.risks || [],
    requiredActions: sanitizeSourceUrlItems(snapshot.requiredActions),
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

    static async getGateConfig({ createSchedule = true } = {}) {
        const existing = await GoogleIntelligenceSchedule.findOne({ singletonKey: 'default' }).lean();
        const schedule = existing || (createSchedule ? await GoogleIntelligenceService.getOrCreateSchedule() : buildDefaultSchedule());
        return {
            enabled: Boolean(schedule.enabled) || parseBoolean(process.env.GOOGLE_INTELLIGENCE_ENABLED, false),
            timezone: schedule.timezone || DEFAULT_TIMEZONE,
            strictGate: Boolean(schedule.strictGate),
            allowLastSuccessfulSnapshot: Boolean(schedule.allowLastSuccessfulSnapshot),
            maxSnapshotAgeHours: Number(schedule.maxSnapshotAgeHours || 24),
            sourceTimeoutMs: Number(schedule.sourceTimeoutMs || 15000),
            retryCount: Number(schedule.retryPolicy?.count || 0),
            retryDelayMs: Number(schedule.retryPolicy?.delayMs || 1000),
            sourceGroups: Array.isArray(schedule.sourceGroups) ? schedule.sourceGroups : ['official']
        };
    }

    static async listSources() {
        await GoogleIntelligenceService.seedDefaultSources();
        const sources = await GoogleIntelligenceSource.find().sort({ official: -1, priority: 1, name: 1 }).lean();
        return { sources: sources.map(mapSource) };
    }

    static async createSource({ payload = {} }) {
        let baseUrl;
        try {
            baseUrl = assertPersistableSourceUrl(payload.baseUrl);
        } catch (error) {
            throw new BadRequestError(safeErrorCode(error));
        }
        if (!['https:'].includes(new URL(baseUrl).protocol)) throw new BadRequestError('source URL must use HTTPS');
        const official = Boolean(payload.official);
        if (official && !officialHostAllowed(baseUrl)) throw new BadRequestError('official sources must use an official Google domain');
        const name = normalizeString(payload.name);
        const sourceType = normalizeString(payload.sourceType || (official ? 'documentation' : 'third_party'));
        if (!name) throw new BadRequestError('source name is required');
        if (!['documentation', 'blog', 'status', 'search_console', 'merchant', 'third_party'].includes(sourceType)) throw new BadRequestError('invalid source type');
        const created = await GoogleIntelligenceSource.create({
            name, sourceType,
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
        const current = await GoogleIntelligenceSource.findById(objectId).select('official').lean();
        if (!current) throw new NotFoundError('Google Intelligence source not found');
        if (Object.hasOwn(update, 'name')) {
            update.name = normalizeString(update.name);
            if (!update.name) throw new BadRequestError('source name is required');
        }
        if (Object.hasOwn(update, 'required')) update.required = Boolean(current.official) && Boolean(update.required);
        if (Array.isArray(update.sourceGroups)) update.sourceGroups = update.sourceGroups.map(normalizeString).filter(Boolean);
        const updated = await GoogleIntelligenceSource.findByIdAndUpdate(objectId, { $set: update }, { new: true, runValidators: true }).lean();
        return mapSource(updated);
    }

    static async fetchSource({ source, fetchOptions = {} }) {
        const attempts = Math.max(1, Number(fetchOptions.retryCount || 0) + 1);
        const sourceFetcher = fetchOptions.sourceFetcher || safeSourceFetch;
        const observedAt = fetchOptions.now instanceof Date ? fetchOptions.now : new Date();
        let lastError;
        for (let attempt = 0; attempt < attempts; attempt += 1) {
            try {
                assertConfiguredSourcePath(source);
                const fetched = await sourceFetcher({
                    url: source.baseUrl,
                    timeoutMs: fetchOptions.timeoutMs,
                    maxBytes: fetchOptions.maxBytes || (source.official ? OFFICIAL_SOURCE_MAX_BYTES : DEFAULT_SOURCE_MAX_BYTES),
                    fetchImpl: fetchOptions.fetchImpl,
                    resolveHostname: fetchOptions.resolveHostname,
                    checkRobots: fetchOptions.checkRobots !== false,
                    allowHttp: Boolean(fetchOptions.allowHttp),
                    expectedMode: source.fetchMode
                });
                const normalizedText = stripMarkup(fetched.body).slice(0, 120_000);
                const currentHash = sha256(normalizedText);
                const previousHash = source.lastContentHash || '';
                const previousExcerpt = source.lastExcerpt || '';
                const changed = Boolean(previousHash && previousHash !== currentHash);
                const isNew = !previousHash;
                const title = extractTitle(fetched.body, source.name);
                const documentDates = extractDocumentDates(fetched.body);
                const baselineUpdate = fetchOptions.updateBaseline === false ? {} : {
                    lastContentHash: currentHash,
                    lastExcerpt: normalizedText.slice(0, 4000),
                    lastPublishedAt: documentDates.publishedAt,
                    lastDocumentUpdatedAt: documentDates.updatedAt
                };
                return {
                    ok: true, sourceId: String(source._id), sourceName: source.name,
                    sourceUrl: fetched.canonicalUrl, official: Boolean(source.official), required: Boolean(source.required),
                    title, previousHash, currentHash, previousExcerpt, changed, isNew,
                    publishedAt: documentDates.publishedAt, updatedAt: documentDates.updatedAt,
                    excerpt: normalizedText.slice(0, 1200), fetchedAt: fetched.fetchedAt,
                    deferredSourceUpdate: {
                        canonicalUrl: fetched.canonicalUrl,
                        lastSuccessAt: fetched.fetchedAt,
                        lastFetchedAt: fetched.fetchedAt,
                        lastError: '',
                        lastTitle: title,
                        ...baselineUpdate
                    }
                };
            } catch (error) {
                lastError = error;
                if (attempt + 1 < attempts) {
                    await new Promise((resolve) => setTimeout(resolve, Math.max(100, Number(fetchOptions.retryDelayMs || 1000))));
                }
            }
        }
        const message = safeGoogleWriteError(lastError?.code, 'GOOGLE_SOURCE_FETCH_FAILED');
        return {
            ok: false,
            sourceId: String(source._id),
            sourceName: source.name,
            sourceUrl: sanitizeSourceUrlForRead(source.baseUrl),
            official: Boolean(source.official),
            required: Boolean(source.required),
            error: message,
            deferredSourceUpdate: { lastFailureAt: observedAt, lastFetchedAt: observedAt, lastError: message }
        };
    }

    static async executeWorkflow({
        now = new Date(), triggeredBy = 'gate', adminId = null, force = false,
        fetchOptions = {}, dueAt = null, trustedQaContext = null
    } = {}, dependencies = {}) {
        const qaContext = normalizeTrustedQaProvenance(trustedQaContext);
        const provenance = qaProvenanceDocument(qaContext);
        const SourceModel = dependencies.SourceModel || GoogleIntelligenceSource;
        const RunModel = dependencies.RunModel || GoogleIntelligenceRun;
        const SnapshotModel = dependencies.SnapshotModel || GoogleIntelligenceSnapshot;
        const ChangeModel = dependencies.ChangeModel || GoogleIntelligenceChange;
        const clock = dependencies.clock || (() => new Date());
        const sleep = dependencies.sleep || ((duration) => new Promise((resolve) => setTimeout(resolve, duration)));
        const heartbeatFactory = dependencies.buildHeartbeatFactory || createGoogleBuildLeaseHeartbeat;
        if (!qaContext) {
            await (dependencies.seedDefaultSources || GoogleIntelligenceService.seedDefaultSources)();
        }
        const config = dependencies.config || await GoogleIntelligenceService.getGateConfig({ createSchedule: !qaContext });
        const timezone = fetchOptions.timezone || config.timezone;
        const snapshotDate = dateInTimezone(now, timezone);
        const snapshotBase = { snapshotDate, timezone };
        const snapshotKey = { ...snapshotBase, ...qaScopeFilter(qaContext) };
        const snapshotDocument = { ...snapshotBase, ...provenance };
        let existingQuery = SnapshotModel.findOne(snapshotKey);
        existingQuery = selectInternalBuildFields(existingQuery);
        const existing = await leanQuery(existingQuery);
        if (!force && existing && isSnapshotAcceptable({ snapshot: existing, strictGate: config.strictGate, maxAgeHours: config.maxSnapshotAgeHours, now })) {
            // A process may die after the authoritative snapshot CAS but before its
            // run terminal CAS. Reconcile only the run linked to this exact completed
            // generation; failure is best effort and never weakens the Google gate.
            await reconcileCompletedGoogleRun({ RunModel, snapshot: existing, completedAt: new Date(clock()) }).catch(() => false);
            return { snapshot: mapSnapshot(existing), reused: true };
        }

        const buildToken = crypto.randomUUID();
        const leaseMs = Math.max(1_000, Number(fetchOptions.leaseMs || LEASE_MS));
        const leaseClaimedAt = new Date(clock());
        const leaseUntil = new Date(leaseClaimedAt.getTime() + leaseMs);
        const leaseFilter = {
            ...snapshotKey,
            $or: [
                { leaseUntil: null },
                { leaseUntil: { $exists: false } },
                { leaseUntil: { $lte: leaseClaimedAt } }
            ]
        };
        const leaseUpdate = {
            $setOnInsert: {
                ...snapshotDocument,
                checkedAt: now,
                contentHash: sha256(`${snapshotDate}:${timezone}:building`)
            },
            $set: {
                status: 'building',
                buildToken,
                leaseUntil,
                lastBuildError: ''
            },
            $inc: { buildGeneration: 1 }
        };
        let claimed = null;
        try {
            let claimQuery = SnapshotModel.findOneAndUpdate(leaseFilter, leaseUpdate, {
                upsert: !existing,
                new: true,
                setDefaultsOnInsert: true,
                runValidators: true
            });
            claimQuery = selectInternalBuildFields(claimQuery);
            claimed = await leanQuery(claimQuery);
        } catch (error) {
            if (error?.code !== 11000) throw error;
        }
        if (!claimed) {
            const maxAttempts = Math.max(1, Number(dependencies.concurrentPollAttempts) || Math.ceil(CONCURRENT_SNAPSHOT_WAIT_MS / CONCURRENT_SNAPSHOT_POLL_MS));
            for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
                const concurrent = await leanQuery(SnapshotModel.findOne(snapshotKey));
                if (concurrent && concurrent.status !== 'building') {
                    if (isSnapshotAcceptable({ snapshot: concurrent, strictGate: config.strictGate, maxAgeHours: config.maxSnapshotAgeHours, now })) {
                        return { snapshot: mapSnapshot(concurrent), reused: true, concurrent: true };
                    }
                    if (concurrent.status === 'failed') throw googleBuildError(GOOGLE_BUILD_FAILED_CODE);
                }
                await sleep(Number(dependencies.concurrentPollMs) || CONCURRENT_SNAPSHOT_POLL_MS);
            }
            throw googleBuildError(GOOGLE_BUILD_BUSY_CODE);
        }

        const buildGeneration = Math.max(1, Number(claimed.buildGeneration || 0));
        const heartbeat = heartbeatFactory({
            SnapshotModel,
            snapshotKey,
            buildToken,
            buildGeneration,
            leaseMs,
            clock
        });
        const assertLease = async () => {
            if (!await heartbeat.beat()) throw googleBuildError(GOOGLE_BUILD_LEASE_LOST_CODE);
        };
        const { executionKey, executionSlotKey } = buildGoogleExecutionKey({
            triggeredBy,
            snapshotDate,
            timezone,
            dueAt: dueAt || now,
            generation: buildGeneration,
            scopeKey: qaExecutionScopeKey(qaContext)
        });
        const startedAt = new Date(clock());
        let run = null;
        let snapshotCompleted = false;
        try {
            let runQuery = RunModel.findOneAndUpdate(
                {
                    executionKey,
                    $or: [
                        { snapshotGeneration: { $exists: false } },
                        { snapshotGeneration: { $lt: buildGeneration } },
                        { snapshotGeneration: buildGeneration, buildToken }
                    ]
                },
                {
                    $setOnInsert: { executionKey },
                    $set: {
                        ...provenance,
                        executionSlotKey,
                        scheduledAt: dueAt || now,
                        startedAt,
                        completedAt: null,
                        timezone,
                        snapshotDate,
                        status: 'running',
                        triggeredBy,
                        triggeredByAdminId: convertToObjectIdMongodb(adminId) || null,
                        snapshotId: claimed._id,
                        snapshotGeneration: buildGeneration,
                        buildToken,
                        error: '',
                        correlationId: crypto.randomUUID()
                    }
                },
                { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
            );
            if (typeof runQuery?.select === 'function') runQuery = runQuery.select('+buildToken');
            run = await leanQuery(runQuery);
            if (!run) throw googleBuildError(GOOGLE_BUILD_BUSY_CODE);

            const sourceQuery = { enabled: true };
            if (config.sourceGroups.length) sourceQuery.sourceGroups = { $in: config.sourceGroups };
            let sourcesQuery = SourceModel.find(sourceQuery).sort({ official: -1, priority: 1 });
            if (typeof sourcesQuery?.select === 'function') {
                sourcesQuery = sourcesQuery.select('+lastContentHash +lastExcerpt +baselineSnapshotDate +baselineGeneration');
            }
            const sources = await leanQuery(sourcesQuery);
            const results = [];
            for (const source of sources) {
                results.push(await GoogleIntelligenceService.fetchSource({
                    source,
                    fetchOptions: {
                        timeoutMs: fetchOptions.timeoutMs || config.sourceTimeoutMs,
                        retryCount: fetchOptions.retryCount ?? config.retryCount,
                        retryDelayMs: fetchOptions.retryDelayMs || config.retryDelayMs,
                        fetchImpl: fetchOptions.fetchImpl,
                        sourceFetcher: fetchOptions.sourceFetcher,
                        resolveHostname: fetchOptions.resolveHostname,
                        checkRobots: fetchOptions.checkRobots,
                        allowHttp: fetchOptions.allowHttp,
                        now
                    }
                }));
                await assertLease();
                if (results.length < sources.length) await sleep(150);
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
                const materialChange = summarizeMaterialChange({
                    previousExcerpt: item.previousExcerpt,
                    currentExcerpt: item.excerpt,
                    isNew: item.isNew
                });
                return {
                    fingerprint: sha256(`${item.sourceId}:${item.currentHash}`), sourceId: item.sourceId,
                    title: item.title, sourceUrl: item.sourceUrl, sourceLevel: item.official ? 'official' : 'third_party',
                    changeType: materialChange.changeType, severity, detectedAt: now,
                    publishedAt: item.publishedAt || null,
                    previousHash: item.previousHash, currentHash: item.currentHash,
                    summary: `${materialChange.summaryPrefix} ${item.excerpt.slice(0, 500)}`.slice(0, 700),
                    officialStatement: item.official ? item.excerpt.slice(0, 700) : '',
                    analystInterpretation: item.official ? 'Review the verified source before changing editorial policy.' : 'Third-party observation; it cannot override official Google guidance.',
                    impactOnInoxpran: affectedArea === 'content_quality' ? 'Review people-first usefulness and source attribution.' : `Review the ${affectedArea.replace(/_/g, ' ')} implementation.`,
                    recommendedAction: severity === 'critical' || severity === 'high' ? 'Pause affected auto-publishing until an editor reviews this change.' : 'Monitor and include the verified guidance in the next strategy plan.',
                    affectedArea, actionStatus: severity === 'informational' ? 'monitoring' : 'pending_review',
                    changeDetails: materialChange,
                    confidence: item.official ? 1 : 0.6
                };
            });

            const snapshotPayload = {
                ...provenance,
                snapshotDate, timezone, status, checkedAt: now, sourcesChecked: results.length,
                successfulSources: successful.length, failedSources: failed.length, mandatorySourcesSucceeded,
                noMaterialChanges: changedResults.length === 0,
                sourceHealth: results.map((item) => ({
                    sourceId: item.sourceId, name: item.sourceName, url: item.sourceUrl,
                    official: item.official, required: item.required, ok: item.ok, error: item.error || '', fetchedAt: item.fetchedAt || now
                })),
                officialChanges: changeDrafts.filter((item) => item.sourceLevel === 'official').map((item) => ({
                    title: item.title, sourceUrl: item.sourceUrl, severity: item.severity,
                    changeType: item.changeType, affectedArea: item.affectedArea,
                    actionStatus: item.actionStatus, changeDetails: item.changeDetails, summary: item.summary
                })),
                thirdPartyObservations: changeDrafts.filter((item) => item.sourceLevel === 'third_party').map((item) => ({
                    title: item.title, sourceUrl: item.sourceUrl, severity: item.severity,
                    changeType: item.changeType, affectedArea: item.affectedArea,
                    actionStatus: item.actionStatus, changeDetails: item.changeDetails, summary: item.summary
                })),
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
            await assertLease();
            const snapshot = await leanQuery(SnapshotModel.findOneAndUpdate(
                {
                    ...snapshotKey,
                    status: 'building',
                    buildToken,
                    buildGeneration
                },
                {
                    $set: {
                        ...snapshotPayload,
                        completedGeneration: buildGeneration,
                        lastBuildError: ''
                    },
                    $unset: { buildToken: '', leaseUntil: '' }
                },
                { new: true, runValidators: true }
            ));
            if (!snapshot) throw googleBuildError(GOOGLE_BUILD_LEASE_LOST_CODE);
            snapshotCompleted = true;
            await heartbeat.stop();

            let deferredError = '';
            if (!qaContext) {
                for (const result of results) {
                    try {
                        await SourceModel.updateOne(
                            sourceGenerationFilter({ sourceId: result.sourceId, snapshotDate, buildGeneration }),
                            {
                                $set: {
                                    ...(result.deferredSourceUpdate || {}),
                                    baselineSnapshotDate: snapshotDate,
                                    baselineGeneration: buildGeneration
                                }
                            }
                        );
                    } catch (error) {
                        deferredError ||= safeGoogleWriteError(error?.code, 'GOOGLE_SOURCE_BASELINE_COMMIT_FAILED');
                    }
                }
            }

            if (!qaContext) {
                for (const draft of changeDrafts) {
                    try {
                        await ChangeModel.updateOne(
                            {
                                fingerprint: draft.fingerprint,
                                $or: [
                                    { snapshotId: snapshot._id, snapshotGeneration: { $exists: false } },
                                    { snapshotId: snapshot._id, snapshotGeneration: { $lte: buildGeneration } },
                                    { snapshotId: { $exists: false }, snapshotGeneration: { $exists: false } },
                                    { snapshotId: null, snapshotGeneration: { $exists: false } },
                                    { snapshotId: null, snapshotGeneration: { $lte: buildGeneration } }
                                ]
                            },
                            { $set: { ...draft, snapshotId: snapshot._id, snapshotGeneration: buildGeneration } },
                            { upsert: true }
                        );
                    } catch (error) {
                        if (error?.code !== 11000) {
                            deferredError ||= safeGoogleWriteError(error?.code, 'GOOGLE_CHANGE_COMMIT_FAILED');
                        }
                    }
                }
            }
            const runTerminal = await RunModel.updateOne({
                _id: run._id,
                status: 'running',
                buildToken,
                snapshotGeneration: buildGeneration
            }, {
                $set: {
                    status, completedAt: new Date(clock()), snapshotId: snapshot._id,
                    sourceResults: results.map((item) => ({ sourceId: item.sourceId, name: item.sourceName, ok: item.ok, official: item.official, required: item.required, changed: item.changed || item.isNew || false, error: item.error || '' })),
                    changesDetected: changeDrafts.length,
                    criticalChanges: changeDrafts.filter((item) => item.severity === 'critical').length,
                    error: deferredError
                },
                $unset: { buildToken: '' }
            });
            if (explicitOwnerUpdateFailed(runTerminal)) throw googleBuildError(GOOGLE_BUILD_LEASE_LOST_CODE);
            return { snapshot: mapSnapshot(snapshot), reused: false, runId: String(run._id) };
        } catch (cause) {
            await heartbeat.stop();
            const errorCode = [GOOGLE_BUILD_BUSY_CODE, GOOGLE_BUILD_LEASE_LOST_CODE].includes(cause?.code)
                ? cause.code
                : GOOGLE_BUILD_FAILED_CODE;
            if (!snapshotCompleted) {
                try {
                    await SnapshotModel.updateOne(
                        { ...snapshotKey, status: 'building', buildToken, buildGeneration },
                        {
                            $set: { status: 'failed', checkedAt: now, lastBuildError: errorCode },
                            $unset: { buildToken: '', leaseUntil: '' }
                        }
                    );
                } catch (_snapshotFailure) {
                    // Only bounded state is attempted; storage details are never persisted.
                }
            }
            if (run?._id) {
                try {
                    await RunModel.updateOne(
                        { _id: run._id, status: 'running', buildToken, snapshotGeneration: buildGeneration },
                        {
                            $set: { status: 'failed', completedAt: new Date(clock()), error: errorCode },
                            $unset: { buildToken: '' }
                        }
                    );
                } catch (_runFailure) {
                    // The caller still receives the bounded workflow code.
                }
            }
            throw googleBuildError(errorCode);
        } finally {
            await heartbeat.stop();
        }
    }

    static async ensureGoogleIntelligenceSnapshotForDate({
        now = new Date(),
        fetchOptions = {},
        createSchedule = true,
        trustedQaContext = null
    } = {}) {
        const qaContext = normalizeTrustedQaProvenance(trustedQaContext);
        const config = await GoogleIntelligenceService.getGateConfig({ createSchedule: qaContext ? false : createSchedule });
        const snapshotDate = dateInTimezone(now, config.timezone);
        const snapshotBase = { snapshotDate, timezone: config.timezone };
        if (qaContext) {
            const productionSnapshot = await GoogleIntelligenceSnapshot.findOne({
                ...snapshotBase,
                isQaTest: { $ne: true }
            }).lean();
            if (isSnapshotAcceptable({ snapshot: productionSnapshot, strictGate: config.strictGate, maxAgeHours: config.maxSnapshotAgeHours, now })) {
                return mapSnapshot(productionSnapshot);
            }
        }
        let snapshot = await GoogleIntelligenceSnapshot.findOne({
            ...snapshotBase,
            ...qaScopeFilter(qaContext)
        }).lean();
        if (!isSnapshotAcceptable({ snapshot, strictGate: config.strictGate, maxAgeHours: config.maxSnapshotAgeHours, now })) {
            if (config.enabled) {
                const result = await GoogleIntelligenceService.executeWorkflow({
                    now,
                    triggeredBy: 'gate',
                    fetchOptions,
                    ...(qaContext ? { trustedQaContext: qaContext } : {})
                });
                snapshot = await GoogleIntelligenceSnapshot.findById(result.snapshot.id).lean();
            } else if (config.allowLastSuccessfulSnapshot) {
                snapshot = await GoogleIntelligenceSnapshot.findOne({
                    isQaTest: { $ne: true },
                    status: { $in: ['completed_with_changes', 'completed_no_change', 'partial', 'manually_overridden'] }
                }).sort({ checkedAt: -1 }).lean();
            }
        }
        if (!isSnapshotAcceptable({ snapshot, strictGate: config.strictGate, maxAgeHours: config.maxSnapshotAgeHours, now })) {
            throw googleSnapshotUnavailableError();
        }
        return mapSnapshot(snapshot);
    }

    static async getStatus() {
        await GoogleIntelligenceService.seedDefaultSources();
        const [config, latestSnapshot, latestRun, sourceCounts, schedule] = await Promise.all([
            GoogleIntelligenceService.getGateConfig(),
            GoogleIntelligenceSnapshot.findOne({ isQaTest: { $ne: true } }).sort({ checkedAt: -1 }).lean(),
            GoogleIntelligenceRun.findOne({ isQaTest: { $ne: true } }).sort({ createdAt: -1 }).lean(),
            GoogleIntelligenceSource.aggregate([{ $group: { _id: null, total: { $sum: 1 }, enabled: { $sum: { $cond: ['$enabled', 1, 0] } }, failing: { $sum: { $cond: [{ $ne: ['$lastError', ''] }, 1, 0] } } } }]),
            GoogleIntelligenceService.getOrCreateSchedule()
        ]);
        const gateOpen = isSnapshotAcceptable({ snapshot: latestSnapshot, strictGate: config.strictGate, maxAgeHours: config.maxSnapshotAgeHours });
        return {
            enabled: config.enabled, strictGate: config.strictGate, gateOpen,
            snapshot: mapSnapshot(latestSnapshot),
            latestRun: latestRun ? { id: String(latestRun._id), status: latestRun.status, startedAt: latestRun.startedAt, completedAt: latestRun.completedAt, changesDetected: latestRun.changesDetected, error: safeGoogleStoredError(latestRun.error) } : null,
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
            GoogleIntelligenceSnapshot.find({ isQaTest: { $ne: true } }).sort({ checkedAt: -1 }).skip((safePage - 1) * safeLimit).limit(safeLimit).lean(),
            GoogleIntelligenceSnapshot.countDocuments({ isQaTest: { $ne: true } })
        ]);
        return { snapshots: items.map(mapSnapshot), pagination: { page: safePage, limit: safeLimit, total, pages: Math.max(1, Math.ceil(total / safeLimit)) } };
    }

    static async getSnapshot({ snapshotId }) {
        const objectId = convertToObjectIdMongodb(snapshotId);
        if (!objectId) throw new BadRequestError('Invalid snapshot id');
        let snapshotQuery = GoogleIntelligenceSnapshot.findOne({
            _id: objectId,
            isQaTest: { $ne: true }
        });
        snapshotQuery = selectInternalBuildFields(snapshotQuery);
        const snapshot = await leanQuery(snapshotQuery);
        if (!snapshot) throw new NotFoundError('Google Intelligence snapshot not found');
        const completedGeneration = Number(snapshot.completedGeneration || 0);
        const generationFilter = completedGeneration > 0
            ? { snapshotGeneration: completedGeneration }
            : { $or: [{ snapshotGeneration: 0 }, { snapshotGeneration: { $exists: false } }] };
        let changesQuery = GoogleIntelligenceChange.find({
            snapshotId: objectId,
            ...generationFilter
        }).sort({ severity: 1, detectedAt: -1 });
        if (typeof changesQuery?.select === 'function') changesQuery = changesQuery.select('+snapshotGeneration');
        const changes = await leanQuery(changesQuery);
        return {
            snapshot: mapSnapshot(snapshot),
            changes: changes.map((item) => ({
                ...item,
                id: String(item._id),
                sourceId: String(item.sourceId),
                snapshotId: String(item.snapshotId),
                sourceUrl: sanitizeSourceUrlForRead(item.sourceUrl)
            }))
        };
    }

    static mapSchedule(schedule) {
        return {
            id: String(schedule._id || schedule.id), name: schedule.name, enabled: Boolean(schedule.enabled),
            timezone: schedule.timezone, scheduleType: schedule.scheduleType, daily: schedule.daily || { times: [] },
            interval: schedule.interval || { value: 24, unit: 'hours' }, sourceGroups: schedule.sourceGroups || [],
            strictGate: Boolean(schedule.strictGate), allowLastSuccessfulSnapshot: Boolean(schedule.allowLastSuccessfulSnapshot),
            maxSnapshotAgeHours: schedule.maxSnapshotAgeHours, sourceTimeoutMs: schedule.sourceTimeoutMs,
            retryPolicy: schedule.retryPolicy || { count: 2, delayMs: 1000 }, lastRunAt: schedule.lastRunAt,
            nextRunAt: schedule.nextRunAt, lastRunStatus: schedule.lastRunStatus || '', lastError: safeGoogleStoredError(schedule.lastError)
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
        const source = await GoogleIntelligenceSource.findById(objectId).select('+lastContentHash +lastExcerpt').lean();
        if (!source) throw new NotFoundError('Google Intelligence source not found');
        const config = await GoogleIntelligenceService.getGateConfig();
        return GoogleIntelligenceService.fetchSource({
            source,
            fetchOptions: {
                timeoutMs: config.sourceTimeoutMs,
                retryCount: config.retryCount,
                retryDelayMs: config.retryDelayMs,
                updateBaseline: false
            }
        });
    }

    static async overrideSnapshot({ snapshotId, reason, adminId }) {
        const objectId = convertToObjectIdMongodb(snapshotId);
        const adminObjectId = convertToObjectIdMongodb(adminId);
        const normalizedReason = normalizeString(reason);
        if (!objectId) throw new BadRequestError('Invalid snapshot id');
        if (!adminObjectId) throw new BadRequestError('Valid admin is required');
        if (normalizedReason.length < 10) throw new BadRequestError('Override reason must be at least 10 characters');
        const current = await GoogleIntelligenceSnapshot.findOne({
            _id: objectId,
            isQaTest: { $ne: true }
        }).lean();
        if (!current) throw new NotFoundError('Google Intelligence snapshot not found');
        const updated = await GoogleIntelligenceSnapshot.findOneAndUpdate({
            _id: objectId,
            isQaTest: { $ne: true }
        }, {
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
        const runs = await GoogleIntelligenceRun.find({ isQaTest: { $ne: true } }).sort({ createdAt: -1 }).limit(Math.min(Math.max(Number(limit) || 30, 1), MAX_LIST_LIMIT)).lean();
        return { executions: runs.map((run) => ({
            id: String(run._id), executionKey: run.executionKey, snapshotDate: run.snapshotDate,
            timezone: run.timezone, status: run.status, startedAt: run.startedAt, completedAt: run.completedAt,
            changesDetected: run.changesDetected, criticalChanges: run.criticalChanges,
            triggeredBy: run.triggeredBy,
            error: safeGoogleStoredError(run.error),
            sourceResults: (run.sourceResults || []).map((item) => ({
                ...item,
                error: safeGoogleStoredError(item?.error)
            }))
        })) };
    }

    static async listRelatedBlogs({ limit = 30 } = {}) {
        const blogs = await Blog.find({
            googleIntelSnapshotId: { $ne: null },
            isQaTest: { $ne: true }
        })
            .sort({ createdAt: -1 })
            .limit(Math.min(Math.max(Number(limit) || 30, 1), MAX_LIST_LIMIT))
            .select('_id blog_title isDraft isPublished googleIntelSnapshotId googleIntelSnapshotDate googleIntelStatus researchBundleId editorialStyleProfileId strategyPlanId agenticExecutionId structuralFingerprint agenticReviews createdAt updatedAt')
            .lean();
        return {
            blogs: blogs.map((item) => ({
                id: String(item._id), title: item.blog_title, isDraft: Boolean(item.isDraft), isPublished: Boolean(item.isPublished),
                googleIntelSnapshotId: String(item.googleIntelSnapshotId || ''), googleIntelSnapshotDate: item.googleIntelSnapshotDate || '',
                googleIntelStatus: item.googleIntelStatus || '', researchBundleId: String(item.researchBundleId || ''),
                editorialStyleProfileId: String(item.editorialStyleProfileId || ''), strategyPlanId: String(item.strategyPlanId || ''),
                agenticExecutionId: String(item.agenticExecutionId || ''), structuralFingerprint: item.structuralFingerprint || null,
                originalityReview: item.agenticReviews?.originality || null,
                createdAt: item.createdAt, updatedAt: item.updatedAt
            }))
        };
    }

    static async claimDueSchedule({ workerId, now = new Date() }) {
        if (!parseBoolean(process.env.GOOGLE_INTELLIGENCE_ENABLED, false)) return null;
        await GoogleIntelligenceService.getOrCreateSchedule();
        const ownerToken = createScheduleLeaseOwner(workerId);
        return GoogleIntelligenceSchedule.findOneAndUpdate(
            { singletonKey: 'default', enabled: true, nextRunAt: { $ne: null, $lte: now }, $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }] },
            { $set: { lockedBy: ownerToken, leaseUntil: new Date(now.getTime() + LEASE_MS) } },
            { new: true }
        ).lean();
    }

    static async runDueOnce({ workerId, now = new Date() }, dependencies = {}) {
        const schedule = await GoogleIntelligenceService.claimDueSchedule({ workerId, now });
        if (!schedule) return null;
        const ScheduleModel = dependencies.ScheduleModel || GoogleIntelligenceSchedule;
        const heartbeatFactory = dependencies.heartbeatFactory || createGoogleScheduleLeaseHeartbeat;
        const heartbeat = heartbeatFactory({
            ScheduleModel, scheduleId: schedule._id, ownerToken: schedule.lockedBy,
            leaseMs: LEASE_MS, clock: dependencies.clock || (() => new Date())
        });
        try {
            const result = await GoogleIntelligenceService.executeWorkflow({
                now,
                triggeredBy: 'scheduled',
                dueAt: schedule.nextRunAt || now
            });
            if (!await heartbeat.beat()) throw new Error('google_intelligence_schedule_lease_lost');
            await heartbeat.stop();
            const nextRunAt = calculateNextRun({ schedule: { ...schedule, lastRunAt: now }, from: now });
            const terminal = await ScheduleModel.updateOne(
                { _id: schedule._id, lockedBy: schedule.lockedBy },
                { $set: { lastRunAt: now, nextRunAt, lastRunStatus: result.snapshot.status, lastError: '', leaseUntil: null, lockedBy: '' } }
            );
            if (explicitOwnerUpdateFailed(terminal)) throw new Error('google_intelligence_schedule_lease_lost');
            return result;
        } catch (error) {
            await heartbeat.stop();
            const nextRunAt = calculateNextRun({ schedule: { ...schedule, lastRunAt: now }, from: now });
            await ScheduleModel.updateOne(
                { _id: schedule._id, lockedBy: schedule.lockedBy },
                { $set: { lastRunAt: now, nextRunAt, lastRunStatus: 'failed', lastError: safeGoogleWriteError(error?.code, 'GOOGLE_INTELLIGENCE_SCHEDULE_FAILED'), leaseUntil: null, lockedBy: '' } }
            );
            throw error;
        } finally {
            await heartbeat.stop();
        }
    }
}

module.exports = {
    DEFAULT_SOURCES,
    GOOGLE_SNAPSHOT_UNAVAILABLE_CODE,
    GoogleIntelligenceService,
    buildGoogleExecutionKey,
    buildGoogleExecutionSlotKey,
    classifyAffectedArea,
    classifySeverity,
    createGoogleBuildLeaseHeartbeat,
    createGoogleScheduleLeaseHeartbeat,
    createScheduleLeaseOwner,
    extractDocumentDates,
    extractTitle,
    googleSnapshotUnavailableError,
    mapSnapshot,
    mapSource,
    officialHostAllowed,
    reconcileCompletedGoogleRun,
    sourceGenerationFilter,
    summarizeMaterialChange,
    stripMarkup
};
