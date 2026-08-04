import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Module } = require('node:module');

const ORIGINAL_ENV = { ...process.env };
const SCHEDULE_ID = '507f1f77bcf86cd799439071';
const EXECUTION_ID = '507f1f77bcf86cd799439072';
const QA_BATCH_ID = '507f1f77bcf86cd799439075';
const QA_CASE_ID = '507f1f77bcf86cd799439076';
const QA_RESERVATION_ID = '507f1f77bcf86cd799439077';

const scheduleMock = {
    findById: vi.fn(),
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
    updateOne: vi.fn()
};
const executionMock = {
    aggregate: vi.fn(),
    countDocuments: vi.fn(),
    create: vi.fn(),
    find: vi.fn(),
    findById: vi.fn(),
    findOne: vi.fn(),
    updateOne: vi.fn()
};
const blogMock = { findOne: vi.fn() };
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
installMock('../src/models/blog.model', { blog: blogMock });
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
    calculateExecutionRetryAt,
    classifyExecutionFailure,
    getExecutionRetryPolicy,
    getScheduleDayBounds,
    isPersistedBlogCommitForExecution,
    mapExecution,
    mapSchedule,
    recoverStaleExecution
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
const selectLeanResult = (value) => {
    const query = { lean: vi.fn().mockResolvedValue(value) };
    query.select = vi.fn(() => query);
    return query;
};

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
    executionMock.aggregate.mockResolvedValue([]);
    executionMock.findById.mockReturnValue(selectLeanResult(null));
    executionMock.findOne.mockReturnValue(leanResult(null));
    executionMock.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    blogMock.findOne.mockReturnValue(selectLeanResult(null));
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
});

