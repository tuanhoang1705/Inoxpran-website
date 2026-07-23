'use strict'

const crypto = require('node:crypto')
const { isValidObjectId } = require('mongoose')
const { BadRequestError, NotFoundError } = require('../../core/error.response')
const { ACTIONS, getContentOperationsConfig } = require('../../config/contentOperations.config')
const { calculateNextRun, normalizeTimes } = require('../../utils/blogSchedule.util')
const { redactInternalOwnership, safeErrorCode } = require('../../utils/httpError.util')
const { hasQaProvenanceMarkers, qaScopeFilter } = require('../../utils/qaProvenance.util')
const { ContentOperationsDailySnapshot } = require('../../models/contentOperationsDailySnapshot.model')
const { ContentInventorySnapshot } = require('../../models/contentInventorySnapshot.model')
const { ContentInventoryItem } = require('../../models/contentInventoryItem.model')
const { ContentOpportunityDecision } = require('../../models/contentOpportunityDecision.model')
const { BUSINESS_GOALS, ContentWorkOrder, WORK_ORDER_STATUSES } = require('../../models/contentWorkOrder.model')
const { UnifiedContentBrief } = require('../../models/unifiedContentBrief.model')
const { ContentSignal } = require('../../models/contentSignal.model')
const { ContentOperationsRun } = require('../../models/contentOperationsRun.model')
const { ContentOperationsSchedule } = require('../../models/contentOperationsSchedule.model')
const { ContentMonitoringTask } = require('../../models/contentMonitoringTask.model')
const { ContentPerformanceSnapshot } = require('../../models/contentPerformanceSnapshot.model')
const { ContentLearningRecord } = require('../../models/contentLearningRecord.model')
const { PostPublishVerification } = require('../../models/postPublishVerification.model')
const { ContentMaintenanceAlert } = require('../../models/contentMaintenanceAlert.model')
const { blog } = require('../../models/blog.model')
const { BlogAutomationExecution } = require('../../models/blogAutomationExecution.model')
const { ContentSignalService, unsafePatterns: signalUnsafePatterns } = require('./contentSignal.service')
const { ContentInventoryService } = require('./contentInventory.service')
const { ContentOperationsPlanningService, briefInputFor, workOrderInputFor } = require('./contentOperationsPlanning.service')
const {
    ContentWorkOrderService,
    getActiveClaimToken,
    getExecutionClaimToken,
    isWorkOrderRunnable
} = require('./workOrder.service')
const { UnifiedContentBriefService } = require('./unifiedBrief.service')
const { writeContentOperationsAudit } = require('./contentOperationsAudit.service')
const { AgenticBlogCoreService } = require('../agenticBlogCore.service')
const AutomationSeoBlogService = require('../automationSeoBlog.service')
const { ProductSeedPlanningService } = require('../productSeedPlanning.service')
const { EditorialProductPlacementPlanningService } = require('../editorialProductPlacementPlanning.service')

const safePagination = ({ page, limit } = {}) => ({
    page: Math.max(1, Number.parseInt(page, 10) || 1),
    limit: Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 20))
})

const toView = (value) => {
    if (!value) return null
    const source = typeof value.toObject === 'function' ? value.toObject() : { ...value }
    return { ...redactInternalOwnership(source), id: String(source._id || source.id || '') }
}

const asObject = (value) => typeof value?.toObject === 'function' ? value.toObject() : value || {}

const productionArtifactScopeFilter = () => ({
    ...qaScopeFilter(null),
    qaBatchId: null,
    qaCaseId: null,
    environment: { $in: [null, ''] },
    executionMode: { $in: [null, ''] },
    originalTopicSeed: { $in: [null, ''] },
    normalizedTopicKey: { $in: [null, ''] },
    'metadata.isQaTest': { $ne: true },
    'metadata.qaBatchId': null,
    'metadata.qaCaseId': null
})

const assertProductionArtifact = (value, label) => {
    if (!value) return value
    const source = asObject(value)
    if (
        hasQaProvenanceMarkers(source) ||
        hasQaProvenanceMarkers(source.metadata) ||
        hasQaProvenanceMarkers(source.qaContext)
    ) {
        const error = new NotFoundError(`${label} not found`)
        error.code = 'PRODUCTION_ARTIFACT_SCOPE_INVALID'
        throw error
    }
    return value
}

const assertId = (value, label = 'id') => {
    if (!isValidObjectId(value)) throw new BadRequestError(`${label} is invalid`)
    return value
}

const assertPlainObject = (value, label = 'payload') => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestError(`${label} must be an object`)
    return value
}

const assertAllowedKeys = (payload, allowed) => {
    const unknown = Object.keys(payload || {}).filter((key) => !allowed.includes(key))
    if (unknown.length) throw new BadRequestError(`Unsupported fields: ${unknown.join(', ')}`)
}

const PLANNING_INPUT_KEYS = [
    'dryRun', 'draftOnly', 'includeCandidates', 'force', 'mode', 'topic', 'primaryKeyword', 'action',
    'targetBlogId', 'targetBlogSlug', 'mergeSourceBlogIds', 'primaryBusinessGoal', 'secondaryBusinessGoals',
    'targetAudience', 'funnelStage', 'primarySearchIntent', 'secondarySearchIntents', 'userProblems',
    'customerQuestions', 'successMetrics', 'productIntegrationPolicy', 'productSeeding', 'productPlacement',
    'language', 'articleType', 'secondaryKeywords', 'workingTitle', 'primaryQuestion', 'supportingQuestions',
    'contentRole', 'editorialAngle', 'requiredFacts', 'forbiddenClaims', 'ctaStrategy', 'reviewRequirements',
    'sourceRequirements', 'minimumOpportunityScore', 'allowSkip', 'workOrderId', 'owner', 'reviewer',
    'targetPublishDate', 'overrideReason', 'requiredEvidence', 'risks', 'primaryTerms', 'requiredEntities',
    'contentGap', 'editorialStyleConstraints', 'imagePlanRequirements', 'structuredDataCandidate'
]

const MODES = new Set(['best_action', 'fixed_brief', 'maintenance_only'])
const SOURCE_REQUIREMENT_ALIASES = Object.freeze({
    searchconsole: 'google_search_console',
    search_console: 'google_search_console',
    gsc: 'google_search_console',
    googleintelligence: 'google_intelligence',
    analytics: 'first_party_aggregate_analytics',
    aggregate_analytics: 'first_party_aggregate_analytics',
    firstpartyaggregateanalytics: 'first_party_aggregate_analytics',
    contentinventory: 'content_inventory',
    content_inventory: 'content_inventory',
    products: 'product_catalog',
    inventory: 'product_catalog',
    productcatalog: 'product_catalog',
    salessignals: 'content_signals',
    customersupportsignals: 'content_signals',
    internalsearchsignals: 'content_signals',
    campaignsignals: 'content_signals'
})
const SOURCE_REQUIREMENTS = new Set([
    'google_intelligence', 'google_search_console', 'first_party_aggregate_analytics',
    'trends', 'content_inventory', 'product_catalog', 'content_signals'
])

const strictBoolean = (value, label) => {
    if (typeof value !== 'boolean') throw new BadRequestError(`${label} must be a boolean`)
    return value
}

