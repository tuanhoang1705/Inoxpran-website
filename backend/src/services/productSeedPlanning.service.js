'use strict'

const crypto = require('node:crypto');
const { ProductSeedPlan } = require('../models/productSeedPlan.model');
const { ProductSeedExposure } = require('../models/productSeedExposure.model');
const { ProductCatalogIntelligenceService } = require('./productCatalogIntelligence.service');
const { ProductSeedingConfigService } = require('./productSeedingConfig.service');
const { rankCandidates } = require('./productRelevanceScoring.service');
const {
    buildEnvProductSeedingConfig,
    commercialDensityFor,
    normalizeProductSeedingOptions
} = require('../config/productSeeding.config');
const { normalizeTrustedQaProvenance, qaScopeFilter } = require('../utils/qaProvenance.util');

const text = (value, max = 300) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
const list = (value, max = 30) => {
    const source = Array.isArray(value) ? value : String(value || '').split(',');
    return Array.from(new Set(source.map((item) => text(item, 160)).filter(Boolean))).slice(0, max);
};
const sha256 = (value) => crypto.createHash('sha256').update(String(value || '')).digest('hex');

const normalizeBlogBrief = (input = {}, envConfig = buildEnvProductSeedingConfig()) => {
    const topic = text(input.topic || input.primaryKeyword, 300);
    const articleType = text(input.articleType || 'how-to', 80).toLowerCase();
    const categoryKey = text(input.categoryKey || input.contentRole || 'guide', 80).toLowerCase();
    const productInput = input.productSeeding || input.agentConfig?.productSeeding || {};
    const productSeeding = normalizeProductSeedingOptions(productInput, envConfig);
    const searchIntent = list(input.searchIntent?.primary || input.searchIntent || input.searchIntents, 12);
    const userProblems = list(input.userProblems, 20);
    return {
        topic,
        primaryKeyword: text(input.primaryKeyword || topic, 180),
        secondaryKeywords: list(input.secondaryKeywords, 12),
        language: ['vi', 'en'].includes(text(input.language).toLowerCase()) ? text(input.language).toLowerCase() : 'vi',
        articleType,
        contentRole: categoryKey,
        targetAudience: list(input.targetAudience, 12),
        searchIntent: searchIntent.length ? searchIntent : [articleType, topic].filter(Boolean),
        userProblems: userProblems.length ? userProblems : [topic].filter(Boolean),
        seasonalContext: list(input.seasonalContext, 12),
        preferredCategoryIds: productSeeding.preferredCategoryIds,
        preferredProductIds: productSeeding.preferredProductIds,
        excludedProductIds: productSeeding.excludedProductIds,
        productSeeding
    };
};

const summarizeExposures = ({ rows = [], now = new Date() }) => {
    const result = {};
    const categoryLast30Days = {};
    rows.forEach((row) => {
        const key = String(row.productId || '');
        if (!key) return;
        const created = new Date(row.publishedAt || row.createdAt || 0);
        const ageDays = Math.max(0, (now.getTime() - created.getTime()) / 86_400_000);
        const current = result[key] || { last7Days: 0, last30Days: 0, last90Days: 0, daysSinceLast: Infinity, ctaModes: {}, placementTypes: {} };
        if (ageDays <= 7) current.last7Days += 1;
        if (ageDays <= 30) current.last30Days += 1;
        if (ageDays <= 90) current.last90Days += 1;
        current.daysSinceLast = Math.min(current.daysSinceLast, ageDays);
        current.ctaModes[row.ctaMode || 'none'] = (current.ctaModes[row.ctaMode || 'none'] || 0) + 1;
        (row.placementTypes || []).forEach((item) => {
            current.placementTypes[item] = (current.placementTypes[item] || 0) + 1;
        });
        result[key] = current;
        if (ageDays <= 30 && row.categoryKey) {
            categoryLast30Days[row.categoryKey] = (categoryLast30Days[row.categoryKey] || 0) + 1;
        }
    });
    result.__categoryLast30Days = categoryLast30Days;
    return result;
};

const safeClaimsFor = (candidate) => [
    { key: 'product_name', value: candidate.name, source: 'product_name' },
    { key: 'canonical_url', value: candidate.canonicalUrl, source: 'product_slug' },
    ...(candidate.verifiedSpecifications || []).map((item) => ({ key: item.key, value: item.value, source: item.source || 'product_attributes' })),
    ...(candidate.materials || []).map((value) => ({ key: 'material', value, source: 'product_attributes' })),
    ...(candidate.verifiedFeatures || []).map((value) => ({ key: 'feature', value, source: 'product_attributes' }))
].filter((item) => item.value).slice(0, 50);

