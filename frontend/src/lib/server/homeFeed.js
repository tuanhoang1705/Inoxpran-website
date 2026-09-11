import { API_BASE, PUBLIC_API_KEY_HEADER, readServerEnvValue } from '$lib/server/api.js';
import { createAsyncTtlCache } from '$lib/server/asyncTtlCache.js';
import { readSharedValue, writeSharedValue } from '$lib/server/sharedCache.js';
import {
	extractBestSellingItems,
	extractLatestBlogItems,
	isCompleteHomeFeed,
	mergeHomeFeedSources,
	resolveHomeFeedForRender as resolveRender,
	HOME_FEED_CACHE_CONTROL,
	STALE_HOME_FEED_CACHE_CONTROL
} from '$lib/server/homeFeedContract.js';

const numberFromEnv = (name, fallback, { min, max }) => {
	const parsed = Number(readServerEnvValue(name));
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(max, Math.max(min, Math.trunc(parsed)));
};

const HOME_FEED_TTL_MS = numberFromEnv('HOME_FEED_TTL_MS', 60_000, {
	min: 5_000,
	max: 3_600_000
});

// This timeout no longer sits on a visitor's request. The warm loop below refreshes
// the feed in the background, so the only thing a short timeout here buys is a failed
// refresh; what it costs is the snapshot going stale. The old 1200ms value was set
// when the upstream answered in tens of milliseconds and silently became a guaranteed
// failure once list responses grew - every refresh aborted, so the snapshot froze at
// whatever the process happened to load at boot.
const HOME_FEED_API_TIMEOUT_MS = numberFromEnv('HOME_FEED_API_TIMEOUT_MS', 20_000, {
	min: 1_000,
	max: 120_000
});

const HOME_FEED_REFRESH_INTERVAL_MS = numberFromEnv('HOME_FEED_REFRESH_INTERVAL_MS', 45_000, {
	min: 10_000,
	max: 3_600_000
});

// How long a shared snapshot stays usable. Long, on purpose: a week-old product rail
// is a far better homepage than an error, and the refresh loop overwrites it every
// 45 seconds in normal operation, so a snapshot only ever gets old when the upstream
// has been unreachable for that long - exactly when the fallback has to hold.
const HOME_FEED_SNAPSHOT_TTL_SECONDS = numberFromEnv('HOME_FEED_SNAPSHOT_TTL_SECONDS', 604_800, {
	min: 60,
	max: 2_592_000
});

// A render may wait this long for Redis before giving up and using process memory.
const SNAPSHOT_READ_BUDGET_MS = numberFromEnv('HOME_FEED_SNAPSHOT_READ_BUDGET_MS', 400, {
	min: 50,
	max: 5_000
});

const HOME_FEED_CACHE_KEY = 'home-feed:v4';
const HOME_FEED_SNAPSHOT_KEY = 'home-feed:snapshot:v4';
const MAX_PRODUCT_DESCRIPTION_CHARS = 420;
const MAX_BLOG_EXCERPT_CHARS = 220;
const BEST_SELLING_LIMIT = 6;
const LATEST_BLOG_FETCH_LIMIT = 8;
const LATEST_BLOG_RENDER_LIMIT = 4;

const homeFeedCache = createAsyncTtlCache({ ttlMs: HOME_FEED_TTL_MS, maxEntries: 8 });

// Process-local mirror of the shared snapshot. It exists to keep the common render
// off the network entirely; Redis is what makes the snapshot survive a restart and
// what lets a second replica start warm.
let lastHomeFeedSnapshot = null;
let warmLoopTimer = null;
let refreshInFlight = null;

const buildHeaders = () => {
	const headers = {};
	if (PUBLIC_API_KEY_HEADER) {
		headers['x-api-key'] = PUBLIC_API_KEY_HEADER;
	}
	return headers;
};

const sortByLatestPublishedPast = (posts = []) => {
	const now = Date.now();
	const parsePublishedTime = (item) => {
		const primary = item?.date || item?.publishedAt || item?.createdAt;
		const time = new Date(primary).getTime();
		return Number.isFinite(time) ? time : null;
	};

	return posts
		.map((item) => ({ item, publishedTime: parsePublishedTime(item) }))
		.filter(({ publishedTime }) => Number.isFinite(publishedTime) && publishedTime <= now)
		.sort((a, b) => b.publishedTime - a.publishedTime)
		.map(({ item }) => item);
};

