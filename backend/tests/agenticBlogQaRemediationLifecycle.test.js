import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    AgenticBlogQaBatchService,
    normalizeCodeActionEvidence
} = require('../src/services/agenticBlogQa.service');
const { QaRemediationOrchestrator } = require('../src/services/qaRemediationOrchestrator.service');
const qaAdminRouter = require('../src/routes/admin/agenticBlogQa.routes');

const ids = Object.freeze({
    batch: '507f1f77bcf86cd799439401',
    attempt: '507f1f77bcf86cd799439402',
    caseA: '507f1f77bcf86cd799439403',
    caseB: '507f1f77bcf86cd799439404',
    blogA: '507f1f77bcf86cd799439405',
    blogB: '507f1f77bcf86cd799439406',
    executionA: '507f1f77bcf86cd799439407',
    executionB: '507f1f77bcf86cd799439408',
    sourceReport: '507f1f77bcf86cd799439409',
    reportA: '507f1f77bcf86cd799439410',
    reportB: '507f1f77bcf86cd799439411',
    admin: '507f1f77bcf86cd799439412',
    schedule: '507f1f77bcf86cd799439413'
});

const config = Object.freeze({
    enabled: true,
    environment: 'local',
    databaseName: 'inoxpran_qa_local',
    requireAllCasesPass: true
});

const query = value => ({ lean: vi.fn().mockResolvedValue(value) });
const listQuery = value => ({
    lean: vi.fn().mockResolvedValue(value),
    sort: vi.fn(() => ({ lean: vi.fn().mockResolvedValue(value) })),
    select: vi.fn(() => ({ lean: vi.fn().mockResolvedValue(value) }))
});

const batch = overrides => ({
    _id: ids.batch,
    qaBatchId: ids.batch,
    isQaTest: true,
    environment: 'local',
    status: 'awaiting_remediation_action',
    iteration: 1,
    maxIterations: 3,
    caseIds: [ids.caseA, ids.caseB],
    ...overrides
});

const qaCases = () => [
    {
        _id: ids.caseA,
        caseKey: 'CASE-A',
        isQaTest: true,
        batchId: ids.batch,
        qaBatchId: ids.batch,
        environment: 'local',
        status: 'awaiting_remediation_action',
        blogId: ids.blogA,
        executionId: ids.executionA
    },
    {
        _id: ids.caseB,
        caseKey: 'CASE-B',
        isQaTest: true,
        batchId: ids.batch,
        qaBatchId: ids.batch,
        environment: 'local',
        status: 'passed',
        blogId: ids.blogB,
        executionId: ids.executionB
    }
];

const attempt = overrides => ({
    _id: ids.attempt,
    isQaTest: true,
    batchId: ids.batch,
    qaBatchId: ids.batch,
    environment: 'local',
    status: 'awaiting_action',
    iteration: 1,
    classification: 'article_specific',
    failedLayer: 'weak_transition',
    caseIds: [ids.caseA],
    sourceReportIds: [ids.sourceReport],
    baselineCodeRevision: 'revision-old-001',
    requiresArchitectureReport: false,
    resultingReportIds: [],
    ...overrides
});

const sourceReport = overrides => ({
    _id: ids.sourceReport,
    isQaTest: true,
    batchId: ids.batch,
    qaBatchId: ids.batch,
    caseId: ids.caseA,
    qaCaseId: ids.caseA,
    blogId: ids.blogA,
    executionId: ids.executionA,
    iteration: 0,
    contentRevisionHash: 'revision-content-old',
    verdict: 'failed',
    ...overrides
});

const articleBlog = overrides => ({
    _id: ids.blogA,
    isQaTest: true,
    qaBatchId: ids.batch,
    qaCaseId: ids.caseA,
    qaIteration: 0,
    environment: 'local',
    isDraft: true,
    isPublished: false,
    publishedAt: null,
    contentRevisionHash: 'revision-content-new',
    ...overrides
});