const PLANNING_MAX_BYTES = 64 * 1024
const SENSITIVE_FIELD_KEY = /(?:^|[_-])(?:access[_-]?token|token|auth(?:orization)?|api[_-]?key|secret|credential|password|passcode|cookie|session|email|e[_-]?mail|phone|mobile|tel|customer[_-]?(?:name|address|message)|raw[_-]?(?:message|conversation))(?:$|[_-])/i
const SECRET_TEXT_PATTERN = /(?:\bbearer\s+[a-z0-9._~-]{8,}|(?:api[_-]?key|access[_-]?token|token|authorization|client[_-]?secret|private[_-]?key|password|passwd|secret|signature|credential|session[_-]?id|cookie)\s*[:=]\s*[^\s,;]{4,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|mongodb(?:\+srv)?:\/\/[^\s]+)/i
const EXECUTABLE_TEXT_PATTERN = /(?:<\/?[a-z][^>]*>|<!--|&#?\w+;|(?:javascript|data|vbscript|file):)/i
const PII_PATTERNS = [
    signalUnsafePatterns.email,
    signalUnsafePatterns.phone,
    signalUnsafePatterns.paymentCard,
    signalUnsafePatterns.ipAddress,
    signalUnsafePatterns.orderReference,
    signalUnsafePatterns.customerName,
    signalUnsafePatterns.postalAddress,
    signalUnsafePatterns.privateConversation,
    signalUnsafePatterns.personalHealth
]

const assertSafePlanningText = (value, { field, required = false, maxLength = 2000 } = {}) => {
    if (value === undefined || value === null || value === '') {
        if (required) throw new BadRequestError(`${field} is required`)
        return ''
    }
    if (typeof value !== 'string') throw new BadRequestError(`${field} must be a string`)
    const normalized = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
    let inspected = normalized
    try { inspected = decodeURIComponent(normalized) } catch { /* inspect the original malformed text */ }
    if (!normalized && required) throw new BadRequestError(`${field} is required`)
    if (normalized.length > maxLength) throw new BadRequestError(`${field} must be at most ${maxLength} characters`)
    if (signalUnsafePatterns.promptInjection.test(inspected)) throw new BadRequestError(`${field} contains prompt-injection content`)
    if (SECRET_TEXT_PATTERN.test(inspected)) throw new BadRequestError(`${field} contains a secret`)
    if (PII_PATTERNS.some((pattern) => pattern.test(inspected))) throw new BadRequestError(`${field} contains customer PII`)
    if (EXECUTABLE_TEXT_PATTERN.test(inspected)) throw new BadRequestError(`${field} contains HTML or an executable URL`)
    return normalized
}

const normalizeSafeStringArray = (value, field, { maxItems = 20, maxLength = 500, required = false } = {}) => {
    if (!Array.isArray(value) || value.length > maxItems) throw new BadRequestError(`${field} must be an array of at most ${maxItems} items`)
    const normalized = [...new Set(value.map((item, index) => assertSafePlanningText(item, {
        field: `${field}.${index}`,
        required: true,
        maxLength
    })))]
    if (required && normalized.length === 0) throw new BadRequestError(`${field} must be a non-empty array`)
    return normalized
}

const normalizeBoundedPlanningValue = (value, field, depth = 0) => {
    if (depth > 4) throw new BadRequestError(`${field} is too deeply nested`)
    if (value === null || typeof value === 'boolean') return value
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new BadRequestError(`${field} must contain finite numbers`)
        return value
    }
    if (typeof value === 'string') return assertSafePlanningText(value, { field, maxLength: 2000 })
    if (Array.isArray(value)) {
        if (value.length > 50) throw new BadRequestError(`${field} must contain at most 50 items`)
        return value.map((item, index) => normalizeBoundedPlanningValue(item, `${field}.${index}`, depth + 1))
    }
    if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
        throw new BadRequestError(`${field} contains an unsupported value`)
    }
    const keys = Object.keys(value)
    if (keys.length > 30) throw new BadRequestError(`${field} must contain at most 30 fields`)
    return keys.reduce((normalized, key) => {
        if (!/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(key) || SENSITIVE_FIELD_KEY.test(key)) {
            throw new BadRequestError(`${field} contains an unsafe field`)
        }
        normalized[key] = normalizeBoundedPlanningValue(value[key], `${field}.${key}`, depth + 1)
        return normalized
    }, {})
}

const normalizeSourceRequirements = (value, label = 'sourceRequirements') => {
    if (!Array.isArray(value)) throw new BadRequestError(`${label} must be an array`)
    if (value.length > SOURCE_REQUIREMENTS.size) throw new BadRequestError(`${label} must contain at most ${SOURCE_REQUIREMENTS.size} items`)
    const normalized = [...new Set(value.map((item, index) => {
        const raw = assertSafePlanningText(item, { field: `${label}.${index}`, required: true, maxLength: 80 })
        const key = raw.replace(/[\s-]+/g, '_').toLowerCase()
        const compactKey = key.replace(/_/g, '')
        return SOURCE_REQUIREMENT_ALIASES[key] || SOURCE_REQUIREMENT_ALIASES[compactKey] || key
    }).filter(Boolean))]
    const invalid = normalized.find((item) => !SOURCE_REQUIREMENTS.has(item))
    if (invalid) throw new BadRequestError(`${label} contains unsupported source: ${invalid}`)
    return normalized
}

const validatePlanningInput = (payload = {}) => {
    assertPlainObject(payload)
    let serialized
    try { serialized = JSON.stringify(payload) } catch { throw new BadRequestError('payload must be JSON serializable') }
    if (Buffer.byteLength(serialized || '', 'utf8') > PLANNING_MAX_BYTES) throw new BadRequestError('payload is too large')
    const normalized = { ...payload }
    if (payload.mode !== undefined) {
        normalized.mode = assertSafePlanningText(payload.mode, { field: 'mode', required: true, maxLength: 40 }).toLowerCase()
        if (!MODES.has(normalized.mode)) throw new BadRequestError('mode is invalid')
    }
    if (payload.action !== undefined) {
        normalized.action = assertSafePlanningText(payload.action, { field: 'action', required: true, maxLength: 80 }).toLowerCase()
        if (!Object.values(ACTIONS).includes(normalized.action)) throw new BadRequestError('action is invalid')
    }
    for (const field of ['dryRun', 'draftOnly', 'includeCandidates', 'force', 'allowSkip']) {
        if (payload[field] !== undefined) strictBoolean(payload[field], field)
    }
    if (payload.targetBlogId && !isValidObjectId(payload.targetBlogId)) throw new BadRequestError('targetBlogId is invalid')
    if (payload.workOrderId && !isValidObjectId(payload.workOrderId)) throw new BadRequestError('workOrderId is invalid')
    if (payload.mergeSourceBlogIds !== undefined) {
        if (!Array.isArray(payload.mergeSourceBlogIds) || payload.mergeSourceBlogIds.length > 20 || payload.mergeSourceBlogIds.some((id) => !isValidObjectId(id))) {
            throw new BadRequestError('mergeSourceBlogIds must contain at most 20 valid IDs')
        }
        normalized.mergeSourceBlogIds = [...new Set(payload.mergeSourceBlogIds.map(String))]
    }
    for (const field of ['owner', 'reviewer']) {
        if (payload[field] && !isValidObjectId(payload[field])) throw new BadRequestError(`${field} is invalid`)
    }
    if (payload.targetBlogSlug !== undefined) {
        normalized.targetBlogSlug = assertSafePlanningText(payload.targetBlogSlug, { field: 'targetBlogSlug', required: true, maxLength: 240 })
        if (!/^[\p{L}\p{N}]+(?:[-_][\p{L}\p{N}]+)*$/u.test(normalized.targetBlogSlug)) throw new BadRequestError('targetBlogSlug is invalid')
    }
    if (payload.primaryBusinessGoal !== undefined) {
        normalized.primaryBusinessGoal = assertSafePlanningText(payload.primaryBusinessGoal, { field: 'primaryBusinessGoal', required: true, maxLength: 120 }).toLowerCase()
        if (!BUSINESS_GOALS.includes(normalized.primaryBusinessGoal)) throw new BadRequestError('primaryBusinessGoal is invalid')
    }
    if (payload.secondaryBusinessGoals !== undefined) {
        normalized.secondaryBusinessGoals = normalizeSafeStringArray(payload.secondaryBusinessGoals, 'secondaryBusinessGoals', { maxItems: 20, maxLength: 120 })
            .map((goal) => goal.toLowerCase())
        if (normalized.secondaryBusinessGoals.some((goal) => !BUSINESS_GOALS.includes(goal))) throw new BadRequestError('secondaryBusinessGoals contains an unsupported goal')
    }
    const stringLimits = {
        topic: 300,
        primaryKeyword: 200,
        funnelStage: 100,
        primarySearchIntent: 300,
        language: 10,
        articleType: 100,
        workingTitle: 300,
        primaryQuestion: 500,
        contentRole: 120,
        editorialAngle: 1000,
        overrideReason: 2000,
        structuredDataCandidate: 100
    }
    for (const [field, maxLength] of Object.entries(stringLimits)) {
        if (payload[field] !== undefined) normalized[field] = assertSafePlanningText(payload[field], { field, maxLength })
    }
    if (normalized.language !== undefined && !['vi', 'en'].includes(normalized.language.toLowerCase())) throw new BadRequestError('language is invalid')
    if (normalized.language !== undefined) normalized.language = normalized.language.toLowerCase()
    const stringArrayLimits = {
        targetAudience: [20, 300],
        secondarySearchIntents: [20, 300],
        userProblems: [20, 500],
        customerQuestions: [20, 500],
        secondaryKeywords: [50, 200],
        supportingQuestions: [30, 500],
        forbiddenClaims: [50, 1000],
        reviewRequirements: [20, 120],
        risks: [30, 500],
        primaryTerms: [20, 200],
        requiredEntities: [50, 200],
        contentGap: [30, 1000]
    }
    for (const [field, [maxItems, maxLength]] of Object.entries(stringArrayLimits)) {
        if (payload[field] !== undefined) normalized[field] = normalizeSafeStringArray(payload[field], field, { maxItems, maxLength })
    }
    for (const field of ['successMetrics', 'requiredFacts', 'requiredEvidence', 'imagePlanRequirements']) {
        if (payload[field] === undefined) continue
        if (!Array.isArray(payload[field]) || payload[field].length > 50 || (field === 'successMetrics' && payload[field].length === 0)) {
            throw new BadRequestError(`${field} must be ${field === 'successMetrics' ? 'a non-empty array' : 'an array'} of at most 50 items`)
        }
        normalized[field] = normalizeBoundedPlanningValue(payload[field], field)
    }
    for (const field of ['productIntegrationPolicy', 'productSeeding', 'productPlacement', 'ctaStrategy', 'editorialStyleConstraints']) {
        if (payload[field] !== undefined) {
            assertPlainObject(payload[field], field)
            normalized[field] = normalizeBoundedPlanningValue(payload[field], field)
        }
    }
    if (payload.targetPublishDate !== undefined) {
        const date = new Date(payload.targetPublishDate)
        if (Number.isNaN(date.getTime()) || date.getUTCFullYear() < 2000 || date.getUTCFullYear() > 2100) throw new BadRequestError('targetPublishDate is invalid')
        normalized.targetPublishDate = date.toISOString()
    }
    if (payload.sourceRequirements !== undefined) normalized.sourceRequirements = normalizeSourceRequirements(payload.sourceRequirements)
    if (payload.minimumOpportunityScore !== undefined) {
        const score = Number(payload.minimumOpportunityScore)
        if (!Number.isFinite(score) || score < 0 || score > 1) throw new BadRequestError('minimumOpportunityScore must be between 0 and 1')
        normalized.minimumOpportunityScore = score
    }
    if (normalized.mode === 'fixed_brief' && !normalized.topic && !normalized.primaryKeyword) {
        throw new BadRequestError('fixed_brief mode requires topic or primaryKeyword')
    }
    return normalized
}

