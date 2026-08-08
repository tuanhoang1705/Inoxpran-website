'use strict'

const { Schema, model } = require('mongoose');
const slugify = require('slugify');

const DOCUMENT_NAME = 'BlogPost';
const COLLECTION_NAME = 'Blogs';
const MAX_SEO_SLUG_LENGTH = Number(process.env.BLOG_SLUG_MAX_LENGTH || 80);

const BLOG_CATEGORY_KEYS = ['guide', 'care', 'knowledge', 'trend', 'product', 'design'];
const IMAGE_STATUSES = ['pending_generation', 'needs_review', 'complete', 'rejected', 'failed'];
const IMAGE_REVIEW_STATUSES = ['pending_review', 'approved', 'rejected', 'replaced'];
const BLOG_SOURCE_TYPES = ['manual', 'agentic'];
const CONTENT_ACTIONS = [
    'new',
    'update',
    'expand',
    'merge',
    'metadata_refresh',
    'internal_link_maintenance',
    'content_maintenance',
    'skip',
    ''
];

const imageMetadataSchema = new Schema(
    {
        url: { type: String, default: '' },
        path: { type: String, default: '' },
        alt: { type: String, default: '' },
        title: { type: String, default: '' },
        caption: { type: String, default: '' },
        width: { type: Number, default: 0 },
        height: { type: Number, default: 0 },
        mimeType: { type: String, default: '' },
        sizeBytes: { type: Number, default: 0 },
        sourceType: { type: String, default: '' },
        sourceUrl: { type: String, default: '' },
        license: { type: String, default: '' },
        author: { type: String, default: '' },
        prompt: { type: String, default: '' },
        model: { type: String, default: '' },
        checksum: { type: String, default: '' },
        status: { type: String, enum: IMAGE_STATUSES, default: 'pending_generation' },
        warning: { type: String, default: '' },
        qualityReview: { type: Schema.Types.Mixed, default: null },
        imageId: { type: String, default: '' },
        reviewStatus: {
            type: String,
            enum: IMAGE_REVIEW_STATUSES,
            default: 'pending_review'
        },
        replacementMetadata: { type: Schema.Types.Mixed, default: null }
    },
    { _id: false }
);

const contentImageSchema = new Schema(
    {
        ...imageMetadataSchema.obj,
        afterHeading: { type: String, default: '' },
        headingIndex: { type: Number, default: -1 }
    },
    { _id: false }
);

