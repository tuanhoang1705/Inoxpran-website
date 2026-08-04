'use strict'

const crypto = require('node:crypto')
const { normalizeForSimilarity, textSimilarity } = require('../../utils/agenticBlogCore.util')
const { ProductCatalogIntelligenceService } = require('../productCatalogIntelligence.service')

const DEFAULT_BATCH_SIZE = 8
const MAX_BATCH_SIZE = 24

const text = (value, max = 500) => {
    if (value === null || value === undefined || typeof value === 'object') return ''
    return String(value)
        .replace(new RegExp('[\u0000-\u001f\u007f]', 'g'), '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max)
}

const uniqueList = (value, maxItems = 20, maxLength = 180) => {
    const values = Array.isArray(value) ? value : []
    const seen = new Set()
    const output = []
    for (const item of values) {
        const cleaned = text(item, maxLength)
        const key = cleaned.toLocaleLowerCase('vi')
        if (!cleaned || seen.has(key)) continue
        seen.add(key)
        output.push(cleaned)
        if (output.length >= maxItems) break
    }
    return output
}

const normalizeKey = (value) => String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()

const PUBLIC_FACT_KEYS = new Set([
    'name', 'label', 'value', 'option', 'variant', 'variation',
    'feature', 'material', 'chatlieu',
    'color', 'colour', 'mau', 'mausac',
    'size', 'sizes', 'kichthuoc',
    'capacity', 'volume', 'dungtich',
    'model', 'type', 'style', 'finish', 'surface',
    'diameter', 'duongkinh',
    'length', 'width', 'height', 'chieudai', 'chieurong', 'chieucao',
    'weight', 'khoiluong', 'unit', 'donvi',
    'usecase', 'supportedusecase', 'compatibility', 'solution'
])

const safeScalarFacts = (value, maxItems = 20, maxLength = 180, maxDepth = 3) => {
    const output = []
    const seen = new Set()
    const push = (rawValue, rawKey = '') => {
        const cleaned = text(rawValue, maxLength)
        if (!cleaned || cleaned === '[object Object]') return
        const label = text(rawKey, 60)
        const fact = label ? `${label}: ${cleaned}`.slice(0, maxLength) : cleaned
        const identity = fact.toLocaleLowerCase('vi')
        if (!identity || seen.has(identity)) return
        seen.add(identity)
        output.push(fact)
    }
    const visit = (current, depth = 0, key = '') => {
        if (output.length >= maxItems || current === null || current === undefined) return
        if (['string', 'number', 'boolean'].includes(typeof current)) {
            if (!key || PUBLIC_FACT_KEYS.has(normalizeKey(key))) push(current, key)
            return
        }
        if (depth >= maxDepth || typeof current !== 'object' || current instanceof Date) return
        if (Array.isArray(current)) {
            for (const item of current) {
                visit(item, depth + 1, key)
                if (output.length >= maxItems) break
            }
            return
        }
        for (const childKey of Object.keys(current).sort((left, right) => left.localeCompare(right, 'vi'))) {
            visit(current[childKey], depth + 1, childKey)
            if (output.length >= maxItems) break
        }
    }
    visit(value)
    return output
}

const stableObject = (value) => {
    if (Array.isArray(value)) return value.map(stableObject)
    if (!value || typeof value !== 'object' || value instanceof Date) return value
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableObject(value[key])]))
}

const sha256 = (value) => crypto.createHash('sha256').update(
    typeof value === 'string' ? value : JSON.stringify(stableObject(value))
).digest('hex')

const safeFactStrings = (product = {}) => uniqueList([
    ...safeScalarFacts(product.verifiedFeatures, 8, 160),
    ...safeScalarFacts(product.materials, 6, 160),
    ...safeScalarFacts(product.supportedUseCases, 6, 180),
    ...safeScalarFacts(product.problemSolutions, 6, 180),
    ...safeScalarFacts(product.compatibility, 6, 180),
    ...(Array.isArray(product.verifiedSpecifications)
        ? product.verifiedSpecifications.map((item) => {
            const key = text(item?.key, 80)
            const value = text(item?.value, 140)
            return key && value ? `${key}: ${value}` : ''
        })
        : [])
], 20, 220)

const stableSafeProductEvidence = (product = {}) => ({
    productId: text(product.productId, 100),
    sku: text(product.sku, 100),
    name: text(product.name, 240),
    categoryId: text(product.category?.id || product.category, 120),
    categoryName: text(product.category?.name || product.category, 120),
    status: text(product.status, 40),
    availability: text(product.availability, 40),
    eligible: Boolean(product.eligible),
    safeFacts: safeFactStrings(product)
})

const productEvidenceHash = (product) => sha256(stableSafeProductEvidence(product))

const normalizeInventoryItem = (item = {}) => ({
    blogId: text(item.blogId || item._id || item.id, 100),
    title: text(item.title || item.blog_title, 300),
    topicSummary: text(item.topicSummary || item.blog_topic_summary, 600),
    category: text(item.category || item.blog_category_key, 120),
    articleType: text(item.articleType || item.contentRole, 120),
    linkedProductIds: uniqueList(item.linkedProductIds, 100, 100),
    linkedProductSlugs: uniqueList(item.linkedProductSlugs, 100, 180)
})

