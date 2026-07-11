'use strict'

const { Schema, model } = require('mongoose');

const sourceSchema = new Schema(
    {
        name: { type: String, required: true, trim: true, maxlength: 180 },
        sourceType: {
            type: String,
            enum: ['documentation', 'blog', 'status', 'search_console', 'merchant', 'third_party'],
            required: true,
            index: true
        },
        baseUrl: { type: String, required: true, unique: true, trim: true },
        canonicalUrl: { type: String, default: '', trim: true },
        official: { type: Boolean, default: true, index: true },
        required: { type: Boolean, default: false, index: true },
        priority: { type: Number, default: 100, min: 1, max: 1000, index: true },
        enabled: { type: Boolean, default: true, index: true },
        sourceGroups: { type: [String], default: ['official'] },
        fetchMode: { type: String, enum: ['html', 'rss', 'json'], default: 'html' },
        allowPaths: { type: [String], default: [] },
        denyPaths: { type: [String], default: [] },
        lastSuccessAt: { type: Date, default: null },
        lastFailureAt: { type: Date, default: null },
        lastError: { type: String, default: '', maxlength: 500 },
        lastContentHash: { type: String, default: '', select: false },
        lastTitle: { type: String, default: '', maxlength: 300 },
        lastPublishedAt: { type: Date, default: null },
        lastFetchedAt: { type: Date, default: null }
    },
    { collection: 'GoogleIntelligenceSources', timestamps: true }
);

sourceSchema.index({ enabled: 1, official: -1, priority: 1 });

module.exports = {
    GoogleIntelligenceSource: model('GoogleIntelligenceSource', sourceSchema)
};
