'use strict';

const { Schema, model } = require('mongoose');

const DOCUMENT_NAME = 'OpenClawDashboardRun';
const COLLECTION_NAME = 'OpenClawDashboardRuns';

const openclawDashboardRunSchema = new Schema(
    {
        runId: {
            type: String,
            required: true,
            immutable: true,
            unique: true,
            trim: true,
            maxlength: 64
        },
        principalId: {
            type: String,
            required: true,
            immutable: true,
            trim: true,
            maxlength: 128
        },
        idempotencyKeyHash: {
            type: String,
            required: true,
            immutable: true,
            minlength: 64,
            maxlength: 64
        },
        bindingHash: {
            type: String,
            required: true,
            immutable: true,
            minlength: 64,
            maxlength: 64
        },
        action: {
            type: String,
            required: true,
            immutable: true,
            trim: true,
            maxlength: 64
        },
        profile: {
            type: String,
            required: true,
            immutable: true,
            trim: true,
            maxlength: 64
        },
        status: {
            type: String,
            enum: ['running', 'completed', 'failed', 'timed_out'],
            default: 'running',
            index: true
        },
        leaseTokenHash: {
            type: String,
            required: true,
            immutable: true,
            minlength: 64,
            maxlength: 64
        },
        leaseExpiresAt: { type: Date, required: true, index: true },
        lastHeartbeatAt: { type: Date, required: true },
        activeFence: { type: Boolean, required: true, default: false, index: true },
        exitCode: { type: Number, default: null },
        startedAt: { type: Date, required: true, index: true },
        finishedAt: { type: Date, default: null },
        command: { type: String, default: '', maxlength: 2000 },
        dashboardUrl: { type: String, default: '', maxlength: 2000 },
        scheduleId: { type: String, default: '', maxlength: 128 },
        executionId: { type: String, default: '', maxlength: 128 },
        blogId: { type: String, default: '', maxlength: 128 },
        blogSlug: { type: String, default: '', maxlength: 300 },
        blogTitle: { type: String, default: '', maxlength: 500 },
        output: { type: String, default: '', maxlength: 18000 },
        error: { type: String, default: '', maxlength: 4000 }
    },
    {
        collection: COLLECTION_NAME,
        timestamps: true
    }
);

openclawDashboardRunSchema.index(
    { principalId: 1, idempotencyKeyHash: 1 },
    { unique: true, name: 'openclaw_run_principal_idempotency_unique' }
);
openclawDashboardRunSchema.index({ createdAt: -1, _id: -1 }, { name: 'openclaw_run_recent' });
openclawDashboardRunSchema.index(
    { action: 1, profile: 1, activeFence: 1 },
    {
        unique: true,
        partialFilterExpression: { activeFence: true },
        name: 'openclaw_run_active_action_unique'
    }
);

module.exports = {
    OpenClawDashboardRun: model(DOCUMENT_NAME, openclawDashboardRunSchema),
    openclawDashboardRunSchema
};
