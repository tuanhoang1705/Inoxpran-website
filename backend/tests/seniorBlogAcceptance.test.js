import crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    AUDITOR_GATE_GROUPS,
    RUBRIC,
    RUBRIC_VERSION,
    SENIOR_AUDITOR_AGENT_ID,
    SeniorBlogAcceptanceService,
    buildBlindAuditInput,
    buildPersistedBlindInput,
    evaluateSeniorAcceptance,
    findForbiddenBlindPaths,
    normalizeAuditorHardGates,
    stableHash,
    validateAuditorBinding
} = require('../src/services/seniorBlogAcceptance.service');
const { SeniorBlogAcceptanceReport } = require('../src/models/seniorBlogAcceptanceReport.model');

const ids = Object.freeze({
    batch: '507f1f77bcf86cd799439101',
    case: '507f1f77bcf86cd799439102',
    blog: '507f1f77bcf86cd799439103',
    execution: '507f1f77bcf86cd799439104'
});

const categories = ({ productApplicable = false, score = 'maximum' } = {}) => Object.fromEntries(
    RUBRIC.map(definition => {
        const notApplicable = definition.productOnly && !productApplicable;
        return [definition.key, {
            score: notApplicable ? 0 : (score === 'maximum' ? definition.maximum : score),
            maximum: definition.maximum,
            notApplicable,
            evidence: [`persisted evidence for ${definition.key}`],
            strengths: [],
            issues: [],
            requiredFixes: []
        }];
    })
);

const auditorHardGates = ({ productApplicable = false } = {}) => [
    { key: 'workflow.execution', status: 'pass', evidence: ['ordered trace is complete'] },
    { key: 'isolation.draft_only', status: 'pass', evidence: ['draft boundary is persisted'] },
    { key: 'content.people_first', status: 'pass', evidence: ['article content inspected'] },
    { key: 'evidence.sources', status: 'pass', evidence: ['evidence map inspected'] },
    {
        key: 'product.integration',
        status: productApplicable ? 'pass' : 'not_applicable',
        evidence: [productApplicable ? 'product evidence inspected' : 'product mode is off']
    },
    { key: 'seo_cms.metadata', status: 'pass', evidence: ['metadata inspected'] },
    { key: 'images.visual_plan', status: 'pass', evidence: ['safe visual plan inspected'] },
    { key: 'security.html', status: 'pass', evidence: ['sanitized HTML inspected'] }
];

const auditorOutput = ({ productApplicable = false } = {}) => ({
    schemaVersion: '1.0',
    context: 'draft_acceptance',
    agentId: SENIOR_AUDITOR_AGENT_ID,
    blindInputHash: 'blind-hash',
    rubricVersion: RUBRIC_VERSION,
    artifactRefs: { qaBatchId: ids.batch, qaCaseId: ids.case, blogId: ids.blog, executionId: ids.execution },
    auditorTotal: null,
    independence: { blindReviewConfirmed: true, forbiddenInputsDetected: [] },
    categories: categories({ productApplicable }),
    hardGates: auditorHardGates({ productApplicable }),
    criticalHighIssues: [],
    topicUniqueness: { status: 'pass' },
    draftState: { status: 'pass', isDraft: true, isPublic: false },
    draftAcceptanceInputs: { eligible: true, blockingReasons: [] },
    publishAcceptanceInputs: { eligible: false, blockingReasons: ['qa_artifact_must_remain_draft'] }
});

const deterministicEvidence = (overrides = {}) => ({
    isDraft: true,
    isPublished: false,
    publiclyReachable: false,
    indexRequested: false,
    telegramSent: false,
    socialDistributed: false,
    topicUnique: true,
    topicPreserved: true,
    artifactChainValid: true,
    scheduleOwnershipValid: true,
    visualPlanValid: true,
    imageUnsafe: false,
    completedWithoutImageApproval: false,
    sanitizerStable: true,
    canonicalSafe: true,
    slugValid: true,
    structuredDataValid: true,
    unsafeHtmlCount: 0,
    duplicateExecutionCount: 0,
    promptInjectionSignalCount: 0,
    evidenceCoverageDenominator: 1,
    evidenceCoverageRatio: 1,
    unsupportedClaimCount: 0,
    mandatorySourcesSucceeded: true,
    ...overrides
});

