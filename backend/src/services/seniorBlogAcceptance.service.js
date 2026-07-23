'use strict'

const crypto = require('node:crypto')
const { Types } = require('mongoose')
const { SeniorBlogAcceptanceReport } = require('../models/seniorBlogAcceptanceReport.model')
const { AgenticBlogQaEvidenceService } = require('./agenticBlogQaEvidence.service')
const {
  OpenClawSeniorBlogAuditorAdapter,
  SENIOR_AUDITOR_AGENT_ID
} = require('./seniorBlogAuditorAdapter.service')
const { BadRequestError, ConflictRequestError } = require('../core/error.response')
const {
  MINIMUM_EXISTING_SEO_SCORE,
  SENIOR_ACCEPTANCE_SCORE
} = require('../config/agenticBlogQa.config')

const RUBRIC_VERSION = 'senior-blog-acceptance-v1'
const RUBRIC = Object.freeze([
  Object.freeze({ key: 'strategyAlignment', maximum: 10, floor: 7 }),
  Object.freeze({ key: 'peopleFirstUsefulness', maximum: 12, floor: 9 }),
  Object.freeze({ key: 'originalityInformationGain', maximum: 10, floor: 0 }),
  Object.freeze({ key: 'researchEvidenceFacts', maximum: 14, floor: 11 }),
  Object.freeze({ key: 'editorialQuality', maximum: 10, floor: 0 }),
  Object.freeze({ key: 'seoArchitecture', maximum: 10, floor: 7 }),
  Object.freeze({ key: 'aeoGeoClarity', maximum: 7, floor: 0 }),
  Object.freeze({ key: 'productMarketingCta', maximum: 9, floor: 6, productOnly: true }),
  Object.freeze({ key: 'brandTrustDisclosure', maximum: 6, floor: 0 }),
  Object.freeze({ key: 'visualAccessibility', maximum: 6, floor: 0 }),
  Object.freeze({ key: 'cmsSecurityReadiness', maximum: 6, floor: 5 })
])

if (RUBRIC.reduce((total, item) => total + item.maximum, 0) !== 100) {
  throw new Error('Senior Blog Acceptance rubric must total exactly 100 points')
}

const REQUIRED_EXISTING_GATES = Object.freeze([
  'factReview',
  'originalityReview',
  'seoAeoGeoReview',
  'peopleFirstSpamReview',
  'brandVoiceReview',
  'securityReview',
  'imageReview'
])
const PUBLISH_ONLY_EXISTING_GATES = Object.freeze(['publishReadiness'])
const AUDITOR_GATE_GROUPS = Object.freeze([
  Object.freeze({ key: 'workflow', match: key => key.startsWith('workflow.') }),
  Object.freeze({ key: 'isolation', match: key => key.startsWith('isolation.') }),
  Object.freeze({ key: 'content', match: key => key.startsWith('content.') }),
  Object.freeze({ key: 'evidence', match: key => key.startsWith('evidence.') }),
  Object.freeze({ key: 'product', match: key => key.startsWith('product.') }),
  Object.freeze({ key: 'seo_cms', match: key => key.startsWith('seo.') || key.startsWith('cms.') || key.startsWith('seo_cms.') }),
  Object.freeze({ key: 'images', match: key => key.startsWith('images.') || key.startsWith('image.') }),
  Object.freeze({ key: 'security', match: key => key.startsWith('security.') })
])

const FORBIDDEN_BLIND_KEYS = Object.freeze([
  /writer.*(?:id|identity|model|name)/i,
  /(?:model|provider).*writer/i,
  /writerSelfScore/i,
  /selfScore/i,
  /aggregateSeoScore/i,
  /^seoScore$/i,
  /existingSeoScore/i,
  /previous.*(?:senior|acceptance|remediation).*score/i,
  /prior.*(?:senior|acceptance|remediation).*score/i,
  /remediationScore/i,
  /auditorAgentId/i
])

const sha256 = value => crypto.createHash('sha256').update(String(value || '')).digest('hex')
const deterministicObjectId = value => new Types.ObjectId(sha256(value).slice(0, 24))

const assertObjectId = (value, field) => {
  if (!Types.ObjectId.isValid(String(value || ''))) throw new BadRequestError(`${field} is invalid`)
  return new Types.ObjectId(String(value))
}

const stableSort = value => {
  if (Array.isArray(value)) return value.map(stableSort)
  if (!value || typeof value !== 'object' || value instanceof Date) return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableSort(value[key])]))
}

const stableHash = value => sha256(JSON.stringify(stableSort(value)))

const buildBlindAuditInput = value => {
  const sanitize = current => {
    if (Array.isArray(current)) return current.map(sanitize)
    if (!current || typeof current !== 'object' || current instanceof Date) return current
    const output = {}
    for (const [key, item] of Object.entries(current)) {
      if (FORBIDDEN_BLIND_KEYS.some(pattern => pattern.test(key))) continue
      output[key] = sanitize(item)
    }
    return output
  }
  return sanitize(value || {})
}

const findForbiddenBlindPaths = (value, prefix = '') => {
  if (Array.isArray(value)) return value.flatMap((item, index) => findForbiddenBlindPaths(item, `${prefix}[${index}]`))
  if (!value || typeof value !== 'object') return []
  const paths = []
  for (const [key, item] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (FORBIDDEN_BLIND_KEYS.some(pattern => pattern.test(key))) paths.push(path)
    paths.push(...findForbiddenBlindPaths(item, path))
  }
  return paths
}

