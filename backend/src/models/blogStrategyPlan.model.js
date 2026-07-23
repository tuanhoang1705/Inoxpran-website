'use strict'

const { Schema, model } = require('mongoose');

const strategyPlanSchema = new Schema(
    {
        isQaTest: { type: Boolean, default: false, index: true },
        qaBatchId: { type: Schema.Types.ObjectId, ref: 'AgenticBlogQaBatch', default: null, index: true },
        qaCaseId: { type: Schema.Types.ObjectId, ref: 'AgenticBlogQaCase', default: null, index: true },
        environment: { type: String, enum: ['', 'local', 'staging'], default: '' },
        executionMode: { type: String, enum: ['', 'run_now', 'schedule_run_now', 'actual_schedule'], default: '' },
        originalTopicSeed: { type: String, default: '', maxlength: 300 },
        normalizedTopicKey: { type: String, default: '', maxlength: 320 },
        googleIntelSnapshotId: { type: Schema.Types.ObjectId, ref: 'GoogleIntelligenceSnapshot', required: true, index: true },
        contentWorkOrderId: { type: Schema.Types.ObjectId, ref: 'ContentWorkOrder', default: null, index: true },
        unifiedContentBriefId: { type: Schema.Types.ObjectId, ref: 'UnifiedContentBrief', default: null, index: true },
        evidenceMapId: { type: Schema.Types.ObjectId, ref: 'EvidenceMap', default: null, index: true },
        productCatalogSnapshotId: { type: Schema.Types.ObjectId, ref: 'ProductCatalogSnapshot', default: null, index: true },
        productSeedPlanId: { type: Schema.Types.ObjectId, ref: 'ProductSeedPlan', default: null, index: true },
        editorialProductPlacementPlanId: { type: Schema.Types.ObjectId, ref: 'EditorialProductPlacementPlan', default: null, index: true },
        productPlacementStyle: { type: String, default: '', index: true },
        productSeedingMode: { type: String, enum: ['off', 'auto', 'required'], default: 'off' },
        productSeedingDecision: { type: String, enum: ['no_seed', 'contextual_seed', 'product_led', 'blocked_no_suitable_product'], default: 'no_seed' },
        selectedProductIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Product' }], default: [] },
        productPlacementConstraints: { type: [Schema.Types.Mixed], default: [] },
        productClaimEvidence: { type: [Schema.Types.Mixed], default: [] },
        commercialDensityLimit: { type: Schema.Types.Mixed, default: () => ({}) },
        productReviewPlan: { type: Schema.Types.Mixed, default: () => ({}) },
        topic: { type: String, required: true, maxlength: 300 },
        decision: { type: String, enum: ['new', 'update', 'expand', 'merge', 'metadata_refresh', 'internal_link_maintenance', 'content_maintenance', 'skip'], required: true, index: true },
        decisionReason: { type: String, required: true, maxlength: 1000 },
        targetBlogIds: { type: [{ type: Schema.Types.ObjectId, ref: 'BlogPost' }], default: [] },
        targetAudience: { type: String, required: true },
        searchIntent: { type: Schema.Types.Mixed, required: true },
        userProblems: { type: [String], default: [] },
        contentGap: { type: String, default: '' },
        primaryQuestion: { type: String, required: true },
        supportingQuestions: { type: [String], default: [] },
        articleType: { type: String, required: true },
        editorialStyleProfileId: { type: Schema.Types.ObjectId, ref: 'EditorialStyleProfile', required: true, index: true },
        researchBundleId: { type: Schema.Types.ObjectId, ref: 'ResearchBundle', required: true, index: true },
        evidenceRequirements: { type: [String], default: [] },
        internalLinks: { type: [Schema.Types.Mixed], default: [] },
        imagePlan: { type: Schema.Types.Mixed, default: () => ({}) },
        structuredDataCandidate: { type: String, default: 'Article' },
        riskFlags: { type: [String], default: [] },
        successCriteria: { type: [String], default: [] },
        contentArchitecture: { type: Schema.Types.Mixed, default: () => ({}) },
        reviewerPlan: { type: Schema.Types.Mixed, default: () => ({}) }
    },
    { collection: 'BlogStrategyPlans', timestamps: true }
);

strategyPlanSchema.index({ qaBatchId: 1, qaCaseId: 1 }, { name: 'qa_blog_strategy_plan' });

module.exports = { BlogStrategyPlan: model('BlogStrategyPlan', strategyPlanSchema) };
