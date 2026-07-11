'use strict'

const { Schema, model } = require('mongoose');

const snapshotSchema = new Schema(
    {
        snapshotDate: { type: String, required: true },
        timezone: { type: String, required: true, default: 'Asia/Ho_Chi_Minh' },
        status: {
            type: String,
            enum: ['completed_with_changes', 'completed_no_change', 'partial', 'failed', 'manually_overridden'],
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
        override: {
            reason: { type: String, default: '' },
            adminId: { type: Schema.Types.ObjectId, ref: 'Admin', default: null },
            overriddenAt: { type: Date, default: null },
            previousStatus: { type: String, default: '' }
        }
    },
    { collection: 'GoogleIntelligenceSnapshots', timestamps: true }
);

snapshotSchema.index({ snapshotDate: 1, timezone: 1 }, { unique: true });
snapshotSchema.index({ checkedAt: -1 });

module.exports = { GoogleIntelligenceSnapshot: model('GoogleIntelligenceSnapshot', snapshotSchema) };
