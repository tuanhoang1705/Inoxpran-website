'use strict'

const { Schema, model } = require('mongoose');

const sourceHealthSchema = new Schema(
    {
        source: { type: String, required: true, trim: true, maxlength: 80 },
        enabled: { type: Boolean, default: undefined },
        configured: { type: Boolean, default: false },
        status: { type: String, enum: ['available', 'partial', 'unavailable', 'failed'], required: true },
        checkedAt: { type: Date, default: null },
        freshness: { type: Schema.Types.Mixed, default: null },
        errorCode: { type: String, default: '', maxlength: 120 }
    },
    { _id: false }
);

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
        googleIntelSnapshotId: { type: Schema.Types.ObjectId, ref: 'GoogleIntelligenceSnapshot', default: null, index: true },
        contentInventorySnapshotId: { type: Schema.Types.ObjectId, ref: 'ContentInventorySnapshot', default: null, index: true },
        sourceHealth: { type: [sourceHealthSchema], default: [] },
        websitePerformance: { type: Schema.Types.Mixed, default: () => ({}) },
        contentInventorySummary: { type: Schema.Types.Mixed, default: () => ({}) },
        businessSignals: { type: Schema.Types.Mixed, default: () => ({}) },
        opportunitySignals: { type: [Schema.Types.Mixed], default: [] },
        risks: { type: [Schema.Types.Mixed], default: [] },
        warnings: { type: [String], default: [] },
        sourceFreshness: { type: Schema.Types.Mixed, default: () => ({}) },
        checkedAt: { type: Date, required: true },
        contentHash: { type: String, required: true, index: true },
        sourceState: { type: Schema.Types.Mixed, default: () => ({}), select: false },
        leaseOwner: { type: String, default: '', select: false },
        leaseToken: { type: String, default: '', select: false },
        leaseUntil: { type: Date, default: null, index: true, select: false }
    },
    { collection: 'ContentOperationsDailySnapshots', timestamps: true }
);

snapshotSchema.index(
    { snapshotDate: 1, timezone: 1, isQaTest: 1, qaBatchId: 1, qaCaseId: 1 },
    { unique: true, name: 'content_operations_snapshot_scope_unique' }
);
snapshotSchema.index({ checkedAt: -1 });

module.exports = {
    ContentOperationsDailySnapshot: model('ContentOperationsDailySnapshot', snapshotSchema)
};
