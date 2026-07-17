'use strict'

const { BLOG_CATEGORY_KEYS } = require('../models/blog.model');
const { BadRequestError } = require('../core/error.response');
const {
    countWords,
    normalizeSlug,
    normalizeString,
    normalizeStringArray,
    sanitizeSeoBlogHtml
} = require('./seoBlogSanitizer');

const DEFAULT_MIN_SEO_SCORE = 85;
const DEFAULT_MIN_WORDS = 800;
const DEFAULT_MAX_WORDS = 1800;
const MAX_TITLE_LENGTH = 120;
const MAX_SEO_TITLE_LENGTH = 60;
const MAX_SEO_DESCRIPTION_LENGTH = 160;

const parseNumber = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const getSeoThresholds = () => ({
    minSeoScore: parseNumber(process.env.SEO_AGENT_MIN_SEO_SCORE, DEFAULT_MIN_SEO_SCORE),
    minWords: parseNumber(process.env.SEO_AGENT_MIN_WORDS, DEFAULT_MIN_WORDS),
    maxWords: parseNumber(process.env.SEO_AGENT_MAX_WORDS, DEFAULT_MAX_WORDS)
});

const parseReview = (value = {}) => ({
    seoScore: parseNumber(value.seoScore, 0),
    brandSafety: normalizeString(value.brandSafety).toLowerCase(),
    duplicateRisk: normalizeString(value.duplicateRisk).toLowerCase(),
    claimRisk: normalizeString(value.claimRisk).toLowerCase(),
    imageSafety: normalizeString(value.imageSafety).toLowerCase(),
    factuality: normalizeString(value.factuality).toLowerCase(),
    originality: normalizeString(value.originality).toLowerCase(),
    peopleFirst: normalizeString(value.peopleFirst).toLowerCase(),
    spamRisk: normalizeString(value.spamRisk).toLowerCase(),
    seoAeoGeo: normalizeString(value.seoAeoGeo).toLowerCase()
});

const isPublishReviewPassing = ({ review, wordCount, thresholds = getSeoThresholds() }) => {
    const reasons = [];

    if (review.seoScore < thresholds.minSeoScore) {
        reasons.push(`seo_score_below_${thresholds.minSeoScore}`);
    }
    if (review.brandSafety !== 'pass') {
        reasons.push('brand_safety_not_pass');
    }
    if (review.duplicateRisk === 'high') {
        reasons.push('duplicate_risk_high');
    }
    if (review.claimRisk === 'high') {
        reasons.push('claim_risk_high');
    }
    if (review.imageSafety !== 'pass') {
        reasons.push('image_safety_not_pass');
    }
    if (review.factuality !== 'pass') reasons.push('factuality_not_pass');
    if (review.originality !== 'pass') reasons.push('originality_not_pass');
    if (review.peopleFirst !== 'pass') reasons.push('people_first_not_pass');
    if (review.spamRisk === 'high') reasons.push('spam_risk_high');
    if (review.seoAeoGeo !== 'pass') reasons.push('seo_aeo_geo_not_pass');
    if (wordCount < thresholds.minWords) {
        reasons.push(`word_count_below_${thresholds.minWords}`);
    }
    if (wordCount > thresholds.maxWords) {
        reasons.push(`word_count_above_${thresholds.maxWords}`);
    }

    return {
        passes: reasons.length === 0,
        reasons
    };
};

