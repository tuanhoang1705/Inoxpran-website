'use strict'

const { Schema, model } = require('mongoose');

const DOCUMENT_NAME = 'BlogAutomationSchedule';
const COLLECTION_NAME = 'BlogAutomationSchedules';

const scheduleSchema = new Schema(
    {
        name: { type: String, required: true, trim: true, maxlength: 120 },
        description: { type: String, default: '', trim: true, maxlength: 500 },
        enabled: { type: Boolean, default: true, index: true },
        scheduleType: {
            type: String,
            enum: ['daily', 'weekly', 'interval'],
            required: true,
            index: true
        },
        timezone: { type: String, default: 'Asia/Ho_Chi_Minh', trim: true },
        daily: {
            times: { type: [String], default: [] }
        },
        weekly: {
            daysOfWeek: { type: [Number], default: [] },
            times: { type: [String], default: [] }
        },
        interval: {
            value: { type: Number, default: 24 },
            unit: { type: String, enum: ['minutes', 'hours', 'days'], default: 'hours' }
        },
        runLimit: { type: Number, default: 0, min: 0 },
        runCount: { type: Number, default: 0, min: 0 },
        startAt: { type: Date, default: null },
        endAt: { type: Date, default: null },
        autoPublish: { type: Boolean, default: false },
        agentConfig: { type: Schema.Types.Mixed, default: () => ({}) },
        lastRunAt: { type: Date, default: null },
        nextRunAt: { type: Date, default: null, index: true },
        lastRunStatus: { type: String, default: '' },
        lastError: { type: String, default: '' },
        leaseUntil: { type: Date, default: null, index: true },
        lockedBy: { type: String, default: '', index: true },
        createdBy: { type: Schema.Types.ObjectId, ref: 'Admin', default: null }
    },
    {
        collection: COLLECTION_NAME,
        timestamps: true
    }
);

scheduleSchema.index({ enabled: 1, nextRunAt: 1 });
scheduleSchema.index({ leaseUntil: 1, lockedBy: 1 });

module.exports = {
    BlogAutomationSchedule: model(DOCUMENT_NAME, scheduleSchema)
};
