import assert from 'node:assert/strict';
import test from 'node:test';

import {
	canUseQaAction,
	canResumeArticleQaRemediation,
	latestQaReportForCase,
	normalizeQaBatch,
	normalizeQaBatchDetail,
	normalizeQaCase,
	normalizeQaRemediationAttempt,
	normalizeQaReport,
	persistedQaScore,
	qaAcceptanceStatus,
	qaDraftAdminPath,
	qaFeatureAccess
} from '../src/lib/openclaw/blogQa.js';
import {
	safeQaCreateBody,
	safeQaEmptyActionBody,
	safeQaResumeBody
} from '../src/lib/server/agenticBlogQaRequest.js';

test('QA access is fail-closed unless the backend explicitly enables the feature and action', () => {
	assert.equal(canUseQaAction(qaFeatureAccess({}), 'run'), false);
	assert.equal(canUseQaAction(qaFeatureAccess({ featureEnabled: true }), 'view'), false);
	assert.equal(
		canUseQaAction(
			qaFeatureAccess({ featureEnabled: true, actions: { view: 'true', run: false } }),
			'view'
		),
		false
	);
	assert.equal(
		canUseQaAction(qaFeatureAccess({ featureEnabled: true, actions: { view: true } }), 'view'),
		true
	);
	assert.equal(
		canUseQaAction(qaFeatureAccess({ featureEnabled: true, actions: ['view', 'run'] }), 'run'),
		true
	);
	assert.equal(
		canUseQaAction(qaFeatureAccess({ featureEnabled: false, actions: ['run'] }), 'run'),
		false
	);
});

test('normalizes persisted QA cases and keeps server scores without calculating a client total', () => {
	const batch = normalizeQaBatch({
		batchId: 'batch-1',
		environment: 'staging',
		acceptanceThreshold: 81,
		cases: [
			{
				caseId: 'case-1',
				blogId: 'blog-1',
				seniorScore: 82.5,
				acceptanceReport: {
					categories: {
						strategyAlignment: { score: 40, maximum: 50 },
						peopleFirstUsefulness: { score: 43, maximum: 50 }
					}
				}
			}
		]
	});

	assert.equal(batch.cases[0].seniorScore, 82.5);
	assert.equal(persistedQaScore(batch.cases[0].seniorScore), '82.5');
	assert.equal(persistedQaScore(null), '--');
	assert.deepEqual(
		batch.cases[0].report.categories.map((category) => category.score),
		[40, 43]
	);
	assert.equal(qaDraftAdminPath(batch.cases[0].blogId), '/admin/blogs/blog-1');
});

test('normalizes the immutable persisted acceptance-report shape without recomputing its result', () => {
	const report = normalizeQaReport({
		_id: 'report-1',
		qaCaseId: 'case-1',
		totalScore: 81,
		existingSeoScore: 85,
		hardGatePassed: false,
		draftAcceptance: { pass: false, reasonCodes: ['hard_gate_failed'] },
		publishAcceptance: { pass: false, reasonCodes: ['qa_publish_forbidden'] },
		verdict: 'failed',
		evaluatedAt: '2026-07-22T08:00:00.000Z',
		categories: {
			strategyAlignment: {
				score: 8,
				maximum: 10,
				issues: [{ code: 'missing_strategy_link', message: 'Missing strategy link' }],
				requiredFixes: ['Connect the draft to the selected strategy.']
			}
		},
		criticalHighIssues: [{ code: 'unsupported_claim', severity: 'high' }]
	});

	assert.equal(report.id, 'report-1');
	assert.equal(report.caseId, 'case-1');
	assert.equal(report.seniorScore, 81);
	assert.equal(report.existingSeoScore, 85);
	assert.equal(report.hardGateStatus, false);
	assert.equal(report.status, 'failed');
	assert.equal(report.verdict, 'failed');
	assert.equal(report.categories[0].key, 'strategyAlignment');
	assert.equal(report.categories[0].score, 8);
	assert.equal(report.issues.length, 2);
	assert.deepEqual(report.requiredFixes, ['Connect the draft to the selected strategy.']);
});

