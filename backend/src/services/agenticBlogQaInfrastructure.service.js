'use strict'

const { AgenticBlogQaBatch } = require('../models/agenticBlogQaBatch.model')
const { AgenticBlogQaCase } = require('../models/agenticBlogQaCase.model')
const { QaTopicReservation } = require('../models/qaTopicReservation.model')
const { QaTopicReservationLock } = require('../models/qaTopicReservationLock.model')
const { SeniorBlogAcceptanceReport } = require('../models/seniorBlogAcceptanceReport.model')
const { QaRemediationAttempt } = require('../models/qaRemediationAttempt.model')
const { BlogAutomationSchedule } = require('../models/blogAutomationSchedule.model')
const { BlogAutomationExecution } = require('../models/blogAutomationExecution.model')
const { blog: BlogPost } = require('../models/blog.model')
const { ContentOperationsRun } = require('../models/contentOperationsRun.model')
const { ContentOpportunityDecision } = require('../models/contentOpportunityDecision.model')
const { ContentWorkOrder } = require('../models/contentWorkOrder.model')
const { UnifiedContentBrief } = require('../models/unifiedContentBrief.model')
const { ResearchBundle } = require('../models/researchBundle.model')
const { EvidenceMap } = require('../models/evidenceMap.model')
const { EditorialStyleProfile } = require('../models/editorialStyleProfile.model')
const { BlogStrategyPlan } = require('../models/blogStrategyPlan.model')
const { ProductSeedPlan } = require('../models/productSeedPlan.model')
const { EditorialProductPlacementPlan } = require('../models/editorialProductPlacementPlan.model')
const { ContentPublishReadinessReport } = require('../models/contentPublishReadinessReport.model')
const { GoogleIntelligenceSnapshot } = require('../models/googleIntelligenceSnapshot.model')
const { GoogleIntelligenceRun } = require('../models/googleIntelligenceRun.model')
const { ContentOperationsDailySnapshot } = require('../models/contentOperationsDailySnapshot.model')
const { ContentInventorySnapshot } = require('../models/contentInventorySnapshot.model')
const { ContentInventoryItem } = require('../models/contentInventoryItem.model')
const { ProductCatalogSnapshot } = require('../models/productCatalogSnapshot.model')
const { BadRequestError } = require('../core/error.response')
const { buildAgenticBlogQaConfig } = require('../config/agenticBlogQa.config')

const QA_MODELS = Object.freeze([
  AgenticBlogQaBatch,
  AgenticBlogQaCase,
  QaTopicReservation,
  QaTopicReservationLock,
  SeniorBlogAcceptanceReport,
  QaRemediationAttempt,
  BlogAutomationSchedule,
  BlogAutomationExecution,
  BlogPost,
  ContentOperationsRun,
  ContentOpportunityDecision,
  ContentWorkOrder,
  UnifiedContentBrief,
  ResearchBundle,
  EvidenceMap,
  EditorialStyleProfile,
  BlogStrategyPlan,
  ProductSeedPlan,
  EditorialProductPlacementPlan,
  ContentPublishReadinessReport,
  GoogleIntelligenceSnapshot,
  GoogleIntelligenceRun,
  ContentOperationsDailySnapshot,
  ContentInventorySnapshot,
  ContentInventoryItem,
  ProductCatalogSnapshot
])

const ensurePromises = new Map()
const connectionIds = new WeakMap()
let nextConnectionId = 1

const isNamespaceExists = error => error?.code === 48 || /already exists/i.test(String(error?.message || ''))

const assertQaDatabaseIsolation = ({ config, models = QA_MODELS, connectionName } = {}) => {
  const expected = String(config?.databaseName || '').trim()
  const modelDatabaseNames = models.map(Model => String(Model?.db?.name || '').trim())
  const activeNames = connectionName
    ? [String(connectionName).trim()]
    : Array.from(new Set(modelDatabaseNames.filter(Boolean)))
  if (
    !expected ||
    !activeNames.length ||
    (!connectionName && modelDatabaseNames.some(name => !name)) ||
    activeNames.some(active => active !== expected)
  ) {
    throw new BadRequestError('Agentic Blog QA is not connected to its explicitly configured isolated database')
  }
  const tokens = expected.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  if ((!tokens.includes('qa') && !tokens.includes('test')) || !tokens.includes(config.environment)) {
    throw new BadRequestError('The active Agentic Blog QA database namespace is not safely isolated for this environment')
  }
  return expected
}

const getConnectionIdentity = connection => {
  if (!connection || (typeof connection !== 'object' && typeof connection !== 'function')) return 'missing'
  if (!connectionIds.has(connection)) connectionIds.set(connection, nextConnectionId++)
  return String(connectionIds.get(connection))
}

const buildEnsureCacheKey = ({ config, models }) => {
  const modelConnections = models.map(Model => [
    String(Model?.modelName || ''),
    String(Model?.db?.name || ''),
    getConnectionIdentity(Model?.db)
  ].join(':')).sort().join('|')
  return [config.environment, config.databaseName, modelConnections].join('::')
}

const ensureQaInfrastructure = async ({ confirm = false, config = buildAgenticBlogQaConfig(), models = QA_MODELS } = {}) => {
  if (!confirm) throw new BadRequestError('Explicit confirm=true is required to create QA collections or indexes')
  if (!config.enabled || !['local', 'staging'].includes(config.environment)) {
    throw new BadRequestError('QA infrastructure can only be ensured while QA is enabled in local or staging')
  }
  const databaseName = assertQaDatabaseIsolation({ config, models })
  const results = []
  for (const Model of models) {
    try {
      await Model.createCollection()
    } catch (error) {
      if (!isNamespaceExists(error)) throw error
    }
    const indexes = await Model.createIndexes()
    results.push({ model: Model.modelName, collection: Model.collection.name, indexes })
  }
  return { environment: config.environment, databaseName, ensured: true, models: results }
}

const ensureQaInfrastructureOnce = async ({ config = buildAgenticBlogQaConfig(), models = QA_MODELS } = {}) => {
  if (!config.enabled || !['local', 'staging'].includes(config.environment)) {
    throw new BadRequestError('QA infrastructure can only be ensured while QA is enabled in local or staging')
  }
  // Reassert every call so a reconnect or model bound to the wrong database can
  // never inherit a previously fulfilled module-level promise.
  assertQaDatabaseIsolation({ config, models })
  const cacheKey = buildEnsureCacheKey({ config, models })
  if (!ensurePromises.has(cacheKey)) {
    const ensurePromise = ensureQaInfrastructure({ confirm: true, config, models }).catch(error => {
      ensurePromises.delete(cacheKey)
      throw error
    })
    ensurePromises.set(cacheKey, ensurePromise)
  }
  return ensurePromises.get(cacheKey)
}

const resetQaInfrastructureEnsureForTests = () => {
  ensurePromises.clear()
}

module.exports = {
  QA_MODELS,
  assertQaDatabaseIsolation,
  ensureQaInfrastructure,
  ensureQaInfrastructureOnce,
  resetQaInfrastructureEnsureForTests,
  isNamespaceExists
}
