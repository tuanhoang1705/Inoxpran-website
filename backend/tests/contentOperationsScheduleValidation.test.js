import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
    defaultSchedule,
    normalizeSchedule
} = require('../src/services/contentOperations/contentOperationsAdmin.service')

describe('Content Operations schedule contract', () => {
    it('requires a configured subject for fixed_brief mode', () => {
        expect(() => normalizeSchedule({
            mode: 'fixed_brief',
            topic: '',
            primaryKeyword: ''
        }, defaultSchedule())).toThrow('fixed_brief mode requires topic or primaryKeyword')
    })

    it('persists bounded fixed-brief topic and keyword fields', () => {
        const schedule = normalizeSchedule({
            mode: 'fixed_brief',
            topic: '  Cách chọn nồi inox an toàn  ',
            primaryKeyword: '  nồi inox an toàn  '
        }, defaultSchedule())

        expect(schedule).toMatchObject({
            mode: 'fixed_brief',
            topic: 'Cách chọn nồi inox an toàn',
            primaryKeyword: 'nồi inox an toàn',
            draftOnly: true
        })
    })

    it('preserves interval schedules instead of coercing them to daily', () => {
        const schedule = normalizeSchedule({
            scheduleType: 'interval',
            interval: { value: 8, unit: 'hours' },
            mode: 'best_action'
        }, defaultSchedule())

        expect(schedule.scheduleType).toBe('interval')
        expect(schedule.interval).toEqual({ value: 8, unit: 'hours' })
        expect(schedule.daily).toEqual({ times: ['06:30'] })
    })

    it('normalizes supported source aliases to the canonical backend contract', () => {
        const schedule = normalizeSchedule({
            sourceRequirements: ['searchConsole', 'analytics', 'contentInventory', 'products']
        }, defaultSchedule())

        expect(schedule.sourceRequirements).toEqual([
            'google_search_console',
            'first_party_aggregate_analytics',
            'content_inventory',
            'product_catalog'
        ])
    })
})
