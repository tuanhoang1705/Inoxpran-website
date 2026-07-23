'use strict'

const { Schema, model } = require('mongoose')
const { MAX_REMEDIATION_ITERATIONS } = require('../config/agenticBlogQa.config')

const schema = new Schema(
  {
    isQaTest: { type: Boolean, default: true, immutable: true },
    batchId: { type: Schema.Types.ObjectId, ref: 'AgenticBlogQaBatch', required: true, immutable: true },
    caseId: { type: Schema.Types.ObjectId, ref: 'AgenticBlogQaCase', required: true, immutable: true },
    qaBatchId: { type: Schema.Types.ObjectId, ref: 'AgenticBlogQaBatch', required: true, immutable: true },
    qaCaseId: { type: Schema.Types.ObjectId, ref: 'AgenticBlogQaCase', required: true, immutable: true },
    environment: { type: String, enum: ['local', 'staging'], required: true, immutable: true },
    executionMode: {
      type: String,
      enum: ['run_now', 'schedule_run_now', 'actual_schedule'],
      required: true,
      immutable: true
    },
    originalTopicSeed: { type: String, required: true, trim: true, maxlength: 300, immutable: true },
    normalizedTopicKey: { type: String, required: true, trim: true, maxlength: 320, immutable: true },
    caseIds: { type: [{ type: Schema.Types.ObjectId, ref: 'AgenticBlogQaCase' }], required: true, immutable: true },
    sourceReportIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'SeniorBlogAcceptanceReport' }],
      required: true,
      immutable: true
    },
    iteration: { type: Number, required: true, min: 1, max: MAX_REMEDIATION_ITERATIONS, immutable: true },
    idempotencyKeyHash: { type: String, required: true, maxlength: 128, immutable: true },
    classification: {
      type: String,
      enum: ['article_specific', 'shared_stage', 'systemic_workflow'],
      required: true,
      immutable: true
    },
    status: {
      type: String,
      enum: ['awaiting_action', 'in_progress', 'completed', 'failed', 'blocked'],
      default: 'awaiting_action'
    },
    issueCodes: { type: [String], required: true, immutable: true },
    failedLayer: { type: String, default: '', maxlength: 160, immutable: true },
    plan: { type: [Schema.Types.Mixed], required: true, immutable: true },
    regressionControls: { type: [Schema.Types.Mixed], default: [], immutable: true },
    rerunCaseIds: { type: [{ type: Schema.Types.ObjectId, ref: 'AgenticBlogQaCase' }], default: [] },
    controlCaseIds: { type: [{ type: Schema.Types.ObjectId, ref: 'AgenticBlogQaCase' }], default: [] },
    stopNewDrafts: { type: Boolean, default: false, immutable: true },
    requiresArchitectureReport: { type: Boolean, default: false, immutable: true },
    actionState: {
      type: String,
      enum: ['awaiting_article_revision', 'awaiting_code_change'],
      required: true,
      immutable: true
    },
    baselineCodeRevision: { type: String, default: '', maxlength: 160, immutable: true },
    appliedCodeRevision: { type: String, default: '', maxlength: 160 },
    actionEvidence: { type: Schema.Types.Mixed, default: null },
    previousReportIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'SeniorBlogAcceptanceReport' }],
      default: [],
      immutable: true
    },
    resultingReportIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'SeniorBlogAcceptanceReport' }],
      default: []
    },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    errorCode: { type: String, default: '', maxlength: 120 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'Admin', default: null, immutable: true }
  },
  {
    collection: 'QaRemediationAttempts',
    timestamps: true,
    autoCreate: false,
    autoIndex: false
  }
)

schema.index(
  { batchId: 1, idempotencyKeyHash: 1 },
  { unique: true, name: 'qa_remediation_batch_idempotency_unique' }
)
schema.index({ batchId: 1, iteration: 1 }, { unique: true, name: 'qa_remediation_batch_iteration_unique' })
schema.index({ batchId: 1, iteration: 1, status: 1 }, { name: 'qa_remediation_batch_iteration_status' })

schema.pre('validate', function validateQaRemediation(next) {
  if (
    this.isQaTest !== true ||
    String(this.batchId) !== String(this.qaBatchId) ||
    String(this.caseId) !== String(this.qaCaseId) ||
    this.environment === 'production'
  ) {
    return next(new Error('QA remediation provenance is invalid'))
  }
  next()
})

module.exports = {
  QaRemediationAttempt: model('QaRemediationAttempt', schema)
}
