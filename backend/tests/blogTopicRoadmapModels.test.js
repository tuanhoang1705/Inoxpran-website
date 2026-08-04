import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { BlogTopicRoadmap } = require('../src/models/blogTopicRoadmap.model')
const { BlogTopicRoadmapItem } = require('../src/models/blogTopicRoadmapItem.model')
const { BlogTopicRoadmapRegeneration } = require('../src/models/blogTopicRoadmapRegeneration.model')
const { HousewaresMarketSnapshot } = require('../src/models/housewaresMarketSnapshot.model')

const hasIndex = (model, expectedKeys, expectedOptions = {}) => model.schema.indexes().some(([keys, options]) => (
    Object.entries(expectedKeys).every(([key, value]) => keys[key] === value) &&
    Object.entries(expectedOptions).every(([key, value]) => options[key] === value)
))

describe('rolling topic roadmap models', () => {
    it('keeps one header per schedule and stores no embedded item array', () => {
        expect(hasIndex(BlogTopicRoadmap, { scheduleId: 1 }, { unique: true })).toBe(true)
        expect(BlogTopicRoadmap.schema.path('items')).toBeUndefined()
        expect(BlogTopicRoadmap.schema.path('refillToken').options.select).toBe(false)
        expect(hasIndex(BlogTopicRoadmap, { status: 1, refillLeaseUntil: 1 })).toBe(true)
    })

    it('enforces unique roadmap items and claim-ready indexes', () => {
        expect(hasIndex(BlogTopicRoadmapItem, { scheduleId: 1, uniquenessKey: 1, activationEpoch: 1 }, { unique: true })).toBe(true)
        expect(hasIndex(BlogTopicRoadmapItem, { status: 1, claimUntil: 1, scheduleId: 1 })).toBe(true)
        expect(hasIndex(BlogTopicRoadmapItem, { scheduleId: 1, claimToken: 1, status: 1 })).toBe(true)
        expect(BlogTopicRoadmapItem.schema.path('claimToken').options.select).toBe(false)
        expect(BlogTopicRoadmapItem.schema.path('activationEpoch')).toBeTruthy()
        expect(BlogTopicRoadmapItem.schema.path('regenerationId')).toBeTruthy()
    })

    it('persists an idempotent single-flight regeneration queue with hidden lease ownership', () => {
        expect(hasIndex(BlogTopicRoadmapRegeneration, { roadmapId: 1, idempotencyKeyHash: 1 }, { unique: true })).toBe(true)
        expect(hasIndex(BlogTopicRoadmapRegeneration, { roadmapId: 1, coalescedIdempotencyKeyHashes: 1 }, { unique: true })).toBe(true)
        expect(BlogTopicRoadmapRegeneration.schema.path('coalescedIdempotencyKeyHashes').options.select).toBe(false)
        expect(BlogTopicRoadmapRegeneration.schema.indexes().some(([keys, options]) => (
            keys.roadmapId === 1 &&
            keys.activeFence === 1 &&
            options.unique === true &&
            options.partialFilterExpression?.activeFence === true
        ))).toBe(true)
        expect(BlogTopicRoadmapRegeneration.schema.path('leaseTokenHash').options.select).toBe(false)
        expect(BlogTopicRoadmapRegeneration.schema.path('reason').options.maxlength).toBe(160)
        expect(BlogTopicRoadmap.schema.path('activeEpoch')).toBeTruthy()
        expect(BlogTopicRoadmap.schema.path('latestRegenerationId')).toBeTruthy()
    })

    it('bounds item evidence arrays and rejects unsupported statuses', () => {
        const base = {
            roadmapId: '507f1f77bcf86cd799439011',
            scheduleId: '507f1f77bcf86cd799439012',
            generation: 1,
            topic: 'Chọn nồi inox cho bếp gia đình',
            angle: 'Chọn theo nhu cầu thật',
            uniquenessKey: 'narrow:noi-inox',
            provenance: { directionHash: 'abc', generatedAt: new Date() }
        }
        const invalidStatus = new BlogTopicRoadmapItem({ ...base, status: 'queued' })
        expect(invalidStatus.validateSync()?.errors.status).toBeTruthy()

        const tooMuchEvidence = new BlogTopicRoadmapItem({
            ...base,
            productEvidence: Array.from({ length: 13 }, (_, index) => ({
                name: `Product ${index}`,
                evidenceHash: `hash-${index}`
            }))
        })
        expect(tooMuchEvidence.validateSync()?.errors.productEvidence).toBeTruthy()
    })

    it('persists bounded market records with TTL and never defines raw body fields', () => {
        expect(hasIndex(HousewaresMarketSnapshot, { expiresAt: 1 }, { expireAfterSeconds: 0 })).toBe(true)
        expect(HousewaresMarketSnapshot.schema.path('rawHtml')).toBeUndefined()
        expect(HousewaresMarketSnapshot.schema.path('rawBody')).toBeUndefined()

        const tooManySources = new HousewaresMarketSnapshot({
            status: 'complete',
            registryHash: 'registry',
            snapshotHash: 'snapshot',
            generatedAt: new Date(),
            expiresAt: new Date(Date.now() + 60_000),
            sourceHealth: {},
            freshness: { checkedAt: new Date(), ttlSeconds: 60 },
            sources: Array.from({ length: 51 }, (_, index) => ({
                sourceId: `source-${index}`,
                sourceName: `Source ${index}`,
                canonicalUrl: `https://example.com/${index}`,
                status: 'available'
            }))
        })
        expect(tooManySources.validateSync()?.errors.sources).toBeTruthy()
    })
})