const WORK_ORDER_ADMIN_TRANSITIONS = Object.freeze({
    planned: new Set(['approved', 'paused', 'cancelled']),
    approved: new Set(['brief_ready', 'paused', 'cancelled']),
    brief_ready: new Set(['paused', 'cancelled']),
    researching: new Set(['paused', 'blocked', 'cancelled']),
    drafting: new Set(['reviewing', 'paused', 'blocked']),
    reviewing: new Set(['completed', 'paused', 'blocked']),
    blocked: new Set(['planned', 'cancelled']),
    paused: new Set(['planned', 'cancelled']),
    completed: new Set(),
    cancelled: new Set()
})

const listPage = async ({ Model, filter = {}, sort = { createdAt: -1 }, query = {} }) => {
    const { page, limit } = safePagination(query)
    const [items, total] = await Promise.all([
        Model.find(filter).sort(sort).skip((page - 1) * limit).limit(limit).lean(),
        Model.countDocuments(filter)
    ])
    return { items: items.map(toView), pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } }
}

const defaultSchedule = (config = getContentOperationsConfig()) => ({
    singletonKey: 'default',
    name: 'Content Operations Daily Planning',
    enabled: false,
    timezone: config.timezone,
    scheduleType: 'daily',
    daily: { times: [config.dailyTime || '06:30'] },
    interval: { value: 24, unit: 'hours' },
    mode: 'best_action',
    topic: '',
    primaryKeyword: '',
    sourceRequirements: ['content_inventory'],
    minimumOpportunityScore: config.opportunitySkipThreshold,
    allowSkip: config.allowSkip,
    draftOnly: true,
    maximumTasksPerDay: config.maxActionsPerDay,
    monitoringWindows: config.monitoringWindows,
    nextRunAt: null
})

const normalizeSchedule = (payload = {}, current = defaultSchedule()) => {
    assertPlainObject(payload)
    const allowed = [
        'name', 'timezone', 'scheduleType', 'daily', 'interval', 'mode', 'sourceRequirements',
        'topic', 'primaryKeyword', 'minimumOpportunityScore', 'allowSkip', 'draftOnly',
        'maximumTasksPerDay', 'monitoringWindows'
    ]
    assertAllowedKeys(payload, allowed)
    const scheduleType = String(payload.scheduleType || current.scheduleType || 'daily')
    if (!['daily', 'interval'].includes(scheduleType)) throw new BadRequestError('scheduleType must be daily or interval')
    const mode = String(payload.mode || current.mode || 'best_action')
    if (!MODES.has(mode)) throw new BadRequestError('mode is invalid')
    const topic = assertSafePlanningText(payload.topic ?? current.topic ?? '', { field: 'topic', maxLength: 300 })
    const primaryKeyword = assertSafePlanningText(payload.primaryKeyword ?? current.primaryKeyword ?? '', { field: 'primaryKeyword', maxLength: 200 })
    if (mode === 'fixed_brief' && !topic && !primaryKeyword) throw new BadRequestError('fixed_brief mode requires topic or primaryKeyword')
    const timezone = String(payload.timezone || current.timezone || 'Asia/Ho_Chi_Minh')
    try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date()) } catch { throw new BadRequestError('timezone is invalid') }
    if (payload.daily !== undefined) assertPlainObject(payload.daily, 'daily')
    if (payload.daily?.times !== undefined && !Array.isArray(payload.daily.times)) throw new BadRequestError('daily.times must be an array')
    const dailyTimes = normalizeTimes(payload.daily?.times ?? current.daily?.times)
    if (scheduleType === 'daily' && !dailyTimes.length) throw new BadRequestError('daily.times requires at least one HH:mm value')
    if (payload.interval !== undefined) assertPlainObject(payload.interval, 'interval')
    const interval = { ...current.interval, ...(payload.interval || {}) }
    interval.value = Math.min(365, Math.max(1, Number.parseInt(interval.value, 10) || 24))
    interval.unit = String(interval.unit || 'hours')
    if (!['minutes', 'hours', 'days'].includes(interval.unit)) throw new BadRequestError('interval.unit is invalid')
    if (interval.unit === 'minutes' && interval.value < 5) throw new BadRequestError('interval must be at least 5 minutes')
    if (payload.monitoringWindows !== undefined && !Array.isArray(payload.monitoringWindows)) throw new BadRequestError('monitoringWindows must be an array')
    const monitoringWindows = [...new Set((payload.monitoringWindows ?? current.monitoringWindows ?? []).map(String))]
    if (monitoringWindows.some((window) => !['1d', '7d', '14d', '30d', '90d'].includes(window))) throw new BadRequestError('monitoringWindows contains an unsupported value')
    const sourceRequirements = normalizeSourceRequirements(payload.sourceRequirements ?? current.sourceRequirements ?? [])
    const minimumOpportunityScore = Number(payload.minimumOpportunityScore ?? current.minimumOpportunityScore ?? 0.65)
    if (!Number.isFinite(minimumOpportunityScore) || minimumOpportunityScore < 0 || minimumOpportunityScore > 1) throw new BadRequestError('minimumOpportunityScore must be between 0 and 1')
    const allowSkip = payload.allowSkip === undefined ? current.allowSkip !== false : strictBoolean(payload.allowSkip, 'allowSkip')
    if (payload.draftOnly !== undefined && payload.draftOnly !== true) throw new BadRequestError('Content Operations schedules must remain draft-only')
    const maximumTasksPerDay = Number(payload.maximumTasksPerDay ?? current.maximumTasksPerDay ?? 1)
    if (!Number.isInteger(maximumTasksPerDay) || maximumTasksPerDay < 1 || maximumTasksPerDay > 24) throw new BadRequestError('maximumTasksPerDay must be an integer between 1 and 24')
    return {
        name: assertSafePlanningText(payload.name || current.name || 'Content Operations Daily Planning', { field: 'name', required: true, maxLength: 160 }),
        timezone,
        scheduleType,
        daily: { times: dailyTimes },
        interval,
        mode,
        topic,
        primaryKeyword,
        sourceRequirements,
        minimumOpportunityScore,
        allowSkip,
        draftOnly: true,
        maximumTasksPerDay,
        monitoringWindows: monitoringWindows.length ? monitoringWindows : ['1d', '7d', '14d', '30d', '90d']
    }
}

