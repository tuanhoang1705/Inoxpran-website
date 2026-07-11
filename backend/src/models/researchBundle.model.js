'use strict'

const { Schema, model } = require('mongoose');

const researchBundleSchema = new Schema(
    {
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
