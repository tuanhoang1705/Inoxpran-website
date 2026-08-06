import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { BlogDirectionInterpreterService } = require('../src/services/contentOperations/blogDirectionInterpreter.service')
const { buildTopicResearchQueryPack } = require('../src/services/contentOperations/topicResearchQuery.service')

const catalog = {
    products: [
        { productId: 'p1', name: 'Vợt muỗi thông minh INP7901', categoryKey: 'electronics' },
        { productId: 'p2', name: 'Nồi áp suất điện tử INP6903', categoryKey: 'cookware' }
    ]
}
const safeProducts = catalog.products

// The direction a real schedule was running with. It names no product: every
// clause is an operating rule.
const POLICY_ONLY_DIRECTION = 'Mỗi ngày tự chọn một sản phẩm đang xuất bản mà kho bài chưa bao phủ và tạo một bài hữu ích cho gia đình Việt; chỉ dùng bằng chứng nguồn đáng tin cậy, không lặp chủ đề, góc tiếp cận hay bài cũ.'

const NAMED_PRODUCT_DIRECTION = 'Ưu tiên vợt muỗi thông minh INP7901, nồi áp suất điện tử INP6903 rồi luân phiên sang sản phẩm khác.'

describe('direction focus terms', () => {
    it('does not turn operating policy into things to search the web for', async () => {
        const interpretation = await BlogDirectionInterpreterService.interpret({
            direction: POLICY_ONLY_DIRECTION,
            safeProducts,
            catalog,
            preferLlm: false
        })
        expect(interpretation.focusTerms).toEqual([])
        for (const term of interpretation.focusTerms) {
            expect(term).not.toMatch(/bằng chứng|không lặp|góc tiếp cận/i)
        }
    })

    it('leaves the catalog free to drive the queries when no subject was named', async () => {
        const interpretation = await BlogDirectionInterpreterService.interpret({
            direction: POLICY_ONLY_DIRECTION,
            safeProducts,
            catalog,
            preferLlm: false
        })
        const pack = buildTopicResearchQueryPack({
            direction: POLICY_ONLY_DIRECTION,
            interpretation,
            productCoverage: { cards: [{ productId: 'p1', name: 'Vợt muỗi thông minh INP7901' }] },
            snapshot: {}
        })
        const queries = (pack.queries || []).map((query) => query.queryText || '').join(' | ')
        expect(queries.length).toBeGreaterThan(0)
        expect(queries).not.toMatch(/đáng tin cậy|không lặp chủ đề|góc tiếp cận/i)
    })

    it('still keeps a named product as the focus', async () => {
        const interpretation = await BlogDirectionInterpreterService.interpret({
            direction: NAMED_PRODUCT_DIRECTION,
            safeProducts,
            catalog,
            preferLlm: false
        })
        expect(interpretation.focusTerms.join(' ')).toMatch(/INP7901|INP6903/)
    })

    it('keeps a household subject that is not a catalog entry', async () => {
        const interpretation = await BlogDirectionInterpreterService.interpret({
            direction: 'Viết về cách vệ sinh nồi và chảo inox trong gian bếp gia đình',
            safeProducts: [],
            catalog: { products: [] },
            preferLlm: false
        })
        expect(interpretation.focusTerms.length).toBeGreaterThan(0)
        expect(interpretation.focusTerms.join(' ')).toMatch(/nồi|chảo|inox|bếp/i)
    })
})
