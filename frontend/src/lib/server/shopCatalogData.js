import { API_BASE_CANDIDATES, PUBLIC_API_KEY_HEADER, readServerEnvValue } from '$lib/server/api.js';
import { createAsyncTtlCache } from '$lib/server/asyncTtlCache.js';
import { readSharedValue, writeSharedValue } from '$lib/server/sharedCache.js';

// The shop needs the whole catalogue to count facets, so this is the second place -
// after the homepage feed - where a visitor could end up waiting on the database
// because a cache had just expired. It gets the same treatment: refreshed on a
// schedule in the background, and backed by a snapshot in Redis so a restart or an
// extra replica starts warm instead of making the first arrival pay for it.

const numberFromEnv = (name, fallback, { min, max }) => {
	const parsed = Number(readServerEnvValue(name));
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(max, Math.max(min, Math.trunc(parsed)));
};

const CATALOG_TTL_MS = numberFromEnv('SHOP_CATALOG_TTL_MS', 60_000, {
	min: 5_000,
	max: 3_600_000
});
const CATALOG_REFRESH_INTERVAL_MS = numberFromEnv('SHOP_CATALOG_REFRESH_INTERVAL_MS', 45_000, {
	min: 10_000,
	max: 3_600_000
});
const CATALOG_SNAPSHOT_TTL_SECONDS = numberFromEnv('SHOP_CATALOG_SNAPSHOT_TTL_SECONDS', 604_800, {
	min: 60,
	max: 2_592_000
});
const SNAPSHOT_READ_BUDGET_MS = numberFromEnv('SHOP_CATALOG_SNAPSHOT_READ_BUDGET_MS', 400, {
	min: 50,
	max: 5_000
});

const CATALOG_SNAPSHOT_KEY = 'shop-catalog:snapshot:v1';
const DEFAULT_PAGE_SIZE = 200;
const DEFAULT_MAX_PAGES = 50;

const catalogSnapshotCache = createAsyncTtlCache({ ttlMs: CATALOG_TTL_MS, maxEntries: 4 });

let lastCatalogSnapshot = null;
let warmLoopTimer = null;
let refreshInFlight = null;

const cacheKeyFor = (pageSize, maxPages) => `catalog:v3:${pageSize}:${maxPages}`;

const buildDefaultHeaders = () =>
	PUBLIC_API_KEY_HEADER ? { 'x-api-key': PUBLIC_API_KEY_HEADER } : {};

const readJson = async (response) => {
	try {
		return await response.json();
	} catch {
		return null;
	}
};

const toProducts = (payload) => (Array.isArray(payload?.metadata) ? payload.metadata : []);

const dedupeProductsById = (products) => {
	const result = [];
	const seen = new Set();

	for (const product of Array.isArray(products) ? products : []) {
		const id = String(product?._id || '');
		if (!id) {
			result.push(product);
			continue;
		}
		if (seen.has(id)) continue;
		seen.add(id);
		result.push(product);
	}

	return result;
};

const buildCatalogPageUrl = ({ base, page, limit }) => {
	const apiUrl = new URL(`${base}/product`);
	apiUrl.searchParams.set('limit', String(limit));
	apiUrl.searchParams.set('page', String(page));
	return apiUrl;
};

const isUsableSnapshot = (snapshot) =>
	Boolean(snapshot) && Array.isArray(snapshot.products) && snapshot.products.length > 0;

const rememberCatalogSnapshot = async (snapshot) => {
	const stored = { products: snapshot.products, savedAt: Date.now() };
	lastCatalogSnapshot = { ...snapshot, savedAt: stored.savedAt };
	await writeSharedValue(CATALOG_SNAPSHOT_KEY, stored, {
		ttlSeconds: CATALOG_SNAPSHOT_TTL_SECONDS
	});
};

/**
 * The last good catalogue, from this process if it has one and from Redis otherwise.
 */
export const readCatalogSnapshot = async ({ budgetMs = SNAPSHOT_READ_BUDGET_MS } = {}) => {
	if (isUsableSnapshot(lastCatalogSnapshot)) return lastCatalogSnapshot;
	const shared = await readSharedValue(CATALOG_SNAPSHOT_KEY, { timeoutMs: budgetMs });
	if (!isUsableSnapshot(shared)) return null;
	lastCatalogSnapshot = {
		products: shared.products,
		hadNetworkFailure: false,
		errorStatus: null,
		truncated: false,
		savedAt: Number(shared.savedAt) || 0
	};
	return lastCatalogSnapshot;
};

