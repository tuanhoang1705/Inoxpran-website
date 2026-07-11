'use strict'

const { Schema, model } = require('mongoose');

const changeSchema = new Schema(
    {
        fingerprint: { type: String, required: true, unique: true, index: true },
        sourceId: { type: Schema.Types.ObjectId, ref: 'GoogleIntelligenceSource', required: true, index: true },
        snapshotId: { type: Schema.Types.ObjectId, ref: 'GoogleIntelligenceSnapshot', default: null, index: true },
        title: { type: String, required: true, maxlength: 300 },
        sourceUrl: { type: String, required: true },
        sourceLevel: { type: String, enum: ['official', 'third_party'], required: true },
        changeType: { type: String, enum: ['new', 'updated', 'removed', 'status_event'], required: true },
        severity: { type: String, enum: ['critical', 'high', 'medium', 'low', 'informational'], default: 'informational' },
        publishedAt: { type: Date, default: null },
        detectedAt: { type: Date, required: true },
        previousHash: { type: String, default: '' },
        currentHash: { type: String, required: true },
        summary: { type: String, default: '', maxlength: 1500 },
        officialStatement: { type: String, default: '', maxlength: 1500 },
        analystInterpretation: { type: String, default: '', maxlength: 1500 },
        impactOnInoxpran: { type: String, default: '', maxlength: 1000 },
        recommendedAction: { type: String, default: '', maxlength: 1000 },
        affectedArea: { type: String, default: 'content_quality' },
        confidence: { type: Number, default: 1, min: 0, max: 1 }
    },
    { collection: 'GoogleIntelligenceChanges', timestamps: true }
);

changeSchema.index({ detectedAt: -1, severity: 1 });

module.exports = { GoogleIntelligenceChange: model('GoogleIntelligenceChange', changeSchema) };
