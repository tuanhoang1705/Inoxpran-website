import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Module } = require('node:module');

const ORIGINAL_ENV = { ...process.env };
const SCHEDULE_ID = '507f1f77bcf86cd799439071';
const EXECUTION_ID = '507f1f77bcf86cd799439072';

const scheduleMock = {
    findById: vi.fn(),
    findOneAndUpdate: vi.fn(),
    updateOne: vi.fn()
};
const executionMock = {
    countDocuments: vi.fn(),
    create: vi.fn(),
    findById: vi.fn(),
    findOne: vi.fn(),
    updateOne: vi.fn()
};
const runPipelineMock = vi.fn();

const installMock = (modulePath, exports) => {
    const resolvedPath = require.resolve(modulePath);
    const mockModule = new Module(resolvedPath);
    mockModule.exports = exports;
    require.cache[resolvedPath] = mockModule;
};

installMock('../src/models/blogAutomationSchedule.model', {
    BlogAutomationSchedule: scheduleMock
});
installMock('../src/models/blogAutomationExecution.model', {
    BlogAutomationExecution: executionMock
});
installMock('../src/services/automationSeoBlog.service', {
    publishSeoBlog: vi.fn()
});
installMock('../src/services/agenticBlogCore.service', {
    AgenticBlogCoreService: { runPipeline: runPipelineMock }
});
installMock('../src/services/telegramApproval.service', {
    TelegramApprovalService: {
        isEnabled: vi.fn(() => false),
        createDraftApprovalAndNotify: vi.fn()
    }
});
installMock('../src/services/productSeedPlanning.service', {
    ProductSeedPlanningService: { attachExecution: vi.fn() }
});
installMock('../src/services/editorialProductPlacementPlanning.service', {
    EditorialProductPlacementPlanningService: { attachRelations: vi.fn() }
});

delete require.cache[require.resolve('../src/services/blogAutomationSchedule.service')];
const {
    BlogAutomationScheduleService,
    buildRealTaskCountQuery,
    getScheduleDayBounds,
    mapExecution,
    mapSchedule
} = require('../src/services/blogAutomationSchedule.service');
const { ContentWorkOrderService } = require('../src/services/contentOperations/workOrder.service');

const baseSchedule = (overrides = {}) => ({
    _id: SCHEDULE_ID,
    name: 'Daily content operations',
    enabled: true,
    scheduleType: 'daily',
    timezone: 'Asia/Ho_Chi_Minh',
    daily: { times: ['06:30'] },
    weekly: { daysOfWeek: [], times: [] },
    interval: { value: 24, unit: 'hours' },
    runLimit: 0,
    runCount: 0,
    maximumTasksPerDay: 1,
    nextRunAt: new Date('2026-07-19T23:30:00.000Z'),
    lockedBy: 'worker:test-lease',
    ...overrides
});

const leanResult = (value) => ({ lean: vi.fn().mockResolvedValue(value) });
const selectLeanResult = (value) => ({
    select: vi.fn(() => ({ lean: vi.fn().mockResolvedValue(value) }))
});

beforeEach(() => {
    process.env = {
        ...ORIGINAL_ENV,
        OPENCLAW_BLOG_CRON_ENABLED: 'true',
        SEO_AGENT_ENABLED: 'true',
        SEO_AGENT_AUTO_PUBLISH: 'false'
    };
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T12:00:00.000Z'));
    scheduleMock.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    executionMock.countDocuments.mockResolvedValue(0);
    executionMock.findById.mockReturnValue(leanResult(null));
    executionMock.findOne.mockReturnValue(leanResult(null));
    executionMock.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
});

