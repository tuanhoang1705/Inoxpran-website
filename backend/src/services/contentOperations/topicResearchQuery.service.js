'use strict'

const crypto = require('node:crypto')

const QUERY_VERSION = 'topic-research-query-v4-2026-08-04'
const HOUSEHOLD_ANCHORS = Object.freeze([
    'gia dụng', 'đồ gia dụng', 'nhà bếp', 'gian bếp', 'dụng cụ bếp', 'đồ bếp', 'nấu ăn',
    'nồi', 'chảo', 'bếp', 'inox', 'thép không gỉ', 'gang', 'ấm', 'dao', 'thớt', 'hộp đựng',
    'bảo quản thực phẩm', 'vệ sinh', 'rửa bát', 'lò nướng', 'nồi áp suất', 'nồi cơm',
    'máy xay', 'máy hút mùi', 'thiết bị bếp', 'bếp từ', 'máy sấy bát', 'máy sấy bát đĩa',
    'ấm điện', 'ấm siêu tốc', 'quạt', 'quạt điện', 'quạt tích điện', 'vợt muỗi',
    'thùng đựng gạo', 'hút chân không', 'tỏi đen', 'đồ điện gia dụng', 'thiết bị gia đình',
    'cookware', 'kitchen', 'houseware'
])

const normalizeText = (value) => String(value || '')
    .normalize('NFC')
    .toLocaleLowerCase('vi')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const boundedList = (value, maxItems = 24, maxLength = 160) => Array.from(new Set(
    (Array.isArray(value) ? value : [])
        .map((item) => (typeof item === 'string' || typeof item === 'number' ? String(item).trim().slice(0, maxLength) : ''))
        .filter(Boolean)
)).slice(0, maxItems)

const stableHash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')

const researchCards = (coverage = {}) => (
    Array.isArray(coverage.promptCards) && coverage.promptCards.length
        ? coverage.promptCards
        : Array.isArray(coverage.cards) ? coverage.cards : []
)

const productTerms = (coverage = {}) => boundedList(
    researchCards(coverage).flatMap((card) => [
        card?.category?.name,
        card?.categoryKey,
        ...(card?.materials || []),
        ...(card?.supportedUseCases || []),
        ...(card?.verifiedFeatures || []),
        card?.name,
        card?.sku
    ]),
    36,
    120
)

const searchGapTerms = (snapshot = {}) => boundedList([
    ...(snapshot.websitePerformance?.queryGaps || []).map((item) => item?.query || item?.keyword),
    ...(snapshot.websitePerformance?.nearPageOneOpportunities || []).map((item) => item?.query || item?.keyword),
    ...((snapshot.websitePerformance?.searchConsole?.windows || [])
        .flatMap((window) => window?.signals?.queryGaps || [])
        .map((item) => item?.query || item?.keyword))
], 20, 160)

const queryFamilies = Object.freeze([
    { axis: 'demand', suffix: 'kinh nghiệm lựa chọn cho gia đình Việt' },
    { axis: 'problem', suffix: 'có an toàn cho sức khỏe không lỗi thường gặp cách xử lý' },
    { axis: 'comparison', suffix: 'so sánh cách chọn tương thích ưu nhược điểm' },
    { axis: 'care', suffix: 'cách vệ sinh bảo quản an toàn tăng tuổi thọ' },
    { axis: 'use_case', suffix: 'cách sử dụng đúng trong gia đình hằng ngày' },
    { axis: 'seasonal', suffix: 'theo mùa thói quen gia đình Việt' }
])

const isLikelySku = (value) => {
    const raw = String(value || '').trim()
    if (!raw) return false
    return /^(?=.*\d)[A-Z0-9_-]{4,}$/iu.test(raw) || /\bsku\b/i.test(raw)
}

const productIdentityTerms = (coverage = {}) => boundedList(
    researchCards(coverage).flatMap((card) => [
        card?.name,
        card?.sku,
        card?.category?.name,
        card?.categoryKey
    ]),
    200,
    240
)

const catalogFocusTermsFor = ({ focusTerms = [], productCoverage = {} } = {}) => {
    const identities = new Set(productIdentityTerms(productCoverage).map(normalizeText).filter(Boolean))
    return boundedList(focusTerms.filter((term) => identities.has(normalizeText(term))), 16, 160)
}

const searchSeedForTerm = (value) => normalizeText(value)
    .split(' ')
    .filter((token) => token !== 'inoxpran' && !isLikelySku(token))
    .join(' ')
    .trim()

const catalogSearchSeeds = (coverage = {}) => boundedList(
    researchCards(coverage)
        .map((card) => searchSeedForTerm(
            card?.name || card?.category?.name || card?.categoryKey
        ))
        .filter(Boolean),
    8,
    120
)

