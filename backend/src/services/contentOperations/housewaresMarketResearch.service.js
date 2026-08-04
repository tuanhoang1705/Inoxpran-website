'use strict'

const crypto = require('node:crypto')
const net = require('node:net')
const sanitizeHtml = require('sanitize-html')
const { HousewaresMarketSnapshot } = require('../../models/housewaresMarketSnapshot.model')
const { safeSourceFetch } = require('../safeSourceFetch.service')
const { buildTopicResearchQueryPack } = require('./topicResearchQuery.service')
const { scoreSourceSignals } = require('./sourceRelevanceScoring.service')

const DEFAULT_TTL_SECONDS = 6 * 60 * 60
const DEFAULT_TIMEOUT_MS = 12_000
const DEFAULT_MAX_BYTES = 500_000
const DEFAULT_MAX_SIGNALS_PER_SOURCE = 12
const MAX_REGISTRY_SOURCES = 20
const MAX_PERSISTED_SOURCES = 50
const FIRECRAWL_SEARCH_ENDPOINT = 'https://api.firecrawl.dev/v2/search'
const DEFAULT_SEARCH_MAX_QUERIES = 2
const DEFAULT_SEARCH_RESULTS_PER_QUERY = 5
const DEFAULT_SEARCH_TIMEOUT_MS = 30_000
const DEFAULT_SEARCH_MAX_BYTES = 512_000
const MAX_SEARCH_QUERIES = 6
const MAX_SEARCH_RESULTS_PER_QUERY = 10
const SEARCH_QUERY_AXIS_PRIORITY = Object.freeze(['problem', 'care', 'demand', 'comparison', 'use_case', 'seasonal'])
const LOW_TRUST_EVIDENCE_DOMAINS = Object.freeze([
    'facebook.com', 'fb.com', 'instagram.com', 'threads.net', 'tiktok.com',
    'youtube.com', 'youtu.be', 'pinterest.com', 'x.com', 'twitter.com',
    'reddit.com', 'shopee.vn', 'shopee.com', 'lazada.vn', 'lazada.com',
    'tiki.vn', 'sendo.vn', 'chotot.com', 'baomoi.com', 'news.google.com', 'voz.vn'
])
const TRACKING_QUERY_PARAMETER = /^(?:utm_.+|gclid|dclid|fbclid|msclkid|srsltid|_gl|_ga|mc_cid|mc_eid|igshid)$/i

const DEFAULT_HOUSEWARES_SOURCES = Object.freeze([
    Object.freeze({
        id: 'google-trends-vn',
        name: 'Google Trends Vietnam',
        url: 'https://trends.google.com/trending/rss?geo=VN',
        expectedMode: 'rss'
    }),
    Object.freeze({
        id: 'vietnam-ministry-domestic-market',
        name: 'Vietnam Ministry of Industry and Trade - Domestic Market',
        url: 'https://moit.gov.vn/tin-tuc/thi-truong-trong-nuoc',
        expectedMode: 'html'
    }),
    Object.freeze({
        id: 'vietnam-trade-promotion',
        name: 'Vietnam Trade Promotion Agency',
        url: 'https://vietrade.gov.vn/',
        expectedMode: 'html'
    })
])

const text = (value, max = 1000) => String(value ?? '')
    .replace(new RegExp('[\u0000-\u001f\u007f]', 'g'), '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)

const uniqueList = (values, maxItems = 50) => Array.from(new Set(
    (Array.isArray(values) ? values : []).map((item) => text(item, 160)).filter(Boolean)
)).slice(0, maxItems)

const configuredSourceRegistry = (config = {}) => {
    if (Array.isArray(config.sources)) return config.sources
    if (Array.isArray(config.curatedSources)) return config.curatedSources
    if (Array.isArray(config.sourceRegistry)) return config.sourceRegistry
    return undefined
}

const configuredSourceUrls = (config = {}) => (
    config.sourceUrls ?? config.curatedSourceUrls ?? config.envSourceUrls ?? []
)

const resolveMarketConfig = (config = {}) => {
    const market = config?.market && typeof config.market === 'object' ? config.market : {}
    const marketWeb = market?.web && typeof market.web === 'object' ? market.web : {}
    const topicRoadmap = config?.topicRoadmap && typeof config.topicRoadmap === 'object'
        ? config.topicRoadmap
        : {}
    const topicMarket = topicRoadmap?.market && typeof topicRoadmap.market === 'object'
        ? topicRoadmap.market
        : topicRoadmap?.marketResearch && typeof topicRoadmap.marketResearch === 'object'
            ? topicRoadmap.marketResearch
            : {}
    const topicMarketWeb = topicMarket?.web && typeof topicMarket.web === 'object' ? topicMarket.web : {}
    const flattened = {
        ...config,
        ...market,
        ...marketWeb,
        ...topicMarket,
        ...topicMarketWeb
    }
    const configuredSearchProvider = flattened.searchProvider ?? flattened.marketSearchProvider
    return {
        enabled: flattened.enabled ?? flattened.marketEnabled ?? true,
        webEnabled: flattened.webEnabled ?? flattened.marketWebEnabled ?? true,
        sourceUrls: configuredSourceUrls(flattened),
        ttlSeconds: flattened.ttlSeconds ?? flattened.marketTtlSeconds ?? (
            Number.isFinite(Number(flattened.ttlHours)) ? Number(flattened.ttlHours) * 3600 : undefined
        ),
        timeoutMs: flattened.timeoutMs ?? flattened.requestTimeoutMs,
        maxBytes: flattened.maxBytes ?? flattened.maxResponseBytes,
        maxSignalsPerSource: flattened.maxSignalsPerSource ?? (
            Number.isFinite(Number(flattened.maxSignals)) && Number.isFinite(Number(flattened.maxSources))
                ? Math.ceil(Number(flattened.maxSignals) / Math.max(1, Number(flattened.maxSources)))
                : undefined
        ),
        maxSources: flattened.maxSources,
        maxSignals: flattened.maxSignals,
        // Preserve "not provided" as undefined. The static ensureSnapshot path
        // resolves the request-level config a second time; coercing a missing
        // provider to an empty string here would silently overwrite the
        // Firecrawl provider already resolved from the process environment.
        searchProvider: configuredSearchProvider == null
            ? undefined
            : text(configuredSearchProvider, 40).toLowerCase(),
        searchMaxQueries: flattened.searchMaxQueries ?? flattened.marketSearchMaxQueries,
        searchResultsPerQuery: flattened.searchResultsPerQuery ?? flattened.marketSearchResultsPerQuery,
        searchTimeoutMs: flattened.searchTimeoutMs ?? flattened.marketSearchTimeoutMs,
        searchMaxBytes: flattened.searchMaxBytes ?? flattened.marketSearchMaxBytes,
        sources: configuredSourceRegistry(flattened)
    }
}

const stableObject = (value) => {
    if (Array.isArray(value)) return value.map(stableObject)
    if (!value || typeof value !== 'object' || value instanceof Date) return value
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableObject(value[key])]))
}