const FORBIDDEN_CLAIMS = [
    'best', 'number_one', 'absolute_safety', 'unverified_savings', 'unverified_lifespan',
    'medical_claim', 'kills_100_percent_bacteria', 'never_breaks', 'unverified_certification',
    'expert_endorsement', 'best_selling', 'millions_of_users', 'exclusive_technology'
];

const selectedProduct = ({ candidate, score, brief }) => ({
    productId: candidate.productId,
    name: candidate.name,
    slug: candidate.slug,
    canonicalUrl: candidate.canonicalUrl,
    category: candidate.category,
    relevanceScore: score.totalScore,
    scoreBreakdown: score.scoreBreakdown,
    matchedUserProblems: (brief.userProblems || []).filter((problem) => score.matchedEvidence.some((item) => item.toLowerCase().includes(problem.toLowerCase()))),
    allowedClaims: safeClaimsFor(candidate),
    forbiddenClaims: FORBIDDEN_CLAIMS,
    evidence: score.matchedEvidence
});

const isCommercialIntent = (brief) => {
    const allowedTypes = new Set(['buying-guide', 'comparison', 'buyer-journey', 'product-education', 'use-case-guide', 'seasonal-guide']);
    const intentText = (brief.searchIntent || []).join(' ').toLowerCase();
    return allowedTypes.has(brief.articleType) || /commercial|transaction|buy|purchase|mua|chon mua/.test(intentText);
};

const buildPlanDocument = ({ brief, googleIntelSnapshotId, snapshot, ranked = [], exposures = {}, config }) => {
    const eligible = ranked.filter((entry) => entry.score.eligible);
    const primaryEntries = eligible.slice(0, brief.productSeeding.maxPrimaryProducts);
    const supportingEntries = eligible.slice(primaryEntries.length, primaryEntries.length + brief.productSeeding.maxSupportingProducts);
    const hasProduct = primaryEntries.length > 0;
    const blocked = brief.productSeeding.mode === 'required' && !hasProduct;
    const productLed = hasProduct && brief.productSeeding.intensity === 'commercial' && isCommercialIntent(brief);
    const decision = blocked ? 'blocked_no_suitable_product' : hasProduct ? (productLed ? 'product_led' : 'contextual_seed') : 'no_seed';
    const primaryProduct = hasProduct ? selectedProduct({ ...primaryEntries[0], brief }) : null;
    const supportingProducts = supportingEntries.map((entry) => selectedProduct({ ...entry, brief }));
    const allSelected = [primaryProduct, ...supportingProducts].filter(Boolean);
    const density = commercialDensityFor(brief.productSeeding.intensity, config);
    const failureReason = blocked
        ? 'Required product integration was blocked because no eligible product met the relevance threshold.'
        : hasProduct
            ? `Selected ${allSelected.length} product(s) using deterministic relevance scoring and catalog evidence.`
            : 'No eligible product met the relevance threshold; continue as pure informational content.';
    return {
        blogBriefHash: sha256(JSON.stringify(brief)),
        googleIntelSnapshotId,
        productCatalogSnapshotId: snapshot?._id || snapshot?.id || null,
        mode: brief.productSeeding.mode,
        intensity: brief.productSeeding.intensity,
        decision,
        decisionReason: failureReason,
        primaryProduct,
        supportingProducts,
        candidateScores: ranked.slice(0, 20).map(({ candidate, score }) => ({ productId: candidate.productId, name: candidate.name, ...score, exposure: exposures[candidate.productId] || {} })),
        rejectedCandidates: ranked.filter((entry) => !entry.score.eligible).slice(0, 20).map(({ candidate, score }) => ({ productId: candidate.productId, name: candidate.name, totalScore: score.totalScore, rejectionReasons: score.rejectionReasons, penalties: score.penalties })),
        placementPlan: [],
        ctaPlan: {
            enabled: hasProduct && density.maxCtaCount > 0,
            mode: hasProduct ? (productLed ? 'product_detail' : 'soft') : 'none',
            maxCount: hasProduct ? density.maxCtaCount : 0,
            allowedAnchors: ['Xem thông tin sản phẩm', 'Xem một mẫu phù hợp', 'View product information', 'See a suitable model'],
            forbiddenAnchors: ['MUA NGAY - GIÁ SỐC', 'TỐT NHẤT THỊ TRƯỜNG', 'BUY NOW - SHOCK PRICE', 'THE BEST ON THE MARKET']
        },
        commercialDensityLimits: density,
        riskFlags: allSelected.filter((item) => ranked.find((entry) => entry.candidate.productId === item.productId)?.candidate.availability !== 'in_stock').map((item) => `availability_risk:${item.productId}`),
        reviewRequirements: hasProduct ? ['product_claim_verification', 'product_seeding_naturalness', 'commercial_density', 'product_link_safety'] : [],
        warnings: [], errorCodes: blocked ? ['no_suitable_product'] : []
    };
};

