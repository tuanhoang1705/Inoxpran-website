'use strict'

const { Schema, model } = require('mongoose');

const schema = new Schema(
    {
        singletonKey: { type: String, default: 'default', unique: true, index: true },
        name: { type: String, default: 'Content Operations Daily Planning', maxlength: 160 },
        enabled: { type: Boolean, default: false, index: true },
        timezone: { type: String, default: 'Asia/Ho_Chi_Minh' },
        scheduleType: { type: String, enum: ['daily', 'interval'], default: 'daily' },
        daily: { times: { type: [String], default: ['06:30'] } },
        interval: {
            value: { type: Number, default: 24, min: 1 },
            unit: { type: String, enum: ['minutes', 'hours', 'days'], default: 'hours' }
        },
        mode: { type: String, enum: ['best_action', 'fixed_brief', 'maintenance_only'], default: 'best_action' },
        topic: { type: String, default: '', trim: true, maxlength: 300 },
        primaryKeyword: { type: String, default: '', trim: true, maxlength: 200 },
        sourceRequirements: { type: [String], default: ['content_inventory'] },
        minimumOpportunityScore: { type: Number, default: 0.65, min: 0, max: 1 },
        allowSkip: { type: Boolean, default: true },
        draftOnly: { type: Boolean, default: true },
        maximumTasksPerDay: { type: Number, default: 1, min: 1, max: 24 },
        monitoringWindows: { type: [String], default: ['1d', '7d', '14d', '30d', '90d'] },
        lastRunAt: { type: Date, default: null },
        nextRunAt: { type: Date, default: null, index: true },
        lastRunStatus: { type: String, default: '' },
        lastError: { type: String, default: '', maxlength: 1000 },
        leaseUntil: { type: Date, default: null, index: true },
        lockedBy: { type: String, default: '' },
        createdBy: { type: Schema.Types.ObjectId, ref: 'Admin', default: null },
        updatedBy: { type: Schema.Types.ObjectId, ref: 'Admin', default: null }
    },
    { collection: 'ContentOperationsSchedules', timestamps: true }
);

module.exports = { ContentOperationsSchedule: model('ContentOperationsSchedule', schema) };
