import { API_BASE, PUBLIC_API_KEY_HEADER } from '$lib/server/api.js';
import { createAsyncTtlCache } from '$lib/server/asyncTtlCache.js';
import {
	extractBestSellingItems,
	extractLatestBlogItems,
	isCompleteHomeFeed,
	resolveHomeFeedForRender as resolveRender,
	HOME_FEED_CACHE_CONTROL,
	STALE_HOME_FEED_CACHE_CONTROL
} from '$lib/server/homeFeedContract.js';

const HOME_FEED_TTL_MS = 60_000;
const HOME_FEED_API_TIMEOUT_MS = 1_200;
const MAX_PRODUCT_DESCRIPTION_CHARS = 420;
const MAX_BLOG_EXCERPT_CHARS = 220;
const homeFeedCache = createAsyncTtlCache({ ttlMs: HOME_FEED_TTL_MS, maxEntries: 8 });
let lastHomeFeedSnapshot = null;

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

const fetchHomeFeedUncached = async ({ fetch }) => {
	const headers = buildHeaders();
	const bestSellingUrl = new URL(`${API_BASE}/product/best-selling`);
	bestSellingUrl.searchParams.set('limit', '6');
	bestSellingUrl.searchParams.set('page', '1');

	const latestBlogsUrl = new URL(`${API_BASE}/blog`);
	latestBlogsUrl.searchParams.set('limit', '8');
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
				.slice(0, 4)
				.map(normalizeLatestPost)
				.filter(Boolean);
			latestPostsLoaded = true;
		}
	}

	const loaded = isCompleteHomeFeed({
		bestSellingItems: bestSellingLoaded ? bestSelling : null,
		latestBlogItems: latestPostsLoaded ? latestPosts : null
	});

	const result = {
		success: loaded,
		bestSelling,
		latestPosts,
		apiError: '',
		loaded,
		sourceHealth: {
			bestSelling: bestSellingLoaded ? 'ready' : 'unavailable',
			latestPosts: latestPostsLoaded ? 'ready' : 'unavailable'
		}
	};

	if (result.loaded) {
		lastHomeFeedSnapshot = result;
	}

	return result;
};

export const getHomeFeed = async ({ fetch }) => {
	try {
		const result = await homeFeedCache.getOrLoad('home-feed:v3', async () => {
			const next = await fetchHomeFeedUncached({ fetch });
			if (!next.loaded) {
				const error = new Error('Home feed sources are unavailable');
				error.code = 'HOME_FEED_UPSTREAM_UNAVAILABLE';
				error.feed = next;
				throw error;
			}
			return next;
		});
		if (result?.loaded) return result;
		return lastHomeFeedSnapshot || result;
	} catch (error) {
		if (lastHomeFeedSnapshot) {
			return { ...lastHomeFeedSnapshot, stale: true };
		}
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

// The last complete feed this process built. Callers that gave up waiting for a
// refresh can render this instead of an error: it is real data, at worst a
// little behind, and the refresh they abandoned is still running and will fill
// the cache for whoever comes next.
export const peekHomeFeedSnapshot = () => lastHomeFeedSnapshot;

// The snapshot only exists in this process's memory, so a freshly started
// container has none. The first visitor then pays a cold MongoDB Atlas
// connection — measured at 855ms, more than the entire SSR budget — with
// nothing to fall back to, which is exactly why the homepage failed right
// after a deploy. Fill it before anyone arrives. The backend is already
// healthy by the time this container starts, but a couple of retries cost
// nothing and cover a slow first connection.
export const primeHomeFeed = async ({
	attempts = 3,
	delayMs = 2_000,
	fetchImpl = globalThis.fetch,
	wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
} = {}) => {
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		try {
			const result = await getHomeFeed({ fetch: fetchImpl });
			if (result?.loaded) return true;
		} catch {
			// A warm-up must never keep the server from serving.
		}
		if (attempt < attempts) await wait(delayMs);
	}
	return Boolean(lastHomeFeedSnapshot);
};

// Defaults to this process's last good feed, so callers only pass a snapshot
// when they are testing the decision itself.
export const resolveHomeFeedForRender = ({ fresh = null, snapshot = undefined } = {}) =>
	resolveRender({
		fresh,
		snapshot: snapshot === undefined ? lastHomeFeedSnapshot : snapshot
	});

export { HOME_FEED_CACHE_CONTROL, STALE_HOME_FEED_CACHE_CONTROL };
