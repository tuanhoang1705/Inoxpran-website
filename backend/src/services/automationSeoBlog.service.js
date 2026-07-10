'use strict'

const { blog } = require('../models/blog.model');
const { BadRequestError } = require('../core/error.response');
const { normalizeString } = require('../utils/seoBlogSanitizer');
const { validateAutomationPayload } = require('../utils/seoBlogValidation');
const { runImagePipeline } = require('./openclaw/imagePipeline.service');

const WORDS_PER_MINUTE = 220;
const DEFAULT_SITE_URL = 'https://inoxpran.com';

const parseBoolean = (value, fallback = false) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    if (typeof value !== 'string') return fallback;
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const estimateReadTimeMinutes = (wordCount) => Math.max(1, Math.ceil(wordCount / WORDS_PER_MINUTE));

const buildPublicUrl = (slug) => {
    const baseUrl = normalizeString(process.env.PUBLIC_SITE_URL || process.env.APP_BASE_URL || DEFAULT_SITE_URL)
        .replace(/\/+$/g, '');
    return `${baseUrl}/blog/${slug}`;
};

const appendDraftReason = (reasons, reason) => {
    if (!reasons.includes(reason)) reasons.push(reason);
};

const createBlogDocument = ({ normalized, shouldPublish, imagePipeline }) => ({
    sourceType: 'agentic',
    generationMetadata: {
        provider: 'openclaw',
        generatedAt: new Date().toISOString()
    },
    blog_title: normalized.title,
    blog_slug: normalized.slug,
    blog_excerpt: normalized.excerpt,
    blog_content: imagePipeline.contentHtml || normalized.contentHtml,
    blog_image: imagePipeline.coverImage?.url || normalized.imageUrl,
    blog_image_path: imagePipeline.coverImage?.path || '',
    coverImage: imagePipeline.coverImage,
    contentImages: imagePipeline.contentImages,
    visualPlan: imagePipeline.visualPlan,
    imagePipelineStatus: imagePipeline.status,
    blog_category_key: normalized.categoryKey,
    blog_tags: normalized.tags,
    blog_author_name: normalized.authorName,
    blog_author_avatar: 'IP',
    blog_read_time_minutes: estimateReadTimeMinutes(normalized.wordCount),
    blog_views: 0,
    blog_comments_count: 0,
    blog_seo_title: normalized.seoTitle,
    blog_seo_description: normalized.seoDescription,
    blog_shop: 'Inoxpran',
    publishedAt: shouldPublish ? new Date() : null,
    isDraft: !shouldPublish,
    isPublished: shouldPublish
});

class AutomationSeoBlogService {
    static async health() {
        return {
            status: 'ok',
            automation: process.env.SEO_AGENT_ENABLED === 'true',
            autoPublish: parseBoolean(process.env.SEO_AGENT_AUTO_PUBLISH, false),
            time: new Date().toISOString()
        };
    }

    static async publishSeoBlog({ payload = {} }) {
        const normalized = validateAutomationPayload(payload);

        const existing = await blog.findOne({ blog_slug: normalized.slug }).select('_id').lean();
        if (existing) {
            throw new BadRequestError('blog_slug already exists');
        }

        const reasons = [...normalized.publishGate.reasons];
        const requestedPublish = normalized.mode === 'publish';
        const envAutoPublish = parseBoolean(process.env.SEO_AGENT_AUTO_PUBLISH, false);

        if (requestedPublish && !envAutoPublish) {
            appendDraftReason(reasons, 'auto_publish_disabled');
        }
        if (!requestedPublish) {
            appendDraftReason(reasons, 'draft_mode_requested');
        }

        let imagePipeline;
        try {
            imagePipeline = await runImagePipeline({
                title: normalized.title,
                slug: normalized.slug,
                category: normalized.categoryKey,
                summary: normalized.excerpt,
                outline: normalized.outline,
                contentHtml: normalized.contentHtml,
                primaryKeyword: normalized.primaryKeyword,
                articleType: normalized.articleType
            });
        } catch (error) {
            imagePipeline = {
                visualPlan: null,
                coverImage: {
                    url: '',
                    status: 'failed',
                    warning: error?.message || 'image_pipeline_failed'
                },
                contentImages: [],
                contentHtml: normalized.contentHtml,
                status: 'failed',
                warnings: [error?.message || 'image_pipeline_failed'],
                coverReadyForPublish: false,
                publishReady: false
            };
        }

        const requireCover = parseBoolean(process.env.OPENCLAW_REQUIRE_COVER_IMAGE_FOR_PUBLISH, true);
        if (requestedPublish && requireCover && !imagePipeline.coverReadyForPublish) {
            appendDraftReason(reasons, 'cover_image_required_for_publish');
        }
        if (requestedPublish && !imagePipeline.publishReady) {
            appendDraftReason(reasons, 'image_pipeline_not_ready_for_publish');
        }

        const shouldPublish =
            requestedPublish &&
            envAutoPublish &&
            normalized.publishGate.passes &&
            imagePipeline.publishReady &&
            (!requireCover || imagePipeline.coverReadyForPublish);
        let created;
        try {
            created = await blog.create(createBlogDocument({ normalized, shouldPublish, imagePipeline }));
        } catch (error) {
            if (error?.code === 11000) {
                throw new BadRequestError('blog_slug already exists');
            }
            throw error;
        }
        const createdObject = typeof created.toObject === 'function' ? created.toObject() : created;
        const blogId = String(createdObject?._id || createdObject?.id || '');
        const mode = shouldPublish ? 'publish' : 'draft';

        return {
            mode,
            blogId,
            slug: normalized.slug,
            url: buildPublicUrl(normalized.slug),
            seoScore: normalized.review.seoScore,
            published: shouldPublish,
            reasons,
            wordCount: normalized.wordCount,
            metadata: normalized.metadata,
            imagePipelineStatus: imagePipeline.status,
            imageWarnings: imagePipeline.warnings,
            coverImage: imagePipeline.coverImage,
            contentImages: imagePipeline.contentImages
        };
    }
}

module.exports = AutomationSeoBlogService;
