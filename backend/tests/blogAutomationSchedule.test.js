import { beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const {
    calculateNextRun,
    normalizeSchedulePayload,
    zonedTimeToUtc
} = require('../src/utils/blogSchedule.util');
const {
    buildDraft,
    buildSearchConsoleContext,
    decideTopicAction,
    synthesizePatterns
} = require('../src/services/agenticBlogCore.service');

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
        expect(result.agentConfig.productSeeding).toMatchObject({ mode: 'auto', intensity: 'light' });
    });

    it('persists validated product-seeding schedule options', () => {
        const result = normalizeSchedulePayload({
            name: 'Required product blog', scheduleType: 'daily', daily: { times: ['09:00'] },
            agentConfig: { productSeeding: { enabled: true, mode: 'required', intensity: 'balanced', maxSupportingProducts: 1, excludedProductIds: ['p1'] } }
        });
        expect(result.agentConfig.productSeeding).toMatchObject({ enabled: true, mode: 'required', intensity: 'balanced', maxSupportingProducts: 1, excludedProductIds: ['p1'] });
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

describe('Agentic Blog Core V2 planning', () => {
    it('chooses new when no internal article materially overlaps', () => {
        expect(decideTopicAction({ topic: 'Bao quan am sieu toc', existing: [] }).decision).toBe('new');
    });

    it('chooses merge when multiple existing articles overlap the same intent', () => {
        const result = decideTopicAction({
            topic: 'Cach chon noi inox 304',
            existing: [
                { _id: '1', blog_title: 'Cach chon noi inox 304', blog_tags: [], updatedAt: new Date() },
                { _id: '2', blog_title: 'Cach chon noi inox 304', blog_tags: ['noi inox'], updatedAt: new Date() }
            ]
        });
        expect(result.decision).toBe('merge');
        expect(result.targets).toHaveLength(2);
    });

    it('falls back safely when Search Console is absent without inventing metrics', () => {
        expect(buildSearchConsoleContext({})).toMatchObject({ configured: false, fallback: true, metrics: [] });
    });

    it('chooses skip for a recent article with the same intent', () => {
        const result = decideTopicAction({
            topic: 'Cach chon noi inox 304',
            existing: [{ _id: '1', blog_title: 'Cach chon noi inox 304', blog_tags: ['noi inox 304'], updatedAt: new Date() }]
        });
        expect(result.decision).toBe('skip');
    });

    it('chooses update for an old overlapping article instead of creating a new URL', () => {
        const result = decideTopicAction({
            topic: 'Cach chon noi inox 304',
            now: new Date('2026-07-11T00:00:00Z'),
            existing: [{ _id: '1', blog_title: 'Cach chon noi inox 304', blog_tags: [], updatedAt: new Date('2025-01-01T00:00:00Z') }]
        });
        expect(result.decision).toBe('update');
        expect(result.targets).toHaveLength(1);
    });

    it('synthesizes abstract patterns without source or author identities', () => {
        const result = synthesizePatterns([
            { openingPattern: 'problem-first', narrativeMode: 'practical-advisory', sectionRhythm: 'short-long-short', evidenceMode: 'examples', headingStyle: 'question-led', visualDensity: 'low' },
            { openingPattern: 'answer-first', narrativeMode: 'comparison-advisory', sectionRhythm: 'medium-short-medium', evidenceMode: 'source-plus-explanation', headingStyle: 'action-led', visualDensity: 'medium' }
        ]);
        expect(result.synthesisRule).toContain('identities');
        expect(JSON.stringify(result)).not.toContain('competitor');
    });

    it('builds materially different structure for comparison and diagnostic styles', () => {
        const base = {
            topic: 'noi inox',
            primaryKeyword: 'noi inox',
            architecture: {
                headings: [
                    { heading: 'Dau hieu can kiem tra', answerBlock: true },
                    { heading: 'Cach danh gia', answerBlock: false },
                    { heading: 'Lua chon phu hop', answerBlock: false },
                    { heading: 'Tu kiem tra', answerBlock: true }
                ]
            }
        };
        const comparison = buildDraft({ ...base, style: { styleFamily: 'comparison-led', openingMode: 'direct-answer' } });
        const diagnostic = buildDraft({ ...base, style: { styleFamily: 'diagnostic-guide', openingMode: 'symptom-first' } });
        expect(comparison).toContain('<table>');
        expect(diagnostic).not.toContain('<table>');
        expect(comparison).not.toBe(diagnostic);
    });

    it('uses article sub-variants to change real section composition and CTA output', () => {
        const base = {
            topic: 'chảo inox', primaryKeyword: 'chảo inox',
            architecture: {
                headings: [
                    { heading: 'Mở đầu', answerBlock: true }, { heading: 'Kiểm tra', answerBlock: false },
                    { heading: 'Đối chiếu', answerBlock: false }, { heading: 'Quyết định', answerBlock: true }
                ]
            },
            style: { styleFamily: 'answer-first', openingMode: 'context-first', ctaMode: 'next-best-action' }
        };
        const first = buildDraft({ ...base, variantIndex: 1 });
        const second = buildDraft({ ...base, variantIndex: 2 });
        expect(first).not.toBe(second);
        expect(first).toContain('Câu hỏi thường gặp');
        expect(second).not.toContain('Câu hỏi thường gặp');
        expect(first).toContain('một tiêu chí còn thiếu dữ liệu');
    });
});
