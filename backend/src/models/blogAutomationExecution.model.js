'use strict'

const { Schema, model } = require('mongoose');

const DOCUMENT_NAME = 'BlogAutomationExecution';
const COLLECTION_NAME = 'BlogAutomationExecutions';

const executionSchema = new Schema(
    {
        scheduleId: {
            type: Schema.Types.ObjectId,
            ref: 'BlogAutomationSchedule',
            default: null,
            index: true
        },
        executionKey: { type: String, required: true, unique: true, index: true },
        status: {
            type: String,
            enum: ['queued', 'running', 'draft_created', 'maintenance_created', 'published', 'completed', 'blocked', 'failed', 'skipped'],
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

module.exports = {
    BlogAutomationExecution: model(DOCUMENT_NAME, executionSchema)
};