const compactIssues = value => (Array.isArray(value) ? value : []).slice(0, 100).map(item => ({
  code: String(item?.code || item?.reasonCode || '').slice(0, 120),
  severity: String(item?.severity || '').slice(0, 20),
  message: String(item?.message || item?.description || '').slice(0, 500)
}))

const buildPersistedBlindInput = ({ qaCase, blog, deterministicEvidence, executionId, evidenceBundle = {} }) => buildBlindAuditInput({
  artifactRefs: {
    qaBatchId: String(qaCase.qaBatchId || qaCase.batchId || ''),
    qaCaseId: String(qaCase._id || qaCase.qaCaseId || ''),
    blogId: String(blog._id || blog.id || ''),
    executionId: String(executionId || blog.agenticExecutionId || '')
  },
  title: blog.blog_title,
  excerpt: blog.blog_excerpt,
  contentHtml: blog.blog_content,
  categoryKey: blog.blog_category_key,
  tags: blog.blog_tags,
  topicSummary: blog.topicSummary,
  entitySummary: blog.entitySummary,
  visualPlan: blog.visualPlan,
  coverImage: blog.coverImage,
  contentImages: blog.contentImages,
  articleType: qaCase.articleType,
  contentRole: qaCase.contentRole,
  searchIntent: qaCase.searchIntent,
  productMode: qaCase.productMode,
  plannedOutline: qaCase.plannedOutline,
  deterministicEvidence: buildBlindAuditInput(deterministicEvidence),
  executionTrace: {
    status: evidenceBundle.execution?.status,
    contentAction: evidenceBundle.execution?.contentAction,
    agentSteps: evidenceBundle.execution?.agentSteps,
    trigger: evidenceBundle.execution?.metadata?.trigger,
    dueAt: evidenceBundle.execution?.metadata?.dueAt,
    artifactIds: {
      googleIntelSnapshotId: String(evidenceBundle.execution?.googleIntelSnapshotId || ''),
      contentOperationsSnapshotId: String(evidenceBundle.execution?.contentOperationsSnapshotId || ''),
      contentInventorySnapshotId: String(evidenceBundle.execution?.contentInventorySnapshotId || ''),
      contentOpportunityDecisionId: String(evidenceBundle.execution?.contentOpportunityDecisionId || ''),
      contentWorkOrderId: String(evidenceBundle.execution?.contentWorkOrderId || ''),
      unifiedContentBriefId: String(evidenceBundle.execution?.unifiedContentBriefId || ''),
      evidenceMapId: String(evidenceBundle.execution?.evidenceMapId || ''),
      researchBundleId: String(evidenceBundle.execution?.researchBundleId || ''),
      editorialStyleProfileId: String(evidenceBundle.execution?.editorialStyleProfileId || ''),
      strategyPlanId: String(evidenceBundle.execution?.strategyPlanId || ''),
      productSeedPlanId: String(evidenceBundle.execution?.productSeedPlanId || ''),
      editorialProductPlacementPlanId: String(evidenceBundle.execution?.editorialProductPlacementPlanId || ''),
      publishReadinessReportId: String(evidenceBundle.execution?.publishReadinessReportId || '')
    }
  },
  workOrder: {
    id: String(evidenceBundle.workOrder?._id || ''),
    decision: evidenceBundle.workOrder?.decision,
    topic: evidenceBundle.workOrder?.topic,
    primaryBusinessGoal: evidenceBundle.workOrder?.primaryBusinessGoal,
    targetAudience: evidenceBundle.workOrder?.targetAudience,
    requiredEvidence: evidenceBundle.workOrder?.requiredEvidence,
    productIntegrationPolicy: evidenceBundle.workOrder?.productIntegrationPolicy,
    successMetrics: evidenceBundle.workOrder?.successMetrics,
    status: evidenceBundle.workOrder?.status
  },
  unifiedBrief: {
    id: String(evidenceBundle.brief?._id || ''),
    topic: evidenceBundle.brief?.topic,
    workingTitle: evidenceBundle.brief?.workingTitle,
    articleType: evidenceBundle.brief?.articleType,
    contentRole: evidenceBundle.brief?.contentRole,
    targetAudience: evidenceBundle.brief?.targetAudience,
    primarySearchIntent: evidenceBundle.brief?.primarySearchIntent,
    userProblems: evidenceBundle.brief?.userProblems,
    mainEntity: evidenceBundle.brief?.mainEntity,
    topicCore: evidenceBundle.brief?.topicCore,
    contentGap: evidenceBundle.brief?.contentGap,
    plannedOutline: evidenceBundle.brief?.plannedOutline,
    requiredFacts: evidenceBundle.brief?.requiredFacts,
    forbiddenClaims: evidenceBundle.brief?.forbiddenClaims,
    reviewRequirements: evidenceBundle.brief?.reviewRequirements,
    productIntegration: evidenceBundle.brief?.productIntegration,
    productPlacementConstraints: evidenceBundle.brief?.productPlacementConstraints,
    imagePlanRequirements: evidenceBundle.brief?.imagePlanRequirements,
    ctaStrategy: evidenceBundle.brief?.ctaStrategy,
    structuredDataCandidate: evidenceBundle.brief?.structuredDataCandidate,
    publishTarget: evidenceBundle.brief?.publishTarget
  },
  researchBundle: {
    id: String(evidenceBundle.researchBundle?._id || ''),
    topic: evidenceBundle.researchBundle?.topic,
    researchCoverage: evidenceBundle.researchBundle?.researchCoverage,
    sources: (evidenceBundle.researchBundle?.sources || []).slice(0, 20).map(source => ({
      title: String(source?.title || '').slice(0, 240),
      sourceType: source?.sourceType,
      failed: source?.failed === true,
      contentHash: source?.contentHash || '',
      fetchedAt: source?.fetchedAt
    })),
    facts: evidenceBundle.researchBundle?.facts,
    sourceAttributions: (evidenceBundle.researchBundle?.sourceAttributions || []).slice(0, 20).map(item => ({ title: item?.title, use: item?.use })),
    copyrightReview: evidenceBundle.researchBundle?.copyrightReview,
    contentHash: evidenceBundle.researchBundle?.contentHash
  },
  evidenceMap: {
    id: String(evidenceBundle.evidenceMap?._id || ''),
    status: evidenceBundle.evidenceMap?.status,
    warnings: evidenceBundle.evidenceMap?.warnings,
    contentHash: evidenceBundle.evidenceMap?.contentHash,
    entries: (evidenceBundle.evidenceMap?.entries || []).slice(0, 100).map(entry => ({
      evidenceKey: entry?.evidenceKey,
      claim: entry?.claim,
      classification: entry?.classification,
      sourceType: entry?.sourceType,
      internalReferenceId: entry?.internalReferenceId,
      confidence: entry?.confidence,
      allowedUsage: entry?.allowedUsage,
      requiredQualification: entry?.requiredQualification,
      status: entry?.status
    }))
  },
  editorialStyle: {
    id: String(evidenceBundle.styleProfile?._id || ''),
    styleFamily: evidenceBundle.styleProfile?.styleFamily,
    openingMode: evidenceBundle.styleProfile?.openingMode,
    headingMode: evidenceBundle.styleProfile?.headingMode,
    paragraphRhythm: evidenceBundle.styleProfile?.paragraphRhythm,
    evidenceMode: evidenceBundle.styleProfile?.evidenceMode,
    ctaMode: evidenceBundle.styleProfile?.ctaMode,
    visualPlanMode: evidenceBundle.styleProfile?.visualPlanMode,
    answerBlockMode: evidenceBundle.styleProfile?.answerBlockMode,
    brandVoiceConstraints: evidenceBundle.styleProfile?.brandVoiceConstraints
  },
  strategyPlan: {
    id: String(evidenceBundle.strategyPlan?._id || ''),
    topic: evidenceBundle.strategyPlan?.topic,
    decision: evidenceBundle.strategyPlan?.decision,
    decisionReason: evidenceBundle.strategyPlan?.decisionReason,
    targetAudience: evidenceBundle.strategyPlan?.targetAudience,
    searchIntent: evidenceBundle.strategyPlan?.searchIntent,
    userProblems: evidenceBundle.strategyPlan?.userProblems,
    contentGap: evidenceBundle.strategyPlan?.contentGap,
    primaryQuestion: evidenceBundle.strategyPlan?.primaryQuestion,
    supportingQuestions: evidenceBundle.strategyPlan?.supportingQuestions,
    articleType: evidenceBundle.strategyPlan?.articleType,
    riskFlags: evidenceBundle.strategyPlan?.riskFlags,
    successCriteria: evidenceBundle.strategyPlan?.successCriteria,
    contentArchitecture: evidenceBundle.strategyPlan?.contentArchitecture
  },
  productPlan: {
    id: String(evidenceBundle.productSeedPlan?._id || ''),
    mode: evidenceBundle.productSeedPlan?.mode,
    intensity: evidenceBundle.productSeedPlan?.intensity,
    decision: evidenceBundle.productSeedPlan?.decision,
    decisionReason: evidenceBundle.productSeedPlan?.decisionReason,
    primaryProduct: evidenceBundle.productSeedPlan?.primaryProduct,
    supportingProducts: evidenceBundle.productSeedPlan?.supportingProducts,
    rejectedCandidates: evidenceBundle.productSeedPlan?.rejectedCandidates,
    placementPlan: evidenceBundle.productSeedPlan?.placementPlan,
    ctaPlan: evidenceBundle.productSeedPlan?.ctaPlan,
    riskFlags: evidenceBundle.productSeedPlan?.riskFlags,
    warnings: evidenceBundle.productSeedPlan?.warnings
  },
  placementPlan: {
    id: String(evidenceBundle.placementPlan?._id || ''),
    decision: evidenceBundle.placementPlan?.decision,
    placementStyle: evidenceBundle.placementPlan?.placementStyle,
    effectiveTopic: evidenceBundle.placementPlan?.effectiveTopic,
    rankingClaimReview: evidenceBundle.placementPlan?.rankingClaimReview,
    firstProductMention: evidenceBundle.placementPlan?.firstProductMention,
    placementSequence: evidenceBundle.placementPlan?.placementSequence,
    rankingStrategy: evidenceBundle.placementPlan?.rankingStrategy,
    commercialDensity: evidenceBundle.placementPlan?.commercialDensity,
    visualPlacement: evidenceBundle.placementPlan?.visualPlacement,
    disclosure: evidenceBundle.placementPlan?.disclosure,
    ctaStrategy: evidenceBundle.placementPlan?.ctaStrategy,
    warnings: evidenceBundle.placementPlan?.warnings
  },
  existingReviews: buildBlindAuditInput(evidenceBundle.existingGateResults),
  publishReadiness: evidenceBundle.readiness ? {
    id: String(evidenceBundle.readiness._id || ''),
    pass: evidenceBundle.readiness.pass,
    riskLevel: evidenceBundle.readiness.riskLevel,
    technical: evidenceBundle.readiness.technical,
    seo: evidenceBundle.readiness.seo,
    content: evidenceBundle.readiness.content,
    images: evidenceBundle.readiness.images,
    links: evidenceBundle.readiness.links,
    structuredData: evidenceBundle.readiness.structuredData,
    product: evidenceBundle.readiness.product,
    security: evidenceBundle.readiness.security,
    requiredFixes: compactIssues(evidenceBundle.readiness.requiredFixes),
    publishRecommendation: evidenceBundle.readiness.publishRecommendation,
    autoPublishAllowed: evidenceBundle.readiness.autoPublishAllowed,
    contentHash: evidenceBundle.readiness.contentHash
  } : null
})

