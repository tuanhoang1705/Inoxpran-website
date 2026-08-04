'use strict'

const { HOUSEHOLD_ANCHORS, normalizeText, stableHash } = require('./topicResearchQuery.service')

const SOURCE_RELEVANCE_VERSION = 'source-relevance-v4-2026-08-04'
const DEFAULT_MIN_SCORE = 0.58
const NAVIGATION_NOISE = new Set([
    'hoạt động', 'tin tức', 'trang chủ', 'sự kiện', 'thông báo', 'xem thêm', 'giới thiệu',
    'liên hệ', 'chuyên mục', 'hoat dong', 'tin tuc', 'trang chu', 'su kien', 'about', 'home', 'news'
].map(normalizeText))
const IRRELEVANT_ENTITY_PATTERNS = Object.freeze([
    /\b(?:tô lâm|to lam|phan văn giang|phan van giang|voz[íi]nha)\b/i,
    /\b(?:gpt|chatgpt|gemini(?: ai)?|claude ai|trí tuệ nhân tạo|tri tue nhan tao)\b/i,
    /\b(?:dự báo thời tiết|du bao thoi tiet|thời tiết tphcm|thoi tiet tphcm)\b/i,
    /\b(?:bóng đá|bong da|cầu thủ|cau thu|đội tuyển|doi tuyen|football|soccer)\b/i
])

const tokenSet = (value) => new Set(normalizeText(value).split(' ').filter((token) => token.length > 1))
const phraseMatches = (haystack, phrases = []) => {
    const normalized = ` ${normalizeText(haystack)} `
    return Array.from(new Set(phrases.map(normalizeText).filter((phrase) => phrase && normalized.includes(` ${phrase} `))))
}
const tokenOverlap = (left, right) => {
    const a = left instanceof Set ? left : tokenSet(left)
    const b = right instanceof Set ? right : tokenSet(right)
    if (!a.size || !b.size) return 0
    const matches = [...a].filter((token) => b.has(token)).length
    return Number(Math.min(1, matches / Math.max(2, Math.min(a.size, b.size))).toFixed(4))
}
const bestTokenOverlap = (corpus, candidates = []) => (Array.isArray(candidates) ? candidates : [])
    .reduce((best, candidate) => Math.max(best, tokenOverlap(corpus, candidate)), 0)
const anchorAffinityOverlap = (matchedAnchors = [], candidates = []) => {
    let best = 0
    for (const anchor of Array.isArray(matchedAnchors) ? matchedAnchors : []) {
        const normalizedAnchor = normalizeText(anchor)
        if (!normalizedAnchor) continue
        const anchorTokens = normalizedAnchor.split(' ').filter(Boolean)
        const matched = (Array.isArray(candidates) ? candidates : []).some((candidate) => (
            ` ${normalizeText(candidate)} `.includes(` ${normalizedAnchor} `)
        ))
        if (matched) best = Math.max(best, anchorTokens.length >= 2 ? 1 : 0.65)
    }
    return best
}
const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0))

