'use strict'

const mongoose = require('mongoose')
const { Schema, model, models } = mongoose

const DOCUMENT_NAME = 'HousewaresMarketSnapshot'
const COLLECTION_NAME = 'HousewaresMarketSnapshots'

const MARKET_SNAPSHOT_STATUSES = Object.freeze(['complete', 'partial', 'failed'])
const MARKET_SOURCE_STATUSES = Object.freeze(['available', 'failed', 'skipped'])
const MARKET_SIGNAL_TYPES = Object.freeze(['topic', 'question', 'problem', 'use_case', 'seasonal', 'product_category', 'other'])

const sourceRecordSchema = new Schema({
    sourceId: { type: String, required: true, trim: true, maxlength: 120 },
    sourceName: { type: String, required: true, trim: true, maxlength: 180 },
    canonicalUrl: { type: String, required: true, trim: true, maxlength: 1200 },
    mode: { type: String, enum: ['html', 'rss', 'json', 'text'], default: 'html' },
    status: { type: String, enum: MARKET_SOURCE_STATUSES, required: true },
    contentType: { type: String, default: '', trim: true, maxlength: 120 },
    title: { type: String, default: '', trim: true, maxlength: 300 },
    publishedAt: { type: Date, default: null },
    updatedAt: { type: Date, default: null },
    fetchedAt: { type: Date, default: null },
    contentHash: { type: String, default: '', trim: true, maxlength: 128 },
    etagHash: { type: String, default: '', trim: true, maxlength: 128 },
    lastModified: { type: String, default: '', trim: true, maxlength: 160 },
    signalCount: { type: Number, default: 0, min: 0, max: 100 },
    errorCode: { type: String, default: '', trim: true, maxlength: 160 }
}, { _id: false })

const marketSignalSchema = new Schema({
    sourceId: { type: String, required: true, trim: true, maxlength: 120 },
    type: { type: String, enum: MARKET_SIGNAL_TYPES, default: 'other' },
    topic: { type: String, required: true, trim: true, maxlength: 300 },
    summary: { type: String, default: '', trim: true, maxlength: 800 },
    snippet: { type: String, default: '', trim: true, maxlength: 600 },
    sourceTitle: { type: String, default: '', trim: true, maxlength: 300 },
    sourceDate: { type: Date, default: null },
    confidence: { type: String, enum: ['low', 'medium', 'high'], default: 'low' },
    classification: { type: String, enum: ['observed', 'inferred'], default: 'observed' },
    signalHash: { type: String, required: true, trim: true, maxlength: 128 },
    sourceName: { type: String, default: '', trim: true, maxlength: 180 },
    sourceDomain: { type: String, default: '', trim: true, maxlength: 255 },
    canonicalUrl: { type: String, default: '', trim: true, maxlength: 1200 },
    queryId: { type: String, default: '', trim: true, maxlength: 80 },
    relevance: { type: Schema.Types.Mixed, default: null }
}, { _id: false })

const sourceHealthSchema = new Schema({
    configured: { type: Number, default: 0, min: 0, max: 50 },
    attempted: { type: Number, default: 0, min: 0, max: 50 },
    succeeded: { type: Number, default: 0, min: 0, max: 50 },
    failed: { type: Number, default: 0, min: 0, max: 50 }
}, { _id: false })

const freshnessSchema = new Schema({
    checkedAt: { type: Date, required: true },
    newestSourceAt: { type: Date, default: null },
    oldestSourceAt: { type: Date, default: null },
    ttlSeconds: { type: Number, required: true, min: 60, max: 31_536_000 },
    stale: { type: Boolean, default: false }
}, { _id: false })

const housewaresMarketSnapshotSchema = new Schema(
    {
        status: { type: String, enum: MARKET_SNAPSHOT_STATUSES, required: true, index: true },
        registryHash: { type: String, required: true, trim: true, maxlength: 128, index: true },
        researchContextHash: { type: String, default: '', trim: true, maxlength: 128, index: true },
        queryVersion: { type: String, default: '', trim: true, maxlength: 120 },
        relevanceVersion: { type: String, default: '', trim: true, maxlength: 120 },
        queries: { type: [Schema.Types.Mixed], default: [] },
        snapshotHash: { type: String, required: true, trim: true, maxlength: 128, index: true },
        generatedAt: { type: Date, required: true, index: true },
        expiresAt: { type: Date, required: true },
        sourceHealth: { type: sourceHealthSchema, required: true },
        freshness: { type: freshnessSchema, required: true },
        sources: {
            type: [sourceRecordSchema],
            default: [],
            validate: {
                validator: (value) => Array.isArray(value) && value.length <= 50,
                message: 'Market sources exceed 50 records'
            }
        },
        signals: {
            type: [marketSignalSchema],
            default: [],
            validate: {
                validator: (value) => Array.isArray(value) && value.length <= 200,
                message: 'Market signals exceed 200 records'
            }
        },
        rejectedSignals: {
            type: [marketSignalSchema],
            default: [],
            validate: {
                validator: (value) => Array.isArray(value) && value.length <= 200,
                message: 'Rejected market signals exceed 200 records'
            }
        },
        warnings: {
            type: [{ type: String, trim: true, maxlength: 160 }],
            default: [],
            validate: {
                validator: (value) => Array.isArray(value) && value.length <= 50,
                message: 'Market warnings exceed 50 items'
            }
        }
    },
    {
        collection: COLLECTION_NAME,
        timestamps: true,
        minimize: true
    }
)

housewaresMarketSnapshotSchema.index({ status: 1, expiresAt: -1, generatedAt: -1 })
housewaresMarketSnapshotSchema.index({ registryHash: 1, expiresAt: -1 })
housewaresMarketSnapshotSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

const HousewaresMarketSnapshot = models[DOCUMENT_NAME] || model(DOCUMENT_NAME, housewaresMarketSnapshotSchema)

module.exports = {
    COLLECTION_NAME,
    DOCUMENT_NAME,
    HousewaresMarketSnapshot,
    MARKET_SIGNAL_TYPES,
    MARKET_SNAPSHOT_STATUSES,
    MARKET_SOURCE_STATUSES,
    freshnessSchema,
    housewaresMarketSnapshotSchema,
    marketSignalSchema,
    sourceHealthSchema,
    sourceRecordSchema
}