const sha256 = (value) => crypto.createHash('sha256').update(
    typeof value === 'string' ? value : JSON.stringify(stableObject(value))
).digest('hex')

const validDate = (value) => {
    if (!value) return null
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
}

const clampedInteger = (value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return Math.max(min, Math.min(max, Math.trunc(parsed)))
}

const isPrivateIpv4 = (hostname) => {
    const parts = String(hostname || '').split('.').map(Number)
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true
    const [first, second] = parts
    return first === 0 || first === 10 || first === 127 ||
        (first === 100 && second >= 64 && second <= 127) ||
        (first === 169 && second === 254) ||
        (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && second === 0) ||
        (first === 192 && second === 168) ||
        (first === 198 && (second === 18 || second === 19)) ||
        first >= 224
}

const isPrivateIpv6 = (hostname) => {
    const normalized = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase()
    if (!normalized) return true
    if (normalized === '::' || normalized === '::1') return true
    if (normalized.startsWith('fc') || normalized.startsWith('fd') || /^fe[89ab]/.test(normalized)) return true
    const mappedIpv4 = normalized.match(/(?:^|:)ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1]
    return mappedIpv4 ? isPrivateIpv4(mappedIpv4) : false
}

const isLowTrustEvidenceDomain = (value) => {
    let hostname = String(value || '').trim().toLowerCase()
    try { hostname = new URL(hostname).hostname.toLowerCase() } catch (_error) {}
    hostname = hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '')
    return LOW_TRUST_EVIDENCE_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
}

const normalizePublicHttpsUrl = (value, { allowLowTrust = false } = {}) => {
    try {
        const parsed = new URL(String(value || ''))
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return ''
        const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase()
        if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) return ''
        const ipVersion = net.isIP(hostname)
        if (!ipVersion && (
            !hostname.includes('.') ||
            /\.(?:internal|local|lan|home|test|invalid)$/i.test(hostname)
        )) return ''
        if ((ipVersion === 4 && isPrivateIpv4(hostname)) || (ipVersion === 6 && isPrivateIpv6(hostname))) return ''
        if (!allowLowTrust && isLowTrustEvidenceDomain(hostname)) return ''
        parsed.hostname = hostname
        for (const key of [...parsed.searchParams.keys()]) {
            if (TRACKING_QUERY_PARAMETER.test(key)) parsed.searchParams.delete(key)
        }
        parsed.searchParams.sort()
        parsed.hash = ''
        return parsed.toString()
    } catch (_error) {
        return ''
    }
}

const safeSearchErrorCode = (error) => {
    const code = text(error?.code, 80)
    if (/^market_search_(?:timeout|unavailable|invalid_response|response_too_large|empty|unconfigured)$/.test(code)) return code
    if (/^market_search_http_(?:4\d\d|5\d\d)$/.test(code)) return code
    return 'market_search_unavailable'
}

const readBoundedResponseText = async (response, maxBytes = DEFAULT_SEARCH_MAX_BYTES) => {
    const limit = clampedInteger(maxBytes, DEFAULT_SEARCH_MAX_BYTES, { min: 1024, max: 2 * 1024 * 1024 })
    const declaredLength = Number(response?.headers?.get?.('content-length'))
    if (Number.isFinite(declaredLength) && declaredLength > limit) {
        throw Object.assign(new Error('Search response exceeded the configured size limit'), {
            code: 'market_search_response_too_large'
        })
    }
    if (!response?.body || typeof response.body.getReader !== 'function') {
        const body = await response.text()
        if (Buffer.byteLength(body, 'utf8') > limit) {
            throw Object.assign(new Error('Search response exceeded the configured size limit'), {
                code: 'market_search_response_too_large'
            })
        }
        return body
    }
    const reader = response.body.getReader()
    const chunks = []
    let bytes = 0
    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            bytes += value.byteLength
            if (bytes > limit) {
                throw Object.assign(new Error('Search response exceeded the configured size limit'), {
                    code: 'market_search_response_too_large'
                })
            }
            chunks.push(Buffer.from(value))
        }
    } finally {
        if (bytes > limit) await reader.cancel().catch(() => {})
    }
    return Buffer.concat(chunks).toString('utf8')
}