describe('Agentic Blog QA remediation lifecycle', () => {
    it('exposes resume only as a protected POST admin action', () => {
        const layer = qaAdminRouter.stack.find(item =>
            item.route?.path === '/qa-batches/:id/remediation/:attemptId/resume'
        );

        expect(layer?.route?.methods).toMatchObject({ post: true });
        expect(layer?.route?.stack).toHaveLength(2);
    });

    it('fails closed when review is called before the retained remediation action is applied', async () => {
        const AcceptanceService = { reviewPersistedCase: vi.fn() };
        const CaseModel = { find: vi.fn() };
        const service = new AgenticBlogQaBatchService({
            BatchModel: { findOne: vi.fn(() => query(batch())) },
            CaseModel,
            RemediationModel: {},
            AcceptanceService,
            EnsureInfrastructure: vi.fn().mockResolvedValue({ ensured: true }),
            config
        });

        await expect(service.reviewBatch({ batchId: ids.batch, adminId: ids.admin }))
            .rejects.toThrow('Apply the retained remediation action');
        expect(CaseModel.find).not.toHaveBeenCalled();
        expect(AcceptanceService.reviewPersistedCase).not.toHaveBeenCalled();
    });

    it('does not dispatch any QA case when the batch run fence is lost', async () => {
        const qaCase = {
            _id: ids.caseA,
            caseKey: 'RUN-FENCE-CASE',
            isQaTest: true,
            batchId: ids.batch,
            qaBatchId: ids.batch,
            environment: 'local',
            executionMode: 'run_now',
            scheduleId: ids.schedule,
            status: 'reserved',
            runAttempts: []
        };
        const ScheduleService = {
            runDailyDraftForQa: vi.fn(),
            runNow: vi.fn()
        };
        const service = new AgenticBlogQaBatchService({
            BatchModel: {
                findOne: vi.fn(() => query(batch({ status: 'planned', iteration: 0, caseIds: [ids.caseA] }))),
                updateOne: vi.fn().mockResolvedValue({ matchedCount: 0, modifiedCount: 0 })
            },
            CaseModel: { find: vi.fn(() => listQuery([qaCase])) },
            ScheduleModel: { findOne: vi.fn(() => query({ _id: ids.schedule, isQaTest: true })) },
            ScheduleService,
            EnsureInfrastructure: vi.fn().mockResolvedValue({ ensured: true }),
            config
        });

        await expect(service.runBatch({
            batchId: ids.batch,
            adminId: ids.admin,
            idempotencyKey: 'batch-run-fence-001'
        })).rejects.toThrow('could not acquire its run fence');
        expect(ScheduleService.runDailyDraftForQa).not.toHaveBeenCalled();
        expect(ScheduleService.runNow).not.toHaveBeenCalled();
    });

    it('fails shared-stage planning before persistence when the server baseline revision is unavailable', async () => {
        const AttemptModel = {
            findOne: vi.fn(() => query(null)),
            create: vi.fn()
        };
        const orchestrator = new QaRemediationOrchestrator({
            AttemptModel,
            CodeRevision: () => ''
        });
        const retainedCases = qaCases().map((item, index) => ({
            ...item,
            executionMode: 'run_now',
            originalTopicSeed: `Topic ${index + 1}`,
            normalizedTopicKey: `topic-${index + 1}`
        }));
        const sharedIssue = caseId => ({
            _id: caseId === ids.caseA ? ids.sourceReport : ids.reportB,
            caseId,
            verdict: 'failed',
            draftAcceptance: { pass: false, reasonCodes: [] },
            hardGatePassed: true,
            hardGates: [],
            categories: {
                editorialQuality: {
                    issues: [{ code: 'weak_editorial_opening', severity: 'medium' }]
                }
            },
            criticalHighIssues: [],
            independence: { blindReviewConfirmed: true }
        });

        await expect(orchestrator.plan({
            batch: batch({ status: 'failed' }),
            cases: retainedCases,
            reports: [sharedIssue(ids.caseA), sharedIssue(ids.caseB)],
            priorAttempts: [],
            iteration: 1,
            idempotencyKey: 'missing-baseline-001',
            createdBy: ids.admin
        })).rejects.toThrow('verifiable server code revision is required');
        expect(AttemptModel.create).not.toHaveBeenCalled();
    });

    it('keeps six distinct non-systemic article defects article-specific without requiring an unaffected article', async () => {
        const caseIds = Array.from({ length: 6 }, (_, index) =>
            `507f1f77bcf86cd7994394${String(20 + index).padStart(2, '0')}`
        );
        const reportIds = Array.from({ length: 6 }, (_, index) =>
            `507f1f77bcf86cd7994394${String(30 + index).padStart(2, '0')}`
        );
        const retainedCases = caseIds.map((caseId, index) => ({
            _id: caseId,
            isQaTest: true,
            environment: 'local',
            executionMode: index % 2 ? 'actual_schedule' : 'run_now',
            originalTopicSeed: `Distinct topic ${index + 1}`,
            normalizedTopicKey: `distinct-topic-${index + 1}`
        }));
        const reports = caseIds.map((caseId, index) => ({
            _id: reportIds[index],
            caseId,
            verdict: 'failed',
            draftAcceptance: { pass: false, reasonCodes: [] },
            hardGatePassed: true,
            hardGates: [],
            categories: {
                editorialQuality: {
                    issues: [{ code: `distinct_article_defect_${index + 1}`, severity: 'medium' }]
                }
            },
            criticalHighIssues: [],
            independence: { blindReviewConfirmed: true }
        }));
        const AttemptModel = {
            findOne: vi.fn(() => query(null)),
            create: vi.fn(async document => ({ ...document, _id: ids.attempt }))
        };
        const orchestrator = new QaRemediationOrchestrator({ AttemptModel });

        const result = await orchestrator.plan({
            batch: batch({ status: 'failed', caseIds }),
            cases: retainedCases,
            reports,
            priorAttempts: [],
            iteration: 1,
            idempotencyKey: 'six-article-defects-001',
            createdBy: ids.admin
        });

        expect(result.attempt.classification).toBe('article_specific');
        expect(result.attempt.caseIds.map(String)).toEqual(caseIds);
        expect(result.attempt.regressionControls).toEqual(expect.arrayContaining([
            expect.objectContaining({ control: 'passing_sections_unchanged', scope: caseIds })
        ]));
        expect(result.stopNewDrafts).toBe(false);
    });

    it('rejects article remediation until every affected retained draft has a changed revision hash', async () => {
        const RemediationModel = {
            findOne: vi.fn(() => query(attempt())),
            updateOne: vi.fn()
        };
        const service = new AgenticBlogQaBatchService({
            BatchModel: { findOne: vi.fn(() => query(batch())) },
            CaseModel: { find: vi.fn(() => listQuery(qaCases())) },
            BlogModel: {
                find: vi.fn(() => query([articleBlog({ contentRevisionHash: 'revision-content-old' })]))
            },
            ReportModel: { find: vi.fn(() => query([sourceReport()])) },
            RemediationModel,
            EnsureInfrastructure: vi.fn().mockResolvedValue({ ensured: true }),
            config
        });

        await expect(service.resumeRemediation({
            batchId: ids.batch,
            attemptId: ids.attempt,
            adminId: ids.admin
        })).rejects.toThrow('requires a persisted changed draft revision');
        expect(RemediationModel.updateOne).not.toHaveBeenCalled();
    });

    it('reruns all reviews over retained drafts without generating a new article and tracks immutable result reports', async () => {
        const cases = qaCases();
        const CaseModel = {
            find: vi.fn()
                .mockImplementationOnce(() => listQuery(cases))
                .mockImplementationOnce(() => listQuery(cases))
                .mockImplementationOnce(() => listQuery([
                    { status: 'passed', hardGatePassed: true },
                    { status: 'passed', hardGatePassed: true }
                ])),
            updateMany: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
            updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 })
        };
        const BatchModel = {
            findOne: vi.fn(() => query(batch())),
            updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 })
        };
        const RemediationModel = {
            findOne: vi.fn(() => query(attempt())),
            updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 })
        };
        const reportFor = (qaCase, reportId) => ({
            _id: reportId,
            verdict: 'passed',
            totalScore: 92,
            existingSeoScore: 90,
            hardGatePassed: true,
            draftAcceptance: { pass: true, reasonCodes: [] },
            publishAcceptance: { pass: false, reasonCodes: ['qa_publish_forbidden'] },
            issueCounts: { critical: 0, high: 0, medium: 0, low: 0 },
            caseId: qaCase._id
        });
        const AcceptanceService = {
            reviewPersistedCase: vi.fn()
                .mockResolvedValueOnce({ report: reportFor(cases[0], ids.reportA) })
                .mockResolvedValueOnce({ report: reportFor(cases[1], ids.reportB) })
        };
        const ScheduleService = {
            runDailyDraftForQa: vi.fn(),
            runNow: vi.fn()
        };
        const service = new AgenticBlogQaBatchService({
            BatchModel,
            CaseModel,
            BlogModel: { find: vi.fn(() => query([articleBlog()])) },
            ReportModel: { find: vi.fn(() => query([sourceReport()])) },
            RemediationModel,
            AcceptanceService,
            ScheduleService,
            EnsureInfrastructure: vi.fn().mockResolvedValue({ ensured: true }),
            config,
            now: () => new Date('2026-07-22T10:00:00.000Z')
        });

        const result = await service.resumeRemediation({
            batchId: ids.batch,
            attemptId: ids.attempt,
            adminId: ids.admin
        });

        expect(result).toMatchObject({
            batchId: ids.batch,
            attemptId: ids.attempt,
            iteration: 1,
            status: 'passed',
            generatedDrafts: false
        });
        expect(AcceptanceService.reviewPersistedCase).toHaveBeenCalledTimes(2);
        expect(AcceptanceService.reviewPersistedCase).toHaveBeenNthCalledWith(1, {
            qaCaseId: ids.caseA,
            blogId: ids.blogA,
            executionId: ids.executionA,
            iteration: 1,
            createdBy: ids.admin
        });
        expect(ScheduleService.runDailyDraftForQa).not.toHaveBeenCalled();
        expect(ScheduleService.runNow).not.toHaveBeenCalled();
        expect(RemediationModel.updateOne).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ status: 'awaiting_action' }),
            expect.objectContaining({
                $set: expect.objectContaining({
                    controlCaseIds: [ids.caseB]
                })
            })
        );
        expect(RemediationModel.updateOne).toHaveBeenCalledWith(
            expect.objectContaining({
                _id: expect.anything(),
                iteration: 1,
                status: 'in_progress'
            }),
            expect.objectContaining({
                $set: expect.objectContaining({ status: 'completed' }),
                $addToSet: {
                    resultingReportIds: {
                        $each: [expect.anything(), expect.anything()]
                    }
                }
            })
        );
    });

    it('resumes article remediation when every retained case is independently affected', async () => {
        const cases = qaCases().map(item => ({ ...item, status: 'awaiting_remediation_action' }));
        const secondSourceReport = sourceReport({
            _id: ids.reportB,
            caseId: ids.caseB,
            qaCaseId: ids.caseB,
            blogId: ids.blogB,
            executionId: ids.executionB,
            contentRevisionHash: 'revision-content-old-b'
        });
        const blogs = [
            articleBlog(),
            articleBlog({
                _id: ids.blogB,
                qaCaseId: ids.caseB,
                contentRevisionHash: 'revision-content-new-b'
            })
        ];
        const CaseModel = {
            find: vi.fn()
                .mockImplementationOnce(() => listQuery(cases))
                .mockImplementationOnce(() => listQuery(cases))
                .mockImplementationOnce(() => listQuery([
                    { status: 'passed', hardGatePassed: true },
                    { status: 'passed', hardGatePassed: true }
                ])),
            updateMany: vi.fn().mockResolvedValue({ matchedCount: 2, modifiedCount: 2 }),
            updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 })
        };
        const RemediationModel = {
            findOne: vi.fn(() => query(attempt({
                caseIds: [ids.caseA, ids.caseB],
                sourceReportIds: [ids.sourceReport, ids.reportB]
            }))),
            updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 })
        };
        const reportFor = (qaCase, reportId) => ({
            _id: reportId,
            verdict: 'passed',
            totalScore: 92,
            existingSeoScore: 90,
            hardGatePassed: true,
            draftAcceptance: { pass: true, reasonCodes: [] },
            publishAcceptance: { pass: false, reasonCodes: ['qa_publish_forbidden'] },
            issueCounts: { critical: 0, high: 0, medium: 0, low: 0 },
            caseId: qaCase._id
        });
        const AcceptanceService = {
            reviewPersistedCase: vi.fn()
                .mockResolvedValueOnce({ report: reportFor(cases[0], ids.reportA) })
                .mockResolvedValueOnce({ report: reportFor(cases[1], ids.reportB) })
        };
        const ScheduleService = { runDailyDraftForQa: vi.fn(), runNow: vi.fn() };
        const service = new AgenticBlogQaBatchService({
            BatchModel: {
                findOne: vi.fn(() => query(batch())),
                updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 })
            },
            CaseModel,
            BlogModel: { find: vi.fn(() => query(blogs)) },
            ReportModel: { find: vi.fn(() => query([sourceReport(), secondSourceReport])) },
            RemediationModel,
            AcceptanceService,
            ScheduleService,
            EnsureInfrastructure: vi.fn().mockResolvedValue({ ensured: true }),
            config,
            now: () => new Date('2026-07-22T10:00:00.000Z')
        });

        const result = await service.resumeRemediation({
            batchId: ids.batch,
            attemptId: ids.attempt,
            adminId: ids.admin
        });

        expect(result).toMatchObject({ status: 'passed', generatedDrafts: false });
        expect(AcceptanceService.reviewPersistedCase).toHaveBeenCalledTimes(2);
        expect(ScheduleService.runDailyDraftForQa).not.toHaveBeenCalled();
        expect(ScheduleService.runNow).not.toHaveBeenCalled();
        expect(RemediationModel.updateOne).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ status: 'awaiting_action' }),
            expect.objectContaining({
                $set: expect.objectContaining({
                    controlCaseIds: [ids.caseA, ids.caseB],
                    rerunCaseIds: [ids.caseA, ids.caseB]
                })
            })
        );
    });

    it('requires server-verified code evidence and dispatches the complete matrix with an unaffected control', async () => {
        const cases = qaCases();
        const BatchModel = {
            findOne: vi.fn(() => query(batch())),
            updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 })
        };
        const CaseModel = {
            find: vi.fn(() => listQuery(cases)),
            updateMany: vi.fn().mockResolvedValue({ matchedCount: 2, modifiedCount: 2 })
        };
        const RemediationModel = {
            findOne: vi.fn(() => query(attempt({
                classification: 'shared_stage',
                failedLayer: 'weak_editorial_opening',
                baselineCodeRevision: 'revision-old-001'
            }))),
            updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 })
        };
        const service = new AgenticBlogQaBatchService({
            BatchModel,
            CaseModel,
            RemediationModel,
            CodeRevision: () => 'revision-new-002',
            EnsureInfrastructure: vi.fn().mockResolvedValue({ ensured: true }),
            config
        });
        service.runBatch = vi.fn().mockResolvedValue({
            batchId: ids.batch,
            queued: cases.map(item => ({ caseId: item._id })),
            requireAllCasesPass: true
        });

        const result = await service.resumeRemediation({
            batchId: ids.batch,
            attemptId: ids.attempt,
            adminId: ids.admin,
            payload: {
                acknowledgeCodeChange: true,
                appliedCodeRevision: 'revision-new-002',
                actionEvidence: {
                    changedLayer: 'weak_editorial_opening',
                    changeSummary: 'Repair the shared editorial opening stage contract.',
                    verificationRefs: ['LOCAL-QA-CODE-001', 'LOCAL-VERIFY-001']
                }
            }
        });

        expect(result).toMatchObject({
            fullBatchRerun: true,
            unaffectedControlCaseId: ids.caseB,
            status: 'in_progress'
        });
        expect(CaseModel.updateMany).toHaveBeenCalledWith(
            { batchId: expect.anything(), environment: 'local', isQaTest: true },
            expect.objectContaining({
                $set: expect.objectContaining({
                    status: 'reserved',
                    executionId: null,
                    blogId: null,
                    acceptanceReportId: null
                })
            })
        );
        expect(RemediationModel.updateOne).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'awaiting_action' }),
            expect.objectContaining({
                $set: expect.objectContaining({
                    status: 'in_progress',
                    appliedCodeRevision: 'revision-new-002',
                    rerunCaseIds: [ids.caseA, ids.caseB],
                    controlCaseIds: [ids.caseB]
                })
            })
        );
        expect(service.runBatch).toHaveBeenCalledWith({
            batchId: expect.anything(),
            adminId: ids.admin,
            idempotencyKey: `qa-remediation-resume-${ids.attempt}`,
            caseIds: null
        });
    });

    it('allows a systemic full-batch rerun when every retained case is affected', async () => {
        const cases = qaCases();
        const RemediationModel = {
            findOne: vi.fn(() => query(attempt({
                classification: 'systemic_workflow',
                failedLayer: 'artifact_chain_bypass',
                caseIds: [ids.caseA, ids.caseB],
                baselineCodeRevision: 'revision-old-001',
                requiresArchitectureReport: true
            }))),
            updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 })
        };
        const service = new AgenticBlogQaBatchService({
            BatchModel: {
                findOne: vi.fn(() => query(batch())),
                updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 })
            },
            CaseModel: {
                find: vi.fn(() => listQuery(cases)),
                updateMany: vi.fn().mockResolvedValue({ matchedCount: 2, modifiedCount: 2 })
            },
            RemediationModel,
            CodeRevision: () => 'revision-new-002',
            EnsureInfrastructure: vi.fn().mockResolvedValue({ ensured: true }),
            config
        });
        service.runBatch = vi.fn().mockResolvedValue({ batchId: ids.batch, queued: [], requireAllCasesPass: true });

        const result = await service.resumeRemediation({
            batchId: ids.batch,
            attemptId: ids.attempt,
            adminId: ids.admin,
            payload: {
                acknowledgeCodeChange: true,
                appliedCodeRevision: 'revision-new-002',
                actionEvidence: {
                    changedLayer: 'artifact_chain_bypass',
                    changeSummary: 'Repair only the proven artifact ownership contract.',
                    verificationRefs: ['LOCAL-QA-CODE-001', 'LOCAL-VERIFY-001'],
                    architectureReport: {
                        failedLayer: 'artifact_chain_bypass',
                        rootCause: 'The persisted artifact ownership check could be bypassed during review.',
                        redesignScope: 'Repair only the evidence ownership boundary.',
                        backwardCompatibility: 'Retain the existing report schema and external API contract.'
                    }
                }
            }
        });

        expect(result).toMatchObject({
            fullBatchRerun: true,
            unaffectedControlCaseId: null,
            status: 'in_progress'
        });
        expect(RemediationModel.updateOne).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ status: 'awaiting_action' }),
            expect.objectContaining({
                $set: expect.objectContaining({
                    rerunCaseIds: [ids.caseA, ids.caseB],
                    controlCaseIds: []
                })
            })
        );
    });

    it('keeps an unaffected control mandatory for a shared-stage rerun', async () => {
        const cases = qaCases();
        const RemediationModel = {
            findOne: vi.fn(() => query(attempt({
                classification: 'shared_stage',
                failedLayer: 'weak_editorial_opening',
                caseIds: [ids.caseA, ids.caseB]
            }))),
            updateOne: vi.fn()
        };
        const service = new AgenticBlogQaBatchService({
            BatchModel: { findOne: vi.fn(() => query(batch())) },
            CaseModel: { find: vi.fn(() => listQuery(cases)) },
            RemediationModel,
            EnsureInfrastructure: vi.fn().mockResolvedValue({ ensured: true }),
            config
        });

        await expect(service.resumeRemediation({
            batchId: ids.batch,
            attemptId: ids.attempt,
            adminId: ids.admin,
            payload: {}
        })).rejects.toThrow('requires at least one retained unaffected control case');
        expect(RemediationModel.updateOne).not.toHaveBeenCalled();
    });

    it('compensates every retained QA artifact family when dispatch fails after the batch starts', async () => {
        const qaCase = {
            _id: ids.caseA,
            caseKey: 'COMPENSATION-CASE',
            isQaTest: true,
            batchId: ids.batch,
            qaBatchId: ids.batch,
            environment: 'local',
            executionMode: 'run_now',
            scheduleId: ids.schedule,
            status: 'reserved',
            runAttempts: []
        };
        const BatchModel = {
            findOne: vi.fn(() => query(batch({ status: 'planned', iteration: 0, caseIds: [ids.caseA] }))),
            updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 })
        };
        const CaseModel = {
            find: vi.fn(() => listQuery([qaCase])),
            updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
            updateMany: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 })
        };
        const ScheduleModel = {
            findOne: vi.fn(() => query({ _id: ids.schedule, isQaTest: true })),
            updateMany: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 })
        };
        const ExecutionModel = {
            updateMany: vi.fn().mockResolvedValue({ matchedCount: 0, modifiedCount: 0 })
        };
        const service = new AgenticBlogQaBatchService({
            BatchModel,
            CaseModel,
            ScheduleModel,
            ExecutionModel,
            ScheduleService: {
                runDailyDraftForQa: vi.fn().mockResolvedValue({ executionId: 'invalid-object-id' }),
                runNow: vi.fn()
            },
            EnsureInfrastructure: vi.fn().mockResolvedValue({ ensured: true }),
            config,
            now: () => new Date('2026-07-22T11:00:00.000Z')
        });

        await expect(service.runBatch({
            batchId: ids.batch,
            adminId: ids.admin,
            idempotencyKey: 'dispatch-compensation-001'
        })).rejects.toThrow('executionId is invalid');

        expect(BatchModel.updateOne).toHaveBeenCalledWith(
            expect.objectContaining({ _id: expect.anything(), isQaTest: true }),
            { $set: expect.objectContaining({ status: 'failed', stopNewDrafts: true }) }
        );
        expect(CaseModel.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                batchId: expect.anything(),
                status: { $in: ['reserved', 'queued', 'running'] }
            }),
            { $set: expect.objectContaining({ status: 'failed' }) }
        );
        expect(ScheduleModel.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({ qaBatchId: expect.anything(), isQaTest: true }),
            { $set: { enabled: false, nextRunAt: null } }
        );
        expect(ExecutionModel.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({ qaBatchId: expect.anything(), status: 'queued' }),
            { $set: expect.objectContaining({ status: 'failed', error: 'QA_BATCH_PARTIAL_DISPATCH_CANCELLED' }) }
        );
    });

    it('requires an exact-layer architecture report for systemic code remediation', () => {
        const systemic = attempt({
            classification: 'systemic_workflow',
            failedLayer: 'artifact_chain_bypass',
            baselineCodeRevision: 'revision-old-001',
            requiresArchitectureReport: true
        });
        const base = {
            acknowledgeCodeChange: true,
            appliedCodeRevision: 'revision-new-002',
            actionEvidence: {
                changedLayer: 'artifact_chain_bypass',
                changeSummary: 'Repair the exact artifact-chain contract and retain safety gates.',
                verificationRefs: ['LOCAL-QA-CODE-001']
            }
        };

        expect(() => normalizeCodeActionEvidence({
            payload: base,
            attempt: systemic,
            serverCodeRevision: 'revision-new-002'
        })).toThrow('architectureReport is required');

        expect(() => normalizeCodeActionEvidence({
            payload: {
                ...base,
                actionEvidence: {
                    ...base.actionEvidence,
                    architectureReport: {
                        failedLayer: 'different_layer',
                        rootCause: 'The persisted artifact binding was not enforced before review.',
                        redesignScope: 'Repair only the evidence ownership boundary.',
                        backwardCompatibility: 'Keep the existing report schema and public API stable.'
                    }
                }
            },
            attempt: systemic,
            serverCodeRevision: 'revision-new-002'
        })).toThrow('exact failed layer');
    });

    it('rejects any remediation attempt outside the hard three-iteration bound', async () => {
        const RemediationModel = {
            findOne: vi.fn(() => query(attempt({ iteration: 4 }))),
            updateOne: vi.fn()
        };
        const service = new AgenticBlogQaBatchService({
            BatchModel: { findOne: vi.fn(() => query(batch({ iteration: 4 }))) },
            CaseModel: { find: vi.fn(() => listQuery(qaCases())) },
            RemediationModel,
            EnsureInfrastructure: vi.fn().mockResolvedValue({ ensured: true }),
            config
        });

        await expect(service.resumeRemediation({
            batchId: ids.batch,
            attemptId: ids.attempt,
            adminId: ids.admin
        })).rejects.toThrow('outside the retained bounded batch iteration');
        expect(RemediationModel.updateOne).not.toHaveBeenCalled();
    });
});
