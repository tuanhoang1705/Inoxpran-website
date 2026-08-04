'use strict'

const crypto = require('node:crypto')
const { INDEX_VERSION } = require('./blogNoveltyIndex.service')
const { SOURCE_RELEVANCE_VERSION } = require('./sourceRelevanceScoring.service')
const { normalizeText } = require('./topicResearchQuery.service')

const RUBRIC_VERSION = 'topic-plan-v7-2026-08-04'
const EVIDENCE_ALIGNMENT_VERSION = 'topic-evidence-alignment-v2-2026-08-04'
const ACCEPTANCE_SCORE = 82
const MIN_NOVELTY_SUBTOTAL = 48
// Operators must be able to tune the gate for a live site without editing code.
// The default stays at the audited 82/48 policy; these floors only bound how far
// an explicit OPENCLAW_TOPIC_* override may relax it.
const MIN_CONFIGURABLE_ACCEPTANCE_SCORE = 60
const MIN_CONFIGURABLE_NOVELTY_SUBTOTAL = 30
const MAX_SAME_INTENT_SIMILARITY = 0.82
// text-embedding-3-large has a material positive cosine baseline even for
// unrelated Vietnamese prose, and a much higher one for two articles inside the
// same housewares domain. Calibrating the floor at the unrelated-prose baseline
// charged a genuinely new same-domain topic ~16 points of "collision" it had not
// earned, which put the 82-point gate out of reach for every realistic
// candidate. The floor now sits at the observed same-domain baseline, so only
// similarity above what any two housewares articles share counts as a collision.
// The raw similarities remain persisted and still drive the strict same-intent
// hard gate; only the weighted "difference" dimensions use this calibration.
const SEMANTIC_COLLISION_FLOOR = 0.55
const SEMANTIC_COLLISION_CEILING = 0.88
const SEMANTIC_CALIBRATION_VERSION = 'text-embedding-3-large-cosine-v2-same-domain'
const ROADMAP_REQUIRED_EVIDENCE_UNAVAILABLE = 'ROADMAP_REQUIRED_EVIDENCE_UNAVAILABLE'
const ROADMAP_SCORE_UNREACHABLE = 'ROADMAP_SCORE_UNREACHABLE'
const NOVELTY_WEIGHT = 65
// The reachability preflight is deliberately an upper bound: it may only skip a
// run whose evidence could not reach the gate under ANY candidate. Tightening it
// toward a typical score would make it refuse runs that a strongly novel
// candidate would have passed. What used to burn a whole agent budget for no
// draft was not this optimism but the semantic miscalibration below, which put
// the real score ~13 points under what this bound promised.
const PREFLIGHT_MAX_PORTFOLIO_DIVERSITY = 1

const clamp01 = (value) => Math.min(1, Math.max(0, Number(value) || 0))
const calibrateSemanticCollision = (value) => {
    const raw = clamp01(value)
    if (raw <= SEMANTIC_COLLISION_FLOOR) return 0
    if (raw >= SEMANTIC_COLLISION_CEILING) return 1
    return Number((
        (raw - SEMANTIC_COLLISION_FLOOR) /
        (SEMANTIC_COLLISION_CEILING - SEMANTIC_COLLISION_FLOOR)
    ).toFixed(6))
}
const resolveRoadmapThresholds = ({
    acceptanceScore = ACCEPTANCE_SCORE,
    minimumNoveltySubtotal = MIN_NOVELTY_SUBTOTAL
} = {}) => ({
    acceptanceScore: Math.min(
        100,
        Math.max(
            MIN_CONFIGURABLE_ACCEPTANCE_SCORE,
            Number(acceptanceScore) || ACCEPTANCE_SCORE
        )
    ),
    minimumNoveltySubtotal: Math.min(
        NOVELTY_WEIGHT,
        Math.max(
            MIN_CONFIGURABLE_NOVELTY_SUBTOTAL,
            Number(minimumNoveltySubtotal) || MIN_NOVELTY_SUBTOTAL
        )
    )
})
const normalizeOpportunityScore = (value) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed < 0) return 0
    if (parsed <= 1) return parsed
    if (parsed <= 100) return parsed / 100
    return 0
}
const normalizeConfidenceScore = (value) => {
    const normalized = String(value ?? '').trim().toLowerCase()
    if (normalized === 'high') return 0.9
    if (normalized === 'medium') return 0.65
    if (normalized === 'low') return 0.35
    return normalizeOpportunityScore(value)
}
const stableHash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')

