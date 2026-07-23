'use strict'

const { Schema, model } = require('mongoose');

const runSchema = new Schema(
    {
        isQaTest: { type: Boolean, default: false, index: true },
        qaBatchId: { type: Schema.Types.ObjectId, ref: 'AgenticBlogQaBatch', default: null, index: true },
        qaCaseId: { type: Schema.Types.ObjectId, ref: 'AgenticBlogQaCase', default: null, index: true },
        environment: { type: String, enum: ['', 'local', 'staging'], default: '' },
        executionMode: { type: String, enum: ['', 'run_now', 'schedule_run_now', 'actual_schedule'], default: '' },
        originalTopicSeed: { type: String, default: '', maxlength: 300 },
        normalizedTopicKey: { type: String, default: '', maxlength: 320 },
        executionKey: { type: String, required: true, unique: true, index: true },
        executionSlotKey: { type: String, default: '', index: true },
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
        snapshotGeneration: { type: Number, default: 0, min: 0, index: true },
        buildToken: { type: String, default: '', maxlength: 200, select: false },
        error: { type: String, default: '', maxlength: 1000 },
        retryCount: { type: Number, default: 0, min: 0 },
        correlationId: { type: String, default: '', index: true }
    },
    { collection: 'GoogleIntelligenceRuns', timestamps: true }
);

runSchema.index({ snapshotDate: 1, createdAt: -1 });
runSchema.index({ executionSlotKey: 1, snapshotGeneration: 1 });

module.exports = { GoogleIntelligenceRun: model('GoogleIntelligenceRun', runSchema) };
