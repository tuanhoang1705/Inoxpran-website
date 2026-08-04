'use strict'

const mongoose = require('mongoose')
const { Schema, model, models } = mongoose

const DOCUMENT_NAME = 'BlogNoveltyIndex'
const COLLECTION_NAME = 'BlogNoveltyIndexes'

const vectorSchema = new Schema({
    provider: { type: String, default: '', trim: true, maxlength: 80 },
    model: { type: String, default: '', trim: true, maxlength: 160 },
    dimensions: { type: Number, default: 0, min: 0, max: 100_000 },
    values: { type: [Number], default: [], select: false },
    vectorHash: { type: String, default: '', trim: true, maxlength: 128 }
}, { _id: false })

const blogNoveltyIndexSchema = new Schema({
    sourceType: { type: String, enum: ['blog', 'roadmap'], required: true, index: true },
    sourceId: { type: Schema.Types.ObjectId, required: true, index: true },
    isQaTest: { type: Boolean, default: false, index: true },
    indexVersion: { type: String, required: true, trim: true, maxlength: 120, index: true },
    tokenizerVersion: { type: String, required: true, trim: true, maxlength: 120 },
    sourceContentHash: { type: String, required: true, trim: true, maxlength: 128, index: true },
    title: { type: String, default: '', trim: true, maxlength: 500 },
    seoTitle: { type: String, default: '', trim: true, maxlength: 500 },
    excerpt: { type: String, default: '', trim: true, maxlength: 2_000 },
    tags: { type: [String], default: [] },
    topicSummary: { type: String, default: '', trim: true, maxlength: 2_000 },
    primaryIntent: { type: String, default: '', trim: true, maxlength: 200 },
    contentRole: { type: String, default: '', trim: true, maxlength: 200 },
    entities: { type: [String], default: [] },
    questions: { type: [String], default: [] },
    headings: { type: [String], default: [] },
    bodyChunks: { type: [String], default: [], select: false },
    tokens: { type: [String], default: [], select: false },
    unigrams: { type: Schema.Types.Mixed, default: () => ({}), select: false },
    bigrams: { type: Schema.Types.Mixed, default: () => ({}), select: false },
    structure: { type: Schema.Types.Mixed, default: () => ({}) },
    topicVector: { type: vectorSchema, default: () => ({}) },
    planVector: { type: vectorSchema, default: () => ({}) },
    bodyVector: { type: vectorSchema, default: () => ({}) },
    chunkVectors: { type: [vectorSchema], default: [], select: false },
    indexedAt: { type: Date, required: true, index: true }
}, { collection: COLLECTION_NAME, timestamps: true, minimize: true })

blogNoveltyIndexSchema.index({ sourceType: 1, sourceId: 1, indexVersion: 1 }, { unique: true })
blogNoveltyIndexSchema.index({ indexVersion: 1, isQaTest: 1, indexedAt: -1 })

const BlogNoveltyIndex = models[DOCUMENT_NAME] || model(DOCUMENT_NAME, blogNoveltyIndexSchema)

module.exports = {
    BlogNoveltyIndex,
    COLLECTION_NAME,
    DOCUMENT_NAME,
    blogNoveltyIndexSchema,
    vectorSchema
}