const foldText = (value) => normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')

const PRODUCT_FAMILY_PATTERNS = Object.freeze([
    ['mosquito_racket', /\bvot\b.{0,28}\bmuoi\b|\bmuoi\b.{0,28}\bvot\b/],
    ['pressure_cooker', /\bnoi ap suat\b/],
    ['rice_cooker', /\bnoi com\b/],
    ['induction_cooker', /\bbep tu\b/],
    ['dish_dryer', /\bmay say (?:bat|chen|bat dia|bat chen)\b/],
    ['range_hood', /\bmay hut mui\b/],
    ['vacuum_sealer', /\bmay hut chan khong\b|\bhut chan khong\b/],
    ['electric_kettle', /\bam (?:dien|sieu toc)\b/],
    ['blender', /\bmay xay\b/],
    ['rice_container', /\bthung (?:dung )?gao\b/],
    ['black_garlic_maker', /\btoi den\b/],
    ['food_container', /\bhop (?:dung|bao quan)\b/]
])

const INTENT_PATTERNS = Object.freeze({
    troubleshooting: /\b(?:loi|hu hong|hong|khong hoat dong|khong chay|khong vao dien|khong bat|khong sac|mat nguon|pin yeu|phong dien yeu|khong phong dien|den yeu|cong venh|bien dang|ket|ro ri|xu ly|khac phuc|sua chua|nguyen nhan)\b|\b(?:vot|luoi|khung|than)\b.{0,32}\bbi cong\b/,
    maintenance: /\b(?:ve sinh|lam sach|tay rua|rua|lau|bao quan|bao duong|cat giu|can ban|khu mui|tuoi tho|cham soc)\b/,
    selection: /\b(?:chon|lua chon|chon mua|mua|so sanh|uu nhuoc diem|phu hop|tuong thich|danh gia|review)\b/,
    usage: /\b(?:su dung|cach dung|dung dung|huong dan|van hanh|sac dien|bat tat|nau)\b/,
    safety: /\b(?:an toan|nguy hiem|dien giat|chay no|chay|bong|canh bao|suc khoe|tre em)\b/
})
const SPECIFIC_INTENT_PRIORITY = Object.freeze([
    'troubleshooting',
    'maintenance',
    'selection',
    'usage',
    'safety'
])
const CONDITION_PATTERNS = Object.freeze({
    deformation: /\b(?:cong venh|mop|bien dang|gay|nut|rach)\b|\b(?:vot|luoi|khung|than)\b.{0,32}\bbi cong\b/,
    power_failure: /\b(?:khong hoat dong|khong chay|khong vao dien|khong bat|khong sac|mat nguon|het pin|pin yeu|phong dien yeu|khong phong dien|den yeu|sac khong vao)\b/,
    electrical_hazard: /\b(?:chap dien|ro dien|ho dien|dien giat|chay no|chay mach)\b/,
    corrosion: /\b(?:ri set|an mon|oxy hoa|o set)\b/,
    odor_or_mold: /\b(?:mui hoi|mui la|nam moc|moc)\b/,
    pressure_components: /\b(?:van ap suat|van xa|gioang|ron|xa ap|ro hoi)\b/,
    abnormal_heat: /\b(?:qua nong|nong bat thuong|khong nong|khong gia nhiet)\b/
})
const ALIGNMENT_STOP_TOKENS = new Set([
    'cach', 'huong', 'dan', 'kinh', 'nghiem', 'cho', 'voi', 'cua', 'va', 'hoac', 'khi', 'nao',
    'the', 'de', 'tu', 'trong', 'ngoai', 'mot', 'nhung', 'cac', 'nguoi', 'dung', 'gia', 'dinh',
    'viet', 'san', 'pham', 'thiet', 'bi', 'thong', 'minh', 'dien', 'hang', 'ngay', 'dung', 'nen',
    'can', 'biet', 'gi', 'lam', 'sao', 'tot', 'nhat', 'theo', 'tang', 'han', 'che', 'thuc', 'te',
    'an', 'toan', 'suc', 'khoe', 'loi', 'thuong', 'gap', 'xu', 'ly', 'khac', 'phuc', 've', 'sinh',
    'bao', 'quan', 'chon', 'mua', 'su', 'dung', 'danh', 'gia', 'review', 'so', 'sanh'
])

