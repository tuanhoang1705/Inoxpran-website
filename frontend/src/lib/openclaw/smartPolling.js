export const SMART_POLL_BACKOFF_MS = Object.freeze([
	3000, 6000, 12000, 30000, 60000, 120000, 300000
]);
export const SMART_POLL_ACTIVE_MS = 3000;
export const SMART_POLL_IDLE_MS = 30000;
export const SMART_POLL_MAX_BACKOFF_MS = 5 * 60 * 1000;
export const SMART_POLL_JITTER_RATIO = 0.2;
export const SMART_POLL_LONG_RUNNING_MS = 90 * 60 * 1000;

const noop = () => {};

const defaultEnvironment = () => ({
	now: () => Date.now(),
	setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
	clearTimeout: (timer) => globalThis.clearTimeout(timer),
	random: () => Math.random(),
	isOnline: () => globalThis.navigator?.onLine !== false,
	isVisible: () => globalThis.document?.visibilityState !== 'hidden',
	windowTarget: globalThis.window || null,
	documentTarget: globalThis.document || null,
	createAbortController: () =>
		typeof globalThis.AbortController === 'function' ? new globalThis.AbortController() : null
});

const isAbortError = (error) =>
	error?.name === 'AbortError' ||
	String(error?.message || '')
		.toLowerCase()
		.includes('aborted');