const blogSchema = new Schema(
    {
        isQaTest: { type: Boolean, default: false, index: true },
        qaBatchId: { type: Schema.Types.ObjectId, ref: 'AgenticBlogQaBatch', default: null, index: true },
        qaCaseId: { type: Schema.Types.ObjectId, ref: 'AgenticBlogQaCase', default: null, index: true },
        qaIteration: { type: Number, default: 0, min: 0, max: 3, index: true },
        environment: { type: String, enum: ['', 'local', 'staging'], default: '' },
        executionMode: { type: String, enum: ['', 'run_now', 'schedule_run_now', 'actual_schedule'], default: '' },
        originalTopicSeed: { type: String, default: '', trim: true, maxlength: 300 },
        normalizedTopicKey: { type: String, default: '', trim: true, maxlength: 320 },
        qaTopicReservationId: { type: String, default: '', trim: true, maxlength: 160 },
        blog_title: { type: String, required: true, trim: true },
        blog_slug: { type: String, required: true, trim: true, unique: true, index: true },
        blog_excerpt: { type: String, required: true, trim: true },
        blog_content: { type: String, required: true },
        contentRevisionHash: { type: String, default: '', trim: true, maxlength: 128, index: true },
        blog_image: { type: String, required: true },
        blog_image_path: { type: String },
        blog_image_variants: { type: Schema.Types.Mixed, default: null },
        coverImage: { type: imageMetadataSchema, default: () => ({}) },
        contentImages: { type: [contentImageSchema], default: [] },
        visualPlan: { type: Schema.Types.Mixed, default: null },
        sourceType: {
            type: String,
            enum: BLOG_SOURCE_TYPES,
            index: true
        },
        generationMetadata: { type: Schema.Types.Mixed, default: null },
        googleIntelSnapshotId: { type: Schema.Types.ObjectId, ref: 'GoogleIntelligenceSnapshot', default: null, index: true },
        googleIntelSnapshotDate: { type: String, default: '', index: true },
        googleIntelStatus: { type: String, default: '' },
        contentOperationsSnapshotId: { type: Schema.Types.ObjectId, ref: 'ContentOperationsDailySnapshot', default: null, index: true },
        contentInventorySnapshotId: { type: Schema.Types.ObjectId, ref: 'ContentInventorySnapshot', default: null, index: true },
        contentOpportunityDecisionId: { type: Schema.Types.ObjectId, ref: 'ContentOpportunityDecision', default: null, index: true },
        contentWorkOrderId: { type: Schema.Types.ObjectId, ref: 'ContentWorkOrder', default: null, index: true },
        unifiedContentBriefId: { type: Schema.Types.ObjectId, ref: 'UnifiedContentBrief', default: null, index: true },
        evidenceMapId: { type: Schema.Types.ObjectId, ref: 'EvidenceMap', default: null, index: true },
        publishReadinessReportId: { type: Schema.Types.ObjectId, ref: 'ContentPublishReadinessReport', default: null, index: true },
        activeRevisionId: { type: Schema.Types.ObjectId, ref: 'BlogRevision', default: null, index: true },
        researchBundleId: { type: Schema.Types.ObjectId, ref: 'ResearchBundle', default: null, index: true },
        editorialStyleProfileId: { type: Schema.Types.ObjectId, ref: 'EditorialStyleProfile', default: null, index: true },
        strategyPlanId: { type: Schema.Types.ObjectId, ref: 'BlogStrategyPlan', default: null, index: true },
        agenticExecutionId: { type: Schema.Types.ObjectId, ref: 'BlogAutomationExecution', default: null, index: true },
        productSeedingEnabled: { type: Boolean, default: false, index: true },
        productSeedingMode: { type: String, enum: ['off', 'auto', 'required'], default: 'off', index: true },
        productSeedingDecision: { type: String, enum: ['no_seed', 'contextual_seed', 'product_led', 'blocked_no_suitable_product', ''], default: '', index: true },
        productCatalogSnapshotId: { type: Schema.Types.ObjectId, ref: 'ProductCatalogSnapshot', default: null, index: true },
        productSeedPlanId: { type: Schema.Types.ObjectId, ref: 'ProductSeedPlan', default: null, index: true },
        editorialProductPlacementPlanId: { type: Schema.Types.ObjectId, ref: 'EditorialProductPlacementPlan', default: null, index: true },
        seededProductIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Product' }], default: [] },
        productSeedingReview: { type: Schema.Types.Mixed, default: null },
        productClaimReview: { type: Schema.Types.Mixed, default: null },
        editorialProductPlacementReview: { type: Schema.Types.Mixed, default: null },
        contentDecision: { type: String, enum: CONTENT_ACTIONS, default: '' },
        contentRole: { type: String, default: '', maxlength: 120, index: true },
        primaryIntent: { type: String, default: '', maxlength: 120, index: true },
        topicSummary: { type: String, default: '', maxlength: 1000 },
        entitySummary: { type: [String], default: [] },
        canonicalUrl: { type: String, default: '', maxlength: 1000 },
        indexability: { type: Schema.Types.Mixed, default: () => ({ index: true, follow: true, determinable: false }) },
        lastReviewedAt: { type: Date, default: null, index: true },
        nextReviewAt: { type: Date, default: null, index: true },
        lifecycleStatus: { type: String, enum: ['legacy', 'planned', 'revision_pending', 'ready', 'published', 'maintenance_due'], default: 'legacy', index: true },
        structuralFingerprint: { type: Schema.Types.Mixed, default: null },
        agenticReviews: { type: Schema.Types.Mixed, default: null },
        imagePipelineStatus: {
            type: String,
            enum: ['pending', 'partial', 'complete', 'failed'],
            default: 'pending',
            index: true
        },
        // Why the article did or did not get a block for the model it names, so a
        // missing product block can be diagnosed from the record alone.
        productMentionEnrichment: {
            applied: { type: Boolean, default: false },
            reason: { type: String, default: '' },
            code: { type: String, default: '' },
            productId: { type: String, default: '' }
        },
        blog_image_crop_state: {
            zoom: { type: Number },
            offsetX: { type: Number },
            offsetY: { type: Number }
        },
        blog_category_key: {
            type: String,
            enum: BLOG_CATEGORY_KEYS,
            default: 'guide',
            index: true
        },
        blog_tags: { type: [String], default: [] },
        blog_author_name: { type: String, trim: true },
        blog_author_avatar: { type: String, trim: true, maxlength: 2 },
        blog_read_time_minutes: { type: Number, default: 1, min: 1 },
        blog_views: { type: Number, default: 0, min: 0 },
        blog_comments_count: { type: Number, default: 0, min: 0 },
        blog_related_post_ids: {
            type: [{ type: Schema.Types.ObjectId, ref: DOCUMENT_NAME }],
            default: []
        },
        blog_seo_title: { type: String, trim: true },
        blog_seo_description: { type: String, trim: true },
        blog_shop: { type: String, trim: true },
        publishedAt: { type: Date, default: null },
        isDraft: { type: Boolean, default: true, index: true },
        isPublished: { type: Boolean, default: false, index: true }
    },
    {
        collection: COLLECTION_NAME,
        timestamps: true
    }
);

