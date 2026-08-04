'use strict'

const mongoose = require('mongoose')
const { Schema, model, models } = mongoose

const DOCUMENT_NAME = 'BlogTopicRoadmapItem'
const COLLECTION_NAME = 'BlogTopicRoadmapItems'

const ROADMAP_ITEM_STATUSES = Object.freeze([
    'ready',
    'claimed',
    'completed',
    'dismissed',
    'invalidated',
    'failed'
])
const ROADMAP_ITEM_SCOPES = Object.freeze(['catalog', 'product', 'category', 'market', 'mixed'])

const boundedStringArray = ({ maxItems, maxlength }) => ({
    type: [{ type: String, trim: true, maxlength }],
    default: [],
    validate: {
        validator: (value) => Array.isArray(value) && value.length <= maxItems,
        message: `Array exceeds ${maxItems} items`
    }
})

const productEvidenceSchema = new Schema({
    productId: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
    sku: { type: String, default: '', trim: true, maxlength: 100 },
    name: { type: String, required: true, trim: true, maxlength: 240 },
    slug: { type: String, default: '', trim: true, maxlength: 180 },
    category: { type: String, default: '', trim: true, maxlength: 120 },
    relevanceReason: { type: String, default: '', trim: true, maxlength: 500 },
    catalogEvidenceHash: { type: String, required: true, trim: true, maxlength: 128 },
    factKeys: boundedStringArray({ maxItems: 20, maxlength: 160 })
}, { _id: false })

const marketEvidenceSchema = new Schema({
    evidenceId: { type: String, default: '', trim: true, maxlength: 160 },
    sourceType: { type: String, default: 'market_web', trim: true, maxlength: 80 },
    sourceId: { type: String, required: true, trim: true, maxlength: 160 },
    sourceName: { type: String, default: '', trim: true, maxlength: 180 },
    sourceDomain: { type: String, default: '', trim: true, maxlength: 255 },
    queryId: { type: String, default: '', trim: true, maxlength: 80 },
    relevanceScore: { type: Number, default: 0, min: 0, max: 1 },
    relevanceVersion: { type: String, default: '', trim: true, maxlength: 120 },
    relevanceReasons: boundedStringArray({ maxItems: 20, maxlength: 160 }),
    canonicalUrl: { type: String, default: '', trim: true, maxlength: 1200 },
    title: { type: String, default: '', trim: true, maxlength: 240 },
    snippet: { type: String, default: '', trim: true, maxlength: 600 },
    observedAt: { type: Date, default: null },
    fetchedAt: { type: Date, default: null },
    contentHash: { type: String, default: '', trim: true, maxlength: 128 },
    confidence: { type: Number, default: 0, min: 0, max: 1 },
    classification: { type: String, enum: ['observed', 'inferred', ''], default: '' }
}, { _id: false })

const scoreSchema = new Schema({
    totalScore: { type: Number, default: 0, min: 0, max: 100 },
    noveltySubtotal: { type: Number, default: 0, min: 0, max: 65 },
    rubricVersion: { type: String, default: '', trim: true, maxlength: 120 },
    corpusVersion: { type: String, default: '', trim: true, maxlength: 120 },
    corpusHash: { type: String, default: '', trim: true, maxlength: 128 },
    corpusCount: { type: Number, default: 0, min: 0 },
    scoreHash: { type: String, default: '', trim: true, maxlength: 128 },
    semanticCalibration: { type: Schema.Types.Mixed, default: () => ({}) },
    hardGates: { type: Schema.Types.Mixed, default: () => ({}) },
    hardGatesPassed: { type: Boolean, default: false },
    nearestCollisions: { type: Schema.Types.Mixed, default: () => ({}) },
    reasonCodes: boundedStringArray({ maxItems: 30, maxlength: 160 }),
    scoreBreakdown: { type: Schema.Types.Mixed, default: () => ({}) },
    trustedSignals: { type: Schema.Types.Mixed, default: () => ({}) },
    penalties: {
        type: [Schema.Types.Mixed],
        default: [],
        validate: {
            validator: (value) => Array.isArray(value) && value.length <= 30,
            message: 'Score penalties exceed 30 records'
        }
    }
}, { _id: false })

const candidateProvenanceSchema = new Schema({
    candidateId: { type: String, default: '', trim: true, maxlength: 160 },
    ideationSource: { type: String, default: '', trim: true, maxlength: 80 },
    ideationModel: { type: String, default: '', trim: true, maxlength: 120 },
    rationale: { type: String, default: '', trim: true, maxlength: 500 },
    sourceSignals: boundedStringArray({ maxItems: 12, maxlength: 160 })
}, { _id: false })

