'use strict'

const { Schema, model } = require('mongoose');

const selectedProductSchema = new Schema({
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, required: true },
    slug: { type: String, required: true },
    canonicalUrl: { type: String, required: true },
    category: { type: Schema.Types.Mixed, default: () => ({}) },
    relevanceScore: { type: Number, min: 0, max: 1, required: true },
    scoreBreakdown: { type: Schema.Types.Mixed, default: () => ({}) },
    matchedUserProblems: { type: [String], default: [] },
    allowedClaims: { type: [Schema.Types.Mixed], default: [] },
    forbiddenClaims: { type: [String], default: [] },
    evidence: { type: [Schema.Types.Mixed], default: [] }
}, { _id: false });

const placementSchema = new Schema({
    placementId: { type: String, required: true },
    sectionPurpose: { type: String, required: true },
    afterHeadingKey: { type: String, default: '' },
    placementType: { type: String, enum: ['contextual_example', 'solution_example', 'recommendation_block', 'comparison_row', 'soft_cta'], required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    messageGoal: { type: String, default: '' },
    maxMentions: { type: Number, default: 1, min: 0 },
    linkAllowed: { type: Boolean, default: true },
    requiredDisclosure: { type: Boolean, default: true }
}, { _id: false });

const schema = new Schema({
    executionId: { type: Schema.Types.ObjectId, ref: 'BlogAutomationExecution', default: null, index: true },
    contentWorkOrderId: { type: Schema.Types.ObjectId, ref: 'ContentWorkOrder', default: null, index: true },
    unifiedContentBriefId: { type: Schema.Types.ObjectId, ref: 'UnifiedContentBrief', default: null, index: true },
    blogBriefHash: { type: String, required: true, index: true },
    googleIntelSnapshotId: { type: Schema.Types.ObjectId, ref: 'GoogleIntelligenceSnapshot', required: true, index: true },
    productCatalogSnapshotId: { type: Schema.Types.ObjectId, ref: 'ProductCatalogSnapshot', default: null, index: true },
    mode: { type: String, enum: ['off', 'auto', 'required'], required: true },
    intensity: { type: String, enum: ['light', 'balanced', 'commercial'], required: true },
    decision: { type: String, enum: ['no_seed', 'contextual_seed', 'product_led', 'blocked_no_suitable_product'], required: true, index: true },
    decisionReason: { type: String, required: true, maxlength: 1000 },
    primaryProduct: { type: selectedProductSchema, default: null },
    supportingProducts: { type: [selectedProductSchema], default: [] },
    candidateScores: { type: [Schema.Types.Mixed], default: [] },
    rejectedCandidates: { type: [Schema.Types.Mixed], default: [] },
    placementPlan: { type: [placementSchema], default: [] },
    ctaPlan: { type: Schema.Types.Mixed, default: () => ({ enabled: false, mode: 'none', maxCount: 0, allowedAnchors: [], forbiddenAnchors: [] }) },
    commercialDensityLimits: { type: Schema.Types.Mixed, default: () => ({}) },
    riskFlags: { type: [String], default: [] },
    reviewRequirements: { type: [String], default: [] },
    overrideReason: { type: String, default: '' },
    warnings: { type: [String], default: [] },
    errorCodes: { type: [String], default: [] }
}, { collection: 'ProductSeedPlans', timestamps: true });

schema.index({ createdAt: -1, decision: 1 });

module.exports = { ProductSeedPlan: model('ProductSeedPlan', schema) };