const normalizeTextArray = value => (Array.isArray(value) ? value : [])
  .map(item => String(item || '').trim())
  .filter(Boolean)
  .slice(0, 100)

const normalizeIssue = issue => {
  const normalized = issue && typeof issue === 'object' ? issue : { message: String(issue || '') }
  const severity = String(normalized.severity || 'medium').trim().toLowerCase()
  if (!['critical', 'high', 'medium', 'low'].includes(severity)) {
    throw new BadRequestError('Auditor issue severity must be critical, high, medium, or low')
  }
  return {
    code: String(normalized.code || 'unspecified_issue').trim().slice(0, 120),
    severity,
    message: String(normalized.message || normalized.description || '').trim().slice(0, 1000),
    evidence: normalizeTextArray(normalized.evidence)
  }
}

const validateCategory = ({ definition, value, productApplicable }) => {
  if (!value || typeof value !== 'object') throw new BadRequestError(`Missing rubric category: ${definition.key}`)
  const notApplicable = value.notApplicable === true
  if (definition.productOnly && !productApplicable && !notApplicable) {
    throw new BadRequestError(`${definition.key} must be marked not applicable when product mode is off`)
  }
  if (notApplicable && !(definition.productOnly && !productApplicable)) {
    throw new BadRequestError(`${definition.key} cannot be marked not applicable`)
  }
  const score = Number(value.score)
  if (!Number.isFinite(score) || score < 0 || score > definition.maximum) {
    throw new BadRequestError(`${definition.key}.score must be between 0 and ${definition.maximum}`)
  }
  if (Number(value.maximum) !== definition.maximum) throw new BadRequestError(`${definition.key}.maximum does not match the rubric contract`)
  if (notApplicable && score !== 0) throw new BadRequestError(`${definition.key}.score must be 0 when not applicable`)
  const evidence = normalizeTextArray(value.evidence)
  if (!evidence.length) throw new BadRequestError(`${definition.key}.evidence is required`)
  return {
    score: notApplicable ? 0 : score,
    maximum: definition.maximum,
    notApplicable,
    evidence,
    strengths: normalizeTextArray(value.strengths),
    issues: (Array.isArray(value.issues) ? value.issues : []).map(normalizeIssue),
    requiredFixes: normalizeTextArray(value.requiredFixes)
  }
}

