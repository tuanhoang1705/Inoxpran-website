import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { applyProductSeedPlanToHtml } = require('../src/services/agenticBlogCore.service');
const { extractProductBlocks, reviewProductClaims, reviewProductLayer, reviewProductSeeding } = require('../src/services/productSeedingReview.service');

const plan = (overrides = {}) => ({
    _id: '507f1f77bcf86cd799439099', mode: 'auto', intensity: 'light', decision: 'contextual_seed',
    primaryProduct: {
        productId: '507f1f77bcf86cd799439011', name: 'Quạt tích điện mini', slug: 'quat-tich-dien-mini',
        canonicalUrl: '/product/quat-tich-dien-mini', relevanceScore: 0.9,
        allowedClaims: [
            { key: 'product_name', value: 'Quạt tích điện mini', source: 'product_name' },
            { key: 'power', value: '12W', source: 'product_attributes' },
            { key: 'feature', value: 'Pin sạc', source: 'product_attributes' }
        ]
    },
    supportingProducts: [],
    placementPlan: [{ productId: '507f1f77bcf86cd799439011', placementType: 'contextual_example' }],
    commercialDensityLimits: { maxProductMentions: 2, maxProductLinks: 1, maxProductHeadings: 0, maxCtaCount: 1 },
    ctaPlan: { mode: 'soft', maxCount: 1 },
    ...overrides
});
const baseArticle = `<article><p>Đây là phần trả lời vấn đề của người đọc trước khi giới thiệu bất kỳ lựa chọn nào.</p><h2>Tiêu chí khách quan</h2><p>${'Người đọc cần đối chiếu nhu cầu sử dụng và dữ liệu có thể kiểm tra. '.repeat(30)}</p><h2>Tình huống thực tế</h2><p>${'Hãy xem cách dùng, thời gian chăm sóc và giới hạn của từng lựa chọn. '.repeat(20)}</p><h2>Kết luận</h2><p>Ưu tiên thông tin rõ ràng.</p></article>`;

describe('Product claim and naturalness gates', () => {
    it('inserts only a planned semantic product block after objective content', () => {
        const html = applyProductSeedPlanToHtml({ html: baseArticle, plan: plan() });
        const blocks = extractProductBlocks(html);
        expect(blocks).toHaveLength(1);
        expect(blocks[0].productId).toBe('507f1f77bcf86cd799439011');
        expect(blocks[0].index).toBeGreaterThan(html.indexOf('<h2>Tiêu chí khách quan</h2>'));
        expect(reviewProductLayer({ html, plan: plan() }).pass).toBe(true);
    });

    it('passes a verified specification and rejects unsupported specifications', () => {
        const verified = applyProductSeedPlanToHtml({ html: baseArticle, plan: plan() });
        expect(reviewProductClaims({ html: verified, plan: plan() }).pass).toBe(true);
        const unsupported = verified.replace('12W', '99W');
        expect(reviewProductClaims({ html: unsupported, plan: plan() }).rejectedClaims.map((item) => item.code)).toContain('unsupported_specification');
    });

    it('rejects fake certification, absolute safety, stale price and availability claims', () => {
        const unsafe = applyProductSeedPlanToHtml({ html: baseArticle, plan: plan() }).replace('Đây là sản phẩm', 'Sản phẩm được chứng nhận ISO 9999, hoàn toàn an toàn, luôn sẵn hàng với giá 99.000đ. Đây là sản phẩm');
        const codes = reviewProductClaims({ html: unsafe, plan: plan() }).rejectedClaims.map((item) => item.code);
        expect(codes).toEqual(expect.arrayContaining(['unsupported_certification', 'absolute_safety', 'unsupported_price_claim', 'unsupported_availability_claim']));
    });

    it('blocks conflicting catalog evidence', () => {
        const conflictPlan = plan({ primaryProduct: { ...plan().primaryProduct, allowedClaims: [...plan().primaryProduct.allowedClaims, { key: 'power', value: '20W', source: 'product_attributes' }] } });
        const html = applyProductSeedPlanToHtml({ html: baseArticle, plan: conflictPlan });
        expect(reviewProductClaims({ html, plan: conflictPlan }).rejectedClaims.map((item) => item.code)).toContain('catalog_data_conflict');
    });

    it('rejects product-link spam, repeated product headings and sales-pitch openings', () => {
        let html = applyProductSeedPlanToHtml({ html: baseArticle, plan: plan() });
        html = html.replace('<article><p>', '<article><p>MUA NGAY GIÁ SỐC Quạt tích điện mini. ')
            .replace('<h2>Kết luận</h2>', '<h2>Quạt tích điện mini tốt nhất</h2>')
            .replace('</article>', '<a href="/product/quat-tich-dien-mini" data-link-type="product">Xem thông tin sản phẩm</a></article>');
        const review = reviewProductSeeding({ html, plan: plan() });
        expect(review.pass).toBe(false);
        expect(review.issues).toEqual(expect.arrayContaining(['product_heading_limit_exceeded', 'sales_pitch_opening']));
    });

    it('requires pure informational output when mode is off', () => {
        const offPlan = plan({ mode: 'off', decision: 'no_seed' });
        expect(reviewProductSeeding({ html: baseArticle, plan: offPlan }).pass).toBe(true);
        expect(reviewProductSeeding({ html: applyProductSeedPlanToHtml({ html: baseArticle, plan: plan() }), plan: offPlan }).pass).toBe(false);
    });
});