const existingGateResults = ({ productApplicable = false } = {}) => ({
    factReview: { status: 'passed' },
    originalityReview: { status: 'passed' },
    seoAeoGeoReview: { status: 'passed' },
    peopleFirstSpamReview: { status: 'passed' },
    brandVoiceReview: { status: 'passed' },
    securityReview: { status: 'passed' },
    imageReview: { status: 'passed' },
    productClaimReview: { status: productApplicable ? 'passed' : 'not_applicable' },
    productPlacementReview: { status: productApplicable ? 'passed' : 'not_applicable' },
    publishReadiness: { status: 'failed' }
});

const evaluate = ({
    output = auditorOutput(),
    evidence = deterministicEvidence(),
    gates = existingGateResults(),
    seoScore = 85,
    seoThreshold = 85,
    productMode = 'off',
    productUsed = false
} = {}) => evaluateSeniorAcceptance({
    auditorOutput: output,
    deterministicEvidence: evidence,
    existingGateResults: gates,
    existingSeoScore: seoScore,
    existingSeoThreshold: seoThreshold,
    productMode,
    productUsed
});

describe('Senior Blog Acceptance deterministic contract', () => {
    it('uses all eleven rubric categories, totals 100 maximum, and keeps the threshold at 81', () => {
        expect(RUBRIC).toHaveLength(11);
        expect(RUBRIC.reduce((total, item) => total + item.maximum, 0)).toBe(100);
        const result = evaluate();

        expect(result.totalScore).toBe(91);
        expect(result.categories.productMarketingCta).toMatchObject({
            score: 0,
            maximum: 9,
            notApplicable: true
        });
        expect(result.draftAcceptance).toEqual({ pass: true, reasonCodes: [] });
        expect(result.publishAcceptance).toEqual({ pass: false, reasonCodes: ['qa_publish_forbidden'] });
        expect(result.verdict).toBe('passed');
    });

    it('does not let a perfect 100 override a deterministic publication failure', () => {
        const result = evaluate({
            output: auditorOutput({ productApplicable: true }),
            evidence: deterministicEvidence({ isPublished: true, publiclyReachable: true }),
            gates: existingGateResults({ productApplicable: true }),
            productMode: 'auto',
            productUsed: true
        });

        expect(result.totalScore).toBe(100);
        expect(result.hardGatePassed).toBe(false);
        expect(result.draftAcceptance.pass).toBe(false);
        expect(result.draftAcceptance.reasonCodes).toEqual(expect.arrayContaining([
            'qa_isPublished_failed',
            'qa_publiclyReachable_failed'
        ]));
        expect(result.verdict).toBe('failed');
    });

    it.each([
        [{ evidenceCoverageDenominator: 0 }, 'qa_material_claim_denominator_empty'],
        [{ evidenceCoverageDenominator: '1' }, 'qa_material_claim_denominator_empty'],
        [{ evidenceCoverageDenominator: 1, evidenceCoverageRatio: 0.9999 }, 'qa_evidence_coverage_incomplete'],
        [{ evidenceCoverageRatio: '1' }, 'qa_evidence_coverage_incomplete'],
        [{ unsupportedClaimCount: 1 }, 'qa_unsupported_material_claims'],
        [{ unsupportedClaimCount: '0' }, 'qa_unsupported_material_claims'],
        [{ mandatorySourcesSucceeded: false }, 'qa_mandatory_sources_failed'],
        [{ mandatorySourcesSucceeded: undefined }, 'qa_mandatory_sources_failed']
    ])('does not let a perfect auditor override deterministic evidence failure %#', (override, reasonCode) => {
        const result = evaluate({ evidence: deterministicEvidence(override) });

        expect(result.totalScore).toBe(91);
        expect(result.hardGatePassed).toBe(false);
        expect(result.draftAcceptance.pass).toBe(false);
        expect(result.draftAcceptance.reasonCodes).toContain(reasonCode);
        expect(result.verdict).toBe('failed');
    });

    it('requires an explicitly successful mandatory-source invariant even for a partial Google snapshot', () => {
        const failed = evaluate({
            evidence: deterministicEvidence({
                googleIntelligenceStatus: 'partial',
                mandatorySourcesSucceeded: false
            })
        });
        expect(failed.draftAcceptance).toMatchObject({ pass: false });
        expect(failed.draftAcceptance.reasonCodes).toContain('qa_mandatory_sources_failed');

        const explicitSuccess = evaluate({
            evidence: deterministicEvidence({
                googleIntelligenceStatus: 'partial',
                mandatorySourcesSucceeded: true
            })
        });
        expect(explicitSuccess.draftAcceptance).toEqual({ pass: true, reasonCodes: [] });
    });

    it('requires product-off reviews to use an explicit zero-point not-applicable category', () => {
        const output = auditorOutput();
        output.categories.productMarketingCta = {
            ...output.categories.productMarketingCta,
            notApplicable: false,
            score: 9
        };

        expect(() => evaluate({ output })).toThrow('must be marked not applicable');
    });

    it('treats product auto with no persisted selected product as not applicable instead of awarding product points', () => {
        const result = evaluate({
            output: auditorOutput({ productApplicable: false }),
            gates: existingGateResults({ productApplicable: false }),
            productMode: 'auto',
            productUsed: false
        });

        expect(result.categories.productMarketingCta).toMatchObject({
            score: 0,
            maximum: 9,
            notApplicable: true
        });
        expect(result.hardGates.find(gate => gate.key === 'productClaimReview')).toMatchObject({ pass: true });
        expect(result.hardGates.find(gate => gate.key === 'productPlacementReview')).toMatchObject({ pass: true });
        expect(result.draftAcceptance.pass).toBe(true);
    });

    it('blocks category floor failures and any critical or high issue even above 81', () => {
        const output = auditorOutput({ productApplicable: true });
        output.categories.strategyAlignment.score = 6;
        output.categories.editorialQuality.issues = [{ code: 'unsupported_claim', severity: 'high', message: 'Unsupported' }];
        const result = evaluate({
            output,
            gates: existingGateResults({ productApplicable: true }),
            productMode: 'auto',
            productUsed: true
        });

        expect(result.totalScore).toBe(96);
        expect(result.draftAcceptance.pass).toBe(false);
        expect(result.draftAcceptance.reasonCodes).toEqual(expect.arrayContaining([
            'floor_strategyAlignment',
            'high_issue_remaining'
        ]));
    });

    it('keeps the persisted SEO threshold independent and never below 85', () => {
        expect(() => evaluate({ seoThreshold: 84 })).toThrow('between 85 and 100');
        const result = evaluate({ seoScore: 88, seoThreshold: 90 });
        expect(result.draftAcceptance.pass).toBe(false);
        expect(result.draftAcceptance.reasonCodes).toContain('existing_seo_score_below_threshold');
    });

    it('fails closed when topic, draft, publish-boundary, or independence assertions are missing', () => {
        const output = auditorOutput();
        delete output.topicUniqueness;
        output.draftState = { status: 'pass', isDraft: false, isPublic: true };
        output.draftAcceptanceInputs = { eligible: false, blockingReasons: ['insufficient_evidence'] };
        output.publishAcceptanceInputs = { eligible: true, blockingReasons: [] };
        output.independence = {
            blindReviewConfirmed: false,
            forbiddenInputsDetected: ['writerModel']
        };
        const result = evaluate({ output });

        expect(result.draftAcceptance.pass).toBe(false);
        expect(result.draftAcceptance.reasonCodes).toEqual(expect.arrayContaining([
            'auditor_topic_uniqueness_failed',
            'auditor_draft_state_failed',
            'auditor_draft_acceptance_input_failed',
            'auditor_publish_acceptance_boundary_failed',
            'senior_auditor_not_independent',
            'senior_auditor_forbidden_inputs_detected'
        ]));
    });

    it('rejects an incomplete top-level auditor schema instead of inferring missing arrays', () => {
        const missingIssues = auditorOutput();
        delete missingIssues.criticalHighIssues;
        expect(() => evaluate({ output: missingIssues })).toThrow('criticalHighIssues must be an array');

        const missingGates = auditorOutput();
        delete missingGates.hardGates;
        expect(() => evaluate({ output: missingGates })).toThrow('hardGates must be a non-empty array');

        const wrongContext = auditorOutput();
        wrongContext.context = 'publish_acceptance';
        expect(() => evaluate({ output: wrongContext })).toThrow('schemaVersion or context is invalid');
    });
});

