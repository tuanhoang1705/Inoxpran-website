'use strict'

const mongoose = require('mongoose')
const { Schema, model, models } = mongoose

const DOCUMENT_NAME = 'BlogTopicRoadmapRegeneration'
const COLLECTION_NAME = 'BlogTopicRoadmapRegenerations'

const REGENERATION_STATUSES = Object.freeze(['queued', 'running', 'completed', 'failed', 'cancelled'])
const REGENERATION_OUTCOMES = Object.freeze(['replacement_committed', 'no_change', 'superseded', ''])

const sourceHealthSchema = new Schema({
    source: { type: String, default: '', trim: true, maxlength: 120 },
    status: { type: String, default: '', trim: true, maxlength: 80 },
    detail: { type: String, default: '', trim: true, maxlength: 240 },
    lastSuccessAt: { type: Date, default: null },
    lastFailureAt: { type: Date, default: null }
}, { _id: false, strict: false })

const blogTopicRoadmapRegenerationSchema = new Schema(
    {
        scheduleId: { type: Schema.Types.ObjectId, ref: 'BlogAutomationSchedule', required: true, immutable: true, index: true },
        roadmapId: { type: Schema.Types.ObjectId, ref: 'BlogTopicRoadmap', required: true, immutable: true, index: true },
        directionRevision: { type: Number, required: true, immutable: true, min: 1 },
        baseEpoch: { type: String, required: true, immutable: true, trim: true, maxlength: 80 },
        targetEpoch: { type: String, required: true, immutable: true, trim: true, maxlength: 80 },
        baseGeneration: { type: Number, required: true, immutable: true, min: 0 },
        targetGeneration: { type: Number, required: true, immutable: true, min: 1 },
        idempotencyKeyHash: { type: String, required: true, immutable: true, minlength: 64, maxlength: 64 },
        coalescedIdempotencyKeyHashes: {
            type: [{ type: String, minlength: 64, maxlength: 64 }],
            default: [],
            select: false,
            validate: {
                validator: (value) => Array.isArray(value) && value.length <= 100,
                message: 'Coalesced idempotency identities exceed 100 records'
            }
        },
        requester: { type: String, default: 'system', immutable: true, trim: true, maxlength: 160 },
        correlationId: { type: String, required: true, immutable: true, trim: true, maxlength: 128, index: true },
        reason: { type: String, default: 'regenerated_by_admin', immutable: true, trim: true, maxlength: 160 },
        status: { type: String, enum: REGENERATION_STATUSES, default: 'queued', required: true, index: true },
        outcome: { type: String, enum: REGENERATION_OUTCOMES, default: '' },
        outcomeCode: { type: String, default: '', trim: true, maxlength: 160 },
        errorCode: { type: String, default: '', trim: true, maxlength: 160 },
        sourceHealth: {
            type: [sourceHealthSchema],
            default: [],
            validate: {
                validator: (value) => Array.isArray(value) && value.length <= 50,
                message: 'Source health exceeds 50 records'
            }
        },
        productCatalogSnapshotId: { type: Schema.Types.ObjectId, ref: 'ProductCatalogSnapshot', default: null, index: true },
        contentOperationsSnapshotId: { type: Schema.Types.ObjectId, ref: 'ContentOperationsDailySnapshot', default: null, index: true },
        contentInventorySnapshotId: { type: Schema.Types.ObjectId, ref: 'ContentInventorySnapshot', default: null, index: true },
        marketSnapshotId: { type: Schema.Types.ObjectId, ref: 'HousewaresMarketSnapshot', default: null, index: true },
        ideationRunId: { type: Schema.Types.ObjectId, ref: 'TopicIdeationRun', default: null, index: true },
        leaseTokenHash: { type: String, default: '', minlength: 0, maxlength: 64, select: false },
        leaseExpiresAt: { type: Date, default: null, index: true },
        lastHeartbeatAt: { type: Date, default: null },
        activeFence: { type: Boolean, required: true, default: true, index: true },
        attemptCount: { type: Number, default: 0, min: 0, max: 10 },
        nextRetryAt: { type: Date, default: null, index: true },
        lastAttemptAt: { type: Date, default: null },
        startedAt: { type: Date, default: null },
        completedAt: { type: Date, default: null }
    },
    {
        collection: COLLECTION_NAME,
        timestamps: true,
        minimize: true
    }
)

blogTopicRoadmapRegenerationSchema.index(
    { roadmapId: 1, idempotencyKeyHash: 1 },
    { unique: true, name: 'topic_roadmap_regeneration_idempotency_unique' }
)
blogTopicRoadmapRegenerationSchema.index(
    { roadmapId: 1, coalescedIdempotencyKeyHashes: 1 },
    { unique: true, sparse: true, name: 'topic_roadmap_regeneration_coalesced_idempotency_unique' }
)
blogTopicRoadmapRegenerationSchema.index(
    { roadmapId: 1, activeFence: 1 },
    {
        unique: true,
        partialFilterExpression: { activeFence: true },
        name: 'topic_roadmap_regeneration_active_unique'
    }
)
blogTopicRoadmapRegenerationSchema.index(
    { activeFence: 1, status: 1, nextRetryAt: 1, leaseExpiresAt: 1, createdAt: 1 },
    { name: 'topic_roadmap_regeneration_queue_lease' }
)

const BlogTopicRoadmapRegeneration = models[DOCUMENT_NAME] || model(DOCUMENT_NAME, blogTopicRoadmapRegenerationSchema)

module.exports = {
    BlogTopicRoadmapRegeneration,
    COLLECTION_NAME,
    DOCUMENT_NAME,
    REGENERATION_OUTCOMES,
    REGENERATION_STATUSES,
    blogTopicRoadmapRegenerationSchema,
    sourceHealthSchema
}