test('uses persisted caseIds and loaded cases to prevent a stale case count from under-reporting', () => {
	const batch = normalizeQaBatch({
		batchId: 'batch-1',
		environment: 'local',
		caseCount: 1,
		caseIds: ['case-1', 'case-2', 'case-3'],
		cases: [{ caseId: 'case-1' }, { caseId: 'case-2' }]
	});

	assert.equal(batch.caseCount, 3);
	assert.deepEqual(batch.caseIds, ['case-1', 'case-2', 'case-3']);
});

test('keeps all acceptance gates pending until a persisted acceptance report exists', () => {
	const operationalFailure = normalizeQaCase({
		caseId: 'case-1',
		status: 'failed',
		hardGatePassed: false,
		draftAcceptance: { pass: false },
		publishAcceptance: { pass: false, reasonCode: 'qa_publish_forbidden' }
	});

	assert.equal(operationalFailure.reviewed, false);
	assert.equal(operationalFailure.hardGateStatus, null);
	assert.equal(operationalFailure.draftAcceptance, null);
	assert.equal(operationalFailure.publishAcceptance, null);
	assert.equal(qaAcceptanceStatus(operationalFailure.hardGateStatus), 'pending');
	assert.equal(qaAcceptanceStatus(operationalFailure.draftAcceptance), 'pending');
	assert.equal(qaAcceptanceStatus(operationalFailure.publishAcceptance), 'pending');

	const reviewedFailure = normalizeQaCase({
		caseId: 'case-1',
		acceptanceReportId: 'report-1',
		status: 'failed',
		hardGatePassed: false,
		draftAcceptance: { pass: false },
		publishAcceptance: { pass: false }
	});
	assert.equal(reviewedFailure.reviewed, true);
	assert.equal(qaAcceptanceStatus(reviewedFailure.publishAcceptance), 'failed');
});

test('rejects unsafe blog identifiers from the primary admin draft link', () => {
	assert.equal(qaDraftAdminPath('../public-post'), '');
	assert.equal(qaDraftAdminPath('blog_123'), '/admin/blogs/blog_123');
});

test('merges batch detail collections returned beside the batch document', () => {
	const detail = normalizeQaBatchDetail({
		batch: { batchId: 'batch-1', environment: 'local' },
		cases: [{ caseId: 'case-1', topic: 'Unique QA topic' }],
		reports: [
			{
				reportId: 'report-1',
				caseId: 'case-1',
				totalScore: 81,
				iteration: 1,
				issues: ['specific issue'],
				requiredFixes: ['specific fix']
			}
		],
		remediation: [{ attemptId: 'attempt-1', iteration: 1 }]
	});
	assert.equal(detail.cases[0].id, 'case-1');
	assert.equal(detail.cases[0].seniorScore, 81);
	assert.deepEqual(detail.cases[0].issues, ['specific issue']);
	assert.deepEqual(detail.cases[0].requiredFixes, ['specific fix']);
	assert.equal(detail.reports[0].seniorScore, 81);
	assert.equal(detail.remediationAttempts[0].id, 'attempt-1');
});

test('only an identified article-specific attempt awaiting action can use empty-body resume', () => {
	const articleAttempt = normalizeQaRemediationAttempt({
		attemptId: 'attempt-1',
		classification: 'ARTICLE_SPECIFIC',
		status: 'AWAITING_ACTION',
		iteration: '1'
	});
	assert.equal(articleAttempt.classification, 'article_specific');
	assert.equal(articleAttempt.status, 'awaiting_action');
	assert.equal(articleAttempt.iteration, 1);
	assert.equal(canResumeArticleQaRemediation(articleAttempt), true);
	assert.equal(
		canResumeArticleQaRemediation({
			attemptId: 'attempt-2',
			classification: 'shared_stage',
			status: 'awaiting_action'
		}),
		false
	);
	assert.equal(
		canResumeArticleQaRemediation({
			attemptId: '../unsafe',
			classification: 'article_specific',
			status: 'awaiting_action'
		}),
		false
	);
});

