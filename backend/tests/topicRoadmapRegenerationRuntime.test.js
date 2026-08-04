import { describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
    createTopicRoadmapRegenerationRuntime,
    getPollMs
} = require('../src/services/topicRoadmapRegeneration.runtime')

const deferred = () => {
    let resolve
    const promise = new Promise((done) => { resolve = done })
    return { promise, resolve }
}

describe('topic roadmap regeneration runtime', () => {
    it('uses a bounded independent polling interval', () => {
        expect(getPollMs()).toBe(5_000)
        expect(getPollMs('1000')).toBe(1_000)
        expect(getPollMs('60000')).toBe(60_000)
        expect(getPollMs('999999')).toBe(5_000)
        expect(getPollMs('invalid')).toBe(5_000)
    })

    it('never overlaps a long regeneration and stays independent from the blog scheduler', async () => {
        const active = deferred()
        const run = vi.fn(() => active.promise)
        let scheduledTick
        const clearIntervalFn = vi.fn()
        const runtime = createTopicRoadmapRegenerationRuntime({
            ScheduleService: { runQueuedTopicRoadmapRegenerationOnce: run },
            enabled: () => true,
            setIntervalFn: vi.fn((tick) => {
                scheduledTick = tick
                return { unref: vi.fn() }
            }),
            clearIntervalFn,
            hostname: () => 'test-host',
            processId: 42,
            now: () => new Date('2026-07-29T00:00:00.000Z')
        })

        expect(runtime.start()).toMatchObject({ started: true, workerId: expect.stringContaining('topic-roadmap:test-host:42:') })
        await Promise.resolve()
        expect(run).toHaveBeenCalledTimes(1)

        const overlapping = await scheduledTick()
        expect(overlapping).toBeNull()
        expect(run).toHaveBeenCalledTimes(1)
        expect(runtime.status()).toMatchObject({ workerActive: true, serviceRegistered: true })

        active.resolve({ status: 'completed' })
        await Promise.resolve()
        await Promise.resolve()
        expect(runtime.status().workerActive).toBe(false)
        expect(runtime.stop()).toEqual({ stopped: true })
        expect(clearIntervalFn).toHaveBeenCalledTimes(1)
    })

    it('does not claim work while roadmap execution is disabled', async () => {
        const run = vi.fn()
        const runtime = createTopicRoadmapRegenerationRuntime({
            ScheduleService: { runQueuedTopicRoadmapRegenerationOnce: run },
            enabled: () => false,
            setIntervalFn: vi.fn(() => ({ unref: vi.fn() })),
            clearIntervalFn: vi.fn(),
            now: () => new Date('2026-07-29T00:00:00.000Z')
        })

        runtime.start()
        await Promise.resolve()
        expect(run).not.toHaveBeenCalled()
        expect(runtime.status()).toMatchObject({ schedulerActive: false, workerActive: false })
        runtime.stop()
    })
})
