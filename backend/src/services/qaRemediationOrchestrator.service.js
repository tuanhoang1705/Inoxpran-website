'use strict'

const crypto = require('node:crypto')
const { Types } = require('mongoose')
const { QaRemediationAttempt } = require('../models/qaRemediationAttempt.model')
const { BadRequestError, ConflictRequestError } = require('../core/error.response')
const { MAX_REMEDIATION_ITERATIONS } = require('../config/agenticBlogQa.config')

const SYSTEMIC_CODES = new Set([
  'artifact_chain_bypass',
  'duplicate_execution',
  'qa_topic_uniqueness_bypass',
  'schedule_not_triggered',
  'schedule_ownership_invalid',
  'senior_auditor_not_independent',
  'critical_gate_bypass',
  'qa_publish_forbidden',
  'qa_telegram_forbidden'
])

const sha256 = value => crypto.createHash('sha256').update(String(value || '')).digest('hex')
const currentCodeRevision = (env = process.env) => String(
  env.AGENTIC_BLOG_QA_CODE_REVISION || env.GIT_COMMIT_SHA || env.SOURCE_VERSION || ''
).trim().slice(0, 160)
const validCodeRevision = value => {
  const normalized = String(value || '').trim()
  return normalized.length >= 7 && normalized.length <= 160 && /^[A-Za-z0-9._:/@+\-]+$/.test(normalized)
}

const assertObjectId = (value, field) => {
  if (!Types.ObjectId.isValid(String(value || ''))) throw new BadRequestError(`${field} is invalid`)
  return new Types.ObjectId(String(value))
}