const normalizeOpportunityTransitionPayload = (payload = {}) => {
    let serialized
    try { serialized = JSON.stringify(payload) } catch { throw new BadRequestError('payload must be JSON serializable') }
    if (Buffer.byteLength(serialized || '', 'utf8') > 32 * 1024) throw new BadRequestError('payload is too large')
    const normalized = { ...payload }
    for (const field of ['reason', 'overrideReason']) {
        if (payload[field] !== undefined) normalized[field] = assertSafePlanningText(payload[field], { field, maxLength: 2000 })
    }
    if (payload.primaryBusinessGoal !== undefined) {
        normalized.primaryBusinessGoal = assertSafePlanningText(payload.primaryBusinessGoal, {
            field: 'primaryBusinessGoal',
            required: true,
            maxLength: 120
        }).toLowerCase()
        if (!BUSINESS_GOALS.includes(normalized.primaryBusinessGoal)) throw new BadRequestError('primaryBusinessGoal is invalid')
    }
    if (payload.successMetrics !== undefined) {
        if (!Array.isArray(payload.successMetrics) || payload.successMetrics.length === 0 || payload.successMetrics.length > 50) {
            throw new BadRequestError('successMetrics must be a non-empty array of at most 50 items')
        }
        normalized.successMetrics = normalizeBoundedPlanningValue(payload.successMetrics, 'successMetrics')
    }
    for (const field of ['owner', 'reviewer']) {
        if (payload[field] && !isValidObjectId(payload[field])) throw new BadRequestError(`${field} is invalid`)
    }
    if (payload.targetPublishDate !== undefined) {
        const date = new Date(payload.targetPublishDate)
        if (Number.isNaN(date.getTime()) || date.getUTCFullYear() < 2000 || date.getUTCFullYear() > 2100) throw new BadRequestError('targetPublishDate is invalid')
        normalized.targetPublishDate = date.toISOString()
    }
    return normalized
}

const findCompleteBriefForWorkOrder = async (workOrderId) => {
    if (!workOrderId) return null
    const query = UnifiedContentBrief.findOne({
        contentWorkOrderId: workOrderId,
        status: 'complete',
        ...productionArtifactScopeFilter()
    })
    const brief = await (typeof query?.sort === 'function' ? query.sort({ version: -1 }) : query)
    return assertProductionArtifact(brief, 'Unified Content Brief')
}

const convertedArtifactsAreComplete = ({ workOrder, brief }) => {
    if (!workOrder) return false
    if (workOrder.decision === ACTIONS.SKIP) return true
    if (!brief) return false
    const artifactId = asObject(workOrder).artifactIds?.unifiedContentBriefId
    return String(artifactId || '') === String(brief._id || brief.id || '')
}

const ensureConvertedArtifacts = async ({ opportunity, payload, adminId }) => {
    assertProductionArtifact(opportunity, 'Opportunity')
    let workOrder = await ContentWorkOrder.findOne({
        contentOpportunityDecisionId: opportunity._id,
        ...productionArtifactScopeFilter()
    })
    assertProductionArtifact(workOrder, 'Content Work Order')
    let brief = await findCompleteBriefForWorkOrder(workOrder?._id || workOrder?.id)
    if (convertedArtifactsAreComplete({ workOrder, brief })) return { workOrder, brief }

    const snapshot = await ContentOperationsDailySnapshot.findOne({
        _id: opportunity.contentOperationsSnapshotId,
        ...productionArtifactScopeFilter()
    }).lean()
    if (!snapshot) throw new Error('CONTENT_OPPORTUNITY_SNAPSHOT_UNAVAILABLE')
    assertProductionArtifact(snapshot, 'Content Operations snapshot')
    const decision = asObject(opportunity)
    workOrder = workOrder || await ContentWorkOrderService.createFromDecision({
        decision,
        input: workOrderInputFor({
            decision,
            snapshot: { ...snapshot, id: String(snapshot._id) },
            input: payload,
            adminId
        })
    })
    if (workOrder.decision === ACTIONS.SKIP) return { workOrder, brief: null }

    brief = brief || await findCompleteBriefForWorkOrder(workOrder._id || workOrder.id)
    if (!brief) {
        const inventoryItems = snapshot.contentInventorySnapshotId
            ? await ContentInventoryItem.find({
                snapshotId: snapshot.contentInventorySnapshotId,
                ...productionArtifactScopeFilter()
            }).limit(1000).lean()
            : []
        brief = await UnifiedContentBriefService.create({
            workOrder: asObject(workOrder),
            input: briefInputFor({ workOrder: asObject(workOrder), decision, input: payload, inventoryItems })
        })
    }
    const attachedBriefId = asObject(workOrder).artifactIds?.unifiedContentBriefId
    if (String(attachedBriefId || '') !== String(brief._id || brief.id || '')) {
        const attached = await ContentWorkOrderService.attachArtifact({
            workOrderId: workOrder._id || workOrder.id,
            artifactType: 'unifiedContentBriefId',
            artifactId: brief._id || brief.id
        })
        if (attached) workOrder = attached
    }
    return { workOrder, brief }
}

class ContentOperationsAdminService {
    static async getStatus() {
        const config = getContentOperationsConfig()
        const [snapshot, run, schedule, openWorkOrders, activeSignals] = await Promise.all([
            ContentOperationsDailySnapshot.findOne(productionArtifactScopeFilter()).sort({ snapshotDate: -1 }).lean(),
            ContentOperationsRun.findOne(productionArtifactScopeFilter()).sort({ createdAt: -1 }).lean(),
            ContentOperationsSchedule.findOne({ singletonKey: 'default' }).lean(),
            ContentWorkOrder.countDocuments({
                status: { $nin: ['completed', 'cancelled'] },
                ...productionArtifactScopeFilter()
            }),
            ContentSignal.countDocuments({ status: { $in: ['new', 'reviewed'] }, expiresAt: { $gt: new Date() } })
        ])
        return {
            enabled: config.enabled,
            cronEnabled: config.cronEnabled,
            autoPublishEnabled: ['1', 'true', 'yes', 'on'].includes(String(process.env.SEO_AGENT_AUTO_PUBLISH || '').toLowerCase()),
            autoApplyLearningEnabled: config.learning.autoApply,
            timezone: config.timezone,
            actions: Object.values(ACTIONS),
            scoringWeights: config.opportunityWeights,
            sourceConfiguration: {
                searchConsole: Boolean(config.searchConsole.enabled && config.searchConsole.property),
                analytics: Boolean(config.aggregateAnalytics.enabled),
                trends: Boolean(config.trends.enabled),
                contentInventory: Boolean(config.inventory.enabled)
            },
            latestSnapshot: toView(snapshot),
            latestRun: toView(run),
            schedule: toView(schedule) || defaultSchedule(config),
            counts: { openWorkOrders, activeSignals }
        }
    }

    static async preview({ payload, adminId }) {
        assertPlainObject(payload || {})
        assertAllowedKeys(payload || {}, PLANNING_INPUT_KEYS)
        const normalized = validatePlanningInput(payload || {})
        const result = await new ContentOperationsPlanningService().preview({ input: { ...normalized, draftOnly: true }, adminId })
        return redactInternalOwnership(result)
    }

    static async runNow({ payload, adminId }) {
        assertPlainObject(payload || {})
        assertAllowedKeys(payload || {}, PLANNING_INPUT_KEYS)
        const normalized = validatePlanningInput(payload || {})
        const requestCorrelationId = crypto.randomUUID()
        await writeContentOperationsAudit({
            action: 'run_now_requested',
            actorAdminId: adminId,
            entityType: 'ContentOperationsRun',
            reason: 'Administrator requested a draft-only Content Operations planning run.',
            correlationId: requestCorrelationId
        })
        const result = await new ContentOperationsPlanningService().plan({ input: { ...normalized, draftOnly: true }, trigger: 'manual', adminId })
        await writeContentOperationsAudit({
            action: 'run_now', actorAdminId: adminId, entityType: 'ContentOperationsRun', entityId: result.runId,
            contentWorkOrderId: result.contentWorkOrderId || null, reason: 'Administrator requested a draft-only Content Operations planning run.', correlationId: result.correlationId
        }).catch(() => null)
        return redactInternalOwnership(result)
    }

    static async listSnapshots(query) {
        const result = await listPage({
            Model: ContentOperationsDailySnapshot,
            filter: { isQaTest: { $ne: true } },
            query,
            sort: { snapshotDate: -1 }
        })
        return { snapshots: result.items, pagination: result.pagination }
    }

    static async getSnapshot(snapshotId) {
        assertId(snapshotId, 'snapshotId')
        const snapshot = await ContentOperationsDailySnapshot.findOne({ _id: snapshotId, isQaTest: { $ne: true } }).lean()
        if (!snapshot) throw new NotFoundError('Content Operations snapshot not found')
        return { snapshot: toView(snapshot) }
    }

    static async listOpportunities(query = {}) {
        const filter = productionArtifactScopeFilter()
        if (query.status && ['candidate', 'selected', 'accepted', 'dismissed', 'converted'].includes(query.status)) filter.status = query.status
        if (query.action) filter.decisionType = query.action
        const result = await listPage({ Model: ContentOpportunityDecision, filter, query, sort: { createdAt: -1, totalScore: -1 } })
        return { opportunities: result.items, pagination: result.pagination }
    }

