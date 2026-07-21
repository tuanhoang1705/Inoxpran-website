'use strict'

const { Schema, model } = require('mongoose');

const evidenceSchema = new Schema(
    {
        sourceType: { type: String, required: true, maxlength: 80 },
        referenceId: { type: String, default: '', maxlength: 200 },
        url: { type: String, default: '', maxlength: 1000 },
        summary: { type: String, default: '', maxlength: 1000 },
        checkedAt: { type: Date, default: null }
    },
    { _id: false }
);

const signalSchema = new Schema(
    {
        sourceType: {
            type: String,
            enum: ['sales', 'customer_support', 'product', 'inventory', 'campaign', 'manual', 'internal_search'],
            required: true,
            index: true
        },
        status: { type: String, enum: ['new', 'reviewed', 'used', 'dismissed', 'expired'], default: 'new', index: true },
        priority: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium', index: true },
        confidence: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
        title: { type: String, required: true, trim: true, maxlength: 240 },
        question: { type: String, default: '', trim: true, maxlength: 2000 },
        painPoint: { type: String, default: '', trim: true, maxlength: 2000 },
        objection: { type: String, default: '', trim: true, maxlength: 2000 },
        summary: { type: String, required: true, trim: true, maxlength: 2000 },
        productIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Product' }], default: [] },
        categoryIds: { type: [String], default: [] },
        evidence: { type: [evidenceSchema], default: [] },
        validFrom: { type: Date, default: Date.now, index: true },
        expiresAt: { type: Date, required: true, index: true },
        createdBy: { type: Schema.Types.ObjectId, ref: 'Admin', required: true, select: false },
        usedByWorkOrderIds: { type: [{ type: Schema.Types.ObjectId, ref: 'ContentWorkOrder' }], default: [] },
        usedAt: { type: Date, default: null }
    },
    { collection: 'ContentSignals', timestamps: true }
);

signalSchema.index({ status: 1, expiresAt: 1 });
signalSchema.index({ sourceType: 1, priority: 1, createdAt: -1 });

module.exports = {
    ContentSignal: model('ContentSignal', signalSchema)
};