blogSchema.index({
    blog_title: 'text',
    blog_excerpt: 'text',
    blog_tags: 'text'
});
blogSchema.index({ qaBatchId: 1, qaCaseId: 1 }, { name: 'qa_blog_batch_case' });
blogSchema.index(
    { qaCaseId: 1, qaIteration: 1 },
    {
        unique: true,
        partialFilterExpression: { isQaTest: true },
        name: 'qa_blog_case_iteration_unique'
    }
);

blogSchema.pre('validate', function (next) {
    if (this.isQaTest === true) {
        const unsafeIndex = this.indexability?.index === true || this.indexability?.follow === true;
        if (
            !this.qaBatchId ||
            !this.qaCaseId ||
            !['local', 'staging'].includes(this.environment) ||
            !['run_now', 'schedule_run_now', 'actual_schedule'].includes(this.executionMode) ||
            !this.originalTopicSeed ||
            !this.normalizedTopicKey ||
            !this.qaTopicReservationId ||
            this.isDraft !== true ||
            this.isPublished === true ||
            this.publishedAt ||
            unsafeIndex
        ) {
            return next(new Error('QA blog violates trusted draft-only and no-index provenance'));
        }
    }
    const source = this.blog_slug || this.blog_title || '';
    const normalized = slugify(
        String(source).replace(/[\u0111\u0110]/g, (char) => (char === '\u0111' ? 'd' : 'D')),
        {
        lower: true,
        strict: true,
        locale: 'vi',
        trim: true
        }
    );
    const seoFriendlySlug = String(normalized || '')
        .slice(0, MAX_SEO_SLUG_LENGTH)
        .replace(/-+$/g, '');
    this.blog_slug = seoFriendlySlug || `blog-${Date.now()}`;
    next();
});

module.exports = {
    blog: model(DOCUMENT_NAME, blogSchema),
    BLOG_CATEGORY_KEYS,
    BLOG_SOURCE_TYPES,
    IMAGE_REVIEW_STATUSES
};