const canonicalCandidateFields = (idea = {}) => ({
    topic: String(idea.topic || ''),
    angle: String(idea.angle || ''),
    primaryKeyword: String(idea.primaryKeyword || idea.topic || ''),
    primaryQuestion: String(idea.primaryQuestion || (idea.topic ? `Người đọc cần biết gì về ${idea.topic}?` : '')),
    supportingQuestions: (Array.isArray(idea.supportingQuestions) ? idea.supportingQuestions : []).map(String),
    keywords: (Array.isArray(idea.keywords)
        ? idea.keywords
        : Array.isArray(idea.secondaryKeywords) ? idea.secondaryKeywords : []).map(String),
    userProblems: (Array.isArray(idea.userProblems) ? idea.userProblems : []).map(String),
    searchIntent: String(idea.searchIntent || 'informational'),
    topicAxis: String(idea.topicAxis || '')
})

const candidatePrimaryTextFor = (idea = {}) => {
    const candidate = canonicalCandidateFields(idea)
    return [
        candidate.topic,
        candidate.angle,
        candidate.primaryKeyword,
        candidate.primaryQuestion
    ].filter(Boolean).join(' ')
}

const candidateTextFor = (idea = {}) => {
    const candidate = canonicalCandidateFields(idea)
    return [
        candidatePrimaryTextFor(candidate),
        ...candidate.supportingQuestions,
        ...candidate.keywords,
        ...candidate.userProblems
    ].filter(Boolean).join(' ')
}

const sourceTextFor = (source = {}) => [
    source.title,
    source.topic,
    source.sourceTitle,
    source.snippet,
    source.summary
].filter(Boolean).join(' ')

const productFamiliesFor = (value) => {
    const normalized = normalizeText(value)
    const folded = foldText(value)
    const families = PRODUCT_FAMILY_PATTERNS
        .filter(([, pattern]) => pattern.test(folded))
        .map(([family]) => family)
    const fullyUnaccented = normalized === folded
    const accentAwareFamily = (family, accentedPattern, foldedPattern) => {
        if (accentedPattern.test(normalized) || (fullyUnaccented && foldedPattern.test(folded))) {
            families.push(family)
        }
    }
    accentAwareFamily('electric_fan', /\bquạt(?: điện| tích điện)?\b/, /\bquat(?: dien| tich dien)?\b/)
    accentAwareFamily('frying_pan', /\bchảo\b/, /\bchao\b/)
    accentAwareFamily('knife', /\bdao\b/, /\bdao\b/)
    accentAwareFamily('cutting_board', /\bthớt\b/, /\bthot\b/)
    accentAwareFamily('cookware_pot', /\bnồi\b/, /\bnoi\b/)
    if (families.includes('pressure_cooker') || families.includes('rice_cooker')) {
        return [...new Set(families.filter((family) => family !== 'cookware_pot'))]
    }
    return [...new Set(families)]
}

const intentGroupsFor = (value) => {
    const folded = foldText(value)
    return Object.entries(INTENT_PATTERNS)
        .filter(([, pattern]) => pattern.test(folded))
        .map(([intent]) => intent)
}

const informativeTokensFor = (value) => [...new Set(foldText(value)
    .split(' ')
    .filter((token) => token.length >= 3 && !ALIGNMENT_STOP_TOKENS.has(token)))]

const conditionClustersFor = (value) => {
    const folded = foldText(value)
    return Object.entries(CONDITION_PATTERNS)
        .filter(([, pattern]) => pattern.test(folded))
        .map(([condition]) => condition)
}

