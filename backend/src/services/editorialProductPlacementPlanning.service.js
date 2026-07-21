'use strict'

const { EditorialProductPlacementPlan } = require('../models/editorialProductPlacementPlan.model');
const { ProductPlacementStyleDefinition } = require('../models/productPlacementStyleDefinition.model');
const {
    ARTICLE_TYPE_THRESHOLDS,
    STYLE_DEFINITIONS,
    buildEnvProductPlacementConfig,
    normalizeProductPlacementOptions,
    placementDensityFor
} = require('../config/productPlacement.config');

const DAY_MS = 86_400_000;
const text = (value, max = 300) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
const selectedProducts = (plan = {}) => [plan.primaryProduct, ...(plan.supportingProducts || [])].filter(Boolean);
const normalizeForMatch = (value) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .toLowerCase();

const hasBestsellerClaim = (value) => /\b(best[ -]?seller|best[ -]?selling|top[ -]?selling|ban chay nhat|ban chay|so 1 ve doanh so)\b/i.test(normalizeForMatch(value));
const validDate = (value) => Boolean(value) && !Number.isNaN(new Date(value).getTime());

const validateRankingEvidence = (evidence = {}) => {
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
        return { valid: false, reason: 'ranking_evidence_missing', evidenceType: 'none' };
    }
    const evidenceType = text(evidence.evidenceType || evidence.sourceType, 60).toLowerCase();
    const checkedAt = text(evidence.checkedAt, 80);
    const methodology = text(evidence.methodology, 500);
    const scope = text(evidence.scope, 300);
    if (evidenceType === 'internal_sales') {
        const start = evidence.dateRange?.start;
        const end = evidence.dateRange?.end;
        const valid = Boolean(text(evidence.dataSource, 200) && validDate(start) && validDate(end) && new Date(start).getTime() <= new Date(end).getTime() && validDate(checkedAt) && methodology && scope);
        return { valid, reason: valid ? '' : 'internal_ranking_evidence_incomplete', evidenceType, normalized: valid ? evidence : null };
    }
    if (evidenceType === 'external') {
        let sourceUrlValid = false;
        try { sourceUrlValid = new URL(String(evidence.sourceUrl || '')).protocol === 'https:'; } catch { sourceUrlValid = false; }
        const valid = Boolean(sourceUrlValid && text(evidence.sourceTitle, 250) && validDate(evidence.publishedAt) && validDate(checkedAt) && methodology && scope);
        return { valid, reason: valid ? '' : 'external_ranking_evidence_incomplete', evidenceType, normalized: valid ? evidence : null };
    }
    return { valid: false, reason: 'ranking_evidence_type_invalid', evidenceType: evidenceType || 'none' };
};

const rewriteUnsafeRankingTitle = (topic) => {
    const source = text(topic, 300);
    if (!hasBestsellerClaim(source)) return source;
    const rewritten = source
        .replace(/b[aáàảãạ]n\s+ch[aạ]y\s+nh[aấ]t/gi, 'đáng cân nhắc theo nhu cầu')
        .replace(/b[aáàảãạ]n\s+ch[aạ]y/gi, 'được quan tâm')
        .replace(/best[ -]?seller|best[ -]?selling|top[ -]?selling/gi, 'đáng cân nhắc')
        .replace(/s[oố]\s*1\s+v[eề]\s+doanh\s+s[oố]/gi, 'phù hợp theo tiêu chí sử dụng');
    return text(rewritten, 300);
};

const inferAutoStyle = ({ brief = {}, productSeedPlan = {} }) => {
    if (!['contextual_seed', 'product_led'].includes(productSeedPlan.decision)) return 'no-product';
    const articleType = text(brief.articleType, 80).toLowerCase();
    const category = text(brief.categoryKey || brief.contentRole, 80).toLowerCase();
    const intent = normalizeForMatch([brief.topic, brief.primaryKeyword, articleType, category, brief.searchIntent?.primary || brief.searchIntent].flat().join(' '));
    if (productSeedPlan.decision === 'product_led' || ['product', 'product-education'].includes(articleType) || category === 'product') return 'product-led-editorial';
    if (articleType === 'listicle' || /\b(top|xep hang|danh sach|ranking)\b/.test(intent)) return 'ranked-list-owned-first';
    if (articleType === 'comparison') return 'comparison-matrix-contextual';
    if (articleType === 'troubleshooting' || /khac phuc|loi|van de/.test(intent)) return 'problem-solution-late-reveal';
    if (['use-case-guide', 'scenario-based'].includes(articleType)) return 'scenario-product-matching';
    if (['buying-guide', 'buyer-journey', 'checklist'].includes(articleType)) return 'criteria-first-recommendation';
    if (['technical-explainer', 'myth-vs-fact', 'faq-synthesis', 'product-care'].includes(articleType) || ['knowledge', 'care'].includes(category)) return 'knowledge-soft-endcap';
    if (category === 'trend' || articleType === 'seasonal-guide') return 'editorial-pick-disclosed';
    return 'inline-contextual-example';
};