describe('Senior auditor hard-gate schema', () => {
    it('covers every required auditor gate group with status and evidence', () => {
        const gates = normalizeAuditorHardGates(auditorHardGates(), { productApplicable: false });
        expect(AUDITOR_GATE_GROUPS.every(group => gates.some(gate => group.match(gate.key)))).toBe(true);
        expect(gates.every(gate => ['pass', 'not_applicable'].includes(gate.status))).toBe(true);
        expect(gates.every(gate => gate.evidence.length > 0)).toBe(true);
    });

    it('rejects missing groups, duplicate keys, invalid statuses, and missing evidence', () => {
        expect(() => normalizeAuditorHardGates(
            auditorHardGates().filter(gate => !gate.key.startsWith('security.')),
            { productApplicable: false }
        )).toThrow('missing required groups');

        expect(() => normalizeAuditorHardGates([
            ...auditorHardGates(),
            { ...auditorHardGates()[0] }
        ], { productApplicable: false })).toThrow('duplicate key');

        expect(() => normalizeAuditorHardGates(
            auditorHardGates().map((gate, index) => index === 0 ? { ...gate, status: 'unknown' } : gate),
            { productApplicable: false }
        )).toThrow('status is invalid');

        expect(() => normalizeAuditorHardGates(
            auditorHardGates().map((gate, index) => index === 0 ? { ...gate, evidence: [] } : gate),
            { productApplicable: false }
        )).toThrow('evidence is required');
    });

    it('allows not-applicable only for a product gate when product use is off', () => {
        expect(() => normalizeAuditorHardGates(auditorHardGates(), { productApplicable: true }))
            .toThrow('cannot be not applicable');
        expect(() => normalizeAuditorHardGates(
            auditorHardGates().map(gate => gate.key === 'security.html' ? { ...gate, status: 'not_applicable' } : gate),
            { productApplicable: false }
        )).toThrow('cannot be not applicable');
    });
});