const toCode = value => String(value || 'unspecified_issue')
  .trim()
  .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
  .replace(/[^a-zA-Z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '')
  .toLowerCase()
  .slice(0, 120) || 'unspecified_issue'

const normalizeFailureCode = value => {
  const code = toCode(value)
  if (/artifact.*chain/.test(code)) return 'artifact_chain_bypass'
  if (/duplicate.*execution/.test(code)) return 'duplicate_execution'
  if (/topic.*(?:unique|duplicate|reservation)/.test(code)) return 'qa_topic_uniqueness_bypass'
  if (/schedule.*ownership/.test(code)) return 'schedule_ownership_invalid'
  if (/schedule.*(?:not.*trigger|trigger.*fail)/.test(code)) return 'schedule_not_triggered'
  if (/(?:auditor|blind.*review|independence)/.test(code)) return 'senior_auditor_not_independent'
  if (/(?:publish|publicly_reachable|index_requested)/.test(code)) return 'qa_publish_forbidden'
  if (/telegram/.test(code)) return 'qa_telegram_forbidden'
  return code
}

const failedReport = report => report?.verdict === 'failed' ||
  report?.draftAcceptance?.pass === false ||
  report?.hardGatePassed === false

const normalizeIssues = reports => {
  const issues = []
  const push = ({ report, code, severity = 'high', source }) => {
    issues.push({
      caseId: String(report?.caseId || report?.qaCaseId || ''),
      reportId: String(report?._id || report?.id || ''),
      code: normalizeFailureCode(code),
      severity: ['critical', 'high', 'medium', 'low'].includes(String(severity).toLowerCase())
        ? String(severity).toLowerCase()
        : 'high',
      source
    })
  }

  for (const report of Array.isArray(reports) ? reports : []) {
    if (!failedReport(report)) continue
    for (const category of Object.values(report?.categories || {})) {
      for (const issue of Array.isArray(category?.issues) ? category.issues : []) {
        push({ report, code: issue?.code, severity: issue?.severity || 'medium', source: 'category_issue' })
      }
    }
    for (const gate of Array.isArray(report?.hardGates) ? report.hardGates : []) {
      if (gate?.pass === false) {
        push({ report, code: gate.reasonCode || gate.key || 'critical_gate_bypass', severity: gate.severity || 'high', source: 'hard_gate' })
      }
    }
    for (const code of Array.isArray(report?.draftAcceptance?.reasonCodes) ? report.draftAcceptance.reasonCodes : []) {
      push({ report, code, severity: 'high', source: 'draft_reason' })
    }
    for (const issue of Array.isArray(report?.criticalHighIssues) ? report.criticalHighIssues : []) {
      push({ report, code: issue?.code, severity: issue?.severity || 'high', source: 'auditor_issue' })
    }
    if (report?.independence?.blindReviewConfirmed !== true) {
      push({ report, code: 'senior_auditor_not_independent', severity: 'critical', source: 'independence' })
    }
    if (
      Number.isFinite(Number(report?.existingSeoScore)) &&
      Number.isFinite(Number(report?.existingSeoThreshold)) &&
      Number(report.existingSeoScore) < Number(report.existingSeoThreshold)
    ) {
      push({ report, code: 'existing_seo_score_below_threshold', severity: 'high', source: 'seo_threshold' })
    }
  }

  const seen = new Set()
  return issues.filter(issue => {
    const key = `${issue.caseId}\0${issue.reportId}\0${issue.code}\0${issue.severity}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const classifyRemediation = ({ reports, caseCount, priorAttempts = [] }) => {
  const issues = normalizeIssues(reports)
  const failedCaseIds = Array.from(new Set(
    (Array.isArray(reports) ? reports : [])
      .filter(failedReport)
      .map(report => String(report.caseId || report.qaCaseId || ''))
      .filter(Boolean)
  ))
  if (!failedCaseIds.length) throw new BadRequestError('No failed QA reports are available for remediation')
  if (!issues.length) {
    issues.push(...failedCaseIds.map(caseId => ({ caseId, reportId: '', code: 'article_acceptance_failure', severity: 'high', source: 'verdict' })))
  }

  const criticalCount = issues.filter(issue => issue.severity === 'critical').length
  const counts = new Map()
  for (const issue of issues) {
    if (!counts.has(issue.code)) counts.set(issue.code, new Set())
    if (issue.caseId) counts.get(issue.code).add(issue.caseId)
  }
  const systemicIssue = issues.find(issue => SYSTEMIC_CODES.has(issue.code))
  const repeatedSystemic = (Array.isArray(priorAttempts) ? priorAttempts : [])
    .filter(attempt => attempt.classification === 'systemic_workflow').length >= 2
  if (systemicIssue || criticalCount >= 2 || repeatedSystemic) {
    return {
      classification: 'systemic_workflow',
      failedLayer: systemicIssue?.code || (criticalCount >= 2 ? 'critical_quality_gate' : 'repeated_systemic_failure'),
      affectedCaseIds: failedCaseIds,
      issues
    }
  }

  const fullBatchCaseCount = Math.max(1, Number(caseCount) || failedCaseIds.length)
  const shared = Array.from(counts.entries()).find(([, cases]) =>
    cases.size >= 2 || cases.size / fullBatchCaseCount >= 0.25
  )
  if (shared) {
    return {
      classification: 'shared_stage',
      failedLayer: shared[0],
      affectedCaseIds: failedCaseIds.filter(caseId => shared[1].has(caseId)),
      issues
    }
  }
  return {
    classification: 'article_specific',
    failedLayer: issues[0]?.code || 'article_acceptance_failure',
    affectedCaseIds: failedCaseIds,
    issues
  }
}

const validatePlan = ({ plan, classification }) => {
  if (!Array.isArray(plan) || !plan.length) throw new BadRequestError('A remediation plan is required')
  const normalized = plan.slice(0, 50).map(step => {
    if (!step || typeof step !== 'object') throw new BadRequestError('Each remediation step must be an object')
    const action = String(step.action || '').trim()
    if (!action) throw new BadRequestError('Each remediation step requires an action')
    if (/lower.*threshold|remove.*case|publish|telegram|disable.*gate/i.test(action)) {
      throw new BadRequestError('The remediation plan attempts to weaken a QA safety or acceptance rule')
    }
    return {
      action: action.slice(0, 300),
      target: String(step.target || '').trim().slice(0, 200),
      expectedEvidence: String(step.expectedEvidence || '').trim().slice(0, 500)
    }
  })
  if (classification !== 'article_specific' && !normalized.some(step => /regression|contract|service|workflow|stage/i.test(`${step.action} ${step.target}`))) {
    throw new BadRequestError('Shared or systemic remediation must include a shared-layer regression action')
  }
  return normalized
}

const buildRemediationPlan = ({ classification, failedLayer }) => {
  if (classification === 'systemic_workflow') {
    return [
      { action: 'Produce a root-cause architecture report from persisted evidence', target: failedLayer, expectedEvidence: 'Exact failed layer and bypass path identified' },
      { action: 'Repair only the proven workflow contract or service boundary', target: failedLayer, expectedEvidence: 'Backward-compatible integration change awaiting code review' },
      { action: 'Add integration regression coverage before any QA rerun', target: 'qa_batch', expectedEvidence: 'Affected cases plus an unaffected control are covered' }
    ]
  }
  if (classification === 'shared_stage') {
    return [
      { action: 'Keep creation of additional drafts stopped while the shared stage is defective', target: failedLayer, expectedEvidence: 'No new case enters writer execution' },
      { action: 'Repair the shared contract or service stage', target: failedLayer, expectedEvidence: 'Repeated issue removed at its source and awaiting code review' },
      { action: 'Add a regression control before rerunning affected cases', target: 'shared_stage', expectedEvidence: 'Affected cases plus one unaffected control are specified' }
    ]
  }
  return [
    { action: 'Prepare a revision for only the affected QA draft', target: failedLayer, expectedEvidence: 'Required fix is visible in a retained draft revision' },
    { action: 'Rerun every review and deterministic gate for the complete article after revision', target: 'qa_case', expectedEvidence: 'A new immutable acceptance report is required' },
    { action: 'Run an article regression control before accepting the revision', target: 'qa_case', expectedEvidence: 'Previously passing sections remain valid' }
  ]
}

const buildRegressionControls = ({ classification, affectedCaseIds }) => [
  {
    control: 'affected_cases_rechecked',
    required: true,
    scope: affectedCaseIds,
    evidence: 'Every affected case must receive a new immutable report after an approved action'
  },
  {
    control: classification === 'article_specific' ? 'passing_sections_unchanged' : 'unaffected_case_control',
    required: true,
    scope: classification === 'article_specific' ? affectedCaseIds : ['one_unaffected_case'],
    evidence: 'The remediation must not regress previously passing behavior'
  },
  {
    control: 'safety_policy_unchanged',
    required: true,
    scope: ['draft_only', 'no_telegram', 'no_indexing', 'no_public_publish'],
    evidence: 'All QA safety gates remain enforced'
  }
]

const buildRemediationIdempotencyHash = ({ batchId, idempotencyKey }) =>
  sha256(`qa-remediation-v2\0${String(batchId)}\0${String(idempotencyKey || '').trim()}`)

class QaRemediationOrchestrator {
  constructor({ AttemptModel = QaRemediationAttempt, CodeRevision = currentCodeRevision, now = () => new Date() } = {}) {
    this.AttemptModel = AttemptModel
    this.CodeRevision = CodeRevision
    this.now = now
  }

  async plan({ batch, cases, reports, priorAttempts = [], iteration, idempotencyKey, plan, createdBy = null }) {
    if (batch?.isQaTest !== true || batch?.environment === 'production') {
      throw new BadRequestError('Remediation is limited to trusted local or staging QA batches')
    }
    const rawKey = String(idempotencyKey || '').trim()
    if (rawKey.length < 8 || rawKey.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(rawKey)) {
      throw new BadRequestError('Idempotency-Key must be 8-128 safe ASCII characters')
    }
    const batchId = assertObjectId(batch._id || batch.qaBatchId, 'qaBatchId')
    const idempotencyKeyHash = buildRemediationIdempotencyHash({ batchId, idempotencyKey: rawKey })
    let existingQuery = this.AttemptModel.findOne({ batchId, idempotencyKeyHash })
    if (existingQuery?.lean) existingQuery = existingQuery.lean()
    const existing = await existingQuery
    if (existing) return { attempt: existing, duplicate: true, idempotent: true, stopNewDrafts: existing.stopNewDrafts === true }

    if (!Number.isInteger(iteration) || iteration < 1 || iteration > MAX_REMEDIATION_ITERATIONS) {
      throw new BadRequestError(`Remediation iteration must be between 1 and ${MAX_REMEDIATION_ITERATIONS}`)
    }
    const caseList = Array.isArray(cases) ? cases : []
    if (!caseList.length) throw new BadRequestError('At least one QA case is required for remediation')
    if (plan !== undefined && plan !== null) {
      throw new BadRequestError('Remediation steps are derived from persisted reports, not client input')
    }
    const classification = classifyRemediation({ reports, caseCount: caseList.length, priorAttempts })
    const affected = caseList.filter(item => classification.affectedCaseIds.includes(String(item._id || item.qaCaseId)))
    if (!affected.length) throw new BadRequestError('Failed reports do not match any retained QA case')
    const primary = affected[0]
    const normalizedPlan = validatePlan({
      plan: buildRemediationPlan(classification),
      classification: classification.classification
    })
    const regressionControls = buildRegressionControls({
      classification: classification.classification,
      affectedCaseIds: affected.map(item => String(item._id || item.qaCaseId))
    })
    const baselineCodeRevision = String(await this.CodeRevision() || '').trim()
    if (classification.classification !== 'article_specific' && !validCodeRevision(baselineCodeRevision)) {
      throw new BadRequestError('A verifiable server code revision is required before shared or systemic remediation planning')
    }
    const caseId = assertObjectId(primary._id || primary.qaCaseId, 'qaCaseId')
    const sourceReportIds = (Array.isArray(reports) ? reports : [])
      .filter(failedReport)
      .map(report => report._id || report.id)
      .filter(Boolean)
      .map(value => assertObjectId(value, 'sourceReportId'))
    if (!sourceReportIds.length) throw new BadRequestError('Persisted failed reports are required for remediation')
    const stopNewDrafts = classification.classification !== 'article_specific'
    const document = {
      isQaTest: true,
      batchId,
      caseId,
      qaBatchId: batchId,
      qaCaseId: caseId,
      environment: primary.environment || batch.environment,
      executionMode: primary.executionMode,
      originalTopicSeed: primary.originalTopicSeed,
      normalizedTopicKey: primary.normalizedTopicKey,
      caseIds: affected.map(item => assertObjectId(item._id || item.qaCaseId, 'qaCaseId')),
      sourceReportIds,
      previousReportIds: sourceReportIds,
      iteration,
      idempotencyKeyHash,
      classification: classification.classification,
      failedLayer: classification.failedLayer,
      issueCodes: Array.from(new Set(classification.issues.map(issue => issue.code))),
      plan: normalizedPlan,
      regressionControls,
      stopNewDrafts,
      requiresArchitectureReport: classification.classification === 'systemic_workflow',
      actionState: classification.classification === 'article_specific' ? 'awaiting_article_revision' : 'awaiting_code_change',
      baselineCodeRevision,
      status: 'awaiting_action',
      createdBy: createdBy ? assertObjectId(createdBy, 'createdBy') : null
    }
    try {
      const created = await this.AttemptModel.create(document)
      return {
        attempt: created?.toObject ? created.toObject() : created,
        duplicate: false,
        stopNewDrafts,
        requiresArchitectureReport: document.requiresArchitectureReport,
        executed: false,
        awaitingAction: document.actionState
      }
    } catch (error) {
      if (error?.code !== 11000) throw error
      let duplicateQuery = this.AttemptModel.findOne({ batchId, idempotencyKeyHash })
      if (duplicateQuery?.lean) duplicateQuery = duplicateQuery.lean()
      const duplicate = await duplicateQuery
      if (duplicate) return { attempt: duplicate, duplicate: true, idempotent: true, stopNewDrafts: duplicate.stopNewDrafts === true }
      throw new ConflictRequestError('QA remediation idempotency conflict')
    }
  }
}

module.exports = {
  QaRemediationOrchestrator,
  SYSTEMIC_CODES,
  buildRegressionControls,
  buildRemediationIdempotencyHash,
  buildRemediationPlan,
  classifyRemediation,
  currentCodeRevision,
  failedReport,
  normalizeFailureCode,
  normalizeIssues,
  validCodeRevision,
  validatePlan
}