const scoreSourceSignal = ({ signal = {}, source = {}, queryPack = {}, minScore = DEFAULT_MIN_SCORE, now = new Date() } = {}) => {
    const topic = String(signal.topic || signal.title || '').trim()
    const snippet = String(signal.snippet || signal.summary || '').trim()
    const corpus = `${topic} ${snippet} ${signal.sourceTitle || ''}`
    const focusTerms = queryPack.focusTerms || []
    const catalogTerms = queryPack.catalogTerms || []
    const catalogFocusTerms = queryPack.catalogFocusTerms || []
    const householdAnchors = queryPack.householdAnchors || HOUSEHOLD_ANCHORS
    const excludedTerms = queryPack.excludedTerms || []
    const query = (queryPack.queries || []).find((item) => item.queryId === signal.queryId) || queryPack.queries?.[0] || {}
    const householdMatches = phraseMatches(corpus, householdAnchors)
    const catalogMatches = phraseMatches(corpus, catalogTerms)
    const focusMatches = phraseMatches(corpus, focusTerms)
    const excludedMatches = phraseMatches(corpus, excludedTerms)
    const normalizedTopic = normalizeText(topic)
    const isNavigationNoise = NAVIGATION_NOISE.has(normalizedTopic) || normalizedTopic.length < 4
    const irrelevantEntity = IRRELEVANT_ENTITY_PATTERNS.find((pattern) => pattern.test(corpus))
    const directHouseholdAnchor = householdMatches.length > 0 || catalogMatches.length > 0
    // A source is expected to cover one focused product/intent, not every item
    // in a mixed manager brief or the whole catalog. Comparing against the
    // concatenated lists made a precise pressure-cooker source look weak merely
    // because mosquito-racket and other catalog terms were also in scope.
    const directionOverlap = focusTerms.length
        ? Math.max(
            bestTokenOverlap(corpus, focusTerms),
            anchorAffinityOverlap(householdMatches, catalogFocusTerms)
        )
        : directHouseholdAnchor ? 0.65 : 0
    const householdOverlap = directHouseholdAnchor ? Math.min(1, 0.55 + (householdMatches.length + catalogMatches.length) * 0.1) : 0
    const catalogOverlap = catalogTerms.length
        ? Math.max(
            bestTokenOverlap(corpus, catalogTerms),
            anchorAffinityOverlap(householdMatches, catalogTerms)
        )
        : householdOverlap * 0.6
    const queryOverlap = query.queryText ? tokenOverlap(corpus, query.queryText) : Math.max(directionOverlap, householdOverlap) * 0.7
    const status = String(source.status || 'available')
    const authorityFreshness = status === 'available' ? 0.65 : 0.15
    const scoreBreakdown = {
        directionOverlap,
        householdOverlap,
        catalogOverlap,
        queryOverlap,
        authorityFreshness
    }
    const weights = { directionOverlap: 0.3, householdOverlap: 0.25, catalogOverlap: 0.2, queryOverlap: 0.15, authorityFreshness: 0.1 }
    const totalScore = Number(Object.entries(weights).reduce((sum, [key, weight]) => sum + scoreBreakdown[key] * weight, 0).toFixed(4))
    const rejectionReasons = []
    if (!directHouseholdAnchor) rejectionReasons.push('missing_household_anchor')
    if (isNavigationNoise) rejectionReasons.push('navigation_noise')
    if (irrelevantEntity && !focusMatches.length && !catalogMatches.length) rejectionReasons.push('irrelevant_entity')
    if (excludedMatches.length) rejectionReasons.push('excluded_manager_term')
    if (!signal.signalHash && !signal.evidenceId) rejectionReasons.push('unresolved_evidence_id')
    if (!source.sourceId && !signal.sourceId) rejectionReasons.push('unresolved_source')
    if (totalScore < clamp01(minScore)) rejectionReasons.push('below_source_relevance_threshold')
    const eligibleForIdeation = rejectionReasons.length === 0
    const report = {
        version: SOURCE_RELEVANCE_VERSION,
        totalScore,
        scoreBreakdown,
        eligibleForIdeation,
        matchedAnchors: [...new Set([...focusMatches, ...catalogMatches, ...householdMatches])].slice(0, 20),
        rejectedAnchors: excludedMatches.slice(0, 12),
        rejectionReasons,
        queryId: query.queryId || signal.queryId || '',
        queryHash: query.queryHash || '',
        checkedAt: now
    }
    return { ...report, reportHash: stableHash({ ...report, checkedAt: new Date(now).toISOString() }) }
}

const scoreSourceSignals = ({ signals = [], sources = [], queryPack = {}, minScore, now } = {}) => {
    const byId = new Map(sources.map((source) => [String(source.sourceId), source]))
    const scored = signals.map((signal) => {
        const source = byId.get(String(signal.sourceId)) || {}
        const relevance = scoreSourceSignal({ signal, source, queryPack, minScore, now })
        let sourceDomain = ''
        try { sourceDomain = new URL(String(source.canonicalUrl || signal.canonicalUrl || '')).hostname.replace(/^www\./, '') } catch (_error) {}
        return {
            ...signal,
            sourceName: source.sourceName || signal.sourceName || source.title || signal.sourceTitle || '',
            sourceDomain,
            canonicalUrl: signal.canonicalUrl || source.canonicalUrl || '',
            queryId: relevance.queryId,
            relevance
        }
    })
    return {
        accepted: scored.filter((signal) => signal.relevance.eligibleForIdeation),
        rejected: scored.filter((signal) => !signal.relevance.eligibleForIdeation),
        all: scored,
        version: SOURCE_RELEVANCE_VERSION
    }
}

module.exports = {
    anchorAffinityOverlap,
    bestTokenOverlap,
    DEFAULT_MIN_SCORE,
    IRRELEVANT_ENTITY_PATTERNS,
    NAVIGATION_NOISE,
    SOURCE_RELEVANCE_VERSION,
    phraseMatches,
    scoreSourceSignal,
    scoreSourceSignals,
    tokenOverlap,
    tokenSet
}
