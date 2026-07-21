'use strict'

const { Schema, model } = require('mongoose');

const schema = new Schema({
    executionId: { type: Schema.Types.ObjectId, ref: 'BlogAutomationExecution', default: null, index: true },
    contentWorkOrderId: { type: Schema.Types.ObjectId, ref: 'ContentWorkOrder', default: null, index: true },
    unifiedContentBriefId: { type: Schema.Types.ObjectId, ref: 'UnifiedContentBrief', default: null, index: true },
    blogId: { type: Schema.Types.ObjectId, ref: 'BlogPost', default: null, index: true },
    strategyPlanId: { type: Schema.Types.ObjectId, ref: 'BlogStrategyPlan', default: null, index: true },
    productSeedPlanId: { type: Schema.Types.ObjectId, ref: 'ProductSeedPlan', required: true, index: true },
    googleIntelSnapshotId: { type: Schema.Types.ObjectId, ref: 'GoogleIntelligenceSnapshot', required: true, index: true },
    productCatalogSnapshotId: { type: Schema.Types.ObjectId, ref: 'ProductCatalogSnapshot', default: null, index: true },
    decision: { type: String, enum: ['place_product', 'no_product'], required: true, index: true },
    placementStyle: { type: String, required: true, index: true },
    articleType: { type: String, default: '', index: true },
    contentRole: { type: String, default: '' },
    searchIntent: { type: Schema.Types.Mixed, default: () => ({}) },
    effectiveTopic: { type: String, required: true, maxlength: 300 },
    rankingClaimReview: { type: Schema.Types.Mixed, default: () => ({}) },
    ownedProductPositionPolicy: { type: String, enum: ['none', 'first', 'last'], default: 'none', index: true },
    firstProductMention: { type: Schema.Types.Mixed, default: () => ({}) },
    placementSequence: { type: [Schema.Types.Mixed], default: [] },
    rankingStrategy: { type: Schema.Types.Mixed, default: () => ({}) },
    commercialDensity: { type: Schema.Types.Mixed, default: () => ({}) },
    visualPlacement: { type: Schema.Types.Mixed, default: () => ({}) },
    disclosure: { type: Schema.Types.Mixed, default: () => ({}) },
    ctaStrategy: { type: Schema.Types.Mixed, default: () => ({}) },
    forbiddenPatterns: { type: [String], default: [] },
    reviewRules: { type: [String], default: [] },
    alternativesRejected: { type: [Schema.Types.Mixed], default: [] },
    reason: { type: String, required: true, maxlength: 1200 },
    warnings: { type: [String], default: [] },
    review: { type: Schema.Types.Mixed, default: null }
}, { collection: 'EditorialProductPlacementPlans', timestamps: true });

schema.index({ createdAt: -1, placementStyle: 1 });

module.exports = { EditorialProductPlacementPlan: model('EditorialProductPlacementPlan', schema) };