describe('BlogAutomationScheduleService concurrency and recovery', () => {
    it('redacts historical raw scheduler and execution errors on read', () => {
        const raw = 'https://private.invalid/failure?access_token=secret-value';
        expect(mapSchedule(baseSchedule({ lastError: raw })).lastError).toBe('INTERNAL_ERROR');
        expect(mapSchedule(baseSchedule({ lastError: 'skLiveSecretToken123456789' })).lastError).toBe('INTERNAL_ERROR');
        const mapped = mapExecution({
            _id: EXECUTION_ID,
            executionKey: 'legacy',
            status: 'failed',
            error: raw,
            telegramNotificationError: raw,
            metadata: {
                contentWorkOrderClaimToken: 'worker:secret-token',
                leaseOwner: 'lease-secret',
                trigger: 'scheduled'
            }
        });
        expect(mapped).toMatchObject({
            error: 'INTERNAL_ERROR',
            telegramNotificationError: 'INTERNAL_ERROR',
            metadata: { trigger: 'scheduled' }
        });
        expect(JSON.stringify(mapped)).not.toContain('secret-token');
    });

    it('uses a unique ownership token for every scheduled claim', async () => {
        scheduleMock.findOneAndUpdate.mockImplementation((_filter, update) =>
            leanResult(baseSchedule({ lockedBy: update.$set.lockedBy }))
        );

        const first = await BlogAutomationScheduleService.claimDueSchedule({
            workerId: 'scheduler-1',
            now: new Date()
        });
        const second = await BlogAutomationScheduleService.claimDueSchedule({
            workerId: 'scheduler-1',
            now: new Date()
        });

        expect(first.lockedBy).toMatch(/^scheduler-1:/);
        expect(second.lockedBy).toMatch(/^scheduler-1:/);
        expect(first.lockedBy).not.toBe(second.lockedBy);
    });

    it('atomically rejects a second manual run before either execution is queued', async () => {
        let claimed = false;
        scheduleMock.findOneAndUpdate.mockImplementation((_filter, update) => {
            if (claimed) return leanResult(null);
            claimed = true;
            return leanResult(baseSchedule({ lockedBy: update.$set.lockedBy }));
        });
        scheduleMock.findById.mockReturnValue(selectLeanResult({ _id: SCHEDULE_ID }));
        executionMock.findOne.mockReturnValue(selectLeanResult(null));
        const execute = vi.spyOn(BlogAutomationScheduleService, 'executeSchedule').mockResolvedValue({ queued: true });

        const first = await BlogAutomationScheduleService.runNow({ scheduleId: SCHEDULE_ID });
        await expect(BlogAutomationScheduleService.runNow({ scheduleId: SCHEDULE_ID }))
            .rejects.toThrow('active run');
        await Promise.resolve();

        expect(first.queued).toBe(true);
        expect(execute).toHaveBeenCalledTimes(1);
        expect(scheduleMock.findOneAndUpdate.mock.calls[0][0]).toMatchObject({
            _id: expect.anything(),
            $or: expect.any(Array)
        });
    });

    it('counts only selected non-skip tasks inside the schedule local day', () => {
        const now = new Date('2026-07-20T18:00:00.000Z'); // 01:00 on July 21 in Ho Chi Minh City
        const schedule = baseSchedule();
        const bounds = getScheduleDayBounds({ schedule, now });
        const query = buildRealTaskCountQuery({ scheduleId: SCHEDULE_ID, schedule, now });

        expect(bounds.start.toISOString()).toBe('2026-07-20T17:00:00.000Z');
        expect(bounds.end.toISOString()).toBe('2026-07-21T17:00:00.000Z');
        expect(query.contentAction).toEqual({
            $exists: true,
            $nin: ['', 'skip', null]
        });
        expect(query.status.$in).not.toContain('skipped');
    });

    it('enforces maximumTasksPerDay without creating or counting another execution', async () => {
        const schedule = baseSchedule();
        executionMock.countDocuments.mockResolvedValue(1);

        const result = await BlogAutomationScheduleService.executeSchedule({
            schedule,
            trigger: 'scheduled',
            dueAt: schedule.nextRunAt,
            lockOwner: schedule.lockedBy
        });

        expect(result.reason).toBe('maximum_tasks_per_day_reached');
        expect(executionMock.create).not.toHaveBeenCalled();
        expect(executionMock.countDocuments.mock.calls[0][0].contentAction.$nin).toContain('skip');
        expect(executionMock.countDocuments.mock.calls[0][0].status.$in).not.toContain('skipped');
        const [filter, update] = scheduleMock.updateOne.mock.calls[0];
        expect(String(filter._id)).toBe(SCHEDULE_ID);
        expect(filter.lockedBy).toBe(schedule.lockedBy);
        expect(update.$inc).toBeUndefined();
        expect(update.$unset).toEqual({ leaseUntil: '', lockedBy: '' });
    });

    it('recovers a stale duplicate execution and advances the owned schedule lease', async () => {
        const schedule = baseSchedule();
        executionMock.findOne.mockReturnValue(leanResult({
            _id: EXECUTION_ID,
            status: 'running',
            contentAction: 'new'
        }));

        const result = await BlogAutomationScheduleService.executeSchedule({
            schedule,
            trigger: 'scheduled',
            dueAt: schedule.nextRunAt,
            lockOwner: schedule.lockedBy
        });

        expect(result.reason).toBe('duplicate_execution_recovered');
        expect(executionMock.create).not.toHaveBeenCalled();
        expect(executionMock.countDocuments).not.toHaveBeenCalled();
        expect(runPipelineMock).not.toHaveBeenCalled();
        expect(executionMock.updateOne).toHaveBeenCalledWith(
            expect.objectContaining({
                _id: EXECUTION_ID,
                status: 'running',
                $or: expect.any(Array)
            }),
            expect.objectContaining({
                $set: expect.objectContaining({ status: 'failed' }),
                $inc: { retryCount: 1 }
            })
        );
        const [filter, update] = scheduleMock.updateOne.mock.calls[0];
        expect(filter.lockedBy).toBe(schedule.lockedBy);
        expect(update.$inc).toEqual({ runCount: 1 });
        expect(update.$unset).toEqual({ leaseUntil: '', lockedBy: '' });
        expect(update.$set.nextRunAt.getTime()).toBeGreaterThan(schedule.nextRunAt.getTime());
    });

    it('also releases and advances when a duplicate wins between preflight and create', async () => {
        const schedule = baseSchedule();
        const duplicate = { _id: EXECUTION_ID, status: 'skipped', contentAction: 'skip' };
        executionMock.findOne
            .mockReturnValueOnce(leanResult(null))
            .mockReturnValueOnce(leanResult(duplicate));
        executionMock.create.mockRejectedValue(Object.assign(new Error('duplicate'), { code: 11000 }));

        const result = await BlogAutomationScheduleService.executeSchedule({
            schedule,
            trigger: 'scheduled',
            dueAt: schedule.nextRunAt,
            lockOwner: schedule.lockedBy
        });

        expect(result.reason).toBe('duplicate_execution_recovered');
        expect(executionMock.create).toHaveBeenCalledTimes(1);
        expect(runPipelineMock).not.toHaveBeenCalled();
        const [filter, update] = scheduleMock.updateOne.mock.calls[0];
        expect(filter.lockedBy).toBe(schedule.lockedBy);
        expect(update.$set.lastRunStatus).toBe('skipped');
        expect(update.$unset).toEqual({ leaseUntil: '', lockedBy: '' });
    });

    it('guards completion by lock owner and never writes enabled=true from stale state', async () => {
        const schedule = baseSchedule();
        executionMock.create.mockResolvedValue({
            _id: EXECUTION_ID,
            toObject: () => ({ _id: EXECUTION_ID })
        });
        runPipelineMock.mockResolvedValue({
            skipped: true,
            blocked: false,
            reason: 'no_actionable_opportunity',
            context: {
                snapshot: { id: '507f1f77bcf86cd799439073' },
                contentPlanning: {
                    candidates: [],
                    sourceHealth: {},
                    sourceFreshness: {}
                },
                opportunity: { decision: 'skip' },
                productSeedPlan: null,
                editorialPlacementPlan: null
            }
        });

        await BlogAutomationScheduleService.executeSchedule({
            schedule,
            trigger: 'scheduled',
            dueAt: schedule.nextRunAt,
            lockOwner: schedule.lockedBy
        });

        const completionCall = scheduleMock.updateOne.mock.calls.at(-1);
        expect(String(completionCall[0]._id)).toBe(SCHEDULE_ID);
        expect(completionCall[0].lockedBy).toBe(schedule.lockedBy);
        expect(completionCall[1].$set.enabled).toBeUndefined();
        expect(completionCall[1].$unset).toEqual({ leaseUntil: '', lockedBy: '' });
        expect(vi.getTimerCount()).toBe(0);
    });

    it('persists only a bounded error code when a scheduled pipeline fails', async () => {
        const schedule = baseSchedule();
        executionMock.create.mockResolvedValue({
            _id: EXECUTION_ID,
            toObject: () => ({ _id: EXECUTION_ID })
        });
        runPipelineMock.mockRejectedValue(
            new Error('fetch https://private.invalid/run?access_token=secret-value failed')
        );

        await expect(BlogAutomationScheduleService.executeSchedule({
            schedule,
            trigger: 'scheduled',
            dueAt: schedule.nextRunAt,
            lockOwner: schedule.lockedBy
        })).rejects.toThrow();

        const executionFailure = executionMock.updateOne.mock.calls.find(
            ([, update]) => update?.$set?.status === 'failed'
        );
        expect(executionFailure?.[1]?.$set?.error).toBe('BLOG_SCHEDULE_EXECUTION_FAILED');
        const scheduleFailure = scheduleMock.updateOne.mock.calls.at(-1);
        expect(scheduleFailure?.[1]?.$set?.lastError).toBe('BLOG_SCHEDULE_EXECUTION_FAILED');
        expect(JSON.stringify({ executionFailure, scheduleFailure })).not.toContain('secret-value');
    });

    it('does not mutate a replacement Work Order claim but terminalizes the stale worker own execution', async () => {
        const schedule = baseSchedule();
        const workOrderId = '507f1f77bcf86cd799439074';
        const staleClaimToken = 'writer-a:stale-claim';
        executionMock.create.mockResolvedValue({
            _id: EXECUTION_ID,
            toObject: () => ({ _id: EXECUTION_ID })
        });
        executionMock.findById.mockReturnValue(leanResult({
            _id: EXECUTION_ID,
            status: 'running',
            contentWorkOrderId: workOrderId,
            metadata: { contentWorkOrderClaimToken: staleClaimToken }
        }));
        runPipelineMock.mockRejectedValue(Object.assign(new Error('stale worker failed late'), {
            code: 'WRITER_FAILED'
        }));
        const workOrderTransition = vi.spyOn(ContentWorkOrderService, 'transitionClaimed').mockResolvedValue(null);
        const executionTransition = vi.spyOn(ContentWorkOrderService, 'transitionExecutionClaimed').mockResolvedValue(false);

        await expect(BlogAutomationScheduleService.executeSchedule({
            schedule,
            trigger: 'scheduled',
            dueAt: schedule.nextRunAt,
            lockOwner: schedule.lockedBy
        })).rejects.toThrow('stale worker failed late');

        expect(workOrderTransition).toHaveBeenCalledWith({
            workOrderId,
            claimToken: staleClaimToken,
            status: 'blocked',
            updates: { 'metadata.lastFailureCode': 'WRITER_FAILED' }
        });
        expect(executionTransition).toHaveBeenCalledWith({
            executionId: EXECUTION_ID,
            workOrderId,
            claimToken: staleClaimToken,
            status: 'failed',
            updates: { error: 'WRITER_FAILED' }
        });
        expect(executionMock.updateOne.mock.calls.some(([, update]) => update?.$set?.status === 'failed')).toBe(false);
    });
});
