'use strict'

const crypto = require('node:crypto')
const { convertToObjectIdMongodb } = require('../../utils')
const { BadRequestError, NotFoundError } = require('../../core/error.response')
const { getContentOperationsConfig, resolveTopicRoadmapPolicy } = require('../../config/contentOperations.config')
const { safeStoredErrorCode } = require('../../utils/httpError.util')
const { BlogAutomationSchedule } = require('../../models/blogAutomationSchedule.model')
const { BlogAutomationExecution } = require('../../models/blogAutomationExecution.model')
const { ContentInventoryItem } = require('../../models/contentInventoryItem.model')
const { ProductCatalogIntelligenceService } = require('../productCatalogIntelligence.service')
const { GoogleIntelligenceService } = require('../googleIntelligence.service')
const { ContentOperationsIntelligenceService } = require('./contentOperationsIntelligence.service')
const { generateBlogIdeas } = require('./blogIdeation.service')
const { BlogNoveltyIndexService, INDEX_VERSION } = require('./blogNoveltyIndex.service')
const {
    assessTopicPlanReachability,
    buildTopicScoreHash,
    scoreTopicPlan,
    RUBRIC_VERSION,
    EVIDENCE_ALIGNMENT_VERSION,
    assessTopicEvidenceAlignment,
    ACCEPTANCE_SCORE,
    MIN_NOVELTY_SUBTOTAL,
    ROADMAP_REQUIRED_EVIDENCE_UNAVAILABLE,
    ROADMAP_SCORE_UNREACHABLE,
    resolveRoadmapThresholds
} = require('./topicRoadmapScoring.service')
const { buildTopicResearchQueryPack } = require('./topicResearchQuery.service')
const { SOURCE_RELEVANCE_VERSION } = require('./sourceRelevanceScoring.service')
const { TopicIdeationOrchestratorService } = require('./topicIdeationOrchestrator.service')
const { textSimilarity } = require('../../utils/agenticBlogCore.util')

const ROADMAP_STATUSES = new Set(['needs_refill', 'refilling', 'ready', 'partial', 'failed', 'archived'])
const ITEM_STATUSES = new Set(['ready', 'claimed', 'completed', 'dismissed', 'invalidated', 'failed'])
const TRANSIENT_FAILURE_CODES = new Set([
    'CONTENT_OPERATIONS_LEASE_BUSY',
    'CONTENT_OPERATIONS_LEASE_LOST',
    'CONTENT_OPERATIONS_RUN_LEASE_LOST',
    'GOOGLE_INTELLIGENCE_BUILD_BUSY',
    'GOOGLE_INTELLIGENCE_BUILD_LEASE_LOST',
    'ROADMAP_INTELLIGENCE_UNAVAILABLE',
    'OPENCLAW_AGENT_GATEWAY_UNREACHABLE',
    'OPENCLAW_AGENT_HTTP_408',
    'OPENCLAW_AGENT_HTTP_429',
    'OPENCLAW_AGENT_HTTP_500',
    'OPENCLAW_AGENT_HTTP_502',
    'OPENCLAW_AGENT_HTTP_503',
    'OPENCLAW_AGENT_HTTP_504',
    'OPENCLAW_AGENT_TIMEOUT',
    'ROADMAP_REGENERATION_LEASE_LOST',
    'source_request_timeout'
])
const isTransientFailureCode = (code) => TRANSIENT_FAILURE_CODES.has(code)

