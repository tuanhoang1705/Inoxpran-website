import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    QaTopicUniquenessService,
    buildSemanticProfile,
    normalizeTopicKey,
    profileSimilarity,
    semanticTokens
} = require('../src/services/qaTopicUniqueness.service');
const {
    buildRegressionControls,
    classifyRemediation,
    normalizeFailureCode,
    validatePlan
} = require('../src/services/qaRemediationOrchestrator.service');

const ids = Object.freeze({
    batch: '507f1f77bcf86cd799439201',
    caseA: '507f1f77bcf86cd799439202',
    caseB: '507f1f77bcf86cd799439203',
    blogA: '507f1f77bcf86cd799439204',
    blogB: '507f1f77bcf86cd799439205',
    executionA: '507f1f77bcf86cd799439206',
    executionB: '507f1f77bcf86cd799439207'
});

const failedReport = ({ caseId, issueCode, severity = 'medium', hardGate = null } = {}) => ({
    _id: caseId === ids.caseA ? '507f1f77bcf86cd799439211' : '507f1f77bcf86cd799439212',
    caseId,
    verdict: 'failed',
    draftAcceptance: { pass: false, reasonCodes: [] },
    hardGatePassed: hardGate ? false : true,
    hardGates: hardGate ? [{ pass: false, reasonCode: hardGate, severity }] : [],
    categories: issueCode ? {
        editorialQuality: { issues: [{ code: issueCode, severity, message: issueCode }] }
    } : {},
    criticalHighIssues: [],
    independence: { blindReviewConfirmed: true, forbiddenInputsDetected: [] }
});