const assessCandidateProductBinding = ({ idea = {}, productEvidence = [] } = {}) => {
    const candidateText = candidateTextFor(idea)
    const candidateFolded = foldText(candidateText)
    const candidateFamilies = productFamiliesFor(candidateText)
    const candidateTokens = new Set(informativeTokensFor(candidateText))
    const products = (Array.isArray(productEvidence) ? productEvidence : []).map((product) => {
        const productText = [product.name, product.category].filter(Boolean).join(' ')
        const productFamilies = productFamiliesFor(productText)
        const sharedTokens = informativeTokensFor(productText)
            .filter((token) => candidateTokens.has(token))
            .slice(0, 12)
        const sku = foldText(product.sku)
        const skuMatched = Boolean(sku && candidateFolded.split(' ').includes(sku))
        const familyMatched = productFamilies.length > 0 &&
            productFamilies.every((family) => candidateFamilies.includes(family))
        return {
            productId: String(product.productId || ''),
            matched: Boolean(candidateText && (skuMatched || familyMatched || sharedTokens.length >= 2)),
            skuMatched,
            familyMatched,
            productFamilies,
            sharedTokens
        }
    })
    // A candidate legitimately cites several catalog cards (a comparison or a
    // roundup), and the ideation agent routinely over-cites. Demanding that
    // every cited card match the topic rejected sound candidates outright and
    // made a mixed-catalog brief unsatisfiable, because the union of two product
    // families can never all appear in one focused topic. Bind on the matched
    // cards instead and drop the rest, so an over-cited card is discarded rather
    // than fatal while a candidate citing nothing relevant still fails.
    const matched = products.filter((product) => product.matched)
    return {
        passed: products.length === 0 || matched.length > 0,
        candidateFamilies,
        matchedProductIds: matched.map((product) => product.productId).filter(Boolean),
        unmatchedProductIds: products
            .filter((product) => !product.matched)
            .map((product) => product.productId)
            .filter(Boolean),
        products
    }
}

const assessTopicEvidenceAlignment = ({
    idea = {},
    sourceEvidence = [],
    productEvidence = []
} = {}) => {
    const candidatePrimaryText = candidatePrimaryTextFor(idea)
    const candidateText = candidateTextFor(idea)
    const productBinding = assessCandidateProductBinding({ idea, productEvidence })
    // Expectations must describe this one candidate, not the whole brief. Folding
    // every cited card into the expected text produced a union of product
    // families ("mosquito racket" + "pressure cooker") that no single source
    // could satisfy, so a correct pressure-cooker source was scored as unrelated.
    const boundProductIds = new Set(productBinding.matchedProductIds || [])
    const productText = productEvidence
        .filter((product) => !boundProductIds.size || boundProductIds.has(String(product.productId || '')))
        .map((product) => [product.name, product.sku, product.category].filter(Boolean).join(' '))
        .join(' ')
    const expectedText = `${candidateText} ${productText}`.trim()
    const expectedFamilies = productFamiliesFor(expectedText)
    const candidateIntents = intentGroupsFor(candidatePrimaryText || candidateText)
    const candidateConditions = conditionClustersFor(candidatePrimaryText || candidateText)
    const requiredIntent = SPECIFIC_INTENT_PRIORITY.find((intent) => candidateIntents.includes(intent)) || ''
    const expectedTokens = new Set(informativeTokensFor(expectedText))
    const evidence = (Array.isArray(sourceEvidence) ? sourceEvidence : []).map((source) => {
        const sourceText = sourceTextFor(source)
        const sourceFamilies = productFamiliesFor(sourceText)
        const sourceIntents = intentGroupsFor(sourceText)
        const sourceConditions = conditionClustersFor(sourceText)
        const sharedTokens = informativeTokensFor(sourceText)
            .filter((token) => expectedTokens.has(token))
            .slice(0, 12)
        const productAligned = expectedFamilies.length
            ? expectedFamilies.some((family) => sourceFamilies.includes(family))
            : sharedTokens.length >= 2
        const intentAligned = !requiredIntent || sourceIntents.includes(requiredIntent)
        const conditionAligned = !candidateConditions.length ||
            candidateConditions.every((condition) => sourceConditions.includes(condition))
        const subjectAligned = expectedFamilies.length ? sharedTokens.length >= 1 : sharedTokens.length >= 2
        return {
            evidenceId: evidenceIdentity(source),
            aligned: Boolean(sourceText && productBinding.passed && productAligned && intentAligned && conditionAligned && subjectAligned),
            productAligned,
            intentAligned,
            conditionAligned,
            subjectAligned,
            requiredIntent,
            sourceIntents,
            sourceConditions,
            sourceFamilies,
            sharedTokens
        }
    })
    // An over-cited source is dropped, not fatal. Misaligned evidence is excluded
    // from every trusted signal and from what the writer is later allowed to
    // read, so the candidate is scored only on evidence that genuinely supports
    // it. Requiring all cited sources to align instead rejected sound candidates
    // whenever the agent attached one loosely related link.
    const aligned = evidence.filter((entry) => entry.aligned)
    return {
        version: EVIDENCE_ALIGNMENT_VERSION,
        passed: Boolean(candidateText && aligned.length > 0),
        alignedEvidenceIds: aligned.map((entry) => entry.evidenceId).filter(Boolean),
        droppedEvidenceIds: evidence
            .filter((entry) => !entry.aligned)
            .map((entry) => entry.evidenceId)
            .filter(Boolean),
        alignedEvidenceCount: aligned.length,
        evidenceCount: evidence.length,
        expectedFamilies,
        candidateIntents,
        candidateConditions,
        requiredIntent,
        productBinding,
        evidence
    }
}