const readJson = async (response) => {
	try {
		return await response.json();
	} catch {
		return null;
	}
};

const stripHtml = (value) =>
	String(value || '')
		.replace(/<[^>]*>/g, ' ')
		.replace(/&nbsp;/gi, ' ')
		.replace(/\s+/g, ' ')
		.trim();

const truncateAtWordBoundary = (value, limit) => {
	const text = String(value || '').trim();
	if (!text || !Number.isFinite(limit) || limit <= 0 || text.length <= limit) {
		return text;
	}

	const sliced = text.slice(0, limit);
	const boundaryIndex = sliced.lastIndexOf(' ');
	const safeSlice =
		boundaryIndex > Math.floor(limit * 0.6) ? sliced.slice(0, boundaryIndex) : sliced;
	return `${safeSlice.trim()}...`;
};

const normalizePrice = (value) => {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
};

const normalizeBestSellingProduct = (product) => {
	const id = String(product?._id || '').trim();
	const slug = String(product?.product_slug || product?.slug || '').trim();
	if (!id && !slug) return null;

	return {
		_id: id || null,
		product_name: String(product?.product_name || '').trim(),
		product_thumb: String(product?.product_thumb || '').trim(),
		product_description: truncateAtWordBoundary(
			stripHtml(product?.product_description || ''),
			MAX_PRODUCT_DESCRIPTION_CHARS
		),
		product_original_price: normalizePrice(product?.product_original_price),
		product_price: normalizePrice(product?.product_price),
		product_slug: slug || null,
		product_ratingsAverage: normalizePrice(product?.product_ratingsAverage) || 0,
		product_ratingsCount: Number(product?.product_ratingsCount) || 0,
		product_weight: Number(product?.product_weight) || 1000,
		product_shop: String(product?.product_shop || product?.shopId || '').trim()
	};
};

const normalizeLatestPost = (post) => {
	const id = String(post?.id || post?._id || '').trim();
	const slug = String(post?.slug || post?.blog_slug || '').trim();
	if (!id && !slug) return null;

	const excerptSource = String(post?.excerpt || post?.seoDescription || '').trim();
	return {
		id: id || null,
		_id: String(post?._id || '').trim() || null,
		slug: slug || null,
		title: String(post?.title || post?.seoTitle || '').trim(),
		excerpt: truncateAtWordBoundary(stripHtml(excerptSource), MAX_BLOG_EXCERPT_CHARS),
		image: String(post?.image || '').trim(),
		categoryKey: String(post?.categoryKey || '').trim() || null
	};
};

const fetchWithTimeout = async ({ fetch, url, headers, timeoutMs = HOME_FEED_API_TIMEOUT_MS }) => {
	const useTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0;
	const controller = useTimeout ? new AbortController() : null;
	let didTimeout = false;
	let timeoutId = null;

	if (controller) {
		timeoutId = setTimeout(() => {
			didTimeout = true;
			controller.abort();
		}, timeoutMs);
		timeoutId.unref?.();
	}

	try {
		return await fetch(url, {
			headers,
			...(controller ? { signal: controller.signal } : {})
		});
	} catch (error) {
		if (didTimeout && error?.name === 'AbortError') {
			return null;
		}
		throw error;
	} finally {
		if (timeoutId) clearTimeout(timeoutId);
	}
};

const toSnapshot = (feed) => ({
	bestSelling: Array.isArray(feed?.bestSelling) ? feed.bestSelling : [],
	latestPosts: Array.isArray(feed?.latestPosts) ? feed.latestPosts : [],
	savedAt: Date.now()
});

const fromSnapshot = (snapshot) => {
	if (!snapshot) return null;
	const bestSelling = Array.isArray(snapshot.bestSelling) ? snapshot.bestSelling : null;
	const latestPosts = Array.isArray(snapshot.latestPosts) ? snapshot.latestPosts : null;
	if (!isCompleteHomeFeed({ bestSellingItems: bestSelling, latestBlogItems: latestPosts })) {
		return null;
	}
	return {
		success: true,
		bestSelling,
		latestPosts,
		apiError: '',
		loaded: true,
		savedAt: Number(snapshot.savedAt) || 0,
		sourceHealth: { bestSelling: 'ready', latestPosts: 'ready' }
	};
};

