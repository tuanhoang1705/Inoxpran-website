import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
    buildCoverage,
    buildProductCoverageCard,
    rotatePromptBatch
} = require('../src/services/contentOperations/productTopicCoverage.service')

const products = [
    {
        productId: '507f1f77bcf86cd799439011',
        sku: 'INOX-24',
        name: 'Nồi inox 24cm',
        slug: 'noi-inox-24',
        category: { id: 'Inoxs', name: 'Inox' },
        status: 'active',
        availability: 'in_stock',
        eligible: true,
        verifiedFeatures: ['Đáy nhiều lớp'],
        materials: ['Inox'],
        supportedUseCases: ['Nấu canh']
    },
    {
        productId: '507f1f77bcf86cd799439012',
        sku: 'GANG-26',
        name: 'Chảo gang 26cm',
        slug: 'chao-gang-26',
        category: { id: 'CastIrons', name: 'Gang' },
        status: 'active',
        availability: 'out_of_stock',
        eligible: false,
        rejectionReasons: ['out_of_stock'],
        verifiedFeatures: ['Giữ nhiệt'],
        materials: ['Gang']
    },
    {
        productId: '507f1f77bcf86cd799439013',
        sku: 'ELEC-01',
        name: 'Nồi áp suất điện',
        slug: 'noi-ap-suat-dien',
        category: { id: 'Electronics', name: 'Gia dụng điện' },
        status: 'inactive',
        availability: 'in_stock',
        eligible: false,
        verifiedFeatures: ['Hẹn giờ']
    }
]

const inventoryItems = [{
    blogId: 'blog-1',
    title: 'Cách chọn nồi inox cho gia đình',
    topicSummary: 'Nồi inox và đáy nhiều lớp',
    linkedProductIds: ['507f1f77bcf86cd799439011'],
    linkedProductSlugs: ['noi-inox-24']
}]

describe('product topic coverage', () => {
    it('builds deterministic safe per-SKU cards and coverage gaps', () => {
        const first = buildCoverage({ safeProducts: products, inventoryItems, generation: 0, limit: 2 })
        const second = buildCoverage({ safeProducts: [...products].reverse(), inventoryItems, generation: 0, limit: 2 })
        expect(first.coverageHash).toBe(second.coverageHash)
        expect(first.promptCards).toHaveLength(2)
        expect(first.cards.map((card) => card.sku)).toEqual(second.cards.map((card) => card.sku))
        expect(first.cards.find((card) => card.sku === 'INOX-24').coverage.directReferences).toBe(1)
        expect(first.cards.find((card) => card.sku === 'GANG-26').coverage.gapScore).toBeGreaterThan(0.5)
    })

    it('never marks out-of-stock or ineligible products product-led', () => {
        const outOfStock = buildProductCoverageCard({ product: products[1], inventoryItems: [] })
        const inactive = buildProductCoverageCard({ product: products[2], inventoryItems: [] })
        expect(outOfStock.productLedEligible).toBe(false)
        expect(outOfStock.suggestedScope).toBe('category')
        expect(inactive.productLedEligible).toBe(false)
    })

    it('references only safe facts and evidence hashes', () => {
        const sensitive = {
            ...products[0],
            product_shop: 'private-shop',
            product_reviews: [{ authorEmail: 'customer@example.com' }],
            margin: 0.9
        }
        const card = buildProductCoverageCard({ product: sensitive, inventoryItems: [] })
        expect(card.evidenceHash).toMatch(/^[a-f0-9]{64}$/)
        expect(JSON.stringify(card)).not.toContain('private-shop')
        expect(JSON.stringify(card)).not.toContain('customer@example.com')
        expect(JSON.stringify(card)).not.toContain('margin')
    })

    it('normalizes legacy object-shaped facts without stringifying objects', () => {
        const card = buildProductCoverageCard({
            product: {
                ...products[0],
                verifiedFeatures: [
                    { label: 'Đáy ba lớp', privateNote: 'hidden' },
                    { option: { value: 'Tay cầm cách nhiệt' } }
                ],
                materials: [{ material: 'Inox 304', margin: 0.9 }],
                supportedUseCases: [{ useCase: 'Nấu ăn gia đình' }]
            },
            inventoryItems: []
        })

        expect(card.safeFacts).toEqual(expect.arrayContaining([
            'label: Đáy ba lớp',
            'value: Tay cầm cách nhiệt',
            'material: Inox 304',
            'useCase: Nấu ăn gia đình'
        ]))
        expect(JSON.stringify(card)).not.toContain('[object Object]')
        expect(JSON.stringify(card)).not.toContain('hidden')
        expect(JSON.stringify(card)).not.toContain('margin')
    })

    it('rotates a bounded prompt batch deterministically by generation', () => {
        const coverage = buildCoverage({ safeProducts: products, inventoryItems: [], generation: 0, batchSize: 2 })
        const generation0 = rotatePromptBatch({ cards: coverage.cards, generation: 0, limit: 2 })
        const generation1 = rotatePromptBatch({ cards: coverage.cards, generation: 1, limit: 2 })
        expect(generation0).toHaveLength(2)
        expect(generation1).toHaveLength(2)
        expect(generation1[0].sku).not.toBe(generation0[0].sku)
        expect(rotatePromptBatch({ cards: coverage.cards, generation: 1, limit: 100 })).toHaveLength(3)
    })
})
