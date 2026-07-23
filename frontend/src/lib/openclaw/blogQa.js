const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const QA_ENVIRONMENTS = new Set(['local', 'staging']);
const QA_REMEDIATION_TYPES = new Set(['article_specific', 'shared_stage', 'systemic_workflow']);

export const asQaArray = (value) => (Array.isArray(value) ? value : []);

const normalizeQaCategories = (value) => {
	if (Array.isArray(value)) return value;
	if (!value || typeof value !== 'object') return [];
	return Object.entries(value).map(([key, category]) => ({
		key,
		...(category && typeof category === 'object' ? category : { score: category })
	}));
};

const reportIssues = (report, categories) => {
	const candidates = [
		...asQaArray(report.issues),
		...asQaArray(report.criticalHighIssues),
		...categories.flatMap((category) => asQaArray(category?.issues))
	];
	return candidates.filter(Boolean);
};

const reportRequiredFixes = (report, categories) => [
	...asQaArray(report.requiredFixes),
	...categories.flatMap((category) => asQaArray(category?.requiredFixes))
];

export const qaEntityId = (value) => {
	const candidate =
		value && typeof value === 'object' ? (value.id ?? value._id ?? '') : (value ?? '');
	const normalized = String(candidate).trim();
	return SAFE_ID.test(normalized) ? normalized : '';
};

export const qaFeatureAccess = (payload = {}) => {
	const root = payload?.metadata ?? payload ?? {};
	const explicitEnabled = root.featureEnabled === true || root.enabled === true;
	const rawActions = root.actions ?? root.allowedActions ?? root.permissions ?? [];
	const actions = new Set();
	if (Array.isArray(rawActions)) {
		for (const action of rawActions) actions.add(String(action));
	} else if (rawActions && typeof rawActions === 'object') {
		for (const [action, allowed] of Object.entries(rawActions)) {
			if (allowed === true) actions.add(action);
		}
	}
	return { enabled: explicitEnabled, actions };
};

export const hasQaActionPermission = (access, action) =>
	access?.actions instanceof Set && access.actions.has(action);

export const canUseQaAction = (access, action) =>
	access?.enabled === true && hasQaActionPermission(access, action);

export const normalizeQaReport = (value = {}) => {
	const report = value && typeof value === 'object' ? value : {};
	const persistedTotal = report.totalScore ?? report.seniorScore ?? report.score;
	const categories = normalizeQaCategories(report.categories);
	return {
		...report,
		id: qaEntityId(report.id || report._id || report.reportId || report.acceptanceReportId),
		caseId: qaEntityId(report.caseId || report.qaCaseId),
		previousReportId: qaEntityId(report.previousReportId),
		status: String(report.status || report.verdict || 'pending')
			.trim()
			.toLowerCase(),
		verdict: String(report.verdict || report.status || 'pending')
			.trim()
			.toLowerCase(),
		hardGateStatus: report.hardGateStatus ?? report.hardGatePassed,
		draftAcceptance: report.draftAcceptance,
		publishAcceptance: report.publishAcceptance,
		seniorScore: Number.isFinite(Number(persistedTotal)) ? Number(persistedTotal) : null,
		existingSeoScore: Number.isFinite(Number(report.existingSeoScore ?? report.seoScore))
			? Number(report.existingSeoScore ?? report.seoScore)
			: null,
		issues: reportIssues(report, categories),
		requiredFixes: reportRequiredFixes(report, categories),
		categories
	};
};

const reportOrderValue = (report) => {
	const iteration = Number.isFinite(Number(report?.iteration)) ? Number(report.iteration) : -1;
	const version = Number.isFinite(Number(report?.version)) ? Number(report.version) : -1;
	const timestamp = new Date(report?.evaluatedAt || report?.createdAt || 0).getTime();
	return [iteration, version, Number.isFinite(timestamp) ? timestamp : 0];
};

export const latestQaReportForCase = (value, caseId = '') => {
	const targetCaseId = qaEntityId(caseId);
	const candidates = asQaArray(value)
		.map(normalizeQaReport)
		.filter((report) => !targetCaseId || report.caseId === targetCaseId);
	return (
		candidates.reduce((latest, report) => {
			if (!latest) return report;
			const currentOrder = reportOrderValue(report);
			const latestOrder = reportOrderValue(latest);
			for (let index = 0; index < currentOrder.length; index += 1) {
				if (currentOrder[index] > latestOrder[index]) return report;
				if (currentOrder[index] < latestOrder[index]) return latest;
			}
			return latest;
		}, null) || null
	);
};

export const normalizeQaCase = (value = {}) => {
	const item = value && typeof value === 'object' ? value : {};
	const report = normalizeQaReport(item.acceptanceReport || item.report || {});
	const persistedSeniorScore = item.totalScore ?? item.seniorScore;
	const reviewed = Boolean(qaEntityId(item.acceptanceReportId) || qaEntityId(report.id));
	return {
		...item,
		id: qaEntityId(item.id || item._id || item.caseId || item.qaCaseId),
		batchId: qaEntityId(item.batchId || item.qaBatchId),
		blogId: qaEntityId(item.blogId || item.blog),
		scheduleId: qaEntityId(item.scheduleId || item.schedule),
		executionId: qaEntityId(item.executionId || item.execution),
		topic: String(item.effectiveTopic || item.topic || item.topicSeed || '')
			.trim()
			.slice(0, 300),
		articleType: String(item.articleType || '')
			.trim()
			.slice(0, 100),
		executionMode: String(item.executionMode || '')
			.trim()
			.slice(0, 80),
		status: String(item.status || 'planned')
			.trim()
			.toLowerCase(),
		reviewed,
		report,
		seniorScore: Number.isFinite(Number(persistedSeniorScore))
			? Number(persistedSeniorScore)
			: report.seniorScore,
		existingSeoScore: Number.isFinite(Number(item.existingSeoScore ?? item.seoScore))
			? Number(item.existingSeoScore ?? item.seoScore)
			: report.existingSeoScore,
		issues: asQaArray(item.issues).length ? asQaArray(item.issues) : report.issues,
		hardGateStatus: reviewed
			? (item.hardGateStatus ??
				item.hardGatePassed ??
				item.hardGatesPassed ??
				report.hardGateStatus)
			: null,
		draftAcceptance: reviewed ? (item.draftAcceptance ?? report.draftAcceptance) : null,
		publishAcceptance: reviewed ? (item.publishAcceptance ?? report.publishAcceptance) : null,
		requiredFixes: asQaArray(item.requiredFixes).length
			? asQaArray(item.requiredFixes)
			: report.requiredFixes
	};
};

