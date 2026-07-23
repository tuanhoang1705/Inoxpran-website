'use strict'

const crypto = require('node:crypto')
const { blog: BlogPost } = require('../models/blog.model')
const { BlogAutomationExecution } = require('../models/blogAutomationExecution.model')
const { BlogAutomationSchedule } = require('../models/blogAutomationSchedule.model')
const { QaTopicReservation } = require('../models/qaTopicReservation.model')
const { ContentPublishReadinessReport } = require('../models/contentPublishReadinessReport.model')
const { AgenticBlogQaCase } = require('../models/agenticBlogQaCase.model')
const { AgenticBlogQaBatch } = require('../models/agenticBlogQaBatch.model')
const { ContentWorkOrder } = require('../models/contentWorkOrder.model')
const { UnifiedContentBrief } = require('../models/unifiedContentBrief.model')
const { ResearchBundle } = require('../models/researchBundle.model')
const { EvidenceMap } = require('../models/evidenceMap.model')
const { EditorialStyleProfile } = require('../models/editorialStyleProfile.model')
const { BlogStrategyPlan } = require('../models/blogStrategyPlan.model')
const { ProductSeedPlan } = require('../models/productSeedPlan.model')
const { EditorialProductPlacementPlan } = require('../models/editorialProductPlacementPlan.model')
const { GoogleIntelligenceSnapshot } = require('../models/googleIntelligenceSnapshot.model')
const { GoogleIntelligenceRun } = require('../models/googleIntelligenceRun.model')
const { ContentOperationsDailySnapshot } = require('../models/contentOperationsDailySnapshot.model')
const { ContentOperationsRun } = require('../models/contentOperationsRun.model')
const { ContentInventorySnapshot } = require('../models/contentInventorySnapshot.model')
const { ContentInventoryItem } = require('../models/contentInventoryItem.model')
const { ContentOpportunityDecision } = require('../models/contentOpportunityDecision.model')
const { ProductCatalogSnapshot } = require('../models/productCatalogSnapshot.model')
const { BadRequestError, NotFoundError } = require('../core/error.response')
const { normalizeTopicKey, setSimilarity, semanticTokens } = require('./qaTopicUniqueness.service')
const { buildQaRunSlotKeyHash } = require('../config/agenticBlogQa.config')
const { normalizeSlug, sanitizeSeoBlogHtml } = require('../utils/seoBlogSanitizer')

const contentRevisionHash = blog => String(blog?.contentRevisionHash || crypto.createHash('sha256').update(JSON.stringify({
  title: blog?.blog_title || '',
  excerpt: blog?.blog_excerpt || '',
  content: blog?.blog_content || '',
  visualPlan: blog?.visualPlan || null,
  coverImage: blog?.coverImage || null,
  contentImages: blog?.contentImages || []
})).digest('hex'))

const htmlText = html => String(html || '')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;|&#160;/gi, ' ')
  .replace(/&[a-z]+;|&#\d+;/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const matchCount = (value, pattern) => (String(value || '').match(pattern) || []).length

const repeatedPhraseMetrics = (value, size = 6) => {
  const tokens = normalizeTopicKey(value).split(/\s+/).filter(token => token.length > 1)
  const counts = new Map()
  for (let index = 0; index <= tokens.length - size; index += 1) {
    const phrase = tokens.slice(index, index + size).join(' ')
    counts.set(phrase, (counts.get(phrase) || 0) + 1)
  }
  const repeatedPhrases = Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 20)
    .map(([phrase, count]) => ({ phrase, count }))
  return { repeatedPhraseCount: repeatedPhrases.length, repeatedPhrases }
}

const orderedSubsequence = (actual, required) => {
  let cursor = 0
  for (const item of Array.isArray(actual) ? actual : []) {
    if (item === required[cursor]) cursor += 1
    if (cursor === required.length) return true
  }
  return required.length === 0
}

const REQUIRED_V3_TRACE = Object.freeze([
  'google-intelligence-gate',
  'daily-content-snapshot',
  'content-inventory',
  'opportunity-decision',
  'content-work-order',
  'unified-content-brief',
  'product-seed-plan',
  'editorial-product-placement-plan',
  'industry-content-research',
  'evidence-map',
  'editorial-style-planning',
  'content-strategy-plan',
  'content-architecture',
  'draft-generation',
  'fact-review',
  'originality-review',
  'seo-aeo-geo-review',
  'people-first-spam-review',
  'brand-voice-review',
  'publisher-gate'
])

const extractLinks = html => Array.from(String(html || '').matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']*)["'][^>]*>/gi))
  .map(match => String(match[1] || '').trim())

const extractHeadings = html => Array.from(String(html || '').matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi))
  .map(match => ({ level: Number(match[1]), text: htmlText(match[2]) }))

const hierarchyValid = headings => {
  let previous = 1
  for (const heading of headings) {
    if (heading.level > previous + 1) return false
    previous = heading.level
  }
  return true
}

