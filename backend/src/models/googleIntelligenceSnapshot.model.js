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
        status: {
            type: String,
            enum: ['building', 'completed_with_changes', 'completed_no_change', 'partial', 'failed', 'manually_overridden'],
            required: true,
            index: true
        },
        checkedAt: { type: Date, required: true },
        sourcesChecked: { type: Number, default: 0 },
        successfulSources: { type: Number, default: 0 },
        failedSources: { type: Number, default: 0 },
        mandatorySourcesSucceeded: { type: Boolean, default: false },
        noMaterialChanges: { type: Boolean, default: true },
        sourceHealth: { type: [Schema.Types.Mixed], default: [] },
        officialChanges: { type: [Schema.Types.Mixed], default: [] },
        thirdPartyObservations: { type: [Schema.Types.Mixed], default: [] },
        currentRules: { type: [Schema.Types.Mixed], default: [] },
        recommendations: { type: [Schema.Types.Mixed], default: [] },
        risks: { type: [Schema.Types.Mixed], default: [] },
        requiredActions: { type: [Schema.Types.Mixed], default: [] },
        contentGuidance: { type: Schema.Types.Mixed, default: () => ({}) },
        reviewerResult: { type: Schema.Types.Mixed, default: () => ({}) },
        contentHash: { type: String, required: true, index: true },
        runId: { type: Schema.Types.ObjectId, ref: 'GoogleIntelligenceRun', default: null },
        buildToken: { type: String, default: '', maxlength: 200, select: false },
        buildGeneration: { type: Number, default: 0, min: 0, select: false },
        completedGeneration: { type: Number, default: 0, min: 0, select: false },
        leaseUntil: { type: Date, default: null, index: true, select: false },
        lastBuildError: { type: String, default: '', maxlength: 120, select: false },
        override: {
            reason: { type: String, default: '' },
            adminId: { type: Schema.Types.ObjectId, ref: 'Admin', default: null },
            overriddenAt: { type: Date, default: null },
            previousStatus: { type: String, default: '' }
        }
    },
    { collection: 'GoogleIntelligenceSnapshots', timestamps: true }
);

snapshotSchema.index(
    { snapshotDate: 1, timezone: 1, isQaTest: 1, qaBatchId: 1, qaCaseId: 1 },
    { unique: true, name: 'google_snapshot_scope_unique' }
);
snapshotSchema.index({ checkedAt: -1 });
snapshotSchema.index({ snapshotDate: 1, timezone: 1, buildGeneration: 1 });

module.exports = { GoogleIntelligenceSnapshot: model('GoogleIntelligenceSnapshot', snapshotSchema) };
