'use strict'

const { Schema, model } = require('mongoose');

const snapshotSchema = new Schema(
    {
        isQaTest: { type: Boolean, default: false, index: true },
        qaBatchId: { type: Schema.Types.ObjectId, ref: 'AgenticBlogQaBatch', default: null, index: true },
        qaCaseId: { type: Schema.Types.ObjectId, ref: 'AgenticBlogQaCase', default: null, index: true },
        environment: { type: String, enum: ['', 'local', 'staging'], default: '' },
        executionMode: { type: String, enum: ['', 'run_now', 'schedule_run_now', 'actual_schedule'], default: '' },
        originalTopicSeed: { type: String, default: '', maxlength: 300 },
        normalizedTopicKey: { type: String, default: '', maxlength: 320 },
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

snapshotSchema.index(
    { snapshotDate: 1, timezone: 1, isQaTest: 1, qaBatchId: 1, qaCaseId: 1 },
    { unique: true, name: 'content_inventory_snapshot_scope_unique' }
);
snapshotSchema.index({ checkedAt: -1 });

module.exports = {
    ContentInventorySnapshot: model('ContentInventorySnapshot', snapshotSchema)
};