const canonicalDate = (value) => {
    const parsed = value ? new Date(value) : null
    return parsed && Number.isFinite(parsed.getTime()) ? parsed.toISOString() : ''
}

const canonicalScoreReport = (report = {}) => ({
    rubricVersion: String(report.rubricVersion || ''),
    corpusVersion: String(report.corpusVersion || ''),
    corpusHash: String(report.corpusHash || ''),
    corpusCount: Number(report.corpusCount || 0),
    totalScore: Number(report.totalScore || 0),
    noveltySubtotal: Number(report.noveltySubtotal || 0),
    semanticCalibration: report.semanticCalibration || {},
    dimensions: report.dimensions || report.scoreBreakdown || {},
    hardGates: report.hardGates || {},
    hardGatesPassed: report.hardGatesPassed === true,
    trustedSignals: report.trustedSignals || {},
    nearestCollisions: report.nearestCollisions || {},
    reasonCodes: Array.isArray(report.reasonCodes) ? report.reasonCodes.map(String) : []
})

const evidenceIdentity = (source = {}) => String(
    source.evidenceId || source.signalHash || source.contentHash || ''
).trim()

const buildTopicScoreHash = ({
    idea = {},
    candidateId = idea.ideaId || idea.candidateId || '',
    sourceEvidence = [],
    productEvidence = [],
    report = {}
} = {}) => stableHash({
    candidate: {
        candidateId: String(candidateId || ''),
        ...canonicalCandidateFields(idea)
    },
    evidence: sourceEvidence.map((source) => ({
        evidenceId: evidenceIdentity(source),
        sourceId: String(source.sourceId || ''),
        contentHash: String(source.contentHash || source.signalHash || ''),
        relevanceVersion: String(source.relevance?.version || source.relevanceVersion || ''),
        relevanceScore: Number(source.relevance?.totalScore ?? source.relevanceScore ?? 0),
        title: String(source.title || source.topic || source.sourceTitle || ''),
        snippet: String(source.snippet || source.summary || ''),
        observedAt: canonicalDate(source.observedAt || source.sourceDate || source.fetchedAt)
    })).sort((left, right) => left.evidenceId.localeCompare(right.evidenceId)),
    products: productEvidence.map((product) => ({
        productId: String(product.productId || ''),
        name: String(product.name || ''),
        catalogEvidenceHash: String(product.catalogEvidenceHash || ''),
        factKeys: (Array.isArray(product.factKeys) ? product.factKeys : []).map(String).sort()
    })).sort((left, right) => left.productId.localeCompare(right.productId)),
    score: canonicalScoreReport(report)
})

const isVerifiedSourceEvidence = (
    source,
    requiredSourceVersion = SOURCE_RELEVANCE_VERSION
) => Boolean(
    evidenceIdentity(source) &&
    String(source?.contentHash || source?.signalHash || '').trim() &&
    source?.relevance?.version === requiredSourceVersion &&
    source?.relevance?.eligibleForIdeation === true &&
    Number(source?.relevance?.totalScore) > 0
)

const isVerifiedProductEvidence = (product = {}) => Boolean(
    String(product.productId || '').trim() &&
    String(product.name || '').trim() &&
    String(product.catalogEvidenceHash || '').trim() &&
    product.eligible !== false &&
    !product.rejectionReasons?.length
)

const evidenceTimingScore = (source = {}, now = new Date()) => {
    const observedAt = source.observedAt || source.sourceDate || source.fetchedAt
    const observedMs = observedAt ? new Date(observedAt).getTime() : Number.NaN
    const nowMs = new Date(now).getTime()
    if (!Number.isFinite(observedMs) || !Number.isFinite(nowMs) || observedMs > nowMs + 86_400_000) return 0.25
    const ageDays = Math.max(0, (nowMs - observedMs) / 86_400_000)
    if (ageDays <= 30) return 1
    if (ageDays <= 90) return 0.75
    if (ageDays <= 180) return 0.5
    return 0.25
}