const isProductLedEligible = (product = {}) => (
    Boolean(product.eligible) &&
    text(product.status, 40) === 'active' &&
    ['in_stock', 'low_stock'].includes(text(product.availability, 40))
)

const coverageSignals = ({ product = {}, inventoryItems = [] } = {}) => {
    const productId = text(product.productId, 100)
    const slug = text(product.slug, 180)
    const haystack = normalizeForSimilarity([
        product.name,
        product.sku,
        product.category?.name,
        product.category?.id,
        ...safeFactStrings(product)
    ].filter(Boolean).join(' '))
    let directReferences = 0
    let relatedArticles = 0
    let maximumSimilarity = 0
    for (const rawItem of Array.isArray(inventoryItems) ? inventoryItems : []) {
        const item = normalizeInventoryItem(rawItem)
        const directlyLinked = (
            (productId && item.linkedProductIds.includes(productId)) ||
            (slug && item.linkedProductSlugs.includes(slug))
        )
        if (directlyLinked) directReferences += 1
        const articleText = [item.title, item.topicSummary, item.category].filter(Boolean).join(' ')
        const similarity = haystack && articleText ? textSimilarity(haystack, articleText, 2) : 0
        maximumSimilarity = Math.max(maximumSimilarity, similarity)
        if (directlyLinked || similarity >= 0.15) relatedArticles += 1
    }
    const gapScore = Number(Math.max(0, Math.min(1,
        1 - Math.min(0.65, directReferences * 0.25) - Math.min(0.25, relatedArticles * 0.08) - Math.min(0.3, maximumSimilarity * 0.3)
    )).toFixed(4))
    const reasons = []
    if (directReferences === 0) reasons.push('no_direct_product_coverage')
    if (relatedArticles === 0) reasons.push('no_related_article_coverage')
    if (maximumSimilarity < 0.15) reasons.push('weak_semantic_coverage')
    if (!isProductLedEligible(product)) reasons.push(
        text(product.availability, 40) === 'out_of_stock' ? 'out_of_stock_not_product_led' : 'product_not_eligible_for_product_led'
    )
    return { directReferences, relatedArticles, maximumSimilarity: Number(maximumSimilarity.toFixed(4)), gapScore, reasons }
}

const buildProductCoverageCard = ({ product = {}, inventoryItems = [] } = {}) => {
    const safeEvidence = stableSafeProductEvidence(product)
    if (!safeEvidence.productId && !safeEvidence.sku && !safeEvidence.name) return null
    const coverage = coverageSignals({ product, inventoryItems })
    const productLedEligible = isProductLedEligible(product)
    const evidenceKeys = uniqueList([
        ...(Array.isArray(product.verifiedSpecifications)
            ? product.verifiedSpecifications.map((item) => item?.key)
            : []),
        ...safeEvidence.safeFacts.map((_, index) => `${safeEvidence.productId || safeEvidence.sku}:fact:${index + 1}`)
    ], 30, 160)
    return {
        productId: safeEvidence.productId,
        sku: safeEvidence.sku,
        name: safeEvidence.name,
        slug: text(product.slug, 180),
        category: {
            id: safeEvidence.categoryId,
            name: safeEvidence.categoryName
        },
        categoryKey: safeEvidence.categoryId,
        status: safeEvidence.status,
        availability: safeEvidence.availability,
        eligible: safeEvidence.eligible,
        productLedEligible,
        safeFacts: safeEvidence.safeFacts,
        materials: uniqueList(product.materials, 8, 160),
        verifiedFeatures: uniqueList(product.verifiedFeatures, 10, 180),
        supportedUseCases: uniqueList(product.supportedUseCases, 10, 180),
        compatibility: uniqueList(product.compatibility, 8, 180),
        evidenceKeys,
        evidenceHash: productEvidenceHash(product),
        coverage,
        coverageGaps: coverage.reasons,
        suggestedScope: productLedEligible ? 'product' : 'category'
    }
}

const buildCategorySummary = (cards = []) => {
    const groups = new Map()
    for (const card of Array.isArray(cards) ? cards : []) {
        const id = text(card?.category?.id || card?.category?.name || 'uncategorized', 120) || 'uncategorized'
        const current = groups.get(id) || {
            categoryId: id,
            categoryName: text(card?.category?.name || id, 120),
            productCount: 0,
            productLedEligibleCount: 0,
            uncoveredCount: 0,
            averageGapScore: 0,
            evidenceHash: ''
        }
        current.productCount += 1
        current.productLedEligibleCount += card.productLedEligible ? 1 : 0
        current.uncoveredCount += card.coverage?.gapScore >= 0.6 ? 1 : 0
        current.averageGapScore += Number(card.coverage?.gapScore || 0)
        groups.set(id, current)
    }
    return [...groups.values()]
        .map((item) => ({
            ...item,
            averageGapScore: Number((item.averageGapScore / Math.max(1, item.productCount)).toFixed(4)),
            evidenceHash: sha256(cards
                .filter((card) => text(card?.category?.id || card?.category?.name || 'uncategorized', 120) === item.categoryId)
                .map((card) => card.evidenceHash)
                .sort())
        }))
        .sort((left, right) => (
            right.averageGapScore - left.averageGapScore || left.categoryId.localeCompare(right.categoryId)
        ))
}