const blogTopicRoadmapItemSchema = new Schema(
    {
        roadmapId: {
            type: Schema.Types.ObjectId,
            ref: 'BlogTopicRoadmap',
            required: true,
            immutable: true,
            index: true
        },
        scheduleId: {
            type: Schema.Types.ObjectId,
            ref: 'BlogAutomationSchedule',
            required: true,
            immutable: true,
            index: true
        },
        directionRevision: { type: Number, required: true, min: 1, index: true },
        generation: { type: Number, required: true, min: 0, index: true },
        activationEpoch: { type: String, default: '', trim: true, maxlength: 80, index: true },
        rank: { type: Number, default: 0, min: 0 },
        status: {
            type: String,
            enum: ROADMAP_ITEM_STATUSES,
            default: 'ready',
            required: true,
            index: true
        },
        topic: { type: String, required: true, immutable: true, trim: true, maxlength: 300 },
        angle: { type: String, required: true, immutable: true, trim: true, maxlength: 1000 },
        primaryKeyword: { type: String, default: '', immutable: true, trim: true, maxlength: 160 },
        secondaryKeywords: { ...boundedStringArray({ maxItems: 20, maxlength: 160 }), immutable: true },
        categoryKey: { type: String, default: '', immutable: true, trim: true, maxlength: 120, index: true },
        productScope: { type: String, default: 'mixed', immutable: true, trim: true, maxlength: 80, index: true },
        topicAxis: { type: String, default: '', immutable: true, trim: true, maxlength: 120 },
        articleType: { type: String, default: 'practical-guide', immutable: true, trim: true, maxlength: 120 },
        searchIntent: { type: String, default: 'informational', immutable: true, trim: true, maxlength: 160 },
        primaryQuestion: { type: String, default: '', immutable: true, trim: true, maxlength: 500 },
        supportingQuestions: boundedStringArray({ maxItems: 12, maxlength: 500 }),
        targetAudience: boundedStringArray({ maxItems: 12, maxlength: 240 }),
        userProblems: boundedStringArray({ maxItems: 12, maxlength: 500 }),
        productEvidence: {
            type: [productEvidenceSchema],
            default: [],
            immutable: true,
            validate: {
                validator: (value) => Array.isArray(value) && value.length <= 12,
                message: 'Product evidence exceeds 12 records'
            }
        },
        marketEvidence: {
            type: [marketEvidenceSchema],
            default: [],
            immutable: true,
            validate: {
                validator: (value) => Array.isArray(value) && value.length <= 12,
                message: 'Market evidence exceeds 12 records'
            }
        },
        scores: { type: scoreSchema, default: () => ({}), immutable: true },
        ideationRunId: { type: Schema.Types.ObjectId, ref: 'TopicIdeationRun', default: null, index: true },
        regenerationId: { type: Schema.Types.ObjectId, ref: 'BlogTopicRoadmapRegeneration', default: null, index: true },
        candidateProvenance: { type: candidateProvenanceSchema, default: () => ({}), immutable: true },
        uniquenessKey: { type: String, required: true, trim: true, maxlength: 160 },
        claimToken: { type: String, default: '', maxlength: 160, select: false },
        claimUntil: { type: Date, default: null, index: true },
        claimExecutionId: { type: Schema.Types.ObjectId, ref: 'BlogAutomationExecution', default: null, index: true },
        claimedAt: { type: Date, default: null },
        attemptCount: { type: Number, default: 0, min: 0 },
        blogId: { type: Schema.Types.ObjectId, ref: 'BlogPost', default: null, index: true },
        contentWorkOrderId: { type: Schema.Types.ObjectId, ref: 'ContentWorkOrder', default: null },
        unifiedContentBriefId: { type: Schema.Types.ObjectId, ref: 'UnifiedContentBrief', default: null },
        completedAt: { type: Date, default: null },
        dismissedAt: { type: Date, default: null },
        invalidatedAt: { type: Date, default: null },
        failedAt: { type: Date, default: null },
        reasonCode: { type: String, default: '', trim: true, maxlength: 160 }
    },
    {
        collection: COLLECTION_NAME,
        timestamps: true,
        minimize: true
    }
)

blogTopicRoadmapItemSchema.index(
    { scheduleId: 1, uniquenessKey: 1, activationEpoch: 1 },
    { unique: true, name: 'topic_roadmap_item_epoch_uniqueness' }
)
blogTopicRoadmapItemSchema.index({ scheduleId: 1, status: 1, activationEpoch: 1, generation: 1, rank: 1 })
blogTopicRoadmapItemSchema.index({ status: 1, claimUntil: 1, scheduleId: 1 })
blogTopicRoadmapItemSchema.index({ scheduleId: 1, claimToken: 1, status: 1 })
blogTopicRoadmapItemSchema.index({ roadmapId: 1, activationEpoch: 1, generation: 1, status: 1 })

const BlogTopicRoadmapItem = models[DOCUMENT_NAME] || model(DOCUMENT_NAME, blogTopicRoadmapItemSchema)

module.exports = {
    BlogTopicRoadmapItem,
    COLLECTION_NAME,
    DOCUMENT_NAME,
    ROADMAP_ITEM_SCOPES,
    ROADMAP_ITEM_STATUSES,
    blogTopicRoadmapItemSchema,
    boundedStringArray,
    candidateProvenanceSchema,
    marketEvidenceSchema,
    productEvidenceSchema,
    scoreSchema
}
