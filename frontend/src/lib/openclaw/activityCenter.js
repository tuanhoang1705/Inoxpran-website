import { writable } from 'svelte/store';

export const OPENCLAW_ACTIVITY_STORAGE_KEY = 'inoxpran:openclaw-activities:v1';
export const OPENCLAW_ACTIVITY_LIMIT = 50;
export const OPENCLAW_ACTIVITY_STATES = Object.freeze({
	RUNNING: 'running',
	SUCCEEDED: 'succeeded',
	FAILED: 'failed'
});

const VALID_STATES = new Set(Object.values(OPENCLAW_ACTIVITY_STATES));
const DEFAULT_ACTIVE = new Set([
	'queued',
	'running',
	'committing',
	'retry_wait',
	'reserved',
	'researching',
	'drafting',
	'reviewing',
	'remediating',
	'in_progress',
	'generating'
]);
const DEFAULT_FAILED = new Set(['failed', 'blocked', 'timed_out', 'partial']);

const cleanText = (value, max = 300) =>
	String(value || '')
		.trim()
		.slice(0, max);

const defaultGetStorage = () => {
	try {
		return globalThis.sessionStorage || null;
	} catch {
		return null;
	}
};

export const openClawActivityStatus = (
	rawStatus,
	{ activeStatuses = DEFAULT_ACTIVE, failedStatuses = DEFAULT_FAILED } = {}
) => {
	const status = cleanText(rawStatus, 80).toLowerCase();
	if (VALID_STATES.has(status)) return status;
	if (activeStatuses.has(status)) return OPENCLAW_ACTIVITY_STATES.RUNNING;
	if (failedStatuses.has(status)) return OPENCLAW_ACTIVITY_STATES.FAILED;
	return OPENCLAW_ACTIVITY_STATES.SUCCEEDED;
};

export const openClawActivityKey = ({ domain, entityId, runId, action, nonce } = {}) =>
	[domain, entityId, runId, action, nonce]
		.map((value) => cleanText(value, 160))
		.filter(Boolean)
		.join(':')
		.slice(0, 480);

const normalizePersisted = (item) => {
	if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
	const key = cleanText(item.key, 480);
	if (!key) return null;
	const status = VALID_STATES.has(item.status) ? item.status : openClawActivityStatus(item.status);
	return {
		key,
		domain: cleanText(item.domain, 80),
		entityId: cleanText(item.entityId, 160),
		runId: cleanText(item.runId, 160),
		action: cleanText(item.action, 120),
		title: cleanText(item.title, 240) || 'OpenClaw',
		message: cleanText(item.message, 500),
		status,
		rawStatus: cleanText(item.rawStatus, 80),
		createdAt: Number(item.createdAt) || Date.now(),
		updatedAt: Number(item.updatedAt) || Number(item.createdAt) || Date.now(),
		completedAt: Number(item.completedAt) || null,
		unread: item.unread === true
	};
};

export const createOpenClawActivityStore = ({
	getStorage = defaultGetStorage,
	now = () => Date.now(),
	limit = OPENCLAW_ACTIVITY_LIMIT
} = {}) => {
	const { subscribe, set } = writable([]);
	let items = [];
	let hydrated = false;

	const publish = () => {
		items = [...items]
			.sort((left, right) => right.updatedAt - left.updatedAt)
			.slice(0, Math.max(1, Number(limit) || OPENCLAW_ACTIVITY_LIMIT));
		set(items);
		const storage = getStorage();
		if (!storage) return;
		try {
			storage.setItem(OPENCLAW_ACTIVITY_STORAGE_KEY, JSON.stringify(items));
		} catch {
			// The in-memory store remains usable when sessionStorage is unavailable.
		}
	};

	const hydrate = () => {
		if (hydrated) return items;
		hydrated = true;
		const storage = getStorage();
		if (!storage) return items;
		try {
			const parsed = JSON.parse(storage.getItem(OPENCLAW_ACTIVITY_STORAGE_KEY) || '[]');
			if (Array.isArray(parsed)) {
				const persisted = parsed.map(normalizePersisted).filter(Boolean);
				const currentByKey = new Map(items.map((item) => [item.key, item]));
				items = persisted.map((item) => currentByKey.get(item.key) || item);
				for (const item of currentByKey.values()) {
					if (!items.some((candidate) => candidate.key === item.key)) items.push(item);
				}
				publish();
			}
		} catch {
			// Ignore corrupt or blocked session storage and start with the in-memory state.
		}
		return items;
	};

	const upsert = (activity = {}) => {
		const timestamp = now();
		const key =
			cleanText(activity.key, 480) ||
			openClawActivityKey({
				domain: activity.domain,
				entityId: activity.entityId,
				runId: activity.runId,
				action: activity.action,
				nonce: activity.nonce
			});
		if (!key) throw new Error('OpenClaw activity requires a stable key');

		const index = items.findIndex((item) => item.key === key);
		const previous = index >= 0 ? items[index] : null;
		const status = openClawActivityStatus(activity.status || previous?.status || 'running');
		const transitioned =
			previous?.status === OPENCLAW_ACTIVITY_STATES.RUNNING &&
			status !== OPENCLAW_ACTIVITY_STATES.RUNNING;
		const next = {
			key,
			domain: cleanText(activity.domain ?? previous?.domain, 80),
			entityId: cleanText(activity.entityId ?? previous?.entityId, 160),
			runId: cleanText(activity.runId ?? previous?.runId, 160),
			action: cleanText(activity.action ?? previous?.action, 120),
			title: cleanText(activity.title ?? previous?.title, 240) || 'OpenClaw',
			message: cleanText(activity.message ?? previous?.message, 500),
			status,
			rawStatus: cleanText(activity.rawStatus ?? previous?.rawStatus, 80),
			createdAt: previous?.createdAt || timestamp,
			updatedAt: timestamp,
			completedAt:
				status === OPENCLAW_ACTIVITY_STATES.RUNNING ? null : previous?.completedAt || timestamp,
			unread: activity.unread ?? (transitioned ? true : previous?.unread === true)
		};

		if (index >= 0) items[index] = next;
		else items.push(next);
		publish();
		return next;
	};

	const find = (predicate) => items.find(predicate) || null;

	const updateWhere = (predicate, patch) => {
		const matches = items.filter(predicate);
		return matches.map((item) =>
			upsert({
				...patch,
				key: item.key,
				domain: item.domain,
				entityId: item.entityId,
				runId: item.runId
			})
		);
	};

	const markRead = (key) => {
		const item = items.find((candidate) => candidate.key === key);
		if (!item || !item.unread) return false;
		item.unread = false;
		publish();
		return true;
	};

	const clearCompleted = () => {
		items = items.filter((item) => item.status === OPENCLAW_ACTIVITY_STATES.RUNNING);
		publish();
	};

	return {
		subscribe,
		hydrate,
		upsert,
		find,
		updateWhere,
		markRead,
		clearCompleted,
		getItems: () => [...items]
	};
};

export const openClawActivityStore = createOpenClawActivityStore();