const deriveTrustedTopicSignals = ({
    idea = {},
    sourceEvidence = [],
    productEvidence = [],
    requiredSourceVersion = SOURCE_RELEVANCE_VERSION,
    now = new Date(),
    enforceEvidenceAlignment = true
} = {}) => {
    const alignment = enforceEvidenceAlignment
        ? assessTopicEvidenceAlignment({ idea, sourceEvidence, productEvidence })
        : {
            version: EVIDENCE_ALIGNMENT_VERSION,
            passed: true,
            alignedEvidenceIds: sourceEvidence.map((source) => evidenceIdentity(source)).filter(Boolean),
            droppedEvidenceIds: [],
            alignedEvidenceCount: sourceEvidence.length,
            evidenceCount: sourceEvidence.length,
            expectedFamilies: [],
            candidateIntents: [],
            requiredIntent: '',
            evidence: sourceEvidence.map((source) => ({ evidenceId: evidenceIdentity(source), aligned: true }))
        }
    const alignedEvidenceIds = new Set(alignment.evidence
        .filter((entry) => entry.aligned)
        .map((entry) => entry.evidenceId))
    // Version verification and topic alignment answer different questions:
    // "is this evidence trustworthy at all" versus "does it support this
    // candidate". Collapsing them made one misaligned citation read as a
    // provenance failure and fail the sources gate too.
    const versionVerifiedSources = sourceEvidence.filter((source) => (
        isVerifiedSourceEvidence(source, requiredSourceVersion)
    ))
    const verifiedSources = versionVerifiedSources.filter((source) => (
        !enforceEvidenceAlignment || alignedEvidenceIds.has(evidenceIdentity(source))
    ))
    const verifiedProducts = productEvidence.filter(isVerifiedProductEvidence)
    const average = (values) => values.length
        ? values.reduce((sum, value) => sum + clamp01(value), 0) / values.length
        : 0
    const evidenceQuality = average(verifiedSources.map((source) => source.relevance.totalScore))
    const userDemand = average(verifiedSources.map((source) => {
        const confidence = normalizeConfidenceScore(source.confidence)
        const classificationFactor = source.classification === 'inferred' ? 0.65 : 1
        return clamp01(source.relevance.totalScore) * confidence * classificationFactor
    }))
    const timing = average(verifiedSources.map((source) => evidenceTimingScore(source, now)))
    const businessUsefulness = verifiedProducts.length
        ? Math.min(1, 0.7 + Math.min(verifiedProducts.length, 4) * 0.05)
        : verifiedSources.length ? 0.35 : 0
    return {
        verifiedSources,
        versionVerifiedSources,
        verifiedProducts,
        evidenceQuality,
        userDemand,
        businessUsefulness,
        timing,
        evidenceAlignment: alignment
    }
}

const assessTopicPlanReachability = ({
    sourceEvidence = [],
    productEvidence = [],
    acceptanceScore = ACCEPTANCE_SCORE,
    minimumNoveltySubtotal = MIN_NOVELTY_SUBTOTAL,
    requiredSourceVersion = SOURCE_RELEVANCE_VERSION,
    now = new Date()
} = {}) => {
    const thresholds = resolveRoadmapThresholds({
        acceptanceScore,
        minimumNoveltySubtotal
    })
    const eligibleSources = sourceEvidence.filter((source) => (
        isVerifiedSourceEvidence(source, requiredSourceVersion)
    ))
    if (!eligibleSources.length) {
        return {
            reachable: false,
            code: ROADMAP_REQUIRED_EVIDENCE_UNAVAILABLE,
            maximumTotalScore: 0,
            verifiedEvidenceCount: 0
        }
    }
    // A reachability preflight may skip every paid agent call, so it must only
    // reject when no verified source could reach the configured score. Rank by
    // the complete trusted-signal contribution instead of demand alone; an older
    // high-confidence source can otherwise hide a fresher, actually reachable
    // source.
    const sourcePotential = (source) => {
        const relevance = clamp01(source.relevance?.totalScore)
        const confidence = normalizeConfidenceScore(source.confidence)
        const classificationFactor = source.classification === 'inferred' ? 0.65 : 1
        return (
            relevance * 10 +
            relevance * confidence * classificationFactor * 7 +
            evidenceTimingScore(source, now) * 4
        )
    }
    const bestSource = [...eligibleSources].sort((left, right) => (
        sourcePotential(right) - sourcePotential(left) ||
        evidenceIdentity(left).localeCompare(evidenceIdentity(right))
    ))[0]
    const trusted = deriveTrustedTopicSignals({
        idea: {},
        sourceEvidence: [bestSource],
        productEvidence,
        requiredSourceVersion,
        now,
        enforceEvidenceAlignment: false
    })
    const maximumTotalScore = Number((
        NOVELTY_WEIGHT +
        trusted.evidenceQuality * 10 +
        trusted.userDemand * 7 +
        5 +
        trusted.businessUsefulness * 3 +
        PREFLIGHT_MAX_PORTFOLIO_DIVERSITY * 6 +
        trusted.timing * 4
    ).toFixed(2))
    const reachable = thresholds.minimumNoveltySubtotal <= NOVELTY_WEIGHT &&
        maximumTotalScore >= thresholds.acceptanceScore
    return {
        reachable,
        code: reachable ? '' : ROADMAP_SCORE_UNREACHABLE,
        maximumTotalScore,
        verifiedEvidenceCount: eligibleSources.length,
        selectedEvidenceId: evidenceIdentity(bestSource)
    }
}

