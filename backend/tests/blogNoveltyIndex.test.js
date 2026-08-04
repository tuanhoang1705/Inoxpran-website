import { describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
    BlogNoveltyIndexService,
    buildIndexDocument,
    cosineSimilarity,
    isIndexableRoadmapItem,
    ngrams,
    prepareIndexDocument,
    setSimilarity,
    tokenizeVietnamese
} = require('../src/services/contentOperations/blogNoveltyIndex.service')

const embeddingProvider = {
    provider: 'test',
    model: 'deterministic-test',
    embedMany: async (texts) => texts.map((text) => {
        const tokens = tokenizeVietnamese(text)
        return [tokens.length, tokens.filter((token) => token === 'đồ').length, tokens.filter((token) => token === 'inox').length]
    })
}

describe('full-corpus novelty index primitives', () => {
    it('preserves Vietnamese đ and accented vocabulary', () => {
        expect(tokenizeVietnamese('Đồ bếp bằng thép không gỉ')).toEqual(['đồ', 'bếp', 'bằng', 'thép', 'không', 'gỉ'])
    })

    it('does not mark two unrelated short texts as identical', () => {
        expect(setSimilarity(ngrams(['nồi'], 2), ngrams(['chảo'], 2))).toBe(0)
    })

    it('builds hash-addressed lexical and semantic records', async () => {
        const record = await buildIndexDocument({
            sourceType: 'blog',
            source: {
                _id: '66d0f5b5e3d6a4a1b2c3d401',
                blog_title: 'Đồ inox trong bếp',
                blog_excerpt: 'Hướng dẫn chọn nồi',
                blog_content: '<h2>Chọn vật liệu</h2><p>Gia đình cần đối chiếu nhu cầu.</p>',
                blog_tags: ['inox'],
                isQaTest: false
            },
            embeddingProvider,
            now: new Date('2026-07-25T00:00:00Z')
        })
        expect(record.tokens).toContain('đồ')
        expect(record.headings).toEqual(['Chọn vật liệu'])
        expect(record.sourceContentHash).toMatch(/^[a-f0-9]{64}$/)
        expect(record.topicVector.values).toHaveLength(3)
    })

    it('computes exact cosine similarity', () => {
        expect(cosineSimilarity([1, 0], [1, 0])).toBe(1)
        expect(cosineSimilarity([1, 0], [0, 1])).toBe(0)
    })

    it('only accepts roadmap sources that passed the immutable topic gate', () => {
        const passing = {
            status: 'dismissed',
            scores: {
                hardGatesPassed: true,
                totalScore: 82,
                noveltySubtotal: 48,
                scoreHash: 'a'.repeat(64)
            },
            marketEvidence: [{ evidenceId: 'market-1', contentHash: 'b'.repeat(64) }]
        }
        expect(isIndexableRoadmapItem(passing)).toBe(true)
        expect(isIndexableRoadmapItem({ ...passing, status: 'failed' })).toBe(false)
        expect(isIndexableRoadmapItem({ ...passing, status: 'invalidated' })).toBe(false)
        expect(isIndexableRoadmapItem({ status: 'dismissed', scores: {} })).toBe(false)
        expect(isIndexableRoadmapItem({
            status: 'ready',
            scores: {
                hardGatesPassed: true,
                totalScore: 82,
                noveltySubtotal: 48,
                scoreHash: 'legacy-score'
            },
            marketEvidence: passing.marketEvidence
        })).toBe(false)
    })

    it('prunes ineligible current-version sources and does not re-embed unchanged sources', async () => {
        const blog = {
            _id: '66d0f5b5e3d6a4a1b2c3d401',
            blog_title: 'Äá»“ inox trong báº¿p',
            blog_excerpt: 'HÆ°á»›ng dáº«n chá»n ná»“i',
            blog_content: '<h2>Chá»n váº­t liá»‡u</h2><p>Gia Ä‘Ã¬nh cáº§n Ä‘á»‘i chiáº¿u nhu cáº§u.</p>',
            blog_tags: ['inox'],
            isQaTest: false
        }
        const roadmap = {
            _id: '66d0f5b5e3d6a4a1b2c3d402',
            status: 'ready',
            topic: 'CÃ¡ch chá»n ná»“i inox theo nhu cáº§u',
            angle: 'Äá»‘i chiáº¿u váº­t liá»‡u vÃ  thá»i quen náº¥u.',
            primaryQuestion: 'Gia Ä‘Ã¬nh nÃªn chá»n nhÆ° tháº¿ nÃ o?',
            scores: {
                hardGatesPassed: true,
                totalScore: 84,
                noveltySubtotal: 55,
                scoreHash: 'b'.repeat(64)
            },
            marketEvidence: [{ evidenceId: 'market-1', contentHash: 'c'.repeat(64) }]
        }
        const unchanged = prepareIndexDocument({ sourceType: 'blog', source: blog })
        const query = (value) => ({
            select: vi.fn().mockReturnThis(),
            lean: vi.fn(async () => value)
        })
        const embedMany = vi.fn(embeddingProvider.embedMany)
        const IndexModel = {
            find: vi.fn(() => query([
                {
                    _id: 'index-blog',
                    sourceType: 'blog',
                    sourceId: blog._id,
                    sourceContentHash: unchanged.sourceContentHash,
                    tokenizerVersion: 'vi-unicode-v2',
                    topicVector: { vectorHash: 'topic' },
                    planVector: { vectorHash: 'plan' },
                    bodyVector: { vectorHash: 'body' },
                    chunkVectors: [{ vectorHash: 'chunk' }]
                },
                {
                    _id: 'index-dismissed-legacy',
                    sourceType: 'roadmap',
                    sourceId: '66d0f5b5e3d6a4a1b2c3d499',
                    sourceContentHash: 'stale'
                }
            ])),
            deleteMany: vi.fn(async () => ({ deletedCount: 1 })),
            findOneAndUpdate: vi.fn(async (_filter, update) => update.$set)
        }
        const BlogModel = { find: vi.fn(() => query([blog])) }
        const RoadmapItemModel = { find: vi.fn(() => query([roadmap])) }
        const service = new BlogNoveltyIndexService({
            IndexModel,
            BlogModel,
            RoadmapItemModel,
            embeddingProvider: { ...embeddingProvider, embedMany }
        })
        service.manifest = vi.fn(async () => ({
            corpusCount: 2,
            corpusHash: 'synchronized-corpus',
            indexVersion: 'blog-novelty-v2-2026-07-25'
        }))

        await expect(service.ensureCorpus()).resolves.toMatchObject({
            corpusCount: 2,
            corpusHash: 'synchronized-corpus',
            rebuilt: false,
            indexed: 1,
            created: 1,
            updated: 0,
            unchanged: 1,
            pruned: 1
        })
        expect(BlogModel.find).toHaveBeenCalledWith({ isQaTest: { $ne: true } })
        expect(RoadmapItemModel.find).toHaveBeenCalledWith(expect.objectContaining({
            status: { $nin: ['failed', 'invalidated'] },
            'scores.hardGatesPassed': true,
            'scores.totalScore': { $gte: 82 },
            'scores.noveltySubtotal': { $gte: 48 }
        }))
        expect(IndexModel.deleteMany).toHaveBeenCalledWith({
            _id: { $in: ['index-dismissed-legacy'] }
        })
        expect(IndexModel.findOneAndUpdate).toHaveBeenCalledTimes(1)
        expect(IndexModel.findOneAndUpdate.mock.calls[0][0]).toMatchObject({
            sourceType: 'roadmap',
            sourceId: roadmap._id
        })
        expect(embedMany).toHaveBeenCalledTimes(1)
    })

    it('updates a changed source while keeping every non-QA blog in the desired corpus', async () => {
        const blog = {
            _id: '66d0f5b5e3d6a4a1b2c3d410',
            blog_title: 'Báº£n nhÃ¡p há»¯u Ã­ch',
            blog_excerpt: 'Ná»™i dung má»›i',
            blog_content: '<p>Ná»™i dung báº£n nhÃ¡p váº«n pháº£i tham gia novelty corpus.</p>',
            blog_tags: [],
            isQaTest: false
        }
        const query = (value) => ({
            select: vi.fn().mockReturnThis(),
            lean: vi.fn(async () => value)
        })
        const embedMany = vi.fn(embeddingProvider.embedMany)
        const IndexModel = {
            find: vi.fn(() => query([{
                _id: 'index-blog',
                sourceType: 'blog',
                sourceId: blog._id,
                sourceContentHash: 'outdated-content-hash',
                tokenizerVersion: 'vi-unicode-v2',
                topicVector: { vectorHash: 'topic' },
                planVector: { vectorHash: 'plan' },
                bodyVector: { vectorHash: 'body' },
                chunkVectors: [{ vectorHash: 'chunk' }]
            }])),
            deleteMany: vi.fn(),
            findOneAndUpdate: vi.fn(async (_filter, update) => update.$set)
        }
        const service = new BlogNoveltyIndexService({
            IndexModel,
            BlogModel: { find: vi.fn(() => query([blog])) },
            RoadmapItemModel: { find: vi.fn(() => query([])) },
            embeddingProvider: { ...embeddingProvider, embedMany }
        })
        service.manifest = vi.fn(async () => ({
            corpusCount: 1,
            corpusHash: 'updated',
            indexVersion: 'blog-novelty-v2-2026-07-25'
        }))

        await expect(service.ensureCorpus()).resolves.toMatchObject({
            rebuilt: false,
            indexed: 1,
            created: 0,
            updated: 1,
            unchanged: 0,
            pruned: 0,
            corpusCount: 1
        })
        expect(IndexModel.deleteMany).not.toHaveBeenCalled()
        expect(IndexModel.findOneAndUpdate).toHaveBeenCalledTimes(1)
        expect(embedMany).toHaveBeenCalledTimes(1)
    })

    it('compares a candidate batch with one corpus read and one embedding call', async () => {
        const entries = [{
            sourceType: 'blog',
            sourceId: 'blog-1',
            title: 'Existing topic',
            primaryIntent: 'informational',
            tokens: ['existing', 'topic'],
            topicVector: { values: [1, 0] },
            planVector: { values: [0, 1] }
        }]
        const query = {
            select: vi.fn().mockReturnThis(),
            lean: vi.fn(async () => entries)
        }
        const embedMany = vi.fn(async (texts) => texts.map((_text, index) => (
            index % 2 === 0 ? [1, 0] : [0, 1]
        )))
        const service = new BlogNoveltyIndexService({
            IndexModel: { find: vi.fn(() => query) },
            BlogModel: {},
            RoadmapItemModel: {},
            embeddingProvider: { provider: 'test', model: 'test', embedMany }
        })
        service.manifest = vi.fn(async () => ({
            corpusCount: 1,
            corpusHash: 'corpus',
            indexVersion: 'blog-novelty-v2-2026-07-25'
        }))

        await expect(service.comparePlans([
            { topic: 'Candidate A', angle: 'Angle A', searchIntent: 'informational' },
            { topic: 'Candidate B', angle: 'Angle B', searchIntent: 'transactional' }
        ])).resolves.toEqual([
            expect.objectContaining({
                comparedCount: 1,
                topic: expect.objectContaining({ topicSimilarity: 1 }),
                plan: expect.objectContaining({ planSimilarity: 1 })
            }),
            expect.objectContaining({
                comparedCount: 1,
                topic: expect.objectContaining({ topicSimilarity: 1 }),
                plan: expect.objectContaining({ planSimilarity: 1 })
            })
        ])
        expect(query.lean).toHaveBeenCalledTimes(1)
        expect(embedMany).toHaveBeenCalledTimes(1)
        expect(embedMany.mock.calls[0][0]).toHaveLength(4)
        expect(service.manifest).toHaveBeenCalledTimes(1)
    })
})
