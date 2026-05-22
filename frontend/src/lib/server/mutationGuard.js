const createMutationGuard = ({ processedTtlMs = 0, recentTtlMs = 0 } = {}) => {
	const pendingRequests = new Map();
	const processedRequests = new Map();
	const recentRequests = new Map();
	const maxTtlMs = Math.max(0, Number(processedTtlMs) || 0, Number(recentTtlMs) || 0);

	const clearExpired = (store, ttlMs, now) => {
		if (!ttlMs) return;
		for (const [key, value] of store.entries()) {
			if (!value || now - Number(value.timestamp || 0) > ttlMs) {
				store.delete(key);
			}
		}
	};

	const cleanup = (now = Date.now()) => {
		if (!maxTtlMs) return;
		clearExpired(processedRequests, processedTtlMs, now);
		clearExpired(recentRequests, recentTtlMs, now);
	};

	const run = async ({ idempotencyKey = '', recentKey = '', task }) => {
		const now = Date.now();
		cleanup(now);

		if (idempotencyKey && processedTtlMs > 0) {
			const processed = processedRequests.get(idempotencyKey);
			if (processed && now - Number(processed.timestamp || 0) <= processedTtlMs) {
				return processed.result;
			}
		}

		if (recentKey && recentTtlMs > 0) {
			const recent = recentRequests.get(recentKey);
			if (recent && now - Number(recent.timestamp || 0) <= recentTtlMs) {
				return recent.result;
			}
		}

		const pendingKey = idempotencyKey || recentKey || '';
		if (pendingKey) {
			const pending = pendingRequests.get(pendingKey);
			if (pending) return await pending;
		}

		const requestTask = Promise.resolve().then(task);
		if (pendingKey) {
			pendingRequests.set(pendingKey, requestTask);
		}

		try {
			const result = await requestTask;
			const timestamp = Date.now();
			if (idempotencyKey && processedTtlMs > 0) {
				processedRequests.set(idempotencyKey, { timestamp, result });
			}
			if (recentKey && recentTtlMs > 0) {
				recentRequests.set(recentKey, { timestamp, result });
			}
			return result;
		} finally {
			if (pendingKey && pendingRequests.get(pendingKey) === requestTask) {
				pendingRequests.delete(pendingKey);
			}
		}
	};

	return { run };
};

export { createMutationGuard };
