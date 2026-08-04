'use strict'

const crypto = require('node:crypto')
const { TopicIdeationRun } = require('../../models/topicIdeationRun.model')
const { OpenClawAgentAdapter } = require('../openclawAgentAdapter.service')
const { normalizeIdea } = require('./blogIdeation.service')
const {
    ACCEPTANCE_SCORE,
    MIN_NOVELTY_SUBTOTAL,
    ROADMAP_REQUIRED_EVIDENCE_UNAVAILABLE,
    ROADMAP_SCORE_UNREACHABLE,
    RUBRIC_VERSION,
    assessTopicPlanReachability,
    productFamiliesFor,
    resolveRoadmapThresholds
} = require('./topicRoadmapScoring.service')

const boundedArray = (value, max = 100) => (Array.isArray(value) ? value : []).slice(0, max)
const REQUIRED_CANDIDATE_COUNT = 24
const CANDIDATE_BATCH_SIZE = 12
const MAX_NOVELTY_AVOIDANCE_ITEMS = 12
const ROUND_BATCH_FOCI = Object.freeze([
    Object.freeze([
        'Prioritize demand, common problems, practical use cases and comparisons.',
        'Prioritize care, safety, seasonal, category and product-backed angles.'
    ]),
    Object.freeze([
        'Pivot to underrepresented reader situations, search intents, product scopes and categories from prior rejected plans.'
    ]),
    Object.freeze([
        'Pivot the primary reader decision and article plan; use a verified evidence-backed question not covered by prior plans or collision titles.'
    ])
])
const compactText = (value, max = 300) => {
    if (value === null || value === undefined || typeof value === 'object') return ''
    return String(value)
        .replace(new RegExp('[\u0000-\u001f\u007f]', 'g'), '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max)
}
const asList = (value) => value === null || value === undefined
    ? []
    : Array.isArray(value)
        ? value
        : [value]
const compactList = (value, maxItems = 12, maxLength = 160) => [...new Set(
    (Array.isArray(value) ? value : [])
        .map((item) => (typeof item === 'string' || typeof item === 'number' ? compactText(item, maxLength) : ''))
        .filter(Boolean)
)].slice(0, maxItems)

const boundedSessionToken = (value, maxLength = 48) => {
    const raw = compactText(value, 500)
    const safe = raw
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/[^a-z0-9._-]+/gi, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase()
    if (safe && safe.length <= maxLength) return safe
    const digest = crypto.createHash('sha256').update(raw || 'missing').digest('hex').slice(0, 16)
    if (!safe) return digest
    return `${safe.slice(0, Math.max(1, maxLength - 17))}-${digest}`
}

const buildTopicSessionKey = ({ runId, roadmapId, directionRevision, generation, agentId, purpose } = {}) => {
    const persistedRunId = runId && typeof runId === 'object' && typeof runId.toHexString === 'function'
        ? compactText(runId.toHexString(), 200)
        : compactText(runId, 200)
    const runReference = persistedRunId
        || `${compactText(roadmapId, 100)}:${Number(directionRevision) || 0}:${Number(generation) || 0}`
    return [
        'topic',
        boundedSessionToken(runReference, 64),
        boundedSessionToken(agentId, 48),
        boundedSessionToken(purpose, 48)
    ].join(':')
}

const compactCollision = (collision) => collision ? {
    sourceType: compactText(collision.sourceType, 40),
    sourceId: compactText(collision.sourceId, 100),
    title: compactText(collision.title, 240),
    lexicalSimilarity: Number(collision.lexicalSimilarity || 0),
    topicSimilarity: Number(collision.topicSimilarity || 0),
    planSimilarity: Number(collision.planSimilarity || 0),
    sameIntent: collision.sameIntent === true
} : null

const focusForRound = (round = 1, batchIndex = 0) => {
    const group = ROUND_BATCH_FOCI[Math.min(ROUND_BATCH_FOCI.length - 1, Math.max(0, Number(round || 1) - 1))]
    return group[Math.max(0, Number(batchIndex) || 0) % group.length]
}

const compactNoveltyAvoidance = (rejected = [], maxItems = MAX_NOVELTY_AVOIDANCE_ITEMS) => {
    const limit = Math.max(1, Math.min(20, Number(maxItems) || MAX_NOVELTY_AVOIDANCE_ITEMS))
    const priorPlans = []
    const seenPlans = new Set()
    for (const entry of [...boundedArray(rejected, 200)].reverse()) {
        const topic = compactText(entry?.topic, 240)
        const primaryQuestion = compactText(entry?.primaryQuestion, 240)
        const key = `${topic}\u0000${primaryQuestion}`.toLocaleLowerCase('vi')
        if (!topic || seenPlans.has(key)) continue
        seenPlans.add(key)
        priorPlans.push({
            topic,
            angle: compactText(entry?.angle, 240),
            primaryQuestion,
            categoryKey: compactText(entry?.categoryKey, 80),
            productScope: compactText(entry?.productScope, 80),
            searchIntent: compactText(entry?.searchIntent, 120),
            articleType: compactText(entry?.articleType, 100),
            reasonCodes: compactList(entry?.reasonCodes, 8, 120),
            round: Math.max(0, Number(entry?.round) || 0)
        })
        if (priorPlans.length >= limit) break
    }

    const collisionCounts = new Map()
    for (const entry of boundedArray(rejected, 200)) {
        for (const collision of Object.values(entry?.nearestCollisions || {})) {
            const title = compactText(collision?.title, 240)
            if (!title) continue
            const key = title.toLocaleLowerCase('vi')
            const current = collisionCounts.get(key) || { title, count: 0, sameIntent: false }
            current.count += 1
            current.sameIntent = current.sameIntent || collision?.sameIntent === true
            collisionCounts.set(key, current)
        }
    }
    const collisionTitles = [...collisionCounts.values()]
        .sort((left, right) => (
            Number(right.sameIntent) - Number(left.sameIntent) ||
            right.count - left.count ||
            left.title.localeCompare(right.title, 'vi')
        ))
        .slice(0, limit)
        .map((entry) => entry.title)
    return { priorPlans, collisionTitles }
}

const extractCriticFeedback = (critic = {}) => {
    const direct = Array.isArray(critic.feedback)
        ? critic.feedback
        : Array.isArray(critic.recommendations)
            ? critic.recommendations
            : []
    if (direct.length) return boundedArray(direct, 30)
    const guidance = compactList([
        ...asList(critic.recommendedAction?.guidance),
        ...asList(critic.recommendedAction?.examplesOf_safer_directions),
        ...asList(critic.remediation?.steps),
        ...asList(critic.recommendation?.steps),
        ...asList(critic.recommendation?.nextDirection),
        ...asList(critic.recommendation?.promisingAngles),
        ...asList(critic.requiredNextStep),
        ...asList(critic.reasons),
        ...asList(critic.dataQualityNotes)
    ], 20, 300)
    const feedback = {
        summary: compactText(
            critic.summary
                || critic.diagnosis?.primary
                || critic.diagnosis?.primaryFailure
                || critic.diagnosis?.summary
                || critic.highestRisk,
            600
        ),
        decision: compactText(critic.decision || critic.overallDecision || critic.status, 120),
        recommendation: compactText(
            critic.recommendation?.action
                || critic.recommendation
                || critic.recommendedAction?.primary
                || critic.remediation?.action,
            160
        ),
        failedDimensions: compactList(
            critic.noveltyDiagnosis?.failedDimensions
                || critic.failedDimensions
                || critic.diagnosis?.failedDimensions,
            12,
            120
        ),
        patternsToAvoid: compactList(
            critic.noveltyDiagnosis?.patterns
                || critic.diagnosis?.patterns
                || asList(critic.diagnosis?.pattern),
            16,
            180
        ),
        guidance
    }
    return Object.values(feedback).some((value) => Array.isArray(value) ? value.length : Boolean(value)) ? [feedback] : []
}

const compactProductCard = (card = {}) => ({
    productId: compactText(card.productId, 100),
    sku: compactText(card.sku, 100),
    name: compactText(card.name, 200),
    categoryKey: compactText(card.categoryKey || card.category?.id, 120),
    availability: compactText(card.availability, 40),
    productLedEligible: card.productLedEligible === true,
    safeFacts: compactList(card.safeFacts, 4, 180),
    materials: compactList(card.materials, 4, 100),
    verifiedFeatures: compactList(card.verifiedFeatures, 5, 140),
    supportedUseCases: compactList(card.supportedUseCases, 5, 140),
    compatibility: compactList(card.compatibility, 4, 140),
    coverageGaps: compactList(card.coverageGaps || card.coverage?.reasons, 5, 120),
    evidenceKeys: compactList(card.evidenceKeys, 8, 140),
    evidenceHash: compactText(card.evidenceHash, 128)
})

const compactMarketSignal = (signal = {}) => ({
    evidenceId: compactText(signal.evidenceId || signal.id || signal.signalHash, 160),
    contentHash: compactText(signal.contentHash || signal.signalHash, 128),
    sourceId: compactText(signal.sourceId, 160),
    queryId: compactText(signal.queryId, 80),
    sourceType: compactText(signal.sourceType, 80),
    title: compactText(signal.title || signal.topic || signal.sourceTitle, 220),
    snippet: compactText(signal.snippet || signal.summary, 320),
    confidence: signal.confidence ?? null,
    classification: compactText(signal.classification, 20),
    observedAt: signal.observedAt || signal.sourceDate || null,
    fetchedAt: signal.fetchedAt || null,
    relevance: signal.relevance ? {
        version: compactText(signal.relevance.version, 120),
        totalScore: Number(signal.relevance.totalScore || 0),
        eligibleForIdeation: signal.relevance.eligibleForIdeation === true
    } : null
})
const MAX_COMPACT_MARKET_SIGNALS = 24

// Research is gathered for the products the brief prioritises, but the catalog
// handed to the ideator lists everything. The agent then proposed articles about
// products no source covered, and the evidence-alignment gate correctly rejected
// every one of them — a full agent budget spent for no usable topic. Rank the
// cards so evidence-backed products come first, and mark which ones a candidate
// can actually be defended with.
const scopeCardsToEvidence = (cards = [], signals = []) => {
    const evidenceFamilies = new Set(signals.flatMap((signal) => productFamiliesFor(
        [signal.title, signal.topic, signal.snippet, signal.summary].filter(Boolean).join(' ')
    )))
    const decorated = (Array.isArray(cards) ? cards : []).map((card) => {
        const families = productFamiliesFor([card.name, card.categoryKey, card.category?.id].filter(Boolean).join(' '))
        return {
            card,
            evidenceBacked: families.length > 0 && families.some((family) => evidenceFamilies.has(family))
        }
    })
    const backed = decorated.filter((entry) => entry.evidenceBacked)
    // Never hand back an empty catalog: a brief with no matching evidence still
    // needs cards so the run fails on the honest reason instead of on emptiness.
    const ordered = backed.length ? [...backed, ...decorated.filter((entry) => !entry.evidenceBacked)] : decorated
    return {
        cards: ordered.map((entry) => ({ ...entry.card, evidenceBacked: entry.evidenceBacked })),
        evidenceBackedCount: backed.length,
        evidenceFamilies: [...evidenceFamilies]
    }
}

const compactBrief = (brief = {}) => {
    const coverage = brief.productCoverage || {}
    const rawCards = Array.isArray(coverage.promptCards) && coverage.promptCards.length
        ? coverage.promptCards
        : coverage.cards
    const marketEvidence = brief.marketEvidence || {}
    const scoped = scopeCardsToEvidence(rawCards, boundedArray(marketEvidence.signals, MAX_COMPACT_MARKET_SIGNALS))
    const productCards = scoped.cards
    return {
        direction: compactText(brief.direction, 500),
        interpretation: {
            normalizedGoal: compactText(brief.interpretation?.normalizedGoal, 500),
            scopeMode: compactText(brief.interpretation?.scopeMode || 'mixed', 40),
            focusTerms: compactList(brief.interpretation?.focusTerms, 12, 120),
            excludedTerms: compactList(brief.interpretation?.excludedTerms, 10, 120),
            targetAudience: compactList(brief.interpretation?.targetAudience, 8, 140),
            topicAxes: compactList(brief.interpretation?.topicAxes, 10, 80)
        },
        allowedCategoryKeys: ['guide', 'care', 'knowledge', 'trend', 'product', 'design'],
        allowedProductScopes: ['inox', 'gang', 'dien', 'kitchen', 'seasonal', 'mixed'],
        productCoverage: {
            generation: Number(coverage.generation || 0),
            productCount: Number(coverage.productCount || 0),
            coverageHash: compactText(coverage.coverageHash || coverage.evidenceHash, 128),
            evidenceBackedCount: scoped.evidenceBackedCount,
            evidenceFamilies: scoped.evidenceFamilies.slice(0, 12),
            cards: boundedArray(productCards, 12).map((card) => ({
                ...compactProductCard(card),
                evidenceBacked: card.evidenceBacked === true
            }))
        },
        marketEvidence: {
            status: compactText(marketEvidence.status, 40),
            signals: boundedArray(marketEvidence.signals, MAX_COMPACT_MARKET_SIGNALS).map(compactMarketSignal)
        }
    }
}

const compactQueryPack = (queryPack = {}) => ({
    version: compactText(queryPack.version, 120),
    contextHash: compactText(queryPack.contextHash, 128),
    normalizedGoal: compactText(queryPack.normalizedGoal, 500),
    scopeMode: compactText(queryPack.scopeMode, 40),
    focusTerms: compactList(queryPack.focusTerms, 12, 120),
    excludedTerms: compactList(queryPack.excludedTerms, 10, 120),
    audienceTerms: compactList(queryPack.audienceTerms, 8, 140),
    catalogTerms: compactList(queryPack.catalogTerms, 16, 120),
    searchGapTerms: compactList(queryPack.searchGapTerms, 10, 140),
    queries: boundedArray(queryPack.queries, 8).map((query) => ({
        queryId: compactText(query.queryId, 80),
        axis: compactText(query.axis, 80),
        queryText: compactText(query.queryText, 500),
        anchors: compactList(query.anchors, 12, 100),
        excludedTerms: compactList(query.excludedTerms, 6, 100),
        locale: compactText(query.locale, 20),
        country: compactText(query.country, 10),
        freshnessDays: Number(query.freshnessDays || 0)
    }))
})

const compactCorpusManifest = (manifest = {}) => ({
    corpusCount: Number(manifest.corpusCount || 0),
    corpusHash: compactText(manifest.corpusHash, 128),
    indexVersion: compactText(manifest.indexVersion, 120)
})

const compactResearch = (research = {}) => ({
    status: compactText(research.status, 40),
    signals: boundedArray(research.signals, MAX_COMPACT_MARKET_SIGNALS).map(compactMarketSignal)
})

const compactSourceHealth = (entries = []) => boundedArray(entries, 50).map((entry) => ({
    source: compactText(entry?.source || entry?.sourceId, 120),
    status: compactText(entry?.status, 80),
    detail: compactText(entry?.detail || entry?.errorCode, 160),
    lastSuccessAt: entry?.lastSuccessAt || null,
    lastFailureAt: entry?.lastFailureAt || null
}))

const compactTopicContext = ({ brief, queryPack, corpusManifest } = {}) => ({
    brief: compactBrief(brief),
    queryPack: compactQueryPack(queryPack),
    corpusManifest: compactCorpusManifest(corpusManifest)
})

class TopicIdeationOrchestratorService {
    constructor({
        RunModel = TopicIdeationRun,
        agentAdapter = new OpenClawAgentAdapter(),
        scorer,
        scoreBatch = null,
        researchResolver = async (value) => value,
        now = () => new Date(),
        maxRounds = 3,
        maxCalls = 12,
        deadlineMs = 600_000,
        policy = {}
    } = {}) {
        if (typeof scorer !== 'function') throw new TypeError('An authoritative backend topic scorer is required')
        this.RunModel = RunModel
        this.agentAdapter = agentAdapter
        this.scorer = scorer
        this.scoreBatch = typeof scoreBatch === 'function' ? scoreBatch : null
        this.researchResolver = researchResolver
        this.now = now
        this.maxRounds = Math.min(3, Math.max(1, Number(maxRounds) || 3))
        this.maxCalls = Math.min(12, Math.max(4, Number(maxCalls) || 12))
        this.deadlineMs = Math.min(900_000, Math.max(30_000, Number(deadlineMs) || 600_000))
        this.policy = resolveRoadmapThresholds({
            acceptanceScore: policy.acceptanceScore || ACCEPTANCE_SCORE,
            minimumNoveltySubtotal: policy.minimumNoveltySubtotal || MIN_NOVELTY_SUBTOTAL
        })
    }

    async run({ scheduleId, roadmapId, directionRevision, generation, brief, queryPack, corpusManifest, sourceHealth = [] }) {
        const startedAt = this.now()
        const deadlineAt = startedAt.getTime() + this.deadlineMs
        const persisted = await this.RunModel.findOneAndUpdate(
            { roadmapId, directionRevision, generation },
            {
                $set: {
                    scheduleId,
                    status: 'running',
                    rubricVersion: RUBRIC_VERSION,
                    corpusHash: corpusManifest?.corpusHash || '',
                    researchContextHash: queryPack?.contextHash || '',
                    sourceHealth: compactSourceHealth(sourceHealth),
                    startedAt,
                    completedAt: null,
                    roundCount: 0,
                    callCount: 0,
                    invocations: [],
                    acceptedCandidateIds: [],
                    rejectedCandidates: [],
                    terminalCode: '',
                    outcome: '',
                    outcomeCode: '',
                    errorCode: ''
                },
                $setOnInsert: { roadmapId, directionRevision, generation }
            },
            { upsert: true, new: true, runValidators: true }
        )
        const invocations = []
        const rejected = []
        let calls = 0
        let criticFeedback = []
        let finalAccepted = []
        const seenIdeaKeys = new Set()

        const call = async (agentId, purpose, round, input, instructions) => {
            if (calls >= this.maxCalls || this.now().getTime() >= deadlineAt) {
                const error = new Error('Topic agent budget exhausted')
                error.code = 'OPENCLAW_TOPIC_AGENT_BUDGET_EXHAUSTED'
                throw error
            }
            calls += 1
            const response = await this.agentAdapter.run({
                agentId,
                purpose,
                // A persisted ideation run owns a bounded set of session slots.
                // Reuse by agent and purpose across rounds/retries; never derive
                // session identity from a wall-clock timestamp.
                sessionKey: buildTopicSessionKey({
                    runId: persisted?._id,
                    roadmapId,
                    directionRevision,
                    generation,
                    agentId,
                    purpose
                }),
                input,
                instructions
            })
            invocations.push({
                ...response.audit,
                round,
                candidateIds: boundedArray(response.output?.ideas, 80)
                    .map((idea, index) => normalizeIdea(idea, index)?.ideaId || '')
                    .filter(Boolean)
            })
            return response.output
        }

        try {
            const compactedBrief = compactBrief(brief)
            const reachability = assessTopicPlanReachability({
                sourceEvidence: compactedBrief.marketEvidence.signals,
                productEvidence: compactedBrief.productCoverage.cards.map((card) => ({
                    productId: card.productId,
                    name: card.name,
                    catalogEvidenceHash: card.evidenceHash || compactedBrief.productCoverage.coverageHash
                })),
                acceptanceScore: this.policy.acceptanceScore,
                minimumNoveltySubtotal: this.policy.minimumNoveltySubtotal,
                now: startedAt
            })
            if (!reachability.reachable) {
                const error = new Error(
                    reachability.code === ROADMAP_REQUIRED_EVIDENCE_UNAVAILABLE
                        ? 'Verified roadmap evidence is required before topic ideation'
                        : 'The available verified evidence cannot reach the configured roadmap score'
                )
                error.code = reachability.code || ROADMAP_SCORE_UNREACHABLE
                throw error
            }
            for (let round = 1; round <= this.maxRounds && this.now().getTime() < deadlineAt; round += 1) {
                const compactContext = compactTopicContext({ brief, queryPack, corpusManifest })
                const noveltyAvoidance = compactNoveltyAvoidance(rejected)
                const common = {
                    ...compactContext,
                    criticFeedback: boundedArray(criticFeedback, 20),
                    noveltyAvoidance,
                    round
                }
                const [market, keywords] = await Promise.all([
                    call('market-insight-analyst', 'market-research', round, common, 'Do not call tools. Return concise source proposals and audience/problem observations keyed by queryId. Use empty arrays for unavailable external signals, keep every text field under 240 characters, and do not score topics.'),
                    call('keyword-researcher', 'keyword-research', round, common, 'Do not call tools. Return concise keyword, intent and question opportunities keyed by queryId. Use empty arrays for unavailable external data, keep every text field under 240 characters, and never invent search metrics.')
                ])
                const validatedResearch = await this.researchResolver({ market, keywords, queryPack, round })
                // The first pass still produces the full 24-candidate funnel, but in
                // two bounded responses. A single 24-item structured response can be
                // tens of thousands of output tokens and was regularly cut off while
                // Luna was still streaming. Retry rounds use one focused batch so the
                // 12-call/600-second orchestration budget remains bounded.
                const batchCount = round === 1 && this.maxCalls - calls >= 3 ? 2 : 1
                const ideationBatches = await Promise.all(Array.from({ length: batchCount }, (_, index) => call(
                    'content-ideator',
                    `candidate-ideation-${index + 1}`,
                    round,
                    {
                        ...compactContext,
                        validatedResearch: compactResearch(validatedResearch),
                        agentResearch: { market, keywords },
                        criticFeedback: boundedArray(criticFeedback, 20),
                        noveltyAvoidance,
                        requiredCandidateCount: CANDIDATE_BATCH_SIZE,
                        batch: { index: index + 1, total: batchCount, focus: focusForRound(round, index) }
                    },
                    [
                        `Return exactly ${CANDIDATE_BATCH_SIZE} distinct, concise ideas in an ideas array.`,
                        focusForRound(round, index),
                        round > 1
                            ? 'Treat noveltyAvoidance as negative examples only: do not paraphrase them. Every new idea must pivot at least two of these dimensions: reader situation, primary decision, search intent, or article plan. Do NOT pivot to a product the supplied evidence does not cover — changing product is not a valid way to be different.'
                            : '',
                        'Each idea must use: topic, angle, primaryQuestion, supportingQuestions, searchIntent, categoryKey, productScope, rationale, keywords, primaryKeyword, targetAudience, userProblems, productIds, productEvidenceKeys, and marketEvidenceIds.',
                        'Keep supportingQuestions to 2, keywords to 4, targetAudience to 2, userProblems to 2, and rationale under 180 characters.',
                        'Every idea must cite at least one supplied eligible market evidence ID in marketEvidenceIds that directly supports its primaryQuestion. If no supplied evidence supports an idea, omit that idea.',
                        // The alignment gate scores a candidate only on sources that
                        // match its own product and search intent. An idea about a
                        // product no supplied source discusses is therefore certain
                        // to be rejected, so it must never be produced.
                        compactContext.brief.productCoverage.evidenceBackedCount
                            ? 'Product cards marked evidenceBacked=true are the ONLY products the supplied sources actually discuss. Every idea must be about one of those products, must cite its exact supplied productId, and must name that product or its family in both the topic and the primaryQuestion. Ideas about any other product will be rejected.'
                            : compactContext.brief.productCoverage.cards.length
                                ? 'Verified product cards are supplied, so every idea must cite at least one exact supplied productId and must name that product or its family in the topic and primaryQuestion.'
                                : '',
                        'The cited market evidence must discuss the SAME product and the SAME kind of question as the idea. Do not support a cleaning question with a buying-guide source, and never support one product with another product\'s source.',
                        'For product-led ideas, cite only exact supplied productIds and productEvidenceKeys that support the proposed angle.',
                        'Use productIds and evidence IDs only when they exactly match IDs supplied in the input; never invent or alter an ID.',
                        'Do not return candidate scores; the backend normalizes and scores every idea.'
                    ].filter(Boolean).join(' ')
                )))
                const ideas = ideationBatches
                    .flatMap((ideation) => boundedArray(ideation.ideas, CANDIDATE_BATCH_SIZE))
                    .map((idea, index) => normalizeIdea(idea, index))
                    .filter((idea) => {
                        if (!idea) return false
                        const candidateKey = `candidate:${String(idea.ideaId || '').toLocaleLowerCase('vi')}`
                        const topicKey = `topic:${String(idea.topic || '').toLocaleLowerCase('vi')}`
                        if (!idea.topic || seenIdeaKeys.has(candidateKey) || seenIdeaKeys.has(topicKey)) return false
                        seenIdeaKeys.add(candidateKey)
                        seenIdeaKeys.add(topicKey)
                        return true
                    })
                    .slice(0, REQUIRED_CANDIDATE_COUNT)
                let scored
                if (this.scoreBatch && ideas.length) {
                    const reports = await this.scoreBatch({ ideas, validatedResearch, round })
                    if (!Array.isArray(reports) || reports.length !== ideas.length) {
                        const error = new Error('Authoritative batch topic scorer returned an incomplete result')
                        error.code = 'ROADMAP_TOPIC_BATCH_SCORE_INVALID'
                        throw error
                    }
                    scored = ideas.map((idea, index) => ({ idea, score: reports[index] }))
                } else {
                    scored = []
                    for (const idea of ideas) {
                        scored.push({ idea, score: await this.scorer({ idea, validatedResearch, round }) })
                    }
                }
                const accepted = scored.filter((entry) => (
                    entry.score?.eligible &&
                    Number(entry.score.totalScore) >= this.policy.acceptanceScore &&
                    Number(entry.score.noveltySubtotal) >= this.policy.minimumNoveltySubtotal
                )).sort((a, b) => b.score.totalScore - a.score.totalScore || String(a.idea.ideaId || a.idea.topic).localeCompare(String(b.idea.ideaId || b.idea.topic)))
                const roundRejected = scored.filter((entry) => !accepted.includes(entry)).map((entry) => ({
                    candidateId: entry.idea.ideaId || '',
                    topic: entry.idea.topic || '',
                    angle: entry.idea.angle || '',
                    primaryQuestion: entry.idea.primaryQuestion || '',
                    categoryKey: entry.idea.categoryKey || '',
                    productScope: entry.idea.productScope || '',
                    searchIntent: entry.idea.searchIntent || '',
                    articleType: entry.idea.articleType || '',
                    score: entry.score?.totalScore || 0,
                    noveltySubtotal: entry.score?.noveltySubtotal || 0,
                    nearestCollisions: {
                        lexical: compactCollision(entry.score?.nearestCollisions?.lexical),
                        topic: compactCollision(entry.score?.nearestCollisions?.topic),
                        plan: compactCollision(entry.score?.nearestCollisions?.plan)
                    },
                    reasonCodes: entry.score?.reasonCodes || [],
                    round
                }))
                rejected.push(...roundRejected)
                if (accepted.length) {
                    finalAccepted = accepted
                    await this.RunModel.updateOne({ _id: persisted._id }, { $set: {
                        status: 'completed', completedAt: this.now(), roundCount: round, callCount: calls,
                        invocations, acceptedCandidateIds: accepted.map((entry) => String(entry.idea.ideaId || '')),
                        rejectedCandidates: rejected.slice(0, 200), terminalCode: '',
                        outcome: 'accepted', outcomeCode: '', errorCode: ''
                    } })
                    return { accepted, rejected, invocations, runId: String(persisted._id), roundCount: round, callCount: calls }
                }
                if (round < this.maxRounds) {
                    const critic = await call('originality-reviewer', 'novelty-critic', round, {
                        topRejected: [...roundRejected]
                            .sort((left, right) => (
                                Number(right.noveltySubtotal || 0) - Number(left.noveltySubtotal || 0) ||
                                Number(right.score || 0) - Number(left.score || 0) ||
                                String(left.candidateId).localeCompare(String(right.candidateId))
                            ))
                            .slice(0, 20),
                        noveltyAvoidance: compactNoveltyAvoidance(rejected),
                        corpusManifest,
                        queryPack
                    }, [
                        'Do not call tools or change backend scores.',
                        'Return exactly one JSON object with a feedback array and no other root keys.',
                        'Each feedback item must use only these keys: candidateId, summary, decision, recommendation, failedDimensions, patternsToAvoid, guidance.',
                        'recommendation must be one string: research, reposition, regenerate, switch_candidate, or abandon.',
                        'failedDimensions, patternsToAvoid, and guidance must be concise string arrays; keep at most 20 feedback items.'
                    ].join(' '))
                    criticFeedback = extractCriticFeedback(critic)
                }
            }
            const error = new Error('No acceptable topic reached the configured policy gate')
            error.code = 'ROADMAP_NO_ACCEPTABLE_TOPIC'
            throw error
        } catch (error) {
            const code = String(error.code || 'ROADMAP_IDEATION_FAILED')
            const noChange = [
                'ROADMAP_NO_ACCEPTABLE_TOPIC',
                ROADMAP_REQUIRED_EVIDENCE_UNAVAILABLE,
                ROADMAP_SCORE_UNREACHABLE
            ].includes(code)
            await this.RunModel.updateOne({ _id: persisted._id }, { $set: {
                status: noChange ? 'completed' : 'failed', completedAt: this.now(), roundCount: Math.min(this.maxRounds, new Set(invocations.map((item) => item.round)).size),
                callCount: calls, invocations, acceptedCandidateIds: finalAccepted.map((entry) => String(entry.idea.ideaId || '')),
                rejectedCandidates: rejected.slice(0, 200), terminalCode: code,
                outcome: noChange ? 'no_change' : '', outcomeCode: noChange ? code : '', errorCode: noChange ? '' : code
            } }).catch(() => null)
            throw error
        }
    }
}

module.exports = {
    CANDIDATE_BATCH_SIZE,
    MAX_NOVELTY_AVOIDANCE_ITEMS,
    REQUIRED_CANDIDATE_COUNT,
    ROUND_BATCH_FOCI,
    TopicIdeationOrchestratorService,
    boundedArray,
    buildTopicSessionKey,
    compactNoveltyAvoidance,
    compactSourceHealth,
    compactTopicContext,
    extractCriticFeedback,
    focusForRound
}