const rememberSnapshot = async (feed) => {
	const snapshot = toSnapshot(feed);
	lastHomeFeedSnapshot = { ...feed, savedAt: snapshot.savedAt };
	await writeSharedValue(HOME_FEED_SNAPSHOT_KEY, snapshot, {
		ttlSeconds: HOME_FEED_SNAPSHOT_TTL_SECONDS
	});
};

/**
 * The last good feed, from this process if it has one and from Redis otherwise.
 * Reading Redis is bounded; a slow cache must not become a slow page.
 */
export const readHomeFeedSnapshot = async ({ budgetMs = SNAPSHOT_READ_BUDGET_MS } = {}) => {
	if (lastHomeFeedSnapshot?.loaded) return lastHomeFeedSnapshot;
	const shared = await readSharedValue(HOME_FEED_SNAPSHOT_KEY, { timeoutMs: budgetMs });
	const feed = fromSnapshot(shared);
	if (feed) lastHomeFeedSnapshot = feed;
	return feed;
};

const fetchHomeFeedUncached = async ({ fetch }) => {
	const headers = buildHeaders();
	const bestSellingUrl = new URL(`${API_BASE}/product/best-selling`);
	bestSellingUrl.searchParams.set('limit', String(BEST_SELLING_LIMIT));
	bestSellingUrl.searchParams.set('page', '1');

	const latestBlogsUrl = new URL(`${API_BASE}/blog`);
	latestBlogsUrl.searchParams.set('limit', String(LATEST_BLOG_FETCH_LIMIT));
	latestBlogsUrl.searchParams.set('page', '1');
	latestBlogsUrl.searchParams.set('sort', 'published');

	const [bestSellingResult, latestBlogsResult] = await Promise.allSettled([
		fetchWithTimeout({ fetch, url: bestSellingUrl, headers }),
		fetchWithTimeout({ fetch, url: latestBlogsUrl, headers })
	]);
	const bestSellingResponse =
		bestSellingResult.status === 'fulfilled' ? bestSellingResult.value : null;
	const latestBlogsResponse =
		latestBlogsResult.status === 'fulfilled' ? latestBlogsResult.value : null;

	let bestSelling = [];
	let bestSellingLoaded = false;
	if (bestSellingResponse?.ok) {
		const payload = await readJson(bestSellingResponse);
		const items = extractBestSellingItems(payload);
		if (items) {
			bestSelling = items.map(normalizeBestSellingProduct).filter(Boolean);
			bestSellingLoaded = true;
		}
	}

	let latestPosts = [];
	let latestPostsLoaded = false;
	if (latestBlogsResponse?.ok) {
		const latestBlogsPayload = await readJson(latestBlogsResponse);
		const blogItems = extractLatestBlogItems(latestBlogsPayload);
		if (blogItems) {
			latestPosts = sortByLatestPublishedPast(blogItems)
				.slice(0, LATEST_BLOG_RENDER_LIMIT)
				.map(normalizeLatestPost)
				.filter(Boolean);
			latestPostsLoaded = true;
		}
	}

	// The two rails fail independently, so they recover independently - see
	// mergeHomeFeedSources for why that matters.
	const previous = await readHomeFeedSnapshot();
	const merged = mergeHomeFeedSources({
		bestSellingItems: bestSellingLoaded ? bestSelling : null,
		latestBlogItems: latestPostsLoaded ? latestPosts : null,
		previous
	});

	const result = {
		success: merged.loaded,
		bestSelling: merged.bestSelling,
		latestPosts: merged.latestPosts,
		apiError: '',
		loaded: merged.loaded,
		sourceHealth: merged.sourceHealth
	};

	if (result.loaded && merged.hasFreshSource) {
		await rememberSnapshot(result);
	}

	return result;
};

/**
 * Refreshes the feed and seeds the read cache, deduplicating concurrent callers.
 *
 * The scheduled refresh must not go through getOrLoad: that returns the cached value
 * while it is still valid, so a loop running faster than the TTL would never actually
 * refresh anything, and a loop running slower would leave a gap at every expiry with
 * a visitor standing in it. Refreshing unconditionally and writing the result back is
 * what keeps the cache warm rather than merely warm-ish.
 */
