'use strict'

const { Schema, model } = require('mongoose');

const DOCUMENT_NAME = 'BlogAutomationExecution';
const COLLECTION_NAME = 'BlogAutomationExecutions';

const executionSchema = new Schema(
    {
        scheduleId: {
            type: Schema.Types.ObjectId,
            ref: 'BlogAutomationSchedule',
            required: true,
            index: true
        },
        executionKey: { type: String, required: true, unique: true, index: true },
        status: {
            type: String,
            enum: ['queued', 'running', 'draft_created', 'published', 'failed', 'skipped'],
            default: 'queued',
            index: true
        },
        startedAt: { type: Date, default: null },
        completedAt: { type: Date, default: null },
        blogId: { type: Schema.Types.ObjectId, ref: 'BlogPost', default: null, index: true },
        blogSlug: { type: String, default: '' },
        blogTitle: { type: String, default: '' },
        mode: { type: String, default: 'draft' },
        error: { type: String, default: '' },
        retryCount: { type: Number, default: 0, min: 0 },
        telegramNotificationStatus: { type: String, default: '' },
        telegramNotificationError: { type: String, default: '' },
        metadata: { type: Schema.Types.Mixed, default: () => ({}) }
    },
    {
        collection: COLLECTION_NAME,
        timestamps: true
    }
);

executionSchema.index({ scheduleId: 1, createdAt: -1 });
executionSchema.index({ status: 1, createdAt: -1 });

module.exports = {
    BlogAutomationExecution: model(DOCUMENT_NAME, executionSchema)
};