const countUnsafeHtml = html => [
  /<script\b/i,
  /<iframe\b/i,
  /<(?:object|embed)\b/i,
  /<svg\b/i,
  /<meta\b[^>]*\bhttp-equiv\s*=\s*["']?refresh\b/i,
  /\son[a-z]+\s*=/i,
  /(?:javascript|vbscript|data)\s*:/i,
  /(?:href|src|action|formaction)\s*=\s*["']?\/\//i,
  /(?:https?:\/\/|\/\/)(?:[^\s/@]+@)?(?:127\.\d+\.\d+\.\d+|0\.0\.0\.0|localhost|10\.\d+\.\d+\.\d+|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+|169\.254\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|\[(?:::1|f[cd][0-9a-f:]*|fe[89ab][0-9a-f:]*)\]|[^\s/:]+\.(?:internal|local))(?:[:/\s]|$)/i,
  /(?:access[_-]?token|api[_-]?key|client[_-]?secret|password|passwd|authorization)\s*(?:=|:|%3[dD])\s*[^\s&"'<>]{4,}/i
].reduce((total, pattern) => total + (pattern.test(String(html || '')) ? 1 : 0), 0)

const countPromptInjectionSignals = value => [
  /(?:^|[\s<])(?:system|developer|assistant|tool)\s*(?:message|prompt|instruction|role)\s*:/i,
  /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions?|rules?|rubric)/i,
  /(?:override|bypass|disable|forget)\s+(?:the\s+)?(?:rubric|auditor|review|hard\s*gates?|safety)/i,
  /(?:give|assign|return|set)\s+(?:this\s+)?(?:article\s+)?(?:a\s+)?(?:score|rating)\s*(?:of|=|:)\s*(?:100|\d{2,3})/i,
  /(?:blindInputHash|rubricVersion|artifactRefs)\s*(?:must\s+be|=|:)\s*["']?[a-z0-9]/i
].reduce((total, pattern) => total + (pattern.test(String(value || '')) ? 1 : 0), 0)

const isSafeCanonical = value => {
  const raw = String(value || '').trim()
  if (!raw || /[\u0000-\u001f\u007f]/.test(raw) || /^\/\//.test(raw)) return false
  try {
    const url = new URL(raw)
    const hostname = String(url.hostname || '').replace(/^\[|\]$/g, '').toLowerCase()
    const privateHost =
      !hostname ||
      /(?:^|\.)(?:localhost|local|internal)$/.test(hostname) ||
      /^(?:0\.0\.0\.0|127\.|10\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(hostname) ||
      /^(?:::1|f[cd][0-9a-f:]*|fe[89ab][0-9a-f:]*)$/i.test(hostname)
    const secretQuery = Array.from(url.searchParams.keys()).some(key =>
      /^(?:access[_-]?token|api[_-]?key|client[_-]?secret|password|passwd|authorization)$/i.test(key)
    )
    return url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !privateHost &&
      !secretQuery &&
      (!url.port || url.port === '443')
  } catch {
    return false
  }
}

const isSafeCanonicalForBlog = value => {
  if (value?.isQaTest === true) {
    return String(value.canonicalUrl || '').trim() === '' &&
      value.indexability?.index === false &&
      value.indexability?.follow === false &&
      value.indexability?.determinable === true
  }
  return isSafeCanonical(value?.canonicalUrl)
}

const toPassedGate = value => {
  if (value === true) return { pass: true }
  if (!value || typeof value !== 'object') return { pass: false, status: 'missing' }
  if (typeof value.pass === 'boolean') return value
  if (typeof value.passed === 'boolean') return { ...value, pass: value.passed }
  return { ...value, pass: ['pass', 'passed', 'approved'].includes(value.status) }
}

// Product-off cases still retain the product planning and placement decisions so
// the ordered V3 trace can be audited, but they intentionally have no catalog
// snapshot. Every other mode fails closed when that catalog lineage is absent.
const isProductCatalogRequired = productMode => String(productMode || '').trim().toLowerCase() !== 'off'

const classifyUpstreamQaProvenance = ({ artifact, expected = {} } = {}) => {
  if (!artifact || typeof artifact !== 'object') {
    return { valid: false, provenanceClass: 'invalid_missing', reason: 'artifact_missing' }
  }
  const present = value => value !== undefined && value !== null && String(value).trim() !== ''
  const qaIdentifiersPresent = [
    artifact.qaBatchId,
    artifact.qaCaseId,
    artifact.environment,
    artifact.executionMode,
    artifact.originalTopicSeed,
    artifact.normalizedTopicKey
  ].some(present)
  if (artifact.isQaTest === true) {
    const checks = [
      ['qa_batch_id', String(artifact.qaBatchId || '') === String(expected.qaBatchId || '')],
      ['qa_case_id', String(artifact.qaCaseId || '') === String(expected.qaCaseId || '')],
      ['environment', String(artifact.environment || '') === String(expected.environment || '')],
      ['execution_mode', String(artifact.executionMode || '') === String(expected.executionMode || '')],
      ['original_topic_seed', String(artifact.originalTopicSeed || '').trim() === String(expected.originalTopicSeed || '').trim()],
      ['normalized_topic_key', String(artifact.normalizedTopicKey || '') === String(expected.normalizedTopicKey || '')]
    ]
    const mismatch = checks.find(([, pass]) => !pass)
    return mismatch
      ? { valid: false, provenanceClass: 'invalid_qa_mismatch', reason: mismatch[0] }
      : { valid: true, provenanceClass: 'qa_exact', reason: '' }
  }
  if (qaIdentifiersPresent) {
    return { valid: false, provenanceClass: 'invalid_partial_non_qa', reason: 'qa_identifier_without_qa_flag' }
  }
  return { valid: true, provenanceClass: 'production_reused', reason: '' }
}

const GOOGLE_RUN_TERMINAL_STATUSES = new Set([
  'completed_with_changes',
  'completed_no_change',
  'partial'
])
const CONTENT_OPERATIONS_RUN_TERMINAL_STATUSES = new Set([
  'completed',
  'partial',
  'skipped',
  'blocked',
  'failed'
])

const buildGoogleRunLineage = ({ snapshot, run, expected = {} } = {}) => {
  const qaCreated = snapshot?.isQaTest === true
  const runId = String(snapshot?.runId || '')
  if (!runId) {
    return qaCreated
      ? {
          requiredArtifactMissing: true,
          valid: false,
          linkedChecks: [['google_qa_snapshot_run_id', false]],
          summary: null
        }
      : {
          requiredArtifactMissing: false,
          valid: true,
          linkedChecks: [],
          summary: { id: '', status: 'not_applicable', provenanceClass: 'not_applicable' }
        }
  }
  if (!run) {
    return {
      requiredArtifactMissing: true,
      valid: false,
      linkedChecks: [['google_snapshot_run_found', false]],
      summary: null
    }
  }
  const provenance = classifyUpstreamQaProvenance({ artifact: run, expected })
  const requiredProvenanceClass = qaCreated ? 'qa_exact' : 'production_reused'
  const linkedChecks = [
    ['google_snapshot_run_id', runId === String(run._id || '')],
    ['google_run_snapshot_id', String(run.snapshotId || '') === String(snapshot?._id || '')],
    ['google_run_terminal', GOOGLE_RUN_TERMINAL_STATUSES.has(String(run.status || ''))],
    ['google_run_provenance', provenance.valid && provenance.provenanceClass === requiredProvenanceClass]
  ]
  return {
    requiredArtifactMissing: false,
    valid: linkedChecks.every(([, pass]) => pass),
    linkedChecks,
    summary: {
      id: String(run._id || ''),
      status: String(run.status || ''),
      provenanceClass: provenance.provenanceClass
    }
  }
}

const buildInventoryItemLineage = ({ snapshot, items = [], retainedItemCount, expected = {} } = {}) => {
  const qaCreated = snapshot?.isQaTest === true
  const expectedProvenanceClass = qaCreated ? 'qa_exact' : 'production_reused'
  const safeItems = Array.isArray(items) ? items : []
  const countedItems = Number(retainedItemCount)
  const declaredItems = Number(snapshot?.itemCount)
  const linkedChecks = [
    ['inventory_item_query_count', Number.isInteger(countedItems) && countedItems >= 0 && countedItems === safeItems.length]
  ]
  if (qaCreated) {
    linkedChecks.push([
      'inventory_item_declared_count',
      Number.isInteger(declaredItems) && declaredItems >= 0 && declaredItems === countedItems
    ])
  }
  for (const item of safeItems) {
    const provenance = classifyUpstreamQaProvenance({ artifact: item, expected })
    const itemId = String(item?._id || 'missing')
    linkedChecks.push([
      `inventory_item_snapshot:${itemId}`,
      String(item?.snapshotId || '') === String(snapshot?._id || '')
    ])
    linkedChecks.push([
      `inventory_item_provenance:${itemId}`,
      provenance.valid && provenance.provenanceClass === expectedProvenanceClass
    ])
  }
  return {
    valid: linkedChecks.every(([, pass]) => pass),
    linkedChecks,
    summary: {
      declaredItemCount: Number.isInteger(declaredItems) && declaredItems >= 0 ? declaredItems : 0,
      retainedItemCount: Number.isInteger(countedItems) && countedItems >= 0 ? countedItems : 0,
      provenanceClass: expectedProvenanceClass
    }
  }
}

const contentOperationsRunIdFromArtifacts = ({ opportunityDecision, workOrder, brief } = {}) => {
  const values = [
    opportunityDecision?.planningRunId,
    workOrder?.metadata?.planningRunId,
    brief?.planningRunId
  ].map(value => String(value || '')).filter(Boolean)
  return values[0] || ''
}

const buildContentOperationsRunLineage = ({
  run,
  opportunityDecision,
  workOrder,
  brief,
  googleSnapshot,
  contentOperationsSnapshot,
  inventorySnapshot,
  expected = {}
} = {}) => {
  const artifactRunIds = [
    ['opportunity_planning_run', String(opportunityDecision?.planningRunId || '')],
    ['work_order_planning_run', String(workOrder?.metadata?.planningRunId || '')],
    ['brief_planning_run', String(brief?.planningRunId || '')]
  ]
  if (artifactRunIds.every(([, id]) => !id)) {
    return {
      requiredArtifactMissing: false,
      valid: true,
      linkedChecks: [],
      summary: { id: '', status: 'not_applicable', provenanceClass: 'not_applicable' }
    }
  }
  if (!run) {
    return {
      requiredArtifactMissing: true,
      valid: false,
      linkedChecks: [['content_operations_run_found', false]],
      summary: null
    }
  }
  const runId = String(run._id || '')
  const provenance = classifyUpstreamQaProvenance({ artifact: run, expected })
  const linkedChecks = [
    ...artifactRunIds.map(([label, id]) => [label, Boolean(id) && id === runId]),
    ['content_operations_run_terminal', CONTENT_OPERATIONS_RUN_TERMINAL_STATUSES.has(String(run.status || ''))],
    ['content_operations_run_provenance', provenance.valid && provenance.provenanceClass === 'qa_exact'],
    ['content_operations_run_google_snapshot', String(run.googleIntelSnapshotId || '') === String(googleSnapshot?._id || '')],
    ['content_operations_run_daily_snapshot', String(run.contentOperationsSnapshotId || '') === String(contentOperationsSnapshot?._id || '')],
    ['content_operations_run_inventory_snapshot', String(run.contentInventorySnapshotId || '') === String(inventorySnapshot?._id || '')],
    ['content_operations_run_opportunity', String(run.contentOpportunityDecisionId || '') === String(opportunityDecision?._id || '')],
    ['content_operations_run_work_order', String(run.contentWorkOrderId || '') === String(workOrder?._id || '')],
    ['content_operations_run_brief', String(run.unifiedContentBriefId || '') === String(brief?._id || '')]
  ]
  return {
    requiredArtifactMissing: false,
    valid: linkedChecks.every(([, pass]) => pass),
    linkedChecks,
    summary: {
      id: runId,
      status: String(run.status || ''),
      provenanceClass: provenance.provenanceClass
    }
  }
}

const buildRetainedExecutionIterationFilter = ({ executionIteration, batchIteration }) => {
  const normalizedExecutionIteration = Number(executionIteration || 0)
  const normalizedBatchIteration = Number(batchIteration || 0)
  const retainedIterations = Array.from(new Set([normalizedExecutionIteration, normalizedBatchIteration]))
  return retainedIterations.length === 1
    ? normalizedExecutionIteration
    : { $in: retainedIterations }
}

const buildProductCatalogLineage = ({ productMode, execution, productSeedPlan, placementPlan, productCatalogSnapshot }) => {
  const required = isProductCatalogRequired(productMode)
  if (!required) {
    return {
      required: false,
      requiredArtifactMissing: false,
      valid: true,
      linkedChecks: [],
      summary: { id: '', status: 'not_applicable', productCount: 0, eligibleProductCount: 0, catalogHash: '', provenanceClass: 'not_applicable' }
    }
  }
  if (!productCatalogSnapshot) {
    return { required: true, requiredArtifactMissing: true, valid: false, linkedChecks: [], summary: null }
  }
  const linkedChecks = [
    ['execution_product_catalog_snapshot', String(execution?.productCatalogSnapshotId || '') === String(productCatalogSnapshot._id || '')],
    ['product_plan_catalog_snapshot', String(productSeedPlan?.productCatalogSnapshotId || '') === String(productCatalogSnapshot._id || '')],
    ['placement_catalog_snapshot', String(placementPlan?.productCatalogSnapshotId || '') === String(productCatalogSnapshot._id || '')],
    ['product_catalog_snapshot_usable', ['complete', 'partial'].includes(productCatalogSnapshot.status)]
  ]
  return {
    required: true,
    requiredArtifactMissing: false,
    valid: linkedChecks.every(([, pass]) => pass),
    linkedChecks,
    summary: {
      id: String(productCatalogSnapshot._id),
      status: productCatalogSnapshot.status,
      productCount: Number(productCatalogSnapshot.productCount || 0),
      eligibleProductCount: Number(productCatalogSnapshot.eligibleProductCount || 0),
      catalogHash: String(productCatalogSnapshot.catalogHash || '')
    }
  }
}

const buildHtmlMetrics = ({ blog, qaCase, productSeedPlan, placementPlan, evidenceMap, readiness, agenticReviews = {} }) => {
  const html = String(blog.blog_content || '')
  const text = htmlText(html)
  const headings = extractHeadings(html)
  const links = extractLinks(html)
  const internalLinks = links.filter(link => /^\/(?!\/)/.test(link) || /(?:^|\.)inoxpran\.com(?:\/|$)/i.test(link))
  const productLinks = links.filter(link => /\/(?:san-pham|products?)\//i.test(link))
  const brokenLinks = links.filter(link => !link || link === '#' || /^javascript:/i.test(link))
  const selectedProducts = [productSeedPlan?.primaryProduct, ...(productSeedPlan?.supportingProducts || [])]
    .filter(product => product?.productId && String(product?.name || '').trim())
  const productTerms = selectedProducts.map(product => String(product.name).trim())
  const lowerText = normalizeTopicKey(text)
  const normalizedProductTerms = productTerms.map(normalizeTopicKey).filter(Boolean)
  const productMentions = normalizedProductTerms.reduce((count, term) => count + Math.max(0, lowerText.split(term).length - 1), 0)
  const firstProductMention = normalizedProductTerms.reduce((first, term) => {
    const index = lowerText.indexOf(term)
    return index < 0 ? first : (first < 0 ? index : Math.min(first, index))
  }, -1)
  const selectedProductLinks = productLinks.filter(link => selectedProducts.some(product => {
    const slug = String(product.slug || '').trim().toLowerCase()
    const canonicalUrl = String(product.canonicalUrl || '').trim().toLowerCase()
    const normalizedLink = String(link || '').trim().toLowerCase()
    return (canonicalUrl && normalizedLink === canonicalUrl) ||
      (slug && new RegExp(`/(?:san-pham|products?)/${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[/?#]|$)`, 'i').test(normalizedLink))
  }))
  const evidenceEntries = Array.isArray(evidenceMap?.entries) ? evidenceMap.entries : []
  const materialEvidenceEntries = evidenceEntries.filter(entry => String(entry?.claim || '').trim())
  const usableEvidenceEntries = materialEvidenceEntries.filter(entry =>
    entry?.status === 'usable' &&
    ['verified', 'inferred'].includes(entry?.classification) &&
    Boolean(String(entry?.sourceUrl || entry?.internalReferenceId || '').trim()) &&
    Boolean(String(entry?.allowedUsage || '').trim())
  )
  const persistedCoverage = {
    pass: materialEvidenceEntries.length > 0 && usableEvidenceEntries.length === materialEvidenceEntries.length,
    declaredCount: materialEvidenceEntries.length,
    detectedCount: materialEvidenceEntries.length,
    mappedCount: usableEvidenceEntries.length,
    issues: materialEvidenceEntries
      .filter(entry => !usableEvidenceEntries.includes(entry))
      .map(entry => `evidence_not_usable:${String(entry?.evidenceKey || 'unknown')}`)
  }
  const evidenceCoverage = readiness?.content?.evidenceCoverage || persistedCoverage
  const evidenceDenominator = materialEvidenceEntries.length
  const evidenceNumerator = usableEvidenceEntries.length
  const evidenceCoverageRatio = evidenceDenominator > 0
    ? evidenceNumerator / evidenceDenominator
    : 0
  const factualUnsupported = agenticReviews?.factuality?.unsupportedClaims || []
  const productUnsupported = blog.productClaimReview?.rejectedClaims || agenticReviews?.productClaims?.rejectedClaims || []
  const unsupportedEvidenceEntries = Math.max(0, evidenceDenominator - evidenceNumerator)
  const unsupportedClaimCount = factualUnsupported.length + productUnsupported.length + unsupportedEvidenceEntries
  const originalitySimilarity = agenticReviews?.originality?.maximumSimilarity || {}
  const finalPlacementReview = blog.editorialProductPlacementReview || agenticReviews?.editorialProductPlacement || {}
  const actualRankingPositions = Array.from(new Set(
    (finalPlacementReview.placementSummary || []).map(item => String(item.rankPosition || '')).filter(Boolean)
  ))
  const repeated = repeatedPhraseMetrics(text)
  return {
    wordCount: text ? text.split(/\s+/).filter(Boolean).length : 0,
    headings,
    headingCount: headings.length,
    paragraphCount: matchCount(html, /<p\b/gi),
    headingHierarchyValid: hierarchyValid(headings),
    titleLength: String(blog.blog_seo_title || blog.blog_title || '').length,
    metaLength: String(blog.blog_seo_description || blog.blog_excerpt || '').length,
    internalLinkCount: internalLinks.length,
    productLinkCount: productLinks.length,
    selectedProductLinkCount: selectedProductLinks.length,
    unplannedProductLinkCount: Math.max(0, productLinks.length - selectedProductLinks.length),
    selectedProductCount: selectedProducts.length,
    brokenLinkCount: brokenLinks.length,
    productMentionCount: productMentions,
    productBlockCount: matchCount(html, /class=["'][^"']*(?:product|san-pham)[^"']*["']/gi),
    ctaCount: matchCount(html, /class=["'][^"']*(?:cta|call-to-action)[^"']*["']/gi),
    imageCount: matchCount(html, /<img\b/gi) + (blog.blog_image ? 1 : 0),
    firstProductMention,
    placementProgress: firstProductMention < 0 || !lowerText.length ? null : Number((firstProductMention / lowerText.length).toFixed(4)),
    plannedPlacementCount: (placementPlan?.placementSequence || []).length,
    rankingPosition: placementPlan?.ownedProductPositionPolicy || 'none',
    actualRankingPositions,
    evidenceCoverage,
    evidenceCoverageNumerator: evidenceNumerator,
    evidenceCoverageDenominator: evidenceDenominator,
    evidenceCoverageRatio,
    unsupportedClaimCount,
    titleSimilarity: Number(originalitySimilarity.title || 0),
    headingSimilarity: Number(originalitySimilarity.headings || 0),
    structuralSimilarity: Number(originalitySimilarity.structure || 0),
    contentSimilarity: Number(originalitySimilarity.content || 0),
    ...repeated,
    disclosurePresent: /tai tro|quang cao|san pham cua inoxpran|minh bach|disclosure/i.test(normalizeTopicKey(text)),
    unsafeHtmlCount: countUnsafeHtml(html)
    , promptInjectionSignalCount: countPromptInjectionSignals(`${blog.blog_title || ''}\n${blog.blog_excerpt || ''}\n${html}`)
  }
}

class AgenticBlogQaEvidenceService {
  constructor({
    BlogModel = BlogPost,
    BatchModel = AgenticBlogQaBatch,
    CaseModel = AgenticBlogQaCase,
    ExecutionModel = BlogAutomationExecution,
    ScheduleModel = BlogAutomationSchedule,
    ReservationModel = QaTopicReservation,
    ReadinessModel = ContentPublishReadinessReport,
    WorkOrderModel = ContentWorkOrder,
    BriefModel = UnifiedContentBrief,
    ResearchBundleModel = ResearchBundle,
    EvidenceMapModel = EvidenceMap,
    StyleProfileModel = EditorialStyleProfile,
    StrategyPlanModel = BlogStrategyPlan,
    ProductSeedPlanModel = ProductSeedPlan,
    PlacementPlanModel = EditorialProductPlacementPlan,
    GoogleSnapshotModel = GoogleIntelligenceSnapshot,
    GoogleRunModel = GoogleIntelligenceRun,
    ContentOperationsSnapshotModel = ContentOperationsDailySnapshot,
    ContentOperationsRunModel = ContentOperationsRun,
    InventorySnapshotModel = ContentInventorySnapshot,
    InventoryItemModel = ContentInventoryItem,
    OpportunityDecisionModel = ContentOpportunityDecision,
    ProductCatalogSnapshotModel = ProductCatalogSnapshot
  } = {}) {
    this.BlogModel = BlogModel
    this.BatchModel = BatchModel
    this.CaseModel = CaseModel
    this.ExecutionModel = ExecutionModel
    this.ScheduleModel = ScheduleModel
    this.ReservationModel = ReservationModel
    this.ReadinessModel = ReadinessModel
    this.WorkOrderModel = WorkOrderModel
    this.BriefModel = BriefModel
    this.ResearchBundleModel = ResearchBundleModel
    this.EvidenceMapModel = EvidenceMapModel
    this.StyleProfileModel = StyleProfileModel
    this.StrategyPlanModel = StrategyPlanModel
    this.ProductSeedPlanModel = ProductSeedPlanModel
    this.PlacementPlanModel = PlacementPlanModel
    this.GoogleSnapshotModel = GoogleSnapshotModel
    this.GoogleRunModel = GoogleRunModel
    this.ContentOperationsSnapshotModel = ContentOperationsSnapshotModel
    this.ContentOperationsRunModel = ContentOperationsRunModel
    this.InventorySnapshotModel = InventorySnapshotModel
    this.InventoryItemModel = InventoryItemModel
    this.OpportunityDecisionModel = OpportunityDecisionModel
    this.ProductCatalogSnapshotModel = ProductCatalogSnapshotModel
  }

  async _leanById(Model, id) {
    if (!Model?.findById || !id) return null
    let query = Model.findById(id)
    if (query?.lean) query = query.lean()
    return query
  }

  async _leanInventoryItems(snapshotId) {
    if (!this.InventoryItemModel?.find || !snapshotId) return []
    let query = this.InventoryItemModel.find({ snapshotId })
    if (query?.select) {
      query = query.select('_id snapshotId isQaTest qaBatchId qaCaseId environment executionMode originalTopicSeed normalizedTopicKey')
    }
    if (query?.lean) query = query.lean()
    const items = await query
    return Array.isArray(items) ? items : []
  }

  async _countInventoryItems(snapshotId) {
    if (!this.InventoryItemModel?.countDocuments || !snapshotId) return 0
    return Number(await this.InventoryItemModel.countDocuments({ snapshotId }))
  }

  async build({ qaCase, blog, executionId }) {
    const caseId = qaCase?._id || qaCase?.qaCaseId || qaCase
    const blogId = blog?._id || blog?.id || blog
    const persistedCase = await this._leanById(this.CaseModel, caseId)
    const persistedBlog = await this._leanById(this.BlogModel, blogId)
    if (!persistedCase) throw new NotFoundError('QA case not found')
    if (!persistedBlog) throw new NotFoundError('QA blog not found')
    const productCatalogRequired = isProductCatalogRequired(persistedCase.productMode)
    const execution = await this._leanById(this.ExecutionModel, executionId || persistedBlog.agenticExecutionId)
    if (!execution) throw new NotFoundError('QA execution not found')
    const [batch, schedule, reservation, readiness, workOrder, brief, researchBundle, evidenceMap, styleProfile, strategyPlan, productSeedPlan, placementPlan, googleSnapshot, contentOperationsSnapshot, inventorySnapshot, opportunityDecision, productCatalogSnapshot] = await Promise.all([
      this._leanById(this.BatchModel, persistedCase.qaBatchId || persistedCase.batchId),
      this._leanById(this.ScheduleModel, execution.scheduleId || persistedCase.scheduleId),
      this._leanById(this.ReservationModel, persistedCase.topicReservationId || persistedBlog.qaTopicReservationId),
      this._leanById(this.ReadinessModel, persistedBlog.publishReadinessReportId || execution.publishReadinessReportId),
      this._leanById(this.WorkOrderModel, execution.contentWorkOrderId || persistedBlog.contentWorkOrderId),
      this._leanById(this.BriefModel, execution.unifiedContentBriefId || persistedBlog.unifiedContentBriefId),
      this._leanById(this.ResearchBundleModel, execution.researchBundleId || persistedBlog.researchBundleId),
      this._leanById(this.EvidenceMapModel, execution.evidenceMapId || persistedBlog.evidenceMapId),
      this._leanById(this.StyleProfileModel, execution.editorialStyleProfileId || persistedBlog.editorialStyleProfileId),
      this._leanById(this.StrategyPlanModel, execution.strategyPlanId || persistedBlog.strategyPlanId),
      this._leanById(this.ProductSeedPlanModel, execution.productSeedPlanId || persistedBlog.productSeedPlanId),
      this._leanById(this.PlacementPlanModel, execution.editorialProductPlacementPlanId || persistedBlog.editorialProductPlacementPlanId),
      this._leanById(this.GoogleSnapshotModel, execution.googleIntelSnapshotId || persistedBlog.googleIntelSnapshotId),
      this._leanById(this.ContentOperationsSnapshotModel, execution.contentOperationsSnapshotId),
      this._leanById(this.InventorySnapshotModel, execution.contentInventorySnapshotId),
      this._leanById(this.OpportunityDecisionModel, execution.contentOpportunityDecisionId),
      this._leanById(this.ProductCatalogSnapshotModel, execution.productCatalogSnapshotId)
    ])
    const productCatalogLineage = buildProductCatalogLineage({
      productMode: persistedCase.productMode,
      execution,
      productSeedPlan,
      placementPlan,
      productCatalogSnapshot
    })
    if (!batch || !schedule || !reservation || !readiness || !workOrder || !brief || !researchBundle || !evidenceMap || !styleProfile || !strategyPlan || !productSeedPlan || !placementPlan || !googleSnapshot || !contentOperationsSnapshot || !inventorySnapshot || !opportunityDecision || productCatalogLineage.requiredArtifactMissing) {
      throw new NotFoundError('A required QA artifact is missing from the retained execution lineage')
    }
    const contentOperationsRunId = contentOperationsRunIdFromArtifacts({
      opportunityDecision,
      workOrder,
      brief
    })
    const [googleRun, inventoryItems, retainedInventoryItemCount, contentOperationsRun] = await Promise.all([
      this._leanById(this.GoogleRunModel, googleSnapshot.runId),
      this._leanInventoryItems(inventorySnapshot._id),
      this._countInventoryItems(inventorySnapshot._id),
      this._leanById(this.ContentOperationsRunModel, contentOperationsRunId)
    ])
    const expectedBatchId = String(persistedCase.qaBatchId || persistedCase.batchId || '')
    const expectedCaseId = String(persistedCase.qaCaseId || persistedCase._id || '')
    const expectedUpstreamProvenance = {
      qaBatchId: expectedBatchId,
      qaCaseId: expectedCaseId,
      environment: persistedCase.environment,
      executionMode: persistedCase.executionMode,
      originalTopicSeed: persistedCase.originalTopicSeed,
      normalizedTopicKey: persistedCase.normalizedTopicKey
    }
    const upstreamProvenance = {
      googleIntelligence: classifyUpstreamQaProvenance({ artifact: googleSnapshot, expected: expectedUpstreamProvenance }),
      contentOperations: classifyUpstreamQaProvenance({ artifact: contentOperationsSnapshot, expected: expectedUpstreamProvenance }),
      inventory: classifyUpstreamQaProvenance({ artifact: inventorySnapshot, expected: expectedUpstreamProvenance }),
      productCatalog: productCatalogRequired
        ? classifyUpstreamQaProvenance({ artifact: productCatalogSnapshot, expected: expectedUpstreamProvenance })
        : { valid: true, provenanceClass: 'not_applicable', reason: '' }
    }
    const googleRunLineage = buildGoogleRunLineage({
      snapshot: googleSnapshot,
      run: googleRun,
      expected: expectedUpstreamProvenance
    })
    const inventoryItemLineage = buildInventoryItemLineage({
      snapshot: inventorySnapshot,
      items: inventoryItems,
      retainedItemCount: retainedInventoryItemCount,
      expected: expectedUpstreamProvenance
    })
    const contentOperationsRunLineage = buildContentOperationsRunLineage({
      run: contentOperationsRun,
      opportunityDecision,
      workOrder,
      brief,
      googleSnapshot,
      contentOperationsSnapshot,
      inventorySnapshot,
      expected: expectedUpstreamProvenance
    })
    if (googleRunLineage.requiredArtifactMissing || contentOperationsRunLineage.requiredArtifactMissing) {
      throw new NotFoundError('A required QA artifact is missing from the retained execution lineage')
    }
    const linked = [
      ['case_is_qa', persistedCase.isQaTest === true],
      ['batch_is_qa', batch.isQaTest === true],
      ['batch_id', String(batch._id || '') === expectedBatchId],
      ['batch_environment', batch.environment === persistedCase.environment],
      ['blog_is_qa', persistedBlog.isQaTest === true],
      ['execution_is_qa', execution.isQaTest === true],
      ['schedule_is_qa', schedule.isQaTest === true],
      ['reservation_is_qa', reservation.isQaTest === true],
      ['blog_batch', String(persistedBlog.qaBatchId || '') === expectedBatchId],
      ['blog_case', String(persistedBlog.qaCaseId || '') === expectedCaseId],
      ['execution_batch', String(execution.qaBatchId || '') === expectedBatchId],
      ['execution_case', String(execution.qaCaseId || '') === expectedCaseId],
      ['schedule_batch', String(schedule.qaBatchId || '') === expectedBatchId],
      ['schedule_case', String(schedule.qaCaseId || '') === expectedCaseId],
      ['reservation_batch', String(reservation.qaBatchId || reservation.batchId || '') === expectedBatchId],
      ['reservation_case', String(reservation.qaCaseId || reservation.caseId || '') === expectedCaseId],
      ['case_blog_link', String(persistedCase.blogId || '') === String(persistedBlog._id || '')],
      ['case_execution_link', String(persistedCase.executionId || '') === String(execution._id || '')],
      ['case_schedule_link', String(persistedCase.scheduleId || '') === String(schedule._id || '')],
      ['case_reservation_link', String(persistedCase.topicReservationId || '') === String(reservation._id || '')],
      ['blog_execution_link', String(persistedBlog.agenticExecutionId || '') === String(execution._id || '')]
      , ['blog_iteration', Number(persistedBlog.qaIteration) === Number(execution.qaIteration)]
      , ['execution_iteration_valid', Number.isInteger(Number(execution.qaIteration)) && Number(execution.qaIteration) >= 0 && Number(execution.qaIteration) <= Number(batch.iteration || 0)]
      , ['execution_google_snapshot', String(execution.googleIntelSnapshotId || '') === String(googleSnapshot._id || '')]
      , ['execution_content_operations_snapshot', String(execution.contentOperationsSnapshotId || '') === String(contentOperationsSnapshot._id || '')]
      , ['execution_inventory_snapshot', String(execution.contentInventorySnapshotId || '') === String(inventorySnapshot._id || '')]
      , ['execution_opportunity_decision', String(execution.contentOpportunityDecisionId || '') === String(opportunityDecision._id || '')]
      , ['work_order_google_snapshot', String(workOrder.googleIntelSnapshotId || '') === String(googleSnapshot._id || '')]
      , ['work_order_content_operations_snapshot', String(workOrder.contentOperationsSnapshotId || '') === String(contentOperationsSnapshot._id || '')]
      , ['work_order_inventory_snapshot', String(workOrder.contentInventorySnapshotId || '') === String(inventorySnapshot._id || '')]
      , ['work_order_opportunity_decision', String(workOrder.contentOpportunityDecisionId || '') === String(opportunityDecision._id || '')]
      , ['content_operations_google_snapshot', String(contentOperationsSnapshot.googleIntelSnapshotId || '') === String(googleSnapshot._id || '')]
      , ['content_operations_inventory_snapshot', String(contentOperationsSnapshot.contentInventorySnapshotId || '') === String(inventorySnapshot._id || '')]
      , ['opportunity_content_operations_snapshot', String(opportunityDecision.contentOperationsSnapshotId || '') === String(contentOperationsSnapshot._id || '')]
      , ['opportunity_inventory_snapshot', String(opportunityDecision.contentInventorySnapshotId || '') === String(inventorySnapshot._id || '')]
      , ['placement_product_plan', String(placementPlan.productSeedPlanId || '') === String(productSeedPlan._id || '')]
      , ['readiness_work_order', String(readiness.contentWorkOrderId || '') === String(workOrder._id || '')]
      , ['readiness_brief', String(readiness.unifiedContentBriefId || '') === String(brief._id || '')]
      , ['readiness_evidence_map', String(readiness.evidenceMapId || '') === String(evidenceMap._id || '')]
      , ['google_snapshot_usable', ['completed_with_changes', 'completed_no_change', 'partial', 'manually_overridden'].includes(googleSnapshot.status)]
      , ['content_operations_snapshot_usable', ['complete', 'partial'].includes(contentOperationsSnapshot.status)]
      , ['inventory_snapshot_usable', ['complete', 'partial'].includes(inventorySnapshot.status)]
      , ['google_snapshot_provenance', upstreamProvenance.googleIntelligence.valid]
      , ['content_operations_snapshot_provenance', upstreamProvenance.contentOperations.valid]
      , ['inventory_snapshot_provenance', upstreamProvenance.inventory.valid]
      , ['product_catalog_snapshot_provenance', upstreamProvenance.productCatalog.valid]
      , ['ordered_v3_trace', orderedSubsequence(execution.agentSteps, REQUIRED_V3_TRACE)]
    ]
    linked.push(...productCatalogLineage.linkedChecks)
    linked.push(...googleRunLineage.linkedChecks)
    linked.push(...inventoryItemLineage.linkedChecks)
    linked.push(...contentOperationsRunLineage.linkedChecks)
    const qaArtifacts = [
      ['execution', execution], ['schedule', schedule], ['blog', persistedBlog], ['reservation', reservation],
      ['work_order', workOrder], ['brief', brief], ['research_bundle', researchBundle], ['evidence_map', evidenceMap],
      ['style_profile', styleProfile], ['strategy_plan', strategyPlan], ['product_seed_plan', productSeedPlan],
      ['placement_plan', placementPlan], ['publish_readiness', readiness], ['opportunity_decision', opportunityDecision]
    ]
    for (const [label, artifact] of qaArtifacts) {
      linked.push([`${label}_is_qa`, artifact.isQaTest === true])
      linked.push([`${label}_batch_id`, String(artifact.qaBatchId || artifact.batchId || '') === expectedBatchId])
      linked.push([`${label}_case_id`, String(artifact.qaCaseId || artifact.caseId || '') === expectedCaseId])
      linked.push([`${label}_environment`, artifact.environment === persistedCase.environment])
      linked.push([`${label}_execution_mode`, artifact.executionMode === persistedCase.executionMode])
      linked.push([`${label}_topic_seed`, normalizeTopicKey(artifact.originalTopicSeed) === normalizeTopicKey(persistedCase.originalTopicSeed)])
      linked.push([`${label}_topic_key`, artifact.normalizedTopicKey === persistedCase.normalizedTopicKey])
    }
    const linkFailure = linked.find(([, pass]) => !pass)
    if (linkFailure) throw new BadRequestError(`QA artifact provenance mismatch: ${linkFailure[0]}`)

    const executionIteration = Number(execution.qaIteration || 0)
    const batchIteration = Number(batch.iteration || 0)
    let executionQuery = this.ExecutionModel.find({
      qaCaseId: persistedCase._id,
      qaIteration: buildRetainedExecutionIterationFilter({ executionIteration, batchIteration })
    })
    if (executionQuery?.select) executionQuery = executionQuery.select('_id executionKey scheduleId status completedAt executionMode qaIteration contentWorkOrderId metadata.leaseOwner metadata.commitClaimedAt metadata.completedWorkOrderClaimTokenHash')
    if (executionQuery?.limit) executionQuery = executionQuery.limit(20)
    if (executionQuery?.lean) executionQuery = executionQuery.lean()
    const executions = await executionQuery
    const duplicateExecutionCount = Math.max(0, (executions || []).length - 1)
    const iteration = executionIteration
    const expectedSlotHash = buildQaRunSlotKeyHash({
      caseId: persistedCase._id,
      iteration,
      executionMode: persistedCase.executionMode
    })
    const currentAttempt = (persistedCase.runAttempts || []).find(attempt =>
      Number(attempt.batchIteration) === iteration &&
      attempt.executionMode === persistedCase.executionMode &&
      attempt.idempotencyKeyHash === expectedSlotHash
    )
    const leaseOwnerHash = execution.metadata?.leaseOwner
      ? crypto.createHash('sha256').update(String(execution.metadata.leaseOwner)).digest('hex')
      : ''
    const scheduledExecutionKey = persistedCase.executionMode === 'actual_schedule' && currentAttempt?.scheduledFor
      ? `${String(schedule._id || schedule.id)}:${new Date(currentAttempt.scheduledFor).toISOString()}`
      : ''
    const executionKeyValid = persistedCase.executionMode === 'actual_schedule'
      ? execution.executionKey === scheduledExecutionKey
      : String(execution.executionKey || '').startsWith(`manual:${String(schedule._id || schedule.id)}:`)
    const workOrderClaimLineageValid = Boolean(
      execution.metadata?.completedWorkOrderClaimTokenHash &&
      workOrder.metadata?.completedClaimTokenHash &&
      execution.metadata.completedWorkOrderClaimTokenHash === workOrder.metadata.completedClaimTokenHash
    )
    const runAttemptOwnershipValid = Boolean(
      currentAttempt &&
      String(currentAttempt.executionId || '') === String(execution._id || '') &&
      currentAttempt.executionKey === execution.executionKey &&
      currentAttempt.leaseOwnerHash === leaseOwnerHash &&
      currentAttempt.commitClaimedAt &&
      execution.metadata?.commitClaimedAt &&
      new Date(currentAttempt.commitClaimedAt).getTime() === new Date(execution.metadata.commitClaimedAt).getTime()
    )
    const scheduleOwnershipValid = Boolean(
      (executions || []).length === 1 &&
      String(execution.scheduleId) === String(schedule._id || schedule.id) &&
      execution.status === 'draft_created' &&
      execution.completedAt &&
      executionKeyValid &&
      leaseOwnerHash &&
      execution.metadata?.commitClaimedAt &&
      workOrderClaimLineageValid &&
      runAttemptOwnershipValid
    )
    const agenticReviews = persistedBlog.agenticReviews || persistedBlog.generationMetadata?.reviewerDecisions || execution.reviewerDecisions || {}
    const metrics = buildHtmlMetrics({
      blog: persistedBlog,
      qaCase: persistedCase,
      productSeedPlan,
      placementPlan,
      evidenceMap,
      readiness,
      agenticReviews
    })
    const sanitizerStable = sanitizeSeoBlogHtml(String(persistedBlog.blog_content || '')) === String(persistedBlog.blog_content || '')
    // Retained QA drafts are deliberately non-public. Their safe canonical policy is
    // an empty canonical coupled to an explicit noindex/nofollow decision; requiring
    // a public HTTPS URL here would make every correctly-isolated QA draft fail.
    const canonicalSafe = isSafeCanonicalForBlog(persistedBlog)
    const slugValid = Boolean(persistedBlog.blog_slug) && normalizeSlug(persistedBlog.blog_slug) === persistedBlog.blog_slug
    const structuredDataType = String(readiness?.structuredData?.type || brief.structuredDataCandidate || '')
    const structuredDataValid = !structuredDataType || (
      ['Article', 'BlogPosting', 'HowTo', 'FAQPage'].includes(structuredDataType) &&
      readiness?.structuredData?.pass !== false
    )
    const topicSimilarity = setSimilarity(
      semanticTokens(persistedCase.topicCore || persistedCase.originalTopicSeed),
      semanticTokens(`${persistedBlog.topicSummary || ''} ${persistedBlog.blog_title || ''}`)
    )
    const caseOutline = (persistedCase.plannedOutline || []).map(normalizeTopicKey)
    const scheduleOutline = (schedule.agentConfig?.outline || []).map(normalizeTopicKey)
    const briefOutline = (brief.plannedOutline || []).map(normalizeTopicKey)
    const writerOutline = (persistedBlog.generationMetadata?.plannedOutline || []).map(normalizeTopicKey)
    const semanticChainPreserved =
      normalizeTopicKey(workOrder.topic) === normalizeTopicKey(persistedCase.effectiveTopic) &&
      normalizeTopicKey(brief.topic) === normalizeTopicKey(persistedCase.effectiveTopic) &&
      normalizeTopicKey(brief.primarySearchIntent) === normalizeTopicKey(persistedCase.searchIntent) &&
      normalizeTopicKey(brief.articleType) === normalizeTopicKey(persistedCase.articleType) &&
      normalizeTopicKey(brief.contentRole) === normalizeTopicKey(persistedCase.contentRole) &&
      caseOutline.join('|') === scheduleOutline.join('|') &&
      caseOutline.join('|') === briefOutline.join('|') &&
      caseOutline.join('|') === writerOutline.join('|')
    const topicPreserved =
      normalizeTopicKey(schedule.originalTopicSeed) === normalizeTopicKey(persistedCase.originalTopicSeed) &&
      schedule.normalizedTopicKey === persistedCase.normalizedTopicKey &&
      reservation.normalizedTopicKey === persistedCase.normalizedTopicKey &&
      execution.normalizedTopicKey === persistedCase.normalizedTopicKey &&
      persistedBlog.normalizedTopicKey === persistedCase.normalizedTopicKey &&
      semanticChainPreserved
    const artifactChainValid = Boolean(
      googleSnapshot._id && contentOperationsSnapshot._id && inventorySnapshot._id && opportunityDecision._id && readiness._id &&
      productCatalogLineage.valid &&
      execution.contentOperationsSnapshotId &&
      execution.contentInventorySnapshotId &&
      execution.contentOpportunityDecisionId &&
      execution.contentWorkOrderId &&
      execution.unifiedContentBriefId &&
      execution.evidenceMapId &&
      persistedBlog.contentWorkOrderId &&
      persistedBlog.unifiedContentBriefId &&
      persistedBlog.evidenceMapId
      && execution.researchBundleId && execution.editorialStyleProfileId && execution.strategyPlanId &&
      execution.productSeedPlanId && execution.editorialProductPlacementPlanId &&
      String(evidenceMap._id) === String(execution.evidenceMapId) &&
      String(researchBundle._id) === String(execution.researchBundleId) &&
      String(styleProfile._id) === String(execution.editorialStyleProfileId) &&
      String(strategyPlan._id) === String(execution.strategyPlanId) &&
      String(productSeedPlan._id) === String(execution.productSeedPlanId) &&
      String(placementPlan._id) === String(execution.editorialProductPlacementPlanId)
      && orderedSubsequence(execution.agentSteps, REQUIRED_V3_TRACE)
    )
    const upstreamArtifactSummaries = {
      googleIntelligence: {
        id: String(googleSnapshot._id),
        status: googleSnapshot.status,
        snapshotDate: googleSnapshot.snapshotDate,
        mandatorySourcesSucceeded: googleSnapshot.mandatorySourcesSucceeded === true,
        sourcesChecked: Number(googleSnapshot.sourcesChecked || 0),
        successfulSources: Number(googleSnapshot.successfulSources || 0),
        failedSources: Number(googleSnapshot.failedSources || 0),
        contentHash: String(googleSnapshot.contentHash || ''),
        provenanceClass: upstreamProvenance.googleIntelligence.provenanceClass,
        run: googleRunLineage.summary
      },
      contentOperations: {
        id: String(contentOperationsSnapshot._id),
        status: contentOperationsSnapshot.status,
        snapshotDate: contentOperationsSnapshot.snapshotDate,
        warningCount: (contentOperationsSnapshot.warnings || []).length,
        contentHash: String(contentOperationsSnapshot.contentHash || ''),
        provenanceClass: upstreamProvenance.contentOperations.provenanceClass
      },
      inventory: {
        id: String(inventorySnapshot._id),
        status: inventorySnapshot.status,
        snapshotDate: inventorySnapshot.snapshotDate,
        itemCount: Number(inventorySnapshot.itemCount || 0),
        warningCount: (inventorySnapshot.warnings || []).length,
        contentHash: String(inventorySnapshot.contentHash || ''),
        provenanceClass: upstreamProvenance.inventory.provenanceClass,
        retainedItems: inventoryItemLineage.summary
      },
      contentOperationsRun: contentOperationsRunLineage.summary,
      opportunity: {
        id: String(opportunityDecision._id),
        decision: opportunityDecision.recommendedAction || opportunityDecision.decisionType || '',
        status: opportunityDecision.status || '',
        candidateId: opportunityDecision.candidateId || ''
      },
      productCatalog: productCatalogLineage.summary
        ? {
            ...productCatalogLineage.summary,
            provenanceClass: upstreamProvenance.productCatalog.provenanceClass
          }
        : null
    }
    const telegramSent = ['sent', 'notified', 'delivered'].includes(String(execution.telegramNotificationStatus || '').toLowerCase())
    const selectedProducts = [productSeedPlan.primaryProduct, ...(productSeedPlan.supportingProducts || [])]
      .filter(product => product?.productId)
    const productApplicable = productCatalogRequired && selectedProducts.length > 0 && placementPlan.decision === 'place_product'
    const visualPlan = persistedBlog.visualPlan
    const visualPlanValid = Boolean(
      visualPlan &&
      typeof visualPlan === 'object' &&
      visualPlan.cover?.required === true &&
      String(visualPlan.cover?.purpose || '').trim() &&
      String(visualPlan.cover?.altText || '').trim() &&
      visualPlan.cover?.reviewRequired === true &&
      visualPlan.safety?.paidProviderCalled === false &&
      visualPlan.safety?.externalImageSearchCalled === false &&
      visualPlan.safety?.publishWithoutReviewAllowed === false
    )
    const allImages = [persistedBlog.coverImage, ...(persistedBlog.contentImages || [])].filter(Boolean)
    const imageUnsafe = allImages.some(image =>
      ['rejected', 'failed'].includes(String(image.status || '').toLowerCase()) ||
      image.reviewStatus === 'rejected'
    ) || visualPlan?.safety?.paidProviderCalled === true || visualPlan?.safety?.externalImageSearchCalled === true
    const completedWithoutApproval = persistedBlog.imagePipelineStatus === 'complete' &&
      persistedBlog.coverImage?.reviewStatus !== 'approved'
    const imageReviewPass = visualPlanValid && !imageUnsafe && !completedWithoutApproval
    const imageReview = {
      pass: imageReviewPass,
      status: !visualPlanValid
        ? 'missing_or_invalid_visual_plan'
        : imageUnsafe
          ? 'rejected_or_unsafe'
          : completedWithoutApproval
            ? 'complete_without_approval'
            : persistedBlog.imagePipelineStatus === 'complete' ? 'passed' : 'pending_safe_plan',
      draftPending: imageReviewPass && persistedBlog.imagePipelineStatus !== 'complete'
    }

    const existingGateResults = {
      factReview: toPassedGate(agenticReviews.factuality),
      originalityReview: toPassedGate(agenticReviews.originality),
      seoAeoGeoReview: toPassedGate(agenticReviews.seoAeoGeo),
      peopleFirstSpamReview: toPassedGate(agenticReviews.peopleFirstSpam),
      brandVoiceReview: toPassedGate(agenticReviews.brandVoice),
      publishReadiness: readiness ? { pass: readiness.pass === true, status: readiness.pass ? 'passed' : 'failed' } : toPassedGate(execution.publishReadiness),
      securityReview: { pass: metrics.unsafeHtmlCount === 0, status: metrics.unsafeHtmlCount === 0 ? 'passed' : 'failed' },
      imageReview,
      productClaimReview: productApplicable ? toPassedGate(agenticReviews.productClaims || persistedBlog.productClaimReview) : { pass: true, status: 'not_applicable' },
      productPlacementReview: productApplicable ? toPassedGate(agenticReviews.editorialProductPlacement || persistedBlog.editorialProductPlacementReview) : { pass: true, status: 'not_applicable' }
    }
    const existingSeoScore = Number(
      agenticReviews.seoAeoGeo?.seoScore ??
      execution.reviewerDecisions?.seoAeoGeo?.seoScore ??
      0
    )
    const deterministicEvidence = {
      source: 'persisted_backend_v1',
      blogId: String(persistedBlog._id || persistedBlog.id),
      executionId: String(execution._id || execution.id),
      scheduleId: String(schedule._id || schedule.id),
      reservationId: String(reservation._id || ''),
      isDraft: persistedBlog.isDraft === true,
      isPublished: persistedBlog.isPublished === true,
      publiclyReachable: persistedBlog.isPublished === true || Boolean(persistedBlog.publishedAt),
      indexRequested: persistedBlog.indexability?.index === true,
      telegramSent,
      socialDistributed: persistedBlog.generationMetadata?.socialDistributionRequested === true,
      topicUnique: reservation.status === 'consumed' &&
        String(reservation.caseId) === String(persistedCase._id) &&
        ((reservation.consumptions || []).some(item =>
          Number(item.iteration) === iteration &&
          item.executionMode === persistedCase.executionMode &&
          String(item.blogId || '') === String(persistedBlog._id || '') &&
          String(item.executionId || '') === String(execution._id || '')
        ) || (iteration === 0 && !(reservation.consumptions || []).length &&
          String(reservation.blogId || '') === String(persistedBlog._id || '') &&
          String(reservation.executionId || '') === String(execution._id || ''))),
      topicPreserved,
      topicSimilarity,
      semanticChainPreserved,
      artifactChainValid,
      visualPlanValid,
      imageUnsafe,
      completedWithoutImageApproval: completedWithoutApproval,
      scheduleOwnershipValid,
      executionKeyValid,
      runAttemptOwnershipValid,
      workOrderClaimLineageValid,
      expectedRunSlotHash: expectedSlotHash,
      duplicateExecutionCount,
      scheduleExecutionCount: (executions || []).length,
      orderedV3TraceValid: orderedSubsequence(execution.agentSteps, REQUIRED_V3_TRACE),
      upstreamArtifactSummaries,
      productCatalogRequired,
      mandatorySourcesSucceeded: googleSnapshot.mandatorySourcesSucceeded === true,
      sanitizerStable,
      canonicalSafe,
      slugValid,
      structuredDataValid,
      structuredDataType,
      ...metrics
    }
    const existingSeoThreshold = Number(batch.existingSeoThreshold)
    if (!Number.isFinite(existingSeoThreshold) || existingSeoThreshold < 85 || existingSeoThreshold > 100) {
      throw new BadRequestError('Persisted QA batch SEO threshold is invalid')
    }
    return {
      deterministicEvidence,
      existingGateResults,
      existingSeoScore,
      existingSeoThreshold,
      contentRevisionHash: contentRevisionHash(persistedBlog),
      persistedBatch: batch,
      persistedCase,
      persistedBlog,
      execution,
      schedule,
      reservation,
      readiness,
      workOrder,
      brief
      , researchBundle
      , evidenceMap
      , styleProfile
      , strategyPlan
      , productSeedPlan
      , placementPlan
      , googleSnapshot
      , contentOperationsSnapshot
      , inventorySnapshot
      , opportunityDecision
      , productCatalogSnapshot
      , upstreamArtifactSummaries
    }
  }
}

module.exports = {
  AgenticBlogQaEvidenceService,
  buildHtmlMetrics,
  contentRevisionHash,
  countUnsafeHtml,
  extractHeadings,
  extractLinks,
  hierarchyValid,
  htmlText,
  countPromptInjectionSignals,
  orderedSubsequence,
  REQUIRED_V3_TRACE,
  toPassedGate
  , buildContentOperationsRunLineage
  , buildGoogleRunLineage
  , buildInventoryItemLineage
  , buildProductCatalogLineage
  , buildRetainedExecutionIterationFilter
  , classifyUpstreamQaProvenance
  , isProductCatalogRequired
  , isSafeCanonical
  , isSafeCanonicalForBlog
}