const gateValuePassed = (value, { allowNotApplicable = false } = {}) => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : value
  if (normalized === true || normalized === 'pass' || normalized === 'passed' || normalized === 'approved') return true
  if (allowNotApplicable && normalized === 'not_applicable') return true
  if (!normalized || typeof normalized !== 'object') return false
  if (normalized.pass === true || normalized.passed === true) return true
  const status = String(normalized.status || '').trim().toLowerCase()
  if (['pass', 'passed', 'approved'].includes(status)) return true
  return allowNotApplicable && status === 'not_applicable'
}

const deterministicBooleanGate = (evidence, key, expected) => ({
  key,
  source: 'deterministic',
  pass: evidence?.[key] === expected,
  reasonCode: evidence?.[key] === expected ? 'verified' : `qa_${key}_failed`
})

const evaluateHardGates = ({ deterministicEvidence = {}, existingGateResults = {}, productApplicable }) => {
  const gates = [
    deterministicBooleanGate(deterministicEvidence, 'isDraft', true),
    deterministicBooleanGate(deterministicEvidence, 'isPublished', false),
    deterministicBooleanGate(deterministicEvidence, 'publiclyReachable', false),
    deterministicBooleanGate(deterministicEvidence, 'indexRequested', false),
    deterministicBooleanGate(deterministicEvidence, 'telegramSent', false),
    deterministicBooleanGate(deterministicEvidence, 'socialDistributed', false),
    deterministicBooleanGate(deterministicEvidence, 'topicUnique', true),
    deterministicBooleanGate(deterministicEvidence, 'topicPreserved', true),
    deterministicBooleanGate(deterministicEvidence, 'artifactChainValid', true),
    deterministicBooleanGate(deterministicEvidence, 'scheduleOwnershipValid', true),
    deterministicBooleanGate(deterministicEvidence, 'visualPlanValid', true),
    deterministicBooleanGate(deterministicEvidence, 'imageUnsafe', false),
    deterministicBooleanGate(deterministicEvidence, 'completedWithoutImageApproval', false),
    deterministicBooleanGate(deterministicEvidence, 'sanitizerStable', true),
    deterministicBooleanGate(deterministicEvidence, 'canonicalSafe', true),
    deterministicBooleanGate(deterministicEvidence, 'slugValid', true),
    deterministicBooleanGate(deterministicEvidence, 'structuredDataValid', true),
    {
      key: 'unsafeHtmlCount', source: 'deterministic',
      pass: Number(deterministicEvidence.unsafeHtmlCount) === 0,
      reasonCode: Number(deterministicEvidence.unsafeHtmlCount) === 0 ? 'verified' : 'qa_unsafe_html'
    },
    {
      key: 'duplicateExecutionCount', source: 'deterministic',
      pass: Number(deterministicEvidence.duplicateExecutionCount) === 0,
      reasonCode: Number(deterministicEvidence.duplicateExecutionCount) === 0 ? 'verified' : 'qa_duplicate_execution'
    },
    {
      key: 'promptInjectionSignalCount', source: 'deterministic',
      pass: Number(deterministicEvidence.promptInjectionSignalCount) === 0,
      reasonCode: Number(deterministicEvidence.promptInjectionSignalCount) === 0 ? 'verified' : 'qa_prompt_injection_signal'
    },
    {
      key: 'evidenceCoverageDenominator', source: 'deterministic',
      pass: Number.isInteger(deterministicEvidence.evidenceCoverageDenominator) && deterministicEvidence.evidenceCoverageDenominator > 0,
      reasonCode: Number.isInteger(deterministicEvidence.evidenceCoverageDenominator) && deterministicEvidence.evidenceCoverageDenominator > 0
        ? 'verified'
        : 'qa_material_claim_denominator_empty'
    },
    {
      key: 'evidenceCoverageRatio', source: 'deterministic',
      pass: typeof deterministicEvidence.evidenceCoverageRatio === 'number' && deterministicEvidence.evidenceCoverageRatio === 1,
      reasonCode: typeof deterministicEvidence.evidenceCoverageRatio === 'number' && deterministicEvidence.evidenceCoverageRatio === 1
        ? 'verified'
        : 'qa_evidence_coverage_incomplete'
    },
    {
      key: 'unsupportedClaimCount', source: 'deterministic',
      pass: Number.isInteger(deterministicEvidence.unsupportedClaimCount) && deterministicEvidence.unsupportedClaimCount === 0,
      reasonCode: Number.isInteger(deterministicEvidence.unsupportedClaimCount) && deterministicEvidence.unsupportedClaimCount === 0
        ? 'verified'
        : 'qa_unsupported_material_claims'
    },
    {
      key: 'mandatorySourcesSucceeded', source: 'deterministic',
      pass: deterministicEvidence.mandatorySourcesSucceeded === true,
      reasonCode: deterministicEvidence.mandatorySourcesSucceeded === true
        ? 'verified'
        : 'qa_mandatory_sources_failed'
    }
  ]
  for (const key of REQUIRED_EXISTING_GATES) {
    const pass = gateValuePassed(existingGateResults[key])
    gates.push({ key, source: 'existing_review', pass, reasonCode: pass ? 'existing_gate_passed' : `existing_${key}_failed` })
  }
  for (const key of ['productClaimReview', 'productPlacementReview']) {
    const pass = gateValuePassed(existingGateResults[key], { allowNotApplicable: !productApplicable })
    gates.push({
      key,
      source: 'existing_review',
      pass,
      reasonCode: pass ? (productApplicable ? 'existing_gate_passed' : 'product_not_applicable') : `existing_${key}_failed`
    })
  }
  return gates
}