const sha256 = (value) => crypto.createHash('sha256').update(String(value ?? '')).digest('hex')
const text = (value, max = 300) => String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
const list = (value, maxItems = 12, maxLen = 160) => {
    const source = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,;|\n]/) : []
    return [...new Set(source.map((item) => text(item, maxLen)).filter(Boolean))].slice(0, maxItems)
}
const asPlain = (value) => typeof value?.toObject === 'function' ? value.toObject() : value || {}
const asId = (value) => String(value?._id || value?.id || value || '')
const normalizeTopicKey = (value) => text(value, 500)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase('vi')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
const uniquenessKeyFor = (idea) => sha256([
    normalizeTopicKey(idea?.topic),
    normalizeTopicKey(idea?.angle),
    normalizeTopicKey(idea?.primaryQuestion)
].join('\0'))
const isDuplicateKeyError = (error) => error?.code === 11000
const publicCode = (value) => {
    const candidate = text(value, 160)
    if (!candidate) return ''
    if (/^[A-Z0-9][A-Z0-9_.-]{0,159}$/i.test(candidate)) return candidate
    return safeStoredErrorCode(candidate)
}
const safeDetail = (value) => text(value, 240)
    .replace(/https?:\/\/[^\s<>"']+/gi, '[link removed]')
    .replace(/\b(?:authorization|token|secret|password|credential|api[_-]?key)\b\s*[:=]\s*[^\s,;]+/gi, '[redacted]')
const epochFor = ({ roadmapId, directionRevision, generation, seed = '' }) => sha256([
    asId(roadmapId),
    Number(directionRevision || 1),
    Number(generation || 0),
    String(seed || '')
].join('\0')).slice(0, 40)
const duplicateKeyField = (error) => String(
    Object.keys(error?.keyPattern || error?.keyValue || {})[0] || ''
)
const isRegenerationIdempotencyDuplicate = (error) => (
    isDuplicateKeyError(error) && (
        ['idempotencyKeyHash', 'coalescedIdempotencyKeyHashes'].includes(duplicateKeyField(error)) ||
        String(error?.message || '').includes('topic_roadmap_regeneration_idempotency_unique') ||
        String(error?.message || '').includes('topic_roadmap_regeneration_coalesced_idempotency_unique')
    )
)

const regenerationError = (code, message = code) => Object.assign(new Error(message), { code })

const hasCurrentEvidenceIntegrity = (item = {}) => (
    Array.isArray(item.marketEvidence) &&
    item.marketEvidence.length > 0 &&
    item.marketEvidence.every((evidence) => (
        text(evidence.evidenceId, 160) &&
        text(evidence.contentHash, 128) &&
        evidence.relevanceVersion === SOURCE_RELEVANCE_VERSION &&
        Number(evidence.relevanceScore || 0) > 0
    ))
)

// The effective policy must be threaded in. Comparing against the compiled-in
// default while claimableReadyMatch queried the configured one let an item be
// selected as ready and then rejected at claim time, retiring every candidate in
// a loop that reads as an intermittent "no topic available" failure.
const hasValidTopicScoreIntegrity = (item = {}, policy = {}) => {
    const { acceptanceScore, minimumNoveltySubtotal } = resolveRoadmapThresholds({
        acceptanceScore: Number(policy.acceptanceScore) || ACCEPTANCE_SCORE,
        minimumNoveltySubtotal: Number(policy.minimumNoveltySubtotal) || MIN_NOVELTY_SUBTOTAL
    })
    const scoreHash = text(item.scores?.scoreHash, 128)
    const candidateId = text(item.candidateProvenance?.candidateId, 160)
    const productEvidenceRequired = item.scores?.trustedSignals?.productEvidenceRequired === true
    if (
        !/^[a-f0-9]{64}$/.test(scoreHash) ||
        !candidateId ||
        !hasCurrentEvidenceIntegrity(item) ||
        item.scores?.rubricVersion !== RUBRIC_VERSION ||
        item.scores?.corpusVersion !== INDEX_VERSION ||
        item.scores?.hardGatesPassed !== true ||
        item.scores?.hardGates?.sources !== true ||
        item.scores?.hardGates?.products !== true ||
        item.scores?.hardGates?.evidenceAlignment !== true ||
        item.scores?.trustedSignals?.evidenceAlignment?.version !== EVIDENCE_ALIGNMENT_VERSION ||
        Number(item.scores?.totalScore || 0) < acceptanceScore ||
        Number(item.scores?.noveltySubtotal || 0) < minimumNoveltySubtotal ||
        (productEvidenceRequired && !(item.productEvidence || []).length)
    ) return false
    const idea = {
        topic: item.topic,
        angle: item.angle,
        primaryKeyword: item.primaryKeyword,
        primaryQuestion: item.primaryQuestion,
        supportingQuestions: item.supportingQuestions || [],
        keywords: item.secondaryKeywords || [],
        userProblems: item.userProblems || [],
        searchIntent: item.searchIntent,
        topicAxis: item.topicAxis
    }
    const alignment = assessTopicEvidenceAlignment({
        idea,
        sourceEvidence: item.marketEvidence,
        productEvidence: item.productEvidence || []
    })
    if (!alignment.passed) return false
    const expected = buildTopicScoreHash({
        idea,
        candidateId,
        sourceEvidence: item.marketEvidence,
        productEvidence: item.productEvidence || [],
        report: item.scores || {}
    })
    return crypto.timingSafeEqual(Buffer.from(scoreHash, 'hex'), Buffer.from(expected, 'hex'))
}

const normalizeDirection = (schedule) => text(
    schedule?.agentConfig?.direction || schedule?.description || '',
    500
)

const assertSimpleSchedule = (schedule) => {
    if (!schedule) throw new NotFoundError('Schedule not found')
    if (schedule.isQaTest === true) throw new BadRequestError('QA schedules do not use the production topic roadmap')
    if (schedule.agentConfig?.simpleContract !== true) throw new BadRequestError('Topic roadmap is only available for simple Blog schedules')
    return schedule
}

const mapProductEvidence = ({ idea, coverageCards, catalogHash }) => {
    const byId = new Map((coverageCards || []).map((card) => [String(card.productId), card]))
    return list(idea?.productIds, 12, 80).map((productId) => {
        const card = byId.get(productId)
        if (!card) return null
        const allowedKeys = new Set(list(card.evidenceKeys, 30, 160))
        return {
            productId,
            sku: text(card.sku, 100),
            name: text(card.name, 200),
            slug: text(card.slug, 180),
            category: text(card.categoryKey || card.category?.id, 80),
            relevanceReason: text(
                card.coverageGaps?.[0] || card.coverage?.reasons?.[0] || card.supportedUseCases?.[0] || idea?.rationale,
                400
            ),
            catalogEvidenceHash: text(card.evidenceHash || catalogHash, 128),
            factKeys: list(idea?.productEvidenceKeys, 20, 160).filter((key) => allowedKeys.has(key))
        }
    }).filter(Boolean)
}

const confidenceScore = (value) => {
    if (Number.isFinite(Number(value))) return Math.min(1, Math.max(0, Number(value)))
    return value === 'high' ? 0.9 : value === 'medium' ? 0.65 : value === 'low' ? 0.35 : 0
}

const marketEvidenceId = (signal = {}) => String(signal.evidenceId || signal.id || signal.signalHash || '')

const marketSourceHealthEntries = (snapshot = {}) => {
    const health = snapshot.sourceHealth || {}
    const status = snapshot.status || 'unavailable'
    const entries = [{
        source: 'housewares_market_web',
        status,
        detail: `configured:${Number(health.configured || 0)} attempted:${Number(health.attempted || 0)} succeeded:${Number(health.succeeded || 0)} failed:${Number(health.failed || 0)}`,
        lastSuccessAt: Number(health.succeeded || 0) > 0 ? snapshot.generatedAt || null : null,
        lastFailureAt: Number(health.failed || 0) > 0 ? snapshot.generatedAt || null : null
    }]
    for (const source of Array.isArray(snapshot.sources) ? snapshot.sources : []) {
        entries.push({
            source: text(source.sourceId || source.sourceName, 120),
            status: text(source.status, 80),
            detail: text(source.errorCode, 240),
            lastSuccessAt: source.status === 'available' ? source.fetchedAt || null : null,
            lastFailureAt: source.status === 'failed' ? source.fetchedAt || null : null
        })
    }
    return entries.slice(0, 50)
}

const mapMarketEvidence = ({ idea, marketSignals, marketSources = [] }) => {
    const byId = new Map((marketSignals || [])
        .map((signal) => [marketEvidenceId(signal), signal])
        .filter(([id]) => id))
    const sourceById = new Map((marketSources || []).map((source) => [String(source.sourceId), source]))
    return list(idea?.marketEvidenceIds, 12, 160).map((evidenceId) => {
        const signal = byId.get(evidenceId)
        if (!signal) return null
        const source = sourceById.get(String(signal.sourceId)) || {}
        if (signal.relevance?.eligibleForIdeation !== true || signal.relevance?.version !== SOURCE_RELEVANCE_VERSION) return null
        return {
            evidenceId,
            sourceType: text(signal.sourceType || 'market_web', 80),
            sourceId: text(signal.sourceId || evidenceId, 160),
            sourceName: text(signal.sourceName || source.sourceName || source.title, 180),
            sourceDomain: text(signal.sourceDomain, 255),
            queryId: text(signal.queryId, 80),
            relevanceScore: Number(signal.relevance?.totalScore || 0),
            relevanceVersion: text(signal.relevance?.version, 120),
            relevanceReasons: list(signal.relevance?.rejectionReasons, 20, 160),
            canonicalUrl: text(signal.canonicalUrl || signal.sourceUrl || source.canonicalUrl, 1200),
            title: text(signal.title || signal.topic || signal.sourceTitle || source.title, 240),
            snippet: text(signal.snippet || signal.summary, 600),
            observedAt: signal.observedAt || signal.sourceDate || signal.publishedAt || null,
            fetchedAt: signal.fetchedAt || source.fetchedAt || null,
            contentHash: text(signal.contentHash || signal.signalHash || source.contentHash, 128),
            confidence: confidenceScore(signal.confidence),
            classification: ['observed', 'inferred'].includes(signal.classification) ? signal.classification : ''
        }
    }).filter(Boolean)
}

const retainAlignedMarketEvidence = (evidence = [], topicScore = {}) => {
    const alignment = topicScore?.trustedSignals?.evidenceAlignment || {}
    const alignedIds = new Set((Array.isArray(alignment.alignedEvidenceIds) ? alignment.alignedEvidenceIds : [])
        .map(String).filter(Boolean))
    if (!alignedIds.size) return evidence
    return evidence.filter((entry) => alignedIds.has(String(entry.evidenceId || entry.contentHash || '')))
}

const retainBoundProductEvidence = (evidence = [], topicScore = {}) => {
    const binding = topicScore?.trustedSignals?.evidenceAlignment?.productBinding || {}
    const boundIds = new Set((Array.isArray(binding.matchedProductIds) ? binding.matchedProductIds : [])
        .map(String).filter(Boolean))
    if (!boundIds.size) return evidence
    return evidence.filter((entry) => boundIds.has(String(entry.productId || '')))
}

const classifyTerminalFailure = (error) => {
    const code = text(error?.code || error?.message || 'ROADMAP_ITEM_FAILED', 120)
    return { code, transient: TRANSIENT_FAILURE_CODES.has(code) || /timeout|temporar|lease_busy/i.test(code) }
}

const focusMatchesCard = (card, focusTerms = []) => {
    const haystack = normalizeTopicKey([
        card?.name,
        card?.sku,
        card?.categoryKey,
        ...(card?.materials || []),
        ...(card?.verifiedFeatures || []),
        ...(card?.supportedUseCases || []),
        ...(card?.compatibility || [])
    ].filter(Boolean).join(' '))
    if (!haystack) return false
    return focusTerms.some((term) => {
        const normalized = normalizeTopicKey(term)
        if (!normalized) return false
        if (haystack.includes(normalized)) return true
        const tokens = normalized.split(' ').filter((token) => token.length >= 2)
        return tokens.length > 0 && tokens.filter((token) => haystack.includes(token)).length >= Math.ceil(tokens.length * 0.6)
    })
}

const scopeCoverageForInterpretation = (coverage = {}, interpretation = {}) => {
    if (interpretation?.scopeMode !== 'narrow' || !Array.isArray(interpretation?.focusTerms) || !interpretation.focusTerms.length) {
        return coverage
    }
    const cards = Array.isArray(coverage.cards) ? coverage.cards : []
    const promptCards = Array.isArray(coverage.promptCards) ? coverage.promptCards : cards
    const focusedCards = cards.filter((card) => focusMatchesCard(card, interpretation.focusTerms))
    const focusedIds = new Set(focusedCards.map((card) => String(card.productId)))
    return {
        ...coverage,
        cards: focusedCards,
        promptCards: promptCards.filter((card) => focusedIds.has(String(card.productId))),
        focusMatchedProductCount: focusedCards.length
    }
}

const safeItemView = (value) => {
    const item = asPlain(value)
    const scores = item.scores || {}
    return {
        id: asId(item),
        status: ITEM_STATUSES.has(item.status) ? item.status : 'failed',
        topic: item.topic || '',
        angle: item.angle || '',
        primaryKeyword: item.primaryKeyword || '',
        secondaryKeywords: item.secondaryKeywords || [],
        categoryKey: item.categoryKey || '',
        productScope: item.productScope || '',
        searchIntent: item.searchIntent || '',
        articleType: item.articleType || '',
        primaryQuestion: item.primaryQuestion || '',
        supportingQuestions: item.supportingQuestions || [],
        productEvidence: (item.productEvidence || []).map((entry) => ({
            productId: String(entry.productId || ''),
            sku: entry.sku || '',
            name: entry.name || '',
            slug: entry.slug || '',
            category: entry.category || '',
            relevanceReason: entry.relevanceReason || ''
        })),
        marketEvidence: (item.marketEvidence || []).map((entry) => ({
            sourceType: entry.sourceType || '',
            sourceId: entry.sourceId || '',
            sourceName: entry.sourceName || '',
            sourceDomain: entry.sourceDomain || '',
            queryId: entry.queryId || '',
            relevanceScore: Number(entry.relevanceScore || 0),
            relevanceVersion: entry.relevanceVersion || '',
            relevanceReasons: entry.relevanceReasons || [],
            canonicalUrl: entry.canonicalUrl || '',
            title: entry.title || '',
            snippet: entry.snippet || '',
            observedAt: entry.observedAt || null,
            fetchedAt: entry.fetchedAt || null,
            confidence: Number(entry.confidence || 0)
        })),
        scores: {
            totalScore: Math.min(100, Math.max(0, Number(scores.totalScore) || 0)),
            noveltySubtotal: Math.min(65, Math.max(0, Number(scores.noveltySubtotal) || 0)),
            rubricVersion: scores.rubricVersion || '',
            corpusVersion: scores.corpusVersion || '',
            corpusCount: Math.max(0, Number(scores.corpusCount) || 0),
            hardGates: scores.hardGates || {},
            hardGatesPassed: scores.hardGatesPassed === true,
            nearestCollisions: scores.nearestCollisions || {},
            reasonCodes: (scores.reasonCodes || []).map(publicCode).filter(Boolean),
            scoreBreakdown: scores.scoreBreakdown || {},
            penalties: scores.penalties || []
        },
        lineage: {
            activationEpoch: item.activationEpoch || '',
            regenerationId: asId(item.regenerationId),
            ideationRunId: asId(item.ideationRunId)
        },
        rank: Number(item.rank || 0),
        generation: Number(item.generation || 0),
        directionRevision: Number(item.directionRevision || 0),
        reasonCode: publicCode(item.reasonCode),
        createdAt: item.createdAt || null,
        claimedAt: item.claimedAt || null,
        completedAt: item.completedAt || null,
        dismissedAt: item.dismissedAt || null,
        failedAt: item.failedAt || null
    }
}

const safeRoadmapView = (value, counts = {}) => {
    if (!value) return null
    const roadmap = asPlain(value)
    const interpretation = roadmap.interpretation || {}
    return {
        id: asId(roadmap),
        scheduleId: asId(roadmap.scheduleId),
        status: ROADMAP_STATUSES.has(roadmap.status) ? roadmap.status : 'failed',
        generation: Number(roadmap.generation || 0),
        directionRevision: Number(roadmap.directionRevision || 0),
        lineage: {
            activeEpoch: roadmap.activeEpoch || '',
            latestIdeationRunId: asId(roadmap.latestIdeationRunId),
            latestRegenerationId: asId(roadmap.latestRegenerationId),
            productCatalogSnapshotId: asId(roadmap.productCatalogSnapshotId),
            contentOperationsSnapshotId: asId(roadmap.contentOperationsSnapshotId),
            contentInventorySnapshotId: asId(roadmap.contentInventorySnapshotId),
            marketSnapshotId: asId(roadmap.marketSnapshotId),
            scoreRubricVersion: roadmap.scoreRubricVersion || '',
            corpusVersion: roadmap.corpusVersion || ''
        },
        interpretation: {
            scopeMode: interpretation.scopeMode || 'mixed',
            normalizedGoal: interpretation.normalizedGoal || '',
            focusTerms: interpretation.focusTerms || [],
            excludedTerms: interpretation.excludedTerms || [],
            targetAudience: interpretation.targetAudience || [],
            constraints: interpretation.constraints || [],
            topicAxes: interpretation.topicAxes || [],
            confidence: Number(interpretation.confidence || 0),
            rationale: interpretation.rationale || ''
        },
        summary: {
            ready: Number(counts.ready || roadmap.readyCount || 0),
            claimed: Number(counts.claimed || 0),
            completed: Number(counts.completed || 0),
            dismissed: Number(counts.dismissed || 0),
            invalidated: Number(counts.invalidated || 0),
            failed: Number(counts.failed || 0)
        },
        minimumReady: Number(roadmap.minimumReady || 0),
        targetReady: Number(roadmap.targetReady || 0),
        lastRefillAt: roadmap.lastRefillAt || null,
        lastOutcomeCode: publicCode(roadmap.lastOutcomeCode),
        lastErrorCode: publicCode(roadmap.lastErrorCode),
        sourceHealth: (roadmap.sourceHealth || []).map((entry) => ({
            source: text(entry.source, 120),
            status: text(entry.status, 80),
            detail: safeDetail(entry.detail),
            lastSuccessAt: entry.lastSuccessAt || null,
            lastFailureAt: entry.lastFailureAt || null
        })),
        createdAt: roadmap.createdAt || null,
        updatedAt: roadmap.updatedAt || null
    }
}

const safeRegenerationView = (value) => {
    if (!value) return null
    const regeneration = asPlain(value)
    return {
        id: asId(regeneration),
        correlationId: text(regeneration.correlationId, 128),
        scheduleId: asId(regeneration.scheduleId),
        roadmapId: asId(regeneration.roadmapId),
        directionRevision: Number(regeneration.directionRevision || 0),
        baseEpoch: regeneration.baseEpoch || '',
        targetEpoch: regeneration.targetEpoch || '',
        baseGeneration: Number(regeneration.baseGeneration || 0),
        targetGeneration: Number(regeneration.targetGeneration || 0),
        status: regeneration.status || 'failed',
        outcome: regeneration.outcome || '',
        outcomeCode: publicCode(regeneration.outcomeCode),
        errorCode: publicCode(regeneration.errorCode),
        sourceHealth: (regeneration.sourceHealth || []).map((entry) => ({
            source: text(entry.source, 120),
            status: text(entry.status, 80),
            detail: safeDetail(entry.detail),
            lastSuccessAt: entry.lastSuccessAt || null,
            lastFailureAt: entry.lastFailureAt || null
        })),
        lineage: {
            productCatalogSnapshotId: asId(regeneration.productCatalogSnapshotId),
            contentOperationsSnapshotId: asId(regeneration.contentOperationsSnapshotId),
            contentInventorySnapshotId: asId(regeneration.contentInventorySnapshotId),
            marketSnapshotId: asId(regeneration.marketSnapshotId),
            ideationRunId: asId(regeneration.ideationRunId)
        },
        attemptCount: Number(regeneration.attemptCount || 0),
        nextRetryAt: regeneration.nextRetryAt || null,
        lastAttemptAt: regeneration.lastAttemptAt || null,
        startedAt: regeneration.startedAt || null,
        completedAt: regeneration.completedAt || null,
        createdAt: regeneration.createdAt || null,
        updatedAt: regeneration.updatedAt || null
    }
}

class BlogTopicRoadmapService {
    constructor({
        RoadmapModel,
        ItemModel,
        ScheduleModel = BlogAutomationSchedule,
        ExecutionModel = BlogAutomationExecution,
        InventoryItemModel = ContentInventoryItem,
        GoogleService = GoogleIntelligenceService,
        IntelligenceService = ContentOperationsIntelligenceService,
        ProductCatalogService = ProductCatalogIntelligenceService,
        DirectionInterpreterService,
        ProductCoverageService,
        MarketResearchService,
        ideationService = generateBlogIdeas,
        NoveltyService = BlogNoveltyIndexService,
        ideationOrchestrator = null,
        RegenerationModel,
        config = getContentOperationsConfig(),
        now = () => new Date(),
        randomUUID = crypto.randomUUID
    } = {}) {
        // Lazy defaults keep this service loadable while models/services are being
        // added and make every dependency injectable for concurrency tests.
        this.RoadmapModel = RoadmapModel || require('../../models/blogTopicRoadmap.model').BlogTopicRoadmap
        this.ItemModel = ItemModel || require('../../models/blogTopicRoadmapItem.model').BlogTopicRoadmapItem
        this.ScheduleModel = ScheduleModel
        this.ExecutionModel = ExecutionModel
        this.InventoryItemModel = InventoryItemModel
        this.GoogleService = GoogleService
        this.IntelligenceService = IntelligenceService
        this.ProductCatalogService = ProductCatalogService
        this.DirectionInterpreterService = DirectionInterpreterService || require('./blogDirectionInterpreter.service').BlogDirectionInterpreterService
        this.ProductCoverageService = ProductCoverageService || require('./productTopicCoverage.service').ProductTopicCoverageService
        this.MarketResearchService = MarketResearchService || require('./housewaresMarketResearch.service').HousewaresMarketResearchService
        this.ideationService = ideationService
        this.NoveltyService = NoveltyService
        this.noveltyService = typeof NoveltyService === 'function' ? new NoveltyService() : NoveltyService
        this.ideationOrchestrator = ideationOrchestrator
        this.RegenerationModel = RegenerationModel || require('../../models/blogTopicRoadmapRegeneration.model').BlogTopicRoadmapRegeneration
        this.config = config
        this.roadmapConfig = config.topicRoadmap || {}
        this.policy = resolveTopicRoadmapPolicy(this.roadmapConfig)
        this.now = now
        this.randomUUID = randomUUID
    }

    async readSchedule(scheduleId) {
        const objectId = convertToObjectIdMongodb(scheduleId)
        if (!objectId) throw new BadRequestError('Invalid schedule id')
        let query = this.ScheduleModel.findById(objectId)
        if (typeof query?.lean === 'function') query = query.lean()
        return assertSimpleSchedule(await query)
    }

    async initialize({ schedule }) {
        const now = this.now()
        const direction = normalizeDirection(schedule)
        if (!direction) throw new BadRequestError('A simple Blog schedule requires a manager direction')
        const directionHash = sha256(direction)
        let roadmap = await this.RoadmapModel.findOne({ scheduleId: schedule._id })
        if (!roadmap) {
            try {
                roadmap = await this.RoadmapModel.create({
                    scheduleId: schedule._id,
                    direction,
                    directionHash,
                    directionRevision: 1,
                    generation: 0,
                    activeEpoch: epochFor({
                        roadmapId: schedule._id,
                        directionRevision: 1,
                        generation: 0,
                        seed: directionHash
                    }),
                    epochMigrationComplete: true,
                    status: 'needs_refill',
                    minimumReady: Number(this.roadmapConfig.minimumReady || 3),
                    targetReady: Math.max(
                        Number(this.roadmapConfig.minimumReady || 3),
                        Number(this.roadmapConfig.targetReady || 8)
                    ),
                    readyCount: 0,
                    refillRequestedAt: now,
                    refillReason: 'roadmap_initialized'
                })
            } catch (error) {
                if (!isDuplicateKeyError(error)) throw error
                roadmap = await this.RoadmapModel.findOne({ scheduleId: schedule._id })
            }
        }
        const plain = asPlain(roadmap)
        if (plain.directionHash !== directionHash) {
            const revised = await this.RoadmapModel.findOneAndUpdate(
                { _id: plain._id, directionHash: plain.directionHash },
                {
                    $set: {
                        direction,
                        directionHash,
                        // Every derived field below belongs to the previous
                        // manager direction. Keeping it would make the API show
                        // an old interpreted goal and old source health while a
                        // replacement plan is being researched for the new
                        // brief.
                        interpretation: {},
                        activeEpoch: epochFor({
                            roadmapId: plain._id,
                            directionRevision: Number(plain.directionRevision || 1) + 1,
                            generation: Number(plain.generation || 0),
                            seed: directionHash
                        }),
                        epochMigrationComplete: true,
                        status: 'needs_refill',
                        readyCount: 0,
                        refillRequestedAt: now,
                        refillReason: 'direction_changed',
                        lastRefillAt: null,
                        lastOutcomeCode: '',
                        lastErrorCode: '',
                        productCatalogSnapshotId: null,
                        contentOperationsSnapshotId: null,
                        contentInventorySnapshotId: null,
                        marketSnapshotId: null,
                        latestIdeationRunId: null,
                        latestRegenerationId: null,
                        scoreRubricVersion: '',
                        corpusVersion: '',
                        corpusHash: '',
                        sourceHealth: [],
                        rejectedCandidates: []
                    },
                    $inc: { directionRevision: 1 }
                },
                { new: true, runValidators: true }
            )
            if (revised) {
                await this.ItemModel.updateMany(
                    { roadmapId: revised._id, status: 'ready', directionRevision: { $lt: revised.directionRevision } },
                    { $set: { status: 'invalidated', invalidatedAt: now, reasonCode: 'direction_changed' } }
                )
                return revised
            }
            return this.RoadmapModel.findOne({ scheduleId: schedule._id })
        }
        if (!plain.activeEpoch) {
            const activeEpoch = epochFor({
                roadmapId: plain._id,
                directionRevision: plain.directionRevision,
                generation: plain.generation,
                seed: plain.directionHash
            })
            const migrated = await this.RoadmapModel.findOneAndUpdate(
                { _id: plain._id, $or: [{ activeEpoch: '' }, { activeEpoch: { $exists: false } }] },
                { $set: { activeEpoch, epochMigrationComplete: true } },
                { new: true }
            )
            if (migrated) {
                await this.ItemModel.updateMany(
                    {
                        roadmapId: plain._id,
                        status: 'ready',
                        $or: [{ activationEpoch: '' }, { activationEpoch: { $exists: false } }]
                    },
                    { $set: { activationEpoch: activeEpoch } }
                )
                return migrated
            }
            return this.RoadmapModel.findOne({ scheduleId: schedule._id })
        }
        return roadmap
    }

    // Single source of truth for which `ready` items claimNext can actually take.
    // ensureReadyBuffer MUST count with this exact predicate, otherwise stale items
    // scored under a superseded rubric/corpus inflate readyCount and the buffer never
    // refills — a permanent ROADMAP_NO_READY_TOPIC deadlock.
    claimableReadyMatch(roadmap) {
        return {
            roadmapId: roadmap._id,
            status: 'ready',
            directionRevision: roadmap.directionRevision,
            ...(roadmap.activeEpoch ? { activationEpoch: roadmap.activeEpoch } : {}),
            'scores.totalScore': { $gte: this.policy.acceptanceScore },
            'scores.noveltySubtotal': { $gte: this.policy.minimumNoveltySubtotal },
            'scores.rubricVersion': RUBRIC_VERSION,
            'scores.corpusVersion': INDEX_VERSION,
            'scores.hardGatesPassed': true,
            'scores.hardGates.sources': true,
            'scores.hardGates.products': true,
            'scores.hardGates.evidenceAlignment': true,
            'scores.trustedSignals.evidenceAlignment.version': EVIDENCE_ALIGNMENT_VERSION,
            'scores.scoreHash': { $type: 'string', $regex: /^[a-f0-9]{64}$/ },
            marketEvidence: {
                $elemMatch: {
                    evidenceId: { $type: 'string', $ne: '' },
                    contentHash: { $type: 'string', $ne: '' },
                    relevanceVersion: SOURCE_RELEVANCE_VERSION,
                    relevanceScore: { $gt: 0 }
                }
            },
            attemptCount: { $lt: Number(this.roadmapConfig.maxClaimAttempts || 3) }
        }
    }

    // Retire ready items on the current revision that can never be claimed because they
    // were scored under an older rubric/corpus version. Mirrors the direction_changed
    // invalidation so counts and the admin UI stop reporting them as ready.
    async invalidateSupersededReady({ roadmap, now }) {
        return this.ItemModel.updateMany(
            {
                roadmapId: roadmap._id,
                status: 'ready',
                directionRevision: roadmap.directionRevision,
                $or: [
                    { 'scores.rubricVersion': { $ne: RUBRIC_VERSION } },
                    { 'scores.corpusVersion': { $ne: INDEX_VERSION } },
                    { 'scores.hardGates.sources': { $ne: true } },
                    { 'scores.hardGates.products': { $ne: true } },
                    { 'scores.hardGates.evidenceAlignment': { $ne: true } },
                    { 'scores.trustedSignals.evidenceAlignment.version': { $ne: EVIDENCE_ALIGNMENT_VERSION } }
                ]
            },
            { $set: { status: 'invalidated', invalidatedAt: now, reasonCode: 'rubric_superseded' } }
        )
    }

    async countStatuses(roadmapId, activeEpoch = '', directionRevision = 0) {
        const rows = await this.ItemModel.aggregate([
            { $match: {
                roadmapId: convertToObjectIdMongodb(roadmapId) || roadmapId,
                ...(Number(directionRevision) > 0
                    ? { directionRevision: Number(directionRevision) }
                    : {}),
                ...(activeEpoch ? { $or: [
                    { activationEpoch: activeEpoch },
                    { status: { $ne: 'ready' } }
                ] } : {})
            } },
            { $group: { _id: '$status', count: { $sum: 1 } } }
        ])
        return Object.fromEntries((rows || []).map((row) => [String(row._id), Number(row.count)]))
    }

    async getRoadmap({ scheduleId, limit = 30 }) {
        const schedule = await this.readSchedule(scheduleId)
        let roadmap = await this.RoadmapModel.findOne({ scheduleId: schedule._id }).lean()
        if (!roadmap) return {
            roadmap: null,
            items: [],
            regeneration: null,
            policy: { ...this.policy }
        }
        // Loading an existing roadmap also reconciles a recently edited manager
        // direction, invalidating only unclaimed ready items from the old revision.
        roadmap = asPlain(await this.initialize({ schedule }))
        const activeEpoch = String(roadmap.activeEpoch || '')
        const [counts, items, latestRegeneration] = await Promise.all([
            this.countStatuses(roadmap._id, activeEpoch, roadmap.directionRevision),
            this.ItemModel.find({
                roadmapId: roadmap._id,
                directionRevision: roadmap.directionRevision,
                ...(activeEpoch
                    ? { $or: [
                        { activationEpoch: activeEpoch },
                        { status: { $ne: 'ready' } }
                    ] }
                    : {})
            })
                .sort({ status: 1, generation: -1, rank: 1, createdAt: -1 })
                .limit(Math.min(Math.max(Number(limit) || 30, 1), 100))
                .lean(),
            // A completed regeneration from an older manager direction is
            // historical evidence, not the lifecycle state of the current
            // plan. Returning it here makes a newly edited brief look as if its
            // research already failed or completed.
            this.RegenerationModel.findOne({
                roadmapId: roadmap._id,
                directionRevision: roadmap.directionRevision
            })
                .sort({ createdAt: -1, _id: -1 })
                .lean()
        ])
        return {
            roadmap: safeRoadmapView(roadmap, counts),
            items: items.map(safeItemView),
            regeneration: safeRegenerationView(latestRegeneration),
            policy: { ...this.policy }
        }
    }

    async readInventoryItems(snapshotId) {
        if (!snapshotId) return []
        let query = this.InventoryItemModel.find({ snapshotId, isQaTest: { $ne: true } })
        if (typeof query?.limit === 'function') query = query.limit(this.config.inventory?.maxItems || 10_000)
        if (typeof query?.lean === 'function') query = query.lean()
        const items = await query
        return Array.isArray(items) ? items : []
    }

    async ensureIntelligence({ now }) {
        const googleSnapshot = await this.GoogleService.ensureGoogleIntelligenceSnapshotForDate({ now })
        const effectiveConfig = { ...this.config, enabled: true }
        const intelligenceService = typeof this.IntelligenceService === 'function'
            ? new this.IntelligenceService({ config: effectiveConfig })
            : this.IntelligenceService
        const result = await intelligenceService.ensureContentOperationsSnapshotForDate({
            now,
            force: false,
            googleIntelSnapshot: googleSnapshot
        })
        if (result.disabled || !result.snapshot?.contentInventorySnapshotId) {
            const error = new Error('Smart topic roadmap intelligence is unavailable')
            error.code = 'ROADMAP_INTELLIGENCE_UNAVAILABLE'
            throw error
        }
        return { googleSnapshot, contentSnapshot: result.snapshot }
    }

    async acquireRefillLease({ roadmap, reason }) {
        const now = this.now()
        const token = this.randomUUID()
        const leaseUntil = new Date(now.getTime() + Number(this.roadmapConfig.refillLeaseMs || 600_000))
        const claimed = await this.RoadmapModel.findOneAndUpdate(
            {
                _id: roadmap._id,
                status: { $ne: 'archived' },
                $or: [
                    { refillLeaseUntil: null },
                    { refillLeaseUntil: { $exists: false } },
                    { refillLeaseUntil: { $lte: now } }
                ]
            },
            {
                $set: {
                    status: 'refilling',
                    refillToken: token,
                    refillLeaseUntil: leaseUntil,
                    refillRequestedAt: now,
                    refillReason: text(reason || 'buffer_low', 160),
                    lastErrorCode: ''
                }
            },
            { new: true }
        )
        return claimed ? { roadmap: claimed, token, leaseUntil } : null
    }

    async releaseRefillLease({ roadmapId, token, updates }) {
        const saved = await this.RoadmapModel.findOneAndUpdate(
            { _id: roadmapId, refillToken: token, status: 'refilling' },
            {
                $set: updates,
                $unset: { refillToken: '', refillLeaseUntil: '' }
            },
            { new: true, runValidators: true }
        )
        if (!saved) {
            const error = new Error('Topic roadmap refill lease was lost')
            error.code = 'ROADMAP_REFILL_LEASE_LOST'
            throw error
        }
        return saved
    }

    async ensureReadyBuffer({
        scheduleId,
        reason = 'buffer_low',
        force = false,
        activationEpoch = '',
        regenerationId = null,
        expectedRoadmap = null,
        preserveActivePlan = false,
        assertReplacementOwner = null
    }) {
        if (this.roadmapConfig.enabled === false) {
            const error = new Error('Smart topic roadmap is disabled')
            error.code = 'TOPIC_ROADMAP_DISABLED'
            throw error
        }
        const schedule = await this.readSchedule(scheduleId)
        let roadmap = await this.initialize({ schedule })
        if (expectedRoadmap && (
            asId(roadmap) !== asId(expectedRoadmap.roadmapId) ||
            Number(roadmap.directionRevision) !== Number(expectedRoadmap.directionRevision) ||
            Number(roadmap.generation || 0) !== Number(expectedRoadmap.baseGeneration || 0) ||
            String(roadmap.activeEpoch || '') !== String(expectedRoadmap.baseEpoch || '')
        )) {
            throw regenerationError('ROADMAP_REGENERATION_SUPERSEDED', 'The roadmap changed before regeneration could start')
        }
        const generationEpoch = text(
            activationEpoch || roadmap.activeEpoch || epochFor({
                roadmapId: roadmap._id,
                directionRevision: roadmap.directionRevision,
                generation: Number(roadmap.generation || 0) + 1,
                seed: this.randomUUID()
            }),
            80
        )
        // Retire items scored under a superseded rubric/corpus before counting so they
        // never mask a low buffer (they are unclaimable and would deadlock the schedule).
        // Unsafe or superseded plans must never survive as a fallback while a
        // replacement regeneration is running.
        await this.invalidateSupersededReady({ roadmap, now: this.now() })
        let readyCount = await this.ItemModel.countDocuments(this.claimableReadyMatch(roadmap))
        const minimumReady = Number(roadmap.minimumReady || this.roadmapConfig.minimumReady || 3)
        if (!force && readyCount >= minimumReady) {
            if (Number(roadmap.readyCount || 0) !== readyCount || roadmap.status !== 'ready') {
                roadmap = await this.RoadmapModel.findByIdAndUpdate(
                    roadmap._id,
                    { $set: { readyCount, status: 'ready' } },
                    { new: true }
                )
            }
            return { roadmap: asPlain(roadmap), readyCount, refilled: false }
        }

        const lease = preserveActivePlan
            ? { roadmap, token: '', leaseUntil: null }
            : await this.acquireRefillLease({ roadmap, reason })
        if (!lease) {
            const concurrent = await this.RoadmapModel.findById(roadmap._id).lean()
            readyCount = await this.ItemModel.countDocuments(this.claimableReadyMatch(concurrent))
            return { roadmap: concurrent, readyCount, refilled: false, concurrentRefill: true }
        }
        roadmap = lease.roadmap
        const now = this.now()
        let earlySourceHealth = []
        let nextGeneration = Number(roadmap.generation || 0) + 1
        try {
            const { googleSnapshot, contentSnapshot } = await this.ensureIntelligence({ now })
            const [catalog, inventoryItems] = await Promise.all([
                this.ProductCatalogService.ensureSnapshot({ now }),
                this.readInventoryItems(contentSnapshot.contentInventorySnapshotId)
            ])
            const safeProducts = Array.isArray(catalog?.safeProducts) ? catalog.safeProducts : []
            // Build the evidence snapshot from a deterministic interpretation first.
            // The paid/model-backed interpretation is intentionally deferred until
            // persisted, version-gated evidence proves that the score can reach the
            // configured safety thresholds.
            const preflightInterpretation = await this.DirectionInterpreterService.interpret({
                direction: roadmap.direction,
                safeProducts,
                preferLlm: false
            })
            const coverage = await this.ProductCoverageService.build({
                safeProducts,
                inventoryItems,
                generation: nextGeneration,
                limit: Number(this.roadmapConfig.maxCandidatesPerRefill || 24)
            })
            const preflightScopedCoverage = scopeCoverageForInterpretation(coverage, preflightInterpretation)
            const marketSnapshot = await this.MarketResearchService.ensureSnapshot({
                config: {
                    ...(this.roadmapConfig.marketResearch || {}),
                    minRelevanceScore: this.roadmapConfig.sourceRelevanceMin
                },
                now,
                force,
                direction: roadmap.direction,
                directionInterpretation: preflightInterpretation,
                productCoverage: preflightScopedCoverage,
                snapshot: contentSnapshot
            })
            earlySourceHealth = [
                ...(Array.isArray(contentSnapshot.sourceHealth) ? contentSnapshot.sourceHealth : []),
                ...marketSourceHealthEntries(marketSnapshot)
            ].slice(0, 50)
            const earlyLineage = {
                sourceHealth: earlySourceHealth,
                productCatalogSnapshotId: catalog?._id || catalog?.id || null,
                contentOperationsSnapshotId: contentSnapshot.id || contentSnapshot._id || null,
                contentInventorySnapshotId: contentSnapshot.contentInventorySnapshotId || null,
                marketSnapshotId: marketSnapshot?._id || marketSnapshot?.id || null
            }
            if (regenerationId) {
                await this.RegenerationModel.updateOne(
                    { _id: regenerationId, status: 'running' },
                    { $set: earlyLineage }
                )
            } else {
                await this.RoadmapModel.updateOne(
                    { _id: roadmap._id, ...(lease.token ? { refillToken: lease.token } : {}) },
                    { $set: earlyLineage }
                )
            }
            const marketSources = Array.isArray(marketSnapshot?.sources) ? marketSnapshot.sources : []
            const sourceById = new Map(marketSources.map((source) => [String(source.sourceId), source]))
            const marketSignals = (Array.isArray(marketSnapshot?.signals) ? marketSnapshot.signals : []).map((signal) => {
                const source = sourceById.get(String(signal.sourceId)) || {}
                return {
                    ...signal,
                    evidenceId: marketEvidenceId(signal),
                    sourceType: 'market_web',
                    title: signal.title || signal.topic || signal.sourceTitle || source.title || '',
                    canonicalUrl: signal.canonicalUrl || source.canonicalUrl || '',
                    fetchedAt: signal.fetchedAt || source.fetchedAt || null,
                    contentHash: signal.contentHash || signal.signalHash || source.contentHash || ''
                }
            })
            const preflightProductEvidence = (preflightScopedCoverage.cards || []).map((card) => ({
                productId: String(card.productId || ''),
                name: text(card.name, 240),
                catalogEvidenceHash: text(card.evidenceHash || catalog?.catalogHash, 128),
                eligible: true,
                rejectionReasons: []
            }))
            const reachability = assessTopicPlanReachability({
                sourceEvidence: asId(marketSnapshot) ? marketSignals : [],
                productEvidence: asId(catalog) ? preflightProductEvidence : [],
                acceptanceScore: this.policy.acceptanceScore,
                minimumNoveltySubtotal: this.policy.minimumNoveltySubtotal,
                now
            })
            if (!reachability.reachable) {
                const error = regenerationError(reachability.code)
                error.gateSummary = reachability
                throw error
            }
            const interpretation = await this.DirectionInterpreterService.interpret({
                direction: roadmap.direction,
                safeProducts,
                allowHeuristicFallback: false
            })
            const scopedCoverage = scopeCoverageForInterpretation(coverage, interpretation)
            const requireProductEvidence = Array.isArray(scopedCoverage.cards) && scopedCoverage.cards.length > 0
            const queryPack = buildTopicResearchQueryPack({
                direction: roadmap.direction,
                interpretation,
                productCoverage: scopedCoverage,
                snapshot: contentSnapshot
            })
            let ideation
            let ranked
            let ideationRunId = null
            const sourceEvidenceFor = (idea) => mapMarketEvidence({ idea, marketSignals, marketSources })
            const productEvidenceFor = (idea) => mapProductEvidence({ idea, coverageCards: scopedCoverage.cards, catalogHash: catalog?.catalogHash })
            const scoreWithComparison = ({ idea, comparison }) => {
                const candidateId = String(idea.ideaId || uniquenessKeyFor(idea))
                return scoreTopicPlan({
                    idea,
                    candidateId,
                    comparison,
                    sourceEvidence: sourceEvidenceFor(idea).map((entry) => ({
                        ...entry,
                        relevance: {
                            version: entry.relevanceVersion,
                            totalScore: entry.relevanceScore,
                            eligibleForIdeation: entry.relevanceVersion === SOURCE_RELEVANCE_VERSION && !entry.relevanceReasons?.length
                        }
                    })),
                    productEvidence: productEvidenceFor(idea),
                    directionPassed: true,
                    now,
                    acceptanceScore: this.policy.acceptanceScore,
                    minimumNoveltySubtotal: this.policy.minimumNoveltySubtotal,
                    requireProductEvidence
                })
            }
            const authoritativeScorer = async ({ idea }) => scoreWithComparison({
                idea,
                comparison: await this.noveltyService.comparePlan({
                    topic: idea.topic,
                    angle: idea.angle,
                    primaryQuestion: idea.primaryQuestion,
                    supportingQuestions: idea.supportingQuestions,
                    searchIntent: idea.searchIntent
                })
            })
            const authoritativeScoreBatch = async ({ ideas }) => {
                if (typeof this.noveltyService.comparePlans !== 'function') {
                    const reports = []
                    for (const idea of ideas) reports.push(await authoritativeScorer({ idea }))
                    return reports
                }
                const comparisons = await this.noveltyService.comparePlans(ideas.map((idea) => ({
                    topic: idea.topic,
                    angle: idea.angle,
                    primaryQuestion: idea.primaryQuestion,
                    supportingQuestions: idea.supportingQuestions,
                    searchIntent: idea.searchIntent
                })))
                if (!Array.isArray(comparisons) || comparisons.length !== ideas.length) {
                    const error = new Error('Novelty batch comparison returned an incomplete result')
                    error.code = 'NOVELTY_BATCH_COMPARISON_INVALID'
                    throw error
                }
                return ideas.map((idea, index) => scoreWithComparison({
                    idea,
                    comparison: comparisons[index]
                }))
            }
            if (this.roadmapConfig.agenticIdeationEnabled === true) {
                const manifest = typeof this.noveltyService.ensureCorpus === 'function'
                    ? await this.noveltyService.ensureCorpus()
                    : await this.noveltyService.rebuildAll()
                const orchestrator = this.ideationOrchestrator || new TopicIdeationOrchestratorService({
                    scorer: authoritativeScorer,
                    scoreBatch: authoritativeScoreBatch,
                    researchResolver: async () => ({
                        status: marketSnapshot?.status || 'unavailable',
                        signals: marketSignals
                    }),
                    maxRounds: this.roadmapConfig.maxAgentRounds,
                    maxCalls: this.roadmapConfig.maxAgentCalls,
                    deadlineMs: this.roadmapConfig.agentDeadlineMs,
                    policy: this.policy,
                    now: this.now
                })
                const orchestrated = await orchestrator.run({
                    scheduleId: schedule._id,
                    roadmapId: roadmap._id,
                    directionRevision: roadmap.directionRevision,
                    generation: nextGeneration,
                    brief: {
                        direction: roadmap.direction,
                        interpretation,
                        productCoverage: scopedCoverage,
                        marketEvidence: { status: marketSnapshot?.status || 'unavailable', signals: marketSignals }
                    },
                    queryPack,
                    corpusManifest: manifest,
                    sourceHealth: earlySourceHealth
                })
                ideationRunId = orchestrated.runId
                ideation = {
                    ideas: orchestrated.accepted.map((entry) => entry.idea),
                    source: 'openclaw-agentic',
                    model: orchestrated.invocations.find((entry) => entry.agentId === 'content-ideator')?.resolvedModel || '',
                    scoreByIdeaId: new Map(orchestrated.accepted.map((entry) => [String(entry.idea.ideaId || entry.idea.topic), entry.score]))
                }
                ranked = orchestrated.accepted.map((entry) => ({
                    candidateId: String(entry.idea.ideaId || uniquenessKeyFor(entry.idea)),
                    topic: entry.idea.topic,
                    recommendedAction: 'new',
                    eligible: entry.score.eligible,
                    totalScore: entry.score.totalScore,
                    scoreBreakdown: entry.score.dimensions,
                    penalties: [],
                    topicScore: entry.score
                }))
            } else {
                ideation = await this.ideationService({
                    snapshot: contentSnapshot,
                    inventoryItems,
                    direction: roadmap.direction,
                    directionInterpretation: interpretation,
                    productCoverage: scopedCoverage,
                    marketEvidence: { status: marketSnapshot?.status || 'unavailable', signals: marketSignals },
                    now,
                    timezone: schedule.timezone || this.config.timezone,
                    maxIdeas: Number(this.roadmapConfig.maxCandidatesPerRefill || 24),
                    allowHeuristicFallback: false
                })
                ranked = []
                for (const idea of ideation.ideas || []) {
                    const topicScore = await authoritativeScorer({ idea })
                    ranked.push({
                        candidateId: String(idea.ideaId || uniquenessKeyFor(idea)),
                        topic: idea.topic,
                        recommendedAction: 'new',
                        eligible: topicScore.eligible,
                        totalScore: topicScore.totalScore,
                        scoreBreakdown: topicScore.dimensions,
                        penalties: [],
                        topicScore
                    })
                }
                ranked.sort((left, right) =>
                    Number(right.eligible) - Number(left.eligible) ||
                    Number(right.totalScore || 0) - Number(left.totalScore || 0) ||
                    String(left.candidateId).localeCompare(String(right.candidateId))
                )
            }
            const targetReady = Number(roadmap.targetReady || this.roadmapConfig.targetReady || 8)
            const existingItems = await this.ItemModel.find({ roadmapId: roadmap._id })
                .select('topic angle primaryQuestion uniquenessKey status activationEpoch')
                .lean()
            const uniquenessHistory = preserveActivePlan
                ? existingItems.filter((item) => String(item.activationEpoch || '') !== generationEpoch)
                : existingItems
            const comparisonHistory = preserveActivePlan
                ? existingItems.filter((item) => (
                    String(item.activationEpoch || '') !== String(roadmap.activeEpoch || '') &&
                    String(item.activationEpoch || '') !== generationEpoch
                ))
                : existingItems
            const seenKeys = new Set(uniquenessHistory.map((item) => item.uniquenessKey).filter(Boolean))
            const comparisonTexts = [
                ...comparisonHistory.map((item) => `${item.topic || ''} ${item.angle || ''} ${item.primaryQuestion || ''}`),
                ...inventoryItems.map((item) => `${item.title || item.blog_title || ''} ${item.topicSummary || ''} ${(item.entitySummary || []).join(' ')}`)
            ].filter(Boolean)
            const ideaByTopic = new Map((ideation.ideas || []).map((idea) => [idea.topic, idea]))
            const accepted = []
            const rejected = []
            for (const scored of ranked) {
                const idea = ideaByTopic.get(scored.topic)
                if (!idea || scored.recommendedAction !== 'new' || !scored.eligible) {
                    rejected.push({ topic: scored.topic, reason: scored.decisionReason || 'candidate_not_eligible' })
                    continue
                }
                const uniquenessKey = uniquenessKeyFor(idea)
                const candidateText = `${idea.topic} ${idea.angle || ''} ${idea.primaryQuestion || ''}`
                const nearExisting = comparisonTexts.some((other) =>
                    textSimilarity(candidateText, other, 2) >= Number(this.roadmapConfig.similarityThreshold || 0.72)
                )
                const withinBatch = accepted.some((item) =>
                    textSimilarity(candidateText, `${item.topic} ${item.angle} ${item.primaryQuestion}`, 2) >= Number(this.roadmapConfig.similarityThreshold || 0.72)
                )
                if (seenKeys.has(uniquenessKey) || nearExisting || withinBatch) {
                    rejected.push({ topic: idea.topic, reason: 'roadmap_near_duplicate' })
                    continue
                }
                const topicScore = scored.topicScore || ideation.scoreByIdeaId?.get(String(idea.ideaId || idea.topic))
                if (
                    !topicScore?.eligible ||
                    Number(topicScore.totalScore || 0) < this.policy.acceptanceScore ||
                    Number(topicScore.noveltySubtotal || 0) < this.policy.minimumNoveltySubtotal
                ) {
                    rejected.push({ topic: idea.topic, reason: topicScore?.reasonCodes?.[0] || 'topic_score_below_82' })
                    continue
                }
                accepted.push({
                    roadmapId: roadmap._id,
                    scheduleId: schedule._id,
                    directionRevision: roadmap.directionRevision,
                    generation: nextGeneration,
                    activationEpoch: generationEpoch,
                    regenerationId: regenerationId || null,
                    rank: accepted.length + 1,
                    status: 'ready',
                    topic: text(idea.topic, 300),
                    angle: text(idea.angle, 1_000),
                    primaryKeyword: text(idea.primaryKeyword || idea.topic, 120),
                    secondaryKeywords: list(idea.keywords, 12, 80),
                    categoryKey: text(idea.categoryKey || 'guide', 80),
                    productScope: text(idea.productScope || 'mixed', 80),
                    articleType: text(idea.articleType || 'practical-guide', 100),
                    searchIntent: text(idea.searchIntent || 'informational', 300),
                    topicAxis: text(idea.topicAxis, 80),
                    primaryQuestion: text(idea.primaryQuestion || `Người đọc cần biết gì về ${idea.topic}?`, 500),
                    supportingQuestions: list(idea.supportingQuestions, 10, 500),
                    targetAudience: list(idea.targetAudience?.length ? idea.targetAudience : interpretation.targetAudience, 10, 200),
                    userProblems: list(idea.userProblems, 10, 300),
                    // Persist only what the alignment gate actually trusted for
                    // this candidate. Scoring already discards over-cited
                    // evidence, but the writer reads the persisted item, so an
                    // unfiltered copy is how a mosquito-racket article ended up
                    // citing pressure-cooker sources.
                    productEvidence: retainBoundProductEvidence(
                        mapProductEvidence({ idea, coverageCards: scopedCoverage.cards, catalogHash: catalog?.catalogHash }),
                        topicScore
                    ),
                    marketEvidence: retainAlignedMarketEvidence(
                        mapMarketEvidence({ idea, marketSignals, marketSources }),
                        topicScore
                    ),
                    scores: {
                        totalScore: Number(topicScore.totalScore || 0),
                        noveltySubtotal: Number(topicScore.noveltySubtotal || 0),
                        rubricVersion: topicScore.rubricVersion || RUBRIC_VERSION,
                        corpusVersion: topicScore.corpusVersion || INDEX_VERSION,
                        corpusHash: topicScore.corpusHash || '',
                        corpusCount: Number(topicScore.corpusCount || 0),
                        scoreHash: topicScore.scoreHash || '',
                        semanticCalibration: topicScore.semanticCalibration || {},
                        hardGates: topicScore.hardGates || {},
                        hardGatesPassed: topicScore.hardGatesPassed === true,
                        nearestCollisions: topicScore.nearestCollisions || {},
                        reasonCodes: topicScore.reasonCodes || [],
                        scoreBreakdown: topicScore.dimensions || {},
                        trustedSignals: topicScore.trustedSignals || {},
                        penalties: []
                    },
                    ideationRunId: ideationRunId || null,
                    candidateProvenance: {
                        candidateId: scored.candidateId,
                        ideationSource: ideation.source,
                        ideationModel: ideation.model,
                        rationale: text(idea.rationale, 500),
                        sourceSignals: list(idea.sourceSignals, 12, 160)
                    },
                    uniquenessKey,
                    reasonCode: ''
                })
                seenKeys.add(uniquenessKey)
                comparisonTexts.push(candidateText)
                if (accepted.length >= Math.max(0, targetReady - readyCount)) break
            }
            for (const item of accepted) {
                try {
                    await this.ItemModel.create(item)
                } catch (error) {
                    if (!isDuplicateKeyError(error)) throw error
                }
            }
            const replacementMatch = this.claimableReadyMatch({
                ...asPlain(roadmap),
                activeEpoch: generationEpoch
            })
            const generatedReadyCount = await this.ItemModel.countDocuments(replacementMatch)
            if (preserveActivePlan && generatedReadyCount < minimumReady) {
                throw regenerationError('ROADMAP_NO_SAFE_TOPIC', 'No safe distinct replacement topic is available')
            }
            readyCount = preserveActivePlan
                ? generatedReadyCount
                : await this.ItemModel.countDocuments(this.claimableReadyMatch({
                    ...asPlain(roadmap),
                    activeEpoch: generationEpoch
                }))
            const finalStatus = readyCount >= minimumReady ? 'ready' : readyCount > 0 ? 'partial' : 'needs_refill'
            const lastOutcomeCode = accepted.length ? 'ROADMAP_REPLACEMENT_COMMITTED' : 'ROADMAP_NO_SAFE_TOPIC'
            const commonUpdates = {
                interpretation,
                generation: nextGeneration,
                activeEpoch: generationEpoch,
                epochMigrationComplete: true,
                status: finalStatus,
                readyCount,
                lastRefillAt: now,
                lastOutcomeCode,
                lastErrorCode: '',
                productCatalogSnapshotId: catalog?._id || catalog?.id || null,
                contentOperationsSnapshotId: contentSnapshot.id || contentSnapshot._id || null,
                contentInventorySnapshotId: contentSnapshot.contentInventorySnapshotId || null,
                marketSnapshotId: marketSnapshot?._id || marketSnapshot?.id || null,
                latestIdeationRunId: ideationRunId || null,
                ...(regenerationId ? { latestRegenerationId: regenerationId } : {}),
                scoreRubricVersion: RUBRIC_VERSION,
                corpusVersion: INDEX_VERSION,
                corpusHash: accepted[0]?.scores?.corpusHash || '',
                sourceHealth: earlySourceHealth,
                rejectedCandidates: rejected.slice(0, 100)
            }
            let saved
            if (preserveActivePlan) {
                if (typeof assertReplacementOwner === 'function' && await assertReplacementOwner() === false) {
                    throw regenerationError('ROADMAP_REGENERATION_LEASE_LOST', 'The regeneration lease was lost before activation')
                }
                const commitFilter = {
                    _id: roadmap._id,
                    directionRevision: expectedRoadmap.directionRevision,
                    generation: expectedRoadmap.baseGeneration,
                    activeEpoch: expectedRoadmap.baseEpoch
                }
                saved = await this.RoadmapModel.findOneAndUpdate(
                    commitFilter,
                    { $set: commonUpdates },
                    { new: true, runValidators: true }
                )
                if (!saved) throw regenerationError('ROADMAP_REGENERATION_SUPERSEDED', 'The roadmap changed before replacement activation')
                await this.ItemModel.updateMany(
                    {
                        roadmapId: roadmap._id,
                        status: 'ready',
                        activationEpoch: { $ne: generationEpoch }
                    },
                    { $set: { status: 'dismissed', dismissedAt: now, reasonCode: text(reason, 160) } }
                )
            } else {
                saved = await this.releaseRefillLease({
                    roadmapId: roadmap._id,
                    token: lease.token,
                    updates: commonUpdates
                })
            }
            if (!readyCount) {
                throw regenerationError('ROADMAP_NO_SAFE_TOPIC', 'No safe distinct topic is available in the roadmap')
            }
            return {
                roadmap: asPlain(saved),
                readyCount,
                refilled: true,
                accepted: accepted.length,
                activationEpoch: generationEpoch,
                ideationRunId
            }
        } catch (error) {
            const code = text(error?.code || error?.message || 'ROADMAP_REFILL_FAILED', 160)
            // Only the current regeneration owner may remove staged candidates. A
            // suspended worker can resume after its lease expires while a successor
            // is already rebuilding the same target epoch; unfenced cleanup from the
            // stale worker would delete the successor's safe candidates.
            const mayCleanStagedItems = !preserveActivePlan || typeof assertReplacementOwner !== 'function'
                ? true
                : await Promise.resolve(assertReplacementOwner()).catch(() => false)
            if (mayCleanStagedItems) {
                await this.ItemModel.deleteMany({
                    roadmapId: roadmap._id,
                    activationEpoch: generationEpoch,
                    status: 'ready'
                }).catch(() => null)
            }
            if (!preserveActivePlan) {
                const remainingReady = await this.ItemModel.countDocuments(this.claimableReadyMatch(roadmap))
                const safeNoTopic = [
                    'ROADMAP_NO_ACCEPTABLE_TOPIC',
                    'ROADMAP_NO_SAFE_TOPIC',
                    'ROADMAP_NO_READY_TOPIC',
                    ROADMAP_REQUIRED_EVIDENCE_UNAVAILABLE,
                    ROADMAP_SCORE_UNREACHABLE
                ].includes(code)
                await this.releaseRefillLease({
                    roadmapId: roadmap._id,
                    token: lease.token,
                    updates: {
                        status: safeNoTopic
                            ? remainingReady >= minimumReady
                                ? 'ready'
                                : remainingReady > 0
                                    ? 'partial'
                                    : 'needs_refill'
                            : 'failed',
                        readyCount: remainingReady,
                        lastOutcomeCode: safeNoTopic ? code : '',
                        lastErrorCode: safeNoTopic ? '' : code,
                        sourceHealth: earlySourceHealth,
                        lastRefillAt: now
                    }
                }).catch(() => null)
            }
            throw error
        }
    }

    async claimNext({ scheduleId, executionId }) {
        const schedule = await this.readSchedule(scheduleId)
        const executionObjectId = convertToObjectIdMongodb(executionId)
        if (!executionObjectId) throw new BadRequestError('Invalid execution id')
        const execution = await this.ExecutionModel.findOne({
            _id: executionObjectId,
            scheduleId: schedule._id,
            isQaTest: { $ne: true },
            status: 'running'
        }).select('_id scheduleId status').lean()
        if (!execution) throw new BadRequestError('Roadmap item can only be claimed by an active schedule execution')
        const roadmap = await this.initialize({ schedule })
        const existing = await this.ItemModel.findOne({
            roadmapId: roadmap._id,
            claimExecutionId: execution._id,
            status: 'claimed'
        }).select('+claimToken').lean()
        if (existing) {
            if (hasValidTopicScoreIntegrity(existing, this.policy)) {
                return this.buildTrustedContext({ roadmap, item: existing, schedule, execution })
            }
            await this.ItemModel.updateOne(
                { _id: existing._id, status: 'claimed', claimExecutionId: execution._id },
                {
                    $set: {
                        status: 'invalidated',
                        invalidatedAt: this.now(),
                        reasonCode: 'score_integrity_failed'
                    },
                    $unset: {
                        claimToken: '',
                        claimUntil: '',
                        claimExecutionId: '',
                        claimedAt: ''
                    }
                }
            )
        }

        const now = this.now()
        const claimToken = this.randomUUID()
        const claimUntil = new Date(now.getTime() + Number(this.roadmapConfig.claimLeaseMs || 5_400_000))
        const item = await this.ItemModel.findOneAndUpdate(
            {
                ...this.claimableReadyMatch(roadmap),
                scheduleId: schedule._id
            },
            {
                $set: {
                    status: 'claimed',
                    claimToken,
                    claimUntil,
                    claimExecutionId: execution._id,
                    claimedAt: now
                },
                $inc: { attemptCount: 1 }
            },
            { sort: { generation: 1, rank: 1, createdAt: 1 }, new: true, runValidators: true }
        ).select('+claimToken').lean()
        if (!item) {
            const error = new Error('No ready topic roadmap item is available')
            error.code = 'ROADMAP_NO_READY_TOPIC'
            throw error
        }
        if (!hasValidTopicScoreIntegrity(item, this.policy)) {
            await this.ItemModel.updateOne(
                {
                    _id: item._id,
                    status: 'claimed',
                    claimExecutionId: execution._id,
                    claimToken
                },
                {
                    $set: {
                        status: 'invalidated',
                        invalidatedAt: now,
                        reasonCode: 'score_integrity_failed'
                    },
                    $unset: {
                        claimToken: '',
                        claimUntil: '',
                        claimExecutionId: '',
                        claimedAt: ''
                    }
                }
            )
            return this.claimNext({ scheduleId, executionId })
        }
        await this.RoadmapModel.updateOne(
            { _id: roadmap._id },
            { $inc: { readyCount: -1 }, $set: { status: 'needs_refill', refillRequestedAt: now, refillReason: 'item_claimed' } }
        )
        return this.buildTrustedContext({ roadmap, item, schedule, execution })
    }

    buildTrustedContext({ roadmap, item, schedule, execution }) {
        return {
            claimToken: item.claimToken,
            roadmapId: asId(roadmap),
            itemId: asId(item),
            scheduleId: asId(schedule),
            executionId: asId(execution),
            directionRevision: Number(item.directionRevision || 1),
            generation: Number(item.generation || 1),
            topic: item.topic,
            angle: item.angle,
            primaryKeyword: item.primaryKeyword,
            secondaryKeywords: item.secondaryKeywords || [],
            primaryQuestion: item.primaryQuestion,
            supportingQuestions: item.supportingQuestions || [],
            targetAudience: item.targetAudience || [],
            userProblems: item.userProblems || [],
            searchIntent: item.searchIntent,
            articleType: item.articleType,
            categoryKey: item.categoryKey,
            managerDirection: roadmap.direction,
            opportunityScore: Number(item.scores?.totalScore || 0),
            topicScoreReport: {
                ...(item.scores || {}),
                acceptanceScore: this.policy.acceptanceScore,
                minimumNoveltySubtotal: this.policy.minimumNoveltySubtotal
            },
            ideationRunId: asId(item.ideationRunId),
            productEvidence: item.productEvidence || [],
            marketEvidence: item.marketEvidence || []
        }
    }

    async transitionClaim({ context, status, updates = {}, reasonCode = '' }) {
        if (!ITEM_STATUSES.has(status) || status === 'claimed' || status === 'ready') {
            throw new BadRequestError('Invalid terminal roadmap status')
        }
        const now = this.now()
        const timeField = status === 'completed'
            ? 'completedAt'
            : status === 'dismissed'
                ? 'dismissedAt'
                : status === 'invalidated'
                    ? 'invalidatedAt'
                    : 'failedAt'
        const item = await this.ItemModel.findOneAndUpdate(
            {
                _id: context.itemId,
                roadmapId: context.roadmapId,
                scheduleId: context.scheduleId,
                claimExecutionId: context.executionId,
                claimToken: context.claimToken,
                status: 'claimed'
            },
            {
                $set: { status, [timeField]: now, reasonCode: text(reasonCode, 160), ...updates },
                $unset: { claimToken: '', claimUntil: '' }
            },
            { new: true, runValidators: true }
        )
        if (!item) {
            const error = new Error('Roadmap item claim was lost')
            error.code = 'ROADMAP_ITEM_CLAIM_LOST'
            throw error
        }
        await this.RoadmapModel.updateOne(
            { _id: context.roadmapId, status: { $ne: 'archived' } },
            { $set: { status: 'needs_refill', refillRequestedAt: now, refillReason: `item_${status}` } }
        )
        return safeItemView(item)
    }

    async completeClaim({ context, blogId, workOrderId, briefId }) {
        return this.transitionClaim({
            context,
            status: 'completed',
            updates: {
                blogId: convertToObjectIdMongodb(blogId) || null,
                contentWorkOrderId: convertToObjectIdMongodb(workOrderId) || null,
                unifiedContentBriefId: convertToObjectIdMongodb(briefId) || null
            }
        })
    }

    async invalidateClaim({ context, reasonCode }) {
        return this.transitionClaim({ context, status: 'invalidated', reasonCode })
    }

    async failClaim({ context, error }) {
        const failure = classifyTerminalFailure(error)
        const item = await this.ItemModel.findOne({
            _id: context.itemId,
            claimToken: context.claimToken,
            status: 'claimed'
        }).select('+claimToken').lean()
        if (!item) return null
        const maxAttempts = Number(this.roadmapConfig.maxClaimAttempts || 3)
        if (failure.transient && Number(item.attemptCount || 0) < maxAttempts) {
            const saved = await this.ItemModel.findOneAndUpdate(
                { _id: item._id, claimToken: context.claimToken, status: 'claimed' },
                {
                    $set: { status: 'ready', reasonCode: failure.code },
                    $unset: { claimToken: '', claimUntil: '', claimExecutionId: '', claimedAt: '' }
                },
                { new: true }
            )
            if (saved) await this.RoadmapModel.updateOne(
                { _id: context.roadmapId },
                { $inc: { readyCount: 1 }, $set: { status: 'ready', lastErrorCode: failure.code } }
            )
            return saved ? safeItemView(saved) : null
        }
        return this.transitionClaim({ context, status: 'failed', reasonCode: failure.code })
    }

    async recoverExecutionClaim({ executionId, reasonCode = 'STALE_RUNNING_EXECUTION_RECOVERED' }) {
        const objectId = convertToObjectIdMongodb(executionId)
        if (!objectId) return null
        const item = await this.ItemModel.findOne({
            claimExecutionId: objectId,
            status: 'claimed'
        }).select('+claimToken').lean()
        if (!item) return null
        const execution = await this.ExecutionModel.findById(objectId)
            .select('status blogId contentWorkOrderId unifiedContentBriefId')
            .lean()
        const context = {
            itemId: asId(item),
            roadmapId: asId(item.roadmapId),
            scheduleId: asId(item.scheduleId),
            executionId: asId(item.claimExecutionId),
            claimToken: item.claimToken
        }
        if (execution && ['draft_created', 'published', 'completed'].includes(execution.status)) {
            return this.completeClaim({
                context,
                blogId: execution.blogId,
                workOrderId: execution.contentWorkOrderId,
                briefId: execution.unifiedContentBriefId
            })
        }
        return this.failClaim({
            context,
            error: Object.assign(new Error(reasonCode), { code: reasonCode })
        })
    }

    async recoverExpiredClaims({ now = this.now() } = {}) {
        const expired = await this.ItemModel.find({ status: 'claimed', claimUntil: { $lte: now } })
            .select('+claimToken')
            .limit(100)
            .lean()
        const results = []
        for (const item of expired) {
            const execution = item.claimExecutionId
                ? await this.ExecutionModel.findById(item.claimExecutionId).select('status blogId contentWorkOrderId unifiedContentBriefId').lean()
                : null
            const context = {
                itemId: asId(item),
                roadmapId: asId(item.roadmapId),
                scheduleId: asId(item.scheduleId),
                executionId: asId(item.claimExecutionId),
                claimToken: item.claimToken
            }
            if (execution && ['draft_created', 'published', 'completed'].includes(execution.status)) {
                results.push(await this.completeClaim({
                    context,
                    blogId: execution.blogId,
                    workOrderId: execution.contentWorkOrderId,
                    briefId: execution.unifiedContentBriefId
                }).catch(() => null))
            } else {
                results.push(await this.failClaim({
                    context,
                    error: Object.assign(new Error('Roadmap claim lease expired'), { code: 'ROADMAP_CLAIM_EXPIRED' })
                }).catch(() => null))
            }
        }
        return results.filter(Boolean)
    }

    async dismiss({ scheduleId, itemId, reason = 'dismissed_by_admin' }) {
        const schedule = await this.readSchedule(scheduleId)
        const itemObjectId = convertToObjectIdMongodb(itemId)
        if (!itemObjectId) throw new BadRequestError('Invalid roadmap item id')
        const now = this.now()
        const roadmap = await this.RoadmapModel.findOne({ scheduleId: schedule._id }).select('_id activeEpoch').lean()
        const item = await this.ItemModel.findOneAndUpdate(
            {
                _id: itemObjectId,
                scheduleId: schedule._id,
                status: 'ready',
                ...(roadmap?.activeEpoch ? { activationEpoch: roadmap.activeEpoch } : {})
            },
            { $set: { status: 'dismissed', dismissedAt: now, reasonCode: text(reason, 160) } },
            { new: true }
        ).lean()
        if (!item) throw new NotFoundError('Ready roadmap item not found')
        await this.RoadmapModel.updateOne(
            { _id: item.roadmapId },
            { $inc: { readyCount: -1 }, $set: { status: 'needs_refill', refillRequestedAt: now, refillReason: 'item_dismissed' } }
        )
        return this.getRoadmap({ scheduleId })
    }

    async enqueueRegeneration({
        scheduleId,
        reason = 'regenerated_by_admin',
        idempotencyKey = '',
        adminId = '',
        requestId = ''
    }) {
        if (this.roadmapConfig.enabled === false) {
            const error = new BadRequestError('Smart topic roadmap is disabled')
            error.code = 'TOPIC_ROADMAP_DISABLED'
            throw error
        }
        const schedule = await this.readSchedule(scheduleId)
        const roadmap = asPlain(await this.initialize({ schedule }))
        const key = text(idempotencyKey, 128)
        if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) throw new BadRequestError('A valid Idempotency-Key is required')
        const requestHash = sha256(`${asId(schedule)}\0${String(adminId || 'system')}\0${key}`)
        const suppliedCorrelationId = text(requestId, 128)
        const correlationId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(suppliedCorrelationId)
            ? suppliedCorrelationId
            : this.randomUUID()
        let existing = await this.RegenerationModel.findOne({
            roadmapId: roadmap._id,
            $or: [
                { idempotencyKeyHash: requestHash },
                { coalescedIdempotencyKeyHashes: requestHash }
            ]
        }).select('+coalescedIdempotencyKeyHashes').lean()
        if (existing) return {
            queued: ['queued', 'running'].includes(existing.status),
            duplicate: true,
            coalesced: existing.idempotencyKeyHash !== requestHash &&
                Boolean((existing.coalescedIdempotencyKeyHashes || []).includes(requestHash)),
            regeneration: safeRegenerationView(existing)
        }
        const activeQuery = this.RegenerationModel.findOneAndUpdate(
            {
                roadmapId: roadmap._id,
                activeFence: true,
                status: { $in: ['queued', 'running'] },
                coalescedIdempotencyKeyHashes: { $ne: requestHash }
            },
            { $addToSet: { coalescedIdempotencyKeyHashes: requestHash } },
            { new: true, runValidators: true }
        )
        if (typeof activeQuery?.select === 'function') activeQuery.select('+coalescedIdempotencyKeyHashes')
        if (typeof activeQuery?.sort === 'function') activeQuery.sort({ createdAt: 1, _id: 1 })
        const active = await activeQuery
        if (active) return { queued: true, duplicate: false, coalesced: true, regeneration: safeRegenerationView(active) }

        const now = this.now()
        const baseEpoch = text(roadmap.activeEpoch, 80)
        const targetGeneration = Number(roadmap.generation || 0) + 1
        const targetEpoch = epochFor({
            roadmapId: roadmap._id,
            directionRevision: roadmap.directionRevision,
            generation: targetGeneration,
            seed: requestHash
        })
        try {
            const created = await this.RegenerationModel.create({
                scheduleId: schedule._id,
                roadmapId: roadmap._id,
                directionRevision: roadmap.directionRevision,
                baseEpoch,
                targetEpoch,
                baseGeneration: Number(roadmap.generation || 0),
                targetGeneration,
                idempotencyKeyHash: requestHash,
                // The legacy unique sparse compound index also indexes the
                // always-present roadmapId. An empty coalesced array therefore
                // behaves like one shared null value and blocks the second
                // regeneration for a roadmap. Persisting the primary request
                // identity in the multikey array keeps every document on a
                // real, unique value and also strengthens replay fencing.
                coalescedIdempotencyKeyHashes: [requestHash],
                requester: text(adminId || 'system', 160),
                correlationId,
                reason: text(reason, 160),
                status: 'queued',
                activeFence: true,
                nextRetryAt: now
            })
            await this.RoadmapModel.updateOne(
                { _id: roadmap._id },
                { $set: { refillRequestedAt: now, refillReason: text(reason, 160), latestRegenerationId: created._id } }
            )
            return { queued: true, duplicate: false, coalesced: false, regeneration: safeRegenerationView(created) }
        } catch (error) {
            if (!isDuplicateKeyError(error)) throw error
            if (isRegenerationIdempotencyDuplicate(error)) {
                existing = await this.RegenerationModel.findOne({
                    roadmapId: roadmap._id,
                    $or: [
                        { idempotencyKeyHash: requestHash },
                        { coalescedIdempotencyKeyHashes: requestHash }
                    ]
                }).select('+coalescedIdempotencyKeyHashes').lean()
                if (existing) return {
                    queued: ['queued', 'running'].includes(existing.status),
                    duplicate: true,
                    coalesced: existing.idempotencyKeyHash !== requestHash &&
                        Boolean((existing.coalescedIdempotencyKeyHashes || []).includes(requestHash)),
                    regeneration: safeRegenerationView(existing)
                }
            }
            const coalescedQuery = this.RegenerationModel.findOneAndUpdate(
                { roadmapId: roadmap._id, activeFence: true },
                { $addToSet: { coalescedIdempotencyKeyHashes: requestHash } },
                { new: true, runValidators: true }
            )
            if (typeof coalescedQuery?.select === 'function') coalescedQuery.select('+coalescedIdempotencyKeyHashes')
            existing = await coalescedQuery
            if (!existing) throw error
            return { queued: ['queued', 'running'].includes(existing.status), duplicate: false, coalesced: true, regeneration: safeRegenerationView(existing) }
        }
    }

    async claimQueuedRegeneration({ workerId = `topic-roadmap-${process.pid}`, now = this.now() } = {}) {
        const token = this.randomUUID()
        const tokenHash = sha256(token)
        const leaseExpiresAt = new Date(now.getTime() + Number(this.roadmapConfig.regenerationLeaseMs || this.roadmapConfig.refillLeaseMs || 600_000))
        const job = await this.RegenerationModel.findOneAndUpdate(
            {
                activeFence: true,
                status: { $in: ['queued', 'running'] },
                attemptCount: { $lt: Number(this.roadmapConfig.regenerationMaxAttempts || 5) },
                $and: [
                    { $or: [{ nextRetryAt: null }, { nextRetryAt: { $exists: false } }, { nextRetryAt: { $lte: now } }] },
                    { $or: [{ leaseExpiresAt: null }, { leaseExpiresAt: { $exists: false } }, { leaseExpiresAt: { $lte: now } }] }
                ]
            },
            {
                $set: {
                    status: 'running',
                    leaseTokenHash: tokenHash,
                    leaseExpiresAt,
                    lastHeartbeatAt: now,
                    lastAttemptAt: now,
                    startedAt: now,
                    errorCode: ''
                },
                $inc: { attemptCount: 1 }
            },
            { sort: { nextRetryAt: 1, createdAt: 1, _id: 1 }, new: true }
        ).select('+leaseTokenHash').lean()
        if (job) return { job, token, tokenHash, leaseExpiresAt, workerId: text(workerId, 160) }

        // Release a poison single-flight fence after its final lease expires. Without
        // this terminalization, a max-attempt running job would block every future
        // regeneration request forever while no worker could claim it.
        const exhausted = await this.RegenerationModel.findOneAndUpdate(
            {
                activeFence: true,
                status: { $in: ['queued', 'running'] },
                attemptCount: { $gte: Number(this.roadmapConfig.regenerationMaxAttempts || 5) },
                $or: [{ leaseExpiresAt: null }, { leaseExpiresAt: { $exists: false } }, { leaseExpiresAt: { $lte: now } }]
            },
            {
                $set: {
                    status: 'failed',
                    outcome: '',
                    outcomeCode: '',
                    errorCode: 'ROADMAP_REGENERATION_ATTEMPTS_EXHAUSTED',
                    completedAt: now,
                    activeFence: false,
                    nextRetryAt: null
                },
                $unset: { leaseTokenHash: '', leaseExpiresAt: '' }
            },
            { sort: { createdAt: 1, _id: 1 }, new: true }
        )
        return exhausted ? { exhausted: safeRegenerationView(exhausted) } : null
    }

    async heartbeatRegeneration({ jobId, tokenHash }) {
        const now = this.now()
        const result = await this.RegenerationModel.updateOne(
            {
                _id: jobId,
                status: 'running',
                activeFence: true,
                leaseTokenHash: tokenHash,
                leaseExpiresAt: { $gt: now }
            },
            {
                $set: {
                    leaseExpiresAt: new Date(now.getTime() + Number(this.roadmapConfig.regenerationLeaseMs || this.roadmapConfig.refillLeaseMs || 600_000)),
                    lastHeartbeatAt: now
                }
            }
        )
        return Number(result?.matchedCount ?? result?.modifiedCount ?? result?.n ?? 0) === 1
    }

    async completeRegeneration({
        job,
        tokenHash,
        outcome,
        outcomeCode = '',
        errorCode = '',
        sourceHealth = [],
        ideationRunId = null,
        retry = false
    }) {
        const completedAt = this.now()
        const terminalSet = retry
            ? {
                status: 'queued',
                outcome: '',
                outcomeCode: '',
                errorCode: text(errorCode, 160),
                sourceHealth: (sourceHealth || []).slice(0, 50),
                completedAt: null,
                activeFence: true,
                nextRetryAt: new Date(completedAt.getTime() + Number(this.roadmapConfig.regenerationRetryDelayMs || 30_000))
            }
            : {
                status: errorCode ? 'failed' : 'completed',
                outcome: errorCode ? '' : outcome,
                outcomeCode: errorCode ? '' : text(outcomeCode, 160),
                errorCode: errorCode ? text(errorCode, 160) : '',
                sourceHealth: (sourceHealth || []).slice(0, 50),
                ideationRunId: ideationRunId || null,
                completedAt,
                activeFence: false,
                nextRetryAt: null
            }
        const query = this.RegenerationModel.findOneAndUpdate(
            {
                _id: job._id,
                status: 'running',
                activeFence: true,
                leaseTokenHash: tokenHash,
                leaseExpiresAt: { $gt: completedAt }
            },
            {
                $set: terminalSet,
                $unset: { leaseTokenHash: '', leaseExpiresAt: '' }
            },
            { new: true, runValidators: true }
        )
        if (typeof query?.select === 'function') query.select('+leaseTokenHash')
        const saved = await query
        if (!saved) throw regenerationError('ROADMAP_REGENERATION_LEASE_LOST')
        return saved
    }

    async runQueuedRegenerationOnce({ workerId = `topic-roadmap-${process.pid}` } = {}) {
        const claim = await this.claimQueuedRegeneration({ workerId })
        if (!claim) return null
        if (claim.exhausted) return claim.exhausted
        const { job, tokenHash } = claim
        const base = {
            roadmapId: job.roadmapId,
            directionRevision: job.directionRevision,
            baseGeneration: job.baseGeneration,
            baseEpoch: job.baseEpoch
        }
        const leaseMs = Number(this.roadmapConfig.regenerationLeaseMs || this.roadmapConfig.refillLeaseMs || 600_000)
        const heartbeatMs = Math.min(60_000, Math.max(5_000, Math.floor(leaseMs / 3)))
        let heartbeatPromise = null
        let ownershipLost = false
        const renewOwnership = async () => {
            if (ownershipLost) return false
            if (heartbeatPromise) return heartbeatPromise
            heartbeatPromise = this.heartbeatRegeneration({ jobId: job._id, tokenHash })
                .then((owned) => {
                    if (!owned) ownershipLost = true
                    return owned
                })
                .catch(() => {
                    ownershipLost = true
                    return false
                })
                .finally(() => {
                    heartbeatPromise = null
                })
            return heartbeatPromise
        }
        const heartbeat = setInterval(() => {
            void renewOwnership()
        }, heartbeatMs)
        heartbeat.unref?.()
        try {
            const activated = await this.RoadmapModel.findOne({
                _id: job.roadmapId,
                directionRevision: job.directionRevision,
                generation: job.targetGeneration,
                activeEpoch: job.targetEpoch
            }).lean()
            if (activated) {
                const completed = await this.completeRegeneration({
                    job,
                    tokenHash,
                    outcome: 'replacement_committed',
                    outcomeCode: 'ROADMAP_REPLACEMENT_COMMITTED',
                    sourceHealth: activated.sourceHealth || [],
                    ideationRunId: activated.latestIdeationRunId || null
                })
                return safeRegenerationView(completed)
            }
            const result = await this.ensureReadyBuffer({
                scheduleId: job.scheduleId,
                reason: job.reason,
                force: true,
                activationEpoch: job.targetEpoch,
                regenerationId: job._id,
                expectedRoadmap: base,
                preserveActivePlan: true,
                assertReplacementOwner: async () => {
                    if (ownershipLost) return false
                    return renewOwnership()
                }
            })
            const completed = await this.completeRegeneration({
                job,
                tokenHash,
                outcome: 'replacement_committed',
                outcomeCode: 'ROADMAP_REPLACEMENT_COMMITTED',
                sourceHealth: result.roadmap.sourceHealth || [],
                ideationRunId: result.ideationRunId
            })
            return safeRegenerationView(completed)
        } catch (error) {
            const code = text(error?.code || 'ROADMAP_REGENERATION_FAILED', 160)
            const noChange = [
                'ROADMAP_NO_ACCEPTABLE_TOPIC',
                'ROADMAP_NO_SAFE_TOPIC',
                'ROADMAP_REGENERATION_SUPERSEDED',
                ROADMAP_REQUIRED_EVIDENCE_UNAVAILABLE,
                ROADMAP_SCORE_UNREACHABLE
            ].includes(code)
            const retryable = isTransientFailureCode(code) && Number(job.attemptCount || 0) < Number(this.roadmapConfig.regenerationMaxAttempts || 5)
            const sourceHealth = await this.RegenerationModel.findById(job._id).select('sourceHealth').lean()
                .then((value) => value?.sourceHealth || [])
                .catch(() => [])
            let completed
            try {
                completed = await this.completeRegeneration({
                    job,
                    tokenHash,
                    outcome: noChange ? (code === 'ROADMAP_REGENERATION_SUPERSEDED' ? 'superseded' : 'no_change') : '',
                    outcomeCode: noChange ? code : '',
                    errorCode: noChange ? '' : code,
                    sourceHealth,
                    retry: retryable
                })
            } catch (completionError) {
                if (completionError?.code === 'ROADMAP_REGENERATION_LEASE_LOST') return null
                throw completionError
            }
            if (!noChange && !retryable) {
                error.correlationId = text(job.correlationId, 128)
                error.regenerationId = asId(job)
                throw error
            }
            return safeRegenerationView(completed)
        } finally {
            clearInterval(heartbeat)
            if (heartbeatPromise) await heartbeatPromise
        }
    }

    async regenerate(input) {
        return this.enqueueRegeneration(input)
    }

    async archiveForSchedule({ scheduleId }) {
        const objectId = convertToObjectIdMongodb(scheduleId)
        if (!objectId) return false
        const activeClaim = await this.ItemModel.findOne({
            scheduleId: objectId,
            status: 'claimed'
        }).select('_id').lean()
        if (activeClaim) {
            const error = new BadRequestError('A claimed roadmap item must finish or recover before this schedule can be archived')
            error.code = 'BLOG_SCHEDULE_ACTIVE_ROADMAP_CLAIM'
            throw error
        }
        const roadmap = await this.RoadmapModel.findOneAndUpdate(
            { scheduleId: objectId, status: { $ne: 'archived' } },
            { $set: { status: 'archived', archivedAt: this.now(), readyCount: 0 } },
            { new: true }
        ).lean()
        if (!roadmap) return false
        await this.ItemModel.updateMany(
            { roadmapId: roadmap._id, status: 'ready' },
            { $set: { status: 'dismissed', dismissedAt: this.now(), reasonCode: 'schedule_deleted' } }
        )
        return true
    }
}

module.exports = {
    BlogTopicRoadmapService,
    classifyTerminalFailure,
    focusMatchesCard,
    hasCurrentEvidenceIntegrity,
    hasValidTopicScoreIntegrity,
    mapMarketEvidence,
    mapProductEvidence,
    isTransientFailureCode,
    marketSourceHealthEntries,
    normalizeDirection,
    retainAlignedMarketEvidence,
    retainBoundProductEvidence,
    safeItemView,
    safeRegenerationView,
    safeRoadmapView,
    scopeCoverageForInterpretation,
    uniquenessKeyFor
}