    static async getOpportunity(id) {
        assertId(id)
        const opportunity = await ContentOpportunityDecision.findById(id).lean()
        if (!opportunity) throw new NotFoundError('Opportunity not found')
        assertProductionArtifact(opportunity, 'Opportunity')
        return { opportunity: toView(opportunity) }
    }

    static async transitionOpportunity({ id, operation, payload = {}, adminId, ip }) {
        assertId(id)
        assertPlainObject(payload)
        assertAllowedKeys(payload, ['reason', 'overrideReason', 'primaryBusinessGoal', 'successMetrics', 'owner', 'reviewer', 'targetPublishDate'])
        if (!['accept', 'dismiss', 'convert'].includes(operation)) throw new BadRequestError('Opportunity operation is invalid')
        const normalizedPayload = normalizeOpportunityTransitionPayload(payload)
        const opportunity = await ContentOpportunityDecision.findById(id)
        if (!opportunity) throw new NotFoundError('Opportunity not found')
        assertProductionArtifact(opportunity, 'Opportunity')
        const previousStatus = opportunity.status
        const reason = String(normalizedPayload.reason || normalizedPayload.overrideReason || '').trim()
        if (operation === 'dismiss' && reason.length < 8) throw new BadRequestError('A dismissal reason of at least 8 characters is required')
        const allowedFrom = {
            accept: new Set(['candidate', 'selected']),
            dismiss: new Set(['candidate', 'selected', 'accepted']),
            convert: new Set(['candidate', 'selected', 'accepted'])
        }
        const targetStatus = operation === 'accept' ? 'accepted' : operation === 'dismiss' ? 'dismissed' : 'converted'
        const idempotentConvert = operation === 'convert' && previousStatus === targetStatus
        if (previousStatus === targetStatus && !idempotentConvert) {
            const workOrder = await ContentWorkOrder.findOne({
                contentOpportunityDecisionId: opportunity._id,
                ...productionArtifactScopeFilter()
            })
            assertProductionArtifact(workOrder, 'Content Work Order')
            const brief = await findCompleteBriefForWorkOrder(workOrder?._id || workOrder?.id)
            return { opportunity: toView(opportunity), workOrder: toView(workOrder), brief: toView(brief) }
        }
        if (!idempotentConvert && !allowedFrom[operation].has(previousStatus)) throw new BadRequestError(`Opportunity cannot transition from ${previousStatus} to ${targetStatus}`)

        let workOrder = null
        let brief = null
        if (idempotentConvert) {
            workOrder = await ContentWorkOrder.findOne({
                contentOpportunityDecisionId: opportunity._id,
                ...productionArtifactScopeFilter()
            })
            assertProductionArtifact(workOrder, 'Content Work Order')
            brief = await findCompleteBriefForWorkOrder(workOrder?._id || workOrder?.id)
            if (convertedArtifactsAreComplete({ workOrder, brief })) {
                return { opportunity: toView(opportunity), workOrder: toView(workOrder), brief: toView(brief) }
            }
        }

        const correlationId = crypto.randomUUID()
        await writeContentOperationsAudit({
            action: idempotentConvert ? 'opportunity_convert_repair_requested' : `opportunity_${operation}_requested`,
            actorAdminId: adminId,
            entityType: 'ContentOpportunityDecision',
            entityId: opportunity._id,
            contentWorkOrderId: workOrder?._id || null,
            reason: reason || `Administrator requested to ${operation} the scored opportunity.`,
            metadata: { previousStatus, targetStatus },
            correlationId,
            ip
        })

        let transitioned = opportunity
        if (!idempotentConvert) {
            transitioned = await ContentOpportunityDecision.findOneAndUpdate(
                {
                    _id: opportunity._id,
                    status: previousStatus,
                    ...productionArtifactScopeFilter()
                },
                { $set: { status: targetStatus } },
                { new: true, runValidators: true }
            )
            if (!transitioned) {
                const latest = await ContentOpportunityDecision.findById(opportunity._id)
                assertProductionArtifact(latest, 'Opportunity')
                if (operation === 'convert' && latest?.status === 'converted') transitioned = latest
                else throw new BadRequestError('Opportunity status changed concurrently; retry with current data')
            }
        }

        if (operation === 'convert') {
            try {
                ({ workOrder, brief } = await ensureConvertedArtifacts({
                    opportunity: transitioned,
                    payload: { ...normalizedPayload, overrideReason: reason },
                    adminId
                }))
            } catch (_error) {
                // Keep the CAS-owned converted state. Rolling it back can race with a
                // concurrent idempotent repair and strand valid artifacts on a dismissed
                // or selected decision; runWorkOrder rejects an incomplete chain.
                await writeContentOperationsAudit({
                    action: 'opportunity_convert_artifact_incomplete',
                    actorAdminId: adminId,
                    entityType: 'ContentOpportunityDecision',
                    entityId: opportunity._id,
                    contentWorkOrderId: workOrder?._id || null,
                    reason: 'The converted opportunity is retained for an idempotent Work Order or Unified Brief repair.',
                    metadata: { previousStatus, statusRetained: 'converted', errorCode: 'CONTENT_OPPORTUNITY_ARTIFACT_BUILD_FAILED' },
                    correlationId,
                    ip
                }).catch(() => null)
                const failure = new BadRequestError('Unable to build a complete Content Work Order and Unified Brief')
                failure.code = 'CONTENT_OPPORTUNITY_ARTIFACT_BUILD_FAILED'
                throw failure
            }
            const signalIds = (transitioned.positiveEvidence || [])
                .filter((item) => String(item?.source || '').startsWith('content_signal:') && item.signalId)
                .map((item) => String(item.signalId))
            await Promise.allSettled(signalIds.map((signalId) => new ContentSignalService().markUsed({ signalId, workOrderId: workOrder._id })))
        }
        await writeContentOperationsAudit({
            action: idempotentConvert ? 'opportunity_convert_repaired' : `opportunity_${operation}`,
            actorAdminId: adminId,
            entityType: 'ContentOpportunityDecision',
            entityId: transitioned._id,
            contentWorkOrderId: workOrder?._id || null,
            reason: reason || `Administrator ${operation}ed the scored opportunity.`,
            metadata: idempotentConvert ? { previousStatus, repaired: true } : { previousStatus },
            correlationId,
            ip
        }).catch(() => null)
        return { opportunity: toView(transitioned), workOrder: toView(workOrder), brief: toView(brief) }
    }

    static async listWorkOrders(query = {}) {
        const filter = productionArtifactScopeFilter()
        if (query.status && WORK_ORDER_STATUSES.includes(query.status)) filter.status = query.status
        const result = await listPage({ Model: ContentWorkOrder, filter, query, sort: { createdAt: -1 } })
        return { workOrders: result.items, pagination: result.pagination }
    }

    static async createWorkOrder({ payload = {}, adminId, ip }) {
        assertPlainObject(payload)
        assertAllowedKeys(payload, ['opportunityId', 'reason', 'overrideReason', 'primaryBusinessGoal', 'successMetrics', 'owner', 'reviewer', 'targetPublishDate'])
        if (!payload.opportunityId) throw new BadRequestError('opportunityId is required')
        const { opportunityId, ...transitionPayload } = payload
        return ContentOperationsAdminService.transitionOpportunity({
            id: opportunityId,
            operation: 'convert',
            payload: { ...transitionPayload, reason: payload.reason || 'Administrator converted the opportunity into a Work Order.' },
            adminId,
            ip
        })
    }

    static async getWorkOrder(id) {
        assertId(id)
        const [workOrder, brief] = await Promise.all([
            ContentWorkOrder.findById(id).lean(),
            UnifiedContentBrief.findOne({
                contentWorkOrderId: id,
                status: 'complete',
                ...productionArtifactScopeFilter()
            }).sort({ version: -1 }).lean()
        ])
        if (!workOrder) throw new NotFoundError('Content Work Order not found')
        assertProductionArtifact(workOrder, 'Content Work Order')
        assertProductionArtifact(brief, 'Unified Content Brief')
        return { workOrder: toView(workOrder), brief: toView(brief) }
    }

