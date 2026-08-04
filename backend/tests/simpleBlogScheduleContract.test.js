import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
    DEFAULT_TIMEZONE,
    calculateNextRun,
    expandSimpleSchedulePayload,
    getZonedParts,
    isSimpleSchedulePayload,
    normalizeSchedulePayload,
    parseSimpleTimes
} = require('../src/utils/blogSchedule.util')
const {
    generateDirectionCandidate,
    generateOpportunityCandidates
} = require('../src/services/contentOperations/opportunityCandidate.service')
const { resolveBlogOpenClawConfig } = require('../src/services/blogOpenClawSettings.service')

const simplePayload = (overrides = {}) => ({
    simple: true,
    name: 'Lịch blog mùa hè',
    direction: 'Các vấn đề gia dụng và làm mát trong mùa hè',
    times: '08:30, 20:00',
    startDate: '2026-07-25',
    endDate: '2026-09-30',
    ...overrides
})

describe('simple blog schedule contract', () => {
    it('detects the simple payload marker without matching advanced payloads', () => {
        expect(isSimpleSchedulePayload(simplePayload())).toBe(true)
        expect(isSimpleSchedulePayload({ direction: 'chủ đề mùa hè' })).toBe(true)
        expect(isSimpleSchedulePayload({ name: 'x', scheduleType: 'daily' })).toBe(false)
    })

    it('normalizes whitespace, removes duplicates, sorts, and rejects invalid times', () => {
        expect(parseSimpleTimes(' 20:15,  8:30 , 08:30, 14:00 ')).toEqual(['08:30', '14:00', '20:15'])
        expect(() => parseSimpleTimes('25:00')).toThrow(/HH:mm/)
        expect(() => parseSimpleTimes('08:61')).toThrow(/HH:mm/)
        expect(() => parseSimpleTimes('8h30')).toThrow(/HH:mm/)
        expect(() => parseSimpleTimes('')).toThrow(/at least one/)
    })

    it('expands to a draft-only best_action daily schedule pinned to Vietnam time', () => {
        const expanded = expandSimpleSchedulePayload(simplePayload())
        expect(expanded).toMatchObject({
            name: 'Lịch blog mùa hè',
            scheduleType: 'daily',
            timezone: DEFAULT_TIMEZONE,
            mode: 'best_action',
            draftOnly: true,
            allowSkip: true,
            autoPublish: false,
            runLimit: 0
        })
        expect(expanded.daily.times).toEqual(['08:30', '20:00'])
        expect(expanded.agentConfig.simpleContract).toBe(true)
        expect(expanded.agentConfig.direction).toBe('Các vấn đề gia dụng và làm mát trong mùa hè')
        expect(expanded.agentConfig.contentAction).toBe('')
        expect(expanded.agentConfig.workOrderId).toBe('')

        const startParts = getZonedParts(expanded.startAt, DEFAULT_TIMEZONE)
        expect([startParts.year, startParts.month, startParts.day, startParts.hour]).toEqual([
            2026, 7, 25, 0
        ])
        const endParts = getZonedParts(expanded.endAt, DEFAULT_TIMEZONE)
        expect([endParts.year, endParts.month, endParts.day, endParts.hour, endParts.minute]).toEqual([
            2026, 9, 30, 23, 59
        ])
    })

    it('keeps draft-only by default and enables quality-gated auto-publish only when the owner opts in', () => {
        const previous = process.env.OPENCLAW_BLOG_AUTO_PUBLISH
        try {
            // Default (flag unset): production behaviour is unchanged — draft only.
            delete process.env.OPENCLAW_BLOG_AUTO_PUBLISH
            const off = expandSimpleSchedulePayload(simplePayload())
            expect(off.draftOnly).toBe(true)
            expect(off.autoPublish).toBe(false)

            // Opt-in: the capability is enabled, but downstream SEO_AGENT_AUTO_PUBLISH
            // and every review/readiness gate still decide each article individually.
            process.env.OPENCLAW_BLOG_AUTO_PUBLISH = 'true'
            const on = expandSimpleSchedulePayload(simplePayload())
            expect(on.draftOnly).toBe(false)
            expect(on.autoPublish).toBe(true)
            expect(on.mode).toBe('best_action')
        } finally {
            if (previous === undefined) delete process.env.OPENCLAW_BLOG_AUTO_PUBLISH
            else process.env.OPENCLAW_BLOG_AUTO_PUBLISH = previous
        }
    })

    it('keeps every production schedule draft-only even when an auto-publish opt-in is present', () => {
        const previousNodeEnv = process.env.NODE_ENV
        const previousAutoPublish = process.env.OPENCLAW_BLOG_AUTO_PUBLISH
        try {
            process.env.NODE_ENV = 'production'
            process.env.OPENCLAW_BLOG_AUTO_PUBLISH = 'true'
            const simple = expandSimpleSchedulePayload(simplePayload())
            expect(simple).toMatchObject({ draftOnly: true, autoPublish: false })
            expect(() => normalizeSchedulePayload({
                ...simple,
                draftOnly: false,
                autoPublish: true
            })).toThrow(/Production Blog schedules must remain draft-only/)
            expect(resolveBlogOpenClawConfig({
                schedule: { ...simple, draftOnly: false, autoPublish: true }
            })).toMatchObject({ draftOnly: true, autoPublish: false })
        } finally {
            if (previousNodeEnv === undefined) delete process.env.NODE_ENV
            else process.env.NODE_ENV = previousNodeEnv
            if (previousAutoPublish === undefined) delete process.env.OPENCLAW_BLOG_AUTO_PUBLISH
            else process.env.OPENCLAW_BLOG_AUTO_PUBLISH = previousAutoPublish
        }
    })

    it('rejects missing required fields and inverted date windows', () => {
        expect(() => expandSimpleSchedulePayload(simplePayload({ name: ' ' }))).toThrow(/name/)
        expect(() => expandSimpleSchedulePayload(simplePayload({ direction: '' }))).toThrow(/direction/)
        expect(() => expandSimpleSchedulePayload(simplePayload({ startDate: '' }))).toThrow(/startDate/)
        expect(() => expandSimpleSchedulePayload(simplePayload({ startDate: '2026-02-30' }))).toThrow(/calendar/)
        expect(() => expandSimpleSchedulePayload(simplePayload({ endDate: '2026-07-24' }))).toThrow(/endDate/)
        expect(() => expandSimpleSchedulePayload(simplePayload({ enabled: 'yes' }))).toThrow(/enabled/)
    })

    it('supports open-ended schedules and full normalization round-trip', () => {
        const expanded = expandSimpleSchedulePayload(simplePayload({ endDate: '' }))
        expect(expanded.endAt).toBeNull()
        const normalized = normalizeSchedulePayload(expanded)
        expect(normalized.scheduleType).toBe('daily')
        expect(normalized.timezone).toBe(DEFAULT_TIMEZONE)
        expect(normalized.mode).toBe('best_action')
        expect(normalized.draftOnly).toBe(true)
        expect(normalized.autoPublish).toBe(false)
        expect(normalized.daily.times).toEqual(['08:30', '20:00'])
        expect(normalized.agentConfig.simpleContract).toBe(true)
        expect(normalized.agentConfig.direction).toBe(
            'Các vấn đề gia dụng và làm mát trong mùa hè'
        )
    })

    it('preserves internal compatibility fields from the previous agentConfig', () => {
        const expanded = expandSimpleSchedulePayload(simplePayload(), {
            currentAgentConfig: {
                generateImages: false,
                legacyConfig: { scheduleType: 'interval' }
            }
        })
        expect(expanded.agentConfig.generateImages).toBe(false)
        expect(expanded.agentConfig.legacyConfig).toEqual({ scheduleType: 'interval' })
    })

    it('never runs before the start date or after the end date', () => {
        const schedule = {
            enabled: true,
            ...expandSimpleSchedulePayload(simplePayload())
        }
        const beforeStart = calculateNextRun({
            schedule,
            from: new Date('2026-07-01T00:00:00.000Z')
        })
        const firstParts = getZonedParts(beforeStart, DEFAULT_TIMEZONE)
        expect([firstParts.year, firstParts.month, firstParts.day, firstParts.hour, firstParts.minute]).toEqual([
            2026, 7, 25, 8, 30
        ])
        const afterEnd = calculateNextRun({
            schedule,
            from: new Date('2026-10-05T00:00:00.000Z')
        })
        expect(afterEnd).toBeNull()
    })
})