const normalizeAuditorHardGates = (value, { productApplicable = true } = {}) => {
  if (!Array.isArray(value) || !value.length) throw new BadRequestError('auditor hardGates must be a non-empty array')
  const seen = new Set()
  const normalized = value.slice(0, 100).map((gate, index) => {
    if (!gate || typeof gate !== 'object') throw new BadRequestError(`auditor hardGates[${index}] must be an object`)
    const key = String(gate.key || '').trim()
    if (!key) throw new BadRequestError(`auditor hardGates[${index}].key is required`)
    if (seen.has(key)) throw new BadRequestError(`auditor hardGates contains duplicate key: ${key}`)
    seen.add(key)
    const rawStatus = String(gate.status || '').trim().toLowerCase()
    const status = rawStatus || (gate.pass === true ? 'pass' : gate.pass === false ? 'fail' : '')
    if (!['pass', 'fail', 'blocked', 'not_applicable'].includes(status)) {
      throw new BadRequestError(`auditor hardGates[${index}].status is invalid`)
    }
    const notApplicableAllowed = !productApplicable && key.startsWith('product.')
    if (status === 'not_applicable' && !notApplicableAllowed) {
      throw new BadRequestError(`auditor hardGates[${index}] cannot be not applicable`)
    }
    const evidence = normalizeTextArray(gate.evidence)
    if (!evidence.length) throw new BadRequestError(`auditor hardGates[${index}].evidence is required`)
    const pass = status === 'pass' || (status === 'not_applicable' && notApplicableAllowed)
    return {
      key: key.slice(0, 120),
      source: 'senior_auditor',
      status,
      pass,
      evidence,
      reasonCode: String(gate.reasonCode || (pass ? 'auditor_gate_passed' : `auditor_${key}_failed`)).trim().slice(0, 160),
      severity: String(gate.severity || (pass ? 'low' : 'high')).trim().toLowerCase()
    }
  })
  for (const gate of normalized) {
    if (!['critical', 'high', 'medium', 'low'].includes(gate.severity)) {
      throw new BadRequestError(`auditor hardGates severity is invalid for ${gate.key}`)
    }
  }
  const missingGroups = AUDITOR_GATE_GROUPS.filter(group => !normalized.some(gate => group.match(gate.key))).map(group => group.key)
  if (missingGroups.length) throw new BadRequestError(`auditor hardGates is missing required groups: ${missingGroups.join(', ')}`)
  return normalized
}