    static async updateWorkOrder({ id, payload = {}, adminId, ip, allowApproval = false }) {
        assertId(id)
        assertPlainObject(payload)
        const allowed = ['status', 'priority', 'topic', 'topicLocked', 'owner', 'reviewer', 'targetPublishDate', 'overrideReason', 'warnings']
        assertAllowedKeys(payload, allowed)
        const normalizedPayload = { ...payload }
        if (payload.status !== undefined) normalizedPayload.status = assertSafePlanningText(payload.status, { field: 'status', required: true, maxLength: 40 }).toLowerCase()
        if (normalizedPayload.status && !WORK_ORDER_STATUSES.includes(normalizedPayload.status)) throw new BadRequestError('Work Order status is invalid')
        if (normalizedPayload.status === 'approved' && !allowApproval) throw new BadRequestError('Use the approval endpoint to approve a Work Order')
        if (payload.priority !== undefined) normalizedPayload.priority = assertSafePlanningText(payload.priority, { field: 'priority', required: true, maxLength: 20 }).toLowerCase()
        if (normalizedPayload.priority && !['low', 'medium', 'high', 'critical'].includes(normalizedPayload.priority)) throw new BadRequestError('Work Order priority is invalid')
        if (payload.topic !== undefined) normalizedPayload.topic = assertSafePlanningText(payload.topic, { field: 'topic', required: true, maxLength: 300 })
        if (payload.topicLocked !== undefined && typeof payload.topicLocked !== 'boolean') throw new BadRequestError('topicLocked must be a boolean')
        if (payload.owner && !isValidObjectId(payload.owner)) throw new BadRequestError('owner is invalid')
        if (payload.reviewer && !isValidObjectId(payload.reviewer)) throw new BadRequestError('reviewer is invalid')
        if (payload.targetPublishDate !== undefined) {
            const date = new Date(payload.targetPublishDate)
            if (Number.isNaN(date.getTime()) || date.getUTCFullYear() < 2000 || date.getUTCFullYear() > 2100) throw new BadRequestError('targetPublishDate is invalid')
            normalizedPayload.targetPublishDate = date.toISOString()
        }
        if (payload.warnings !== undefined) normalizedPayload.warnings = normalizeSafeStringArray(payload.warnings, 'warnings', { maxItems: 50, maxLength: 300 })
        if (payload.overrideReason !== undefined) {
            normalizedPayload.overrideReason = assertSafePlanningText(payload.overrideReason, { field: 'overrideReason', required: true, maxLength: 2000 })
            if (normalizedPayload.overrideReason.length < 8) throw new BadRequestError('overrideReason must be at least 8 characters')
        }
        const current = await ContentWorkOrder.findById(id).lean()
        if (!current) throw new NotFoundError('Content Work Order not found')
        assertProductionArtifact(current, 'Content Work Order')
        if (current.topicLocked && normalizedPayload.topic !== undefined && normalizedPayload.topic !== current.topic && normalizedPayload.topicLocked !== false) {
            throw new BadRequestError('Unlock the topic before changing it')
        }
        if ((normalizedPayload.topicLocked !== undefined || normalizedPayload.priority !== undefined || normalizedPayload.topic !== undefined) && String(normalizedPayload.overrideReason || '').length < 8) {
            throw new BadRequestError('overrideReason is required for topic or priority changes')
        }
        if (normalizedPayload.status && normalizedPayload.status !== current.status) {
            if (!WORK_ORDER_ADMIN_TRANSITIONS[current.status]?.has(normalizedPayload.status)) throw new BadRequestError(`Work Order cannot transition from ${current.status} to ${normalizedPayload.status}`)
            if (['blocked', 'paused'].includes(current.status) && normalizedPayload.status === 'planned' && String(normalizedPayload.overrideReason || '').length < 8) {
                throw new BadRequestError('overrideReason is required to reopen a Work Order')
            }
        }
        const correlationId = crypto.randomUUID()
        const changes = Object.keys(normalizedPayload).map((field) => ({ field, before: current[field] ?? null, after: normalizedPayload[field] ?? null }))
        await writeContentOperationsAudit({
            action: 'work_order_update_requested',
            actorAdminId: adminId,
            entityType: 'ContentWorkOrder',
            entityId: current._id,
            contentWorkOrderId: current._id,
            reason: String(normalizedPayload.overrideReason || 'Administrator requested an update to approved Work Order fields.'),
            changes,
            correlationId,
            ip
        })
        const workOrder = await ContentWorkOrder.findOneAndUpdate(
            { _id: id, status: current.status, ...productionArtifactScopeFilter() },
            { $set: normalizedPayload },
            { new: true, runValidators: true }
        )
        if (!workOrder) throw new BadRequestError('Work Order changed concurrently; retry with current data')
        await writeContentOperationsAudit({
            action: 'work_order_updated', actorAdminId: adminId, entityType: 'ContentWorkOrder', entityId: workOrder._id,
            contentWorkOrderId: workOrder._id, reason: String(normalizedPayload.overrideReason || 'Administrator updated approved Work Order fields.'),
            changes, correlationId, ip
        }).catch(() => null)
        return { workOrder: toView(workOrder) }
    }

    static async approveWorkOrder({ id, payload = {}, adminId, ip }) {
        assertPlainObject(payload)
        assertAllowedKeys(payload, ['overrideReason'])
        return ContentOperationsAdminService.updateWorkOrder({
            id,
            payload: { status: 'approved', ...(payload.overrideReason ? { overrideReason: payload.overrideReason } : {}) },
            adminId,
            ip,
            allowApproval: true
        })
    }

