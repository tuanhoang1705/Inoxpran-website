'use strict'

const { Schema, model } = require('mongoose')
const { QA_ENVIRONMENTS } = require('../config/agenticBlogQa.config')

const consumptionSchema = new Schema({
  iteration: { type: Number, required: true, min: 0, max: 3 },
  executionMode: { type: String, enum: ['run_now', 'schedule_run_now', 'actual_schedule'], required: true },
  blogId: { type: Schema.Types.ObjectId, ref: 'BlogPost', required: true },
  executionId: { type: Schema.Types.ObjectId, ref: 'BlogAutomationExecution', required: true },
  consumedAt: { type: Date, required: true }
}, { _id: false })

const schema = new Schema(
  {
    _id: { type: String, required: true },
    isQaTest: { type: Boolean, default: true, immutable: true },
    batchId: { type: Schema.Types.ObjectId, ref: 'AgenticBlogQaBatch', required: true, immutable: true },
    caseId: { type: Schema.Types.ObjectId, ref: 'AgenticBlogQaCase', required: true, immutable: true },
    qaBatchId: { type: Schema.Types.ObjectId, ref: 'AgenticBlogQaBatch', required: true, immutable: true },
    qaCaseId: { type: Schema.Types.ObjectId, ref: 'AgenticBlogQaCase', required: true, immutable: true },
    environment: { type: String, enum: QA_ENVIRONMENTS, required: true, immutable: true },
    executionMode: {
      type: String,
      enum: ['run_now', 'schedule_run_now', 'actual_schedule'],
      required: true,
      immutable: true
    },
    originalTopicSeed: { type: String, required: true, trim: true, maxlength: 300, immutable: true },
    effectiveTopic: { type: String, required: true, trim: true, maxlength: 300, immutable: true },
    normalizedTopicKey: { type: String, required: true, trim: true, maxlength: 320, immutable: true },
    topicFingerprint: { type: String, required: true, maxlength: 128, immutable: true },
    semanticFingerprint: { type: String, required: true, maxlength: 128, immutable: true },
    outlineFingerprint: { type: String, required: true, maxlength: 128, immutable: true },
    semanticProfile: { type: Schema.Types.Mixed, required: true, immutable: true },
    status: { type: String, enum: ['reserved', 'consumed', 'released'], default: 'reserved' },
    reservedAt: { type: Date, required: true, immutable: true },
    releasedAt: { type: Date, default: null },
    consumedAt: { type: Date, default: null },
    blogId: { type: Schema.Types.ObjectId, ref: 'BlogPost', default: null },
    executionId: { type: Schema.Types.ObjectId, ref: 'BlogAutomationExecution', default: null }
    , consumptions: { type: [consumptionSchema], default: [] }
  },
  {
    collection: 'QaTopicReservations',
    timestamps: true,
    autoCreate: false,
    autoIndex: false
  }
)

schema.index(
  { normalizedTopicKey: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['reserved', 'consumed'] } },
    name: 'qa_topic_normalized_active_unique'
  }
)
schema.index(
  { topicFingerprint: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['reserved', 'consumed'] } },
    name: 'qa_topic_fingerprint_active_unique'
  }
)
schema.index(
  { semanticFingerprint: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['reserved', 'consumed'] } },
    name: 'qa_topic_semantic_active_unique'
  }
)
schema.index(
  { outlineFingerprint: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['reserved', 'consumed'] } },
    name: 'qa_topic_outline_active_unique'
  }
)
schema.index({ batchId: 1, caseId: 1 }, { name: 'qa_topic_batch_case' })

schema.pre('validate', function validateQaReservation(next) {
  if (
    this.isQaTest !== true ||
    String(this.batchId) !== String(this.qaBatchId) ||
    String(this.caseId) !== String(this.qaCaseId) ||
    this.environment === 'production'
  ) {
    return next(new Error('QA topic reservation provenance is invalid'))
  }
  next()
})

module.exports = {
  QaTopicReservation: model('QaTopicReservation', schema)
}
