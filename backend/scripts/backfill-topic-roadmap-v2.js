'use strict'

const mongoose = require('mongoose')
const { BlogAutomationExecution } = require('../src/models/blogAutomationExecution.model')
const { BlogTopicRoadmap } = require('../src/models/blogTopicRoadmap.model')
const { BlogTopicRoadmapItem } = require('../src/models/blogTopicRoadmapItem.model')
const { BlogTopicRoadmapRegeneration } = require('../src/models/blogTopicRoadmapRegeneration.model')
const { TopicIdeationRun } = require('../src/models/topicIdeationRun.model')
const { BlogNoveltyIndexService, INDEX_VERSION } = require('../src/services/contentOperations/blogNoveltyIndex.service')
const {
    RUBRIC_VERSION,
    ACCEPTANCE_SCORE,
    MIN_NOVELTY_SUBTOTAL
} = require('../src/services/contentOperations/topicRoadmapScoring.service')
const { SOURCE_RELEVANCE_VERSION } = require('../src/services/contentOperations/sourceRelevanceScoring.service')
const { loadRuntimeEnv } = require('../src/config/runtimeEnv')

const APPLY_FLAG = '--apply-topic-roadmap-v2'
const CONFIRMATION_ENV = 'CONFIRM_TOPIC_ROADMAP_V2_BACKFILL'
const CONFIRMATION_VALUE = 'APPLY_PAID_TOPIC_ROADMAP_V2_BACKFILL'
const EXPECTED_DATABASE_ENV = 'EXPECTED_TOPIC_ROADMAP_DATABASE'
const SAFE_DATABASE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/
const LEGACY_INDEX_NAMES = new Set([
    'scheduleId_1_uniquenessKey_1',
    'topic_roadmap_item_uniqueness'
])
const HISTORICAL_SAFE_OUTCOME_CODES = Object.freeze([
    'ROADMAP_NO_ACCEPTABLE_TOPIC',
    'ROADMAP_NO_SAFE_TOPIC',
    'ROADMAP_NO_READY_TOPIC'
])

const migrationError = (code) => Object.assign(new Error(code), { code })
const isHistoricalSafeOutcomeCode = (value) => HISTORICAL_SAFE_OUTCOME_CODES.includes(String(value || ''))

const resolveExecutionMode = ({ argv = process.argv.slice(2), env = process.env } = {}) => {
    const apply = argv.includes(APPLY_FLAG)
    if (!apply) return Object.freeze({ apply: false, dryRun: true })
    if (env[CONFIRMATION_ENV] !== CONFIRMATION_VALUE) {
        throw migrationError('TOPIC_ROADMAP_BACKFILL_CONFIRMATION_REQUIRED')
    }
    const expectedDatabaseName = String(env[EXPECTED_DATABASE_ENV] || '').trim()
    if (!SAFE_DATABASE_NAME.test(expectedDatabaseName)) {
        throw migrationError('TOPIC_ROADMAP_BACKFILL_DATABASE_CONFIRMATION_REQUIRED')
    }
    return Object.freeze({ apply: true, dryRun: false, expectedDatabaseName })
}

const assertExpectedDatabase = ({ apply, expectedDatabaseName, actualDatabaseName } = {}) => {
    if (!apply) return true
    if (String(expectedDatabaseName || '') !== String(actualDatabaseName || '')) {
        throw migrationError('TOPIC_ROADMAP_BACKFILL_DATABASE_MISMATCH')
    }
    return true
}

const isExactLegacyUniquenessIndex = (index = {}) => {
    const keys = Object.entries(index.key || {})
    return LEGACY_INDEX_NAMES.has(String(index.name || '')) &&
        index.unique === true &&
        keys.length === 2 &&
        keys[0]?.[0] === 'scheduleId' && Number(keys[0]?.[1]) === 1 &&
        keys[1]?.[0] === 'uniquenessKey' && Number(keys[1]?.[1]) === 1 &&
        index.sparse !== true &&
        index.partialFilterExpression == null &&
        (index.collation == null || String(index.collation?.locale || '') === 'simple')
}