describe('blind review inputs and immutable report identity', () => {
    it('recursively strips writer identity, writer model, self scores, prior scores, and auditor identity', () => {
        const raw = {
            writerIdentity: 'author-1',
            writerModel: 'model-secret',
            selfScore: 100,
            nested: {
                previousSeniorAcceptanceScore: 99,
                existingSeoScore: 98,
                auditorAgentId: 'same-agent',
                safeEvidence: 'retained'
            }
        };
        expect(findForbiddenBlindPaths(raw)).toEqual(expect.arrayContaining([
            'writerIdentity',
            'writerModel',
            'selfScore',
            'nested.previousSeniorAcceptanceScore',
            'nested.existingSeoScore',
            'nested.auditorAgentId'
        ]));

        const sanitized = buildBlindAuditInput(raw);
        expect(findForbiddenBlindPaths(sanitized)).toEqual([]);
        expect(sanitized).toEqual({ nested: { safeEvidence: 'retained' } });
    });

    it('binds the blind package to the QA batch, case, blog, and execution artifacts', () => {
        const input = buildPersistedBlindInput({
            qaCase: {
                _id: ids.case,
                qaBatchId: ids.batch,
                articleType: 'how-to',
                contentRole: 'task completion',
                searchIntent: 'how-to',
                productMode: 'off',
                plannedOutline: ['Assess', 'Clean', 'Verify']
            },
            blog: {
                _id: ids.blog,
                blog_title: 'Safe draft',
                blog_excerpt: 'A useful excerpt',
                blog_content: '<article><h2>Assess</h2><p>Persisted evidence.</p></article>'
            },
            deterministicEvidence: deterministicEvidence(),
            executionId: ids.execution,
            evidenceBundle: {
                execution: {
                    _id: ids.execution,
                    status: 'succeeded',
                    contentAction: 'new',
                    agentSteps: [{ key: 'writer', status: 'completed' }],
                    contentWorkOrderId: '507f1f77bcf86cd799439105',
                    unifiedContentBriefId: '507f1f77bcf86cd799439106'
                },
                workOrder: { _id: '507f1f77bcf86cd799439105', decision: 'new', topic: 'Safe draft' },
                brief: { _id: '507f1f77bcf86cd799439106', topic: 'Safe draft', workingTitle: 'Safe draft' },
                existingGateResults: existingGateResults()
            }
        });

        expect(input.artifactRefs).toEqual({
            qaBatchId: ids.batch,
            qaCaseId: ids.case,
            blogId: ids.blog,
            executionId: ids.execution
        });
        expect(input.executionTrace.artifactIds).toMatchObject({
            contentWorkOrderId: '507f1f77bcf86cd799439105',
            unifiedContentBriefId: '507f1f77bcf86cd799439106'
        });
        expect(input.workOrder.id).toBe('507f1f77bcf86cd799439105');
        expect(input.unifiedBrief.id).toBe('507f1f77bcf86cd799439106');
        expect(findForbiddenBlindPaths(input)).toEqual([]);
    });

    it('rejects an auditor response that changes any exact artifact binding', () => {
        const refs = { qaBatchId: ids.batch, qaCaseId: ids.case, blogId: ids.blog, executionId: ids.execution };
        const output = auditorOutput();
        output.blindInputHash = 'expected-hash';
        output.artifactRefs = { ...refs, blogId: '507f1f77bcf86cd799439199' };

        expect(() => validateAuditorBinding({
            auditorOutput: output,
            blindInputHash: 'expected-hash',
            artifactRefs: refs
        })).toThrow('binding is invalid');
    });

    it('returns an existing exact report without invoking the auditor or creating a second report', async () => {
        const evidenceBundle = {
            persistedCase: {
                _id: ids.case,
                qaBatchId: ids.batch,
                isQaTest: true,
                productMode: 'off',
                plannedOutline: []
            },
            persistedBlog: {
                _id: ids.blog,
                isQaTest: true,
                blog_title: 'Retained QA draft',
                blog_content: '<article><p>Retained content.</p></article>'
            },
            deterministicEvidence: deterministicEvidence(),
            contentRevisionHash: 'a'.repeat(64),
            existingGateResults: existingGateResults(),
            execution: { _id: ids.execution }
        };
        const blindInput = buildPersistedBlindInput({
            qaCase: evidenceBundle.persistedCase,
            blog: evidenceBundle.persistedBlog,
            deterministicEvidence: evidenceBundle.deterministicEvidence,
            executionId: ids.execution,
            evidenceBundle
        });
        const blindInputHash = stableHash(blindInput);
        const reviewKeyHash = crypto.createHash('sha256')
            .update(['senior-server-review-v2', ids.case, 0, evidenceBundle.contentRevisionHash, blindInputHash].join('\0'))
            .digest('hex');
        const existing = {
            _id: '507f1f77bcf86cd799439107',
            reviewKeyHash,
            contentRevisionHash: evidenceBundle.contentRevisionHash,
            blindInputHash
        };
        const ReportModel = {
            findOne: vi.fn(() => ({ lean: vi.fn().mockResolvedValue(existing) })),
            create: vi.fn()
        };
        const EvidenceService = { build: vi.fn().mockResolvedValue(evidenceBundle) };
        const AuditorAdapter = { evaluate: vi.fn() };
        const service = new SeniorBlogAcceptanceService({ ReportModel, EvidenceService, AuditorAdapter });

        const result = await service.reviewPersistedCase({
            qaCaseId: ids.case,
            blogId: ids.blog,
            executionId: ids.execution,
            iteration: 0
        });

        expect(result).toEqual({ report: existing, duplicate: true, idempotent: true });
        expect(AuditorAdapter.evaluate).not.toHaveBeenCalled();
        expect(ReportModel.create).not.toHaveBeenCalled();
        expect(EvidenceService.build).toHaveBeenCalledTimes(1);
    });

    it('rejects evidence drift after independent review and never persists the stale verdict', async () => {
        const firstBundle = {
            persistedCase: {
                _id: ids.case,
                qaBatchId: ids.batch,
                isQaTest: true,
                productMode: 'off',
                plannedOutline: []
            },
            persistedBlog: {
                _id: ids.blog,
                isQaTest: true,
                blog_title: 'Retained QA draft',
                blog_content: '<article><p>Version one.</p></article>'
            },
            deterministicEvidence: deterministicEvidence(),
            contentRevisionHash: 'a'.repeat(64),
            existingGateResults: existingGateResults(),
            existingSeoScore: 85,
            existingSeoThreshold: 85,
            execution: { _id: ids.execution }
        };
        const secondBundle = {
            ...firstBundle,
            persistedBlog: {
                ...firstBundle.persistedBlog,
                blog_content: '<article><p>Version changed during review.</p></article>'
            },
            contentRevisionHash: 'b'.repeat(64)
        };
        const ReportModel = {
            findOne: vi.fn(() => ({ lean: vi.fn().mockResolvedValue(null) })),
            create: vi.fn()
        };
        const EvidenceService = {
            build: vi.fn()
                .mockResolvedValueOnce(firstBundle)
                .mockResolvedValueOnce(secondBundle)
        };
        const AuditorAdapter = {
            evaluate: vi.fn(async ({ blindInputHash, artifactRefs }) => ({
                ...auditorOutput(),
                blindInputHash,
                artifactRefs
            }))
        };
        const service = new SeniorBlogAcceptanceService({ ReportModel, EvidenceService, AuditorAdapter });

        await expect(service.reviewPersistedCase({
            qaCaseId: ids.case,
            blogId: ids.blog,
            executionId: ids.execution,
            iteration: 0
        })).rejects.toThrow('changed during the independent review');
        expect(AuditorAdapter.evaluate).toHaveBeenCalledTimes(1);
        expect(EvidenceService.build).toHaveBeenCalledTimes(2);
        expect(ReportModel.create).not.toHaveBeenCalled();
    });

    it('declares report bindings and verdict inputs immutable with unique idempotency indexes', () => {
        const schema = SeniorBlogAcceptanceReport.schema;
        expect(schema.options.autoCreate).toBe(false);
        expect(schema.options.autoIndex).toBe(false);
        for (const path of [
            'batchId', 'caseId', 'qaBatchId', 'qaCaseId', 'blogId', 'executionId', 'iteration', 'version',
            'reviewKeyHash', 'contentRevisionHash', 'blindInputHash', 'totalScore',
            'hardGates', 'draftAcceptance', 'publishAcceptance', 'verdict'
        ]) {
            expect(schema.path(path)?.options?.immutable, `${path} must be immutable`).toBe(true);
        }
        const blockedOperations = [
            'updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace',
            'deleteOne', 'deleteMany', 'findOneAndDelete', 'bulkWrite'
        ];
        const registeredMiddleware = new Set(schema.s.hooks._pres.keys());
        expect(blockedOperations.every(operation => registeredMiddleware.has(operation))).toBe(true);
        const indexes = schema.indexes();
        expect(indexes).toEqual(expect.arrayContaining([
            [{ caseId: 1, iteration: 1 }, expect.objectContaining({ unique: true })],
            [{ caseId: 1, version: 1 }, expect.objectContaining({ unique: true })],
            [{ reviewKeyHash: 1 }, expect.objectContaining({ unique: true })]
        ]));
    });
});
