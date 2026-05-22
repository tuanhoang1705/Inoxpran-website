import { API_BASE, API_KEY_HEADER } from '$lib/server/api.js';
import { createAsyncTtlCache } from '$lib/server/asyncTtlCache.js';

const HOME_FEED_TTL_MS = 60_000;
const HOME_FEED_API_TIMEOUT_MS = 1_200;
const MAX_PRODUCT_DESCRIPTION_CHARS = 420;
const MAX_BLOG_EXCERPT_CHARS = 220;
const homeFeedCache = createAsyncTtlCache({ ttlMs: HOME_FEED_TTL_MS, maxEntries: 8 });
let lastHomeFeedSnapshot = null;

const buildHeaders = () => {
	const headers = {};
	if (API_KEY_HEADER) {
		headers['x-api-key'] = API_KEY_HEADER;
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
	const bestSellingResponse = bestSellingResult.status === 'fulfilled' ? bestSellingResult.value : null;
	const latestBlogsResponse = latestBlogsResult.status === 'fulfilled' ? latestBlogsResult.value : null;

	let bestSelling = [];
	let bestSellingLoaded = false;
	if (bestSellingResponse?.ok) {
		const payload = await readJson(bestSellingResponse);
		bestSelling = Array.isArray(payload?.metadata)
			? payload.metadata.map(normalizeBestSellingProduct).filter(Boolean)
			: [];
		bestSellingLoaded = true;
	}

	let latestPosts = [];
	let latestPostsLoaded = false;
	if (latestBlogsResponse?.ok) {
		const latestBlogsPayload = await readJson(latestBlogsResponse);
		const blogItems = Array.isArray(latestBlogsPayload?.metadata?.items)
			? latestBlogsPayload.metadata.items
			: [];
		latestPosts = sortByLatestPublishedPast(blogItems)
			.slice(0, 4)
			.map(normalizeLatestPost)
			.filter(Boolean);
		latestPostsLoaded = true;
	}

	const result = {
		success: true,
		bestSelling,
		latestPosts,
		apiError: '',
		loaded: bestSellingLoaded || latestPostsLoaded
	};

	if (result.loaded) {
		lastHomeFeedSnapshot = result;
	}

	return result;
};

export const getHomeFeed = async ({ fetch }) => {
	try {
		const result = await homeFeedCache.getOrLoad('home-feed:v2', () => fetchHomeFeedUncached({ fetch }));
		if (result?.loaded) return result;
		return lastHomeFeedSnapshot || result;
	} catch {
		if (lastHomeFeedSnapshot) {
			return lastHomeFeedSnapshot;
		}
		return {
			success: false,
			bestSelling: [],
			latestPosts: [],
			apiError: '',
			loaded: false
		};
	}
};

export const HOME_FEED_CACHE_CONTROL =
	'public, max-age=60, s-maxage=300, stale-while-revalidate=600';