const findLegacyUniquenessIndex = (indexes = []) => {
    const sameKeyUnique = indexes.filter((index) => {
        const keys = Object.entries(index.key || {})
        return index.unique === true && keys.length === 2 &&
            keys[0]?.[0] === 'scheduleId' && Number(keys[0]?.[1]) === 1 &&
            keys[1]?.[0] === 'uniquenessKey' && Number(keys[1]?.[1]) === 1
    })
    const unexpected = sameKeyUnique.find((index) => !isExactLegacyUniquenessIndex(index))
    if (unexpected) throw migrationError('TOPIC_ROADMAP_LEGACY_INDEX_UNEXPECTED')
    return sameKeyUnique.find(isExactLegacyUniquenessIndex) || null
}

const staleReadyFilter = Object.freeze({
    status: 'ready',
    $or: [
        { 'scores.totalScore': { $lt: ACCEPTANCE_SCORE } },
        { 'scores.noveltySubtotal': { $lt: MIN_NOVELTY_SUBTOTAL } },
        { 'scores.rubricVersion': { $ne: RUBRIC_VERSION } },
        { 'scores.corpusVersion': { $ne: INDEX_VERSION } },
        { 'scores.hardGatesPassed': { $ne: true } },
        { 'scores.scoreHash': { $not: /^[a-f0-9]{64}$/ } },
        { marketEvidence: { $not: { $elemMatch: {
            evidenceId: { $type: 'string', $ne: '' },
            contentHash: { $type: 'string', $ne: '' },
            relevanceVersion: SOURCE_RELEVANCE_VERSION,
            relevanceScore: { $gt: 0 }
        } } } }
    ]
})

const inspectHistoricalSafeOutcomes = async ({
    ExecutionModel = BlogAutomationExecution,
    RoadmapModel = BlogTopicRoadmap,
    RegenerationModel = BlogTopicRoadmapRegeneration,
    RunModel = TopicIdeationRun
} = {}) => {
    const [executions, roadmaps, regenerations, ideationRuns] = await Promise.all([
        ExecutionModel.countDocuments({
            status: 'failed',
            $or: [
                { error: { $in: HISTORICAL_SAFE_OUTCOME_CODES } },
                { 'metadata.outcomeCode': { $in: HISTORICAL_SAFE_OUTCOME_CODES } },
                { 'metadata.decisionReason': { $in: HISTORICAL_SAFE_OUTCOME_CODES } }
            ]
        }),
        RoadmapModel.countDocuments({ lastErrorCode: { $in: HISTORICAL_SAFE_OUTCOME_CODES } }),
        RegenerationModel.countDocuments({ status: 'failed', errorCode: { $in: HISTORICAL_SAFE_OUTCOME_CODES } }),
        RunModel.countDocuments({ status: 'failed', errorCode: { $in: HISTORICAL_SAFE_OUTCOME_CODES } })
    ])
    return { executions, roadmaps, regenerations, ideationRuns }
}

