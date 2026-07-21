'use strict'

const { Schema, model } = require('mongoose');
const { ACTIONS } = require('../config/contentOperations.config');

const WORK_ORDER_STATUSES = Object.freeze([
    'planned', 'approved', 'researching', 'brief_ready', 'drafting', 'reviewing',
    'blocked', 'completed', 'cancelled', 'paused'
]);
const RUNNABLE_WORK_ORDER_STATUSES = Object.freeze(['planned', 'approved', 'brief_ready']);
const BUSINESS_GOALS = Object.freeze([
    'organic_traffic', 'customer_education', 'product_education', 'conversion_assist',
    'campaign_support', 'sales_enablement', 'customer_support_reduction', 'topical_authority',
    'seasonal_demand', 'content_maintenance', 'internal_link_improvement'
]);

const contentWorkOrderSchema = new Schema(
    {
        contentOperationsSnapshotId: { type: Schema.Types.ObjectId, ref: 'ContentOperationsDailySnapshot', required: true, index: true },
        googleIntelSnapshotId: { type: Schema.Types.ObjectId, ref: 'GoogleIntelligenceSnapshot', required: true, index: true },
        contentOpportunityDecisionId: { type: Schema.Types.ObjectId, ref: 'ContentOpportunityDecision', required: true, unique: true, index: true },
        decision: { type: String, enum: Object.values(ACTIONS), required: true, index: true },
        status: { type: String, enum: WORK_ORDER_STATUSES, default: 'planned', index: true },
        priority: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium', index: true },
        topic: { type: String, default: '', trim: true, maxlength: 300 },
        topicLocked: { type: Boolean, default: false, index: true },
        targetBlogId: { type: Schema.Types.ObjectId, ref: 'BlogPost', default: null, index: true },
        mergeSourceBlogIds: { type: [{ type: Schema.Types.ObjectId, ref: 'BlogPost' }], default: [] },
        primaryBusinessGoal: { type: String, enum: BUSINESS_GOALS, required: true, index: true },
        secondaryBusinessGoals: { type: [{ type: String, enum: BUSINESS_GOALS }], default: [] },
        targetAudience: { type: [String], default: [] },
        funnelStage: { type: String, default: '', trim: true, maxlength: 100 },
        primarySearchIntent: { type: String, default: '', trim: true, maxlength: 300 },
        secondarySearchIntents: { type: [String], default: [] },
        userProblems: { type: [String], default: [] },
        customerQuestions: { type: [String], default: [] },
        opportunityScore: { type: Number, required: true, min: 0, max: 1 },
        scoreBreakdown: { type: Schema.Types.Mixed, default: () => ({}) },
        requiredSources: { type: [Schema.Types.Mixed], default: [] },
        requiredEvidence: { type: [Schema.Types.Mixed], default: [] },
        productIntegrationPolicy: { type: Schema.Types.Mixed, default: () => ({ mode: 'off' }) },
        targetPublishDate: { type: Date, default: null },
        owner: { type: Schema.Types.ObjectId, ref: 'Admin', default: null },
        reviewer: { type: Schema.Types.ObjectId, ref: 'Admin', default: null },
        successMetrics: { type: [Schema.Types.Mixed], default: [] },
        risks: { type: [String], default: [] },
        warnings: { type: [String], default: [] },
        decisionReason: { type: String, required: true, trim: true, maxlength: 2000 },
        overrideReason: { type: String, default: null, trim: true, maxlength: 2000 },
        artifactIds: { type: Schema.Types.Mixed, default: () => ({}) },
        lockedAt: { type: Date, default: null },
        metadata: { type: Schema.Types.Mixed, default: () => ({}) }
    },
    { collection: 'ContentWorkOrders', timestamps: true }
);

contentWorkOrderSchema.index({ status: 1, targetPublishDate: 1, createdAt: 1 });
contentWorkOrderSchema.index({ decision: 1, targetBlogId: 1, createdAt: -1 });

module.exports = {
    BUSINESS_GOALS,
    RUNNABLE_WORK_ORDER_STATUSES,
    WORK_ORDER_STATUSES,
    ContentWorkOrder: model('ContentWorkOrder', contentWorkOrderSchema)
};