describe('BlogAutomationScheduleService concurrency and recovery', () => {
    it('loads bounded execution summaries for at most five executions per requested schedule in one aggregation', async () => {
        const secondScheduleId = '507f1f77bcf86cd799439078';
        executionMock.aggregate.mockResolvedValue([
            {
                _id: SCHEDULE_ID,
                executions: [{
                    _id: EXECUTION_ID,
                    scheduleId: SCHEDULE_ID,
                    executionKey: 'safe-execution-key',
                    status: 'failed',
                    error: 'https://private.invalid/?token=secret',
                    metadata: { leaseOwner: 'secret-owner', trigger: 'scheduled' },
                    createdAt: new Date('2026-07-20T11:00:00.000Z')
                }]
            }
        ]);

        const result = await BlogAutomationScheduleService.listExecutionSummaries({
            scheduleIds: `${SCHEDULE_ID},${secondScheduleId}`,
            limit: 99
        });

        expect(executionMock.aggregate).toHaveBeenCalledTimes(1);
        const pipeline = executionMock.aggregate.mock.calls[0][0];
        expect(pipeline[1].$project).toEqual(expect.objectContaining({
            _id: 1,
            scheduleId: 1,
            status: 1,
            retryAt: 1,
            attemptCount: 1,
            maxAttempts: 1,
            currentStage: 1,
            failureClass: 1,
            'metadata.outcomeCode': 1
        }));
        expect(pipeline[2].$group.executions.$topN.n).toBe(5);
        expect(JSON.stringify(pipeline)).not.toContain('agentSteps');
        expect(JSON.stringify(pipeline)).not.toContain('reviewerDecisions');
        expect(result).toEqual({
            checkedAt: '2026-07-20T12:00:00.000Z',
            summaries: [
                {
                    scheduleId: SCHEDULE_ID,
                    executions: [expect.objectContaining({
                        id: EXECUTION_ID,
                        scheduleId: SCHEDULE_ID,
                        error: 'INTERNAL_ERROR',
                        metadata: expect.objectContaining({ trigger: 'scheduled' })
                    })]
                },
                { scheduleId: secondScheduleId, executions: [] }
            ]
        });
        expect(JSON.stringify(result)).not.toContain('secret-owner');
        expect(JSON.stringify(result)).not.toContain('private.invalid');
    });

    it('rejects missing, invalid, or oversized execution summary schedule batches before querying MongoDB', async () => {
        await expect(BlogAutomationScheduleService.listExecutionSummaries({ scheduleIds: '' }))
            .rejects.toThrow('scheduleIds is required');
        await expect(BlogAutomationScheduleService.listExecutionSummaries({ scheduleIds: 'not-an-object-id' }))
            .rejects.toThrow('Invalid schedule id');
        await expect(BlogAutomationScheduleService.listExecutionSummaries({
            scheduleIds: Array.from({ length: 51 }, (_, index) => `${String(index).padStart(24, '0')}`)
        })).rejects.toThrow('scheduleIds cannot exceed 50 items');
        expect(executionMock.aggregate).not.toHaveBeenCalled();
    });

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
            agentExecutionRefs: ['ideation-run-1'],
            topicScoreReport: {
                totalScore: 91,
                noveltySubtotal: 54,
                rubricVersion: 'topic-plan-v2-2026-07-25',
                corpusVersion: 'blog-novelty-v2-2026-07-25',
                corpusHash: 'internal-corpus-hash',
                scoreHash: 'internal-score-hash',
                hardGatesPassed: true
            },
            metadata: {
                contentWorkOrderClaimToken: 'worker:secret-token',
                leaseOwner: 'lease-secret',
                trigger: 'scheduled'
            }
        });
        expect(mapped).toMatchObject({
            error: 'INTERNAL_ERROR',
            telegramNotificationError: 'INTERNAL_ERROR',
            topicLineage: {
                ideationRunIds: ['ideation-run-1'],
                totalScore: 91,
                noveltySubtotal: 54,
                rubricVersion: 'topic-plan-v2-2026-07-25',
                corpusVersion: 'blog-novelty-v2-2026-07-25',
                hardGatesPassed: true
            },
            metadata: { trigger: 'scheduled' }
        });
        expect(JSON.stringify(mapped)).not.toContain('secret-token');
        expect(JSON.stringify(mapped)).not.toContain('internal-corpus-hash');
        expect(JSON.stringify(mapped)).not.toContain('internal-score-hash');
    });

    it('bounds retry policy, classifies only transient failures for retry, and applies capped exponential backoff', () => {
        const policy = getExecutionRetryPolicy({
            OPENCLAW_BLOG_RETRY_MAX_ATTEMPTS: '99',
            OPENCLAW_BLOG_RETRY_BASE_MS: '1000',
            OPENCLAW_BLOG_RETRY_MAX_MS: '2500'
        });
        expect(policy).toEqual({ maxAttempts: 10, baseMs: 1000, maxMs: 2500 });
        expect(classifyExecutionFailure({ code: 'OPENCLAW_GATEWAY_TIMEOUT' })).toBe('transient');
        expect(classifyExecutionFailure({ code: 'OPENCLAW_AGENT_HTTP_408', status: 503 })).toBe('transient');
        expect(classifyExecutionFailure({ code: 'OPENCLAW_AGENT_HTTP_408', status: 503, httpStatus: 408 })).toBe('transient');
        expect(classifyExecutionFailure({ code: 'OPENCLAW_AGENT_HTTP_404', status: 503, httpStatus: 404 })).toBe('terminal');
        expect(classifyExecutionFailure({ code: 'OPENCLAW_AGENT_HTTP_403', status: 503, httpStatus: 403 })).toBe('terminal');
        expect(classifyExecutionFailure({ code: 'OPENCLAW_PROVIDER_AUTH_EXPIRED', status: 503 })).toBe('terminal');
        expect(classifyExecutionFailure({ code: 'OPENCLAW_GATEWAY_CONFIG_MISSING', status: 503 })).toBe('terminal');
        expect(classifyExecutionFailure({ code: 'OPENCLAW_MODEL_IDENTITY_MISMATCH', status: 503 })).toBe('terminal');
        expect(classifyExecutionFailure({ code: 'QA_PUBLICATION_FORBIDDEN' })).toBe('terminal');
        expect(classifyExecutionFailure(new Error('unknown implementation failure'))).toBe('terminal');
        expect(calculateExecutionRetryAt({
            attemptCount: 1,
            now: new Date('2026-07-20T12:00:00.000Z'),
            policy
        }).toISOString()).toBe('2026-07-20T12:00:01.000Z');
        expect(calculateExecutionRetryAt({
            attemptCount: 4,
            now: new Date('2026-07-20T12:00:00.000Z'),
            policy
        }).toISOString()).toBe('2026-07-20T12:00:02.500Z');
    });

    it('queries retry_wait executions only when retryAt is due', async () => {
        const now = new Date('2026-07-20T12:00:00.000Z');
        const query = {
            sort: vi.fn(),
            limit: vi.fn(),
            lean: vi.fn().mockResolvedValue([])
        };
        query.sort.mockReturnValue(query);
        query.limit.mockReturnValue(query);
        executionMock.find.mockReturnValue(query);

        await expect(BlogAutomationScheduleService.claimQueuedExecution({
            workerId: 'retry-worker',
            now
        })).resolves.toBeNull();

        const filter = executionMock.find.mock.calls[0][0];
        expect(filter.$and[0].$or).toContainEqual({
            status: 'retry_wait',
            retryAt: { $ne: null, $lte: now }
        });
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

    it('rejects pause/update/delete while a schedule lease is active', async () => {
        const active = baseSchedule({ leaseUntil: new Date(Date.now() + 60_000), lockedBy: 'active-owner' });
        scheduleMock.findById.mockReturnValue(selectLeanResult(active));

        await expect(BlogAutomationScheduleService.setEnabled({ scheduleId: SCHEDULE_ID, enabled: false }))
            .rejects.toMatchObject({ code: 'BLOG_SCHEDULE_ACTIVE_RUN' });
        await expect(BlogAutomationScheduleService.updateSchedule({
            scheduleId: SCHEDULE_ID,
            payload: {
                name: active.name,
                scheduleType: 'daily',
                timezone: active.timezone,
                daily: active.daily,
                agentConfig: {}
            }
        })).rejects.toMatchObject({ code: 'BLOG_SCHEDULE_ACTIVE_RUN' });
        await expect(BlogAutomationScheduleService.deleteSchedule({ scheduleId: SCHEDULE_ID }))
            .rejects.toMatchObject({ code: 'BLOG_SCHEDULE_ACTIVE_RUN' });
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
        executionMock.create.mockResolvedValue({ _id: EXECUTION_ID, status: 'queued' });
        const execute = vi.spyOn(BlogAutomationScheduleService, 'executeSchedule').mockResolvedValue({ queued: true });

        const first = await BlogAutomationScheduleService.runNow({
            scheduleId: SCHEDULE_ID,
            idempotencyKey: 'manual-run-key-0001',
            requestId: 'request-manual-run-1'
        });
        await expect(BlogAutomationScheduleService.runNow({
            scheduleId: SCHEDULE_ID,
            idempotencyKey: 'manual-run-key-0002'
        }))
            .rejects.toThrow('active run');
        await Promise.resolve();

        expect(first.queued).toBe(true);
        expect(first.correlationId).toBe('request-manual-run-1');
        expect(executionMock.create).toHaveBeenCalledWith(
            expect.objectContaining({ correlationId: 'request-manual-run-1' })
        );
        expect(execute).toHaveBeenCalledTimes(1);
        expect(scheduleMock.findOneAndUpdate.mock.calls[0][0]).toMatchObject({
            _id: expect.anything(),
            $or: expect.any(Array)
        });
    });

    it.each(['run_now', 'schedule_run_now'])(
        'atomically persists remediation iteration for the %s QA entrypoint',
        async (executionMode) => {
            const qaSchedule = baseSchedule({
                isQaTest: true,
                qaBatchId: QA_BATCH_ID,
                qaCaseId: QA_CASE_ID,
                qaIteration: 0,
                environment: 'local',
                executionMode,
                originalTopicSeed: 'QA retained topic',
                normalizedTopicKey: 'qa-retained-topic',
                qaTopicReservationId: QA_RESERVATION_ID
            });
            scheduleMock.findById.mockReturnValue(selectLeanResult(qaSchedule));
            scheduleMock.findOneAndUpdate.mockImplementation((_filter, update) =>
                leanResult({
                    ...qaSchedule,
                    ...update.$set
                })
            );
            executionMock.findOne.mockReturnValue(selectLeanResult(null));
            executionMock.create.mockImplementation(async (payload) => ({
                _id: EXECUTION_ID,
                ...payload
            }));
            const execute = vi.spyOn(BlogAutomationScheduleService, 'executeSchedule').mockResolvedValue({ queued: true });

            const request = {
                scheduleId: SCHEDULE_ID,
                idempotencyKey: `qa-remediation-${executionMode}-iteration-1`,
                adminId: '507f1f77bcf86cd799439078',
                trustedQaRun: true,
                qaIteration: 1
            };
            const result = executionMode === 'run_now'
                ? await BlogAutomationScheduleService.runDailyDraftForQa(request)
                : await BlogAutomationScheduleService.runNow(request);
            await Promise.resolve();
            await Promise.resolve();

            expect(result).toMatchObject({ queued: true, executionId: EXECUTION_ID });
            const [claimFilter, claimUpdate] = scheduleMock.findOneAndUpdate.mock.calls[0];
            expect(claimFilter).toMatchObject({
                isQaTest: true,
                qaBatchId: QA_BATCH_ID,
                qaCaseId: QA_CASE_ID,
                environment: 'local',
                executionMode,
                qaTopicReservationId: QA_RESERVATION_ID
            });
            expect(claimUpdate.$set.qaIteration).toBe(1);
            expect(executionMock.create).toHaveBeenCalledWith(expect.objectContaining({
                isQaTest: true,
                qaBatchId: QA_BATCH_ID,
                qaCaseId: QA_CASE_ID,
                qaIteration: 1,
                executionMode
            }));
            expect(execute).toHaveBeenCalledWith(expect.objectContaining({
                schedule: expect.objectContaining({ qaIteration: 1, executionMode }),
                precreatedExecutionId: EXECUTION_ID
            }));
        }
    );

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

    it('never skips a run because of a daily limit, even with maximumTasksPerDay set', async () => {
        const schedule = baseSchedule({ maximumTasksPerDay: 1 });
        executionMock.countDocuments.mockResolvedValue(99);
        executionMock.create.mockRejectedValue(new Error('stop-after-limit-check'));

        const result = await BlogAutomationScheduleService.executeSchedule({
            schedule,
            trigger: 'scheduled',
            dueAt: schedule.nextRunAt,
            lockOwner: schedule.lockedBy
        }).catch((error) => ({ failedBeyondLimit: error.message }));

        expect(executionMock.countDocuments).not.toHaveBeenCalled();
        expect(result.reason === 'maximum_tasks_per_day_reached').toBe(false);
    });

    it('recovers a stale duplicate execution into durable retry without advancing the schedule', async () => {
        const schedule = baseSchedule();
        const retryAt = new Date('2026-07-20T12:00:30.000Z');
        executionMock.findOne.mockReturnValue(leanResult({
            _id: EXECUTION_ID,
            status: 'running',
            attemptCount: 1,
            maxAttempts: 3,
            contentAction: 'new'
        }));
        executionMock.findById.mockReturnValue(selectLeanResult({
            status: 'retry_wait',
            retryAt,
            attemptCount: 1,
            maxAttempts: 3,
            currentStage: 'running',
            failureClass: 'transient'
        }));

        const result = await BlogAutomationScheduleService.executeSchedule({
            schedule,
            trigger: 'scheduled',
            dueAt: schedule.nextRunAt,
            lockOwner: schedule.lockedBy
        });

        expect(result).toMatchObject({
            reason: 'duplicate_execution_retry_scheduled',
            retryScheduled: true,
            executionId: EXECUTION_ID,
            retryAt
        });
        expect(executionMock.create).not.toHaveBeenCalled();
        expect(executionMock.countDocuments).not.toHaveBeenCalled();
        expect(runPipelineMock).not.toHaveBeenCalled();
        expect(executionMock.updateOne).toHaveBeenCalledWith(
            expect.objectContaining({
                _id: EXECUTION_ID,
                status: { $in: ['running', 'committing'] },
                $or: expect.any(Array)
            }),
            expect.objectContaining({
                $set: expect.objectContaining({
                    status: 'retry_wait',
                    retryAt,
                    failureClass: 'transient'
                }),
                $inc: { retryCount: 1 }
            })
        );
        const [filter, update] = scheduleMock.updateOne.mock.calls[0];
        expect(filter.lockedBy).toBe(schedule.lockedBy);
        expect(update.$inc).toBeUndefined();
        expect(update.$unset).toBeUndefined();
        expect(update.$set).toMatchObject({
            lastRunStatus: 'retry_wait',
            leaseUntil: retryAt,
            lockedBy: ''
        });
        expect(update.$set.nextRunAt).toBeUndefined();
    });

    it('reconciles a persisted draft when a committing execution is recovered after restart', async () => {
        const schedule = baseSchedule();
        const blogId = '507f1f77bcf86cd799439079';
        executionMock.findOne.mockReturnValue(leanResult({
            _id: EXECUTION_ID,
            scheduleId: SCHEDULE_ID,
            status: 'committing',
            contentAction: 'new'
        }));
        blogMock.findOne.mockReturnValue(selectLeanResult({
            _id: blogId,
            blog_slug: 'persisted-before-restart',
            blog_title: 'Persisted before restart',
            isPublished: false
        }));
        executionMock.findById.mockReturnValue(selectLeanResult({ status: 'draft_created' }));

        const result = await BlogAutomationScheduleService.executeSchedule({
            schedule,
            trigger: 'scheduled',
            dueAt: schedule.nextRunAt,
            lockOwner: schedule.lockedBy
        });

        expect(result.reason).toBe('duplicate_execution_recovered');
        expect(executionMock.updateOne).toHaveBeenCalledWith(
            expect.objectContaining({ _id: EXECUTION_ID, status: 'committing' }),
            expect.objectContaining({
                $set: expect.objectContaining({
                    status: 'draft_created',
                    blogId,
                    blogSlug: 'persisted-before-restart'
                })
            })
        );
        expect(runPipelineMock).not.toHaveBeenCalled();
        const completion = scheduleMock.updateOne.mock.calls.at(-1)[1];
        expect(completion.$set.lastRunStatus).toBe('draft_created');
        expect(completion.$set.lastError).toBe('');
    });

    it('reconciles only an exact agentic draft commit and preserves draft-only state', async () => {
        const workOrderId = '507f1f77bcf86cd799439074';
        const claimToken = 'writer:test-claim';
        const blogId = '507f1f77bcf86cd799439079';
        const execution = {
            _id: EXECUTION_ID,
            status: 'committing',
            contentWorkOrderId: workOrderId,
            metadata: { contentWorkOrderClaimToken: claimToken }
        };
        const persistedDraft = {
            _id: blogId,
            blog_slug: 'persisted-before-terminal-cas',
            blog_title: 'Persisted before terminal CAS',
            isDraft: true,
            isPublished: false,
            publishedAt: null,
            agenticExecutionId: EXECUTION_ID,
            contentWorkOrderId: workOrderId,
            sourceType: 'agentic',
            imagePipelineStatus: 'partial'
        };
        blogMock.findOne.mockReturnValue(selectLeanResult(persistedDraft));
        const transitionClaimed = vi.spyOn(
            ContentWorkOrderService,
            'transitionClaimed'
        ).mockResolvedValue({ _id: workOrderId, status: 'reviewing' });
        const info = vi.spyOn(console, 'info').mockImplementation(() => {});

        const recovered = await recoverStaleExecution({
            execution,
            errorCode: 'CONTENT_WORK_ORDER_LEASE_LOST',
            recoveryReason: 'persisted_blog_reconciled_after_pipeline_error'
        });

        expect(recovered).toBe(true);
        expect(isPersistedBlogCommitForExecution({
            execution,
            persistedBlog: persistedDraft
        })).toBe(true);
        expect(transitionClaimed).toHaveBeenCalledWith({
            workOrderId,
            claimToken,
            status: 'reviewing',
            updates: {
                'metadata.lastRecoveryCode': 'CONTENT_WORK_ORDER_LEASE_LOST'
            }
        });
        expect(executionMock.updateOne).toHaveBeenCalledWith(
            {
                _id: EXECUTION_ID,
                status: 'committing',
                contentWorkOrderId: workOrderId,
                'metadata.contentWorkOrderClaimToken': claimToken
            },
            {
                $set: expect.objectContaining({
                    status: 'draft_created',
                    blogId,
                    mode: 'draft',
                    error: '',
                    'metadata.contentWorkOrderClaimToken': '',
                    'metadata.recoveryCode': 'CONTENT_WORK_ORDER_LEASE_LOST',
                    'metadata.recoveryReason':
                        'persisted_blog_reconciled_after_pipeline_error',
                    'metadata.imagePipelineStatus': 'partial'
                })
            }
        );
        expect(info).toHaveBeenCalledWith(expect.stringContaining(
            '"event":"persisted_blog_commit_reconciled"'
        ));
    });

    it('refuses post-commit recovery when the persisted draft belongs to another Work Order', async () => {
        const execution = {
            _id: EXECUTION_ID,
            status: 'committing',
            contentWorkOrderId: '507f1f77bcf86cd799439074',
            metadata: { contentWorkOrderClaimToken: 'writer:test-claim' }
        };
        const mismatchedDraft = {
            _id: '507f1f77bcf86cd799439079',
            isDraft: true,
            isPublished: false,
            agenticExecutionId: EXECUTION_ID,
            contentWorkOrderId: '507f1f77bcf86cd799439080',
            sourceType: 'agentic'
        };
        blogMock.findOne.mockReturnValue(selectLeanResult(mismatchedDraft));
        const transitionClaimed = vi.spyOn(
            ContentWorkOrderService,
            'transitionClaimed'
        );

        const recovered = await recoverStaleExecution({
            execution,
            errorCode: 'CONTENT_WORK_ORDER_LEASE_LOST',
            recoveryReason: 'persisted_blog_reconciled_after_pipeline_error'
        });

        expect(recovered).toBe(false);
        expect(isPersistedBlogCommitForExecution({
            execution,
            persistedBlog: mismatchedDraft
        })).toBe(false);
        expect(transitionClaimed).not.toHaveBeenCalled();
        expect(executionMock.updateOne).not.toHaveBeenCalled();
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
        scheduleMock.findOne.mockReturnValue(selectLeanResult({ _id: SCHEDULE_ID }));
        executionMock.findOne.mockImplementation((filter = {}) => filter.executionKey
            ? leanResult(null)
            : selectLeanResult({
                _id: EXECUTION_ID,
                isQaTest: false,
                metadata: { leaseOwner: schedule.lockedBy }
            }));
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

    it('persists mandatory-source safety blocks as blocked instead of skipped', async () => {
        const schedule = baseSchedule();
        scheduleMock.findOne.mockReturnValue(selectLeanResult({ _id: SCHEDULE_ID }));
        executionMock.findOne.mockImplementation((filter = {}) => filter.executionKey
            ? leanResult(null)
            : selectLeanResult({
                _id: EXECUTION_ID,
                isQaTest: false,
                metadata: { leaseOwner: schedule.lockedBy }
            }));
        executionMock.create.mockResolvedValue({
            _id: EXECUTION_ID,
            toObject: () => ({ _id: EXECUTION_ID })
        });
        runPipelineMock.mockResolvedValue({
            skipped: false,
            blocked: true,
            reason: 'CONTENT_OPERATIONS_REQUIRED_SOURCE_UNAVAILABLE',
            context: {
                snapshot: { id: '507f1f77bcf86cd799439073' },
                contentPlanning: {
                    blockCode: 'CONTENT_OPERATIONS_REQUIRED_SOURCE_UNAVAILABLE',
                    candidates: [],
                    sourceHealth: {},
                    sourceFreshness: {}
                },
                opportunity: { decision: 'skip' },
                productSeedPlan: null,
                editorialPlacementPlan: null
            }
        });

        const result = await BlogAutomationScheduleService.executeSchedule({
            schedule,
            trigger: 'scheduled',
            dueAt: schedule.nextRunAt,
            lockOwner: schedule.lockedBy
        });

        expect(result).toMatchObject({
            skipped: false,
            blocked: true,
            reason: 'CONTENT_OPERATIONS_REQUIRED_SOURCE_UNAVAILABLE'
        });
        const executionBlock = executionMock.updateOne.mock.calls.find(
            ([, update]) => update?.$set?.status === 'blocked'
        );
        expect(executionBlock?.[1]?.$set).toMatchObject({
            status: 'blocked',
            error: 'CONTENT_OPERATIONS_REQUIRED_SOURCE_UNAVAILABLE',
            metadata: {
                decision: 'blocked',
                decisionReason: 'CONTENT_OPERATIONS_REQUIRED_SOURCE_UNAVAILABLE'
            }
        });
        expect(scheduleMock.updateOne.mock.calls.at(-1)[1].$set).toMatchObject({
            lastRunStatus: 'blocked',
            lastError: 'CONTENT_OPERATIONS_REQUIRED_SOURCE_UNAVAILABLE'
        });
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

    it('retries a transient pipeline failure on the same execution without advancing the normal schedule', async () => {
        const schedule = baseSchedule();
        const execution = {
            _id: EXECUTION_ID,
            scheduleId: SCHEDULE_ID,
            executionKey: `${SCHEDULE_ID}:${schedule.nextRunAt.toISOString()}`,
            status: 'running',
            attemptCount: 1,
            maxAttempts: 3,
            currentStage: 'agentic_pipeline',
            metadata: { leaseOwner: schedule.lockedBy },
            toObject: () => ({
                _id: EXECUTION_ID,
                scheduleId: SCHEDULE_ID,
                attemptCount: 1,
                maxAttempts: 3
            })
        };
        executionMock.create.mockResolvedValue(execution);
        executionMock.findById.mockReturnValue(leanResult(execution));
        runPipelineMock.mockRejectedValue(Object.assign(
            new Error('gateway temporarily unavailable'),
            { code: 'OPENCLAW_GATEWAY_TIMEOUT' }
        ));

        const result = await BlogAutomationScheduleService.executeSchedule({
            schedule,
            trigger: 'scheduled',
            dueAt: schedule.nextRunAt,
            lockOwner: schedule.lockedBy
        });

        expect(result).toMatchObject({
            retryScheduled: true,
            attemptCount: 1,
            maxAttempts: 3,
            failureClass: 'transient',
            errorCode: 'OPENCLAW_GATEWAY_TIMEOUT',
            execution: {
                id: EXECUTION_ID,
                status: 'retry_wait',
                currentStage: 'agentic_pipeline',
                failureClass: 'transient'
            }
        });
        expect(executionMock.updateOne).toHaveBeenCalledWith(
            expect.objectContaining({
                _id: EXECUTION_ID,
                status: { $in: ['running', 'committing'] },
                'metadata.leaseOwner': schedule.lockedBy
            }),
            expect.objectContaining({
                $set: expect.objectContaining({
                    status: 'retry_wait',
                    error: 'OPENCLAW_GATEWAY_TIMEOUT',
                    failureClass: 'transient',
                    maxAttempts: 3
                }),
                $inc: { retryCount: 1 }
            })
        );
        const scheduleRetry = scheduleMock.updateOne.mock.calls.at(-1)[1];
        expect(scheduleRetry.$set).toMatchObject({
            lastRunStatus: 'retry_wait',
            lastError: 'OPENCLAW_GATEWAY_TIMEOUT',
            lockedBy: ''
        });
        expect(scheduleRetry.$set.nextRunAt).toBeUndefined();
        expect(scheduleRetry.$inc).toBeUndefined();
    });

    it('terminalizes provider auth failures even when the adapter reports HTTP 503', async () => {
        const schedule = baseSchedule();
        const execution = {
            _id: EXECUTION_ID,
            status: 'running',
            attemptCount: 1,
            maxAttempts: 3,
            currentStage: 'agentic_pipeline',
            metadata: { leaseOwner: schedule.lockedBy },
            toObject: () => ({ _id: EXECUTION_ID })
        };
        executionMock.create.mockResolvedValue(execution);
        executionMock.findById.mockReturnValue(leanResult(execution));
        runPipelineMock.mockRejectedValue(Object.assign(
            new Error('provider auth expired'),
            { code: 'OPENCLAW_PROVIDER_AUTH_EXPIRED', status: 503 }
        ));

        await expect(BlogAutomationScheduleService.executeSchedule({
            schedule,
            trigger: 'scheduled',
            dueAt: schedule.nextRunAt,
            lockOwner: schedule.lockedBy
        })).rejects.toMatchObject({ code: 'OPENCLAW_PROVIDER_AUTH_EXPIRED' });

        expect(executionMock.updateOne.mock.calls.some(
            ([, update]) => update?.$set?.status === 'retry_wait'
        )).toBe(false);
        expect(executionMock.updateOne).toHaveBeenCalledWith(
            expect.objectContaining({
                _id: EXECUTION_ID,
                status: { $in: ['running', 'committing'] }
            }),
            expect.objectContaining({
                $set: expect.objectContaining({
                    status: 'failed',
                    error: 'OPENCLAW_PROVIDER_AUTH_EXPIRED',
                    failureClass: 'terminal',
                    retryAt: null
                })
            })
        );
    });

    it('terminalizes a transient failure after the persisted max attempt count is exhausted', async () => {
        const schedule = baseSchedule();
        const execution = {
            _id: EXECUTION_ID,
            status: 'running',
            attemptCount: 3,
            maxAttempts: 3,
            currentStage: 'agentic_pipeline',
            metadata: { leaseOwner: schedule.lockedBy },
            toObject: () => ({ _id: EXECUTION_ID })
        };
        executionMock.create.mockResolvedValue(execution);
        executionMock.findById.mockReturnValue(leanResult(execution));
        runPipelineMock.mockRejectedValue(Object.assign(
            new Error('gateway still unavailable'),
            { code: 'OPENCLAW_AGENT_HTTP_503', status: 503 }
        ));

        await expect(BlogAutomationScheduleService.executeSchedule({
            schedule,
            trigger: 'scheduled',
            dueAt: schedule.nextRunAt,
            lockOwner: schedule.lockedBy
        })).rejects.toMatchObject({ code: 'OPENCLAW_AGENT_HTTP_503' });

        expect(executionMock.updateOne.mock.calls.some(
            ([, update]) => update?.$set?.status === 'retry_wait'
        )).toBe(false);
        expect(executionMock.updateOne).toHaveBeenCalledWith(
            expect.objectContaining({ _id: EXECUTION_ID }),
            expect.objectContaining({
                $set: expect.objectContaining({
                    status: 'failed',
                    failureClass: 'terminal',
                    maxAttempts: 3
                })
            })
        );
    });

    it('treats an exhausted safe-topic search as a non-error skipped outcome', async () => {
        const schedule = baseSchedule();
        executionMock.create.mockResolvedValue({
            _id: EXECUTION_ID,
            toObject: () => ({ _id: EXECUTION_ID })
        });
        runPipelineMock.mockRejectedValue(Object.assign(new Error('No acceptable topic'), {
            code: 'ROADMAP_NO_ACCEPTABLE_TOPIC'
        }));

        const result = await BlogAutomationScheduleService.executeSchedule({
            schedule,
            trigger: 'scheduled',
            dueAt: schedule.nextRunAt,
            lockOwner: schedule.lockedBy
        });

        expect(result).toMatchObject({
            skipped: true,
            blocked: false,
            outcomeCode: 'ROADMAP_NO_ACCEPTABLE_TOPIC',
            reason: 'ROADMAP_NO_ACCEPTABLE_TOPIC',
            executionId: EXECUTION_ID
        });
        const executionSkip = executionMock.updateOne.mock.calls.find(
            ([, update]) => update?.$set?.status === 'skipped'
        );
        expect(executionSkip?.[1]?.$set).toMatchObject({
            status: 'skipped',
            error: '',
            contentAction: 'skip',
            'metadata.decision': 'skip',
            'metadata.outcomeCode': 'ROADMAP_NO_ACCEPTABLE_TOPIC',
            'metadata.decisionReason': 'ROADMAP_NO_ACCEPTABLE_TOPIC'
        });
        const scheduleSkip = scheduleMock.updateOne.mock.calls.at(-1)[1].$set;
        expect(scheduleSkip).toMatchObject({
            lastRunStatus: 'skipped',
            lastError: '',
            lastOutcomeCode: 'ROADMAP_NO_ACCEPTABLE_TOPIC'
        });
    });

    it('does not mutate a successor retry attempt when a stale worker fails late', async () => {
        const schedule = baseSchedule();
        const workOrderId = '507f1f77bcf86cd799439074';
        const successorClaimToken = 'writer-b:successor-claim';
        executionMock.create.mockResolvedValue({
            _id: EXECUTION_ID,
            metadata: { leaseOwner: schedule.lockedBy },
            toObject: () => ({ _id: EXECUTION_ID })
        });
        executionMock.findById.mockReturnValue(leanResult({
            _id: EXECUTION_ID,
            status: 'running',
            contentWorkOrderId: workOrderId,
            metadata: {
                leaseOwner: 'worker-b:successor-owner',
                contentWorkOrderClaimToken: successorClaimToken
            }
        }));
        runPipelineMock.mockRejectedValue(Object.assign(new Error('stale worker failed late'), {
            code: 'WRITER_FAILED'
        }));
        const workOrderTransition = vi.spyOn(ContentWorkOrderService, 'transitionClaimed');
        const executionTransition = vi.spyOn(ContentWorkOrderService, 'transitionExecutionClaimed');
        const unclaimedExecutionTransition = vi.spyOn(ContentWorkOrderService, 'transitionExecutionUnclaimed');

        await expect(BlogAutomationScheduleService.executeSchedule({
            schedule,
            trigger: 'scheduled',
            dueAt: schedule.nextRunAt,
            lockOwner: schedule.lockedBy
        })).rejects.toMatchObject({ code: 'SCHEDULE_EXECUTION_FENCE_LOST' });

        expect(workOrderTransition).not.toHaveBeenCalled();
        expect(executionTransition).not.toHaveBeenCalled();
        expect(unclaimedExecutionTransition).not.toHaveBeenCalled();
        expect(executionMock.updateOne.mock.calls.some(([, update]) =>
            ['retry_wait', 'failed'].includes(update?.$set?.status)
        )).toBe(false);
        expect(scheduleMock.updateOne.mock.calls.some(([, update]) =>
            ['retry_wait', 'failed'].includes(update?.$set?.lastRunStatus)
        )).toBe(false);
    });

    it('does not schedule a retry from a stale worker after a successor owns the execution', async () => {
        const schedule = baseSchedule();
        const successor = {
            _id: EXECUTION_ID,
            status: 'running',
            attemptCount: 2,
            maxAttempts: 3,
            metadata: { leaseOwner: 'worker-b:successor-owner' }
        };
        executionMock.create.mockResolvedValue({
            _id: EXECUTION_ID,
            metadata: { leaseOwner: schedule.lockedBy },
            toObject: () => ({ _id: EXECUTION_ID })
        });
        executionMock.findById.mockReturnValue(leanResult(successor));
        runPipelineMock.mockRejectedValue(Object.assign(new Error('old gateway call returned late'), {
            code: 'OPENCLAW_GATEWAY_TIMEOUT'
        }));

        await expect(BlogAutomationScheduleService.executeSchedule({
            schedule,
            trigger: 'scheduled',
            dueAt: schedule.nextRunAt,
            lockOwner: schedule.lockedBy
        })).rejects.toMatchObject({ code: 'SCHEDULE_EXECUTION_FENCE_LOST' });

        expect(executionMock.updateOne.mock.calls.some(([, update]) =>
            update?.$set?.status === 'retry_wait'
        )).toBe(false);
        expect(scheduleMock.updateOne.mock.calls.some(([, update]) =>
            update?.$set?.lastRunStatus === 'retry_wait'
        )).toBe(false);
    });
});
