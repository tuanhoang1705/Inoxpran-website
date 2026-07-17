import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildEnvProductSeedingConfig } = require('../src/config/productSeeding.config');
const { scoreCandidate, rankCandidates } = require('../src/services/productRelevanceScoring.service');
const { buildPlanDocument, normalizeBlogBrief, summarizeExposures } = require('../src/services/productSeedPlanning.service');

const config = buildEnvProductSeedingConfig({
    PRODUCT_SEEDING_ENABLED: 'true', PRODUCT_SEED_MIN_RELEVANCE_SCORE: '0.5', PRODUCT_CATALOG_MIN_DATA_COMPLETENESS: '0.6'
});
const candidate = (overrides = {}) => ({
    productId: '507f1f77bcf86cd799439011', name: 'Quạt tích điện mini', slug: 'quat-tich-dien-mini',
    canonicalUrl: '/product/quat-tich-dien-mini', status: 'active', availability: 'in_stock',
    category: { id: 'Electronics', name: 'Gia dụng điện' }, shortDescription: 'Quạt dùng pin sạc cho bàn học khi mất điện',
    verifiedFeatures: ['Pin sạc', 'Gió làm mát'], verifiedSpecifications: [{ key: 'power', value: '12W', source: 'product_attributes' }],
    materials: ['ABS'], supportedUseCases: ['bàn học', 'mất điện', 'mùa hè'], problemSolutions: ['làm mát khi mất điện'],
    compatibility: [], targetCustomers: ['học sinh'], seasonality: ['mùa hè'], dataCompleteness: 1,
    eligible: true, rejectionReasons: [], ...overrides
});
const brief = (overrides = {}) => normalizeBlogBrief({
    topic: 'Cách chọn quạt tích điện cho học sinh khi mất điện mùa hè', articleType: 'buying-guide',
    userProblems: ['làm mát khi mất điện'], seasonalContext: ['mùa hè'], searchIntent: ['commercial investigation'],
    productSeeding: { mode: 'auto', intensity: 'balanced', relevanceThreshold: 0.5 }, ...overrides
}, config);

describe('Product relevance scoring and planning', () => {
    it('ranks the correct use case above a same-category mismatch', () => {
        const wrong = candidate({ productId: '507f1f77bcf86cd799439012', name: 'Ấm siêu tốc', slug: 'am-sieu-toc', canonicalUrl: '/product/am-sieu-toc', shortDescription: 'Đun nước', verifiedFeatures: ['đun nước'], supportedUseCases: ['pha trà'], problemSolutions: [] });
        const ranked = rankCandidates({ candidates: [wrong, candidate()], brief: brief(), exposures: {}, config });
        expect(ranked[0].candidate.name).toBe('Quạt tích điện mini');
        expect(ranked[0].score.scoreBreakdown.useCase).toBeGreaterThan(ranked[1].score.scoreBreakdown.useCase);
    });

    it('penalizes out-of-stock, incomplete, recently exposed and excluded products', () => {
        const result = scoreCandidate({
            candidate: candidate({ availability: 'out_of_stock', dataCompleteness: 0.4 }),
            brief: brief({ productSeeding: { mode: 'auto', intensity: 'light', relevanceThreshold: 0.5, excludedProductIds: ['507f1f77bcf86cd799439011'] } }),
            exposure: {
                daysSinceLast: 1,
                last30Days: 6,
                categoryLast30Days: 7,
                ctaModes: { soft: 3 },
                placementTypes: { contextual_example: 3 }
            }, config
        });
        expect(result.penalties.map((item) => item.code)).toEqual(expect.arrayContaining([
            'out_of_stock', 'insufficient_data', 'product_cooldown', 'recent_overexposure',
            'category_overexposure', 'repeated_cta_pattern', 'repeated_placement_pattern', 'explicitly_excluded'
        ]));
        expect(result.eligible).toBe(false);
    });

    it('does not let product preference bypass a low relevance score', () => {
        const irrelevant = candidate({ name: 'Nồi inox', slug: 'noi-inox', canonicalUrl: '/product/noi-inox', shortDescription: 'Nồi nấu canh', verifiedFeatures: ['nấu canh'], supportedUseCases: ['nấu ăn'], problemSolutions: [] });
        const result = scoreCandidate({ candidate: irrelevant, brief: brief({ productSeeding: { mode: 'auto', preferredProductIds: [irrelevant.productId], relevanceThreshold: 0.72 } }), config: { ...config, minRelevanceScore: 0.72 } });
        expect(result.totalScore).toBeLessThan(0.72);
        expect(result.eligible).toBe(false);
    });

    it('creates contextual/no-seed/blocked decisions without product-led misuse', () => {
        const ranked = rankCandidates({ candidates: [candidate()], brief: brief(), exposures: {}, config });
        const contextual = buildPlanDocument({ brief: brief(), googleIntelSnapshotId: '507f1f77bcf86cd799439099', snapshot: { _id: '507f1f77bcf86cd799439098' }, ranked, exposures: {}, config });
        expect(contextual.decision).toBe('contextual_seed');
        expect(contextual.primaryProduct.allowedClaims.length).toBeGreaterThan(0);
        const required = brief({ topic: 'Chăm sóc cây', articleType: 'how-to', productSeeding: { mode: 'required', relevanceThreshold: 0.99 } });
        const blocked = buildPlanDocument({ brief: required, googleIntelSnapshotId: '507f1f77bcf86cd799439099', snapshot: {}, ranked: [], exposures: {}, config });
        expect(blocked.decision).toBe('blocked_no_suitable_product');
    });

    it('summarizes 7/30/90-day cooldown evidence', () => {
        const now = new Date('2026-07-17T00:00:00Z');
        const rows = [1, 10, 60].map((days) => ({ productId: 'p1', categoryKey: 'Electronics', createdAt: new Date(now.getTime() - days * 86_400_000), placementTypes: ['contextual_example'], ctaMode: 'soft' }));
        const summary = summarizeExposures({ rows, now });
        expect(summary.p1).toMatchObject({ last7Days: 1, last30Days: 2, last90Days: 3, daysSinceLast: 1 });
        expect(summary.__categoryLast30Days).toEqual({ Electronics: 2 });
    });
});
