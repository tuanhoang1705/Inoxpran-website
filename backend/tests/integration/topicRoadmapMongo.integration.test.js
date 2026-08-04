import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const mongoose = require('mongoose')
const { BlogAutomationExecution } = require('../../src/models/blogAutomationExecution.model')
const { BlogAutomationSchedule } = require('../../src/models/blogAutomationSchedule.model')
const { BlogTopicRoadmap } = require('../../src/models/blogTopicRoadmap.model')
const {
    BlogTopicRoadmapRegeneration
} = require('../../src/models/blogTopicRoadmapRegeneration.model')
const {
    BlogTopicRoadmapService
} = require('../../src/services/contentOperations/blogTopicRoadmap.service')

const integrationUri = String(process.env.MONGODB_INTEGRATION_URI || '').trim()
const describeWithMongo = integrationUri ? describe : describe.skip
const SAFE_INTEGRATION_DATABASE = /^inoxpran_integration(?:_[A-Za-z0-9_-]+)?$/

const integrationDatabaseName = (uri) => {
    try {
        return decodeURIComponent(new URL(uri).pathname.replace(/^\//, ''))
    } catch {
        return ''
    }
}

const assertSafeIntegrationDatabase = (databaseName) => {
    if (!SAFE_INTEGRATION_DATABASE.test(String(databaseName || ''))) {
        throw Object.assign(new Error('Mongo integration database name is not safely isolated'), {
            code: 'MONGODB_INTEGRATION_DATABASE_UNSAFE'
        })
    }
}

describeWithMongo('topic roadmap MongoDB integration', () => {
    let schedule
    let roadmap
    let clock
    let service
    let safeDatabase = false

    beforeAll(async () => {
        assertSafeIntegrationDatabase(integrationDatabaseName(integrationUri))
        await mongoose.connect(integrationUri, {
            autoIndex: false,
            serverSelectionTimeoutMS: 10_000
        })
        assertSafeIntegrationDatabase(mongoose.connection.name)
        safeDatabase = true
        await mongoose.connection.db.dropDatabase()
        await Promise.all([
            BlogAutomationExecution.syncIndexes(),
            BlogAutomationSchedule.syncIndexes(),
            BlogTopicRoadmap.syncIndexes(),
            BlogTopicRoadmapRegeneration.syncIndexes()
        ])

        schedule = await BlogAutomationSchedule.create({
            name: 'Mongo integration schedule',
            description: 'Evidence-backed cookware topics',
            scheduleType: 'daily',
            daily: { times: ['06:30'] },
            autoPublish: false,
            draftOnly: true,
            agentConfig: {
                simpleContract: true,
                direction: 'Evidence-backed cookware topics'
            }
        })
        roadmap = await BlogTopicRoadmap.create({
            scheduleId: schedule._id,
            direction: schedule.agentConfig.direction,
            directionHash: 'a'.repeat(64),
            directionRevision: 1,
            generation: 0,
            activeEpoch: 'integration-base-epoch',
            status: 'ready',
            minimumReady: 3,
            targetReady: 8
        })

        clock = new Date('2026-07-29T00:00:00.000Z')
        service = new BlogTopicRoadmapService({
            config: {
                topicRoadmap: {
                    enabled: true,
                    acceptanceScore: 82,
                    minimumNoveltySubtotal: 48,
                    regenerationLeaseMs: 1_000,
                    regenerationRetryDelayMs: 500,
                    regenerationMaxAttempts: 3
                }
            },
            now: () => new Date(clock)
        })
    }, 30_000)

    afterAll(async () => {
        if (mongoose.connection.readyState === 1) {
            if (safeDatabase) await mongoose.connection.db.dropDatabase()
            await mongoose.disconnect()
        }
    }, 30_000)

    it('creates and verifies the required unique and queue indexes', async () => {
        const regenerationIndexes = await BlogTopicRoadmapRegeneration.collection.indexes()
        const names = new Set(regenerationIndexes.map((index) => index.name))
        expect(names.has('topic_roadmap_regeneration_idempotency_unique')).toBe(true)
        expect(names.has('topic_roadmap_regeneration_coalesced_idempotency_unique')).toBe(true)
        expect(names.has('topic_roadmap_regeneration_active_unique')).toBe(true)
        expect(names.has('topic_roadmap_regeneration_queue_lease')).toBe(true)

        await BlogAutomationExecution.create({ executionKey: 'mongo-integration-execution' })
        await expect(
            BlogAutomationExecution.create({ executionKey: 'mongo-integration-execution' })
        ).rejects.toMatchObject({ code: 11000 })
    })

    it('atomically creates, coalesces, and replays idempotent regeneration requests', async () => {
        const keys = Array.from({ length: 6 }, (_, index) => `mongo-concurrent-key-${index}`)
        const results = await Promise.all(keys.map((idempotencyKey) => service.enqueueRegeneration({
            scheduleId: schedule._id,
            idempotencyKey,
            adminId: 'integration-admin'
        })))

        expect(await BlogTopicRoadmapRegeneration.countDocuments({ roadmapId: roadmap._id })).toBe(1)
        expect(results.filter((result) => result.coalesced === false)).toHaveLength(1)
        expect(results.filter((result) => result.coalesced === true)).toHaveLength(5)
        expect(new Set(results.map((result) => result.regeneration.id)).size).toBe(1)

        const replay = await service.enqueueRegeneration({
            scheduleId: schedule._id,
            idempotencyKey: keys[3],
            adminId: 'integration-admin'
        })
        expect(replay.duplicate).toBe(true)
        expect(replay.regeneration.id).toBe(results[0].regeneration.id)

        const stored = await BlogTopicRoadmapRegeneration.findOne({ roadmapId: roadmap._id })
            .select('+coalescedIdempotencyKeyHashes')
            .lean()
        expect(stored.coalescedIdempotencyKeyHashes).toHaveLength(6)
        expect(stored.coalescedIdempotencyKeyHashes).toContain(stored.idempotencyKeyHash)
    })

    it('fences worker leases and only retries after the persisted backoff', async () => {
        const firstClaim = await service.claimQueuedRegeneration({ workerId: 'worker-a', now: clock })
        expect(firstClaim.job.status).toBe('running')
        expect(firstClaim.job.attemptCount).toBe(1)

        const overlappingClaim = await service.claimQueuedRegeneration({ workerId: 'worker-b', now: clock })
        expect(overlappingClaim).toBeNull()

        const retry = await service.completeRegeneration({
            job: firstClaim.job,
            tokenHash: firstClaim.tokenHash,
            outcome: '',
            errorCode: 'OPENCLAW_AGENT_TIMEOUT',
            retry: true
        })
        expect(retry.status).toBe('queued')
        expect(retry.activeFence).toBe(true)

        clock = new Date('2026-07-29T00:00:00.250Z')
        expect(await service.claimQueuedRegeneration({ workerId: 'worker-b', now: clock })).toBeNull()

        clock = new Date('2026-07-29T00:00:00.750Z')
        const secondClaim = await service.claimQueuedRegeneration({ workerId: 'worker-b', now: clock })
        expect(secondClaim.job.attemptCount).toBe(2)

        clock = new Date('2026-07-29T00:00:02.000Z')
        const reclaimed = await service.claimQueuedRegeneration({ workerId: 'worker-c', now: clock })
        expect(reclaimed.job.attemptCount).toBe(3)
        expect(reclaimed.job._id.toString()).toBe(secondClaim.job._id.toString())

        await service.completeRegeneration({
            job: reclaimed.job,
            tokenHash: reclaimed.tokenHash,
            outcome: 'no_change',
            outcomeCode: 'ROADMAP_NO_SAFE_TOPIC'
        })
        const sequential = await service.enqueueRegeneration({
            scheduleId: schedule._id,
            idempotencyKey: 'mongo-sequential-key-after-terminal',
            adminId: 'integration-admin'
        })
        expect(sequential).toMatchObject({ queued: true, duplicate: false, coalesced: false })
        expect(await BlogTopicRoadmapRegeneration.countDocuments({ roadmapId: roadmap._id })).toBe(2)
    })
})
