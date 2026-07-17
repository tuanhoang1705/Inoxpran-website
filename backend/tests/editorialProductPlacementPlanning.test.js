import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildEnvProductPlacementConfig, normalizeProductPlacementOptions, PRODUCT_PLACEMENT_STYLES } = require('../src/config/productPlacement.config');
const {
    buildPlanDocument,
    chooseRankingPosition,
    rewriteUnsafeRankingTitle,
    validateRankingEvidence
} = require('../src/services/editorialProductPlacementPlanning.service');
const { buildLlmDraftMessages } = require('../src/services/agenticBlogCore.service');
const { normalizeSchedulePayload } = require('../src/utils/blogSchedule.util');

const config = buildEnvProductPlacementConfig({
    PRODUCT_PLACEMENT_ENABLED: 'true',
    PRODUCT_PLACEMENT_DEFAULT_STYLE: 'auto',
    PRODUCT_PLACEMENT_REQUIRE_DISCLOSURE: 'true',
    PRODUCT_PLACEMENT_REQUIRE_RANKING_METHODOLOGY: 'true',
    PRODUCT_PLACEMENT_REQUIRE_BESTSELLER_EVIDENCE: 'true'
});
const productSeedPlan = {
    _id: '507f1f77bcf86cd799439031',
    googleIntelSnapshotId: '507f1f77bcf86cd799439021',
    productCatalogSnapshotId: '507f1f77bcf86cd799439030',
    decision: 'contextual_seed', intensity: 'light', mode: 'auto',
    primaryProduct: { productId: '507f1f77bcf86cd799439032', name: 'Quạt tích điện mini', canonicalUrl: '/product/quat-tich-dien-mini' },
    supportingProducts: []
};
const makePlan = ({ style = 'auto', rankingPositionMode = 'auto', articleType = 'buying-guide', categoryKey = 'guide', topic = 'Cách chọn quạt tích điện', recentPlans = [], rankingEvidence = null } = {}) => buildPlanDocument({
    brief: { topic, primaryKeyword: topic, articleType, categoryKey, rankingEvidence, productPlacement: { style, rankingPositionMode } },
    productSeedPlan,
    options: normalizeProductPlacementOptions({ style, rankingPositionMode }, config),
    config,
    recentPlans,
    now: new Date('2026-07-17T00:00:00Z')
});

describe('Editorial Product Placement planning', () => {
    it('allows owned products only first or last and rotates automatic ranking position', () => {
        expect(chooseRankingPosition({ requestedMode: 'first', recentPlans: [] })).toBe('first');
        expect(chooseRankingPosition({ requestedMode: 'last', recentPlans: [] })).toBe('last');
        expect(chooseRankingPosition({ requestedMode: 'middle', recentPlans: [] })).toBe('first');
        expect(chooseRankingPosition({ requestedMode: 'auto', recentPlans: [{ ownedProductPositionPolicy: 'first' }] })).toBe('last');
        const first = makePlan({ style: 'ranked-list-owned-first' });
        const last = makePlan({ style: 'ranked-list-owned-last' });
        expect(first.ownedProductPositionPolicy).toBe('first');
        expect(last.ownedProductPositionPolicy).toBe('last');
        expect([first, last].every((plan) => plan.placementSequence.every((item) => item.rankPosition !== 'middle'))).toBe(true);
    });

    it('requires complete ranking evidence and safely rewrites unsupported bestseller titles', () => {
        expect(validateRankingEvidence({}).valid).toBe(false);
        expect(validateRankingEvidence({ evidenceType: 'internal_sales', dataSource: 'orders', dateRange: { start: '2026-06-01', end: '2026-06-30' }, checkedAt: '2026-07-17', methodology: 'Units sold', scope: 'Inoxpran online store' }).valid).toBe(true);
        const unsafe = makePlan({ topic: 'Top quạt tích điện bán chạy nhất 2026', articleType: 'listicle' });
        expect(unsafe.rankingClaimReview.safeTitleRewriteApplied).toBe(true);
        expect(unsafe.effectiveTopic).not.toMatch(/bán chạy/i);
        expect(rewriteUnsafeRankingTitle('Best-selling fan')).not.toMatch(/best-selling/i);
    });

    it('supports every centralized style and applies article-specific first-mention thresholds', () => {
        const styles = PRODUCT_PLACEMENT_STYLES.filter((style) => style !== 'auto');
        styles.forEach((style) => {
            const plan = makePlan({ style });
            expect(plan.placementStyle).toBe(style);
            expect(plan.decision).toBe(style === 'no-product' ? 'no_product' : 'place_product');
        });
        expect(makePlan({ style: 'knowledge-soft-endcap', categoryKey: 'knowledge' }).firstProductMention).toMatchObject({ minimumSectionsBeforeProduct: 3, minimumProgressPercent: 60 });
        expect(makePlan({ style: 'product-led-editorial', articleType: 'product-education', categoryKey: 'product' }).firstProductMention).toMatchObject({ minimumSectionsBeforeProduct: 1, minimumProgressPercent: 10 });
        expect(makePlan({ style: 'problem-solution-late-reveal', articleType: 'troubleshooting' }).firstProductMention.minimumProgressPercent).toBe(50);
    });

    it('rotates a recent non-ranking style during cooldown', () => {
        const plan = makePlan({ recentPlans: [{ placementStyle: 'criteria-first-recommendation', createdAt: '2026-07-16T00:00:00Z' }] });
        expect(plan.placementStyle).toBe('scenario-product-matching');
    });

    it('normalizes schedule placement controls and rejects middle by falling back to auto', () => {
        const schedule = normalizeSchedulePayload({
            name: 'Placement schedule', scheduleType: 'daily', daily: { times: ['09:00'] },
            agentConfig: { topic: 'Quạt tích điện', productPlacement: { style: 'criteria-first-recommendation', rankingPositionMode: 'middle', minSectionsBeforeProduct: 3, minProgressPercent: 55 } }
        });
        expect(schedule.agentConfig.productPlacement).toMatchObject({ style: 'criteria-first-recommendation', rankingPositionMode: 'auto', minSectionsBeforeProduct: 3, minProgressPercent: 55 });
    });

    it('locks writer placement decisions behind the backend contract', () => {
        const placement = makePlan({ style: 'criteria-first-recommendation' });
        placement._id = '507f1f77bcf86cd799439033';
        const messages = buildLlmDraftMessages({ topic: placement.effectiveTopic, primaryKeyword: 'quạt tích điện', secondaryKeywords: [], articleType: 'buying-guide', style: {}, headingCount: 4, language: 'vi', tone: 'practical', productSeedPlan, editorialPlacementPlan: placement, architecture: { headings: [], productPlacement: {} } });
        const payload = JSON.parse(messages[1].content);
        expect(payload.editorialProductPlacementPlan.id).toBe(placement._id);
        expect(payload.editorialProductPlacementPlan.rule).toMatch(/locked backend contract/i);
        expect(payload.productSeedPlan.rule).toMatch(/do not mention, rank, link or place/i);
    });
});
