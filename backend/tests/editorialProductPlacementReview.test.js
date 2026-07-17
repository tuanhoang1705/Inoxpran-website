import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { applyEditorialProductPlacementPlanToHtml } = require('../src/services/editorialProductPlacement.service');
const { reviewEditorialProductPlacement } = require('../src/services/editorialProductPlacementReview.service');

const productSeedPlan = {
    decision: 'contextual_seed', mode: 'auto', intensity: 'light',
    primaryProduct: {
        productId: '507f1f77bcf86cd799439032', name: 'Quạt tích điện mini', canonicalUrl: '/product/quat-tich-dien-mini', relevanceScore: 0.92,
        allowedClaims: [{ key: 'feature', value: 'Pin sạc', source: 'product_attributes' }]
    },
    supportingProducts: [],
    commercialDensityLimits: { maxProductMentions: 2, maxProductLinks: 1, maxProductHeadings: 0, maxCtaCount: 1 }
};
const placementPlan = (overrides = {}) => ({
    decision: 'place_product', placementStyle: 'criteria-first-recommendation', ownedProductPositionPolicy: 'none',
    firstProductMention: { minimumSectionsBeforeProduct: 2, minimumWordsBeforeProduct: 350, minimumProgressPercent: 35, introAllowed: false },
    placementSequence: [{ placementId: 'editorial-placement-1', productId: productSeedPlan.primaryProduct.productId, sectionKey: 'product-context-1', sectionPurpose: 'Apply criteria', presentation: 'recommendation', commercialRole: 'primary-owned-example', rankPosition: 'none', afterMinimumSection: 2, linkAllowed: true, ctaAllowed: true }],
    rankingStrategy: { enabled: false, methodologyRequired: false, middleForbidden: true },
    commercialDensity: { maxBlocks: 1, maxCtaCount: 1, allowConsecutiveProductBlocks: false, allowConsecutiveProductImages: false },
    visualPlacement: { firstImageMustBeEditorial: true, consecutiveProductImagesAllowed: false },
    disclosure: { required: true, text: 'Minh bạch: sản phẩm này thuộc INOXPRAN và chỉ là ví dụ đối chiếu.' },
    ctaStrategy: { maxCount: 1 }, rankingClaimReview: { claimDetected: false, evidenceRequired: true, evidenceValid: false, safeTitleRewriteApplied: false },
    ...overrides
});
const article = `<article><p>${'Người đọc cần xác định vấn đề, bối cảnh và giới hạn trước khi cân nhắc bất kỳ lựa chọn nào. '.repeat(8)}</p>${Array.from({ length: 5 }, (_, index) => `<section><h2>Mục hướng dẫn ${index + 1}</h2><p>${'Nội dung độc lập giải thích tiêu chí, cách kiểm tra, giới hạn và tình huống sử dụng thực tế. '.repeat(15)}</p></section>`).join('')}</article>`;

