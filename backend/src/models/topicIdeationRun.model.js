'use strict'

const mongoose = require('mongoose')
const { Schema, model, models } = mongoose

const DOCUMENT_NAME = 'TopicIdeationRun'
const COLLECTION_NAME = 'TopicIdeationRuns'

const agentInvocationSchema = new Schema({
    agentId: { type: String, required: true, trim: true, maxlength: 120 },
    purpose: { type: String, required: true, trim: true, maxlength: 160 },
    round: { type: Number, required: true, min: 1, max: 10 },
    status: { type: String, enum: ['completed', 'failed'], required: true },
    startedAt: { type: Date, required: true },
    completedAt: { type: Date, required: true },
    durationMs: { type: Number, default: 0, min: 0 },
    requestedAlias: { type: String, default: '', trim: true, maxlength: 200 },
    requestedModel: { type: String, default: '', trim: true, maxlength: 200 },
    providerResolvedModel: { type: String, default: '', trim: true, maxlength: 200 },
    providerResolvedModelSource: {
        type: String,
        enum: ['', 'gateway_provider_metadata'],
        default: ''
    },
    resolvedModel: { type: String, default: '', trim: true, maxlength: 200 },
    usage: { type: Schema.Types.Mixed, default: null },
    requestHash: { type: String, required: true, trim: true, maxlength: 128 },
    responseHash: { type: String, required: true, trim: true, maxlength: 128 },
    sessionHash: { type: String, required: true, trim: true, maxlength: 128 },
    candidateIds: { type: [String], default: [] },
    errorCode: { type: String, default: '', trim: true, maxlength: 160 }
}, { _id: false })

const topicIdeationRunSchema = new Schema({
    scheduleId: { type: Schema.Types.ObjectId, ref: 'BlogAutomationSchedule', required: true, index: true },
    roadmapId: { type: Schema.Types.ObjectId, ref: 'BlogTopicRoadmap', required: true, index: true },
    directionRevision: { type: Number, required: true, min: 1 },
    generation: { type: Number, required: true, min: 1 },
    status: { type: String, enum: ['running', 'completed', 'failed'], default: 'running', index: true },
    outcome: { type: String, enum: ['', 'accepted', 'no_change'], default: '' },
    outcomeCode: { type: String, default: '', trim: true, maxlength: 160 },
    errorCode: { type: String, default: '', trim: true, maxlength: 160 },
    rubricVersion: { type: String, required: true, trim: true, maxlength: 120 },
    corpusHash: { type: String, default: '', trim: true, maxlength: 128 },
    researchContextHash: { type: String, default: '', trim: true, maxlength: 128 },
    sourceHealth: {
        type: [Schema.Types.Mixed],
        default: [],
        validate: {
            validator: (value) => Array.isArray(value) && value.length <= 50,
            message: 'Source health exceeds 50 records'
        }
    },
    roundCount: { type: Number, default: 0, min: 0, max: 10 },
    callCount: { type: Number, default: 0, min: 0, max: 100 },
    invocations: { type: [agentInvocationSchema], default: [] },
    acceptedCandidateIds: { type: [String], default: [] },
    rejectedCandidates: { type: [Schema.Types.Mixed], default: [] },
    terminalCode: { type: String, default: '', trim: true, maxlength: 160 },
    startedAt: { type: Date, required: true },
    completedAt: { type: Date, default: null }
}, { collection: COLLECTION_NAME, timestamps: true, minimize: true })

topicIdeationRunSchema.index({ roadmapId: 1, directionRevision: 1, generation: 1 }, { unique: true })
topicIdeationRunSchema.index({ scheduleId: 1, createdAt: -1 })

const TopicIdeationRun = models[DOCUMENT_NAME] || model(DOCUMENT_NAME, topicIdeationRunSchema)

module.exports = {
    COLLECTION_NAME,
    DOCUMENT_NAME,
    TopicIdeationRun,
    agentInvocationSchema,
    topicIdeationRunSchema
}
