import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { buildTopicResearchQueryPack } = require('../src/services/contentOperations/topicResearchQuery.service')
const { scoreSourceSignal } = require('../src/services/contentOperations/sourceRelevanceScoring.service')

const queryPack = buildTopicResearchQueryPack({
    direction: 'Đồ gia dụng bếp cho gia đình Việt',
    interpretation: { focusTerms: ['nồi inox', 'đồ gia dụng'], excludedTerms: [] },
    productCoverage: { cards: [{ name: 'Nồi inox 24 cm', categoryKey: 'Inoxs', materials: ['inox'], supportedUseCases: ['nấu canh'] }] }
})
const source = { sourceId: 'public', sourceName: 'Public source', status: 'available', canonicalUrl: 'https://example.com/' }
const signal = (topic, summary = '') => ({ sourceId: 'public', topic, summary, signalHash: topic })

describe('source relevance scoring', () => {
    it.each(['Tô Lâm', 'Phan Văn Giang', 'Vozinha', 'gpt', 'gemini ai', 'dự báo thời tiết tphcm', 'Hoạt động'])(
        'rejects unrelated discovery signal %s', (topic) => {
            const result = scoreSourceSignal({ signal: signal(topic), source, queryPack })
            expect(result.eligibleForIdeation).toBe(false)
            expect(result.rejectionReasons.length).toBeGreaterThan(0)
        }
    )

    it('accepts a direct relevant household-product observation', () => {
        const result = scoreSourceSignal({
            signal: signal('Cách vệ sinh nồi inox trong bếp gia đình', 'Bảo quản nồi inox sau khi nấu canh'),
            source,
            queryPack
        })
        expect(result.eligibleForIdeation).toBe(true)
        expect(result.matchedAnchors).toContain('nồi inox')
    })

    it('scores one precise product source against the best matching term in a mixed brief', () => {
        const mixedQueryPack = buildTopicResearchQueryPack({
            direction: 'Ưu tiên vợt muỗi INP7901 rồi nồi áp suất INP6903 cho gia đình Việt',
            interpretation: {
                focusTerms: ['Vợt muỗi điện INP7901', 'Nồi áp suất điện đa năng INP6903'],
                excludedTerms: []
            },
            productCoverage: {
                cards: [
                    { name: 'Vợt muỗi điện INP7901', category: { name: 'Vợt muỗi' } },
                    { name: 'Nồi áp suất điện đa năng INP6903', category: { name: 'Nồi áp suất' } }
                ]
            }
        })
        const result = scoreSourceSignal({
            signal: {
                sourceId: 'public',
                topic: 'Tại sao nên sở hữu nồi áp suất đa năng cho gia đình?',
                summary: 'Kinh nghiệm sử dụng nồi áp suất đúng cách và an toàn trong gia đình.',
                signalHash: 'pressure-cooker-source'
            },
            source,
            queryPack: mixedQueryPack
        })

        expect(mixedQueryPack.catalogFocusTerms).toEqual([
            'Vợt muỗi điện INP7901',
            'Nồi áp suất điện đa năng INP6903'
        ])
        expect(mixedQueryPack.queries.every((query) => !/inp(?:7901|6903)/i.test(query.queryText))).toBe(true)
        expect(mixedQueryPack.queries.some((query) => query.queryText.includes('vợt muỗi điện'))).toBe(true)
        expect(mixedQueryPack.queries.some((query) => query.queryText.includes('nồi áp suất điện đa năng'))).toBe(true)
        expect(mixedQueryPack.queries.every((query) => !(
            query.queryText.includes('vợt muỗi điện') && query.queryText.includes('nồi áp suất điện đa năng')
        ))).toBe(true)
        expect(result.scoreBreakdown.catalogOverlap).toBe(1)
        expect(result.totalScore).toBeGreaterThanOrEqual(0.58)
        expect(result.eligibleForIdeation).toBe(true)
    })
})