test('selects only the latest report for the requested case', () => {
	const reports = [
		{ _id: 'report-a1', caseId: 'case-a', iteration: 0, version: 1, totalScore: 70 },
		{ _id: 'report-b1', caseId: 'case-b', iteration: 3, version: 4, totalScore: 99 },
		{ _id: 'report-a2', caseId: 'case-a', iteration: 1, version: 2, totalScore: 84 }
	];

	assert.equal(latestQaReportForCase(reports, 'case-a')?.id, 'report-a2');
	assert.equal(latestQaReportForCase(reports, 'case-missing'), null);
});

test('QA proxy bodies are exact-key allowlists and empty actions remain empty', () => {
	assert.deepEqual(safeQaCreateBody({ environment: ' staging ' }), { environment: 'staging' });
	assert.equal(safeQaCreateBody({ environment: 'staging', apiKey: 'must-not-forward' }), null);
	assert.deepEqual(safeQaEmptyActionBody({}), {});
	assert.equal(safeQaEmptyActionBody([]), null);
	assert.equal(safeQaEmptyActionBody({ force: true }), null);
});

test('QA resume proxy accepts bounded verified code evidence and strips surrounding whitespace', () => {
	assert.deepEqual(
		safeQaResumeBody({
			acknowledgeCodeChange: true,
			appliedCodeRevision: ' revision-new-002 ',
			actionEvidence: {
				changedLayer: ' shared-stage ',
				changeSummary: ' Updated the shared evidence pipeline. ',
				verificationRefs: [' test:agentic-blog-qa ', 'sha:abcdef1234567']
			}
		}),
		{
			acknowledgeCodeChange: true,
			appliedCodeRevision: 'revision-new-002',
			actionEvidence: {
				changedLayer: 'shared-stage',
				changeSummary: 'Updated the shared evidence pipeline.',
				verificationRefs: ['test:agentic-blog-qa', 'sha:abcdef1234567']
			}
		}
	);
	const systemic = safeQaResumeBody({
		acknowledgeCodeChange: true,
		appliedCodeRevision: 'revision-new-003',
		actionEvidence: {
			changedLayer: 'workflow-orchestration',
			changeSummary: 'Redesigned the bounded workflow orchestration fence.',
			verificationRefs: ['test:systemic-workflow'],
			architectureReport: {
				failedLayer: 'workflow-orchestration',
				rootCause: 'The previous transition coupled dispatch and batch ownership.',
				redesignScope: 'Separate ownership acquisition from dispatch.',
				backwardCompatibility: 'Keep the existing request and report contracts stable.'
			}
		}
	});
	assert.equal(systemic?.actionEvidence?.architectureReport?.failedLayer, 'workflow-orchestration');
});

test('QA resume proxy rejects unknown fields, malformed evidence, and secret-bearing text', () => {
	const valid = {
		acknowledgeCodeChange: true,
		appliedCodeRevision: 'revision-new-002',
		actionEvidence: {
			changedLayer: 'shared-stage',
			changeSummary: 'Updated the shared evidence pipeline.',
			verificationRefs: ['test:agentic-blog-qa']
		}
	};
	assert.deepEqual(safeQaResumeBody({}), {});
	assert.equal(safeQaResumeBody({ ...valid, force: true }), null);
	assert.equal(
		safeQaResumeBody({
			...valid,
			actionEvidence: { ...valid.actionEvidence, debug: 'extra' }
		}),
		null
	);
	assert.equal(
		safeQaResumeBody({
			...valid,
			actionEvidence: { ...valid.actionEvidence, verificationRefs: ['bad ref with spaces'] }
		}),
		null
	);
	assert.equal(
		safeQaResumeBody({
			...valid,
			actionEvidence: {
				...valid.actionEvidence,
				changeSummary: 'Updated pipeline; api_key=must-not-forward'
			}
		}),
		null
	);
	assert.equal(
		safeQaResumeBody({
			...valid,
			actionEvidence: {
				...valid.actionEvidence,
				architectureReport: {
					failedLayer: 'shared-stage',
					rootCause: 'A sufficiently detailed root cause is recorded.',
					redesignScope: 'A bounded redesign scope.',
					backwardCompatibility: 'Existing contracts remain compatible.',
					unexpected: true
				}
			}
		}),
		null
	);
});
