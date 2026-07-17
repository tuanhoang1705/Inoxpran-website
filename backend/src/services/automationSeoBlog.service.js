'use strict'

const crypto = require('node:crypto');
const { blog } = require('../models/blog.model');
const { BlogAutomationExecution } = require('../models/blogAutomationExecution.model');
const { ProductSeedPlan } = require('../models/productSeedPlan.model');
const { ProductSeedExposure } = require('../models/productSeedExposure.model');
const { EditorialProductPlacementPlan } = require('../models/editorialProductPlacementPlan.model');
const { BadRequestError } = require('../core/error.response');
const { normalizeString } = require('../utils/seoBlogSanitizer');
const { validateAutomationPayload } = require('../utils/seoBlogValidation');
const { runImagePipeline } = require('./openclaw/imagePipeline.service');
const { GoogleIntelligenceService } = require('./googleIntelligence.service');
const { AgenticBlogCoreService } = require('./agenticBlogCore.service');
const { ProductSeedPlanningService } = require('./productSeedPlanning.service');
const { EditorialProductPlacementPlanningService } = require('./editorialProductPlacementPlanning.service');
const { extractProductBlocks, reviewProductLayer } = require('./productSeedingReview.service');
const { extractPlacementBlocks, reviewEditorialProductPlacement } = require('./editorialProductPlacementReview.service');

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
    productSeedingEnabled: normalized.productSeedingMode !== 'off',
    productSeedingMode: normalized.productSeedingMode,
    productSeedingDecision: normalized.productSeedingDecision,
    productCatalogSnapshotId: normalized.productCatalogSnapshotId || null,
    productSeedPlanId: normalized.productSeedPlanId || null,
    editorialProductPlacementPlanId: normalized.editorialProductPlacementPlanId || null,
    seededProductIds: normalized.seededProductIds || [],
    productSeedingReview: normalized.productSeedingReview,
    productClaimReview: normalized.productClaimReview,
    editorialProductPlacementReview: normalized.editorialProductPlacementReview,
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
            sourceUrls: Array.isArray(payload.researchSources) ? payload.researchSources : [],
            productSeeding: payload.productSeeding || {},
            productPlacement: payload.productPlacement || {},
            rankingEvidence: payload.rankingEvidence || null,
            language: normalizeString(payload.language || 'vi'),
            categoryKey: normalizeString(payload.categoryKey || 'guide'),
            secondaryKeywords: Array.isArray(payload.secondaryKeywords) ? payload.secondaryKeywords : []
        });
        const execution = await BlogAutomationExecution.create({
            scheduleId: null,
            executionKey: `external:${context.snapshot.snapshotDate}:${crypto.randomUUID()}`,
            status: context.blocked || context.strategy?.decision === 'skip' ? 'skipped' : 'running',
            startedAt: new Date(),
            completedAt: context.blocked || context.strategy?.decision === 'skip' ? new Date() : null,
            googleIntelSnapshotId: context.snapshot.id,
            researchBundleId: context.researchBundle?._id || null,
            editorialStyleProfileId: context.style?._id || null,
            strategyPlanId: context.strategy?._id || null,
            productCatalogSnapshotId: context.productSeedPlan.productCatalogSnapshotId || null,
            productSeedPlanId: context.productSeedPlan._id,
            editorialProductPlacementPlanId: context.editorialPlacementPlan?._id || null,
            productSeedingMode: context.productSeedPlan.mode,
            productSeedingDecision: context.productSeedPlan.decision,
            seededProductIds: [context.productSeedPlan.primaryProduct, ...(context.productSeedPlan.supportingProducts || [])].filter(Boolean).map((item) => item.productId),
            correlationId: crypto.randomUUID(),
            agentSteps: context.blocked
                ? ['google-intelligence-gate', 'product-catalog-snapshot', 'product-relevance-analysis', 'product-seed-plan', 'blocked']
                : context.strategy.decision === 'skip'
                    ? ['google-intelligence-gate', 'product-catalog-snapshot', 'product-relevance-analysis', 'product-seed-plan', 'editorial-product-placement-plan', 'topic-opportunity-research', 'skip']
                    : ['google-intelligence-gate', 'product-catalog-snapshot', 'product-relevance-analysis', 'product-seed-plan', 'editorial-product-placement-plan', 'topic-opportunity-research', 'industry-content-research', 'editorial-style-planning', 'content-strategy-plan', 'content-architecture'],
            publisherDecision: context.blocked || context.strategy?.decision === 'skip'
                ? { allowed: false, reason: context.blocked ? context.blockReason : context.strategy.decisionReason }
                : {},
            metadata: {
                trigger: 'external_prepare', pipelineVersion: 'agentic-blog-core-v4-editorial-product-placement',
                productSeeding: {
                    selectedProducts: [context.productSeedPlan.primaryProduct, ...(context.productSeedPlan.supportingProducts || [])].filter(Boolean),
                    rejectedCandidates: context.productSeedPlan.rejectedCandidates || [],
                    candidateScores: context.productSeedPlan.candidateScores || [],
                    editorialProductPlacementPlanId: context.editorialPlacementPlan?._id || null,
                    placementPlan: context.editorialPlacementPlan?.placementSequence || [],
                    placementStyle: context.editorialPlacementPlan?.placementStyle || 'no-product',
                    warnings: context.productSeedPlan.warnings || []
                }
            }
        });
        await ProductSeedPlanningService.attachExecution({ planId: context.productSeedPlan._id, executionId: execution._id });
        await EditorialProductPlacementPlanningService.attachRelations({ planId: context.editorialPlacementPlan?._id, executionId: execution._id, strategyPlanId: context.strategy?._id });
        if (context.blocked) throw new BadRequestError(context.blockReason || 'Required product integration has no suitable product');
        const selectedProducts = [context.productSeedPlan.primaryProduct, ...(context.productSeedPlan.supportingProducts || [])].filter(Boolean);
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
            productCatalogSnapshotId: context.productSeedPlan.productCatalogSnapshotId ? String(context.productSeedPlan.productCatalogSnapshotId) : '',
            productSeedPlanId: String(context.productSeedPlan._id),
            editorialProductPlacementPlanId: String(context.editorialPlacementPlan?._id || ''),
            productSeeding: {
                mode: context.productSeedPlan.mode,
                intensity: context.productSeedPlan.intensity,
                decision: context.productSeedPlan.decision,
                selectedProducts: selectedProducts.map((item) => ({
                    productId: String(item.productId), name: item.name, slug: item.slug,
                    canonicalUrl: item.canonicalUrl, relevanceScore: item.relevanceScore,
                    allowedClaims: item.allowedClaims
                })),
                placementPlan: context.productSeedPlan.placementPlan || [],
                claimConstraints: selectedProducts.map((item) => ({ productId: String(item.productId), allowedClaims: item.allowedClaims, forbiddenClaims: item.forbiddenClaims })),
                commercialDensityLimits: context.productSeedPlan.commercialDensityLimits || {}
            },
            editorialProductPlacement: context.editorialPlacementPlan ? {
                id: String(context.editorialPlacementPlan._id),
                decision: context.editorialPlacementPlan.decision,
                placementStyle: context.editorialPlacementPlan.placementStyle,
                effectiveTopic: context.editorialPlacementPlan.effectiveTopic,
                ownedProductPositionPolicy: context.editorialPlacementPlan.ownedProductPositionPolicy,
                firstProductMention: context.editorialPlacementPlan.firstProductMention,
                placementSequence: context.editorialPlacementPlan.placementSequence,
                rankingStrategy: context.editorialPlacementPlan.rankingStrategy,
                rankingClaimReview: context.editorialPlacementPlan.rankingClaimReview,
                commercialDensity: context.editorialPlacementPlan.commercialDensity,
                visualPlacement: context.editorialPlacementPlan.visualPlacement,
                disclosure: context.editorialPlacementPlan.disclosure,
                ctaStrategy: context.editorialPlacementPlan.ctaStrategy,
                forbiddenPatterns: context.editorialPlacementPlan.forbiddenPatterns,
                reviewRules: context.editorialPlacementPlan.reviewRules,
                alternativesRejected: context.editorialPlacementPlan.alternativesRejected,
                reason: context.editorialPlacementPlan.reason,
                warnings: context.editorialPlacementPlan.warnings
            } : null,
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

        let verifiedProductPlan = null;
        let verifiedPlacementPlan = null;
        if (normalized.productSeedingMode !== 'off') {
            const [execution, plan, placementPlan] = await Promise.all([
                BlogAutomationExecution.findById(normalized.agenticExecutionId).lean(),
                ProductSeedPlan.findById(normalized.productSeedPlanId).lean(),
                EditorialProductPlacementPlan.findById(normalized.editorialProductPlacementPlanId).lean()
            ]);
            if (!execution) throw new BadRequestError('Agentic execution was not found for product validation');
            if (!plan) throw new BadRequestError('Product Seed Plan was not found');
            if (!placementPlan) throw new BadRequestError('Editorial Product Placement Plan was not found');
            const idChecks = [
                ['productSeedPlanId', execution.productSeedPlanId, normalized.productSeedPlanId],
                ['editorialProductPlacementPlanId', execution.editorialProductPlacementPlanId, normalized.editorialProductPlacementPlanId],
                ['strategyPlanId', execution.strategyPlanId, normalized.strategyPlanId],
                ['productCatalogSnapshotId', execution.productCatalogSnapshotId, normalized.productCatalogSnapshotId],
                ['googleIntelSnapshotId', plan.googleIntelSnapshotId, normalized.googleIntelSnapshotId],
                ['productCatalogSnapshotId', plan.productCatalogSnapshotId, normalized.productCatalogSnapshotId],
                ['placementProductSeedPlanId', placementPlan.productSeedPlanId, normalized.productSeedPlanId],
                ['placementGoogleIntelSnapshotId', placementPlan.googleIntelSnapshotId, normalized.googleIntelSnapshotId],
                ['placementProductCatalogSnapshotId', placementPlan.productCatalogSnapshotId, normalized.productCatalogSnapshotId],
                ['placementStrategyPlanId', placementPlan.strategyPlanId, normalized.strategyPlanId]
            ];
            const mismatch = idChecks.find(([, actual, expected]) => String(actual || '') !== String(expected || ''));
            if (mismatch) throw new BadRequestError(`${mismatch[0]} does not match the current execution and product plan`);
            const plannedIds = new Set([plan.primaryProduct, ...(plan.supportingProducts || [])].filter(Boolean).map((item) => String(item.productId)));
            const referencedIds = extractProductBlocks(normalized.contentHtml).map((item) => item.productId).filter(Boolean);
            const unplanned = referencedIds.find((productId) => !plannedIds.has(String(productId)));
            if (unplanned) throw new BadRequestError(`Draft contains unplanned productId: ${unplanned}`);
            const productReviews = reviewProductLayer({ html: normalized.contentHtml, plan });
            normalized.productSeedingReview = productReviews.productSeedingReview;
            normalized.productClaimReview = productReviews.productClaimReview;
            if (!productReviews.productSeedingReview.pass) appendDraftReason(normalized.publishGate.reasons, 'product_seeding_review_not_pass');
            if (!productReviews.productClaimReview.pass) appendDraftReason(normalized.publishGate.reasons, 'product_claim_review_not_pass');
            if (productReviews.productSeedingReview.commercialPressure === 'high') appendDraftReason(normalized.publishGate.reasons, 'product_commercial_pressure_high');
            const editorialPlacementReview = reviewEditorialProductPlacement({ html: normalized.contentHtml, title: normalized.title, productSeedPlan: plan, placementPlan });
            normalized.editorialProductPlacementReview = editorialPlacementReview;
            if (!editorialPlacementReview.pass) appendDraftReason(normalized.publishGate.reasons, 'editorial_product_placement_review_not_pass');
            if (['high', 'critical'].includes(editorialPlacementReview.riskLevel)) appendDraftReason(normalized.publishGate.reasons, `editorial_product_placement_risk_${editorialPlacementReview.riskLevel}`);
            normalized.publishGate.passes = normalized.publishGate.reasons.length === 0;
            verifiedProductPlan = plan;
            verifiedPlacementPlan = placementPlan;
        } else {
            if (extractProductBlocks(normalized.contentHtml).length || extractPlacementBlocks(normalized.contentHtml).length) {
                throw new BadRequestError('Draft contains a product block while product seeding mode is off');
            }
            if (normalized.editorialProductPlacementPlanId) {
                const placementPlan = await EditorialProductPlacementPlan.findById(normalized.editorialProductPlacementPlanId).lean();
                if (!placementPlan) throw new BadRequestError('Editorial Product Placement Plan was not found');
                if (placementPlan.decision !== 'no_product') throw new BadRequestError('Product seeding mode is off but placement plan authorizes a product');
                if ((normalized.productSeedPlanId && String(placementPlan.productSeedPlanId || '') !== String(normalized.productSeedPlanId)) || String(placementPlan.googleIntelSnapshotId || '') !== String(normalized.googleIntelSnapshotId) || String(placementPlan.strategyPlanId || '') !== String(normalized.strategyPlanId)) {
                    throw new BadRequestError('Editorial Product Placement Plan does not match the current snapshot and strategy');
                }
                normalized.editorialProductPlacementReview = reviewEditorialProductPlacement({ html: normalized.contentHtml, title: normalized.title, productSeedPlan: { mode: 'off', decision: 'no_seed' }, placementPlan });
                verifiedPlacementPlan = placementPlan;
            }
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
                imageSearchQuery: normalizeString(payload.imageSearchQuery || ''),
                editorialProductPlacement: verifiedPlacementPlan
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

        if (verifiedPlacementPlan && blogId) {
            await EditorialProductPlacementPlanningService.attachRelations({ planId: verifiedPlacementPlan._id, executionId: normalized.agenticExecutionId, strategyPlanId: normalized.strategyPlanId, blogId });
        }

        if (verifiedProductPlan && blogId) {
            const blocks = extractPlacementBlocks(normalized.contentHtml);
            const selected = [verifiedProductPlan.primaryProduct, ...(verifiedProductPlan.supportingProducts || [])].filter(Boolean);
            await Promise.all(selected.map((item) => {
                const productBlocks = blocks.filter((block) => String(block.productId) === String(item.productId));
                const mentionCount = productBlocks.reduce((sum, block) => sum + (block.text.match(new RegExp(String(item.name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length, 0);
                const linkCount = productBlocks.reduce((sum, block) => sum + block.links.filter((link) => link.linkType === 'product').length, 0);
                return ProductSeedExposure.updateOne(
                    { productId: item.productId, blogId },
                    {
                        $set: {
                            executionId: normalized.agenticExecutionId,
                            categoryKey: item.category?.id || '',
                            articleType: normalized.articleType,
                            placementTypes: (verifiedPlacementPlan?.placementSequence || []).filter((placement) => String(placement.productId) === String(item.productId)).map((placement) => placement.presentation),
                            placementFingerprint: crypto.createHash('sha256').update(JSON.stringify(verifiedPlacementPlan?.placementSequence || [])).digest('hex'),
                            editorialProductPlacementPlanId: verifiedPlacementPlan?._id || null,
                            placementStyle: verifiedPlacementPlan?.placementStyle || '',
                            ownedProductPosition: verifiedPlacementPlan?.ownedProductPositionPolicy || 'none',
                            firstMentionPercent: normalized.editorialProductPlacementReview?.firstProductMention?.progressPercent || 0,
                            productBlockCount: productBlocks.length,
                            productImageCount: normalized.editorialProductPlacementReview?.metrics?.productImages || 0,
                            mentionCount,
                            linkCount,
                            ctaMode: verifiedProductPlan.ctaPlan?.mode || 'none',
                            publishedAt: shouldPublish ? new Date() : null
                        }
                    },
                    { upsert: true }
                );
            }));
        }

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
                    productSeedingReview: normalized.productSeedingReview,
                    productClaimReview: normalized.productClaimReview,
                    editorialProductPlacementReview: normalized.editorialProductPlacementReview,
                    publisherDecision: { allowed: shouldPublish, reasons },
                    'metadata.resultReasons': reasons,
                    'metadata.imagePipelineStatus': imagePipeline.status,
                    'metadata.editorialProductPlacementPlanId': normalized.editorialProductPlacementPlanId || '',
                    'metadata.editorialProductPlacementReview': normalized.editorialProductPlacementReview || null
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
            editorialProductPlacementPlanId: normalized.editorialProductPlacementPlanId || '',
            editorialProductPlacementReview: normalized.editorialProductPlacementReview,
            updatedExisting: isUpdate
        };
    }
}

module.exports = AutomationSeoBlogService;