const backfillHistoricalSafeOutcomes = async ({
    ExecutionModel = BlogAutomationExecution,
    RoadmapModel = BlogTopicRoadmap,
    RegenerationModel = BlogTopicRoadmapRegeneration,
    RunModel = TopicIdeationRun,
    now = new Date()
} = {}) => {
    const totals = { executions: 0, roadmaps: 0, regenerations: 0, ideationRuns: 0 }
    for (const code of HISTORICAL_SAFE_OUTCOME_CODES) {
        const [executions, roadmaps, regenerations, ideationRuns] = await Promise.all([
            ExecutionModel.updateMany(
                {
                    status: 'failed',
                    $or: [{ error: code }, { 'metadata.outcomeCode': code }, { 'metadata.decisionReason': code }]
                },
                { $set: {
                    status: 'skipped', error: '', contentAction: 'skip',
                    'metadata.decision': 'skip', 'metadata.outcomeCode': code, 'metadata.decisionReason': code
                } }
            ),
            RoadmapModel.updateMany(
                { lastErrorCode: code },
                { $set: { lastErrorCode: '', lastOutcomeCode: code } }
            ),
            RegenerationModel.updateMany(
                { status: 'failed', errorCode: code },
                { $set: {
                    status: 'completed', outcome: 'no_change', outcomeCode: code,
                    errorCode: '', activeFence: false, leaseExpiresAt: null
                } }
            ),
            RunModel.updateMany(
                { status: 'failed', errorCode: code },
                { $set: {
                    status: 'completed', outcome: 'no_change', outcomeCode: code,
                    terminalCode: code, errorCode: ''
                } }
            )
        ])
        totals.executions += Number(executions?.modifiedCount || 0)
        totals.roadmaps += Number(roadmaps?.modifiedCount || 0)
        totals.regenerations += Number(regenerations?.modifiedCount || 0)
        totals.ideationRuns += Number(ideationRuns?.modifiedCount || 0)
    }
    return totals
}

const inspectTopicRoadmapBackfill = async ({
    ItemModel = BlogTopicRoadmapItem,
    RoadmapModel = BlogTopicRoadmap,
    historicalModels = {}
} = {}) => {
    const [indexes, staleReadyItems, missingActivationEpoch, activeRoadmaps, historicalSafeOutcomes] = await Promise.all([
        ItemModel.collection.indexes().catch((error) => {
            if (error?.code === 26 || error?.codeName === 'NamespaceNotFound') return []
            throw error
        }),
        ItemModel.countDocuments(staleReadyFilter),
        ItemModel.countDocuments({
            status: 'ready',
            $or: [{ activationEpoch: '' }, { activationEpoch: { $exists: false } }]
        }),
        RoadmapModel.countDocuments({ status: { $ne: 'archived' } }),
        inspectHistoricalSafeOutcomes(historicalModels)
    ])
    const legacyIndex = findLegacyUniquenessIndex(indexes)
    return {
        dryRun: true,
        applied: false,
        paidProviderCallRequiredOnApply: true,
        rubricVersion: RUBRIC_VERSION,
        corpusVersion: INDEX_VERSION,
        staleReadyItems,
        missingActivationEpoch,
        activeRoadmaps,
        legacyIndexToDrop: legacyIndex?.name || '',
        historicalSafeOutcomes,
        historicalSafeOutcomeCodes: [...HISTORICAL_SAFE_OUTCOME_CODES]
    }
}

