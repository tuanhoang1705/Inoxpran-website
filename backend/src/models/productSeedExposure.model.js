'use strict'

const { Schema, model } = require('mongoose');

const schema = new Schema({
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    categoryKey: { type: String, default: '', index: true },
    blogId: { type: Schema.Types.ObjectId, ref: 'BlogPost', required: true, index: true },
    executionId: { type: Schema.Types.ObjectId, ref: 'BlogAutomationExecution', required: true, index: true },
    articleType: { type: String, default: '', index: true },
    placementTypes: { type: [String], default: [] },
    placementFingerprint: { type: String, default: '', index: true },
    editorialProductPlacementPlanId: { type: Schema.Types.ObjectId, ref: 'EditorialProductPlacementPlan', default: null, index: true },
    placementStyle: { type: String, default: '', index: true },
    ownedProductPosition: { type: String, enum: ['', 'none', 'first', 'last'], default: '', index: true },
    firstMentionPercent: { type: Number, default: 0, min: 0, max: 100 },
    productBlockCount: { type: Number, default: 0, min: 0 },
    productImageCount: { type: Number, default: 0, min: 0 },
    mentionCount: { type: Number, default: 0, min: 0 },
    linkCount: { type: Number, default: 0, min: 0 },
    ctaMode: { type: String, default: 'none', index: true },
    publishedAt: { type: Date, default: null, index: true }
}, { collection: 'ProductSeedExposures', timestamps: true });

schema.index({ productId: 1, createdAt: -1 });
schema.index({ categoryKey: 1, createdAt: -1 });

module.exports = { ProductSeedExposure: model('ProductSeedExposure', schema) };
