'use strict'

const { Schema, model } = require('mongoose')
const {
  QA_CASE_STATUSES,
  QA_ENVIRONMENTS,
  QA_EXECUTION_MODES
} = require('../config/agenticBlogQa.config')

const runAttemptSchema = new Schema(
  {
    attempt: { type: Number, required: true, min: 1, max: 4 },
    batchIteration: { type: Number, required: true, min: 0, max: 3 },
    executionMode: { type: String, enum: QA_EXECUTION_MODES, required: true },
    idempotencyKeyHash: { type: String, required: true, maxlength: 128 },
    executionKey: { type: String, default: '', maxlength: 320 },
    leaseOwnerHash: { type: String, default: '', maxlength: 128 },
    commitClaimedAt: { type: Date, default: null },
    executionId: { type: Schema.Types.ObjectId, ref: 'BlogAutomationExecution', default: null },
    status: {
      type: String,
      enum: ['queued', 'running', 'draft_created', 'failed', 'blocked'],
      default: 'queued'
    },
    queuedAt: { type: Date, required: true },
    scheduledFor: { type: Date, default: null },
    dispatchState: { type: String, enum: ['pending', 'dispatched', 'failed'], default: 'pending' },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    errorCode: { type: String, default: '', maxlength: 120 }
  },
  { _id: false }
)

const schema = new Schema(
  {
    batchId: { type: Schema.Types.ObjectId, ref: 'AgenticBlogQaBatch', required: true, immutable: true },
    caseKey: { type: String, required: true, trim: true, maxlength: 120, immutable: true },
    isQaTest: { type: Boolean, default: true, immutable: true },
    qaBatchId: { type: Schema.Types.ObjectId, ref: 'AgenticBlogQaBatch', required: true, immutable: true },
    qaCaseId: { type: Schema.Types.ObjectId, ref: 'AgenticBlogQaCase', required: true, immutable: true },
    environment: { type: String, enum: QA_ENVIRONMENTS, required: true, immutable: true },
    executionMode: { type: String, enum: QA_EXECUTION_MODES, required: true, immutable: true },
    scheduleMode: { type: String, enum: ['fixed_brief'], default: 'fixed_brief', immutable: true },
    originalTopicSeed: { type: String, required: true, trim: true, maxlength: 300, immutable: true },
    mainEntity: { type: String, default: '', trim: true, maxlength: 200, immutable: true },
    topicCore: { type: String, default: '', trim: true, maxlength: 300, immutable: true },
    userProblem: { type: String, default: '', trim: true, maxlength: 500, immutable: true },
    audience: { type: String, default: '', trim: true, maxlength: 300, immutable: true },
    plannedOutline: { type: [String], default: [], immutable: true },
    topicSeed: { type: String, required: true, trim: true, maxlength: 300, immutable: true },
    effectiveTopic: { type: String, required: true, trim: true, maxlength: 300, immutable: true },
    normalizedTopicKey: { type: String, required: true, trim: true, maxlength: 320, immutable: true },
    topicFingerprint: { type: String, required: true, trim: true, maxlength: 128, immutable: true },
    semanticFingerprint: { type: String, required: true, trim: true, maxlength: 128, immutable: true },
    outlineFingerprint: { type: String, required: true, trim: true, maxlength: 128, immutable: true },
    topicReservationId: { type: String, required: true, trim: true, maxlength: 160, immutable: true },
    articleType: { type: String, required: true, trim: true, maxlength: 100, immutable: true },
    contentRole: { type: String, required: true, trim: true, maxlength: 120, immutable: true },
    searchIntent: { type: String, required: true, trim: true, maxlength: 120, immutable: true },
    productMode: { type: String, enum: ['off', 'auto', 'required'], default: 'off', immutable: true },
    productIntensity: { type: String, enum: ['light', 'balanced', 'commercial'], default: 'light', immutable: true },
    placementStyle: { type: String, default: '', trim: true, maxlength: 120, immutable: true },
    scheduleId: { type: Schema.Types.ObjectId, ref: 'BlogAutomationSchedule', default: null },
    executionId: { type: Schema.Types.ObjectId, ref: 'BlogAutomationExecution', default: null },
    blogId: { type: Schema.Types.ObjectId, ref: 'BlogPost', default: null },
    expectedRunAt: { type: Date, default: null },
    actualRunAt: { type: Date, default: null },
    status: { type: String, enum: QA_CASE_STATUSES, default: 'planned' },
    variationKey: { type: String, default: '', maxlength: 80, immutable: true },
    scheduleConfiguration: { type: Schema.Types.Mixed, required: true, immutable: true },
    runAttempts: { type: [runAttemptSchema], default: [] },
    acceptanceReportId: { type: Schema.Types.ObjectId, ref: 'SeniorBlogAcceptanceReport', default: null },
    seniorScore: { type: Number, default: null, min: 0, max: 100 },
    existingSeoScore: { type: Number, default: null, min: 0, max: 100 },
    hardGatePassed: { type: Boolean, default: false },
    draftAcceptance: { type: Schema.Types.Mixed, default: () => ({ pass: false }) },
    publishAcceptance: {
      type: Schema.Types.Mixed,
      default: () => ({ pass: false, reasonCode: 'qa_publish_forbidden' })
    },
    issueCounts: { type: Schema.Types.Mixed, default: () => ({ critical: 0, high: 0, medium: 0, low: 0 }) },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    lastErrorCode: { type: String, default: '', maxlength: 120 }
  },
  {
    collection: 'AgenticBlogQaCases',
    timestamps: true,
    autoCreate: false,
    autoIndex: false
  }
)

schema.index({ batchId: 1, caseKey: 1 }, { unique: true, name: 'qa_case_batch_case_key_unique' })
schema.index({ batchId: 1, status: 1 }, { name: 'qa_case_batch_status' })
schema.index({ environment: 1, topicFingerprint: 1 }, { name: 'qa_case_environment_topic' })

schema.pre('validate', function validateQaCase(next) {
  if (
    this.isQaTest !== true ||
    String(this.batchId) !== String(this.qaBatchId) ||
    String(this._id) !== String(this.qaCaseId) ||
    this.environment === 'production' ||
    this.scheduleMode !== 'fixed_brief' ||
    this.publishAcceptance?.pass === true
  ) {
    return next(new Error('Agentic Blog QA case metadata or safety state is invalid'))
  }
  const schedule = this.scheduleConfiguration || {}
  if (schedule.autoPublish === true || schedule.draftOnly !== true || schedule.generateImages === true) {
    return next(new Error('Agentic Blog QA schedule configuration must remain draft-only and provider-safe'))
  }
  next()
})

module.exports = {
  AgenticBlogQaCase: model('AgenticBlogQaCase', schema)
}