const normalizeAuditorContractGates = (auditorOutput, { productApplicable }) => {
  if (auditorOutput?.schemaVersion !== '1.0' || auditorOutput?.context !== 'draft_acceptance') {
    throw new BadRequestError('Senior auditor schemaVersion or context is invalid')
  }
  if (auditorOutput.auditorTotal !== null) throw new BadRequestError('Senior auditor must not provide or calculate a total score')
  if (!Array.isArray(auditorOutput.criticalHighIssues)) throw new BadRequestError('Senior auditor criticalHighIssues must be an array')
  const gates = normalizeAuditorHardGates(auditorOutput.hardGates, { productApplicable })
  const statusOf = value => String(value?.status || '').trim().toLowerCase()
  gates.push(
    {
      key: 'auditor.topic_uniqueness', source: 'senior_auditor',
      pass: statusOf(auditorOutput.topicUniqueness) === 'pass',
      reasonCode: statusOf(auditorOutput.topicUniqueness) === 'pass' ? 'auditor_gate_passed' : 'auditor_topic_uniqueness_failed'
    },
    {
      key: 'auditor.draft_state', source: 'senior_auditor',
      pass: statusOf(auditorOutput.draftState) === 'pass' && auditorOutput.draftState?.isDraft === true && auditorOutput.draftState?.isPublic === false,
      reasonCode: 'auditor_draft_state_failed'
    },
    {
      key: 'auditor.draft_acceptance_input', source: 'senior_auditor',
      pass: auditorOutput.draftAcceptanceInputs?.eligible === true && !(auditorOutput.draftAcceptanceInputs?.blockingReasons || []).length,
      reasonCode: 'auditor_draft_acceptance_input_failed'
    },
    {
      key: 'auditor.publish_acceptance_qa_forbidden', source: 'senior_auditor',
      pass: auditorOutput.publishAcceptanceInputs?.eligible === false && (auditorOutput.publishAcceptanceInputs?.blockingReasons || []).includes('qa_artifact_must_remain_draft'),
      reasonCode: 'auditor_publish_acceptance_boundary_failed'
    }
  )
  return gates
}

const aggregateIssueCounts = (categories, additionalIssues = []) => {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 }
  for (const category of Object.values(categories)) {
    for (const issue of category.issues || []) counts[issue.severity] += 1
  }
  for (const issue of additionalIssues) counts[issue.severity] += 1
  return counts
}