const scoreTopicPlan = ({
    idea = {},
    candidateId = idea.ideaId || idea.candidateId || '',
    comparison = {},
    sourceEvidence = [],
    productEvidence = [],
    directionPassed = true,
    portfolioDiversity = 0.7,
    now = new Date(),
    requiredCorpusVersion = INDEX_VERSION,
    requiredSourceVersion = SOURCE_RELEVANCE_VERSION,
    acceptanceScore = ACCEPTANCE_SCORE,
    minimumNoveltySubtotal = MIN_NOVELTY_SUBTOTAL,
    requireProductEvidence = false
} = {}) => {
    const thresholds = resolveRoadmapThresholds({
        acceptanceScore,
        minimumNoveltySubtotal
    })
    const lexicalDifference = 1 - clamp01(comparison.lexical?.lexicalSimilarity)
    const rawTopicSimilarity = clamp01(comparison.topic?.topicSimilarity)
    const rawPlanSimilarity = clamp01(comparison.plan?.planSimilarity)
    const calibratedTopicCollision = calibrateSemanticCollision(rawTopicSimilarity)
    const calibratedPlanCollision = calibrateSemanticCollision(rawPlanSimilarity)
    const semanticTopicDifference = 1 - calibratedTopicCollision
    const semanticPlanDifference = 1 - calibratedPlanCollision
    const trusted = deriveTrustedTopicSignals({ idea, sourceEvidence, productEvidence, requiredSourceVersion, now })
    const evidenceQuality = trusted.evidenceQuality
    const userDemand = trusted.userDemand
    const directionFit = directionPassed ? 1 : 0
    const businessUsefulness = trusted.businessUsefulness
    const portfolio = clamp01(portfolioDiversity)
    const timing = trusted.timing

    const dimensions = {
        lexicalDifference: { raw: lexicalDifference, weight: 20 },
        semanticTopicDifference: { raw: semanticTopicDifference, weight: 25 },
        semanticPlanDifference: { raw: semanticPlanDifference, weight: 20 },
        evidenceQuality: { raw: evidenceQuality, weight: 10 },
        userDemand: { raw: userDemand, weight: 7 },
        directionFit: { raw: directionFit, weight: 5 },
        businessUsefulness: { raw: businessUsefulness, weight: 3 },
        portfolioDiversity: { raw: portfolio, weight: 6 },
        timingValue: { raw: timing, weight: 4 }
    }
    Object.values(dimensions).forEach((dimension) => {
        dimension.contribution = Number((dimension.raw * dimension.weight).toFixed(4))
    })
    const noveltySubtotal = Number((
        dimensions.lexicalDifference.contribution +
        dimensions.semanticTopicDifference.contribution +
        dimensions.semanticPlanDifference.contribution
    ).toFixed(2))
    const totalScore = Number(Object.values(dimensions).reduce((sum, dimension) => sum + dimension.contribution, 0).toFixed(2))
    const sameIntentCollision = Boolean(comparison.topic?.sameIntent) && clamp01(comparison.topic?.topicSimilarity) >= MAX_SAME_INTENT_SIMILARITY
    const sourceVersionPassed = sourceEvidence.length > 0 &&
        trusted.versionVerifiedSources.length === sourceEvidence.length
    const productPassed = trusted.verifiedProducts.length === productEvidence.length &&
        (!requireProductEvidence || trusted.verifiedProducts.length > 0)
    const hardGates = {
        corpusVersion: comparison.indexVersion === requiredCorpusVersion && Number(comparison.comparedCount || 0) > 0,
        score: totalScore >= thresholds.acceptanceScore,
        novelty: noveltySubtotal >= thresholds.minimumNoveltySubtotal,
        sameIntent: !sameIntentCollision,
        direction: directionPassed === true,
        sources: sourceVersionPassed,
        evidenceAlignment: trusted.evidenceAlignment.passed === true &&
            trusted.verifiedSources.length > 0,
        products: productPassed
    }
    const hardGatesPassed = Object.values(hardGates).every(Boolean)
    const reasonCodes = Object.entries(hardGates).filter(([, passed]) => !passed).map(([key]) => `topic_gate_${key}_failed`)
    const report = {
        rubricVersion: RUBRIC_VERSION,
        corpusVersion: comparison.indexVersion || '',
        corpusHash: comparison.corpusHash || '',
        corpusCount: Number(comparison.comparedCount || comparison.corpusCount || 0),
        totalScore,
        noveltySubtotal,
        semanticCalibration: {
            version: SEMANTIC_CALIBRATION_VERSION,
            floor: SEMANTIC_COLLISION_FLOOR,
            ceiling: SEMANTIC_COLLISION_CEILING,
            rawTopicSimilarity,
            rawPlanSimilarity,
            calibratedTopicCollision,
            calibratedPlanCollision
        },
        dimensions,
        hardGates,
        hardGatesPassed,
        eligible: hardGatesPassed,
        acceptanceScore: thresholds.acceptanceScore,
        minimumNoveltySubtotal: thresholds.minimumNoveltySubtotal,
        trustedSignals: {
            verifiedEvidenceCount: trusted.verifiedSources.length,
            verifiedProductCount: trusted.verifiedProducts.length,
            productEvidenceRequired: requireProductEvidence === true,
            evidenceQuality,
            userDemand,
            businessUsefulness,
            timing,
            evidenceAlignment: trusted.evidenceAlignment
        },
        nearestCollisions: {
            lexical: comparison.lexical || null,
            topic: comparison.topic || null,
            plan: comparison.plan || null
        },
        reasonCodes
    }
    return {
        ...report,
        scoreHash: buildTopicScoreHash({ idea, candidateId, sourceEvidence, productEvidence, report })
    }
}