const decodeEntities = (value) => String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)))

const stripMarkup = (value, max = 20_000) => text(decodeEntities(sanitizeHtml(String(value || ''), {
    allowedTags: [],
    allowedAttributes: {}
})), max)

const firstMatch = (body, patterns, max = 300) => {
    for (const pattern of patterns) {
        const match = String(body || '').match(pattern)
        const found = stripMarkup(match?.[1] || '', max)
        if (found) return found
    }
    return ''
}

const extractTitle = (body, contentType = '') => firstMatch(body, [
    /<meta\b[^>]*(?:property|name)=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i,
    /<meta\b[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']og:title["'][^>]*>/i,
    /<title\b[^>]*>([\s\S]*?)<\/title>/i,
    /<(?:channel|feed)>[\s\S]*?<title\b[^>]*>([\s\S]*?)<\/title>/i
], 300) || (String(contentType).includes('json') ? text((() => {
    try {
        const parsed = JSON.parse(body)
        return parsed?.title || parsed?.name || ''
    } catch (_error) {
        return ''
    }
})(), 300) : '')

const extractSourceDates = (body) => {
    const published = firstMatch(body, [
        /<meta\b[^>]*(?:property|name)=["'](?:article:published_time|date|datePublished)["'][^>]*content=["']([^"']+)["']/i,
        /<(?:pubDate|published)\b[^>]*>([\s\S]*?)<\/(?:pubDate|published)>/i,
        /"datePublished"\s*:\s*"([^"]+)"/i
    ], 100)
    const updated = firstMatch(body, [
        /<meta\b[^>]*(?:property|name)=["'](?:article:modified_time|last-modified|dateModified)["'][^>]*content=["']([^"']+)["']/i,
        /<(?:updated|lastBuildDate)\b[^>]*>([\s\S]*?)<\/(?:updated|lastBuildDate)>/i,
        /"dateModified"\s*:\s*"([^"]+)"/i
    ], 100)
    return { publishedAt: validDate(published), updatedAt: validDate(updated) }
}

const sanitizeSnippet = (value, max = 600) => stripMarkup(value, max)

const signalTypeFor = (topic) => {
    const normalized = text(topic, 300).toLocaleLowerCase('vi')
    if (/\?|how|cách|lam sao|làm sao|what|why|vì sao/.test(normalized)) return 'question'
    if (/lỗi|vấn đề|khó|problem|mistake|issue|hỏng|an toàn/.test(normalized)) return 'problem'
    if (/mùa|tết|hè|đông|season|holiday/.test(normalized)) return 'seasonal'
    if (/nồi|chảo|bếp|inox|gang|điện|houseware|cookware|kitchen/.test(normalized)) return 'product_category'
    return 'topic'
}