const applyTopicRoadmapBackfill = async ({ now = new Date() } = {}) => {
    const manifest = await new BlogNoveltyIndexService().rebuildAll()
    const itemIndexes = await BlogTopicRoadmapItem.collection.indexes()
    const legacyUniquenessIndex = findLegacyUniquenessIndex(itemIndexes)
    if (legacyUniquenessIndex?.name) {
        await BlogTopicRoadmapItem.collection.dropIndex(legacyUniquenessIndex.name)
    }
    await BlogTopicRoadmapItem.createIndexes()
    const invalidated = await BlogTopicRoadmapItem.updateMany(
        staleReadyFilter,
        { $set: { status: 'invalidated', invalidatedAt: now, reasonCode: 'topic_plan_v4_verified_evidence_migration' } }
    )
    const roadmaps = await BlogTopicRoadmap.find({ status: { $ne: 'archived' } })
        .select('_id activeEpoch directionRevision minimumReady')
        .lean()
    for (const roadmap of roadmaps) {
        const activeEpoch = roadmap.activeEpoch || `legacy-${String(roadmap._id)}`.slice(0, 80)
        await BlogTopicRoadmapItem.updateMany(
            { roadmapId: roadmap._id, status: 'ready', $or: [{ activationEpoch: '' }, { activationEpoch: { $exists: false } }] },
            { $set: { activationEpoch: activeEpoch } }
        )
        const readyCount = await BlogTopicRoadmapItem.countDocuments({
            roadmapId: roadmap._id,
            status: 'ready',
            activationEpoch: activeEpoch,
            directionRevision: roadmap.directionRevision,
            'scores.totalScore': { $gte: ACCEPTANCE_SCORE },
            'scores.noveltySubtotal': { $gte: MIN_NOVELTY_SUBTOTAL },
            'scores.rubricVersion': RUBRIC_VERSION,
            'scores.corpusVersion': INDEX_VERSION,
            'scores.hardGatesPassed': true,
            'scores.scoreHash': { $type: 'string', $regex: /^[a-f0-9]{64}$/ },
            marketEvidence: { $elemMatch: {
                evidenceId: { $type: 'string', $ne: '' },
                contentHash: { $type: 'string', $ne: '' },
                relevanceVersion: SOURCE_RELEVANCE_VERSION,
                relevanceScore: { $gt: 0 }
            } }
        })
        const minimumReady = Math.max(1, Number(roadmap.minimumReady || 3))
        const status = readyCount >= minimumReady ? 'ready' : readyCount > 0 ? 'partial' : 'needs_refill'
        await BlogTopicRoadmap.updateOne({ _id: roadmap._id }, { $set: {
            activeEpoch,
            epochMigrationComplete: true,
            readyCount,
            status,
            refillRequestedAt: readyCount >= minimumReady ? null : now,
            refillReason: readyCount >= minimumReady ? '' : 'topic_plan_v4_verified_evidence_migration',
            scoreRubricVersion: RUBRIC_VERSION,
            corpusVersion: INDEX_VERSION,
            corpusHash: manifest.corpusHash
        } })
    }
    const historicalSafeOutcomes = await backfillHistoricalSafeOutcomes({ now })
    return {
        dryRun: false,
        applied: true,
        manifest,
        invalidated: Number(invalidated.modifiedCount || 0),
        roadmaps: roadmaps.length,
        historicalSafeOutcomes
    }
}

const main = async () => {
    let connected = false
    try {
        loadRuntimeEnv()
        const mode = resolveExecutionMode()
        if (!process.env.MONGODB_URI) throw migrationError('MONGODB_URI_REQUIRED')
        await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, autoCreate: false, maxPoolSize: 2 })
        connected = true
        assertExpectedDatabase({
            apply: mode.apply,
            expectedDatabaseName: mode.expectedDatabaseName,
            actualDatabaseName: mongoose.connection.name
        })
        const result = mode.apply
            ? await applyTopicRoadmapBackfill()
            : await inspectTopicRoadmapBackfill()
        console.log(JSON.stringify({ ok: true, ...result }, null, 2))
    } catch (error) {
        console.error(JSON.stringify({
            ok: false,
            code: String(error?.code || 'TOPIC_ROADMAP_V2_BACKFILL_FAILED').slice(0, 120)
        }, null, 2))
        process.exitCode = 1
    } finally {
        if (connected) await mongoose.disconnect().catch(() => {})
    }
}

if (require.main === module) main()

module.exports = {
    APPLY_FLAG,
    CONFIRMATION_ENV,
    CONFIRMATION_VALUE,
    EXPECTED_DATABASE_ENV,
    HISTORICAL_SAFE_OUTCOME_CODES,
    LEGACY_INDEX_NAMES,
    applyTopicRoadmapBackfill,
    assertExpectedDatabase,
    backfillHistoricalSafeOutcomes,
    findLegacyUniquenessIndex,
    inspectHistoricalSafeOutcomes,
    inspectTopicRoadmapBackfill,
    isExactLegacyUniquenessIndex,
    isHistoricalSafeOutcomeCode,
    resolveExecutionMode,
    staleReadyFilter
}