const thresholdFor = ({ articleType, contentRole, style, options, config }) => {
    const articleKey = text(articleType, 80).toLowerCase();
    const roleKey = text(contentRole, 80).toLowerCase();
    const productLedKey = style === 'product-led-editorial' ? 'product-led' : '';
    const articleThreshold = ARTICLE_TYPE_THRESHOLDS[productLedKey] || ARTICLE_TYPE_THRESHOLDS[articleKey] || ARTICLE_TYPE_THRESHOLDS[roleKey] || {};
    const styleThreshold = STYLE_DEFINITIONS[style] || {};
    const productLed = style === 'product-led-editorial';
    return {
        minimumSectionsBeforeProduct: productLed ? 1 : Math.max(options.minSectionsBeforeProduct, config.minSectionsBeforeProduct, articleThreshold.minSections || 0, styleThreshold.minSections || 0),
        minimumWordsBeforeProduct: Math.max(options.minWordsBeforeProduct, config.minWordsBeforeProduct),
        minimumProgressPercent: productLed ? 10 : Math.max(options.minProgressPercent, config.minProgressPercent, articleThreshold.minProgressPercent || 0, styleThreshold.minProgressPercent || 0),
        introAllowed: style === 'product-led-editorial' && config.allowProductInIntro
    };
};

const chooseRankingPosition = ({ requestedMode, recentPlans = [] }) => {
    if (requestedMode === 'first' || requestedMode === 'last') return requestedMode;
    const latest = recentPlans.find((item) => ['first', 'last'].includes(item.ownedProductPositionPolicy));
    return latest?.ownedProductPositionPolicy === 'first' ? 'last' : 'first';
};

const buildPlacementSequence = ({ style, productSeedPlan, density, firstMention, position }) => {
    const definition = STYLE_DEFINITIONS[style] || STYLE_DEFINITIONS['inline-contextual-example'];
    const products = definition.ranking ? selectedProducts(productSeedPlan).slice(0, 1) : selectedProducts(productSeedPlan).slice(0, density.maxBlocks);
    return products.map((item, index) => ({
        placementId: `editorial-placement-${index + 1}`,
        productId: String(item.productId),
        productName: item.name,
        canonicalUrl: item.canonicalUrl,
        sectionKey: `editorial-section-${firstMention.minimumSectionsBeforeProduct + index}`,
        sectionPurpose: definition.presentation === 'inline'
            ? 'Use the product as a brief, disclosed example after the independent explanation.'
            : 'Apply previously stated objective criteria to a catalog-verified option.',
        presentation: definition.presentation,
        commercialRole: index === 0 ? 'primary-owned-example' : 'supporting-owned-example',
        rankPosition: definition.ranking ? position : 'none',
        afterMinimumSection: firstMention.minimumSectionsBeforeProduct + index,
        maxMentions: 1,
        linkAllowed: index === 0,
        ctaAllowed: index === 0 && density.maxCtaCount > 0,
        disclosureRequired: true
    }));
};