const fetchCatalogUncached = async ({ fetch, headers, pageSize, maxPages }) => {
	let hadNetworkFailure = false;
	let errorStatus = null;

	for (const base of API_BASE_CANDIDATES) {
		const collected = [];
		let baseWorked = false;
		let baseFailed = false;

		for (let page = 1; page <= maxPages; page += 1) {
			try {
				const response = await fetch(buildCatalogPageUrl({ base, page, limit: pageSize }), {
					headers
				});
				if (!response.ok) {
					if (errorStatus === null) errorStatus = response.status;
					baseFailed = true;
					break;
				}

				baseWorked = true;
				const payload = await readJson(response);
				const batch = toProducts(payload);
				collected.push(...batch);

				if (batch.length < pageSize) {
					return {
						products: dedupeProductsById(collected),
						hadNetworkFailure,
						errorStatus,
						truncated: false
					};
				}
			} catch {
				hadNetworkFailure = true;
				baseFailed = true;
				break;
			}
		}

		if (baseWorked && !baseFailed) {
			return {
				products: dedupeProductsById(collected),
				hadNetworkFailure,
				errorStatus,
				truncated: true
			};
		}
	}

	return { products: [], hadNetworkFailure, errorStatus, truncated: false };
};

/**
 * Refreshes the catalogue and seeds the read cache, deduplicating concurrent callers.
 * Bypasses the TTL for the same reason the home feed refresh does: a loop that went
 * through getOrLoad would be handed the cached value and refresh nothing.
 */
export const refreshCatalogSnapshot = async ({
	fetch = globalThis.fetch,
	headers = buildDefaultHeaders(),
	pageSize = DEFAULT_PAGE_SIZE,
	maxPages = DEFAULT_MAX_PAGES
} = {}) => {
	if (refreshInFlight) return await refreshInFlight;
	refreshInFlight = (async () => {
		try {
			const next = await fetchCatalogUncached({ fetch, headers, pageSize, maxPages });
			if (isUsableSnapshot(next)) {
				catalogSnapshotCache.set(cacheKeyFor(pageSize, maxPages), next);
				await rememberCatalogSnapshot(next);
			}
			return next;
		} finally {
			refreshInFlight = null;
		}
	})();
	return await refreshInFlight;
};

export const fetchAllCatalogProducts = async ({
	fetch,
	headers = buildDefaultHeaders(),
	pageSize = DEFAULT_PAGE_SIZE,
	maxPages = DEFAULT_MAX_PAGES
} = {}) => {
	const key = cacheKeyFor(pageSize, maxPages);
	try {
		const result = await catalogSnapshotCache.getOrLoad(key, async () => {
			const next = await refreshCatalogSnapshot({ fetch, headers, pageSize, maxPages });
			if (!isUsableSnapshot(next)) {
				// Never cache a transient failure - the caller has its own fallback and the
				// next request should be allowed to try again.
				throw Object.assign(new Error('catalog snapshot unavailable'), { snapshot: next });
			}
			return next;
		});
		if (isUsableSnapshot(result)) return result;
		const snapshot = await readCatalogSnapshot();
		if (snapshot) return snapshot;
		throw Object.assign(new Error('catalog snapshot unavailable'), { snapshot: result });
	} catch (error) {
		// An empty catalogue is a worse answer than a slightly old one: the shop would
		// render zero facets and an empty grid over a database that is merely slow.
		const snapshot = await readCatalogSnapshot();
		if (snapshot) return { ...snapshot, stale: true };
		throw error;
	}
};

/**
 * Keeps the catalogue warm from the background, so the shop page never pays for a
 * cold snapshot on a visitor's request.
 */
export const startCatalogWarmLoop = ({
	intervalMs = CATALOG_REFRESH_INTERVAL_MS,
	fetchImpl = globalThis.fetch
} = {}) => {
	if (warmLoopTimer) return () => stopCatalogWarmLoop();

	let running = false;
	const tick = async () => {
		if (running) return;
		running = true;
		try {
			await refreshCatalogSnapshot({ fetch: fetchImpl });
		} catch {
			// A warm-up must never keep the server from serving.
		} finally {
			running = false;
		}
	};

	void tick();
	warmLoopTimer = setInterval(() => void tick(), intervalMs);
	warmLoopTimer.unref?.();
	return () => stopCatalogWarmLoop();
};

export const stopCatalogWarmLoop = () => {
	if (!warmLoopTimer) return;
	clearInterval(warmLoopTimer);
	warmLoopTimer = null;
};
