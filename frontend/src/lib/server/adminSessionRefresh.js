import { createHash } from 'node:crypto';

const DEFAULT_REUSE_WINDOW_MS = 2 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 256;

export const fingerprintAdminRefreshSession = ({ userId, refreshToken }) =>
	createHash('sha256')
		.update(String(userId || ''))
		.update('\0')
		.update(String(refreshToken || ''))
		.digest('base64url');

export const shouldRefreshAdminSession = (status) => status === 401;

export const createAdminRefreshCoordinator = ({
	reuseWindowMs = DEFAULT_REUSE_WINDOW_MS,
	maxEntries = DEFAULT_MAX_ENTRIES,
	now = Date.now
} = {}) => {
	const entries = new Map();

	const pruneExpired = (currentTime) => {
		for (const [key, entry] of entries) {
			if (entry.settled && entry.expiresAt <= currentTime) entries.delete(key);
		}
	};

	const removeOldestSettled = () => {
		for (const [key, entry] of entries) {
			if (!entry.settled) continue;
			entries.delete(key);
			return true;
		}
		return false;
	};

	const run = ({ userId, refreshToken, refresh }) => {
		const currentTime = now();
		pruneExpired(currentTime);

		const key = fingerprintAdminRefreshSession({ userId, refreshToken });
		const existing = entries.get(key);
		if (existing) return existing.promise;

		while (entries.size >= maxEntries && removeOldestSettled()) {
			// Keep the cache bounded without interrupting active refresh requests.
		}

		if (entries.size >= maxEntries) return Promise.resolve().then(refresh);

		const entry = {
			settled: false,
			expiresAt: Number.POSITIVE_INFINITY,
			promise: null
		};

		entry.promise = Promise.resolve()
			.then(refresh)
			.then(
				(result) => {
					if (!result) {
						entries.delete(key);
						return result;
					}
					entry.settled = true;
					entry.expiresAt = now() + reuseWindowMs;
					return result;
				},
				(error) => {
					entries.delete(key);
					throw error;
				}
			);

		entries.set(key, entry);
		return entry.promise;
	};

	return { run };
};

const adminRefreshCoordinator = createAdminRefreshCoordinator();

export const coordinateAdminRefresh = (input) => adminRefreshCoordinator.run(input);
