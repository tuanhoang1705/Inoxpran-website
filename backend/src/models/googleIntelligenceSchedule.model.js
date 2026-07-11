'use strict'

const { Schema, model } = require('mongoose');

const scheduleSchema = new Schema(
    {
        singletonKey: { type: String, default: 'default', unique: true },
        name: { type: String, default: 'Google Search Intelligence' },
        enabled: { type: Boolean, default: false, index: true },
        timezone: { type: String, default: 'Asia/Ho_Chi_Minh' },
        scheduleType: { type: String, enum: ['daily', 'interval'], default: 'daily' },
        daily: { times: { type: [String], default: ['05:30'] } },
        interval: {
            value: { type: Number, default: 24, min: 1 },
            unit: { type: String, enum: ['minutes', 'hours', 'days'], default: 'hours' }
        },
        sourceGroups: { type: [String], default: ['official'] },
        strictGate: { type: Boolean, default: true },
        allowLastSuccessfulSnapshot: { type: Boolean, default: false },
        maxSnapshotAgeHours: { type: Number, default: 24, min: 1, max: 720 },
        sourceTimeoutMs: { type: Number, default: 15000, min: 1000, max: 60000 },
        retryPolicy: {
            count: { type: Number, default: 2, min: 0, max: 5 },
            delayMs: { type: Number, default: 1000, min: 100, max: 60000 }
        },
        lastRunAt: { type: Date, default: null },
        nextRunAt: { type: Date, default: null, index: true },
        lastRunStatus: { type: String, default: '' },
        lastError: { type: String, default: '', maxlength: 1000 },
        leaseUntil: { type: Date, default: null, index: true },
        lockedBy: { type: String, default: '' },
        createdBy: { type: Schema.Types.ObjectId, ref: 'Admin', default: null }
    },
    { collection: 'GoogleIntelligenceSchedules', timestamps: true }
);

module.exports = { GoogleIntelligenceSchedule: model('GoogleIntelligenceSchedule', scheduleSchema) };