const buildTopicResearchQueryPack = ({
    direction = '',
    interpretation = {},
    productCoverage = {},
    snapshot = {},
    locale = 'vi-VN',
    country = 'VN',
    freshnessDays = 90,
    maxQueries = 18
} = {}) => {
    const focusTerms = boundedList(interpretation.focusTerms, 16, 120)
    const excludedTerms = boundedList(interpretation.excludedTerms, 16, 120)
    const audienceTerms = boundedList(interpretation.targetAudience, 10, 160)
    const axes = boundedList(interpretation.topicAxes, 12, 80)
    const rawCatalogTerms = productTerms(productCoverage)
    const catalogFocusTerms = catalogFocusTermsFor({ focusTerms, productCoverage })
    // Keep manager-selected catalog products ahead of the bounded catalog list.
    // Without this, deterministic catalog ordering could truncate the requested
    // product before evidence scoring ever saw it.
    const catalogTerms = boundedList([...catalogFocusTerms, ...rawCatalogTerms], 36, 120)
    const catalogSeedTerms = catalogSearchSeeds(productCoverage)
    const gaps = searchGapTerms(snapshot)
    const normalizedGoal = String(interpretation.normalizedGoal || direction || '').trim().slice(0, 500)
    const baseTerms = boundedList([
        ...focusTerms,
        ...catalogTerms.slice(0, 10),
        ...gaps.slice(0, 6),
        ...HOUSEHOLD_ANCHORS.slice(0, 8)
    ], 30, 120)
    const normalizedFocusSeed = focusTerms.map(searchSeedForTerm).filter(Boolean).join(' ').slice(0, 180)
    const seedTerms = boundedList(
        catalogFocusTerms.length
            ? catalogFocusTerms.map(searchSeedForTerm).filter(Boolean)
            : catalogSeedTerms.length
                ? catalogSeedTerms.map((seed) => normalizedFocusSeed ? `${seed} ${normalizedFocusSeed}` : seed)
                : focusTerms.map(searchSeedForTerm).filter(Boolean),
        8,
        240
    )
    const fallbackSeed = searchSeedForTerm(normalizedGoal) || 'đồ gia dụng nhà bếp'
    const families = queryFamilies.filter((family) => !axes.length || axes.includes(family.axis) || familiesFallback(axes, family.axis))
    const selectedFamilies = families.length ? families : queryFamilies
    const familyPriority = new Map(['problem', 'care', 'demand', 'comparison', 'use_case', 'seasonal']
        .map((axis, index) => [axis, index]))
    const prioritizedFamilies = [...selectedFamilies].sort((left, right) => (
        (familyPriority.get(left.axis) ?? familyPriority.size) -
        (familyPriority.get(right.axis) ?? familyPriority.size)
    ))
    // Build product × intent pairs in intent-priority order. With the external
    // six-query cap, two priority products each receive problem, care and demand
    // research instead of one product monopolizing the evidence budget.
    const queryPairs = prioritizedFamilies.flatMap((family) => (
        (seedTerms.length ? seedTerms : [fallbackSeed]).map((seed) => ({ family, seed }))
    )).slice(0, Math.max(1, Math.min(maxQueries, prioritizedFamilies.length * Math.max(1, seedTerms.length))))
    const queries = queryPairs.map(({ family, seed }) => {
        // One product focus per query prevents unrelated products from becoming
        // accidental AND terms.
        const queryText = `${seed} ${family.suffix}`.replace(/\s+/g, ' ').trim().slice(0, 500)
        const payload = { version: QUERY_VERSION, axis: family.axis, queryText, locale, country, freshnessDays }
        return {
            queryId: stableHash(payload).slice(0, 24),
            axis: family.axis,
            queryText,
            queryHash: stableHash(queryText),
            anchors: boundedList([...focusTerms, ...catalogTerms, ...HOUSEHOLD_ANCHORS], 60, 120),
            excludedTerms,
            locale,
            country,
            freshnessDays: Math.max(1, Math.min(365, Number(freshnessDays) || 90))
        }
    })
    const context = {
        version: QUERY_VERSION,
        normalizedGoal,
        scopeMode: interpretation.scopeMode || 'mixed',
        focusTerms,
        catalogFocusTerms,
        excludedTerms,
        audienceTerms,
        catalogTerms,
        baseTerms,
        searchGapTerms: gaps,
        householdAnchors: HOUSEHOLD_ANCHORS,
        locale,
        country,
        queries
    }
    return { ...context, contextHash: stableHash(context) }
}

const familiesFallback = (axes, axis) => axes.some((value) => {
    const normalized = normalizeText(value)
    if (axis === 'comparison') return /chon|chọn|so sánh|tuong thich|tương thích/.test(normalized)
    if (axis === 'care') return /bao quan|bảo quản|ve sinh|vệ sinh|vong doi|vòng đời/.test(normalized)
    if (axis === 'problem') return /loi|lỗi|an toan|an toàn|xu ly|xử lý/.test(normalized)
    return normalized.includes(normalizeText(axis))
})

module.exports = {
    HOUSEHOLD_ANCHORS,
    QUERY_VERSION,
    boundedList,
    buildTopicResearchQueryPack,
    catalogSearchSeeds,
    catalogFocusTermsFor,
    isLikelySku,
    normalizeText,
    productTerms,
    productIdentityTerms,
    searchSeedForTerm,
    searchGapTerms,
    stableHash
}