const rankTopicPlans = (plans = []) => [...plans].sort((left, right) =>
    Number(right.score?.eligible) - Number(left.score?.eligible) ||
    Number(right.score?.totalScore || 0) - Number(left.score?.totalScore || 0) ||
    String(left.idea?.ideaId || left.idea?.topic || '').localeCompare(String(right.idea?.ideaId || right.idea?.topic || ''))
)

module.exports = {
    ACCEPTANCE_SCORE,
    MIN_CONFIGURABLE_ACCEPTANCE_SCORE,
    MIN_CONFIGURABLE_NOVELTY_SUBTOTAL,
    EVIDENCE_ALIGNMENT_VERSION,
    SEMANTIC_CALIBRATION_VERSION,
    SEMANTIC_COLLISION_CEILING,
    SEMANTIC_COLLISION_FLOOR,
    MAX_SAME_INTENT_SIMILARITY,
    MIN_NOVELTY_SUBTOTAL,
    NOVELTY_WEIGHT,
    ROADMAP_REQUIRED_EVIDENCE_UNAVAILABLE,
    ROADMAP_SCORE_UNREACHABLE,
    RUBRIC_VERSION,
    assessCandidateProductBinding,
    assessTopicEvidenceAlignment,
    assessTopicPlanReachability,
    intentGroupsFor,
    productFamiliesFor,
    buildTopicScoreHash,
    calibrateSemanticCollision,
    canonicalScoreReport,
    deriveTrustedTopicSignals,
    evidenceIdentity,
    evidenceTimingScore,
    isVerifiedProductEvidence,
    isVerifiedSourceEvidence,
    normalizeConfidenceScore,
    normalizeOpportunityScore,
    rankTopicPlans,
    resolveRoadmapThresholds,
    scoreTopicPlan,
    stableHash
}
