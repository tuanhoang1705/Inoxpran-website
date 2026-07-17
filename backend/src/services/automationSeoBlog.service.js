'use strict'

const crypto = require('node:crypto');
const { blog } = require('../models/blog.model');
const { BlogAutomationExecution } = require('../models/blogAutomationExecution.model');
const { BadRequestError } = require('../core/error.response');
const { normalizeString } = require('../utils/seoBlogSanitizer');
const { validateAutomationPayload } = require('../utils/seoBlogValidation');
const { runImagePipeline } = require('./openclaw/imagePipeline.service');
const { GoogleIntelligenceService } = require('./googleIntelligence.service');
const { AgenticBlogCoreService } = require('./agenticBlogCore.service');

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
        generatedAt: new Date().toISOString(),
        pipelineVersion: 'agentic-blog-core-v2',
        ...normalized.metadata
    },
    googleIntelSnapshotId: normalized.googleIntelSnapshotId,
    googleIntelSnapshotDate: normalized.googleIntelSnapshotDate,
    googleIntelStatus: normalized.googleIntelStatus,
    researchBundleId: normalized.researchBundleId,
    editorialStyleProfileId: normalized.editorialStyleProfileId,
    strategyPlanId: normalized.strategyPlanId,
    agenticExecutionId: normalized.agenticExecutionId,
    contentDecision: normalized.contentDecision,
    structuralFingerprint: normalized.structuralFingerprint,
    agenticReviews: normalized.agenticReviews,
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

    static async prepareAgenticContext({ payload = {} }) {
        const topic = normalizeString(payload.topic || payload.primaryKeyword);
        if (!topic) throw new BadRequestError('topic is required');
        const context = await AgenticBlogCoreService.prepareContext({
            topic,
            primaryKeyword: normalizeString(payload.primaryKeyword || topic),
            articleType: normalizeString(payload.articleType),
            sourceUrls: Array.isArray(payload.researchSources) ? payload.researchSources : []
        });
        const execution = await BlogAutomationExecution.create({
            scheduleId: null,
            executionKey: `external:${context.snapshot.snapshotDate}:${crypto.randomUUID()}`,
            status: context.strategy.decision === 'skip' ? 'skipped' : 'running',
            startedAt: new Date(),
            completedAt: context.strategy.decision === 'skip' ? new Date() : null,
            googleIntelSnapshotId: context.snapshot.id,
            researchBundleId: context.researchBundle._id,
            editorialStyleProfileId: context.style._id,
            strategyPlanId: context.strategy._id,
            correlationId: crypto.randomUUID(),
            agentSteps: context.strategy.decision === 'skip'
                ? ['google-intelligence-gate', 'topic-opportunity-research', 'skip']
                : ['google-intelligence-gate', 'topic-opportunity-research', 'industry-content-research', 'editorial-style-planning', 'content-strategy-plan', 'content-architecture'],
            publisherDecision: context.strategy.decision === 'skip' ? { allowed: false, reason: context.strategy.decisionReason } : {},
            metadata: { trigger: 'external_prepare', pipelineVersion: 'agentic-blog-core-v2' }
        });
        return {
            googleIntelSnapshotId: context.snapshot.id,
            googleIntelSnapshotDate: context.snapshot.snapshotDate,
            googleIntelStatus: context.snapshot.status,
            googleGuidance: context.snapshot.contentGuidance,
            researchBundleId: String(context.researchBundle._id),
            researchCoverage: context.researchBundle.researchCoverage,
            editorialPatterns: context.researchBundle.editorialPatterns,
            editorialStyleProfileId: String(context.style._id),
            editorialStyle: {
                styleFamily: context.style.styleFamily,
                openingMode: context.style.openingMode,
                headingMode: context.style.headingMode,
                paragraphRhythm: context.style.paragraphRhythm,
                evidenceMode: context.style.evidenceMode,
                ctaMode: context.style.ctaMode,
                forbiddenRecentPatterns: context.style.forbiddenRecentPatterns,
                brandVoiceConstraints: context.style.brandVoiceConstraints,
                activeVariant: context.style.activeVariant
            },
            strategyPlanId: String(context.strategy._id),
            agenticExecutionId: String(execution._id),
            strategy: {
                decision: context.strategy.decision,
                decisionReason: context.strategy.decisionReason,
                targetBlogIds: (context.strategy.targetBlogIds || []).map(String),
                searchIntent: context.strategy.searchIntent,
                primaryQuestion: context.strategy.primaryQuestion,
                supportingQuestions: context.strategy.supportingQuestions,
                articleType: context.strategy.articleType,
                evidenceRequirements: context.strategy.evidenceRequirements,
                riskFlags: context.strategy.riskFlags,
                contentArchitecture: context.strategy.contentArchitecture
            }
        };
    }

    static async publishSeoBlog({ payload = {} }) {
        const normalized = validateAutomationPayload(payload);
        const currentSnapshot = await GoogleIntelligenceService.ensureGoogleIntelligenceSnapshotForDate();
        if (String(currentSnapshot.id) !== String(normalized.googleIntelSnapshotId)) {
            throw new BadRequestError('googleIntelSnapshotId does not match the current daily snapshot');
        }
        if (String(currentSnapshot.snapshotDate) !== String(normalized.googleIntelSnapshotDate)) {
            throw new BadRequestError('googleIntelSnapshotDate does not match the current daily snapshot');
        }

        const existing = await blog.findOne({ blog_slug: normalized.slug }).select('_id').lean();
        const isUpdate = ['update', 'merge'].includes(normalized.contentDecision);
        if (existing && (!isUpdate || String(existing._id) !== String(normalized.targetBlogId))) {
            throw new BadRequestError('blog_slug already exists');
        }
        if (isUpdate && !normalized.targetBlogId) throw new BadRequestError('targetBlogId is required for update or merge');

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
                articleType: normalized.articleType,
                imageSearchQuery: normalizeString(payload.imageSearchQuery || '')
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
            const document = createBlogDocument({ normalized, shouldPublish, imagePipeline });
            created = isUpdate
                ? await blog.findByIdAndUpdate(normalized.targetBlogId, { $set: document }, { new: true, runValidators: true })
                : await blog.create(document);
            if (!created) throw new BadRequestError('Target blog for update or merge was not found');
        } catch (error) {
            if (error?.code === 11000) {
                throw new BadRequestError('blog_slug already exists');
            }
            throw error;
        }
        const createdObject = typeof created.toObject === 'function' ? created.toObject() : created;
        const blogId = String(createdObject?._id || createdObject?.id || '');
        const mode = shouldPublish ? 'publish' : 'draft';

        await BlogAutomationExecution.updateOne(
            { _id: normalized.agenticExecutionId },
            {
                $set: {
                    status: shouldPublish ? 'published' : 'draft_created',
                    completedAt: new Date(),
                    blogId,
                    blogSlug: normalized.slug,
                    blogTitle: normalized.title,
                    mode,
                    reviewerDecisions: normalized.agenticReviews || normalized.metadata?.reviewerDecisions || {},
                    publisherDecision: { allowed: shouldPublish, reasons },
                    'metadata.resultReasons': reasons,
                    'metadata.imagePipelineStatus': imagePipeline.status
                }
            }
        );

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
            contentImages: imagePipeline.contentImages,
            contentDecision: normalized.contentDecision,
            updatedExisting: isUpdate
        };
    }
}

module.exports = AutomationSeoBlogService;
