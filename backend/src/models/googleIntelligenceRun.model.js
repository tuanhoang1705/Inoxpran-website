'use strict'

const { Schema, model } = require('mongoose');

const runSchema = new Schema(
    {
        executionKey: { type: String, required: true, unique: true, index: true },
        scheduledAt: { type: Date, default: null },
        startedAt: { type: Date, default: null },
        completedAt: { type: Date, default: null },
        timezone: { type: String, default: 'Asia/Ho_Chi_Minh' },
        snapshotDate: { type: String, required: true, index: true },
        status: {
            type: String,
            enum: ['queued', 'running', 'completed_with_changes', 'completed_no_change', 'partial', 'failed'],
            default: 'queued',
            index: true
        },
        sourceResults: { type: [Schema.Types.Mixed], default: [] },
        changesDetected: { type: Number, default: 0 },
        criticalChanges: { type: Number, default: 0 },
        triggeredBy: { type: String, default: 'gate' },
        triggeredByAdminId: { type: Schema.Types.ObjectId, ref: 'Admin', default: null },
        snapshotId: { type: Schema.Types.ObjectId, ref: 'GoogleIntelligenceSnapshot', default: null },
        error: { type: String, default: '', maxlength: 1000 },
        retryCount: { type: Number, default: 0, min: 0 },
        correlationId: { type: String, default: '', index: true }
    },
    { collection: 'GoogleIntelligenceRuns', timestamps: true }
);

runSchema.index({ snapshotDate: 1, createdAt: -1 });

module.exports = { GoogleIntelligenceRun: model('GoogleIntelligenceRun', runSchema) };