    static async runWorkOrder({ id, payload = {}, adminId, ip }) {
        assertId(id, 'workOrderId')
        assertPlainObject(payload)
        assertAllowedKeys(payload, ['draftOnly', 'workOrderId'])
        if (payload.workOrderId !== undefined) {
            assertId(payload.workOrderId, 'payload.workOrderId')
            if (String(payload.workOrderId) !== String(id)) throw new BadRequestError('Selected Work Order does not match the route')
        }
        if (payload.draftOnly === false) throw new BadRequestError('Content Operations Work Orders are draft-only')
        if (!getContentOperationsConfig().enabled) throw new BadRequestError('Content Operations is disabled')
        const [workOrder, brief] = await Promise.all([
            ContentWorkOrder.findById(id).lean(),
            UnifiedContentBrief.findOne({
                contentWorkOrderId: id,
                status: 'complete',
                ...productionArtifactScopeFilter()
            }).sort({ version: -1 }).lean()
        ])
        if (!workOrder || !brief) throw new NotFoundError('Runnable Work Order and complete Unified Brief were not found')
        assertProductionArtifact(workOrder, 'Content Work Order')
        assertProductionArtifact(brief, 'Unified Content Brief')
        if (!isWorkOrderRunnable(workOrder) || workOrder.decision === 'skip') throw new BadRequestError('Work Order is not runnable')
        const opportunity = await ContentOpportunityDecision.findById(workOrder.contentOpportunityDecisionId).lean()
        assertProductionArtifact(opportunity, 'Opportunity')
        const opportunityIdMatches = String(opportunity?._id || '') === String(workOrder.contentOpportunityDecisionId || '')
        const workOrderIdMatches = String(brief.contentWorkOrderId || '') === String(workOrder._id || '')
        const snapshotIdMatches = String(opportunity?.contentOperationsSnapshotId || '') === String(workOrder.contentOperationsSnapshotId || '')
        const actionMatches = String(opportunity?.recommendedAction || opportunity?.decisionType || '') === String(workOrder.decision || '')
        if (!opportunity || opportunity.status !== 'converted' || !opportunityIdMatches || !workOrderIdMatches || !snapshotIdMatches || !actionMatches) {
            throw new BadRequestError('Work Order is not linked to a converted opportunity')
        }
        const runCorrelationId = crypto.randomUUID()
        await writeContentOperationsAudit({
            action: 'work_order_run_requested',
            actorAdminId: adminId,
            entityType: 'ContentWorkOrder',
            entityId: workOrder._id,
            contentWorkOrderId: workOrder._id,
            reason: 'Administrator requested a draft-only Work Order execution.',
            correlationId: runCorrelationId,
            ip
        })
        const execution = await BlogAutomationExecution.create({
            scheduleId: null,
            executionKey: `content-work-order:${id}:${crypto.randomUUID()}`,
            status: 'running',
            startedAt: new Date(),
            googleIntelSnapshotId: workOrder.googleIntelSnapshotId,
            contentOperationsSnapshotId: workOrder.contentOperationsSnapshotId,
            contentOpportunityDecisionId: workOrder.contentOpportunityDecisionId,
            contentWorkOrderId: workOrder._id,
            unifiedContentBriefId: brief._id,
            contentAction: workOrder.decision,
            correlationId: runCorrelationId,
            metadata: { trigger: 'admin_work_order', draftOnly: true, actorAdminId: String(adminId) }
        })
        try {
            const pipeline = await AgenticBlogCoreService.runPipeline({
                schedule: {
                    name: workOrder.topic,
                    mode: 'fixed_brief',
                    draftOnly: true,
                    autoPublish: false,
                    agentConfig: {
                        topic: brief.topic,
                        primaryKeyword: brief.primaryTerms?.[0] || brief.topic,
                        secondaryKeywords: brief.relatedTerms || [],
                        articleType: brief.articleType,
                        language: brief.language || 'vi',
                        categoryKey: 'guide',
                        workOrderId: String(workOrder._id),
                        contentAction: workOrder.decision,
                        targetBlogId: workOrder.targetBlogId ? String(workOrder.targetBlogId) : '',
                        mergeSourceBlogIds: (workOrder.mergeSourceBlogIds || []).map(String),
                        productSeeding: { mode: brief.productIntegration?.mode || 'auto' },
                        productPlacement: brief.productPlacementConstraints || {}
                    }
                },
                executionKey: execution.executionKey,
                executionId: execution._id,
                now: new Date()
            })
            if (pipeline.skipped) {
                const error = new BadRequestError(pipeline.reason || 'Work Order was skipped by the current safety gate')
                error.code = 'CONTENT_WORK_ORDER_NOT_RUNNABLE'
                throw error
            }
            if (pipeline.maintenance) {
                await writeContentOperationsAudit({
                    action: 'work_order_maintenance_staged', actorAdminId: adminId, entityType: 'ContentWorkOrder',
                    entityId: workOrder._id, contentWorkOrderId: workOrder._id,
                    reason: 'Administrator ran a scoped maintenance Work Order; a non-destructive revision was staged.',
                    correlationId: execution.correlationId, ip
                })
                return { executionId: String(execution._id), workOrder: toView(await ContentWorkOrder.findById(id).lean()), result: pipeline.result }
            }
            const context = pipeline.context
            await Promise.all([
                ProductSeedPlanningService.attachExecution({ planId: context.productSeedPlan?._id, executionId: execution._id }),
                EditorialProductPlacementPlanningService.attachRelations({
                    planId: context.editorialPlacementPlan?._id,
                    executionId: execution._id,
                    strategyPlanId: context.strategy?._id
                }),
                BlogAutomationExecution.updateOne({ _id: execution._id }, {
                    $set: {
                        contentInventorySnapshotId: pipeline.payload.contentInventorySnapshotId || null,
                        evidenceMapId: pipeline.payload.evidenceMapId || null,
                        researchBundleId: pipeline.payload.researchBundleId,
                        editorialStyleProfileId: pipeline.payload.editorialStyleProfileId,
                        strategyPlanId: pipeline.payload.strategyPlanId,
                        productCatalogSnapshotId: pipeline.payload.productCatalogSnapshotId || null,
                        productSeedPlanId: pipeline.payload.productSeedPlanId || null,
                        editorialProductPlacementPlanId: pipeline.payload.editorialProductPlacementPlanId || null,
                        productSeedingMode: pipeline.payload.productSeedingMode || 'off',
                        productSeedingDecision: pipeline.payload.productSeedingDecision || '',
                        seededProductIds: pipeline.payload.seededProductIds || [],
                        productSeedingReview: pipeline.payload.productSeedingReview || null,
                        productClaimReview: pipeline.payload.productClaimReview || null,
                        editorialProductPlacementReview: pipeline.payload.editorialProductPlacementReview || null,
                        opportunityCandidates: context.contentPlanning?.candidates || [],
                        sourceHealth: context.contentPlanning?.sourceHealth || {},
                        sourceFreshness: context.contentPlanning?.sourceFreshness || {},
                        reviewerDecisions: pipeline.reviews,
                        agentSteps: ['google-intelligence-gate', 'daily-content-snapshot', 'opportunity-decision', 'content-work-order', 'unified-content-brief', 'product-planning', 'research', 'evidence-map', 'writer', 'reviewers', 'publish-readiness']
                    }
                })
            ])
            const result = await AutomationSeoBlogService.publishSeoBlog({ payload: pipeline.payload })
            await writeContentOperationsAudit({
                action: result.revisionStaged ? 'work_order_revision_staged' : 'work_order_draft_created',
                actorAdminId: adminId, entityType: 'ContentWorkOrder', entityId: workOrder._id,
                contentWorkOrderId: workOrder._id,
                reason: result.revisionStaged
                    ? 'Administrator ran the Work Order; the proposed revision was staged without changing live content.'
                    : 'Administrator ran the Work Order in draft-only mode.',
                correlationId: execution.correlationId, ip
            })
            return { executionId: String(execution._id), workOrder: toView(await ContentWorkOrder.findById(id).lean()), result }
        } catch (error) {
            const errorCode = safeErrorCode({ code: error?.code || 'WORK_ORDER_RUN_FAILED' })
            try {
                const [latestExecution, latestWorkOrder] = await Promise.all([
                    BlogAutomationExecution.findById(execution._id).lean(),
                    ContentWorkOrder.findById(id).lean()
                ])
                const executionClaimToken = getExecutionClaimToken(latestExecution)
                const activeClaimToken = getActiveClaimToken(latestWorkOrder)
                const activeExecutionMatches = String(latestWorkOrder?.metadata?.activeExecutionId || '') === String(execution._id)
                const claimToken = executionClaimToken || (activeExecutionMatches ? activeClaimToken : '')
                const shouldBlockWorkOrder = error?.code !== 'CONTENT_WORK_ORDER_NOT_RUNNABLE'
                const warnings = [...new Set([...(latestWorkOrder?.warnings || workOrder.warnings || []), errorCode])]

                if (claimToken) {
                    await ContentWorkOrderService.transitionClaimed({
                        workOrderId: id,
                        claimToken,
                        status: 'blocked',
                        updates: { warnings }
                    })
                    // The execution has its own owner-CAS. Terminalize this worker's
                    // execution even when a newer worker has already replaced the
                    // Work Order claim; this cannot mutate the replacement claim.
                    await ContentWorkOrderService.transitionExecutionClaimed({
                        executionId: execution._id,
                        workOrderId: id,
                        claimToken,
                        status: 'failed',
                        updates: { error: errorCode }
                    })
                } else {
                    if (shouldBlockWorkOrder) {
                        await ContentWorkOrderService.transitionUnclaimed({
                            workOrderId: id,
                            status: 'blocked',
                            fromStatuses: ['planned', 'approved', 'brief_ready', 'drafting'],
                            updates: { warnings }
                        })
                    }
                    await ContentWorkOrderService.transitionExecutionUnclaimed({
                        executionId: execution._id,
                        status: 'failed',
                        updates: { error: errorCode }
                    })
                }
            } catch {
                // Preserve the original bounded pipeline error; ownership cleanup is best effort and fail-closed.
            }
            await writeContentOperationsAudit({
                action: 'work_order_run_failed',
                actorAdminId: adminId,
                entityType: 'ContentWorkOrder',
                entityId: workOrder._id,
                contentWorkOrderId: workOrder._id,
                reason: 'Work Order execution failed with a bounded internal error code.',
                correlationId: execution.correlationId,
                metadata: { errorCode },
                ip
            }).catch(() => null)
            throw error
        }
    }

    static async listSignals(query = {}) {
        const filter = { expiresAt: { $gt: new Date() } }
        if (query.status === 'active') filter.status = { $in: ['new', 'reviewed'] }
        else if (query.status) filter.status = query.status
        if (query.sourceType) filter.sourceType = query.sourceType
        const result = await listPage({ Model: ContentSignal, filter, query, sort: { priority: -1, createdAt: -1 } })
        return { signals: result.items, pagination: result.pagination }
    }

    static async createSignal({ payload, adminId, ip }) {
        const correlationId = crypto.randomUUID()
        await writeContentOperationsAudit({
            action: 'signal_create_requested', actorAdminId: adminId, entityType: 'ContentSignal',
            reason: 'Administrator requested a bounded cross-department signal.', correlationId, ip
        })
        const signal = await new ContentSignalService().createSignal({ payload, adminId })
        await writeContentOperationsAudit({
            action: 'signal_created', actorAdminId: adminId, entityType: 'ContentSignal', entityId: signal.id,
            reason: 'Administrator added a bounded cross-department signal for editorial review.', correlationId, ip
        }).catch(() => null)
        return { signal }
    }

    static async updateSignal({ id, payload, adminId, ip }) {
        assertId(id, 'signalId')
        const service = new ContentSignalService()
        const status = payload?.status
        const content = { ...(payload || {}) }
        delete content.status
        const correlationId = crypto.randomUUID()
        await writeContentOperationsAudit({
            action: 'signal_update_requested', actorAdminId: adminId, entityType: 'ContentSignal', entityId: id,
            reason: 'Administrator requested an update to a cross-department signal.',
            changes: Object.keys(payload || {}).map((field) => ({ field })), correlationId, ip
        })
        let signal = status
            ? await service.updateSignalWithStatus({ signalId: id, payload: content, status })
            : Object.keys(content).length ? await service.updateSignal({ signalId: id, payload: content }) : null
        if (!signal) throw new BadRequestError('No signal changes supplied')
        await writeContentOperationsAudit({
            action: 'signal_updated', actorAdminId: adminId, entityType: 'ContentSignal', entityId: id,
            reason: 'Administrator updated a cross-department signal.', changes: Object.keys(payload || {}).map((field) => ({ field })), correlationId, ip
        }).catch(() => null)
        return { signal }
    }