const extractRssCandidates = (body) => {
    const output = []
    const itemPattern = /<(?:item|entry)\b[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi
    let match
    while ((match = itemPattern.exec(String(body || ''))) && output.length < 100) {
        const block = match[1]
        const topic = firstMatch(block, [/<title\b[^>]*>([\s\S]*?)<\/title>/i], 300)
        const snippet = firstMatch(block, [
            /<(?:description|summary|content(?::encoded)?)\b[^>]*>([\s\S]*?)<\/(?:description|summary|content(?::encoded)?)>/i
        ], 600)
        const date = firstMatch(block, [/<(?:pubDate|published|updated)\b[^>]*>([\s\S]*?)<\/(?:pubDate|published|updated)>/i], 100)
        if (topic) output.push({ topic, snippet, sourceDate: validDate(date) })
    }
    return output
}

const extractJsonCandidates = (body) => {
    try {
        const parsed = JSON.parse(body)
        const rows = Array.isArray(parsed)
            ? parsed
            : Array.isArray(parsed?.items)
                ? parsed.items
                : Array.isArray(parsed?.articles)
                    ? parsed.articles
                    : Array.isArray(parsed?.data)
                        ? parsed.data
                        : [parsed]
        return rows.slice(0, 100).map((item) => ({
            topic: text(item?.title || item?.name || item?.topic, 300),
            snippet: sanitizeSnippet(item?.description || item?.summary || item?.snippet, 600),
            sourceDate: validDate(item?.publishedAt || item?.published_at || item?.date || item?.updatedAt)
        })).filter((item) => item.topic)
    } catch (_error) {
        return []
    }
}

const extractHtmlCandidates = (body) => {
    const source = String(body || '')
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    const output = []
    const headingPattern = /<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi
    let match
    while ((match = headingPattern.exec(source)) && output.length < 100) {
        const topic = stripMarkup(match[2], 300)
        const after = source.slice(headingPattern.lastIndex, headingPattern.lastIndex + 2000)
        const snippet = firstMatch(after, [/<p\b[^>]*>([\s\S]*?)<\/p>/i], 600)
        if (topic) output.push({ topic, snippet, sourceDate: null })
    }
    if (!output.length) {
        const title = extractTitle(source, 'text/html')
        const description = firstMatch(source, [
            /<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i,
            /<meta\b[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i
        ], 600)
        if (title) output.push({ topic: title, snippet: description, sourceDate: null })
    }
    return output
}

const extractQualitativeSignals = ({ body = '', contentType = '', sourceId = '', sourceTitle = '', sourceDate = null, maxSignals = DEFAULT_MAX_SIGNALS_PER_SOURCE } = {}) => {
    const candidates = String(contentType).includes('rss') || String(contentType).includes('atom') || /<(?:rss|feed)\b/i.test(body)
        ? extractRssCandidates(body)
        : String(contentType).includes('json')
            ? extractJsonCandidates(body)
            : extractHtmlCandidates(body)
    const limit = Math.max(1, Math.min(50, Number(maxSignals) || DEFAULT_MAX_SIGNALS_PER_SOURCE))
    const seen = new Set()
    const signals = []
    for (const candidate of candidates) {
        const topic = text(candidate.topic, 300)
        const snippet = sanitizeSnippet(candidate.snippet, 600)
        const key = text(topic, 300).toLocaleLowerCase('vi')
        if (!topic || seen.has(key)) continue
        seen.add(key)
        const signal = {
            sourceId: text(sourceId, 120),
            type: signalTypeFor(topic),
            topic,
            summary: snippet,
            snippet,
            sourceTitle: text(sourceTitle, 300),
            sourceDate: candidate.sourceDate || sourceDate || null,
            confidence: snippet ? 'medium' : 'low',
            classification: 'observed'
        }
        signal.signalHash = sha256({
            sourceId: signal.sourceId,
            topic: signal.topic,
            snippet: signal.snippet,
            sourceDate: signal.sourceDate ? new Date(signal.sourceDate).toISOString() : null
        })
        signals.push(signal)
        if (signals.length >= limit) break
    }
    return signals
}

const normalizeRegistrySource = (source = {}, index = 0) => {
    const configuredMode = String(source.expectedMode || source.mode || '').toLowerCase()
    const mode = ['html', 'rss', 'json', 'text'].includes(configuredMode)
        ? configuredMode
        : 'html'
    try {
        const parsed = new URL(String(source.url || ''))
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null
        parsed.hash = ''
        return {
            id: text(source.id || `source-${index + 1}`, 120),
            name: text(source.name || parsed.hostname, 180),
            url: parsed.toString(),
            mode,
            enabled: source.enabled !== false
        }
    } catch (_error) {
        return null
    }
}

const sourceRegistry = ({ configuredSources = [], envSourceUrls = [], includeBuiltIns = true } = {}) => {
    const builtIn = includeBuiltIns
        ? DEFAULT_HOUSEWARES_SOURCES.map(normalizeRegistrySource).filter(Boolean)
        : []
    const configured = (Array.isArray(configuredSources) ? configuredSources : [])
        .map(normalizeRegistrySource)
        .filter(Boolean)
    const registryByUrl = new Map([...builtIn, ...configured].map((source) => [source.url, source]))
    const registryById = new Map([...registryByUrl.values()].map((source) => [source.id, source]))
    const selectedValues = Array.isArray(envSourceUrls)
        ? envSourceUrls
        : String(envSourceUrls || '').split(',').map((item) => item.trim()).filter(Boolean)
    const selectedExtensions = selectedValues.map((value) => {
        const byId = registryById.get(text(value, 120))
        if (byId) return byId
        const normalizedUrl = normalizeRegistrySource({ url: value })?.url
        if (normalizedUrl && registryByUrl.has(normalizedUrl)) return registryByUrl.get(normalizedUrl)
        return normalizeRegistrySource({
            id: `env-${sha256(value).slice(0, 16)}`,
            name: (() => {
                try { return new URL(String(value)).hostname }
                catch (_error) { return 'Configured market source' }
            })(),
            url: value,
            expectedMode: /(?:\.rss|\.xml)(?:$|\?)/i.test(String(value)) ? 'rss' : 'html'
        })
    }).filter(Boolean)
    return [...new Map([...builtIn, ...configured, ...selectedExtensions]
        .filter((source) => source.enabled)
        .map((source) => [source.url, source])).values()]
        .slice(0, MAX_REGISTRY_SOURCES)
}

const registryHashFor = (registry) => sha256((Array.isArray(registry) ? registry : []).map((source) => ({
    id: source.id,
    url: source.url,
    mode: source.mode
})))

const selectedSearchQueries = (queryPack = {}, maxQueries = DEFAULT_SEARCH_MAX_QUERIES) => {
    const limit = clampedInteger(maxQueries, DEFAULT_SEARCH_MAX_QUERIES, { min: 1, max: MAX_SEARCH_QUERIES })
    const priority = new Map(SEARCH_QUERY_AXIS_PRIORITY.map((axis, index) => [axis, index]))
    return (Array.isArray(queryPack.queries) ? queryPack.queries : [])
        .filter((query) => text(query?.queryId, 80) && text(query?.queryText, 500))
        .sort((left, right) => (
            (priority.get(left.axis) ?? SEARCH_QUERY_AXIS_PRIORITY.length) -
            (priority.get(right.axis) ?? SEARCH_QUERY_AXIS_PRIORITY.length)
        ))
        .slice(0, limit)
}

const firecrawlWebResults = (payload) => {
    const rows = Array.isArray(payload?.data?.web)
        ? payload.data.web
        : Array.isArray(payload?.data)
            ? payload.data
            : []
    return rows.filter((row) => row && typeof row === 'object')
}

const firecrawlEvidenceFor = ({ row = {}, query = {}, now = new Date() } = {}) => {
    const canonicalUrl = normalizePublicHttpsUrl(row.url)
    const topic = text(row.title || row.name, 300)
    const snippet = sanitizeSnippet(row.description || row.snippet || row.summary, 600)
    if (!canonicalUrl || !topic) return null
    const sourceId = `firecrawl-${sha256({ canonicalUrl, queryId: query.queryId }).slice(0, 32)}`
    const sourceDate = validDate(row.publishedDate || row.publishedAt || row.date || row.updatedAt)
    const contentHash = sha256({ canonicalUrl, topic, snippet, queryId: query.queryId, sourceDate })
    let sourceName = ''
    try { sourceName = new URL(canonicalUrl).hostname.replace(/^www\./, '') } catch (_error) {}
    const signal = {
        sourceId,
        type: signalTypeFor(`${topic} ${snippet}`),
        topic,
        summary: snippet,
        snippet,
        sourceTitle: topic,
        sourceDate,
        confidence: snippet ? 'medium' : 'low',
        classification: 'inferred',
        queryId: text(query.queryId, 80),
        canonicalUrl,
        signalHash: sha256({ sourceId, canonicalUrl, topic, snippet, queryId: query.queryId, sourceDate })
    }
    return {
        sourceRecord: {
            sourceId,
            sourceName: text(sourceName || 'Firecrawl web result', 180),
            canonicalUrl,
            mode: 'json',
            status: 'available',
            contentType: 'application/json',
            title: topic,
            publishedAt: sourceDate,
            updatedAt: null,
            fetchedAt: validDate(now) || new Date(),
            contentHash,
            etagHash: '',
            lastModified: '',
            signalCount: 1,
            errorCode: ''
        },
        signal
    }
}

const toPlain = (document) => typeof document?.toObject === 'function' ? document.toObject() : document

class HousewaresMarketResearchService {
    constructor({
        SnapshotModel = HousewaresMarketSnapshot,
        fetchSource = safeSourceFetch,
        fetchImpl = global.fetch,
        sources = DEFAULT_HOUSEWARES_SOURCES,
        config = {},
        env = process.env,
        now = () => new Date()
    } = {}) {
        this.SnapshotModel = SnapshotModel
        this.fetchSource = fetchSource
        this.fetchImpl = fetchImpl
        this.firecrawlApiKey = String(env?.FIRECRAWL_API_KEY || '').trim()
        const resolvedConfig = resolveMarketConfig({
            searchProvider: env?.OPENCLAW_MARKET_SEARCH_PROVIDER,
            searchMaxQueries: env?.OPENCLAW_MARKET_SEARCH_MAX_QUERIES,
            searchResultsPerQuery: env?.OPENCLAW_MARKET_SEARCH_RESULTS_PER_QUERY,
            searchTimeoutMs: env?.OPENCLAW_MARKET_SEARCH_TIMEOUT_MS,
            searchMaxBytes: env?.OPENCLAW_MARKET_SEARCH_MAX_RESPONSE_BYTES,
            ...config
        })
        this.sources = Array.isArray(sources) && sources !== DEFAULT_HOUSEWARES_SOURCES
            ? sources
            : Array.isArray(resolvedConfig.sources)
                ? resolvedConfig.sources
                : DEFAULT_HOUSEWARES_SOURCES
        this.config = {
            enabled: true,
            webEnabled: true,
            sourceUrls: [],
            ttlSeconds: DEFAULT_TTL_SECONDS,
            timeoutMs: DEFAULT_TIMEOUT_MS,
            maxBytes: DEFAULT_MAX_BYTES,
            maxSignalsPerSource: DEFAULT_MAX_SIGNALS_PER_SOURCE,
            searchProvider: '',
            searchMaxQueries: DEFAULT_SEARCH_MAX_QUERIES,
            searchResultsPerQuery: DEFAULT_SEARCH_RESULTS_PER_QUERY,
            searchTimeoutMs: DEFAULT_SEARCH_TIMEOUT_MS,
            searchMaxBytes: DEFAULT_SEARCH_MAX_BYTES,
            ...resolvedConfig
        }
        this.now = now
    }

    registry(config = this.config) {
        return sourceRegistry({
            configuredSources: this.sources,
            envSourceUrls: config.sourceUrls,
            includeBuiltIns: this.sources === DEFAULT_HOUSEWARES_SOURCES
        })
    }

    async searchFirecrawlQuery({ query, config, now }) {
        const failureRecord = (errorCode, extraWarnings = []) => ({
            sourceRecords: [{
                sourceId: `firecrawl-query-${text(query?.queryId, 80) || sha256(query).slice(0, 24)}`,
                sourceName: 'Firecrawl Search',
                canonicalUrl: FIRECRAWL_SEARCH_ENDPOINT,
                mode: 'json',
                status: 'failed',
                contentType: 'application/json',
                title: '',
                publishedAt: null,
                updatedAt: null,
                fetchedAt: now,
                contentHash: '',
                etagHash: '',
                lastModified: '',
                signalCount: 0,
                errorCode
            }],
            signals: [],
            warnings: uniqueList([
                ...extraWarnings,
                `${errorCode}:${text(query?.queryId, 80)}`
            ], 20)
        })
        if (!this.firecrawlApiKey) return failureRecord('market_search_unconfigured')
        if (typeof this.fetchImpl !== 'function') return failureRecord('market_search_unavailable')

        const timeoutMs = clampedInteger(config.searchTimeoutMs, DEFAULT_SEARCH_TIMEOUT_MS, { min: 1000, max: 60_000 })
        const resultLimit = clampedInteger(config.searchResultsPerQuery, DEFAULT_SEARCH_RESULTS_PER_QUERY, {
            min: 1,
            max: MAX_SEARCH_RESULTS_PER_QUERY
        })
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), timeoutMs)
        try {
            const response = await this.fetchImpl(FIRECRAWL_SEARCH_ENDPOINT, {
                method: 'POST',
                headers: {
                    accept: 'application/json',
                    authorization: `Bearer ${this.firecrawlApiKey}`,
                    'content-type': 'application/json'
                },
                body: JSON.stringify({
                    query: text(query.queryText, 500),
                    limit: resultLimit,
                    sources: ['web'],
                    country: text(query.country || 'VN', 12),
                    location: 'Vietnam',
                    timeout: timeoutMs,
                    ignoreInvalidURLs: true
                }),
                signal: controller.signal
            })
            if (!response?.ok) {
                const status = Number(response?.status)
                const safeStatus = Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500
                throw Object.assign(new Error('Market search request failed'), { code: `market_search_http_${safeStatus}` })
            }
            const body = await readBoundedResponseText(response, config.searchMaxBytes)
            let payload
            try { payload = JSON.parse(body) } catch (_error) {
                throw Object.assign(new Error('Market search returned invalid JSON'), { code: 'market_search_invalid_response' })
            }
            if (payload?.success === false) {
                throw Object.assign(new Error('Market search returned an unsuccessful response'), { code: 'market_search_invalid_response' })
            }
            let rejectedUrlCount = 0
            let rejectedLowTrustDomainCount = 0
            const evidenceByUrl = new Map()
            for (const row of firecrawlWebResults(payload).slice(0, resultLimit)) {
                const publicCandidate = normalizePublicHttpsUrl(row.url, { allowLowTrust: true })
                if (publicCandidate && isLowTrustEvidenceDomain(publicCandidate)) {
                    rejectedLowTrustDomainCount += 1
                    continue
                }
                const evidence = firecrawlEvidenceFor({ row, query, now })
                if (!evidence) {
                    rejectedUrlCount += 1
                    continue
                }
                if (!evidenceByUrl.has(evidence.sourceRecord.canonicalUrl)) {
                    evidenceByUrl.set(evidence.sourceRecord.canonicalUrl, evidence)
                }
            }
            const evidence = [...evidenceByUrl.values()]
            const rejectionWarnings = [
                ...(rejectedUrlCount ? [`market_search_results_rejected:${rejectedUrlCount}`] : []),
                ...(rejectedLowTrustDomainCount
                    ? [`market_search_low_trust_domains_rejected:${rejectedLowTrustDomainCount}`]
                    : [])
            ]
            if (!evidence.length) return failureRecord('market_search_empty', rejectionWarnings)
            return {
                sourceRecords: evidence.map((item) => item.sourceRecord),
                signals: evidence.map((item) => item.signal),
                warnings: rejectionWarnings
            }
        } catch (error) {
            const code = error?.name === 'AbortError' ? 'market_search_timeout' : safeSearchErrorCode(error)
            return failureRecord(code)
        } finally {
            clearTimeout(timeout)
        }
    }

    async findReusableSnapshot({ registryHash, now }) {
        if (!this.SnapshotModel || typeof this.SnapshotModel.findOne !== 'function') return null
        let query = this.SnapshotModel.findOne({
            registryHash,
            status: { $in: ['complete', 'partial'] },
            'signals.0': { $exists: true },
            expiresAt: { $gt: now }
        })
        if (typeof query?.sort === 'function') query = query.sort({ generatedAt: -1 })
        if (typeof query?.lean === 'function') query = query.lean()
        return query
    }

    async persist(document) {
        if (!this.SnapshotModel || typeof this.SnapshotModel.create !== 'function') return document
        return this.SnapshotModel.create(document)
    }

    async research({
        force = false,
        config = null,
        now: providedNow = null,
        direction = '',
        directionInterpretation = {},
        productCoverage = {},
        snapshot = {}
    } = {}) {
        const now = validDate(providedNow) || this.now()
        const resolvedOverrides = config && typeof config === 'object' ? resolveMarketConfig(config) : {}
        // Filter absent request fields before merging. Filtering the merged
        // object would first overwrite environment-derived values with
        // undefined and then delete them, which disabled Firecrawl only in the
        // real static ensureSnapshot/runtime path.
        const overrides = Object.fromEntries(Object.entries(resolvedOverrides)
            .filter(([, value]) => value !== undefined))
        const effectiveConfig = { ...this.config, ...overrides }
        const runtimeSources = Array.isArray(overrides.sources) ? overrides.sources : this.sources
        const registry = sourceRegistry({
            configuredSources: runtimeSources,
            envSourceUrls: effectiveConfig.sourceUrls,
            includeBuiltIns: this.sources === DEFAULT_HOUSEWARES_SOURCES || runtimeSources === DEFAULT_HOUSEWARES_SOURCES
        }).slice(0, Math.max(1, Math.min(MAX_REGISTRY_SOURCES, Number(effectiveConfig.maxSources) || MAX_REGISTRY_SOURCES)))
        const queryPack = buildTopicResearchQueryPack({
            direction,
            interpretation: directionInterpretation,
            productCoverage,
            snapshot,
            freshnessDays: Number(effectiveConfig.freshnessDays) || 90
        })
        const searchProvider = text(effectiveConfig.searchProvider, 40).toLowerCase()
        const searchEnabled = searchProvider === 'firecrawl'
        const searchQueries = searchEnabled
            ? selectedSearchQueries(queryPack, effectiveConfig.searchMaxQueries)
            : []
        const registryHash = sha256({
            registry: registryHashFor(registry),
            researchContext: queryPack.contextHash,
            search: {
                provider: searchProvider,
                endpoint: searchEnabled ? FIRECRAWL_SEARCH_ENDPOINT : '',
                maxQueries: searchQueries.length,
                resultsPerQuery: searchEnabled
                    ? clampedInteger(effectiveConfig.searchResultsPerQuery, DEFAULT_SEARCH_RESULTS_PER_QUERY, {
                        min: 1,
                        max: MAX_SEARCH_RESULTS_PER_QUERY
                    })
                    : 0
            }
        })
        const ttlSeconds = Math.max(60, Math.min(31_536_000, Number(effectiveConfig.ttlSeconds) || DEFAULT_TTL_SECONDS))
        if (!force) {
            const reusable = await this.findReusableSnapshot({ registryHash, now })
            if (reusable) return { ...reusable, evidenceStatus: 'ready', reused: true }
        }
        const expiresAt = new Date(now.getTime() + ttlSeconds * 1000)
        const sourceRecords = []
        const signals = []
        const querySignals = []
        const warnings = []

        if (!effectiveConfig.enabled || !effectiveConfig.webEnabled || (!registry.length && !searchQueries.length)) {
            const warning = !effectiveConfig.enabled
                ? 'market_research_disabled'
                : !effectiveConfig.webEnabled
                    ? 'market_web_research_disabled'
                    : searchProvider && !searchEnabled
                        ? 'market_search_provider_unsupported'
                        : 'market_source_registry_empty'
            const document = {
                status: 'failed',
                registryHash,
                snapshotHash: sha256({ registryHash, warning }),
                generatedAt: now,
                expiresAt,
                sourceHealth: { configured: registry.length + searchQueries.length, attempted: 0, succeeded: 0, failed: 0 },
                freshness: { checkedAt: now, newestSourceAt: null, oldestSourceAt: null, ttlSeconds, stale: false },
                sources: [],
                signals: [],
                warnings: [warning]
            }
            return { ...toPlain(await this.persist(document)), evidenceStatus: 'unavailable', reused: false }
        }

        const searchPromise = searchQueries.length
            ? Promise.all(searchQueries.map((query) => this.searchFirecrawlQuery({ query, config: effectiveConfig, now })))
            : Promise.resolve([])
        const settled = await Promise.all(registry.map(async (source) => {
            try {
                const fetched = await this.fetchSource({
                    url: source.url,
                    timeoutMs: effectiveConfig.timeoutMs,
                    maxBytes: effectiveConfig.maxBytes,
                    expectedMode: source.mode
                })
                const dates = extractSourceDates(fetched.body)
                const title = extractTitle(fetched.body, fetched.contentType)
                const sourceDate = dates.updatedAt || dates.publishedAt || validDate(fetched.lastModified)
                const extractedSignals = extractQualitativeSignals({
                    body: fetched.body,
                    contentType: fetched.contentType,
                    sourceId: source.id,
                    sourceTitle: title,
                    sourceDate,
                    maxSignals: effectiveConfig.maxSignalsPerSource
                })
                return {
                    sourceRecord: {
                        sourceId: source.id,
                        sourceName: source.name,
                        canonicalUrl: text(fetched.canonicalUrl || source.url, 1200),
                        mode: source.mode,
                        status: 'available',
                        contentType: text(fetched.contentType, 120),
                        title,
                        publishedAt: dates.publishedAt,
                        updatedAt: dates.updatedAt,
                        fetchedAt: validDate(fetched.fetchedAt) || now,
                        contentHash: sha256(fetched.body),
                        etagHash: fetched.etag ? sha256(fetched.etag) : '',
                        lastModified: text(fetched.lastModified, 160),
                        signalCount: extractedSignals.length,
                        errorCode: ''
                    },
                    signals: extractedSignals
                }
            } catch (error) {
                return {
                    sourceRecord: {
                        sourceId: source.id,
                        sourceName: source.name,
                        canonicalUrl: source.url,
                        mode: source.mode,
                        status: 'failed',
                        fetchedAt: now,
                        signalCount: 0,
                        errorCode: text(error?.code || error?.message || 'market_source_failed', 160)
                    },
                    signals: []
                }
            }
        }))

        const searched = await searchPromise
        settled.forEach((result) => {
            sourceRecords.push(result.sourceRecord)
            signals.push(...result.signals)
            if (result.sourceRecord.status === 'failed') warnings.push(`market_source_failed:${result.sourceRecord.sourceId}`)
        })
        const persistedSearchUrls = new Set()
        searched.forEach((result) => {
            result.sourceRecords.forEach((sourceRecord, index) => {
                if (sourceRecords.length >= MAX_PERSISTED_SOURCES) return
                if (sourceRecord.status === 'available' && persistedSearchUrls.has(sourceRecord.canonicalUrl)) return
                sourceRecords.push(sourceRecord)
                const signal = result.signals[index]
                if (signal) {
                    persistedSearchUrls.add(sourceRecord.canonicalUrl)
                    querySignals.push(signal)
                }
            })
            warnings.push(...result.warnings)
        })
        const totalSignalLimit = Math.min(
            200,
            Math.max(
                1,
                Number(effectiveConfig.maxSignals) ||
                registry.length * Math.max(
                    1,
                    Number(effectiveConfig.maxSignalsPerSource) || DEFAULT_MAX_SIGNALS_PER_SOURCE
                ) +
                searchQueries.length * clampedInteger(
                    effectiveConfig.searchResultsPerQuery,
                    DEFAULT_SEARCH_RESULTS_PER_QUERY,
                    { min: 1, max: MAX_SEARCH_RESULTS_PER_QUERY }
                )
            )
        )
        const rawSignals = [...querySignals, ...signals]
            .slice(0, totalSignalLimit)
            .map((signal) => ({ ...signal, queryId: text(signal.queryId, 80) }))
        const relevance = scoreSourceSignals({
            signals: rawSignals,
            sources: sourceRecords,
            queryPack,
            minScore: effectiveConfig.minRelevanceScore,
            now
        })
        const boundedSignals = relevance.accepted
        const rejectedSignals = relevance.rejected.slice(0, totalSignalLimit)
        const configured = registry.length + searchQueries.length
        const attempted = configured
        const succeeded = settled.filter((result) => result.sourceRecord.status === 'available').length +
            searched.filter((result) => result.signals.length > 0).length
        const failed = attempted - succeeded
        const dates = sourceRecords.flatMap((source) => [source.updatedAt, source.publishedAt, source.fetchedAt])
            .map(validDate)
            .filter(Boolean)
            .map((date) => date.getTime())
        const transportStatus = succeeded === attempted ? 'complete' : succeeded > 0 ? 'partial' : 'failed'
        const evidenceStatus = boundedSignals.length
            ? 'ready'
            : rawSignals.length
                ? 'insufficient'
                : 'empty'
        // Keep the persisted backwards-compatible status enum. A source fetch
        // that succeeded but yielded no eligible evidence is a safe partial
        // research result, not a transport/infrastructure failure.
        const status = boundedSignals.length
            ? transportStatus
            : succeeded > 0
                ? 'partial'
                : 'failed'
        const stableEvidence = {
            registryHash,
            status,
            sources: sourceRecords.map((source) => ({
                sourceId: source.sourceId,
                status: source.status,
                contentHash: source.contentHash || '',
                errorCode: source.errorCode || ''
            })),
            signals: boundedSignals.map((signal) => signal.signalHash),
            rejectedSignals: rejectedSignals.map((signal) => signal.signalHash)
        }
        const document = {
            status,
            registryHash,
            researchContextHash: queryPack.contextHash,
            queryVersion: queryPack.version,
            queries: queryPack.queries.map((query) => ({
                queryId: query.queryId,
                axis: query.axis,
                queryHash: query.queryHash
            })),
            snapshotHash: sha256(stableEvidence),
            generatedAt: now,
            expiresAt,
            sourceHealth: {
                configured,
                attempted,
                succeeded,
                failed
            },
            freshness: {
                checkedAt: now,
                newestSourceAt: dates.length ? new Date(Math.max(...dates)) : null,
                oldestSourceAt: dates.length ? new Date(Math.min(...dates)) : null,
                ttlSeconds,
                stale: false
            },
            sources: sourceRecords,
            signals: boundedSignals,
            rejectedSignals,
            relevanceVersion: relevance.version,
            warnings: uniqueList([
                ...warnings,
                ...(!boundedSignals.length ? ['market_no_eligible_signals'] : []),
                ...(evidenceStatus === 'insufficient' ? ['market_evidence_insufficient'] : []),
                ...(evidenceStatus === 'empty' ? ['market_evidence_empty'] : []),
                ...(rejectedSignals.length ? [`market_signals_rejected:${rejectedSignals.length}`] : [])
            ], 50)
        }
        return { ...toPlain(await this.persist(document)), evidenceStatus, reused: false }
    }

    async ensureSnapshot(options) {
        return this.research(options)
    }

    static async ensureSnapshot(options = {}) {
        return new HousewaresMarketResearchService({
            config: options.config || {},
            env: options.env || process.env,
            fetchImpl: options.fetchImpl || global.fetch,
            now: () => validDate(options.now) || new Date()
        }).research(options)
    }
}

