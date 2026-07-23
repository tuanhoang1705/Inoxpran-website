'use strict'

const { Schema, model } = require('mongoose')
const { SENIOR_ACCEPTANCE_SCORE } = require('../config/agenticBlogQa.config')

const scoreCategorySchema = new Schema(
  {
    score: { type: Number, required: true, min: 0 },
    maximum: { type: Number, required: true, min: 1 },
    notApplicable: { type: Boolean, default: false },
    evidence: { type: [String], required: true },
    strengths: { type: [String], default: [] },
    issues: { type: [Schema.Types.Mixed], default: [] },
    requiredFixes: { type: [String], default: [] }
  },
  { _id: false }
)

const acceptanceSchema = new Schema(
  {
    pass: { type: Boolean, required: true },
    reasonCodes: { type: [String], default: [] }
  },
  { _id: false }
)

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
    blogId: { type: Schema.Types.ObjectId, ref: 'BlogPost', required: true, immutable: true },
    executionId: { type: Schema.Types.ObjectId, ref: 'BlogAutomationExecution', required: true, immutable: true },
    iteration: { type: Number, required: true, min: 0, max: 3, immutable: true },
    version: { type: Number, required: true, min: 1, immutable: true },
    previousReportId: { type: Schema.Types.ObjectId, ref: 'SeniorBlogAcceptanceReport', default: null, immutable: true },
    reviewKeyHash: { type: String, required: true, maxlength: 128, immutable: true },
    contentRevisionHash: { type: String, required: true, maxlength: 128, immutable: true },
    blindInputHash: { type: String, required: true, maxlength: 128, immutable: true },
    blindReview: { type: Boolean, default: true, immutable: true },
    independence: { type: Schema.Types.Mixed, required: true, immutable: true },
    rubricVersion: { type: String, default: 'senior-blog-acceptance-v1', immutable: true },
    categories: {
      strategyAlignment: { type: scoreCategorySchema, required: true },
      peopleFirstUsefulness: { type: scoreCategorySchema, required: true },
      originalityInformationGain: { type: scoreCategorySchema, required: true },
      researchEvidenceFacts: { type: scoreCategorySchema, required: true },
      editorialQuality: { type: scoreCategorySchema, required: true },
      seoArchitecture: { type: scoreCategorySchema, required: true },
      aeoGeoClarity: { type: scoreCategorySchema, required: true },
      productMarketingCta: { type: scoreCategorySchema, required: true },
      brandTrustDisclosure: { type: scoreCategorySchema, required: true },
      visualAccessibility: { type: scoreCategorySchema, required: true },
      cmsSecurityReadiness: { type: scoreCategorySchema, required: true }
    },
    totalScore: { type: Number, required: true, min: 0, max: 100, immutable: true },
    acceptanceThreshold: {
      type: Number,
      default: SENIOR_ACCEPTANCE_SCORE,
      min: SENIOR_ACCEPTANCE_SCORE,
      max: SENIOR_ACCEPTANCE_SCORE,
      immutable: true
    },
    existingSeoScore: { type: Number, required: true, min: 0, max: 100, immutable: true },
    existingSeoThreshold: { type: Number, required: true, min: 85, max: 100, immutable: true },
    deterministicEvidence: { type: Schema.Types.Mixed, required: true, immutable: true },
    existingGateResults: { type: Schema.Types.Mixed, required: true, immutable: true },
    hardGates: { type: [Schema.Types.Mixed], required: true, immutable: true },
    auditorHardGates: { type: [Schema.Types.Mixed], required: true, immutable: true },
    publishOnlyGates: { type: [Schema.Types.Mixed], required: true, immutable: true },
    criticalHighIssues: { type: [Schema.Types.Mixed], required: true, immutable: true },
    hardGatePassed: { type: Boolean, required: true, immutable: true },
    issueCounts: { type: Schema.Types.Mixed, required: true, immutable: true },
    requiredFixes: { type: [String], default: [], immutable: true },
    draftAcceptance: { type: acceptanceSchema, required: true, immutable: true },
    publishAcceptance: { type: acceptanceSchema, required: true, immutable: true },
    verdict: { type: String, enum: ['passed', 'failed'], required: true, immutable: true },
    auditorAgentId: { type: String, default: 'senior-blog-acceptance-auditor', immutable: true },
    evaluatedAt: { type: Date, required: true, immutable: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'Admin', default: null, immutable: true }
  },
  {
    collection: 'SeniorBlogAcceptanceReports',
    timestamps: true,
    autoCreate: false,
    autoIndex: false
  }
)

schema.index({ caseId: 1, iteration: 1 }, { unique: true, name: 'senior_acceptance_case_iteration_unique' })
schema.index({ caseId: 1, version: 1 }, { unique: true, name: 'senior_acceptance_case_version_unique' })
schema.index({ reviewKeyHash: 1 }, { unique: true, name: 'senior_acceptance_review_key_unique' })
schema.index({ batchId: 1, verdict: 1 }, { name: 'senior_acceptance_batch_verdict' })

schema.pre('validate', function validateImmutableVerdict(next) {
  if (
    this.isQaTest !== true ||
    String(this.batchId) !== String(this.qaBatchId) ||
    String(this.caseId) !== String(this.qaCaseId) ||
    this.environment === 'production' ||
    this.acceptanceThreshold !== SENIOR_ACCEPTANCE_SCORE ||
    this.publishAcceptance?.pass !== false ||
    (this.blindReview !== true && this.verdict !== 'failed') ||
    (this.blindReview !== true && this.draftAcceptance?.pass !== false) ||
    this.totalScore > 100
  ) {
    return next(new Error('Senior Blog Acceptance report violates immutable acceptance rules'))
  }
  next()
})

const blockMutation = function blockMutation(next) {
  next(new Error('Senior Blog Acceptance reports are immutable'))
}

schema.pre('save', function blockExistingDocumentSave(next) {
  if (!this.isNew) return next(new Error('Senior Blog Acceptance reports are immutable'))
  next()
})

schema.pre('deleteOne', { document: true, query: false }, blockMutation)

schema.pre('bulkWrite', function blockBulkMutation(next, operations) {
  const mutatingExisting = (Array.isArray(operations) ? operations : []).some(operation =>
    operation.updateOne || operation.updateMany || operation.replaceOne || operation.deleteOne || operation.deleteMany
  )
  if (mutatingExisting) return next(new Error('Senior Blog Acceptance reports are immutable'))
  next()
})

for (const operation of [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'findOneAndReplace',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete'
]) {
  schema.pre(operation, blockMutation)
}

module.exports = {
  SeniorBlogAcceptanceReport: model('SeniorBlogAcceptanceReport', schema)
}
