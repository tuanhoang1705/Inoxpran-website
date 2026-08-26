import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const {
    buildProductSearchTokens,
    buildStrictProductSearchFilter,
    foldVietnameseText
} = require('../src/utils/productSearch.util')

describe('strict product search', () => {
    it('folds Vietnamese text for slug matching', () => {
        expect(foldVietnameseText('Chảo điện')).toBe('chao dien')
    })

    it('creates one required clause for every search word', () => {
        expect(buildProductSearchTokens('chảo gang')).toEqual([
            { raw: 'chảo', folded: 'chao' },
            { raw: 'gang', folded: 'gang' }
        ])

        const filter = buildStrictProductSearchFilter({
            baseFilter: { isPublished: true },
            searchTerm: 'chảo gang'
        })
        expect(filter.isPublished).toBe(true)
        expect(filter.$and).toHaveLength(2)
        expect(filter.$and[0].$or).toContainEqual({
            product_slug: { $regex: 'chao', $options: 'i' }
        })
        expect(filter.$and[1].$or).toContainEqual({
            product_slug: { $regex: 'gang', $options: 'i' }
        })
    })
})
