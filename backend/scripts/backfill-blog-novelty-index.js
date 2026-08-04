'use strict'

const mongoose = require('mongoose')
const { blog: BlogPost } = require('../src/models/blog.model')
const { BlogNoveltyIndex } = require('../src/models/blogNoveltyIndex.model')
const { BlogTopicRoadmapItem } = require('../src/models/blogTopicRoadmapItem.model')
const { BlogNoveltyIndexService, INDEX_VERSION } = require('../src/services/contentOperations/blogNoveltyIndex.service')
const { loadRuntimeEnv } = require('../src/config/runtimeEnv')

const APPLY_FLAG = '--apply-blog-novelty-index'
const CONFIRMATION_ENV = 'CONFIRM_BLOG_NOVELTY_INDEX_BACKFILL'
const CONFIRMATION_VALUE = 'APPLY_PAID_BLOG_NOVELTY_INDEX_REBUILD'
const EXPECTED_DATABASE_ENV = 'EXPECTED_BLOG_NOVELTY_DATABASE'
const SAFE_DATABASE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/

const backfillError = (code) => Object.assign(new Error(code), { code })

const resolveExecutionMode = ({ argv = process.argv.slice(2), env = process.env } = {}) => {
    const apply = argv.includes(APPLY_FLAG)
    if (!apply) return Object.freeze({ apply: false, dryRun: true })
    if (env[CONFIRMATION_ENV] !== CONFIRMATION_VALUE) {
        throw backfillError('BLOG_NOVELTY_BACKFILL_CONFIRMATION_REQUIRED')
    }
    const expectedDatabaseName = String(env[EXPECTED_DATABASE_ENV] || '').trim()
    if (!SAFE_DATABASE_NAME.test(expectedDatabaseName)) {
        throw backfillError('BLOG_NOVELTY_BACKFILL_DATABASE_CONFIRMATION_REQUIRED')
    }
    return Object.freeze({ apply: true, dryRun: false, expectedDatabaseName })
}

const assertExpectedDatabase = ({ apply, expectedDatabaseName, actualDatabaseName } = {}) => {
    if (!apply) return true
    if (String(expectedDatabaseName || '') !== String(actualDatabaseName || '')) {
        throw backfillError('BLOG_NOVELTY_BACKFILL_DATABASE_MISMATCH')
    }
    return true
}

const inspectNoveltyBackfill = async ({
    BlogModel = BlogPost,
    RoadmapItemModel = BlogTopicRoadmapItem,
    IndexModel = BlogNoveltyIndex
} = {}) => {
    const [blogSources, roadmapSources, currentIndexEntries] = await Promise.all([
        BlogModel.countDocuments({ isQaTest: { $ne: true } }),
        RoadmapItemModel.countDocuments({}),
        IndexModel.countDocuments({ indexVersion: INDEX_VERSION, isQaTest: false })
    ])
    return {
        dryRun: true,
        applied: false,
        paidProviderCallRequiredOnApply: true,
        indexVersion: INDEX_VERSION,
        blogSources,
        roadmapSources,
        currentIndexEntries,
        maximumSourcesToRebuild: blogSources + roadmapSources
    }
}

const runNoveltyBackfill = async ({ apply = false, service = new BlogNoveltyIndexService() } = {}) => {
    if (!apply) return inspectNoveltyBackfill()
    const result = await service.rebuildAll()
    return { dryRun: false, applied: true, ...result }
}

const main = async () => {
    let connected = false
    try {
        loadRuntimeEnv()
        const mode = resolveExecutionMode()
        if (!process.env.MONGODB_URI) throw backfillError('MONGODB_URI_REQUIRED')
        await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, autoCreate: false, maxPoolSize: 2 })
        connected = true
        assertExpectedDatabase({
            apply: mode.apply,
            expectedDatabaseName: mode.expectedDatabaseName,
            actualDatabaseName: mongoose.connection.name
        })
        const result = mode.apply
            ? await runNoveltyBackfill({ apply: true })
            : await inspectNoveltyBackfill()
        console.log(JSON.stringify({ ok: true, ...result }, null, 2))
    } catch (error) {
        console.error(JSON.stringify({
            ok: false,
            code: String(error?.code || 'NOVELTY_BACKFILL_FAILED').slice(0, 120)
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
    assertExpectedDatabase,
    inspectNoveltyBackfill,
    resolveExecutionMode,
    runNoveltyBackfill
}