const createHousewaresMarketResearchService = (options) => new HousewaresMarketResearchService(options)

module.exports = {
    DEFAULT_HOUSEWARES_SOURCES,
    DEFAULT_MAX_BYTES,
    DEFAULT_MAX_SIGNALS_PER_SOURCE,
    DEFAULT_SEARCH_MAX_BYTES,
    DEFAULT_SEARCH_MAX_QUERIES,
    DEFAULT_SEARCH_RESULTS_PER_QUERY,
    DEFAULT_SEARCH_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
    DEFAULT_TTL_SECONDS,
    FIRECRAWL_SEARCH_ENDPOINT,
    HousewaresMarketResearchService,
    LOW_TRUST_EVIDENCE_DOMAINS,
    TRACKING_QUERY_PARAMETER,
    createHousewaresMarketResearchService,
    decodeEntities,
    extractHtmlCandidates,
    extractJsonCandidates,
    extractQualitativeSignals,
    extractRssCandidates,
    extractSourceDates,
    extractTitle,
    firecrawlEvidenceFor,
    firecrawlWebResults,
    isPrivateIpv4,
    isPrivateIpv6,
    isLowTrustEvidenceDomain,
    normalizeRegistrySource,
    normalizePublicHttpsUrl,
    readBoundedResponseText,
    resolveMarketConfig,
    registryHashFor,
    sanitizeSnippet,
    sha256,
    signalTypeFor,
    selectedSearchQueries,
    sourceRegistry,
    stripMarkup,
    validDate
}