const timestampFrom = (value) => {
	if (value === null || value === undefined || value === '') return null;
	const numeric = Number(value);
	if (Number.isFinite(numeric) && numeric > 0) return numeric;
	const parsed = new Date(value).getTime();
	return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Runs one asynchronous poll at a time. The next timeout is scheduled only after
 * the current request and its callbacks settle, preventing overlapping refreshes.
 */
export const createSmartPoller = ({
	poll,
	isActive = (result) => Boolean(result?.active),
	onResult = noop,
	onSettled = noop,
	onSyncError = noop,
	activeIntervalMs = SMART_POLL_ACTIVE_MS,
	idleIntervalMs = SMART_POLL_IDLE_MS,
	longRunningAfterMs = SMART_POLL_LONG_RUNNING_MS,
	longRunningIntervalMs = SMART_POLL_IDLE_MS,
	backoffMs = SMART_POLL_BACKOFF_MS,
	jitterRatio = SMART_POLL_JITTER_RATIO,
	maximumDelayMs = SMART_POLL_MAX_BACKOFF_MS,
	environment = {}
} = {}) => {
	if (typeof poll !== 'function') throw new TypeError('createSmartPoller requires a poll function');

	const env = { ...defaultEnvironment(), ...environment };
	let timer = null;
	let controller = null;
	let started = false;
	let inFlight = false;
	let pendingReason = '';
	let failureCount = 0;
	let active = false;
	let activeSince = null;
	let slow = false;
	let listenersAttached = false;

	const clearTimer = () => {
		if (timer !== null) env.clearTimeout(timer);
		timer = null;
	};

	const canPoll = () => env.isOnline() && env.isVisible();

	const jitteredDelay = (delay) => {
		const base = Math.max(0, Number(delay) || 0);
		if (!base) return 0;
		const ratio = Math.min(0.5, Math.max(0, Number(jitterRatio) || 0));
		const random = Math.min(1, Math.max(0, Number(env.random?.()) || 0));
		const factor = 1 + (random * 2 - 1) * ratio;
		return Math.min(
			Math.max(1, Number(maximumDelayMs) || SMART_POLL_MAX_BACKOFF_MS),
			Math.round(base * factor)
		);
	};

	const schedule = (delay, reason = 'timer') => {
		if (!started) return;
		clearTimer();
		timer = env.setTimeout(() => {
			timer = null;
			void tick(reason);
		}, jitteredDelay(delay));
	};

	const poke = (reason = 'manual') => {
		if (!started || !canPoll()) return;
		clearTimer();
		if (inFlight) {
			pendingReason = reason;
			return;
		}
		schedule(0, reason);
	};

	const handleResume = () => {
		if (canPoll()) poke('resume');
		else clearTimer();
	};

	const attachListeners = () => {
		if (listenersAttached) return;
		env.windowTarget?.addEventListener?.('online', handleResume);
		env.windowTarget?.addEventListener?.('offline', handleResume);
		env.windowTarget?.addEventListener?.('focus', handleResume);
		env.documentTarget?.addEventListener?.('visibilitychange', handleResume);
		listenersAttached = true;
	};

	const detachListeners = () => {
		if (!listenersAttached) return;
		env.windowTarget?.removeEventListener?.('online', handleResume);
		env.windowTarget?.removeEventListener?.('offline', handleResume);
		env.windowTarget?.removeEventListener?.('focus', handleResume);
		env.documentTarget?.removeEventListener?.('visibilitychange', handleResume);
		listenersAttached = false;
	};

	async function tick(reason = 'timer') {
		if (!started || inFlight) return;
		if (!canPoll()) {
			clearTimer();
			return;
		}

		inFlight = true;
		controller = env.createAbortController?.() || null;
		let nextDelay = idleIntervalMs;

		try {
			const result = await poll({ signal: controller?.signal, reason });
			if (!started) return;

			failureCount = 0;
			const wasActive = active;
			const nextActive = Boolean(isActive(result));
			if (nextActive && !wasActive) activeSince = timestampFrom(result?.activeSince) || env.now();
			if (!nextActive) activeSince = null;
			active = nextActive;
			slow = Boolean(
				active && activeSince !== null && env.now() - activeSince >= longRunningAfterMs
			);

			const meta = {
				reason,
				active,
				wasActive,
				settled: wasActive && !active,
				slow,
				activeSince,
				failureCount
			};
			await onResult(result, meta);
			if (meta.settled) await onSettled(result, meta);

			nextDelay = active ? (slow ? longRunningIntervalMs : activeIntervalMs) : idleIntervalMs;
		} catch (error) {
			if (!started || isAbortError(error)) return;
			failureCount += 1;
			const index = Math.min(failureCount - 1, backoffMs.length - 1);
			nextDelay = Number(backoffMs[index]) || idleIntervalMs;
			try {
				await onSyncError(error, { reason, active, slow, failureCount, nextDelay });
			} catch {
				// Polling remains authoritative even if a presentation callback fails.
			}
		} finally {
			controller = null;
			inFlight = false;
			if (started) {
				if (pendingReason && canPoll()) {
					const queuedReason = pendingReason;
					pendingReason = '';
					schedule(0, queuedReason);
				} else if (canPoll()) {
					schedule(nextDelay, 'timer');
				}
			}
		}
	}

	const start = ({ immediate = true } = {}) => {
		if (started) return;
		started = true;
		attachListeners();
		if (immediate && canPoll()) schedule(0, 'start');
		else if (canPoll()) schedule(idleIntervalMs, 'timer');
	};

	const stop = () => {
		started = false;
		pendingReason = '';
		clearTimer();
		controller?.abort?.();
		controller = null;
		detachListeners();
	};

	return {
		start,
		stop,
		poke,
		getState: () => ({ started, inFlight, active, activeSince, slow, failureCount })
	};
};

/** Executes a mapper with a hard concurrency ceiling while preserving order. */
export const mapWithConcurrency = async (items, limit, mapper) => {
	const source = Array.from(items || []);
	if (!source.length) return [];
	const output = new Array(source.length);
	let cursor = 0;
	const workerCount = Math.max(1, Math.min(Number(limit) || 1, source.length));
	const workers = Array.from({ length: workerCount }, async () => {
		while (cursor < source.length) {
			const index = cursor;
			cursor += 1;
			output[index] = await mapper(source[index], index);
		}
	});
	await Promise.all(workers);
	return output;
};
