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
    claimRisk: normalizeString(value.claimRisk).toLowerCase()
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

    const wordCount = countWords(sanitizedContentHtml);
    const thresholds = getSeoThresholds();
    const reviewGate = isPublishReviewPassing({ review, wordCount, thresholds });

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
        imageUrl: normalizeString(payload.imageUrl || process.env.SEO_AGENT_DEFAULT_BLOG_IMAGE || '/images/og-image.png'),
        internalLinks: Array.isArray(payload.internalLinks) ? payload.internalLinks : [],
        faq: Array.isArray(payload.faq) ? payload.faq : [],
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
