'use strict'

const crypto = require('node:crypto')
const sanitizeHtml = require('sanitize-html')
const { BlogNoveltyIndex } = require('../../models/blogNoveltyIndex.model')
const { blog: BlogPost } = require('../../models/blog.model')
const { BlogTopicRoadmapItem } = require('../../models/blogTopicRoadmapItem.model')

const INDEX_VERSION = 'blog-novelty-v2-2026-07-25'
const TOKENIZER_VERSION = 'vi-unicode-v2'
const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-large'
const VALID_SCORE_HASH = /^[a-f0-9]{64}$/
const NON_INDEXABLE_ROADMAP_STATUSES = Object.freeze(['failed', 'invalidated'])

const stableObject = (value) => {
    if (Array.isArray(value)) return value.map(stableObject)
    if (!value || typeof value !== 'object' || value instanceof Date) return value
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableObject(value[key])]))
}
const sha256 = (value) => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(stableObject(value))).digest('hex')
const normalizeText = (value) => String(value || '')
    .normalize('NFC')
    .toLocaleLowerCase('vi')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
const tokenizeVietnamese = (value) => normalizeText(value).split(' ').filter(Boolean)
const frequencyMap = (values) => values.reduce((map, value) => ({ ...map, [value]: (map[value] || 0) + 1 }), {})
const ngrams = (tokens, size) => {
    if (!tokens.length) return []
    if (tokens.length < size) return [tokens.join(' ')]
    return Array.from({ length: tokens.length - size + 1 }, (_, index) => tokens.slice(index, index + size).join(' '))
}
const setSimilarity = (left, right) => {
    const a = left instanceof Set ? left : new Set(left || [])
    const b = right instanceof Set ? right : new Set(right || [])
    if (!a.size && !b.size) return 0
    if (!a.size || !b.size) return 0
    const intersection = [...a].filter((value) => b.has(value)).length
    return intersection / (a.size + b.size - intersection)
}
const cosineSimilarity = (left, right) => {
    if (!Array.isArray(left) || !Array.isArray(right) || !left.length || left.length !== right.length) return null
    let dot = 0
    let a = 0
    let b = 0
    for (let index = 0; index < left.length; index += 1) {
        dot += Number(left[index]) * Number(right[index])
        a += Number(left[index]) ** 2
        b += Number(right[index]) ** 2
    }
    if (!a || !b) return null
    return Math.max(-1, Math.min(1, dot / (Math.sqrt(a) * Math.sqrt(b))))
}
const stripHtml = (value) => sanitizeHtml(String(value || ''), { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, ' ').trim()
const extractHeadings = (html) => Array.from(String(html || '').matchAll(/<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>/gi))
    .map((match) => stripHtml(match[1])).filter(Boolean).slice(0, 100)
const chunkText = (value, maxChars = 1800) => {
    const paragraphs = stripHtml(value).split(/(?<=[.!?])\s+|\n+/).map((item) => item.trim()).filter(Boolean)
    const chunks = []
    let current = ''
    for (const paragraph of paragraphs) {
        if (current && current.length + paragraph.length + 1 > maxChars) {
            chunks.push(current)
            current = ''
        }
        current = `${current} ${paragraph}`.trim()
    }
    if (current) chunks.push(current)
    return chunks.slice(0, 100)
}

class OpenAIEmbeddingProvider {
    constructor({ env = process.env, fetchImpl = global.fetch } = {}) {
        this.env = env
        this.fetchImpl = fetchImpl
        this.provider = 'openai'
        this.model = String(env.OPENAI_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL).trim()
    }

    async embedMany(texts) {
        const apiKey = String(this.env.OPENAI_API_KEY || '').trim()
        if (!apiKey || typeof this.fetchImpl !== 'function') {
            const error = new Error('Embedding provider is unavailable')
            error.code = 'NOVELTY_EMBEDDING_UNAVAILABLE'
            throw error
        }
        const response = await this.fetchImpl('https://api.openai.com/v1/embeddings', {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({ model: this.model, input: texts.map((text) => String(text || '').slice(0, 24_000)) }),
            redirect: 'error'
        })
        if (!response.ok) {
            const error = new Error(`Embedding request failed (${response.status})`)
            error.code = 'NOVELTY_EMBEDDING_FAILED'
            throw error
        }
        const payload = await response.json()
        const vectors = (payload.data || []).sort((a, b) => a.index - b.index).map((item) => item.embedding)
        if (vectors.length !== texts.length || vectors.some((vector) => !Array.isArray(vector) || !vector.length)) {
            const error = new Error('Embedding response is incomplete')
            error.code = 'NOVELTY_EMBEDDING_INVALID'
            throw error
        }
        return vectors
    }
}

const sourcePayload = ({ sourceType, source }) => {
    if (sourceType === 'roadmap') {
        const body = [source.angle, source.primaryQuestion, ...(source.supportingQuestions || [])].filter(Boolean).join('\n')
        return {
            sourceType,
            sourceId: source._id || source.id,
            title: source.topic || '', seoTitle: '', excerpt: source.angle || '', tags: source.secondaryKeywords || [],
            topicSummary: source.angle || '', primaryIntent: source.searchIntent || '', contentRole: source.articleType || '',
            entities: (source.productEvidence || []).flatMap((item) => [item.name, item.category]).filter(Boolean),
            questions: [source.primaryQuestion, ...(source.supportingQuestions || [])].filter(Boolean),
            headings: source.supportingQuestions || [], body, structure: { articleType: source.articleType, topicAxis: source.topicAxis }
        }
    }
    return {
        sourceType,
        sourceId: source._id || source.id,
        title: source.blog_title || '', seoTitle: source.blog_seo_title || '', excerpt: source.blog_excerpt || '', tags: source.blog_tags || [],
        topicSummary: source.topicSummary || '', primaryIntent: source.primaryIntent || '', contentRole: source.contentRole || '',
        entities: source.entitySummary || [], questions: [], headings: extractHeadings(source.blog_content), body: source.blog_content || '',
        structure: source.structuralFingerprint || {}
    }
}

const isIndexableRoadmapItem = (source = {}) => (
    source?.scores?.hardGatesPassed === true &&
    Number(source?.scores?.totalScore || 0) >= 82 &&
    Number(source?.scores?.noveltySubtotal || 0) >= 48 &&
    VALID_SCORE_HASH.test(String(source?.scores?.scoreHash || '').trim()) &&
    Array.isArray(source?.marketEvidence) &&
    source.marketEvidence.some((entry) => (
        String(entry?.evidenceId || '').trim() &&
        String(entry?.contentHash || '').trim()
    )) &&
    !NON_INDEXABLE_ROADMAP_STATUSES.includes(String(source?.status || '').trim())
)

const roadmapCorpusFilter = () => ({
    status: { $nin: [...NON_INDEXABLE_ROADMAP_STATUSES] },
    'scores.hardGatesPassed': true,
    'scores.totalScore': { $gte: 82 },
    'scores.noveltySubtotal': { $gte: 48 },
    'scores.scoreHash': { $type: 'string', $regex: VALID_SCORE_HASH },
    marketEvidence: {
        $elemMatch: {
            evidenceId: { $type: 'string', $ne: '' },
            contentHash: { $type: 'string', $ne: '' }
        }
    }
})

const prepareIndexDocument = ({ sourceType, source }) => {
    const payload = sourcePayload({ sourceType, source })
    const plainBody = stripHtml(payload.body)
    const tokens = tokenizeVietnamese([
        payload.title, payload.seoTitle, payload.excerpt, payload.tags.join(' '), payload.topicSummary,
        payload.primaryIntent, payload.contentRole, payload.entities.join(' '), payload.questions.join(' '),
        payload.headings.join(' '), plainBody
    ].join('\n'))
    const topicText = [payload.title, payload.seoTitle, payload.topicSummary, payload.primaryIntent, payload.entities.join(' ')].join('\n')
    const planText = [payload.excerpt, payload.questions.join('\n'), payload.headings.join('\n'), payload.contentRole].join('\n')
    const bodyChunks = chunkText(payload.body)
    return {
        payload,
        plainBody,
        tokens,
        topicText,
        planText,
        bodyChunks,
        sourceContentHash: sha256({ ...payload, body: plainBody })
    }
}

const buildIndexDocument = async ({ sourceType, source, embeddingProvider, now = new Date(), prepared = null }) => {
    const {
        payload,
        plainBody,
        tokens,
        topicText,
        planText,
        bodyChunks,
        sourceContentHash
    } = prepared || prepareIndexDocument({ sourceType, source })
    const vectors = await embeddingProvider.embedMany([topicText, planText, plainBody.slice(0, 24_000), ...bodyChunks])
    const vector = (values) => ({
        provider: embeddingProvider.provider || 'injected',
        model: embeddingProvider.model || 'injected',
        dimensions: values.length,
        values,
        vectorHash: sha256(values)
    })
    return {
        sourceType,
        sourceId: payload.sourceId,
        isQaTest: false,
        indexVersion: INDEX_VERSION,
        tokenizerVersion: TOKENIZER_VERSION,
        sourceContentHash,
        title: payload.title,
        seoTitle: payload.seoTitle,
        excerpt: payload.excerpt,
        tags: payload.tags,
        topicSummary: payload.topicSummary,
        primaryIntent: payload.primaryIntent,
        contentRole: payload.contentRole,
        entities: payload.entities,
        questions: payload.questions,
        headings: payload.headings,
        bodyChunks,
        tokens,
        unigrams: frequencyMap(tokens),
        bigrams: frequencyMap(ngrams(tokens, 2)),
        structure: payload.structure,
        topicVector: vector(vectors[0]),
        planVector: vector(vectors[1]),
        bodyVector: vector(vectors[2]),
        chunkVectors: vectors.slice(3).map(vector),
        indexedAt: now
    }
}

class BlogNoveltyIndexService {
    constructor({ IndexModel = BlogNoveltyIndex, BlogModel = BlogPost, RoadmapItemModel = BlogTopicRoadmapItem, embeddingProvider = new OpenAIEmbeddingProvider(), now = () => new Date() } = {}) {
        this.IndexModel = IndexModel
        this.BlogModel = BlogModel
        this.RoadmapItemModel = RoadmapItemModel
        this.embeddingProvider = embeddingProvider
        this.now = now
    }

    async upsertSource({ sourceType, source, prepared = null }) {
        if (source?.isQaTest === true) return null
        if (sourceType === 'roadmap' && !isIndexableRoadmapItem(source)) return null
        const document = await buildIndexDocument({
            sourceType,
            source,
            embeddingProvider: this.embeddingProvider,
            now: this.now(),
            prepared
        })
        return this.IndexModel.findOneAndUpdate(
            { sourceType, sourceId: document.sourceId, indexVersion: INDEX_VERSION },
            { $set: document },
            { upsert: true, new: true, runValidators: true }
        )
    }

    async syncCorpus({ force = false } = {}) {
        const blogs = await this.BlogModel.find({ isQaTest: { $ne: true } }).select('+blog_content').lean()
        const roadmapItems = await this.RoadmapItemModel.find(roadmapCorpusFilter()).lean()
        const sources = [
            ...blogs.map((source) => ({ sourceType: 'blog', source })),
            ...roadmapItems.filter(isIndexableRoadmapItem).map((source) => ({ sourceType: 'roadmap', source }))
        ]
        const sourceKey = (sourceType, sourceId) => `${sourceType}:${String(sourceId || '')}`
        const desired = new Map(sources.map((entry) => [
            sourceKey(entry.sourceType, entry.source?._id || entry.source?.id),
            entry
        ]))
        const current = await this.IndexModel.find({ indexVersion: INDEX_VERSION })
            .select('sourceType sourceId sourceContentHash tokenizerVersion topicVector.vectorHash planVector.vectorHash bodyVector.vectorHash chunkVectors.vectorHash')
            .lean()
        const currentByKey = new Map(current.map((entry) => [sourceKey(entry.sourceType, entry.sourceId), entry]))
        const staleIds = current
            .filter((entry) => !desired.has(sourceKey(entry.sourceType, entry.sourceId)))
            .map((entry) => entry._id)
            .filter(Boolean)
        if (staleIds.length) await this.IndexModel.deleteMany({ _id: { $in: staleIds } })

        let indexed = 0
        let created = 0
        let updated = 0
        let unchanged = 0
        for (const { sourceType, source } of desired.values()) {
            const prepared = prepareIndexDocument({ sourceType, source })
            const existing = currentByKey.get(sourceKey(sourceType, source?._id || source?.id))
            const reusable = !force && existing &&
                existing.sourceContentHash === prepared.sourceContentHash &&
                existing.tokenizerVersion === TOKENIZER_VERSION &&
                Boolean(existing.topicVector?.vectorHash) &&
                Boolean(existing.planVector?.vectorHash) &&
                Boolean(existing.bodyVector?.vectorHash) &&
                Array.isArray(existing.chunkVectors)
            if (reusable) {
                unchanged += 1
                continue
            }
            if (await this.upsertSource({ sourceType, source, prepared })) {
                indexed += 1
                if (existing) updated += 1
                else created += 1
            }
        }
        const manifest = await this.manifest()
        return {
            indexed,
            created,
            updated,
            unchanged,
            pruned: staleIds.length,
            rebuilt: current.length === 0 && indexed > 0,
            ...manifest
        }
    }

    async rebuildAll() {
        return this.syncCorpus({ force: true })
    }

    async ensureCorpus() {
        return this.syncCorpus()
    }

    async manifest() {
        const entries = await this.IndexModel.find({ indexVersion: INDEX_VERSION, isQaTest: false })
            .select('sourceType sourceId sourceContentHash topicVector.vectorHash planVector.vectorHash bodyVector.vectorHash')
            .sort({ sourceType: 1, sourceId: 1 }).lean()
        return { corpusCount: entries.length, corpusHash: sha256(entries), indexVersion: INDEX_VERSION }
    }

    async comparePlans(plans = []) {
        const normalizedPlans = (Array.isArray(plans) ? plans : []).map((plan) => ({
            topic: String(plan?.topic || ''),
            angle: String(plan?.angle || ''),
            primaryQuestion: String(plan?.primaryQuestion || ''),
            supportingQuestions: Array.isArray(plan?.supportingQuestions) ? plan.supportingQuestions : [],
            searchIntent: String(plan?.searchIntent || '')
        }))
        if (!normalizedPlans.length) return []
        const entries = await this.IndexModel.find({ indexVersion: INDEX_VERSION, isQaTest: false })
            .select('+tokens +topicVector.values +planVector.values title sourceType sourceId primaryIntent sourceContentHash indexVersion')
            .lean()
        if (!entries.length) {
            const error = new Error('Novelty corpus is empty')
            error.code = 'NOVELTY_CORPUS_EMPTY'
            throw error
        }
        const vectors = await this.embeddingProvider.embedMany(normalizedPlans.flatMap((plan) => [
            [plan.topic, plan.angle, plan.searchIntent].join('\n'),
            [plan.angle, plan.primaryQuestion, plan.supportingQuestions.join('\n')].join('\n')
        ]))
        const manifest = await this.manifest()
        return normalizedPlans.map((plan, index) => {
            const candidateTokens = tokenizeVietnamese([
                plan.topic,
                plan.angle,
                plan.primaryQuestion,
                plan.supportingQuestions.join(' ')
            ].join(' '))
            const rows = entries.map((entry) => {
                const topicSimilarity = cosineSimilarity(vectors[index * 2], entry.topicVector?.values)
                const planSimilarity = cosineSimilarity(vectors[index * 2 + 1], entry.planVector?.values)
                if (topicSimilarity === null || planSimilarity === null) {
                    const error = new Error('Novelty corpus contains stale or missing embeddings')
                    error.code = 'NOVELTY_EMBEDDING_STALE'
                    throw error
                }
                return {
                    sourceType: entry.sourceType,
                    sourceId: String(entry.sourceId),
                    title: entry.title,
                    lexicalSimilarity: setSimilarity(ngrams(candidateTokens, 2), ngrams(entry.tokens || [], 2)),
                    topicSimilarity,
                    planSimilarity,
                    sameIntent: Boolean(
                        plan.searchIntent &&
                        entry.primaryIntent &&
                        normalizeText(plan.searchIntent) === normalizeText(entry.primaryIntent)
                    )
                }
            })
            const nearestFor = (key) => [...rows]
                .sort((left, right) => right[key] - left[key] || left.sourceId.localeCompare(right.sourceId))[0]
            return {
                ...manifest,
                comparedCount: rows.length,
                lexical: nearestFor('lexicalSimilarity'),
                topic: nearestFor('topicSimilarity'),
                plan: nearestFor('planSimilarity')
            }
        })
    }

    async comparePlan(plan = {}) {
        return (await this.comparePlans([plan]))[0]
    }

    async compareDraft({ title = '', contentHtml = '', searchIntent = '', excludeSourceIds = [] } = {}) {
        const excluded = new Set(excludeSourceIds.map(String))
        const entries = await this.IndexModel.find({ indexVersion: INDEX_VERSION, isQaTest: false })
            .select('+tokens +bodyChunks +bodyVector.values +chunkVectors.values title sourceType sourceId headings structure sourceContentHash')
            .lean()
        const corpus = entries.filter((entry) => !excluded.has(String(entry.sourceId)))
        if (!corpus.length) {
            const error = new Error('Draft originality corpus is empty')
            error.code = 'NOVELTY_CORPUS_EMPTY'
            throw error
        }
        const body = stripHtml(contentHtml)
        const headings = extractHeadings(contentHtml)
        const chunks = chunkText(contentHtml)
        const vectors = await this.embeddingProvider.embedMany([body.slice(0, 24_000), ...chunks])
        const candidateBodyVector = vectors[0]
        const candidateChunkVectors = vectors.slice(1)
        const candidateTokens = tokenizeVietnamese(`${title} ${body}`)
        const candidateStructure = {
            headingSequence: headings,
            headingCount: headings.length,
            paragraphCount: (String(contentHtml).match(/<p\b/gi) || []).length,
            listCount: (String(contentHtml).match(/<(?:ul|ol)\b/gi) || []).length,
            tableCount: (String(contentHtml).match(/<table\b/gi) || []).length
        }
        const rows = corpus.map((entry) => {
            const bodySimilarity = cosineSimilarity(candidateBodyVector, entry.bodyVector?.values)
            if (bodySimilarity === null) {
                const error = new Error('Novelty corpus contains stale draft embeddings')
                error.code = 'NOVELTY_EMBEDDING_STALE'
                throw error
            }
            const corpusChunks = (entry.chunkVectors || []).map((item) => item.values).filter((vector) => Array.isArray(vector) && vector.length)
            if (!corpusChunks.length) {
                const error = new Error('Novelty corpus contains stale chunk embeddings')
                error.code = 'NOVELTY_EMBEDDING_STALE'
                throw error
            }
            let chunkSimilarity = 0
            for (const candidate of candidateChunkVectors) {
                for (const existing of corpusChunks) chunkSimilarity = Math.max(chunkSimilarity, cosineSimilarity(candidate, existing) || 0)
            }
            const lexicalSimilarity = setSimilarity(ngrams(candidateTokens, 3), ngrams(entry.tokens || [], 3))
            const headingSimilarity = setSimilarity(headings.map(normalizeText), (entry.headings || []).map(normalizeText))
            const structureSimilarity = structuralSimilarity(candidateStructure, entry.structure || {})
            return {
                sourceType: entry.sourceType,
                sourceId: String(entry.sourceId),
                title: entry.title,
                lexicalSimilarity,
                bodySimilarity,
                chunkSimilarity,
                headingSimilarity,
                structureSimilarity,
                informationGainDifference: 1 - Math.max(bodySimilarity, chunkSimilarity)
            }
        })
        const nearest = (key) => [...rows].sort((a, b) => b[key] - a[key] || a.sourceId.localeCompare(b.sourceId))[0]
        const manifest = await this.manifest()
        return {
            ...manifest,
            comparedCount: rows.length,
            searchIntent,
            lexical: nearest('lexicalSimilarity'),
            body: nearest('bodySimilarity'),
            chunk: nearest('chunkSimilarity'),
            heading: nearest('headingSimilarity'),
            structure: nearest('structureSimilarity')
        }
    }
}

const structuralSimilarity = (left = {}, right = {}) => {
    const headingSimilarity = setSimilarity(left.headingSequence || [], right.headingSequence || right.headings || [])
    const proximity = (a, b) => {
        const maximum = Math.max(1, Number(a) || 0, Number(b) || 0)
        return 1 - Math.min(1, Math.abs((Number(a) || 0) - (Number(b) || 0)) / maximum)
    }
    return Number((
        headingSimilarity * 0.4 +
        proximity(left.headingCount, right.headingCount) * 0.2 +
        proximity(left.paragraphCount, right.paragraphCount) * 0.2 +
        proximity(left.listCount, right.listCount) * 0.1 +
        proximity(left.tableCount, right.tableCount) * 0.1
    ).toFixed(4))
}

module.exports = {
    BlogNoveltyIndexService,
    DEFAULT_EMBEDDING_MODEL,
    INDEX_VERSION,
    NON_INDEXABLE_ROADMAP_STATUSES,
    OpenAIEmbeddingProvider,
    TOKENIZER_VERSION,
    VALID_SCORE_HASH,
    buildIndexDocument,
    chunkText,
    cosineSimilarity,
    extractHeadings,
    frequencyMap,
    ngrams,
    isIndexableRoadmapItem,
    prepareIndexDocument,
    roadmapCorpusFilter,
    normalizeText,
    setSimilarity,
    sha256,
    sourcePayload,
    stripHtml,
    structuralSimilarity,
    tokenizeVietnamese
}