const buildPlanDocument = ({ brief = {}, productSeedPlan, options, config, recentPlans = [], now = new Date() }) => {
    const automaticStyle = inferAutoStyle({ brief, productSeedPlan });
    let style = options.style === 'auto' ? automaticStyle : options.style;
    if (!['contextual_seed', 'product_led'].includes(productSeedPlan.decision) || !options.enabled) style = 'no-product';
    const explicitStylePosition = options.style === 'ranked-list-owned-last' ? 'last' : options.style === 'ranked-list-owned-first' ? 'first' : options.rankingPositionMode;
    const rankingPosition = chooseRankingPosition({ requestedMode: explicitStylePosition, recentPlans });
    if ((STYLE_DEFINITIONS[style] || {}).ranking) style = rankingPosition === 'last' ? 'ranked-list-owned-last' : 'ranked-list-owned-first';
    if (options.style === 'auto' && !(STYLE_DEFINITIONS[style] || {}).ranking) {
        const latestSameStyle = recentPlans.find((item) => item.placementStyle === style);
        const ageDays = latestSameStyle?.createdAt ? (now.getTime() - new Date(latestSameStyle.createdAt).getTime()) / DAY_MS : Infinity;
        if (ageDays < config.styleCooldownDays) {
            const rotationFallbacks = {
                'criteria-first-recommendation': 'scenario-product-matching',
                'scenario-product-matching': 'criteria-first-recommendation',
                'knowledge-soft-endcap': 'inline-contextual-example',
                'inline-contextual-example': 'knowledge-soft-endcap',
                'comparison-matrix-contextual': 'criteria-first-recommendation',
                'problem-solution-late-reveal': 'criteria-first-recommendation',
                'editorial-pick-disclosed': 'knowledge-soft-endcap'
            };
            style = rotationFallbacks[style] || style;
        }
    }
    const ranking = Boolean(STYLE_DEFINITIONS[style]?.ranking);
    const rankingEvidence = validateRankingEvidence(brief.rankingEvidence || brief.productPlacement?.rankingEvidence);
    const unsafeRankingClaim = hasBestsellerClaim(brief.topic);
    const effectiveTopic = unsafeRankingClaim && config.requireBestsellerEvidence && !rankingEvidence.valid
        ? rewriteUnsafeRankingTitle(brief.topic)
        : text(brief.topic, 300);
    const firstProductMention = thresholdFor({
        articleType: brief.articleType,
        contentRole: brief.categoryKey || brief.contentRole,
        style,
        options,
        config
    });
    const density = placementDensityFor(productSeedPlan.intensity, config);
    const position = ranking ? (style.endsWith('-last') ? 'last' : 'first') : 'none';
    const sequence = style === 'no-product' ? [] : buildPlacementSequence({ style, productSeedPlan, density, firstMention: firstProductMention, position });
    const requireDisclosure = sequence.length > 0 && (config.requireDisclosure || options.disclosureMode === 'required');
    return {
        productSeedPlanId: productSeedPlan._id || productSeedPlan.id,
        googleIntelSnapshotId: productSeedPlan.googleIntelSnapshotId,
        productCatalogSnapshotId: productSeedPlan.productCatalogSnapshotId || null,
        decision: sequence.length ? 'place_product' : 'no_product',
        placementStyle: style,
        articleType: text(brief.articleType, 80),
        contentRole: text(brief.categoryKey || brief.contentRole, 80),
        searchIntent: brief.searchIntent || {},
        effectiveTopic,
        rankingClaimReview: {
            claimDetected: unsafeRankingClaim,
            evidenceRequired: config.requireBestsellerEvidence,
            evidenceValid: rankingEvidence.valid,
            evidenceType: rankingEvidence.evidenceType,
            reason: rankingEvidence.reason,
            safeTitleRewriteApplied: effectiveTopic !== text(brief.topic, 300),
            originalTopic: text(brief.topic, 300),
            effectiveTopic,
            evidence: rankingEvidence.normalized || null
        },
        ownedProductPositionPolicy: position,
        firstProductMention,
        placementSequence: sequence,
        rankingStrategy: {
            enabled: ranking,
            ownedProductPosition: position,
            middleForbidden: !config.allowOwnedProductMiddle,
            methodologyRequired: ranking && config.requireRankingMethodology,
            methodology: ranking ? 'Define use-case criteria, evidence limits and ownership disclosure before the ranked entries; apply the same criteria to every entry.' : ''
        },
        commercialDensity: density,
        visualPlacement: {
            productImagePlacement: options.productImagePlacement,
            firstImageMustBeEditorial: !config.allowProductImageFirst,
            productImageFirstAllowed: config.allowProductImageFirst,
            consecutiveProductImagesAllowed: config.allowConsecutiveProductImages,
            anchors: sequence.map((item) => ({ placementId: item.placementId, sectionKey: item.sectionKey, role: 'optional-product-context' }))
        },
        disclosure: {
            required: requireDisclosure,
            mode: options.disclosureMode,
            text: requireDisclosure ? 'Minh bạch: sản phẩm được nhắc đến thuộc INOXPRAN và chỉ là ví dụ để đối chiếu theo các tiêu chí đã nêu.' : ''
        },
        ctaStrategy: { mode: sequence.length && density.maxCtaCount ? 'soft-product-detail' : 'none', maxCount: sequence.length ? density.maxCtaCount : 0 },
        forbiddenPatterns: ['owned-product-middle-ranking', 'product-in-intro', 'product-image-first', 'consecutive-product-blocks', 'consecutive-product-images', 'unsupported-bestseller-claim', 'undisclosed-owned-product'],
        reviewRules: ['placement-id-integrity', 'selected-product-integrity', 'first-mention-threshold', 'commercial-density', 'ranking-position', 'ranking-methodology', 'disclosure', 'independent-editorial-value'],
        alternativesRejected: Object.keys(STYLE_DEFINITIONS).filter((item) => item !== style).slice(0, 5).map((item) => ({ style: item, reason: 'Lower fit for current article type, intent or rotation state.' })),
        reason: style === 'no-product'
            ? 'No placement was planned because product selection did not authorize a product or placement was disabled.'
            : `Selected ${style} independently from product selection; first mention is gated by sections, words and article progress.`,
        warnings: unsafeRankingClaim && !rankingEvidence.valid ? ['unsafe_bestseller_claim_rewritten'] : []
    };
};

