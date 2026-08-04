const ACTIVE_REGENERATION_STATUSES = new Set(['queued', 'running', 'researching', 'committing']);
const TERMINAL_REGENERATION_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const REGENERATION_REQUEST_STORAGE_PREFIX = 'inoxpran:roadmap-regeneration:v1:';
const REGENERATION_REQUEST_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const defaultStorage = () => {
	try {
		return globalThis.sessionStorage || null;
	} catch {
		return null;
	}
};

const finiteNumber = (value) => {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
};

export const roadmapActiveEpoch = (payload) => String(payload?.roadmap?.lineage?.activeEpoch || '');

export const roadmapPolicy = (payload) => {
	const source =
		payload?.policy ||
		payload?.roadmap?.policy ||
		(Array.isArray(payload?.items)
			? payload.items.find(
					(item) =>
						Number.isFinite(Number(item?.scores?.acceptanceScore)) &&
						Number.isFinite(Number(item?.scores?.minimumNoveltySubtotal))
				)?.scores
			: null);
	const acceptanceScore = finiteNumber(source?.acceptanceScore);
	const minimumNoveltySubtotal = finiteNumber(source?.minimumNoveltySubtotal);
	return {
		acceptanceScore:
			acceptanceScore !== null && acceptanceScore >= 0 && acceptanceScore <= 100
				? acceptanceScore
				: null,
		minimumNoveltySubtotal:
			minimumNoveltySubtotal !== null && minimumNoveltySubtotal >= 0 && minimumNoveltySubtotal <= 65
				? minimumNoveltySubtotal
				: null
	};
};

export const createRoadmapRegenerationRequestState = ({
	getStorage = defaultStorage,
	now = () => Date.now()
} = {}) => {
	const storageKeyFor = (scheduleId) =>
		`${REGENERATION_REQUEST_STORAGE_PREFIX}${encodeURIComponent(String(scheduleId || ''))}`;

	const read = (scheduleId) => {
		const storage = getStorage();
		if (!storage || !scheduleId) return null;
		try {
			const key = storageKeyFor(scheduleId);
			const parsed = JSON.parse(storage.getItem(key) || 'null');
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
			const updatedAt = Number(parsed.updatedAt) || 0;
			if (!updatedAt || now() - updatedAt > REGENERATION_REQUEST_MAX_AGE_MS) {
				storage.removeItem(key);
				return null;
			}
			return {
				pending: parsed.pending === true,
				uncertain: parsed.uncertain === true,
				regenerationId: String(parsed.regenerationId || '').slice(0, 160),
				updatedAt
			};
		} catch {
			return null;
		}
	};

	const write = (scheduleId, state = {}) => {
		const storage = getStorage();
		if (!storage || !scheduleId) return false;
		try {
			storage.setItem(
				storageKeyFor(scheduleId),
				JSON.stringify({
					pending: state.pending === true,
					uncertain: state.uncertain === true,
					regenerationId: String(state.regenerationId || '').slice(0, 160),
					updatedAt: now()
				})
			);
			return true;
		} catch {
			return false;
		}
	};

	const clear = (scheduleId) => {
		const storage = getStorage();
		if (!storage || !scheduleId) return false;
		try {
			storage.removeItem(storageKeyFor(scheduleId));
			return true;
		} catch {
			return false;
		}
	};

	return { read, write, clear };
};

export const regenerationPhase = (regeneration, roadmap = null) => {
	if (!regeneration || typeof regeneration !== 'object') {
		return { phase: 'idle', active: false, terminal: false, committed: false };
	}
	const status = String(regeneration.status || '').toLowerCase();
	const outcome = String(regeneration.outcome || '').toLowerCase();
	const activeEpoch = String(roadmap?.lineage?.activeEpoch || '');
	const committed =
		outcome === 'replacement_committed' ||
		Boolean(regeneration.targetEpoch && activeEpoch === String(regeneration.targetEpoch));

	if (status === 'queued') return { phase: 'queued', active: true, terminal: false, committed };
	if (status === 'committing') {
		return { phase: 'committing', active: true, terminal: false, committed };
	}
	if (status === 'running' || status === 'researching') {
		return { phase: 'researching', active: true, terminal: false, committed };
	}
	if (status === 'failed') return { phase: 'failed', active: false, terminal: true, committed };
	if (status === 'cancelled' || outcome === 'superseded') {
		return {
			phase: outcome === 'superseded' ? 'superseded' : 'cancelled',
			active: false,
			terminal: true,
			committed
		};
	}
	if (status === 'completed') {
		if (committed) return { phase: 'completed', active: false, terminal: true, committed: true };
		if (outcome === 'no_change') {
			return { phase: 'no_change', active: false, terminal: true, committed: false };
		}
		return { phase: 'completed', active: false, terminal: true, committed };
	}
	return {
		phase: status || 'idle',
		active: ACTIVE_REGENERATION_STATUSES.has(status),
		terminal: TERMINAL_REGENERATION_STATUSES.has(status),
		committed
	};
};

export const shouldReplaceRoadmapItems = (currentPayload, nextPayload) => {
	if (!Array.isArray(nextPayload?.items)) return false;
	if (!currentPayload || !Array.isArray(currentPayload.items)) return true;
	const currentEpoch = roadmapActiveEpoch(currentPayload);
	const nextEpoch = roadmapActiveEpoch(nextPayload);
	if (currentEpoch !== nextEpoch) return true;
	const nextLifecycle = regenerationPhase(nextPayload.regeneration, nextPayload.roadmap);
	if (nextLifecycle.active) return false;
	return true;
};

export const roadmapPollResult = (payload) => {
	const lifecycle = regenerationPhase(payload?.regeneration, payload?.roadmap);
	return {
		payload,
		active: lifecycle.active,
		activeSince:
			payload?.regeneration?.startedAt ||
			payload?.regeneration?.createdAt ||
			payload?.regeneration?.updatedAt ||
			undefined
	};
};

/**
 * An uncertain POST may only be reconciled by a GET when the POST previously
 * returned a concrete regeneration id. A latest-regeneration GET must never
 * attach an unconfirmed request to an older job merely because one exists.
 */
export const matchesTrackedRoadmapRegeneration = (trackedId, regenerationId) => {
	const tracked = String(trackedId || '').trim();
	const candidate = String(regenerationId || '').trim();
	return Boolean(tracked && candidate && tracked === candidate);
};
