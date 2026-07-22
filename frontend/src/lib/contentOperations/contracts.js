export const CONTENT_ACTIONS = Object.freeze([
	'new',
	'update',
	'expand',
	'merge',
	'metadata_refresh',
	'internal_link_maintenance',
	'content_maintenance',
	'skip'
]);

export const CONTENT_OPERATION_VIEWS = Object.freeze([
	'today',
	'opportunities',
	'workOrders',
	'signals',
	'inventory',
	'monitoring',
	'schedule'
]);

export const CONTENT_SCHEDULE_MODES = Object.freeze([
	'best_action',
	'fixed_brief',
	'maintenance_only'
]);

export const CONTENT_SOURCE_KEYS = Object.freeze([
	'google_intelligence',
	'google_search_console',
	'first_party_aggregate_analytics',
	'trends',
	'content_inventory',
	'product_catalog',
	'content_signals'
]);

const SAFE_TOKEN = /^[A-Za-z0-9_-]{1,128}$/;

export const asArray = (value) => (Array.isArray(value) ? value : []);

export const firstList = (payload, keys = []) => {
	if (Array.isArray(payload)) return payload;
	for (const key of keys) {
		if (Array.isArray(payload?.[key])) return payload[key];
	}
	return [];
};

export const entityId = (value) => {
	const candidate =
		value && typeof value === 'object' ? (value.id ?? value._id ?? '') : (value ?? '');
	return String(candidate).trim().slice(0, 128);
};

export const isSafeEntityId = (value) => SAFE_TOKEN.test(entityId(value));

export const clampScore = (value) => {
	const score = Number(value);
	if (!Number.isFinite(score)) return null;
	const normalized = score > 1 && score <= 100 ? score / 100 : score;
	return Math.min(1, Math.max(0, normalized));
};

export const scorePercent = (value) => {
	const score = clampScore(value);
	return score === null ? null : Math.round(score * 100);
};

export const actionTranslationKey = (value) => {
	const action = CONTENT_ACTIONS.includes(value) ? value : 'skip';
	return `admin.contentOperations.actions.${action}`;
};

export const viewTranslationKey = (value) => {
	const view = CONTENT_OPERATION_VIEWS.includes(value) ? value : 'today';
	return `admin.contentOperations.views.${view}`;
};

export const scheduleModeTranslationKey = (value) => {
	const mode = CONTENT_SCHEDULE_MODES.includes(value) ? value : 'fixed_brief';
	return `admin.contentOperations.schedule.modes.${mode}`;
};

export const statusTranslationKey = (value) => {
	const normalized = String(value || 'unknown')
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '');
	return `admin.contentOperations.status.${normalized || 'unknown'}`;
};

export const statusTone = (value) => {
	const status = String(value || '').toLowerCase();
	if (
		[
			'available',
			'fresh',
			'enabled',
			'active',
			'stable',
			'verified',
			'complete',
			'completed',
			'current',
			'ready',
			'accepted',
			'approved',
			'converted',
			'passed',
			'published',
			'resolved',
			'healthy'
		].includes(status)
	) {
		return 'good';
	}
	if (['failed', 'blocked', 'critical', 'rejected', 'error'].includes(status)) return 'danger';
	if (
		[
			'partial',
			'degraded',
			'not_configured',
			'warning',
			'needs_review',
			'draft',
			'paused',
			'unavailable'
		].includes(status)
	) {
		return 'warn';
	}
	return 'muted';
};

export const sourceState = (source) => {
	if (!source || typeof source !== 'object') return 'unknown';
	if (source.enabled === false) return 'disabled';
	if (source.configured === false) return 'not_configured';
	const status = String(source.status || '').trim().toLowerCase();
	if (status === 'available') return 'ready';
	if (status === 'partial') return 'degraded';
	if (status === 'failed') return 'failed';
	if (status === 'unavailable') return 'unavailable';
	return status || 'unknown';
};

export const hasProductPlanningContext = ({ mode, topic, action, workOrderId } = {}) => {
	if ((mode || 'fixed_brief') === 'fixed_brief') return Boolean(String(topic || '').trim());
	return Boolean(
		String(topic || '').trim() &&
		CONTENT_ACTIONS.includes(action) &&
		action !== 'skip' &&
		entityId(workOrderId)
	);
};

/**
 * @typedef {Object} ContentOperationsPreview
 * @property {string=} snapshotId
 * @property {string=} decisionId
 * @property {string=} workOrderId
 * @property {string=} topic
 * @property {string=} action
 * @property {number=} opportunityScore
 * @property {Array<Object>=} candidates
 * @property {Array<string>=} warnings
 * @property {boolean=} dryRun
 */

/** @returns {ContentOperationsPreview} */
export const normalizePreview = (payload = {}) => {
	const selected = payload.selectedOpportunity || payload.selected || payload.contentAction || {};
	const workOrder = payload.workOrder || payload.selectedWorkOrder || {};
	return {
		...payload,
		snapshotId: entityId(payload.snapshotId || payload.contentOperationsSnapshotId),
		decisionId: entityId(
			payload.decisionId || payload.contentOpportunityDecisionId || selected.id || selected._id
		),
		workOrderId: entityId(payload.workOrderId || payload.contentWorkOrderId || workOrder),
		topic: String(payload.topic || selected.topic || workOrder.topic || '').trim(),
		action: String(
			payload.action ||
				payload.decision ||
				selected.recommendedAction ||
				selected.decisionType ||
				selected.action ||
				selected.decision ||
				'skip'
		),
		opportunityScore:
			payload.opportunityScore ?? selected.totalScore ?? selected.opportunityScore ?? null,
		candidates: firstList(payload, ['candidates', 'opportunities']),
		warnings: asArray(payload.warnings),
		dryRun: payload.dryRun !== false
	};
};

const RUNNABLE_WORK_ORDER_STATUSES = new Set(['planned', 'approved', 'brief_ready']);

export const decisionArtifactContext = (decision = {}, activeWorkOrder = null) => {
	const normalized = decision && typeof decision === 'object' ? decision : {};
	const decisionId = entityId(normalized.decisionId || normalized.contentOpportunityDecisionId);
	const workOrderId = entityId(
		normalized.workOrderId || normalized.contentWorkOrderId || normalized.workOrder
	);
	const persisted = normalized.dryRun === false;
	const embeddedWorkOrder =
		normalized.workOrder && typeof normalized.workOrder === 'object' ? normalized.workOrder : null;
	const matchingWorkOrder = [activeWorkOrder, embeddedWorkOrder].find(
		(item) => item && entityId(item) === workOrderId
	);
	const workOrderStatus = String(
		matchingWorkOrder?.status || normalized.workOrderStatus || ''
	).toLowerCase();
	const workOrderStatusAllowsRun =
		!workOrderStatus || RUNNABLE_WORK_ORDER_STATUSES.has(workOrderStatus);

	return {
		decisionId,
		workOrderId,
		persisted,
		runnable:
			persisted &&
			Boolean(decisionId) &&
			Boolean(workOrderId) &&
			workOrderStatusAllowsRun &&
			String(normalized.action || '').toLowerCase() !== 'skip'
	};
};