export const normalizeQaRemediationAttempt = (value = {}) => {
	const item = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
	const classification = String(item.classification || '')
		.trim()
		.toLowerCase();
	return {
		...item,
		id: qaEntityId(item.id || item._id || item.attemptId),
		classification: QA_REMEDIATION_TYPES.has(classification) ? classification : '',
		status: String(item.status || '')
			.trim()
			.toLowerCase()
			.slice(0, 80),
		failedLayer: String(item.failedLayer || '')
			.trim()
			.slice(0, 160),
		requiresArchitectureReport: item.requiresArchitectureReport === true,
		iteration: Number.isInteger(Number(item.iteration)) ? Number(item.iteration) : null
	};
};

export const canResumeArticleQaRemediation = (value) => {
	const attempt = normalizeQaRemediationAttempt(value);
	return (
		Boolean(attempt.id) &&
		attempt.classification === 'article_specific' &&
		attempt.status === 'awaiting_action'
	);
};

export const normalizeQaBatch = (value = {}) => {
	const item = value && typeof value === 'object' ? value : {};
	const environment = QA_ENVIRONMENTS.has(String(item.environment)) ? String(item.environment) : '';
	const cases = asQaArray(item.cases).map(normalizeQaCase);
	const caseIds = asQaArray(item.caseIds).map(qaEntityId).filter(Boolean);
	const persistedCaseCount = Number.isFinite(Number(item.caseCount))
		? Math.max(0, Number(item.caseCount))
		: 0;
	return {
		...item,
		id: qaEntityId(item.id || item._id || item.batchId || item.qaBatchId),
		environment,
		status: String(item.status || 'planned')
			.trim()
			.toLowerCase(),
		acceptanceThreshold: Number.isFinite(Number(item.acceptanceThreshold))
			? Number(item.acceptanceThreshold)
			: null,
		existingSeoThreshold: Number.isFinite(Number(item.existingSeoThreshold))
			? Number(item.existingSeoThreshold)
			: null,
		iteration: Number.isFinite(Number(item.iteration)) ? Number(item.iteration) : null,
		maxIterations: Number.isFinite(Number(item.maxIterations)) ? Number(item.maxIterations) : null,
		cases,
		caseIds,
		caseCount: Math.max(persistedCaseCount, cases.length, caseIds.length),
		reports: asQaArray(item.reports).map(normalizeQaReport),
		remediationAttempts: asQaArray(item.remediationAttempts || item.remediation).map(
			normalizeQaRemediationAttempt
		)
	};
};

export const normalizeQaBatchDetail = (payload = {}) => {
	const root = payload?.metadata ?? payload ?? {};
	const batch = root?.batch && typeof root.batch === 'object' ? root.batch : root;
	const reports = asQaArray(root.reports ?? batch.reports).map(normalizeQaReport);
	const cases = asQaArray(root.cases ?? batch.cases).map((item) => {
		const caseId = qaEntityId(item?.id || item?._id || item?.caseId || item?.qaCaseId);
		const report = latestQaReportForCase(reports, caseId);
		if (!report) return item;
		return {
			...item,
			acceptanceReport: report,
			issues: asQaArray(item?.issues).length ? item.issues : report.issues,
			requiredFixes: asQaArray(item?.requiredFixes).length
				? item.requiredFixes
				: report.requiredFixes
		};
	});
	return normalizeQaBatch({
		...batch,
		cases,
		reports,
		remediationAttempts:
			root.remediation ?? root.remediationAttempts ?? batch.remediationAttempts ?? batch.remediation
	});
};

export const qaBatchList = (payload = {}) => {
	const root = payload?.metadata ?? payload ?? {};
	const items = Array.isArray(root)
		? root
		: root.batches || root.qaBatches || root.items || root.results || [];
	return asQaArray(items)
		.map(normalizeQaBatch)
		.filter((batch) => batch.id);
};

export const qaDraftAdminPath = (blogId) => {
	const id = qaEntityId(blogId);
	return id ? `/admin/blogs/${encodeURIComponent(id)}` : '';
};

export const persistedQaScore = (value) => {
	if (value === null || value === undefined || value === '') return '--';
	const score = Number(value);
	return Number.isFinite(score) ? String(score) : '--';
};

export const qaAcceptanceStatus = (value) => {
	if (value && typeof value === 'object') {
		return qaAcceptanceStatus(value.status ?? value.verdict ?? value.pass);
	}
	if (value === true) return 'passed';
	if (value === false) return 'failed';
	const normalized = String(value || 'pending')
		.trim()
		.toLowerCase();
	return normalized || 'pending';
};