describe('QA topic normalization and semantic uniqueness', () => {
    it('normalizes Vietnamese accents, punctuation, casing, and whitespace deterministically', () => {
        expect(normalizeTopicKey('  CÁCH chọn NỒI Inox — cho Gia Đình!  '))
            .toBe('cach chon noi inox cho gia dinh');
        expect(normalizeTopicKey('Đồ gia dụng')).toBe('do gia dung');
    });

    it('uses semantic aliases so superficial wording changes cannot bypass similarity', () => {
        const left = buildSemanticProfile({
            effectiveTopic: 'Top cookware saucepan selection guide',
            mainEntity: 'cookware saucepan',
            userProblem: 'select cookware saucepan',
            searchIntent: 'commercial investigation',
            articleType: 'buying guide',
            plannedOutline: ['Cookware criteria', 'Compare saucepan options']
        });
        const right = buildSemanticProfile({
            effectiveTopic: 'Best nồi xoong selection guide',
            mainEntity: 'xoong nồi',
            userProblem: 'chọn xoong nồi',
            searchIntent: 'commercial investigation',
            articleType: 'buying guide',
            plannedOutline: ['Nồi criteria', 'So sánh xoong options']
        });
        const similarity = profileSimilarity(left, right);

        expect(semanticTokens('top cookware saucepan')).toEqual(expect.arrayContaining(['ranking', 'noi']));
        expect(similarity.conflict).toBe(true);
    });

    it('treats a consumed reservation as idempotent only for the exact blog/execution binding', async () => {
        const consumed = {
            _id: 'qa-topic:reserved',
            status: 'consumed',
            batchId: ids.batch,
            caseId: ids.caseA,
            blogId: ids.blogA,
            executionId: ids.executionA,
            executionMode: 'run_now'
        };
        const ReservationModel = {
            findById: vi.fn(() => ({ lean: vi.fn().mockResolvedValue(consumed) })),
            findOneAndUpdate: vi.fn()
        };
        const service = new QaTopicUniquenessService({ ReservationModel });

        await expect(service.consume({
            reservationId: consumed._id,
            batchId: ids.batch,
            caseId: ids.caseA,
            blogId: ids.blogA,
            executionId: ids.executionA,
            executionMode: 'run_now'
        })).resolves.toBe(consumed);
        expect(ReservationModel.findOneAndUpdate).not.toHaveBeenCalled();

        await expect(service.consume({
            reservationId: consumed._id,
            batchId: ids.batch,
            caseId: ids.caseA,
            blogId: ids.blogB,
            executionId: ids.executionA,
            executionMode: 'run_now'
        })).rejects.toMatchObject({ code: 'QA_TOPIC_RESERVATION_REBIND_FORBIDDEN' });

        await expect(service.consume({
            reservationId: consumed._id,
            batchId: ids.batch,
            caseId: ids.caseA,
            blogId: ids.blogA,
            executionId: ids.executionB,
            executionMode: 'run_now'
        })).rejects.toMatchObject({ code: 'QA_TOPIC_RESERVATION_REBIND_FORBIDDEN' });
    });

    it('rejects a reservation owned by a different case before attempting an update', async () => {
        const ReservationModel = {
            findById: vi.fn(() => ({ lean: vi.fn().mockResolvedValue({
                _id: 'qa-topic:reserved',
                status: 'reserved',
                batchId: ids.batch,
                caseId: ids.caseB
            }) })),
            findOneAndUpdate: vi.fn()
        };
        const service = new QaTopicUniquenessService({ ReservationModel });

        await expect(service.consume({
            reservationId: 'qa-topic:reserved',
            batchId: ids.batch,
            caseId: ids.caseA,
            blogId: ids.blogA,
            executionId: ids.executionA,
            executionMode: 'run_now'
        })).rejects.toMatchObject({ code: 'QA_TOPIC_RESERVATION_LOST' });
        expect(ReservationModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('releases only an unconsumed reservation by state transition and never deletes history', async () => {
        const updateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
        const service = new QaTopicUniquenessService({
            ReservationModel: { updateOne },
            now: () => new Date('2026-07-22T12:00:00Z')
        });

        await expect(service.releaseUnbound({
            reservationId: 'qa-topic:reserved',
            batchId: ids.batch,
            caseId: ids.caseA
        })).resolves.toMatchObject({ released: true });
        expect(updateOne).toHaveBeenCalledWith(
            expect.objectContaining({
                status: 'reserved',
                blogId: null,
                executionId: null,
                'consumptions.0': { $exists: false }
            }),
            { $set: { status: 'released', releasedAt: new Date('2026-07-22T12:00:00Z') } }
        );
    });

    it('fails closed before creating a reservation when the semantic lock lease is lost', async () => {
        const ReservationModel = {
            findById: vi.fn(() => ({ lean: vi.fn().mockResolvedValue(null) })),
            find: vi.fn(),
            create: vi.fn()
        };
        const LockModel = {
            findOneAndUpdate: vi.fn((filter, update) => ({
                lean: vi.fn().mockResolvedValue({ _id: filter._id, owner: update.$set.owner })
            })),
            updateOne: vi.fn().mockResolvedValue({ matchedCount: 0 })
        };
        const service = new QaTopicUniquenessService({
            ReservationModel,
            LockModel,
            InventoryItemModel: { find: vi.fn() },
            BlogModel: { find: vi.fn() },
            now: () => new Date('2026-07-22T12:00:00Z')
        });

        await expect(service.reserve({
            batchId: ids.batch,
            caseId: ids.caseA,
            environment: 'local',
            executionMode: 'run_now',
            originalTopicSeed: 'A unique stainless steel care topic',
            effectiveTopic: 'A unique stainless steel care topic',
            mainEntity: 'stainless steel care',
            searchIntent: 'informational',
            articleType: 'how-to',
            contentRole: 'care guidance',
            plannedOutline: ['Assess the surface', 'Use a safe method']
        })).rejects.toMatchObject({ code: 'QA_TOPIC_RESERVATION_LOCK_LOST' });
        expect(ReservationModel.create).not.toHaveBeenCalled();
    });
});

describe('QA remediation classification and safety', () => {
    it('classifies a deterministic workflow bypass as systemic', () => {
        const result = classifyRemediation({
            reports: [failedReport({ caseId: ids.caseA, hardGate: 'qa_artifactChainValid_failed', severity: 'high' })],
            caseCount: 6
        });

        expect(normalizeFailureCode('qa_artifactChainValid_failed')).toBe('artifact_chain_bypass');
        expect(result).toMatchObject({
            classification: 'systemic_workflow',
            failedLayer: 'artifact_chain_bypass',
            affectedCaseIds: [ids.caseA]
        });
    });

    it('classifies the same non-systemic failure across cases as a shared stage', () => {
        const result = classifyRemediation({
            reports: [
                failedReport({ caseId: ids.caseA, issueCode: 'weak_editorial_opening' }),
                failedReport({ caseId: ids.caseB, issueCode: 'weak_editorial_opening' })
            ],
            caseCount: 6
        });

        expect(result).toMatchObject({
            classification: 'shared_stage',
            failedLayer: 'weak_editorial_opening'
        });
        expect(result.affectedCaseIds).toEqual([ids.caseA, ids.caseB]);
    });

    it('keeps a single local content defect article-specific', () => {
        const result = classifyRemediation({
            reports: [failedReport({ caseId: ids.caseA, issueCode: 'weak_transition', severity: 'low' })],
            caseCount: 6
        });

        expect(result).toMatchObject({
            classification: 'article_specific',
            failedLayer: 'weak_transition',
            affectedCaseIds: [ids.caseA]
        });
    });

    it('escalates repeated systemic attempts and two independent critical defects', () => {
        const repeated = classifyRemediation({
            reports: [failedReport({ caseId: ids.caseA, issueCode: 'local_copy_issue', severity: 'low' })],
            caseCount: 6,
            priorAttempts: [{ classification: 'systemic_workflow' }, { classification: 'systemic_workflow' }]
        });
        expect(repeated).toMatchObject({
            classification: 'systemic_workflow',
            failedLayer: 'repeated_systemic_failure'
        });

        const critical = classifyRemediation({
            reports: [
                failedReport({ caseId: ids.caseA, issueCode: 'critical_one', severity: 'critical' }),
                failedReport({ caseId: ids.caseB, issueCode: 'critical_two', severity: 'critical' })
            ],
            caseCount: 6
        });
        expect(critical).toMatchObject({
            classification: 'systemic_workflow',
            failedLayer: 'critical_quality_gate'
        });
    });

    it.each([
        'Lower acceptance threshold to 70',
        'Remove failing case from the matrix',
        'Publish the QA article anyway',
        'Send Telegram notification after failure',
        'Disable security gate temporarily'
    ])('rejects a remediation action that weakens controls: %s', (action) => {
        expect(() => validatePlan({
            classification: 'article_specific',
            plan: [{ action, target: 'qa_case', expectedEvidence: 'none' }]
        })).toThrow('weaken');
    });

    it('requires shared/systemic plans and regression controls to repair the shared layer', () => {
        expect(() => validatePlan({
            classification: 'shared_stage',
            plan: [{ action: 'Edit one article', target: 'one_case', expectedEvidence: 'one diff' }]
        })).toThrow('shared-layer regression action');

        const controls = buildRegressionControls({
            classification: 'shared_stage',
            affectedCaseIds: [ids.caseA, ids.caseB]
        });
        expect(controls.map(control => control.control)).toEqual([
            'affected_cases_rechecked',
            'unaffected_case_control',
            'safety_policy_unchanged'
        ]);
        expect(controls[2].scope).toEqual(['draft_only', 'no_telegram', 'no_indexing', 'no_public_publish']);
    });
});
