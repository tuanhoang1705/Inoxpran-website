import { beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const {
    calculateNextRun,
    normalizeSchedulePayload,
    zonedTimeToUtc
} = require('../src/utils/blogSchedule.util');
const { buildAutomationPayload } = require('../src/services/blogAutomationSchedule.service');

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, SEO_AGENT_AUTO_PUBLISH: 'false' };
});

describe('blogSchedule util', () => {
    it('normalizes daily schedules with multiple unique HH:mm times', () => {
        const result = normalizeSchedulePayload({
            name: 'Daily blog',
            scheduleType: 'daily',
            daily: { times: ['9:00', '09:00', '14:30'] }
        });

        expect(result.daily.times).toEqual(['09:00', '14:30']);
        expect(result.timezone).toBe('Asia/Ho_Chi_Minh');
    });

    it('calculates the next daily run in the configured timezone', () => {
        const from = new Date('2026-07-10T01:00:00.000Z'); // 08:00 Asia/Ho_Chi_Minh
        const schedule = normalizeSchedulePayload({
            name: 'Daily blog',
            scheduleType: 'daily',
            timezone: 'Asia/Ho_Chi_Minh',
            daily: { times: ['09:30'] }
        });

        const next = calculateNextRun({ schedule, from });

        expect(next.toISOString()).toBe('2026-07-10T02:30:00.000Z');
    });

    it('calculates the next weekly run by local day of week', () => {
        const from = new Date('2026-07-10T03:00:00.000Z'); // Friday
        const schedule = normalizeSchedulePayload({
            name: 'Weekly blog',
            scheduleType: 'weekly',
            timezone: 'Asia/Ho_Chi_Minh',
            weekly: {
                daysOfWeek: [1],
                times: ['08:00']
            }
        });

        const next = calculateNextRun({ schedule, from });

        expect(next.toISOString()).toBe('2026-07-13T01:00:00.000Z');
    });

    it('rejects unsafe short intervals', () => {
        expect(() => normalizeSchedulePayload({
            name: 'Fast blog',
            scheduleType: 'interval',
            interval: { value: 2, unit: 'minutes' }
        })).toThrow('interval must be at least 5 minutes');
    });

    it('returns null when run limit has been reached', () => {
        const schedule = normalizeSchedulePayload({
            name: 'Limited blog',
            scheduleType: 'daily',
            daily: { times: ['09:00'] },
            runLimit: 1
        });

        expect(calculateNextRun({
            schedule: { ...schedule, runCount: 1 },
            from: new Date('2026-07-10T00:00:00.000Z')
        })).toBeNull();
    });

    it('converts local wall time to UTC for Asia/Ho_Chi_Minh', () => {
        expect(zonedTimeToUtc({
            year: 2026,
            month: 7,
            day: 10,
            hour: 9,
            minute: 0,
            timeZone: 'Asia/Ho_Chi_Minh'
        }).toISOString()).toBe('2026-07-10T02:00:00.000Z');
    });
});

describe('blog automation payload', () => {
    it('forces draft mode when SEO_AGENT_AUTO_PUBLISH=false', () => {
        process.env.SEO_AGENT_AUTO_PUBLISH = 'false';
        const payload = buildAutomationPayload({
            schedule: {
                _id: '507f1f77bcf86cd799439011',
                name: 'Noi inox 304',
                autoPublish: true,
                agentConfig: {
                    topic: 'Noi inox 304 co dung duoc bep tu khong',
                    primaryKeyword: 'noi inox 304'
                }
            },
            executionKey: 'test-key',
            now: new Date('2026-07-10T00:00:00.000Z')
        });

        expect(payload.mode).toBe('draft');
        expect(payload.source).toBe('openclaw-daily-seo');
        expect(payload.metadata.executionKey).toBe('test-key');
    });

    it('requests publish only when schedule and global flag both allow it', () => {
        process.env.SEO_AGENT_AUTO_PUBLISH = 'true';
        const payload = buildAutomationPayload({
            schedule: {
                _id: '507f1f77bcf86cd799439011',
                name: 'Noi inox 304',
                autoPublish: true,
                agentConfig: { topic: 'Noi inox 304' }
            },
            executionKey: 'test-key'
        });

        expect(payload.mode).toBe('publish');
    });
});