const evaluateSeniorAcceptance = ({
  auditorOutput,
  deterministicEvidence,
  existingGateResults,
  existingSeoScore,
  existingSeoThreshold = MINIMUM_EXISTING_SEO_SCORE,
  productMode = 'off',
  productUsed = null
}) => {
  const productApplicable = typeof productUsed === 'boolean' ? productUsed : productMode !== 'off'
  const categories = {}
  for (const definition of RUBRIC) {
    categories[definition.key] = validateCategory({
      definition,
      value: auditorOutput?.categories?.[definition.key],
      productApplicable
    })
  }
  const totalScore = Object.values(categories).reduce((total, category) => total + category.score, 0)
  if (totalScore > 100) throw new BadRequestError('Senior acceptance total cannot exceed 100')
  const seoScore = Number(existingSeoScore)
  if (!Number.isFinite(seoScore) || seoScore < 0 || seoScore > 100) {
    throw new BadRequestError('existingSeoScore must be between 0 and 100')
  }
  const threshold = Number(existingSeoThreshold)
  if (!Number.isFinite(threshold) || threshold < MINIMUM_EXISTING_SEO_SCORE || threshold > 100) {
    throw new BadRequestError(`existingSeoThreshold must be between ${MINIMUM_EXISTING_SEO_SCORE} and 100`)
  }

  const deterministicGates = evaluateHardGates({ deterministicEvidence, existingGateResults, productApplicable })
  const auditorHardGates = normalizeAuditorContractGates(auditorOutput, { productApplicable })
  const auditorHardGateContractPresent = true
  const criticalHighIssues = (Array.isArray(auditorOutput?.criticalHighIssues) ? auditorOutput.criticalHighIssues : [])
    .map(normalizeIssue)
  const independence = {
    blindReviewConfirmed: auditorOutput?.independence?.blindReviewConfirmed === true,
    forbiddenInputsDetected: normalizeTextArray(auditorOutput?.independence?.forbiddenInputsDetected)
  }
  const allHardGates = [...deterministicGates, ...auditorHardGates]
  const hardGatePassed = auditorHardGateContractPresent && allHardGates.every(gate => gate.pass)
  const issueCounts = aggregateIssueCounts(categories, criticalHighIssues)
  const floorFailures = RUBRIC.filter(definition => {
    if (definition.productOnly && !productApplicable) return false
    return definition.floor > 0 && categories[definition.key].score < definition.floor
  }).map(definition => `floor_${definition.key}`)
  const reasonCodes = []
  if (totalScore < SENIOR_ACCEPTANCE_SCORE) reasonCodes.push('senior_score_below_81')
  if (seoScore < threshold) reasonCodes.push('existing_seo_score_below_threshold')
  if (!auditorHardGateContractPresent) reasonCodes.push('auditor_hard_gates_missing')
  reasonCodes.push(...allHardGates.filter(gate => !gate.pass).map(gate => gate.reasonCode))
  if (!independence.blindReviewConfirmed) reasonCodes.push('senior_auditor_not_independent')
  if (independence.forbiddenInputsDetected.length) reasonCodes.push('senior_auditor_forbidden_inputs_detected')
  if (issueCounts.critical > 0) reasonCodes.push('critical_issue_remaining')
  if (issueCounts.high > 0) reasonCodes.push('high_issue_remaining')
  reasonCodes.push(...floorFailures)
  const uniqueReasons = Array.from(new Set(reasonCodes.filter(Boolean)))
  const draftPass = uniqueReasons.length === 0
  const requiredFixes = Array.from(new Set([
    ...Object.values(categories).flatMap(category => category.requiredFixes),
    ...criticalHighIssues.map(issue => issue.code),
    ...uniqueReasons
  ]))
  const publishOnlyGates = PUBLISH_ONLY_EXISTING_GATES.map(key => ({
    key,
    source: 'publish_only',
    pass: gateValuePassed(existingGateResults[key]),
    reasonCode: gateValuePassed(existingGateResults[key]) ? 'existing_gate_passed' : `existing_${key}_failed`
  }))

  return {
    rubricVersion: RUBRIC_VERSION,
    categories,
    totalScore,
    existingSeoScore: seoScore,
    existingSeoThreshold: threshold,
    deterministicEvidence,
    existingGateResults,
    hardGates: allHardGates,
    auditorHardGates,
    publishOnlyGates,
    hardGatePassed,
    independence,
    criticalHighIssues,
    issueCounts,
    requiredFixes,
    draftAcceptance: { pass: draftPass, reasonCodes: uniqueReasons },
    publishAcceptance: { pass: false, reasonCodes: ['qa_publish_forbidden'] },
    verdict: draftPass ? 'passed' : 'failed'
  }
}

const validateAuditorBinding = ({ auditorOutput, blindInputHash, artifactRefs }) => {
  if (
    auditorOutput?.agentId !== SENIOR_AUDITOR_AGENT_ID ||
    auditorOutput?.blindInputHash !== blindInputHash ||
    auditorOutput?.rubricVersion !== RUBRIC_VERSION ||
    stableHash(auditorOutput?.artifactRefs || {}) !== stableHash(artifactRefs)
  ) {
    throw new BadRequestError('Senior auditor response identity or blind-input binding is invalid')
  }
}

class SeniorBlogAcceptanceService {
  constructor({
    ReportModel = SeniorBlogAcceptanceReport,
    EvidenceService = new AgenticBlogQaEvidenceService(),
    AuditorAdapter = new OpenClawSeniorBlogAuditorAdapter(),
    now = () => new Date()
  } = {}) {
    this.ReportModel = ReportModel
    this.EvidenceService = EvidenceService
    this.AuditorAdapter = AuditorAdapter
    this.now = now
  }

  async _findExisting(caseId, iteration) {
    let query = this.ReportModel.findOne({ caseId, iteration })
    if (query?.lean) query = query.lean()
    return query
  }