const deterministicCardOrder = (cards = []) => [...cards].sort((left, right) => {
    const categoryCompare = text(left.category?.id || left.category?.name).localeCompare(text(right.category?.id || right.category?.name), 'vi')
    if (categoryCompare) return categoryCompare
    const skuCompare = text(left.sku).localeCompare(text(right.sku), 'vi')
    if (skuCompare) return skuCompare
    const nameCompare = text(left.name).localeCompare(text(right.name), 'vi')
    if (nameCompare) return nameCompare
    return text(left.productId).localeCompare(text(right.productId), 'vi')
})

const rotatePromptBatch = ({ cards = [], generation = 0, limit = DEFAULT_BATCH_SIZE } = {}) => {
    const ordered = deterministicCardOrder(cards)
    if (!ordered.length) return []
    const boundedLimit = Math.min(MAX_BATCH_SIZE, Math.max(1, Number(limit) || DEFAULT_BATCH_SIZE))
    const offset = (Math.max(0, Math.floor(Number(generation) || 0)) * boundedLimit) % ordered.length
    const count = Math.min(boundedLimit, ordered.length)
    return Array.from({ length: count }, (_, index) => ordered[(offset + index) % ordered.length])
}

const promptCard = (card = {}) => ({
    productId: text(card.productId, 100),
    sku: text(card.sku, 100),
    name: text(card.name, 240),
    slug: text(card.slug, 180),
    category: {
        id: text(card.category?.id, 120),
        name: text(card.category?.name, 120)
    },
    categoryKey: text(card.category?.id, 120),
    availability: text(card.availability, 40),
    productLedEligible: Boolean(card.productLedEligible),
    safeFacts: uniqueList(card.safeFacts, 12, 220),
    materials: uniqueList(card.materials, 8, 120),
    verifiedFeatures: uniqueList(card.verifiedFeatures, 10, 180),
    supportedUseCases: uniqueList(card.supportedUseCases, 10, 180),
    compatibility: uniqueList(card.compatibility, 8, 180),
    coverageGaps: uniqueList(card.coverage?.reasons, 8, 160),
    evidenceKeys: uniqueList(card.evidenceKeys, 20, 160),
    coverageGap: {
        score: Number(card.coverage?.gapScore || 0),
        reasons: uniqueList(card.coverage?.reasons, 6, 120)
    },
    evidenceHash: text(card.evidenceHash, 128)
})

const buildCoverage = ({
    safeProducts = [],
    inventoryItems = [],
    generation = 0,
    limit,
    batchSize = limit ?? DEFAULT_BATCH_SIZE
} = {}) => {
    const cards = deterministicCardOrder((Array.isArray(safeProducts) ? safeProducts : [])
        .map((product) => buildProductCoverageCard({ product, inventoryItems }))
        .filter(Boolean))
    const categorySummary = buildCategorySummary(cards)
    const batch = rotatePromptBatch({ cards, generation, limit: batchSize }).map(promptCard)
    const coverageHash = sha256(cards.map((card) => card.evidenceHash).sort())
    return {
        generation: Math.max(0, Math.floor(Number(generation) || 0)),
        productCount: cards.length,
        productLedEligibleCount: cards.filter((card) => card.productLedEligible).length,
        coverageGapCount: cards.filter((card) => card.coverage.gapScore >= 0.6).length,
        cards,
        categorySummary,
        promptCards: batch,
        coverageHash,
        // Compatibility aliases for earlier callers; both reference the same bounded data.
        promptBatch: batch,
        evidenceHash: coverageHash
    }
}

class ProductTopicCoverageService {
    constructor({ productCatalogService = ProductCatalogIntelligenceService } = {}) {
        this.productCatalogService = productCatalogService
    }

    async build({
        safeProducts = null,
        inventoryItems = [],
        generation = 0,
        limit,
        batchSize = limit ?? DEFAULT_BATCH_SIZE
    } = {}) {
        const products = Array.isArray(safeProducts)
            ? safeProducts
            : await this.productCatalogService.readSafeCatalog()
        return buildCoverage({ safeProducts: products, inventoryItems, generation, batchSize })
    }

    static build(input) {
        return buildCoverage(input)
    }
}

const createProductTopicCoverageService = (options) => new ProductTopicCoverageService(options)

module.exports = {
    DEFAULT_BATCH_SIZE,
    MAX_BATCH_SIZE,
    ProductTopicCoverageService,
    buildCategorySummary,
    buildCoverage,
    buildProductCoverageCard,
    coverageSignals,
    createProductTopicCoverageService,
    deterministicCardOrder,
    isProductLedEligible,
    productEvidenceHash,
    promptCard,
    rotatePromptBatch,
    safeFactStrings,
    safeScalarFacts,
    sha256,
    stableSafeProductEvidence
}
