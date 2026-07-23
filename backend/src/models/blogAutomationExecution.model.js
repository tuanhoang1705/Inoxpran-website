'use strict'

const { Schema, model } = require('mongoose');

const DOCUMENT_NAME = 'BlogAutomationExecution';
const COLLECTION_NAME = 'BlogAutomationExecutions';

const executionSchema = new Schema(
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
        scheduleId: {
            type: Schema.Types.ObjectId,
            ref: 'BlogAutomationSchedule',
            default: null,
            index: true
        },
        executionKey: { type: String, required: true, unique: true, index: true },
        status: {
            type: String,
            enum: ['queued', 'running', 'committing', 'draft_created', 'maintenance_created', 'published', 'completed', 'blocked', 'failed', 'skipped'],
            default: 'queued',
            index: true
        },
        startedAt: { type: Date, default: null },
        completedAt: { type: Date, default: null },
        blogId: { type: Schema.Types.ObjectId, ref: 'BlogPost', default: null, index: true },
        blogSlug: { type: String, default: '' },
        blogTitle: { type: String, default: '' },
        mode: { type: String, default: 'draft' },
        error: { type: String, default: '' },
        retryCount: { type: Number, default: 0, min: 0 },
        telegramNotificationStatus: { type: String, default: '' },
        telegramNotificationType: { type: String, default: '' },
        telegramNotificationError: { type: String, default: '' },
        metadata: { type: Schema.Types.Mixed, default: () => ({}) },
        googleIntelSnapshotId: { type: Schema.Types.ObjectId, ref: 'GoogleIntelligenceSnapshot', default: null, index: true },
        contentOperationsSnapshotId: { type: Schema.Types.ObjectId, ref: 'ContentOperationsDailySnapshot', default: null, index: true },
        contentInventorySnapshotId: { type: Schema.Types.ObjectId, ref: 'ContentInventorySnapshot', default: null, index: true },
        contentOpportunityDecisionId: { type: Schema.Types.ObjectId, ref: 'ContentOpportunityDecision', default: null, index: true },
        contentWorkOrderId: { type: Schema.Types.ObjectId, ref: 'ContentWorkOrder', default: null, index: true },
        unifiedContentBriefId: { type: Schema.Types.ObjectId, ref: 'UnifiedContentBrief', default: null, index: true },
        evidenceMapId: { type: Schema.Types.ObjectId, ref: 'EvidenceMap', default: null, index: true },
        blogRevisionId: { type: Schema.Types.ObjectId, ref: 'BlogRevision', default: null, index: true },
        publishReadinessReportId: { type: Schema.Types.ObjectId, ref: 'ContentPublishReadinessReport', default: null, index: true },
        postPublishVerificationId: { type: Schema.Types.ObjectId, ref: 'PostPublishVerification', default: null, index: true },
        researchBundleId: { type: Schema.Types.ObjectId, ref: 'ResearchBundle', default: null },
        editorialStyleProfileId: { type: Schema.Types.ObjectId, ref: 'EditorialStyleProfile', default: null },
        strategyPlanId: { type: Schema.Types.ObjectId, ref: 'BlogStrategyPlan', default: null },
        productCatalogSnapshotId: { type: Schema.Types.ObjectId, ref: 'ProductCatalogSnapshot', default: null, index: true },
        productSeedPlanId: { type: Schema.Types.ObjectId, ref: 'ProductSeedPlan', default: null, index: true },
        editorialProductPlacementPlanId: { type: Schema.Types.ObjectId, ref: 'EditorialProductPlacementPlan', default: null, index: true },
        productSeedingMode: { type: String, enum: ['off', 'auto', 'required'], default: 'off', index: true },
        productSeedingDecision: { type: String, enum: ['no_seed', 'contextual_seed', 'product_led', 'blocked_no_suitable_product', ''], default: '', index: true },
        seededProductIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Product' }], default: [] },
        productSeedingReview: { type: Schema.Types.Mixed, default: null },
        productClaimReview: { type: Schema.Types.Mixed, default: null },
        editorialProductPlacementReview: { type: Schema.Types.Mixed, default: null },
        correlationId: { type: String, default: '', index: true },
        contentAction: { type: String, enum: ['new', 'update', 'expand', 'merge', 'metadata_refresh', 'internal_link_maintenance', 'content_maintenance', 'skip', ''], default: '', index: true },
        opportunityCandidates: { type: [Schema.Types.Mixed], default: [] },
        rejectedDecisions: { type: [Schema.Types.Mixed], default: [] },
        sourceHealth: { type: Schema.Types.Mixed, default: () => ({}) },
        sourceFreshness: { type: Schema.Types.Mixed, default: () => ({}) },
        overrideReason: { type: String, default: '', maxlength: 1000 },
        publishReadiness: { type: Schema.Types.Mixed, default: null },
        postPublishVerification: { type: Schema.Types.Mixed, default: null },
        monitoringTasks: { type: [Schema.Types.Mixed], default: [] },
        learningRecommendations: { type: [Schema.Types.Mixed], default: [] },
        agentSteps: { type: [Schema.Types.Mixed], default: [] },
        reviewerDecisions: { type: Schema.Types.Mixed, default: () => ({}) },
        publisherDecision: { type: Schema.Types.Mixed, default: () => ({}) }
    },
    {
        collection: COLLECTION_NAME,
        timestamps: true
    }
);

executionSchema.index({ scheduleId: 1, createdAt: -1 });
executionSchema.index({ status: 1, createdAt: -1 });
executionSchema.index({ qaBatchId: 1, qaCaseId: 1, createdAt: -1 }, { name: 'qa_execution_batch_case' });
executionSchema.index({ qaCaseId: 1, qaIteration: 1, createdAt: -1 }, { name: 'qa_execution_case_iteration' });

executionSchema.pre('validate', function validateQaExecution(next) {
    if (this.isQaTest !== true) return next();
    if (
        !this.qaBatchId ||
        !this.qaCaseId ||
        !['local', 'staging'].includes(this.environment) ||
        !['run_now', 'schedule_run_now', 'actual_schedule'].includes(this.executionMode) ||
        !this.originalTopicSeed ||
        !this.normalizedTopicKey ||
        !this.qaTopicReservationId ||
        this.mode === 'publish'
    ) {
        return next(new Error('QA execution violates trusted draft-only provenance'));
    }
    next();
});

module.exports = {
    BlogAutomationExecution: model(DOCUMENT_NAME, executionSchema)
};
