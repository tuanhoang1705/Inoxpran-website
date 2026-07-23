import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    AgenticBlogQaBatchService,
    normalizeCaseInput
} = require('../src/services/agenticBlogQa.service');
const { AgenticBlogQaCase } = require('../src/models/agenticBlogQaCase.model');

const ids = Object.freeze({
    batch: '507f1f77bcf86cd799439301',
    dailyCase: '507f1f77bcf86cd799439302',
    scheduleNowCase: '507f1f77bcf86cd799439303',
    dueCase: '507f1f77bcf86cd799439304',
    dailySchedule: '507f1f77bcf86cd799439305',
    scheduleNowSchedule: '507f1f77bcf86cd799439306',
    dueSchedule: '507f1f77bcf86cd799439307',
    dailyExecution: '507f1f77bcf86cd799439308',
    scheduleNowExecution: '507f1f77bcf86cd799439309',
    admin: '507f1f77bcf86cd799439310'
});

const config = Object.freeze({
    enabled: true,
    environment: 'local',
    databaseName: 'inoxpran_qa_local',
    requireAllCasesPass: true
});

const chainResult = (value) => ({
    sort: vi.fn(() => ({ lean: vi.fn().mockResolvedValue(value) }))
});

describe('Agentic Blog QA source-only entrypoint dispatch', () => {
    it('keeps every retained QA case in fixed-brief mode and preserves reviewed product controls', () => {
        expect(AgenticBlogQaCase.schema.path('scheduleMode').enumValues).toEqual(['fixed_brief']);
        expect(AgenticBlogQaCase.schema.path('scheduleMode').defaultValue).toBe('fixed_brief');

        const productOff = normalizeCaseInput({
            caseKey: 'RUN-NOW-OFF',
            executionMode: 'run_now',
            originalTopicSeed: 'Safe care guide',
            articleType: 'how-to',
            contentRole: 'task completion',
            searchIntent: 'how-to',
            productMode: 'off',
            productIntensity: 'light'
        }, 0);
        const productAuto = normalizeCaseInput({
            caseKey: 'SCHEDULE-NOW-AUTO',
            executionMode: 'schedule_run_now',
            originalTopicSeed: 'Selection guide',
            articleType: 'buying-guide',
            contentRole: 'decision support',
            searchIntent: 'commercial investigation',
            productMode: 'auto',
            productIntensity: 'balanced',
            placementStyle: 'criteria-first-recommendation'
        }, 1);

        expect(productOff).toMatchObject({ executionMode: 'run_now', productMode: 'off', placementStyle: '' });
        expect(productAuto).toMatchObject({
            executionMode: 'schedule_run_now',
            productMode: 'auto',
            productIntensity: 'balanced',
            placementStyle: 'criteria-first-recommendation'
        });
    });

    it('dispatches Daily Draft Run Now, Schedule Run Now, and actual due schedule through distinct trusted paths', async () => {
        const now = new Date('2026-07-22T05:00:00.000Z');
        const cases = [
            {
                _id: ids.dailyCase,
                caseKey: 'LOCAL-RUNNOW-01',
                isQaTest: true,
                executionMode: 'run_now',
                scheduleMode: 'fixed_brief',
                scheduleId: ids.dailySchedule,
                status: 'reserved',
                runAttempts: []
            },
            {
                _id: ids.scheduleNowCase,
                caseKey: 'LOCAL-SCHEDULE-RUNNOW-01',
                isQaTest: true,
                executionMode: 'schedule_run_now',
                scheduleMode: 'fixed_brief',
                scheduleId: ids.scheduleNowSchedule,
                status: 'reserved',
                runAttempts: []
            },
            {
                _id: ids.dueCase,
                caseKey: 'LOCAL-SCHEDULE-01',
                isQaTest: true,
                executionMode: 'actual_schedule',
                scheduleMode: 'fixed_brief',
                scheduleId: ids.dueSchedule,
                status: 'reserved',
                runAttempts: []
            }
        ];
        const batch = {
            _id: ids.batch,
            isQaTest: true,
            environment: 'local',
            status: 'planned',
            stopNewDrafts: false,
            iteration: 0,
            caseIds: cases.map(item => item._id)
        };
        const BatchModel = {
            findOne: vi.fn(() => ({ lean: vi.fn().mockResolvedValue(batch) })),
            updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 })
        };
        const CaseModel = {
            find: vi.fn(() => chainResult(cases)),
            findById: vi.fn(),
            updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 })
        };
        const ScheduleModel = {
            findOne: vi.fn(() => ({ lean: vi.fn().mockResolvedValue({ isQaTest: true }) })),
            updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 })
        };
        const ScheduleService = {
            runDailyDraftForQa: vi.fn().mockResolvedValue({
                executionId: ids.dailyExecution,
                status: 'queued',
                duplicate: false
            }),
            runNow: vi.fn().mockResolvedValue({
                executionId: ids.scheduleNowExecution,
                status: 'queued',
                duplicate: false
            })
        };
        const service = new AgenticBlogQaBatchService({
            BatchModel,
            CaseModel,
            ScheduleModel,
            ScheduleService,
            EnsureInfrastructure: vi.fn().mockResolvedValue({ ensured: true }),
            config,
            now: () => now
        });

        const result = await service.runBatch({
            batchId: ids.batch,
            adminId: ids.admin,
            idempotencyKey: 'qa-entrypoints-001'
        });

        expect(ScheduleService.runDailyDraftForQa).toHaveBeenCalledTimes(1);
        expect(ScheduleService.runDailyDraftForQa).toHaveBeenCalledWith(expect.objectContaining({
            scheduleId: ids.dailySchedule,
            trustedQaRun: true,
            qaIteration: 0,
            adminId: ids.admin
        }));
        expect(ScheduleService.runNow).toHaveBeenCalledTimes(1);
        expect(ScheduleService.runNow).toHaveBeenCalledWith(expect.objectContaining({
            scheduleId: ids.scheduleNowSchedule,
            trustedQaRun: true,
            qaIteration: 0,
            adminId: ids.admin
        }));
        expect(ScheduleModel.updateOne).toHaveBeenCalledTimes(1);
        expect(ScheduleModel.updateOne).toHaveBeenCalledWith(
            expect.objectContaining({
                _id: ids.dueSchedule,
                isQaTest: true,
                qaCaseId: ids.dueCase,
                qaBatchId: expect.anything()
            }),
            expect.objectContaining({
                $set: expect.objectContaining({
                    enabled: true,
                    nextRunAt: new Date('2026-07-22T05:01:00.000Z'),
                    qaIteration: 0
                })
            })
        );
        expect(result.queued.map(item => item.executionMode)).toEqual([
            'run_now',
            'schedule_run_now',
            'actual_schedule'
        ]);
        expect(result.queued[2]).toMatchObject({ scheduled: true });
        expect(result.requireAllCasesPass).toBe(true);
        expect(BatchModel.findOne).toHaveBeenCalledWith({
            _id: expect.anything(),
            environment: 'local',
            isQaTest: true
        });
        expect(CaseModel.find).toHaveBeenCalledWith({
            batchId: expect.anything(),
            environment: 'local',
            isQaTest: true
        });
    });

    it('replays one semantic run slot across different transport idempotency keys without redispatch', async () => {
        const retainedAttempt = {
            attempt: 1,
            batchIteration: 0,
            executionMode: 'run_now',
            executionId: ids.dailyExecution,
            status: 'queued',
            dispatchState: 'dispatched'
        };
        const qaCase = {
            _id: ids.dailyCase,
            caseKey: 'LOCAL-RUNNOW-01',
            executionMode: 'run_now',
            scheduleId: ids.dailySchedule,
            status: 'queued',
            runAttempts: [retainedAttempt]
        };
        const batch = {
            _id: ids.batch,
            isQaTest: true,
            environment: 'local',
            status: 'running',
            stopNewDrafts: false,
            iteration: 0,
            caseIds: [ids.dailyCase]
        };
        const BatchModel = {
            findOne: vi.fn(() => ({ lean: vi.fn().mockResolvedValue(batch) })),
            updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 })
        };
        const CaseModel = {
            find: vi.fn(() => chainResult([qaCase])),
            updateOne: vi.fn()
        };
        const ScheduleService = {
            runDailyDraftForQa: vi.fn(),
            runNow: vi.fn()
        };
        const ScheduleModel = {
            findOne: vi.fn(() => ({ lean: vi.fn().mockResolvedValue({ isQaTest: true }) }))
        };
        const service = new AgenticBlogQaBatchService({
            BatchModel,
            CaseModel,
            ScheduleModel,
            ScheduleService,
            EnsureInfrastructure: vi.fn().mockResolvedValue({ ensured: true }),
            config
        });

        const first = await service.runBatch({
            batchId: ids.batch,
            adminId: ids.admin,
            idempotencyKey: 'transport-key-a'
        });
        const second = await service.runBatch({
            batchId: ids.batch,
            adminId: ids.admin,
            idempotencyKey: 'transport-key-b'
        });

        expect(first.queued[0]).toMatchObject({
            executionId: ids.dailyExecution,
            duplicate: true,
            idempotent: true
        });
        expect(second.queued[0]).toEqual(first.queued[0]);
        expect(ScheduleService.runDailyDraftForQa).not.toHaveBeenCalled();
        expect(ScheduleService.runNow).not.toHaveBeenCalled();
        expect(CaseModel.updateOne).not.toHaveBeenCalled();
        expect(BatchModel.updateOne).toHaveBeenCalledTimes(2);
    });

    it('does not re-enable or duplicate an already retained actual-schedule run slot', async () => {
        const retainedAttempt = {
            attempt: 1,
            batchIteration: 0,
            executionMode: 'actual_schedule',
            executionId: null,
            status: 'queued',
            dispatchState: 'pending',
            scheduledFor: new Date('2026-07-22T05:01:00.000Z')
        };
        const qaCase = {
            _id: ids.dueCase,
            caseKey: 'LOCAL-SCHEDULE-01',
            executionMode: 'actual_schedule',
            scheduleId: ids.dueSchedule,
            status: 'queued',
            runAttempts: [retainedAttempt]
        };
        const batch = {
            _id: ids.batch,
            isQaTest: true,
            environment: 'local',
            status: 'running',
            stopNewDrafts: false,
            iteration: 0,
            caseIds: [ids.dueCase]
        };
        const BatchModel = {
            findOne: vi.fn(() => ({ lean: vi.fn().mockResolvedValue(batch) })),
            updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 })
        };
        const CaseModel = {
            find: vi.fn(() => chainResult([qaCase])),
            updateOne: vi.fn()
        };
        const ScheduleModel = {
            findOne: vi.fn(() => ({ lean: vi.fn().mockResolvedValue({ isQaTest: true }) })),
            updateOne: vi.fn()
        };
        const ScheduleService = { runDailyDraftForQa: vi.fn(), runNow: vi.fn() };
        const service = new AgenticBlogQaBatchService({
            BatchModel,
            CaseModel,
            ScheduleModel,
            ScheduleService,
            EnsureInfrastructure: vi.fn().mockResolvedValue({ ensured: true }),
            config
        });

        const result = await service.runBatch({
            batchId: ids.batch,
            adminId: ids.admin,
            idempotencyKey: 'actual-schedule-replay-001'
        });

        expect(result.queued[0]).toMatchObject({
            caseId: ids.dueCase,
            executionMode: 'actual_schedule',
            expectedRunAt: retainedAttempt.scheduledFor,
            duplicate: true,
            idempotent: true,
            scheduled: true
        });
        expect(ScheduleModel.updateOne).not.toHaveBeenCalled();
        expect(ScheduleService.runDailyDraftForQa).not.toHaveBeenCalled();
        expect(ScheduleService.runNow).not.toHaveBeenCalled();
        expect(CaseModel.updateOne).not.toHaveBeenCalled();
    });

    it('rejects a batch environment that differs from the validated active QA environment', async () => {
        const EnsureInfrastructure = vi.fn().mockResolvedValue({ ensured: true });
        const service = new AgenticBlogQaBatchService({
            BatchModel: {},
            EnsureInfrastructure,
            config
        });

        await expect(service.createBatch({
            payload: { environment: 'staging' },
            adminId: ids.admin,
            idempotencyKey: 'environment-boundary-001'
        })).rejects.toThrow('must match the validated QA environment');
        expect(EnsureInfrastructure).toHaveBeenCalledTimes(1);
    });
});