describe('Editorial Product Placement deterministic review', () => {
    it('applies a planned placement after section/word/progress thresholds and preserves independent value', () => {
        const plan = placementPlan();
        const html = applyEditorialProductPlacementPlanToHtml({ html: article, productSeedPlan, placementPlan: plan });
        const review = reviewEditorialProductPlacement({ html, productSeedPlan, placementPlan: plan });
        expect(review.pass).toBe(true);
        expect(review.firstProductMention).toMatchObject({ found: true, inIntroduction: false });
        expect(review.firstProductMention.sectionCountBefore).toBeGreaterThanOrEqual(2);
        expect(review.firstProductMention.wordsBefore).toBeGreaterThanOrEqual(350);
        expect(review.independentValueReview.pass).toBe(true);
    });

    it('blocks early introduction placement and unplanned placement/product IDs', () => {
        const plan = placementPlan();
        const valid = applyEditorialProductPlacementPlanToHtml({ html: article, productSeedPlan, placementPlan: plan });
        const match = valid.match(/<aside[^>]*>[\s\S]*?<\/aside><section[^>]*data-block-type="product-recommendation"[\s\S]*?<\/section>/i);
        const early = valid.replace(match[0], '').replace('<article>', `<article>${match[0]}`)
            .replace('data-placement-id="editorial-placement-1"', 'data-placement-id="rogue-placement"')
            .replace(productSeedPlan.primaryProduct.productId, '507f1f77bcf86cd799439099');
        const review = reviewEditorialProductPlacement({ html: early, productSeedPlan, placementPlan: plan });
        expect(review.pass).toBe(false);
        expect(review.riskLevel).toBe('critical');
        expect(review.issues).toEqual(expect.arrayContaining(['product_mentioned_in_intro', 'unplanned_placement_id:rogue-placement', 'unplanned_product_id:507f1f77bcf86cd799439099']));
    });

    it('rejects owned product in the middle and requires ranking methodology', () => {
        const plan = placementPlan({
            placementStyle: 'ranked-list-owned-first', ownedProductPositionPolicy: 'first',
            placementSequence: [{ ...placementPlan().placementSequence[0], rankPosition: 'first' }],
            rankingStrategy: { enabled: true, methodologyRequired: true, middleForbidden: true, methodology: 'Apply the same criteria to every entry.' }
        });
        const valid = applyEditorialProductPlacementPlanToHtml({ html: article, productSeedPlan, placementPlan: plan });
        expect(reviewEditorialProductPlacement({ html: valid, productSeedPlan, placementPlan: plan }).pass).toBe(true);
        const middle = valid.replace('data-rank-position="first"', 'data-rank-position="middle"').replace(/<section data-editorial-role="ranking-methodology">[\s\S]*?<\/section>/i, '');
        const review = reviewEditorialProductPlacement({ html: middle, productSeedPlan, placementPlan: plan });
        expect(review.issues).toEqual(expect.arrayContaining(['owned_product_in_middle_ranking', 'ranking_methodology_missing']));
    });

    it('materializes the owned product at the editorial end for ranking-last plans', () => {
        const plan = placementPlan({
            placementStyle: 'ranked-list-owned-last', ownedProductPositionPolicy: 'last',
            placementSequence: [{ ...placementPlan().placementSequence[0], rankPosition: 'last' }],
            rankingStrategy: { enabled: true, methodologyRequired: true, middleForbidden: true, methodology: 'Apply the same criteria to every entry.' }
        });
        const html = applyEditorialProductPlacementPlanToHtml({ html: article, productSeedPlan, placementPlan: plan });
        const blockIndex = html.indexOf('data-rank-position="last"');
        const finalIndependentSectionIndex = html.lastIndexOf('Mục hướng dẫn 5');
        expect(blockIndex).toBeGreaterThan(finalIndependentSectionIndex);
        expect(reviewEditorialProductPlacement({ html, productSeedPlan, placementPlan: plan }).pass).toBe(true);
    });

    it('blocks a bestseller claim reintroduced by the writer without valid evidence', () => {
        const plan = placementPlan({ rankingClaimReview: { claimDetected: true, evidenceRequired: true, evidenceValid: false, safeTitleRewriteApplied: true } });
        const html = applyEditorialProductPlacementPlanToHtml({ html: article, productSeedPlan, placementPlan: plan });
        const review = reviewEditorialProductPlacement({ html, title: 'Quạt tích điện bán chạy nhất 2026', productSeedPlan, placementPlan: plan });
        expect(review.issues).toContain('unsupported_bestseller_claim');
        expect(review.rankingEvidenceReview.outputClaimDetected).toBe(true);
    });

    it('rejects density, consecutive blocks/images and weak independent editorial value', () => {
        const plan = placementPlan();
        const valid = applyEditorialProductPlacementPlanToHtml({ html: article, productSeedPlan, placementPlan: plan });
        const block = valid.match(/<section[^>]*data-block-type="product-recommendation"[\s\S]*?<\/section>/i)[0];
        const overloaded = valid.replace(block, `${block}${block}`).replace('</article>', '<figure data-product-id="507f1f77bcf86cd799439032" data-image-role="product"></figure><figure data-product-id="507f1f77bcf86cd799439032" data-image-role="product"></figure></article>');
        const review = reviewEditorialProductPlacement({ html: overloaded, productSeedPlan, placementPlan: plan });
        expect(review.issues).toEqual(expect.arrayContaining(['product_block_limit_exceeded', 'consecutive_product_blocks', 'consecutive_product_images']));
        const thin = applyEditorialProductPlacementPlanToHtml({ html: '<article><p>Ngắn.</p><h2>A</h2><p>Một ý.</p><h2>B</h2><p>Hai ý.</p><h2>C</h2><p>Ba ý.</p></article>', productSeedPlan, placementPlan: { ...plan, firstProductMention: { minimumSectionsBeforeProduct: 0, minimumWordsBeforeProduct: 0, minimumProgressPercent: 0, introAllowed: false }, placementSequence: [{ ...plan.placementSequence[0], afterMinimumSection: 0 }] } });
        expect(reviewEditorialProductPlacement({ html: thin, productSeedPlan, placementPlan: { ...plan, firstProductMention: { minimumSectionsBeforeProduct: 0, minimumWordsBeforeProduct: 0, minimumProgressPercent: 0, introAllowed: false }, placementSequence: [{ ...plan.placementSequence[0], afterMinimumSection: 0 }] } }).issues).toContain('independent_editorial_value_insufficient');
    });

    it('supports no-product output without adding commercial content', () => {
        const plan = placementPlan({ decision: 'no_product', placementStyle: 'no-product', placementSequence: [], commercialDensity: { maxBlocks: 0, maxCtaCount: 0 } });
        const html = applyEditorialProductPlacementPlanToHtml({ html: article, productSeedPlan, placementPlan: plan });
        const review = reviewEditorialProductPlacement({ html, productSeedPlan, placementPlan: plan });
        expect(html).toBe(article);
        expect(review.pass).toBe(true);
    });
});
