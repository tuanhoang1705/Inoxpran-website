import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { inferHeuristicInterpretation } = require('../src/services/contentOperations/blogDirectionInterpreter.service')
const {
    QUERY_VERSION,
    buildTopicResearchQueryPack,
    isLikelySku
} = require('../src/services/contentOperations/topicResearchQuery.service')

const productCoverage = {
    cards: [{
        name: 'Nồi inox 304 24cm',
        sku: 'INOX-24',
        category: { name: 'Nồi inox' },
        materials: ['inox 304'],
        supportedUseCases: ['nấu ăn gia đình']
    }]
}

describe('topic research query pack', () => {
    it('builds bounded household queries from stripped manager direction and catalog evidence', () => {
        const direction = 'Cho tôi chủ đề về gia dụng an toàn sức khỏe người Việt'
        const interpretation = inferHeuristicInterpretation({ direction, catalog: {} })
        const pack = buildTopicResearchQueryPack({ direction, interpretation, productCoverage })
        const problem = pack.queries.find((query) => query.axis === 'problem')

        const queryText = problem.queryText.toLocaleLowerCase('vi')
        expect(QUERY_VERSION).toContain('v4')
        expect(queryText).toContain('gia dụng an toàn sức khỏe người việt')
        expect(queryText).toContain('nồi inox')
        expect(queryText).toContain('có an toàn cho sức khỏe không')
        expect(problem.queryText).not.toContain('Cho tôi chủ đề về')
        expect(problem.queryId).toMatch(/^[a-f0-9]{24}$/)
    })

    it('uses verified catalog terms instead of generic catalog-management wording', () => {
        const direction = 'Các chủ đề xoay quanh các sản phẩm Inoxpran đang có'
        const interpretation = inferHeuristicInterpretation({ direction, catalog: {} })
        const pack = buildTopicResearchQueryPack({ direction, interpretation, productCoverage })

        expect(interpretation.focusTerms).toEqual([])
        expect(pack.queries.every((query) => query.queryText.toLocaleLowerCase('vi').includes('nồi inox'))).toBe(true)
        expect(pack.queries.every((query) => !query.queryText.includes('các sản phẩm Inoxpran đang có'))).toBe(true)
        expect(isLikelySku('INOX-24')).toBe(true)
        expect(isLikelySku('Nồi inox')).toBe(false)
    })

    it('gives each selected product family problem, care, and demand research within six searches', () => {
        const coverage = {
            cards: [
                { productId: '1', name: 'Vợt muỗi thông minh INP7901', sku: 'INP7901' },
                { productId: '2', name: 'Vợt muỗi thông minh INP7902', sku: 'INP7902' },
                { productId: '3', name: 'Nồi áp suất điện tử INP6903', sku: 'INP6903' }
            ]
        }
        const interpretation = {
            scopeMode: 'narrow',
            focusTerms: coverage.cards.map((card) => card.name),
            topicAxes: []
        }
        const pack = buildTopicResearchQueryPack({
            direction: 'Ưu tiên ba sản phẩm đã chọn',
            interpretation,
            productCoverage: coverage,
            maxQueries: 6
        })

        expect(pack.queries.map((query) => query.axis)).toEqual([
            'problem', 'problem', 'care', 'care', 'demand', 'demand'
        ])
        for (const axis of ['problem', 'care', 'demand']) {
            const queries = pack.queries
                .filter((query) => query.axis === axis)
                .map((query) => query.queryText.toLocaleLowerCase('vi'))
            expect(queries).toHaveLength(2)
            expect(queries.some((query) => query.includes('vợt muỗi'))).toBe(true)
            expect(queries.some((query) => query.includes('nồi áp suất'))).toBe(true)
            expect(queries.every((query) => !(query.includes('vợt muỗi') && query.includes('nồi áp suất')))).toBe(true)
        }
    })
})
