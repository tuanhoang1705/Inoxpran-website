'use strict'

const { Schema, model } = require('mongoose');

const snapshotSchema = new Schema(
    {
        snapshotDate: { type: String, required: true },
        timezone: { type: String, required: true, default: 'Asia/Ho_Chi_Minh' },
        status: { type: String, enum: ['building', 'complete', 'partial', 'failed'], required: true, index: true },
        itemCount: { type: Number, default: 0, min: 0 },
        summary: { type: Schema.Types.Mixed, default: () => ({}) },
        sourceFreshness: { type: Schema.Types.Mixed, default: () => ({}) },
        warnings: { type: [String], default: [] },
        errorCodes: { type: [String], default: [] },
        checkedAt: { type: Date, required: true },
        contentHash: { type: String, required: true, index: true },
        buildToken: { type: String, default: '', select: false },
        buildGeneration: { type: Number, default: 0, min: 0, select: false },
        leaseUntil: { type: Date, default: null, index: true, select: false }
    },
    { collection: 'ContentInventorySnapshots', timestamps: true }
);

snapshotSchema.index({ snapshotDate: 1, timezone: 1 }, { unique: true });
snapshotSchema.index({ checkedAt: -1 });

module.exports = {
    ContentInventorySnapshot: model('ContentInventorySnapshot', snapshotSchema)
};