  async reviewPersistedCase({ qaCaseId, blogId, executionId, iteration = 0, createdBy = null }) {
    if (!Number.isInteger(iteration) || iteration < 0 || iteration > 3) {
      throw new BadRequestError('iteration must be between 0 and 3')
    }
    const evidenceBundle = await this.EvidenceService.build({ qaCase: qaCaseId, blog: blogId, executionId })
    const { persistedCase, persistedBlog, deterministicEvidence } = evidenceBundle
    if (persistedCase?.isQaTest !== true || persistedBlog?.isQaTest !== true) {
      throw new BadRequestError('Senior acceptance can only review trusted QA artifacts')
    }
    const caseId = assertObjectId(persistedCase._id || persistedCase.qaCaseId, 'qaCaseId')
    const blindInput = buildPersistedBlindInput({ qaCase: persistedCase, blog: persistedBlog, deterministicEvidence, executionId, evidenceBundle })
    const forbiddenPaths = findForbiddenBlindPaths(blindInput)
    if (forbiddenPaths.length) throw new BadRequestError(`Blind auditor input contains forbidden fields: ${forbiddenPaths.join(', ')}`)
    const blindInputHash = stableHash(blindInput)
    const artifactRefs = blindInput.artifactRefs
    const revisionHash = evidenceBundle.contentRevisionHash
    const reviewKeyHash = sha256(`senior-server-review-v2\0${caseId}\0${iteration}\0${revisionHash}\0${blindInputHash}`)
    const existing = await this._findExisting(caseId, iteration)
    if (existing) {
      if (existing.reviewKeyHash === reviewKeyHash && existing.contentRevisionHash === revisionHash && existing.blindInputHash === blindInputHash) {
        return { report: existing, duplicate: true, idempotent: true }
      }
      throw new ConflictRequestError('A Senior Acceptance report already exists for this case iteration')
    }

    const auditorOutput = await this.AuditorAdapter.evaluate({
      blindInput,
      blindInputHash,
      artifactRefs,
      rubric: RUBRIC.map(item => ({ ...item })),
      rubricVersion: RUBRIC_VERSION
    })
    validateAuditorBinding({ auditorOutput, blindInputHash, artifactRefs })
    const evaluation = evaluateSeniorAcceptance({
      auditorOutput,
      deterministicEvidence,
      existingGateResults: evidenceBundle.existingGateResults,
      existingSeoScore: evidenceBundle.existingSeoScore,
      existingSeoThreshold: evidenceBundle.existingSeoThreshold,
      productMode: persistedCase.productMode,
      productUsed: Boolean(
        evidenceBundle.productSeedPlan?.primaryProduct ||
        (evidenceBundle.productSeedPlan?.supportingProducts || []).length ||
        evidenceBundle.productSeedPlan?.decision === 'product_led' ||
        evidenceBundle.productSeedPlan?.decision === 'contextual_seed'
      )
    })

    const recheck = await this.EvidenceService.build({ qaCase: qaCaseId, blog: blogId, executionId })
    const recheckBlindInput = buildPersistedBlindInput({
      qaCase: recheck.persistedCase,
      blog: recheck.persistedBlog,
      deterministicEvidence: recheck.deterministicEvidence,
      executionId,
      evidenceBundle: recheck
    })
    if (recheck.contentRevisionHash !== revisionHash || stableHash(recheckBlindInput) !== blindInputHash) {
      throw new ConflictRequestError('QA article or evidence changed during the independent review')
    }
    return this._persistVerifiedReport({
      evidenceBundle,
      executionId,
      iteration,
      reviewKeyHash,
      blindInputHash,
      evaluation,
      createdBy
    })
  }

  async _persistVerifiedReport({ evidenceBundle, executionId, iteration, reviewKeyHash, blindInputHash, evaluation, createdBy }) {
    const { persistedCase: qaCase, persistedBlog: blog } = evidenceBundle
    const caseId = assertObjectId(qaCase._id || qaCase.qaCaseId, 'qaCaseId')
    const batchId = assertObjectId(qaCase.qaBatchId || qaCase.batchId, 'qaBatchId')
    const blogId = assertObjectId(blog._id || blog.id, 'blogId')
    const normalizedExecutionId = assertObjectId(executionId || blog.agenticExecutionId, 'executionId')
    let previousQuery = this.ReportModel.findOne({ caseId, iteration: { $lt: iteration } })
    if (previousQuery?.sort) previousQuery = previousQuery.sort({ iteration: -1, version: -1 })
    if (previousQuery?.lean) previousQuery = previousQuery.lean()
    const previous = await previousQuery
    const document = {
      _id: deterministicObjectId(`senior-report-v1\0${caseId}\0${iteration}`),
      isQaTest: true,
      batchId,
      caseId,
      qaBatchId: batchId,
      qaCaseId: caseId,
      environment: qaCase.environment,
      executionMode: qaCase.executionMode,
      originalTopicSeed: qaCase.originalTopicSeed,
      normalizedTopicKey: qaCase.normalizedTopicKey,
      blogId,
      executionId: normalizedExecutionId,
      iteration,
      version: Number(previous?.version || 0) + 1,
      previousReportId: previous?._id || null,
      reviewKeyHash,
      contentRevisionHash: evidenceBundle.contentRevisionHash,
      blindInputHash,
      blindReview: evaluation.independence.blindReviewConfirmed === true && evaluation.independence.forbiddenInputsDetected.length === 0,
      acceptanceThreshold: SENIOR_ACCEPTANCE_SCORE,
      ...evaluation,
      auditorAgentId: SENIOR_AUDITOR_AGENT_ID,
      evaluatedAt: this.now(),
      createdBy: createdBy ? assertObjectId(createdBy, 'createdBy') : null
    }
    try {
      const created = await this.ReportModel.create(document)
      return { report: created?.toObject ? created.toObject() : created, duplicate: false }
    } catch (error) {
      if (error?.code !== 11000) throw error
      const duplicate = await this._findExisting(caseId, iteration)
      if (
        duplicate?.reviewKeyHash === reviewKeyHash &&
        duplicate?.contentRevisionHash === evidenceBundle.contentRevisionHash &&
        duplicate?.blindInputHash === blindInputHash
      ) return { report: duplicate, duplicate: true, idempotent: true }
      throw new ConflictRequestError('Senior Acceptance report iteration conflict')
    }
  }
}

module.exports = {
  FORBIDDEN_BLIND_KEYS,
  PUBLISH_ONLY_EXISTING_GATES,
  AUDITOR_GATE_GROUPS,
  REQUIRED_EXISTING_GATES,
  RUBRIC,
  RUBRIC_VERSION,
  SENIOR_AUDITOR_AGENT_ID,
  SeniorBlogAcceptanceService,
  aggregateIssueCounts,
  buildBlindAuditInput,
  buildPersistedBlindInput,
  evaluateHardGates,
  evaluateSeniorAcceptance,
  findForbiddenBlindPaths,
  gateValuePassed,
  normalizeAuditorHardGates,
  normalizeAuditorContractGates,
  stableHash,
  validateAuditorBinding
}
