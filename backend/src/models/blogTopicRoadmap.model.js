'use strict'

const mongoose = require('mongoose')
const { Schema, model, models } = mongoose

const DOCUMENT_NAME = 'BlogTopicRoadmap'
const COLLECTION_NAME = 'BlogTopicRoadmaps'

const ROADMAP_SCOPE_MODES = Object.freeze(['broad', 'narrow', 'mixed'])
const ROADMAP_STATUSES = Object.freeze([
    'needs_refill',
    'refilling',
    'ready',
    'partial',
    'failed',
    'archived'
])

const boundedStringArray = ({ maxItems, maxlength }) => ({
    type: [{ type: String, trim: true, maxlength }],
    default: [],
    validate: {
        validator: (value) => Array.isArray(value) && value.length <= maxItems,
        message: `Array exceeds ${maxItems} items`
    }
})

const interpretationSchema = new Schema({
    scopeMode: { type: String, enum: ROADMAP_SCOPE_MODES, default: 'mixed' },
    normalizedGoal: { type: String, default: '', trim: true, maxlength: 500 },
    focusTerms: boundedStringArray({ maxItems: 16, maxlength: 160 }),
    excludedTerms: boundedStringArray({ maxItems: 12, maxlength: 160 }),
    targetAudience: boundedStringArray({ maxItems: 10, maxlength: 180 }),
    constraints: boundedStringArray({ maxItems: 16, maxlength: 200 }),
    topicAxes: boundedStringArray({ maxItems: 16, maxlength: 120 }),
    confidence: { type: Number, default: 0.5, min: 0, max: 1 },
    rationale: { type: String, default: '', trim: true, maxlength: 500 },
    source: { type: String, enum: ['llm', 'heuristic', 'llm_fallback'], default: 'heuristic' },
    model: { type: String, default: '', trim: true, maxlength: 120 }
}, { _id: false })

const sourceHealthSchema = new Schema({
    source: { type: String, default: '', trim: true, maxlength: 120 },
    status: { type: String, default: '', trim: true, maxlength: 80 },
    detail: { type: String, default: '', trim: true, maxlength: 240 },
    lastSuccessAt: { type: Date, default: null },
    lastFailureAt: { type: Date, default: null }
}, { _id: false, strict: false })

const rejectedCandidateSchema = new Schema({
    topic: { type: String, default: '', trim: true, maxlength: 300 },
    reason: { type: String, required: true, trim: true, maxlength: 160 }
}, { _id: false })

const blogTopicRoadmapSchema = new Schema(
    {
        scheduleId: {
            type: Schema.Types.ObjectId,
            ref: 'BlogAutomationSchedule',
            required: true,
            immutable: true
        },
        direction: { type: String, required: true, trim: true, maxlength: 500 },
        directionHash: { type: String, required: true, trim: true, maxlength: 128 },
        directionRevision: { type: Number, default: 1, min: 1 },
        interpretation: { type: interpretationSchema, default: () => ({}) },
        generation: { type: Number, default: 0, min: 0, index: true },
        activeEpoch: { type: String, default: '', trim: true, maxlength: 80, index: true },
        epochMigrationComplete: { type: Boolean, default: false },
        status: {
            type: String,
            enum: ROADMAP_STATUSES,
            default: 'needs_refill',
            required: true,
            index: true
        },
        minimumReady: { type: Number, default: 3, min: 1, max: 40 },
        targetReady: { type: Number, default: 8, min: 1, max: 40 },
        readyCount: { type: Number, default: 0, min: 0 },
        refillToken: { type: String, default: '', maxlength: 160, select: false },
        refillLeaseUntil: { type: Date, default: null, index: true },
        refillRequestedAt: { type: Date, default: null },
        refillReason: { type: String, default: '', trim: true, maxlength: 160 },
        lastRefillAt: { type: Date, default: null },
        lastOutcomeCode: { type: String, default: '', trim: true, maxlength: 160 },
        lastErrorCode: { type: String, default: '', trim: true, maxlength: 160 },
        productCatalogSnapshotId: {
            type: Schema.Types.ObjectId,
            ref: 'ProductCatalogSnapshot',
            default: null,
            index: true
        },
        contentOperationsSnapshotId: {
            type: Schema.Types.ObjectId,
            ref: 'ContentOperationsDailySnapshot',
            default: null,
            index: true
        },
        contentInventorySnapshotId: {
            type: Schema.Types.ObjectId,
            ref: 'ContentInventorySnapshot',
            default: null,
            index: true
        },
        marketSnapshotId: {
            type: Schema.Types.ObjectId,
            ref: 'HousewaresMarketSnapshot',
            default: null,
            index: true
        },
        latestIdeationRunId: { type: Schema.Types.ObjectId, ref: 'TopicIdeationRun', default: null, index: true },
        latestRegenerationId: { type: Schema.Types.ObjectId, ref: 'BlogTopicRoadmapRegeneration', default: null, index: true },
        scoreRubricVersion: { type: String, default: '', trim: true, maxlength: 120 },
        corpusVersion: { type: String, default: '', trim: true, maxlength: 120 },
        corpusHash: { type: String, default: '', trim: true, maxlength: 128 },
        sourceHealth: {
            type: [sourceHealthSchema],
            default: [],
            validate: {
                validator: (value) => Array.isArray(value) && value.length <= 50,
                message: 'Source health exceeds 50 records'
            }
        },
        rejectedCandidates: {
            type: [rejectedCandidateSchema],
            default: [],
            validate: {
                validator: (value) => Array.isArray(value) && value.length <= 100,
                message: 'Rejected candidates exceed 100 records'
            }
        },
        archivedAt: { type: Date, default: null }
    },
    {
        collection: COLLECTION_NAME,
        timestamps: true,
        minimize: true
    }
)

blogTopicRoadmapSchema.index({ scheduleId: 1 }, { unique: true })
blogTopicRoadmapSchema.index({ status: 1, refillRequestedAt: 1 })
blogTopicRoadmapSchema.index({ status: 1, refillLeaseUntil: 1 })
blogTopicRoadmapSchema.index({ scheduleId: 1, directionRevision: -1, generation: -1 })

const BlogTopicRoadmap = models[DOCUMENT_NAME] || model(DOCUMENT_NAME, blogTopicRoadmapSchema)

module.exports = {
    BlogTopicRoadmap,
    COLLECTION_NAME,
    DOCUMENT_NAME,
    ROADMAP_SCOPE_MODES,
    ROADMAP_STATUSES,
    blogTopicRoadmapSchema,
    boundedStringArray,
    interpretationSchema,
    rejectedCandidateSchema,
    sourceHealthSchema
}