const validateAutomationPayload = (payload = {}) => {
    const mode = normalizeString(payload.mode).toLowerCase();
    if (!['draft', 'publish'].includes(mode)) {
        throw new BadRequestError('mode must be draft or publish');
    }

    const source = normalizeString(payload.source);
    if (source !== 'openclaw-daily-seo') {
        throw new BadRequestError('source must be openclaw-daily-seo');
    }

    const title = normalizeString(payload.title);
    if (!title) throw new BadRequestError('title is required');
    if (title.length > MAX_TITLE_LENGTH) {
        throw new BadRequestError(`title must be ${MAX_TITLE_LENGTH} characters or fewer`);
    }

    const slug = normalizeSlug(payload.slug || title);
    if (!slug) throw new BadRequestError('slug is required');

    const excerpt = normalizeString(payload.excerpt);
    if (!excerpt) throw new BadRequestError('excerpt is required');

    const sanitizedContentHtml = sanitizeSeoBlogHtml(payload.contentHtml);
    if (!sanitizedContentHtml) throw new BadRequestError('contentHtml is required');

    const seoTitle = normalizeString(payload.seoTitle);
    if (!seoTitle) throw new BadRequestError('seoTitle is required');
    if (seoTitle.length > MAX_SEO_TITLE_LENGTH) {
        throw new BadRequestError(`seoTitle must be ${MAX_SEO_TITLE_LENGTH} characters or fewer`);
    }

    const seoDescription = normalizeString(payload.seoDescription);
    if (!seoDescription) throw new BadRequestError('seoDescription is required');
    if (seoDescription.length > MAX_SEO_DESCRIPTION_LENGTH) {
        throw new BadRequestError(`seoDescription must be ${MAX_SEO_DESCRIPTION_LENGTH} characters or fewer`);
    }

    const categoryKey = normalizeString(payload.categoryKey || 'guide').toLowerCase();
    if (!BLOG_CATEGORY_KEYS.includes(categoryKey)) {
        throw new BadRequestError(`categoryKey must be one of: ${BLOG_CATEGORY_KEYS.join(', ')}`);
    }

    const review = parseReview(payload.review || {});
    if (!review.brandSafety) throw new BadRequestError('review.brandSafety is required');
    if (!review.duplicateRisk) throw new BadRequestError('review.duplicateRisk is required');
    if (!review.claimRisk) throw new BadRequestError('review.claimRisk is required');
    const requiredContext = [
        'googleIntelSnapshotId',
        'googleIntelSnapshotDate',
        'googleIntelStatus',
        'researchBundleId',
        'editorialStyleProfileId',
        'strategyPlanId',
        'agenticExecutionId'
    ];
    const context = Object.fromEntries(requiredContext.map((key) => [key, normalizeString(payload[key] || payload.metadata?.[key])]));
    const missingContext = requiredContext.filter((key) => !context[key]);
    if (missingContext.length) throw new BadRequestError(`Agentic writer context is missing: ${missingContext.join(', ')}`);

    const productSeedingMode = normalizeString(payload.productSeedingMode || payload.metadata?.productSeedingMode || 'off').toLowerCase();
    if (!['off', 'auto', 'required'].includes(productSeedingMode)) {
        throw new BadRequestError('productSeedingMode must be off, auto, or required');
    }
    const productCatalogSnapshotId = normalizeString(payload.productCatalogSnapshotId || payload.metadata?.productCatalogSnapshotId);
    const productSeedPlanId = normalizeString(payload.productSeedPlanId || payload.metadata?.productSeedPlanId);
    const productSeedingDecision = normalizeString(payload.productSeedingDecision || payload.metadata?.productSeedingDecision || 'no_seed');
    const seededProductIds = normalizeStringArray(payload.seededProductIds, 10);
    const productSeedingReview = payload.productSeedingReview && typeof payload.productSeedingReview === 'object'
        ? payload.productSeedingReview
        : payload.metadata?.productSeedingReview || null;
    const productClaimReview = payload.productClaimReview && typeof payload.productClaimReview === 'object'
        ? payload.productClaimReview
        : payload.metadata?.productClaimReview || null;
    if (productSeedingMode !== 'off') {
        const missingProductContext = [
            !productCatalogSnapshotId ? 'productCatalogSnapshotId' : '',
            !productSeedPlanId ? 'productSeedPlanId' : '',
            !productSeedingReview ? 'productSeedingReview' : '',
            !productClaimReview ? 'productClaimReview' : ''
        ].filter(Boolean);
        if (missingProductContext.length) throw new BadRequestError(`Product writer context is missing: ${missingProductContext.join(', ')}`);
    }

    const wordCount = countWords(sanitizedContentHtml);
    const thresholds = getSeoThresholds();
    const reviewGate = isPublishReviewPassing({ review, wordCount, thresholds });
    if (productSeedingMode !== 'off') {
        if (productSeedingReview?.pass !== true) reviewGate.reasons.push('product_seeding_review_not_pass');
        if (productClaimReview?.pass !== true) reviewGate.reasons.push('product_claim_review_not_pass');
        if (productSeedingReview?.commercialPressure === 'high') reviewGate.reasons.push('product_commercial_pressure_high');
        reviewGate.passes = reviewGate.reasons.length === 0;
    }

    return {
        mode,
        source,
        primaryKeyword: normalizeString(payload.primaryKeyword),
        secondaryKeywords: normalizeStringArray(payload.secondaryKeywords, 12),
        title,
        slug,
        excerpt,
        contentHtml: sanitizedContentHtml,
        seoTitle,
        seoDescription,
        categoryKey,
        tags: normalizeStringArray(payload.tags, 20),
        authorName: normalizeString(payload.authorName || process.env.SEO_AGENT_DEFAULT_AUTHOR || 'Inoxpran Editorial Team'),
        imageUrl: normalizeString(payload.imageUrl || process.env.SEO_AGENT_DEFAULT_BLOG_IMAGE || '/og-image.png'),
        articleType: normalizeString(payload.articleType),
        outline: Array.isArray(payload.outline) ? payload.outline : [],
        internalLinks: Array.isArray(payload.internalLinks) ? payload.internalLinks : [],
        faq: Array.isArray(payload.faq) ? payload.faq : [],
        contentDecision: normalizeString(payload.contentDecision || 'new').toLowerCase(),
        targetBlogId: normalizeString(payload.targetBlogId),
        ...context,
        productCatalogSnapshotId,
        productSeedPlanId,
        productSeedingMode,
        productSeedingDecision,
        seededProductIds,
        productSeedingReview,
        productClaimReview,
        structuralFingerprint: payload.structuralFingerprint && typeof payload.structuralFingerprint === 'object' ? payload.structuralFingerprint : null,
        agenticReviews: payload.agenticReviews && typeof payload.agenticReviews === 'object' ? payload.agenticReviews : null,
        metadata: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {},
        review,
        wordCount,
        thresholds,
        publishGate: reviewGate
    };
};

module.exports = {
    DEFAULT_MAX_WORDS,
    DEFAULT_MIN_SEO_SCORE,
    DEFAULT_MIN_WORDS,
    isPublishReviewPassing,
    parseReview,
    validateAutomationPayload
};
