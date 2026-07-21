'use strict'

const { Schema, model } = require('mongoose');

const sourceHealthSchema = new Schema(
    {
        source: { type: String, required: true, trim: true, maxlength: 80 },
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

snapshotSchema.index({ snapshotDate: 1, timezone: 1 }, { unique: true });
snapshotSchema.index({ checkedAt: -1 });

module.exports = {
    ContentOperationsDailySnapshot: model('ContentOperationsDailySnapshot', snapshotSchema)
};
