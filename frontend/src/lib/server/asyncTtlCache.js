const defaultNow = () => Date.now();

export const createAsyncTtlCache = ({
	ttlMs = 60_000,
	maxEntries = 128,
	now = defaultNow
} = {}) => {
	const store = new Map();

	const cleanupExpired = (time) => {
		for (const [key, entry] of store.entries()) {
			if (!entry) {
				store.delete(key);
				continue;
			}
			const expiresAt = Number(entry.expiresAt || 0);
			if (expiresAt > 0 && expiresAt <= time && !entry.pending) {
				store.delete(key);
			}
		}
	};

	const evictIfNeeded = () => {
		if (store.size <= maxEntries) return;
		let oldestKey = null;
		let oldestAccess = Number.POSITIVE_INFINITY;
		for (const [key, entry] of store.entries()) {
			const lastAccess = Number(entry?.lastAccessAt || 0);
			if (lastAccess < oldestAccess) {
				oldestAccess = lastAccess;
				oldestKey = key;
			}
		}
		if (oldestKey !== null) {
			store.delete(oldestKey);
		}
	};

	const getOrLoad = async (key, loader) => {
		const cacheKey = String(key || '');
		const time = now();
		cleanupExpired(time);

		const existing = store.get(cacheKey);
		if (existing?.value !== undefined && Number(existing.expiresAt || 0) > time) {
			existing.lastAccessAt = time;
			return existing.value;
		}

		if (existing?.pending) {
			existing.lastAccessAt = time;
			return await existing.pending;
		}

		const entry = existing || { value: undefined, expiresAt: 0, lastAccessAt: time, pending: null };
		const pending = Promise.resolve().then(loader);
		entry.pending = pending;
		entry.lastAccessAt = time;
		store.set(cacheKey, entry);
		evictIfNeeded();

		try {
			const value = await pending;
			const settledAt = now();
			entry.value = value;
			entry.expiresAt = settledAt + Math.max(0, Number(ttlMs) || 0);
			entry.lastAccessAt = settledAt;
			return value;
		} catch (error) {
			if (entry.value === undefined) {
				store.delete(cacheKey);
			}
			throw error;
		} finally {
			if (store.get(cacheKey) === entry) {
				entry.pending = null;
			}
		}
	};

	const peek = (key) => {
		const cacheKey = String(key || '');
		const time = now();
		const entry = store.get(cacheKey);
		if (!entry) return undefined;
		if (entry.value === undefined) return undefined;
		if (Number(entry.expiresAt || 0) <= time) return undefined;
		entry.lastAccessAt = time;
		return entry.value;
	};

	const clear = () => {
		store.clear();
	};

	return {
		getOrLoad,
		peek,
		clear
	};
};
