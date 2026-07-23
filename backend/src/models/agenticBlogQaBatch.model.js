'use strict'

const { Schema, model } = require('mongoose')
const {
  QA_BATCH_STATUSES,
  QA_ENVIRONMENTS,
  SENIOR_ACCEPTANCE_SCORE,
  MAX_REMEDIATION_ITERATIONS
} = require('../config/agenticBlogQa.config')

const schema = new Schema(
  {
    isQaTest: { type: Boolean, default: true, immutable: true },
    qaBatchId: { type: Schema.Types.ObjectId, ref: 'AgenticBlogQaBatch', required: true, immutable: true },
    batchKeyHash: { type: String, required: true, maxlength: 128, immutable: true },
    environment: { type: String, enum: QA_ENVIRONMENTS, required: true, immutable: true },
    status: { type: String, enum: QA_BATCH_STATUSES, default: 'planned' },
    stopNewDrafts: { type: Boolean, default: false },
    acceptanceThreshold: {
      type: Number,
      default: SENIOR_ACCEPTANCE_SCORE,
      min: SENIOR_ACCEPTANCE_SCORE,
      max: SENIOR_ACCEPTANCE_SCORE,
      immutable: true
    },
    existingSeoThreshold: { type: Number, required: true, min: 85, max: 100, immutable: true },
    iteration: { type: Number, default: 0, min: 0, max: MAX_REMEDIATION_ITERATIONS },
    maxIterations: {
      type: Number,
      default: MAX_REMEDIATION_ITERATIONS,
      min: 1,
      max: MAX_REMEDIATION_ITERATIONS,
      immutable: true
    },
    requireAllCasesPass: { type: Boolean, default: true, immutable: true },
    caseIds: { type: [{ type: Schema.Types.ObjectId, ref: 'AgenticBlogQaCase' }], default: [] },
    topicFingerprints: { type: [String], default: [] },
    functionalResult: { type: Schema.Types.Mixed, default: () => ({}) },
    portfolioResult: { type: Schema.Types.Mixed, default: () => ({}) },
    hardGateResult: { type: Schema.Types.Mixed, default: () => ({}) },
    remediationState: { type: String, default: '', maxlength: 80 },
    safetyPolicy: {
      allowPublicPublish: { type: Boolean, default: false, immutable: true },
      telegramEnabled: { type: Boolean, default: false, immutable: true },
      paidImagesEnabled: { type: Boolean, default: false, immutable: true },
      requestIndexing: { type: Boolean, default: false, immutable: true },
      socialDistribution: { type: Boolean, default: false, immutable: true },
      blindReviewEnabled: { type: Boolean, default: true, immutable: true },
      topicUniquenessEnabled: { type: Boolean, default: true, immutable: true }
    },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'Admin', default: null, immutable: true },
    lastErrorCode: { type: String, default: '', maxlength: 120 }
  },
  {
    collection: 'AgenticBlogQaBatches',
    timestamps: true,
    autoCreate: false,
    autoIndex: false
  }
)

schema.index({ environment: 1, status: 1, createdAt: -1 }, { name: 'qa_batch_environment_status_created' })
schema.index({ environment: 1, batchKeyHash: 1 }, { unique: true, name: 'qa_batch_environment_key_unique' })

schema.pre('validate', function validateSafety(next) {
  const unsafe =
    this.isQaTest !== true ||
    String(this._id) !== String(this.qaBatchId) ||
    this.environment === 'production' ||
    this.acceptanceThreshold !== SENIOR_ACCEPTANCE_SCORE ||
    this.requireAllCasesPass !== true ||
    this.safetyPolicy?.allowPublicPublish === true ||
    this.safetyPolicy?.telegramEnabled === true ||
    this.safetyPolicy?.paidImagesEnabled === true ||
    this.safetyPolicy?.requestIndexing === true ||
    this.safetyPolicy?.socialDistribution === true
  if (unsafe) return next(new Error('Agentic Blog QA batch violates its immutable safety policy'))
  next()
})

module.exports = {
  AgenticBlogQaBatch: model('AgenticBlogQaBatch', schema)
}
