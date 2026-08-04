import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { getPollMs } = require('../src/services/blogAutomationScheduler.runtime');
const {
    BlogAutomationScheduleService,
    assertActiveExecutionOwnership,
    claimPublishFence,
    updateQaRunAttempt
} = require('../src/services/blogAutomationSchedule.service');
const { BlogAutomationSchedule } = require('../src/models/blogAutomationSchedule.model');
const { BlogAutomationExecution } = require('../src/models/blogAutomationExecution.model');
const { AgenticBlogQaCase } = require('../src/models/agenticBlogQaCase.model');
const { AgenticBlogQaBatch } = require('../src/models/agenticBlogQaBatch.model');
const AutomationSeoBlogService = require('../src/services/automationSeoBlog.service');

const ids = Object.freeze({
    batch: '507f1f77bcf86cd799439401',
    case: '507f1f77bcf86cd799439402',
    schedule: '507f1f77bcf86cd799439403',
    execution: '507f1f77bcf86cd799439404'
});

const selectedLean = (value) => ({
    select: vi.fn(() => ({ lean: vi.fn().mockResolvedValue(value) }))
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('QA scheduler ownership and publisher fencing', () => {
    it('bounds scheduler polling and safely falls back for NaN or out-of-range values', () => {
        expect(getPollMs()).toBe(30_000);
        expect(getPollMs('not-a-number')).toBe(30_000);
        expect(getPollMs('4999')).toBe(30_000);
        expect(getPollMs('300001')).toBe(30_000);
        expect(getPollMs('5000')).toBe(5_000);
        expect(getPollMs('300000')).toBe(300_000);
    });
    it('fails closed when either the schedule lease or running execution ownership is stale', async () => {
        vi.spyOn(BlogAutomationSchedule, 'findOne').mockReturnValue(selectedLean(null));
        vi.spyOn(BlogAutomationExecution, 'findOne').mockReturnValue(selectedLean({ _id: ids.execution }));

        await expect(assertActiveExecutionOwnership({
            scheduleObjectId: ids.schedule,
            executionId: ids.execution,
            lockOwner: 'worker:current',
            now: new Date('2026-07-22T05:00:00.000Z')
        })).rejects.toMatchObject({ code: 'SCHEDULE_EXECUTION_FENCE_LOST' });

        BlogAutomationSchedule.findOne.mockReturnValue(selectedLean({ _id: ids.schedule }));
        BlogAutomationExecution.findOne.mockReturnValue(selectedLean(null));
        await expect(assertActiveExecutionOwnership({
            scheduleObjectId: ids.schedule,
            executionId: ids.execution,
            lockOwner: 'worker:stale'
        })).rejects.toMatchObject({ code: 'SCHEDULE_EXECUTION_FENCE_LOST' });
    });

    it('does not claim publisher ownership when the schedule lease renewal CAS loses', async () => {
        vi.spyOn(BlogAutomationSchedule, 'updateOne').mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
        const executionClaim = vi.spyOn(BlogAutomationExecution, 'findOneAndUpdate');

        await expect(claimPublishFence({
            scheduleObjectId: ids.schedule,
            executionId: ids.execution,
            lockOwner: 'worker:stale',
            now: new Date('2026-07-22T05:00:00.000Z')
        })).rejects.toMatchObject({ code: 'SCHEDULE_EXECUTION_FENCE_LOST' });
        expect(executionClaim).not.toHaveBeenCalled();
    });

    it('atomically moves only the owned running execution into the committing state', async () => {
        const claimed = { _id: ids.execution, status: 'committing' };
        vi.spyOn(BlogAutomationSchedule, 'updateOne').mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
        vi.spyOn(BlogAutomationExecution, 'findOneAndUpdate').mockResolvedValue(claimed);

        const result = await claimPublishFence({
            scheduleObjectId: ids.schedule,
            executionId: ids.execution,
            lockOwner: 'worker:current',
            now: new Date('2026-07-22T05:00:00.000Z')
        });

        expect(result).toBe(claimed);
        expect(BlogAutomationSchedule.updateOne).toHaveBeenCalledWith(
            expect.objectContaining({
                _id: ids.schedule,
                lockedBy: 'worker:current',
                leaseUntil: { $gt: new Date('2026-07-22T05:00:00.000Z') }
            }),
            { $set: { leaseUntil: new Date('2026-07-22T05:05:00.000Z') } }
        );
        expect(BlogAutomationExecution.findOneAndUpdate).toHaveBeenCalledWith(
            {
                _id: ids.execution,
                status: 'running',
                'metadata.leaseOwner': 'worker:current'
            },
            {
                $set: {
                    status: 'committing',
                    currentStage: 'commit',
                    'metadata.commitClaimedAt': new Date('2026-07-22T05:00:00.000Z')
                }
            },
            { new: true }
        );
    });

    it('rejects the publisher fence when another worker already changed the execution state', async () => {
        vi.spyOn(BlogAutomationSchedule, 'updateOne').mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
        vi.spyOn(BlogAutomationExecution, 'findOneAndUpdate').mockResolvedValue(null);

        await expect(claimPublishFence({
            scheduleObjectId: ids.schedule,
            executionId: ids.execution,
            lockOwner: 'worker:stale'
        })).rejects.toMatchObject({ code: 'SCHEDULE_EXECUTION_FENCE_LOST' });
    });

    it('blocks final QA draft persistence after its batch has been stopped', async () => {
        vi.spyOn(BlogAutomationExecution, 'findOne').mockReturnValue(selectedLean({
            _id: ids.execution,
            scheduleId: ids.schedule,
            metadata: { leaseOwner: 'worker:current' }
        }));
        vi.spyOn(BlogAutomationSchedule, 'findOne').mockReturnValue(selectedLean({ _id: ids.schedule }));
        vi.spyOn(AgenticBlogQaBatch, 'findOne').mockReturnValue(selectedLean(null));

        await expect(AutomationSeoBlogService.assertTrustedQaExecutionFence({
            executionId: ids.execution,
            qaContext: {
                qaBatchId: ids.batch,
                qaCaseId: ids.case,
                qaIteration: 0,
                environment: 'local',
                executionMode: 'run_now'
            },
            now: new Date('2026-07-22T05:00:00.000Z')
        })).rejects.toMatchObject({ code: 'CONTENT_WORK_ORDER_LEASE_LOST' });

        expect(AgenticBlogQaBatch.findOne).toHaveBeenCalledWith(expect.objectContaining({
            _id: ids.batch,
            status: { $in: ['planned', 'running'] },
            stopNewDrafts: { $ne: true }
        }));
    });

    it('updates only the exact QA iteration/mode run attempt during recovery', async () => {
        vi.spyOn(AgenticBlogQaCase, 'updateOne').mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
        const schedule = {
            isQaTest: true,
            qaBatchId: ids.batch,
            qaCaseId: ids.case,
            qaIteration: 1,
            executionMode: 'actual_schedule'
        };
        const execution = { _id: ids.execution, qaIteration: 1 };

        await updateQaRunAttempt({
            schedule,
            execution,
            status: 'failed',
            values: {
                'runAttempts.$[attempt].dispatchState': 'failed',
                'runAttempts.$[attempt].errorCode': 'STALE_RUNNING_EXECUTION_RECOVERED'
            }
        });

        const [filter, update, options] = AgenticBlogQaCase.updateOne.mock.calls[0];
        expect(filter).toEqual({
            _id: ids.case,
            qaBatchId: ids.batch,
            isQaTest: true
        });
        expect(update.$set).toMatchObject({
            'runAttempts.$[attempt].status': 'failed',
            'runAttempts.$[attempt].executionId': ids.execution,
            'runAttempts.$[attempt].dispatchState': 'failed',
            'runAttempts.$[attempt].errorCode': 'STALE_RUNNING_EXECUTION_RECOVERED'
        });
        expect(options.arrayFilters).toEqual([{
            'attempt.idempotencyKeyHash': expect.stringMatching(/^[a-f0-9]{64}$/),
            'attempt.batchIteration': 1,
            'attempt.executionMode': 'actual_schedule'
        }]);
    });

    it('requires the full queued QA provenance before claiming its retained schedule', async () => {
        const previous = {
            seoEnabled: process.env.SEO_AGENT_ENABLED,
            qaEnabled: process.env.AGENTIC_BLOG_QA_ENABLED,
            qaEnvironment: process.env.AGENTIC_BLOG_QA_ENVIRONMENT
        };
        process.env.SEO_AGENT_ENABLED = 'true';
        process.env.AGENTIC_BLOG_QA_ENABLED = 'true';
        process.env.AGENTIC_BLOG_QA_ENVIRONMENT = 'local';
        const execution = {
            _id: ids.execution,
            scheduleId: ids.schedule,
            status: 'queued',
            isQaTest: true,
            qaBatchId: ids.batch,
            qaCaseId: ids.case,
            qaIteration: 1,
            environment: 'local',
            executionMode: 'schedule_run_now',
            originalTopicSeed: 'Retained queue topic',
            normalizedTopicKey: 'retained-queue-topic',
            qaTopicReservationId: '507f1f77bcf86cd799439405'
        };
        const executionQuery = {
            sort: vi.fn(),
            limit: vi.fn(),
            lean: vi.fn().mockResolvedValue([execution])
        };
        executionQuery.sort.mockReturnValue(executionQuery);
        executionQuery.limit.mockReturnValue(executionQuery);
        vi.spyOn(BlogAutomationExecution, 'find').mockReturnValue(executionQuery);
        const scheduleClaim = vi.spyOn(BlogAutomationSchedule, 'findOneAndUpdate').mockReturnValue({
            lean: vi.fn().mockResolvedValue(null)
        });

        try {
            await expect(BlogAutomationScheduleService.claimQueuedExecution({
                workerId: 'qa-recovery-worker',
                now: new Date('2026-07-22T05:00:00.000Z')
            })).resolves.toBeNull();
        } finally {
            for (const [key, value] of Object.entries({
                SEO_AGENT_ENABLED: previous.seoEnabled,
                AGENTIC_BLOG_QA_ENABLED: previous.qaEnabled,
                AGENTIC_BLOG_QA_ENVIRONMENT: previous.qaEnvironment
            })) {
                if (value === undefined) delete process.env[key];
                else process.env[key] = value;
            }
        }

        expect(scheduleClaim).toHaveBeenCalledWith(
            expect.objectContaining({
                _id: ids.schedule,
                isQaTest: true,
                qaBatchId: ids.batch,
                qaCaseId: ids.case,
                qaIteration: 1,
                environment: 'local',
                executionMode: 'schedule_run_now',
                originalTopicSeed: 'Retained queue topic',
                normalizedTopicKey: 'retained-queue-topic',
                qaTopicReservationId: '507f1f77bcf86cd799439405'
            }),
            expect.any(Object),
            { new: true }
        );
    });

    it('keeps the commit fence before writer persistence and checks terminal CAS before QA binding', () => {
        const source = readFileSync(new URL('../src/services/blogAutomationSchedule.service.js', import.meta.url), 'utf8');
        const pipeline = source.indexOf('const pipeline = await AgenticBlogCoreService.runPipeline');
        const ownershipCheck = source.indexOf('await assertActiveExecutionOwnership', pipeline);
        const commitFence = source.indexOf('execution = await claimPublishFence', ownershipCheck);
        const persistedArtifacts = source.indexOf('const persistedArtifacts = await BlogAutomationExecution.updateOne', commitFence);
        const persistedArtifactsCheck = source.indexOf('if (!matchedExactlyOne(persistedArtifacts)) throw scheduleFenceError()', persistedArtifacts);
        const publisher = source.indexOf('AutomationSeoBlogService.publishSeoBlog', persistedArtifactsCheck);
        const terminalCas = source.indexOf('const terminalExecution = await BlogAutomationExecution.updateOne', publisher);
        const terminalCheck = source.indexOf('if (!matchedExactlyOne(terminalExecution)) throw scheduleFenceError()', terminalCas);
        const reservationBinding = source.indexOf('await qaTopicUniquenessService.consume', terminalCheck);
        const caseBinding = source.indexOf('await AgenticBlogQaCase.updateOne', reservationBinding);

        expect([
            pipeline,
            ownershipCheck,
            commitFence,
            persistedArtifacts,
            persistedArtifactsCheck,
            publisher,
            terminalCas,
            terminalCheck,
            reservationBinding,
            caseBinding
        ].every(index => index >= 0)).toBe(true);
        expect(pipeline).toBeLessThan(ownershipCheck);
        expect(ownershipCheck).toBeLessThan(commitFence);
        expect(commitFence).toBeLessThan(persistedArtifacts);
        expect(persistedArtifactsCheck).toBeLessThan(publisher);
        expect(publisher).toBeLessThan(terminalCas);
        expect(terminalCheck).toBeLessThan(reservationBinding);
        expect(reservationBinding).toBeLessThan(caseBinding);
    });
});