const refreshHomeFeed = async ({ fetch }) => {
	if (refreshInFlight) return await refreshInFlight;
	refreshInFlight = (async () => {
		try {
			const next = await fetchHomeFeedUncached({ fetch });
			if (next.loaded) homeFeedCache.set(HOME_FEED_CACHE_KEY, next);
			return next;
		} finally {
			refreshInFlight = null;
		}
	})();
	return await refreshInFlight;
};

export const getHomeFeed = async ({ fetch }) => {
	try {
		const result = await homeFeedCache.getOrLoad(HOME_FEED_CACHE_KEY, async () => {
			const next = await refreshHomeFeed({ fetch });
			if (!next.loaded) {
				const error = new Error('Home feed sources are unavailable');
				error.code = 'HOME_FEED_UPSTREAM_UNAVAILABLE';
				error.feed = next;
				throw error;
			}
			return next;
		});
		if (result?.loaded) return result;
		return (await readHomeFeedSnapshot()) || result;
	} catch (error) {
		const snapshot = await readHomeFeedSnapshot();
		if (snapshot) return { ...snapshot, stale: true };
		return (
			error?.feed || {
				success: false,
				bestSelling: [],
				latestPosts: [],
				apiError: '',
				loaded: false,
				sourceHealth: {
					bestSelling: 'unavailable',
					latestPosts: 'unavailable'
				}
			}
		);
	}
};

// The process-local snapshot only. Callers that can afford to wait should use
// readHomeFeedSnapshot, which also consults Redis.
export const peekHomeFeedSnapshot = () => lastHomeFeedSnapshot;

/**
 * One bounded warm-up pass. Kept separate from the loop so it can be driven directly
 * in tests and so a caller can await a first fill.
 */
export const primeHomeFeed = async ({
	attempts = 3,
	delayMs = 2_000,
	fetchImpl = globalThis.fetch,
	wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
} = {}) => {
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		try {
			const result = await refreshHomeFeed({ fetch: fetchImpl });
			if (result?.loaded) return true;
		} catch {
			// A warm-up must never keep the server from serving.
		}
		if (attempt < attempts) await wait(delayMs);
	}
	return Boolean(await readHomeFeedSnapshot());
};

/**
 * Keeps the feed warm from the background instead of from a visitor's request.
 *
 * This is the part that makes the timeouts above safe to raise: nobody is waiting on
 * a refresh, so a refresh is allowed to take as long as the upstream needs. A render
 * reads whatever the loop last stored, which in normal operation is under a minute
 * old, and the request path never touches the database at all.
 */
export const startHomeFeedWarmLoop = ({
	intervalMs = HOME_FEED_REFRESH_INTERVAL_MS,
	fetchImpl = globalThis.fetch
} = {}) => {
	if (warmLoopTimer) return () => stopHomeFeedWarmLoop();

	let running = false;
	const tick = async () => {
		// A refresh slower than the interval must not stack up behind itself.
		if (running) return;
		running = true;
		try {
			await refreshHomeFeed({ fetch: fetchImpl });
		} catch {
			// Never let a refresh failure escape into an unhandled rejection.
		} finally {
			running = false;
		}
	};

	void primeHomeFeed({ fetchImpl });
	warmLoopTimer = setInterval(() => void tick(), intervalMs);
	// Must not be the reason the process stays alive during a shutdown.
	warmLoopTimer.unref?.();
	return () => stopHomeFeedWarmLoop();
};

export const stopHomeFeedWarmLoop = () => {
	if (!warmLoopTimer) return;
	clearInterval(warmLoopTimer);
	warmLoopTimer = null;
};

// Defaults to this process's last good feed, so callers only pass a snapshot
// when they are testing the decision itself.
export const resolveHomeFeedForRender = ({ fresh = null, snapshot = undefined } = {}) =>
	resolveRender({
		fresh,
		snapshot: snapshot === undefined ? lastHomeFeedSnapshot : snapshot
	});

export { HOME_FEED_CACHE_CONTROL, STALE_HOME_FEED_CACHE_CONTROL };