class ProductSeedPlanningService {
    static async createPlan({ brief: briefInput = {}, googleIntelSnapshotId, executionId = null, now = new Date(), persist = true } = {}) {
        const config = await ProductSeedingConfigService.getConfig();
        const brief = normalizeBlogBrief(briefInput, config);
        const qaContext = normalizeTrustedQaProvenance(briefInput.qaContext ?? null);
        brief.productSeeding.maxPrimaryProducts = Math.min(brief.productSeeding.maxPrimaryProducts, config.maxPrimaryProducts);
        brief.productSeeding.maxSupportingProducts = Math.min(brief.productSeeding.maxSupportingProducts, config.maxSupportingProducts);
        if (!brief.topic) throw new Error('product_seeding_topic_required');
        let planDocument;
        if (brief.productSeeding.mode === 'off') {
            planDocument = {
                blogBriefHash: sha256(JSON.stringify(brief)), googleIntelSnapshotId,
                productCatalogSnapshotId: null, mode: 'off', intensity: brief.productSeeding.intensity,
                decision: 'no_seed', decisionReason: 'Product integration is disabled for this execution.',
                primaryProduct: null, supportingProducts: [], candidateScores: [], rejectedCandidates: [],
                placementPlan: [], ctaPlan: { enabled: false, mode: 'none', maxCount: 0, allowedAnchors: [], forbiddenAnchors: [] },
                commercialDensityLimits: commercialDensityFor(brief.productSeeding.intensity, config),
                riskFlags: [], reviewRequirements: [], warnings: [], errorCodes: []
            };
        } else {
            const snapshot = await ProductCatalogIntelligenceService.ensureSnapshot({
                now,
                config,
                ...(qaContext ? { trustedQaContext: qaContext } : {})
            });
            if (snapshot.status === 'failed') {
                const blocked = brief.productSeeding.mode === 'required';
                planDocument = {
                    blogBriefHash: sha256(JSON.stringify(brief)), googleIntelSnapshotId,
                    productCatalogSnapshotId: snapshot._id || snapshot.id || null,
                    mode: brief.productSeeding.mode, intensity: brief.productSeeding.intensity,
                    decision: blocked ? 'blocked_no_suitable_product' : 'no_seed',
                    decisionReason: blocked ? 'Product catalog snapshot failed in required mode.' : 'Product catalog snapshot failed; continuing with pure informational content.',
                    primaryProduct: null, supportingProducts: [], candidateScores: [], rejectedCandidates: [], placementPlan: [],
                    ctaPlan: { enabled: false, mode: 'none', maxCount: 0, allowedAnchors: [], forbiddenAnchors: [] },
                    commercialDensityLimits: commercialDensityFor(brief.productSeeding.intensity, config),
                    riskFlags: ['catalog_snapshot_failed'], reviewRequirements: [], warnings: ['catalog_snapshot_failed'], errorCodes: blocked ? ['catalog_snapshot_failed'] : []
                };
            } else {
                const candidates = snapshot.safeProducts || await ProductCatalogIntelligenceService.readSafeCatalog({ config });
                const lookback = new Date(now.getTime() - config.lookbackDays * 86_400_000);
                const exposureRows = await ProductSeedExposure.find({
                    createdAt: { $gte: lookback },
                    ...qaScopeFilter(qaContext)
                }).lean();
                const exposureSummary = summarizeExposures({ rows: exposureRows, now });
                const exposures = Object.fromEntries(candidates.map((candidate) => [
                    String(candidate.productId),
                    {
                        ...(exposureSummary[String(candidate.productId)] || {}),
                        categoryLast30Days: exposureSummary.__categoryLast30Days?.[candidate.category?.id] || 0
                    }
                ]));
                const ranked = rankCandidates({ candidates, brief, exposures, config });
                planDocument = buildPlanDocument({ brief, googleIntelSnapshotId, snapshot, ranked, exposures, config });
            }
        }
        if (!persist) return { ...planDocument, brief };
        const created = await ProductSeedPlan.create({
            ...planDocument,
            ...(qaContext || {}),
            executionId,
            contentWorkOrderId: briefInput.contentWorkOrderId || null,
            unifiedContentBriefId: briefInput.unifiedContentBriefId || null
        });
        return { ...(typeof created.toObject === 'function' ? created.toObject() : created), brief };
    }

    static async attachExecution({ planId, executionId }) {
        if (!planId || !executionId) return;
        await ProductSeedPlan.updateOne({ _id: planId }, { $set: { executionId } });
    }
}

module.exports = {
    FORBIDDEN_CLAIMS,
    ProductSeedPlanningService,
    buildPlanDocument,
    isCommercialIntent,
    normalizeBlogBrief,
    safeClaimsFor,
    summarizeExposures
};