class EditorialProductPlacementPlanningService {
    static async seedStyleLibrary(config = buildEnvProductPlacementConfig()) {
        await Promise.all(Object.entries(STYLE_DEFINITIONS).map(([styleId, definition]) => ProductPlacementStyleDefinition.updateOne(
            { styleId },
            { $setOnInsert: { styleId, ...definition, enabled: true, cooldownDays: config.styleCooldownDays, rules: definition } },
            { upsert: true }
        )));
    }

    static async createPlan({ brief = {}, productSeedPlan, executionId = null, now = new Date(), persist = true } = {}) {
        if (!productSeedPlan?._id && !productSeedPlan?.id) throw new Error('product_seed_plan_required_for_editorial_placement');
        const config = buildEnvProductPlacementConfig();
        const options = normalizeProductPlacementOptions(brief.productPlacement || brief.agentConfig?.productPlacement || {}, config);
        const lookback = new Date(now.getTime() - Math.max(config.rankingPositionLookbackDays, config.styleLookbackDays) * DAY_MS);
        const recentPlans = await EditorialProductPlacementPlan.find({ createdAt: { $gte: lookback }, decision: 'place_product' }).sort({ createdAt: -1 }).limit(50).lean();
        const document = buildPlanDocument({ brief, productSeedPlan, options, config, recentPlans, now });
        if (!persist) return document;
        await EditorialProductPlacementPlanningService.seedStyleLibrary(config);
        const created = await EditorialProductPlacementPlan.create({
            ...document,
            executionId,
            contentWorkOrderId: brief.contentWorkOrderId || null,
            unifiedContentBriefId: brief.unifiedContentBriefId || null
        });
        if (document.placementStyle !== 'no-product') {
            await ProductPlacementStyleDefinition.updateOne({ styleId: document.placementStyle }, { $set: { lastUsedAt: now }, $inc: { useCount: 1 } });
        }
        return typeof created.toObject === 'function' ? created.toObject() : created;
    }

    static async attachRelations({ planId, executionId, strategyPlanId, blogId }) {
        if (!planId) return;
        const values = {};
        if (executionId) values.executionId = executionId;
        if (strategyPlanId) values.strategyPlanId = strategyPlanId;
        if (blogId) values.blogId = blogId;
        if (Object.keys(values).length) await EditorialProductPlacementPlan.updateOne({ _id: planId }, { $set: values });
    }
}

module.exports = {
    EditorialProductPlacementPlanningService,
    buildPlanDocument,
    chooseRankingPosition,
    hasBestsellerClaim,
    inferAutoStyle,
    rewriteUnsafeRankingTitle,
    validateRankingEvidence
};
