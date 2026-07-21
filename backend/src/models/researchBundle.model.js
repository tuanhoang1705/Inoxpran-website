'use strict'

const { Schema, model } = require('mongoose');

const researchBundleSchema = new Schema(
    {
        contentWorkOrderId: { type: Schema.Types.ObjectId, ref: 'ContentWorkOrder', default: null, index: true },
        unifiedContentBriefId: { type: Schema.Types.ObjectId, ref: 'UnifiedContentBrief', default: null, index: true },
        evidenceMapId: { type: Schema.Types.ObjectId, ref: 'EvidenceMap', default: null, index: true },
        topic: { type: String, required: true, trim: true, maxlength: 300, index: true },
        sources: { type: [Schema.Types.Mixed], default: [] },
        researchCoverage: { type: String, enum: ['high', 'medium', 'low'], default: 'low' },
        editorialPatterns: { type: Schema.Types.Mixed, default: () => ({}) },
        facts: { type: [Schema.Types.Mixed], default: [] },
        sourceAttributions: { type: [Schema.Types.Mixed], default: [] },
        copyrightReview: { type: Schema.Types.Mixed, default: () => ({}) },
        searchConsole: { type: Schema.Types.Mixed, default: () => ({ configured: false, fallback: true }) },
        contentHash: { type: String, required: true, index: true }
    },
    { collection: 'ResearchBundles', timestamps: true }
);

researchBundleSchema.index({ createdAt: -1, topic: 1 });

module.exports = { ResearchBundle: model('ResearchBundle', researchBundleSchema) };