    static async getInventory(query = {}) {
        const { page, limit } = safePagination(query)
        const snapshot = query.snapshotId
            ? await ContentInventorySnapshot.findOne({
                _id: assertId(query.snapshotId, 'snapshotId'),
                isQaTest: { $ne: true }
            }).lean()
            : await ContentInventorySnapshot.findOne({ isQaTest: { $ne: true } }).sort({ snapshotDate: -1 }).lean()
        if (!snapshot) return { snapshot: null, items: [], pagination: { page, limit, total: 0, pages: 1 } }
        const [items, total] = await Promise.all([
            ContentInventoryItem.find({ snapshotId: snapshot._id }).sort({ reviewStatus: -1, articleUpdatedAt: 1 }).skip((page - 1) * limit).limit(limit).lean(),
            ContentInventoryItem.countDocuments({ snapshotId: snapshot._id })
        ])
        return { snapshot: toView(snapshot), items: items.map(toView), summary: snapshot.summary || {}, pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } }
    }

    static async rebuildInventory({ adminId, ip }) {
        const correlationId = crypto.randomUUID()
        await writeContentOperationsAudit({
            action: 'inventory_rebuild_requested', actorAdminId: adminId, entityType: 'ContentInventorySnapshot',
            reason: 'Administrator requested a deterministic content inventory rebuild.', correlationId, ip
        })
        const result = await new ContentInventoryService().ensureSnapshotForDate({ force: true })
        await writeContentOperationsAudit({
            action: 'inventory_rebuilt', actorAdminId: adminId, entityType: 'ContentInventorySnapshot', entityId: result.snapshot._id || result.snapshot.id,
            reason: 'Administrator requested a deterministic content inventory rebuild.', correlationId, ip
        }).catch(() => null)
        return ContentOperationsAdminService.getInventory({ page: 1, limit: 24, snapshotId: result.snapshot._id || result.snapshot.id })
    }

    static async getPerformance(blogId) {
        assertId(blogId, 'blogId')
        const blogPost = await blog.findById(blogId)
            .select('blog_title blog_slug isQaTest qaBatchId qaCaseId environment executionMode originalTopicSeed normalizedTopicKey')
            .lean()
        if (!blogPost) throw new NotFoundError('Blog not found')
        assertProductionArtifact(blogPost, 'Blog')
        const [tasks, snapshots, verification, alerts] = await Promise.all([
            ContentMonitoringTask.find({ blogId }).sort({ dueAt: 1 }).lean(),
            ContentPerformanceSnapshot.find({ blogId }).sort({ measuredAt: -1 }).limit(100).lean(),
            PostPublishVerification.findOne({ blogId }).sort({ checkedAt: -1 }).lean(),
            ContentMaintenanceAlert.find({ blogId, status: { $in: ['open', 'acknowledged'] } }).sort({ detectedAt: -1 }).limit(50).lean()
        ])
        const windows = snapshots.map((snapshot) => ({
            ...toView(snapshot),
            searchConsole: { ...(snapshot.searchConsole || {}), position: snapshot.searchConsole?.averagePosition ?? null },
            analytics: { ...(snapshot.analytics || {}), productClicks: snapshot.analytics?.productLinkClicks ?? null }
        }))
        const nextPending = tasks.find((task) => ['pending', 'running', 'failed'].includes(task.status))
        return {
            blogId,
            blogTitle: blogPost?.blog_title || '',
            technicalVerification: verification ? {
                id: String(verification._id), status: verification.status, verified: verification.pass,
                checkedAt: verification.checkedAt, ...(verification.checks || {})
            } : null,
            windows,
            performanceWindows: windows,
            maintenanceTasks: alerts.map(toView),
            tasks: tasks.map(toView),
            snapshots: windows,
            lastReviewedAt: snapshots[0]?.measuredAt || verification?.checkedAt || null,
            nextReviewAt: nextPending?.dueAt || null
        }
    }

    static async getLearning(blogId) {
        assertId(blogId, 'blogId')
        const blogPost = await blog.findById(blogId)
            .select('blog_title isQaTest qaBatchId qaCaseId environment executionMode originalTopicSeed normalizedTopicKey')
            .lean()
        if (!blogPost) throw new NotFoundError('Blog not found')
        assertProductionArtifact(blogPost, 'Blog')
        const [records, alerts] = await Promise.all([
            ContentLearningRecord.find({ blogId }).sort({ createdAt: -1 }).limit(100).lean(),
            ContentMaintenanceAlert.find({ blogId, status: { $in: ['open', 'acknowledged'] } }).sort({ detectedAt: -1 }).limit(50).lean()
        ])
        const latest = records[0] || null
        return {
            blogId,
            blogTitle: blogPost?.blog_title || '',
            records: records.map(toView),
            recommendation: latest ? toView(latest) : null,
            maintenanceTasks: alerts.map(toView),
            lastReviewedAt: latest?.createdAt || null,
            autoApply: false
        }
    }

    static async getSchedule() {
        const schedule = await ContentOperationsSchedule.findOne({ singletonKey: 'default' }).lean()
        return { schedule: toView(schedule) || defaultSchedule() }
    }

    static async updateSchedule({ payload, adminId, ip }) {
        const current = await ContentOperationsSchedule.findOne({ singletonKey: 'default' }).lean() || defaultSchedule()
        const normalized = normalizeSchedule(payload, current)
        const enabled = Boolean(current.enabled)
        const nextRunAt = enabled ? calculateNextRun({ schedule: { ...normalized, enabled }, from: new Date() }) : null
        const correlationId = crypto.randomUUID()
        const changes = Object.keys(payload).map((field) => ({ field }))
        await writeContentOperationsAudit({
            action: 'schedule_update_requested',
            actorAdminId: adminId,
            entityType: 'ContentOperationsSchedule',
            entityId: current._id || null,
            reason: 'Administrator requested an update to the draft-only Content Operations planning schedule.',
            changes,
            correlationId,
            ip
        })
        const schedule = await ContentOperationsSchedule.findOneAndUpdate(
            { singletonKey: 'default' },
            { $set: { ...normalized, enabled, nextRunAt, updatedBy: adminId }, $setOnInsert: { singletonKey: 'default', createdBy: adminId } },
            { upsert: true, new: true, runValidators: true }
        )
        await writeContentOperationsAudit({
            action: 'schedule_updated', actorAdminId: adminId, entityType: 'ContentOperationsSchedule', entityId: schedule._id,
            reason: 'Administrator updated the draft-only Content Operations planning schedule.', changes, correlationId, ip
        }).catch(() => null)
        return { schedule: toView(schedule) }
    }

    static async toggleSchedule({ enabled, adminId, ip }) {
        const config = getContentOperationsConfig()
        if (enabled && !config.enabled) throw new BadRequestError('CONTENT_OPERATIONS_ENABLED must be true before enabling the schedule')
        if (enabled && !config.cronEnabled) {
            throw new BadRequestError('CONTENT_OPERATIONS_CRON_ENABLED must be true before enabling the schedule')
        }
        const current = await ContentOperationsSchedule.findOne({ singletonKey: 'default' }).lean() || defaultSchedule(config)
        const normalized = normalizeSchedule({}, current)
        const nextRunAt = enabled ? calculateNextRun({ schedule: { ...normalized, enabled: true }, from: new Date() }) : null
        const correlationId = crypto.randomUUID()
        await writeContentOperationsAudit({
            action: enabled ? 'schedule_enable_requested' : 'schedule_disable_requested',
            actorAdminId: adminId,
            entityType: 'ContentOperationsSchedule',
            entityId: current._id || null,
            reason: `Administrator requested to ${enabled ? 'enable' : 'disable'} the draft-only planning schedule.`,
            correlationId,
            ip
        })
        const schedule = await ContentOperationsSchedule.findOneAndUpdate(
            { singletonKey: 'default' },
            { $set: { ...normalized, enabled, nextRunAt, updatedBy: adminId }, $setOnInsert: { singletonKey: 'default', createdBy: adminId } },
            { upsert: true, new: true, runValidators: true }
        )
        await writeContentOperationsAudit({
            action: enabled ? 'schedule_enabled' : 'schedule_disabled', actorAdminId: adminId,
            entityType: 'ContentOperationsSchedule', entityId: schedule._id,
            reason: `Administrator ${enabled ? 'enabled' : 'disabled'} the draft-only planning schedule.`, correlationId, ip
        }).catch(() => null)
        return { schedule: toView(schedule) }
    }
}

module.exports = {
    ContentOperationsAdminService,
    assertAllowedKeys,
    defaultSchedule,
    normalizeSchedule,
    normalizeSourceRequirements,
    safePagination,
    toView,
    validatePlanningInput
}
