import { describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const noveltyBackfill = require('../scripts/backfill-blog-novelty-index')
const roadmapBackfill = require('../scripts/backfill-topic-roadmap-v2')

describe('roadmap and novelty backfill safety', () => {
    it('keeps both scripts immutable by default', () => {
        expect(noveltyBackfill.resolveExecutionMode({ argv: [], env: {} })).toEqual({
            apply: false,
            dryRun: true
        })
        expect(roadmapBackfill.resolveExecutionMode({ argv: [], env: {} })).toEqual({
            apply: false,
            dryRun: true
        })
    })

    it('requires a narrowly named apply flag, exact confirmation, and exact database target', () => {
        expect(() => noveltyBackfill.resolveExecutionMode({
            argv: [noveltyBackfill.APPLY_FLAG],
            env: {}
        })).toThrow(expect.objectContaining({ code: 'BLOG_NOVELTY_BACKFILL_CONFIRMATION_REQUIRED' }))
        expect(() => roadmapBackfill.resolveExecutionMode({
            argv: [roadmapBackfill.APPLY_FLAG],
            env: {}
        })).toThrow(expect.objectContaining({ code: 'TOPIC_ROADMAP_BACKFILL_CONFIRMATION_REQUIRED' }))

        const noveltyMode = noveltyBackfill.resolveExecutionMode({
            argv: [noveltyBackfill.APPLY_FLAG],
            env: {
                [noveltyBackfill.CONFIRMATION_ENV]: noveltyBackfill.CONFIRMATION_VALUE,
                [noveltyBackfill.EXPECTED_DATABASE_ENV]: 'inoxpran_staging'
            }
        })
        expect(noveltyMode).toEqual({
            apply: true,
            dryRun: false,
            expectedDatabaseName: 'inoxpran_staging'
        })
        expect(() => noveltyBackfill.assertExpectedDatabase({
            ...noveltyMode,
            actualDatabaseName: 'inoxpran_production'
        })).toThrow(expect.objectContaining({ code: 'BLOG_NOVELTY_BACKFILL_DATABASE_MISMATCH' }))
    })

    it('uses an exact immutable allowlist for historical safe-outcome conversion', () => {
        expect(Object.isFrozen(roadmapBackfill.HISTORICAL_SAFE_OUTCOME_CODES)).toBe(true)
        expect(roadmapBackfill.isHistoricalSafeOutcomeCode('ROADMAP_NO_ACCEPTABLE_TOPIC')).toBe(true)
        expect(roadmapBackfill.isHistoricalSafeOutcomeCode('ROADMAP_NO_SAFE_TOPIC')).toBe(true)
        expect(roadmapBackfill.isHistoricalSafeOutcomeCode('ROADMAP_NO_READY_TOPIC')).toBe(true)
        expect(roadmapBackfill.isHistoricalSafeOutcomeCode('ROADMAP_REQUIRED_EVIDENCE_UNAVAILABLE')).toBe(false)
        expect(roadmapBackfill.isHistoricalSafeOutcomeCode('ROADMAP_SCORE_UNREACHABLE')).toBe(false)
        expect(roadmapBackfill.isHistoricalSafeOutcomeCode('ROADMAP_NO_ACCEPTABLE_TOPIC_EXTRA')).toBe(false)
        expect(roadmapBackfill.isHistoricalSafeOutcomeCode('OPENCLAW_AGENT_TIMEOUT')).toBe(false)
    })

    it('updates historical records only through exact allowlisted code filters', async () => {
        const model = () => ({ updateMany: vi.fn(async () => ({ modifiedCount: 1 })) })
        const models = {
            ExecutionModel: model(),
            RoadmapModel: model(),
            RegenerationModel: model(),
            RunModel: model()
        }
        const result = await roadmapBackfill.backfillHistoricalSafeOutcomes(models)
        const expected = roadmapBackfill.HISTORICAL_SAFE_OUTCOME_CODES.length
        expect(result).toEqual({
            executions: expected,
            roadmaps: expected,
            regenerations: expected,
            ideationRuns: expected
        })
        for (const target of Object.values(models)) {
            expect(target.updateMany).toHaveBeenCalledTimes(expected)
        }
        const executionCodes = models.ExecutionModel.updateMany.mock.calls.map(([filter]) => (
            filter.$or.map((entry) => entry.error || entry['metadata.outcomeCode'] || entry['metadata.decisionReason'])
        ))
        expect(executionCodes).toEqual(
            roadmapBackfill.HISTORICAL_SAFE_OUTCOME_CODES.map((code) => [code, code, code])
        )
    })

    it('will drop only a known exact legacy uniqueness index', () => {
        const exact = {
            name: 'scheduleId_1_uniquenessKey_1',
            key: { scheduleId: 1, uniquenessKey: 1 },
            unique: true
        }
        expect(roadmapBackfill.findLegacyUniquenessIndex([exact])).toEqual(exact)
        expect(() => roadmapBackfill.findLegacyUniquenessIndex([{
            ...exact,
            name: 'unexpected-production-index'
        }])).toThrow(expect.objectContaining({ code: 'TOPIC_ROADMAP_LEGACY_INDEX_UNEXPECTED' }))
        expect(() => roadmapBackfill.findLegacyUniquenessIndex([{
            ...exact,
            sparse: true
        }])).toThrow(expect.objectContaining({ code: 'TOPIC_ROADMAP_LEGACY_INDEX_UNEXPECTED' }))
    })

    it('inspects novelty work without rebuilding or calling an embedding provider', async () => {
        const BlogModel = { countDocuments: vi.fn(async () => 4) }
        const RoadmapItemModel = { countDocuments: vi.fn(async () => 3) }
        const IndexModel = { countDocuments: vi.fn(async () => 5) }
        await expect(noveltyBackfill.inspectNoveltyBackfill({ BlogModel, RoadmapItemModel, IndexModel }))
            .resolves.toMatchObject({
                dryRun: true,
                applied: false,
                paidProviderCallRequiredOnApply: true,
                maximumSourcesToRebuild: 7,
                currentIndexEntries: 5
            })
    })
})