describe('direction guidance candidate', () => {
    const snapshot = { googleIntelSnapshotId: 'a'.repeat(24) }

    it('adds the schedule direction as a competing candidate in best_action mode', () => {
        const candidates = generateOpportunityCandidates({
            snapshot,
            inventoryItems: [],
            signals: [],
            input: { topic: 'chọn quạt điều hoà cho gia đình' },
            mode: 'best_action'
        })
        const direction = candidates.find((item) => /guidance only/.test(item.decisionReason || ''))
        expect(direction).toBeTruthy()
        expect(direction.decisionType).toBe('new')
        expect(direction.topic).toBe('chọn quạt điều hoà cho gia đình')
    })

    it('does not force the direction candidate in fixed_brief mode', () => {
        const candidates = generateOpportunityCandidates({
            snapshot,
            inventoryItems: [],
            signals: [],
            input: { topic: 'chủ đề cố định' },
            mode: 'fixed_brief'
        })
        expect(candidates.every((item) => !/guidance only/.test(item.decisionReason || ''))).toBe(true)
    })

    it('returns null without a topic', () => {
        expect(generateDirectionCandidate({ input: {}, snapshot })).toBeNull()
    })
})

describe('BOS resolved configuration snapshot', () => {
    it('captures versions and effective flags without secrets', () => {
        const snapshot = resolveBlogOpenClawConfig({
            schedule: {
                _id: 'b'.repeat(24),
                mode: 'best_action',
                draftOnly: true,
                agentConfig: { simpleContract: true }
            },
            now: new Date('2026-07-25T01:30:00.000Z')
        })
        expect(snapshot.configVersion).toBe('bos-config-v1')
        expect(snapshot.policyVersion).toBe('content-operations-v3')
        expect(snapshot.decisionVersion).toBe('opportunity-decision-v3')
        expect(snapshot.scheduleId).toBe('b'.repeat(24))
        expect(snapshot.simpleContract).toBe(true)
        expect(snapshot.draftOnly).toBe(true)
        expect(snapshot.autoPublish).toBe(false)
        const serialized = JSON.stringify(snapshot).toLowerCase()
        for (const forbidden of ['token', 'secret', 'password', 'apikey', 'hmac']) {
            expect(serialized).not.toContain(forbidden)
        }
    })
})
