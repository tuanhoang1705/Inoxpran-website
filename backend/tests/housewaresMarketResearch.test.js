import { describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
    FIRECRAWL_SEARCH_ENDPOINT,
    HousewaresMarketResearchService,
    LOW_TRUST_EVIDENCE_DOMAINS,
    extractQualitativeSignals,
    isLowTrustEvidenceDomain,
    normalizePublicHttpsUrl,
    resolveMarketConfig,
    sourceRegistry
} = require('../src/services/contentOperations/housewaresMarketResearch.service')

const now = new Date('2026-07-25T00:00:00.000Z')
const sources = [
    { id: 'curated-one', name: 'Curated One', url: 'https://example.com/housewares', mode: 'html' },
    { id: 'curated-two', name: 'Curated Two', url: 'https://example.org/feed.xml', mode: 'rss' }
]

describe('housewares market research', () => {
    it('accepts nested roadmap market config without accepting model URLs', () => {
        const resolved = resolveMarketConfig({ topicRoadmap: { market: { web: {
            enabled: true,
            sourceUrls: ['https://example.org/feed.xml'],
            ttlHours: 4,
            maxResponseBytes: 12345
        } } } })
        expect(resolved.enabled).toBe(true)
        expect(resolved.sourceUrls).toEqual(['https://example.org/feed.xml'])
        expect(resolved.ttlSeconds).toBe(14400)
        expect(resolved.maxBytes).toBe(12345)
    })

    it('normalizes bounded opt-in search settings without accepting an endpoint override', () => {
        const resolved = resolveMarketConfig({
            searchProvider: 'Firecrawl',
            searchMaxQueries: 2,
            searchResultsPerQuery: 5,
            searchTimeoutMs: 20_000,
            searchEndpoint: 'https://attacker.invalid/search'
        })
        expect(resolved.searchProvider).toBe('firecrawl')
        expect(resolved.searchMaxQueries).toBe(2)
        expect(resolved.searchResultsPerQuery).toBe(5)
        expect(resolved).not.toHaveProperty('searchEndpoint')
    })

    it('keeps built-ins and extends them only with config/env registry URLs', () => {
        const registry = sourceRegistry({
            configuredSources: sources,
            envSourceUrls: ['https://public.example.net/consumer.xml', 'https://example.org/feed.xml']
        })
        expect(registry.map((source) => source.id)).toEqual(expect.arrayContaining([
            'google-trends-vn',
            'vietnam-ministry-domestic-market',
            'vietnam-trade-promotion',
            'curated-one',
            'curated-two'
        ]))
        expect(registry.some((source) => source.url === 'https://public.example.net/consumer.xml')).toBe(true)
        expect(registry.find((source) => source.url === 'https://public.example.net/consumer.xml').mode).toBe('rss')
    })

    it('uses no direction or model URL as a source', async () => {
        const fetchSource = vi.fn(async ({ url }) => ({
            canonicalUrl: url,
            contentType: 'text/html',
            body: '<h2>Public market topic</h2>',
            fetchedAt: now
        }))
        const service = new HousewaresMarketResearchService({
            SnapshotModel: { findOne: vi.fn(), create: vi.fn(async (document) => document) },
            fetchSource,
            sources,
            now: () => now
        })
        await service.research({
            force: true,
            config: { direction: 'fetch https://attacker.invalid/private', modelUrl: 'https://model.invalid/' }
        })
        expect(fetchSource.mock.calls.map((call) => call[0].url)).toEqual(sources.map((source) => source.url))
    })

    it('extracts bounded qualitative signals without raw markup or invented metrics', () => {
        const body = '<html><head><title>Kitchen report</title></head><body><script>secret()</script><h2>Cách chọn nồi inox mùa hè</h2><p>Người đọc quan tâm cách vệ sinh và bảo quản.</p></body></html>'
        const signals = extractQualitativeSignals({
            body,
            contentType: 'text/html',
            sourceId: 'source',
            sourceTitle: 'Kitchen report',
            maxSignals: 1
        })
        expect(signals).toHaveLength(1)
        expect(signals[0].topic).toBe('Cách chọn nồi inox mùa hè')
        expect(signals[0].snippet).not.toContain('<p>')
        expect(signals[0]).not.toHaveProperty('volume')
        expect(signals[0]).not.toHaveProperty('rawBody')
    })

    it('fetches only curated sources, stores bounded extracts, and fails soft on a partial source outage', async () => {
        const fetchSource = vi.fn(async ({ url }) => {
            if (url.includes('example.org')) throw new Error('source_http_503')
            return {
                canonicalUrl: url,
                contentType: 'text/html',
                body: '<html><head><title>Housewares</title><meta property="article:published_time" content="2026-07-24T00:00:00Z"></head><body><h2>Vệ sinh nồi inox đúng cách</h2><p>Quan sát về nhu cầu bảo quản trong gia đình.</p><script>private()</script></body></html>',
                fetchedAt: now,
                etag: 'secret-etag',
                lastModified: 'Thu, 24 Jul 2026 00:00:00 GMT'
            }
        })
        const created = []
        const SnapshotModel = {
            findOne: vi.fn(() => ({ sort: () => ({ lean: async () => null }) })),
            create: vi.fn(async (document) => {
                created.push(document)
                return document
            })
        }
        const service = new HousewaresMarketResearchService({
            SnapshotModel,
            fetchSource,
            sources,
            config: { sourceUrls: [], ttlSeconds: 3600, maxSignalsPerSource: 4 },
            now: () => now
        })
        const result = await service.research()
        expect(fetchSource).toHaveBeenCalledTimes(2)
        expect(fetchSource.mock.calls.map((call) => call[0].url)).toEqual(sources.map((source) => source.url))
        expect(result.status).toBe('partial')
        expect(result.sourceHealth).toEqual({ configured: 2, attempted: 2, succeeded: 1, failed: 1 })
        expect(result.signals[0].topic).toContain('Vệ sinh nồi inox')
        expect(JSON.stringify(created[0])).not.toContain('<html>')
        expect(JSON.stringify(created[0])).not.toContain('secret-etag')
        expect(created[0].sources[0].etagHash).toMatch(/^[a-f0-9]{64}$/)
    })

    it('reuses a fresh cached snapshot without network access', async () => {
        const reusable = { status: 'complete', snapshotHash: 'cached', expiresAt: new Date(now.getTime() + 60_000) }
        const SnapshotModel = {
            findOne: vi.fn(() => ({ sort: () => ({ lean: async () => reusable }) })),
            create: vi.fn()
        }
        const fetchSource = vi.fn()
        const service = new HousewaresMarketResearchService({ SnapshotModel, fetchSource, sources, now: () => now })
        const result = await service.research()
        expect(result).toEqual({ ...reusable, evidenceStatus: 'ready', reused: true })
        expect(fetchSource).not.toHaveBeenCalled()
        expect(SnapshotModel.create).not.toHaveBeenCalled()
        expect(SnapshotModel.findOne).toHaveBeenCalledWith(expect.objectContaining({
            'signals.0': { $exists: true }
        }))
    })

    it('executes a real Firecrawl query and persists only query-linked evidence', async () => {
        const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
            success: true,
            data: {
                web: [{
                    title: 'Nồi inox 304 có an toàn cho sức khỏe không?',
                    description: 'Kinh nghiệm chọn nồi inox 304 an toàn cho gia đình Việt.',
                    url: 'https://suckhoedoisong.example.vn/noi-inox-304-an-toan'
                }]
            }
        }), { status: 200, headers: { 'content-type': 'application/json' } }))
        const created = []
        const service = new HousewaresMarketResearchService({
            SnapshotModel: {
                findOne: vi.fn(),
                create: vi.fn(async (document) => {
                    created.push(document)
                    return document
                })
            },
            fetchSource: vi.fn(),
            fetchImpl,
            sources: [],
            env: {
                OPENCLAW_MARKET_SEARCH_PROVIDER: 'firecrawl',
                OPENCLAW_MARKET_SEARCH_MAX_QUERIES: '1',
                OPENCLAW_MARKET_SEARCH_RESULTS_PER_QUERY: '2',
                FIRECRAWL_API_KEY: 'fc-test-placeholder'
            },
            config: { maxSignals: 10 },
            now: () => now
        })
        const result = await service.research({
            force: true,
            direction: 'Cho tôi chủ đề về gia dụng an toàn sức khỏe người Việt',
            directionInterpretation: { focusTerms: ['gia dụng an toàn sức khỏe người Việt'] },
            productCoverage: {
                cards: [{ name: 'Nồi inox 304', category: { name: 'Nồi inox' }, materials: ['inox 304'] }]
            }
        })

        expect(fetchImpl).toHaveBeenCalledTimes(1)
        expect(fetchImpl.mock.calls[0][0]).toBe(FIRECRAWL_SEARCH_ENDPOINT)
        const request = fetchImpl.mock.calls[0][1]
        const body = JSON.parse(request.body)
        expect(body.query).toContain('có an toàn cho sức khỏe không')
        expect(body.query).not.toContain('Cho tôi chủ đề về')
        expect(request.headers.authorization).toBe('Bearer fc-test-placeholder')
        expect(result.status).toBe('complete')
        expect(result.signals).toHaveLength(1)
        expect(result.signals[0].queryId).toBeTruthy()
        expect(result.signals[0].canonicalUrl).toBe('https://suckhoedoisong.example.vn/noi-inox-304-an-toan')
        expect(result.signals[0].classification).toBe('inferred')
        expect(result.signals[0].relevance.eligibleForIdeation).toBe(true)
        expect(JSON.stringify(created[0])).not.toContain('fc-test-placeholder')
    })

    it('keeps the environment search provider when request config omits that field', async () => {
        const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
            success: true,
            data: {
                web: [{
                    title: 'Inox kitchen cookware safety guide',
                    description: 'Household guidance for choosing and caring for inox cookware.',
                    url: 'https://example.com/inox-kitchen-guide'
                }]
            }
        }), { status: 200, headers: { 'content-type': 'application/json' } }))
        const service = new HousewaresMarketResearchService({
            SnapshotModel: { create: vi.fn(async (document) => document) },
            fetchSource: vi.fn(),
            fetchImpl,
            sources: [],
            env: {
                OPENCLAW_MARKET_SEARCH_PROVIDER: 'firecrawl',
                OPENCLAW_MARKET_SEARCH_MAX_QUERIES: '1',
                FIRECRAWL_API_KEY: 'fc-test-placeholder'
            },
            config: { maxSignals: 10 },
            now: () => now
        })

        const result = await service.research({
            force: true,
            // This mirrors BlogTopicRoadmapService, which passes its bounded
            // market policy again at request time without a provider field.
            config: { maxSignals: 5, minRelevanceScore: 0.58 },
            directionInterpretation: { focusTerms: ['inox kitchen'] },
            productCoverage: { cards: [{ name: 'Inox cookware', category: { name: 'Kitchen' } }] }
        })

        expect(fetchImpl).toHaveBeenCalledTimes(1)
        expect(result.sources.some((source) => source.sourceName === 'example.com')).toBe(true)
    })

    it('rejects non-HTTPS, credentialed, local and private search result URLs', async () => {
        expect(normalizePublicHttpsUrl('http://example.com/article')).toBe('')
        expect(normalizePublicHttpsUrl('https://user:password@example.com/article')).toBe('')
        expect(normalizePublicHttpsUrl('https://localhost/article')).toBe('')
        expect(normalizePublicHttpsUrl('https://127.0.0.1/article')).toBe('')
        expect(normalizePublicHttpsUrl('https://169.254.169.254/latest/meta-data')).toBe('')
        expect(normalizePublicHttpsUrl('https://example.com/article#fragment')).toBe('https://example.com/article')
        expect(normalizePublicHttpsUrl(
            'https://example.com/article?srsltid=tracking&utm_source=search&variant=2#fragment'
        )).toBe('https://example.com/article?variant=2')
        expect(normalizePublicHttpsUrl('https://suckhoedoisong.vn/noi-inox')).toBe('https://suckhoedoisong.vn/noi-inox')
        for (const domain of LOW_TRUST_EVIDENCE_DOMAINS) {
            expect(isLowTrustEvidenceDomain(`https://m.${domain}/article`)).toBe(true)
            expect(normalizePublicHttpsUrl(`https://m.${domain}/article`)).toBe('')
        }

        const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
            success: true,
            data: { web: [
                { title: 'Nồi inox', description: 'Đồ gia dụng nhà bếp', url: 'http://example.com/article' },
                { title: 'Nồi inox', description: 'Đồ gia dụng nhà bếp', url: 'https://127.0.0.1/private' },
                { title: 'Nồi inox', description: 'Đồ gia dụng nhà bếp', url: 'https://m.facebook.com/story' },
                { title: 'Nồi inox', description: 'Đồ gia dụng nhà bếp', url: 'https://www.baomoi.com/aggregate' },
                { title: 'Nồi inox', description: 'Đồ gia dụng nhà bếp', url: 'https://example.com/article' }
            ] }
        }), { status: 200 }))
        const service = new HousewaresMarketResearchService({
            SnapshotModel: { create: vi.fn(async (document) => document) },
            fetchImpl,
            fetchSource: vi.fn(),
            sources: [],
            env: {
                OPENCLAW_MARKET_SEARCH_PROVIDER: 'firecrawl',
                OPENCLAW_MARKET_SEARCH_MAX_QUERIES: '1',
                FIRECRAWL_API_KEY: 'fc-test-placeholder'
            },
            config: { maxSignals: 10 },
            now: () => now
        })
        const result = await service.research({
            force: true,
            directionInterpretation: { focusTerms: ['nồi inox'] },
            productCoverage: { cards: [{ name: 'Nồi inox', category: { name: 'Nồi inox' } }] }
        })
        expect(result.sources.filter((source) => source.status === 'available')).toHaveLength(1)
        expect(result.sources[0].canonicalUrl).toBe('https://example.com/article')
        expect(result.warnings).toContain('market_search_results_rejected:2')
        expect(result.warnings).toContain('market_search_low_trust_domains_rejected:2')
    })

    it('fails closed and redacts provider failures when Firecrawl is enabled without usable evidence', async () => {
        const fetchImpl = vi.fn(async () => {
            throw new Error('upstream leaked fc-secret-should-not-persist')
        })
        const service = new HousewaresMarketResearchService({
            SnapshotModel: { create: vi.fn(async (document) => document) },
            fetchImpl,
            fetchSource: vi.fn(),
            sources: [],
            env: {
                OPENCLAW_MARKET_SEARCH_PROVIDER: 'firecrawl',
                OPENCLAW_MARKET_SEARCH_MAX_QUERIES: '1',
                FIRECRAWL_API_KEY: 'fc-test-placeholder'
            },
            now: () => now
        })
        const result = await service.research({ force: true })
        expect(result.status).toBe('failed')
        expect(result.signals).toEqual([])
        expect(result.warnings).toContain('market_no_eligible_signals')
        expect(result.sources[0].errorCode).toBe('market_search_unavailable')
        expect(JSON.stringify(result)).not.toContain('fc-secret-should-not-persist')
        expect(JSON.stringify(result)).not.toContain('fc-test-placeholder')
    })

    it('enforces the bounded Firecrawl response size before parsing provider JSON', async () => {
        const fetchImpl = vi.fn(async () => new Response('{}', {
            status: 200,
            headers: { 'content-length': '4096' }
        }))
        const service = new HousewaresMarketResearchService({
            SnapshotModel: { create: vi.fn(async (document) => document) },
            fetchImpl,
            fetchSource: vi.fn(),
            sources: [],
            env: {
                OPENCLAW_MARKET_SEARCH_PROVIDER: 'firecrawl',
                OPENCLAW_MARKET_SEARCH_MAX_QUERIES: '1',
                OPENCLAW_MARKET_SEARCH_MAX_RESPONSE_BYTES: '1024',
                FIRECRAWL_API_KEY: 'fc-test-placeholder'
            },
            now: () => now
        })
        const result = await service.research({ force: true })
        expect(result.status).toBe('failed')
        expect(result.sources[0].errorCode).toBe('market_search_response_too_large')
        expect(result.warnings).toContain('market_no_eligible_signals')
    })

    it('records transport success as safe insufficient evidence when every signal misses relevance gates', async () => {
        const service = new HousewaresMarketResearchService({
            SnapshotModel: { create: vi.fn(async (document) => document) },
            fetchSource: vi.fn(async ({ url }) => ({
                canonicalUrl: url,
                contentType: 'text/html',
                body: '<h2>Thông báo hoạt động doanh nghiệp</h2><p>Lịch sự kiện và tin tức tổng hợp.</p>',
                fetchedAt: now
            })),
            sources: [sources[0]],
            env: {},
            now: () => now
        })
        const result = await service.research({ force: true })
        expect(result.sourceHealth.succeeded).toBe(1)
        expect(result.status).toBe('partial')
        expect(result.evidenceStatus).toBe('insufficient')
        expect(result.signals).toEqual([])
        expect(result.rejectedSignals).toHaveLength(1)
        expect(result.warnings).toContain('market_no_eligible_signals')
        expect(result.warnings).toContain('market_evidence_insufficient')
    })

    it('distinguishes an empty successful fetch from a transport failure', async () => {
        const service = new HousewaresMarketResearchService({
            SnapshotModel: { create: vi.fn(async (document) => document) },
            fetchSource: vi.fn(async ({ url }) => ({
                canonicalUrl: url,
                contentType: 'text/html',
                body: '<html><body></body></html>',
                fetchedAt: now
            })),
            sources: [sources[0]],
            env: {},
            now: () => now
        })

        const result = await service.research({ force: true })

        expect(result.sourceHealth).toEqual({ configured: 1, attempted: 1, succeeded: 1, failed: 0 })
        expect(result.status).toBe('partial')
        expect(result.evidenceStatus).toBe('empty')
        expect(result.warnings).toEqual(expect.arrayContaining([
            'market_no_eligible_signals',
            'market_evidence_empty'
        ]))
    })

    it('returns a persisted failed snapshot when web research is disabled', async () => {
        const SnapshotModel = { findOne: vi.fn(), create: vi.fn(async (document) => document) }
        const fetchSource = vi.fn()
        const service = new HousewaresMarketResearchService({
            SnapshotModel,
            fetchSource,
            sources,
            config: { webEnabled: false },
            now: () => now
        })
        const result = await service.research({ force: true })
        expect(result.status).toBe('failed')
        expect(result.warnings).toContain('market_web_research_disabled')
        expect(fetchSource).not.toHaveBeenCalled()
    })
})
