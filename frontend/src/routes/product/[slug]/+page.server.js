import { error, fail, redirect } from '@sveltejs/kit';
import { API_BASE, API_KEY_HEADER } from '$lib/server/api.js';
import { getTranslator } from '$lib/i18n/server.js';
import { buildUserHeaders, clearSessionAndRedirect, getUserSession } from '$lib/server/userAuth.js';
import { env } from '$env/dynamic/public';
import { createMutationGuard } from '$lib/server/mutationGuard.js';
import { createAsyncTtlCache } from '$lib/server/asyncTtlCache.js';
import { randomUUID } from 'node:crypto';

const buildHeaders = () => {
	const headers = {};
	if (API_KEY_HEADER) {
		headers['x-api-key'] = API_KEY_HEADER;
	}
	return headers;
};

const readJson = async (response) => {
	try {
		return await response.json();
	} catch {
		return null;
	}
};

const readRequestBody = async (request) => {
	const contentType = request.headers.get('content-type') || '';
	if (contentType.includes('application/json')) {
		try {
			return await request.json();
		} catch {
			return {};
		}
	}
	try {
		const form = await request.formData();
		return Object.fromEntries(form);
	} catch {
		return {};
	}
};

const DEFAULT_SITE_URL = 'https://inoxpran.com';
const UNTRANSLATED_ENGLISH_ROBOTS = Object.freeze({
	index: false,
	content: 'noindex, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1'
});

const normalizeBaseUrl = (requestUrl) => {
	const configured = String(env.PUBLIC_SITE_URL || '').trim();
	if (configured) return configured.replace(/\/$/, '');
	if (requestUrl?.hostname && requestUrl.hostname !== 'localhost') {
		return `${requestUrl.protocol}//${requestUrl.host}`;
	}
	return DEFAULT_SITE_URL;
};
const isEnglishPath = (pathname) => pathname === '/en' || pathname.startsWith('/en/');
const buildLocaleRobots = (pathname) =>
	isEnglishPath(pathname) ? UNTRANSLATED_ENGLISH_ROBOTS : null;
const resolveCanonicalSlug = (product) =>
	String(product?.product_slug || product?.slug || product?._id || '').trim();

const toSafeQuantity = (value) => {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) return 0;
	return Math.floor(parsed);
};

const PRICE_VALID_UNTIL_FALLBACK_DAYS = 365;
const PRICE_VALID_UNTIL_FIELD_CANDIDATES = [
	'priceValidUntil',
	'price_valid_until',
	'discount_end_date',
	'discountEndDate',
	'sale_end_date',
	'saleEndDate',
	'end_date',
	'endDate'
];

const toIsoDateOnly = (value) => {
	const raw = String(value ?? '').trim();
	if (!raw) return '';
	const date = new Date(raw);
	if (Number.isNaN(date.getTime())) return '';
	return date.toISOString().slice(0, 10);
};

const buildFallbackPriceValidUntil = () => {
	const fallbackDate = new Date();
	fallbackDate.setUTCDate(fallbackDate.getUTCDate() + PRICE_VALID_UNTIL_FALLBACK_DAYS);
	return fallbackDate.toISOString().slice(0, 10);
};

const resolvePriceValidUntil = (product) => {
	for (const field of PRICE_VALID_UNTIL_FIELD_CANDIDATES) {
		const resolved = toIsoDateOnly(product?.[field]);
		if (resolved) return resolved;
	}
	return buildFallbackPriceValidUntil();
};

const ADD_TO_CART_REQUEST_TTL_MS = 5 * 60 * 1000;
const ADD_TO_CART_DUPLICATE_WINDOW_MS = 1200;
const PRODUCT_DETAIL_CACHE_TTL_MS = 45 * 1000;
const RELATED_PRODUCTS_CACHE_TTL_MS = 60 * 1000;
const addToCartGuard = createMutationGuard({
	processedTtlMs: ADD_TO_CART_REQUEST_TTL_MS,
	recentTtlMs: ADD_TO_CART_DUPLICATE_WINDOW_MS
});
const productDetailCache = createAsyncTtlCache({
	ttlMs: PRODUCT_DETAIL_CACHE_TTL_MS,
	maxEntries: 256
});
const relatedProductsCache = createAsyncTtlCache({
	ttlMs: RELATED_PRODUCTS_CACHE_TTL_MS,
	maxEntries: 8
});

const fetchCartCount = async ({ fetch, session }) => {
	if (!session) return null;
	try {
		const response = await fetch(`${API_BASE}/cart`, {
			headers: buildUserHeaders(session)
		});
		if (!response.ok) {
			return null;
		}
		const payload = await readJson(response);
		const cart = payload?.metadata ?? payload?.data ?? payload ?? null;
		const products = Array.isArray(cart?.cart_products) ? cart.cart_products : [];
		return products.reduce((sum, item) => sum + toSafeQuantity(item?.quantity), 0);
	} catch {
		return null;
	}
};

const fetchProductPayloadCached = async ({ fetch, slug, headers }) =>
	productDetailCache.getOrLoad(`product:${String(slug || '').trim()}`, async () => {
		const response = await fetch(`${API_BASE}/product/${slug}`, { headers });
		if (!response.ok) {
			const error = new Error(`product fetch failed: ${response.status}`);
			error.status = response.status;
			throw error;
		}
		return await readJson(response);
	});

const fetchRelatedProductsCached = async ({ fetch, headers }) =>
	relatedProductsCache.getOrLoad('related-products:12:v1', async () => {
		const relatedUrl = new URL(`${API_BASE}/product`);
		relatedUrl.searchParams.set('limit', '12');
		relatedUrl.searchParams.set('page', '1');

		const response = await fetch(relatedUrl, { headers });
		if (!response.ok) {
			const error = new Error(`related products fetch failed: ${response.status}`);
			error.status = response.status;
			throw error;
		}

		return await readJson(response);
	});

const fetchReviewMeta = async ({ fetch, productLookup, session }) => {
	if (!session || !productLookup) return null;
	try {
		const response = await fetch(
			`${API_BASE}/product/${encodeURIComponent(String(productLookup).trim())}/review-meta`,
			{
				headers: buildUserHeaders(session)
			}
		);
		if (!response.ok) {
			return null;
		}
		const payload = await readJson(response);
		return payload?.metadata ?? null;
	} catch {
		return null;
	}
};

export const load = async ({ params, fetch, cookies, url }) => {
	const headers = buildHeaders();
	const t = getTranslator(cookies);
	const baseUrl = normalizeBaseUrl(url);
	const robots = buildLocaleRobots(url.pathname);
	const session = getUserSession(cookies);
	const localePrefix = isEnglishPath(url.pathname) ? '/en' : '';
	const useVietnameseCanonical = robots?.index === false;
	const canonicalLocalePrefix = useVietnameseCanonical ? '' : localePrefix;

	try {
		const [productPayload, relatedPayload, reviewMeta] = await Promise.all([
			fetchProductPayloadCached({ fetch, slug: params.slug, headers }),
			fetchRelatedProductsCached({ fetch, headers }).catch(() => null),
			fetchReviewMeta({ fetch, productLookup: params.slug, session })
		]);
		const product = productPayload?.metadata ?? null;
		if (!product) {
			throw error(404, t('product.notFound'));
		}
		const canonicalSlug = resolveCanonicalSlug(product);
		const requestedSlug = String(params.slug || '').trim();
		const canonicalProductPath = `/product/${encodeURIComponent(canonicalSlug || requestedSlug)}`;
		const canonicalPath = `${canonicalLocalePrefix}${canonicalProductPath}`;
		const hreflang = {
			vi: `${baseUrl}${canonicalProductPath}`,
			en: null,
			xDefault: `${baseUrl}${canonicalProductPath}`
		};

		if (canonicalSlug && requestedSlug && canonicalSlug !== requestedSlug) {
			const destination = `${localePrefix}/product/${encodeURIComponent(canonicalSlug)}${url.search || ''}`;
			throw redirect(308, destination);
		}

		return {
			product,
			relatedProducts: relatedPayload?.metadata ?? [],
			canonicalUrl: canonicalSlug ? `${baseUrl}${canonicalPath}` : null,
			priceValidUntil: resolvePriceValidUntil(product),
			hreflang,
			robots,
			reviewMeta,
			actionRequestSeed: randomUUID(),
			seo: { disableDefaults: true }
		};
	} catch (loadError) {
		if (loadError?.status && loadError?.location) throw loadError;
		if (loadError?.status === 404) {
			throw error(404, t('product.notFound'));
		}
		if (Number.isInteger(loadError?.status) && loadError.status >= 400 && loadError.status < 600) {
			return {
				product: null,
				relatedProducts: [],
				apiError: t('common.errors.productRequestFailedWithStatus', {
					status: loadError.status
				}),
				canonicalUrl: null,
				priceValidUntil: '',
				robots,
				reviewMeta: null,
				actionRequestSeed: randomUUID(),
				seo: { disableDefaults: true }
			};
		}
		return {
			product: null,
			relatedProducts: [],
			apiError: t('common.errors.productRequestFailed'),
			canonicalUrl: null,
			priceValidUntil: '',
			robots,
			reviewMeta: null,
			actionRequestSeed: randomUUID(),
			seo: { disableDefaults: true }
		};
	}
};

const addItemToCart = async ({ request, fetch, cookies }) => {
	const session = getUserSession(cookies);
	const t = getTranslator(cookies);
	if (!session) {
		return { error: t('cart.errors.loginRequired'), status: 401 };
	}

	const payload = await readRequestBody(request);
	const productId = String(payload?.productId ?? '').trim();
	const quantityRaw = Number(payload?.quantity ?? 1);
	const quantity = Number.isFinite(quantityRaw) ? Math.max(1, Math.floor(quantityRaw)) : 1;
	const clientRequestId = String(payload?.clientRequestId ?? payload?.client_request_id ?? '').trim();
	const sessionUserId = String(session?.userId || '').trim();
	if (!productId) {
		return { error: t('cart.errors.addFailed'), status: 400 };
	}

	const idempotencyKey =
		clientRequestId && sessionUserId ? `${sessionUserId}:${clientRequestId}` : '';
	const recentKey = `${sessionUserId}:${productId}:${quantity}`;

	return await addToCartGuard.run({
		idempotencyKey,
		recentKey,
		task: async () => {
			const headers = {
				...buildUserHeaders(session),
				'content-type': 'application/json'
			};

			const response = await fetch(`${API_BASE}/cart`, {
				method: 'POST',
				headers,
				body: JSON.stringify({ productId, quantity })
			});

			const apiPayload = await readJson(response);
			if (!response.ok) {
				if ([401, 403].includes(response.status)) {
					clearSessionAndRedirect(cookies);
				}
				return {
					error: apiPayload?.message ?? t('cart.errors.addFailed'),
					status: response.status
				};
			}

			const metadata = apiPayload?.metadata ?? null;
			const cartCount = await fetchCartCount({ fetch, session });
			return {
				success: true,
				metadata,
				cartCount,
				productId,
				quantity
			};
		}
	});
};

export const actions = {
	addToCart: async ({ request, fetch, cookies }) => {
		const result = await addItemToCart({ request, fetch, cookies });
		if (result?.error) {
			return fail(result.status || 400, { error: result.error });
		}
		return {
			success: true,
			metadata: result.metadata ?? null,
			cartCount: result.cartCount
		};
	},
	buyNow: async ({ request, cookies }) => {
		const session = getUserSession(cookies);
		const t = getTranslator(cookies);
		if (!session) {
			return fail(401, { error: t('cart.errors.loginRequired') });
		}

		const payload = await readRequestBody(request);
		const productId = String(payload?.productId ?? '').trim();
		const quantityRaw = Number(payload?.quantity ?? 1);
		const quantity = Number.isFinite(quantityRaw) ? Math.max(1, Math.floor(quantityRaw)) : 1;
		const variantPriceRaw = Number(payload?.variant_price ?? payload?.variantPrice);
		const variantPrice =
			Number.isFinite(variantPriceRaw) && variantPriceRaw > 0
				? Math.floor(variantPriceRaw)
				: null;

		if (!productId) {
			return fail(400, { error: t('cart.errors.addFailed') });
		}

		const params = new URLSearchParams({
			buyNowProductId: productId,
			buyNowQuantity: String(quantity)
		});
		if (variantPrice !== null) {
			params.set('buyNowPrice', String(variantPrice));
		}
		const target = `/checkout?${params.toString()}`;
		throw redirect(303, target);
	},
	submitReview: async ({ request, fetch, cookies }) => {
		const session = getUserSession(cookies);
		const t = getTranslator(cookies);
		const form = await request.formData();
		const productId = String(form.get('productId') || '').trim();
		const reviewImageEntries = form.getAll('review_images');
		const reviewValues = {
			rating: String(form.get('rating') || '').trim(),
			title: String(form.get('title') || '').trim(),
			content: String(form.get('content') || '').trim()
		};

		if (!session) {
			return fail(401, {
				reviewError: t('cart.errors.loginRequired'),
				reviewValues
			});
		}

		if (!productId) {
			return fail(400, {
				reviewError: t('product.reviewSubmitFailed'),
				reviewValues
			});
		}

		try {
			const backendForm = new FormData();
			backendForm.set('rating', reviewValues.rating);
			backendForm.set('title', reviewValues.title);
			backendForm.set('content', reviewValues.content);
			for (const entry of reviewImageEntries) {
				if (typeof entry === 'string') {
					backendForm.append('review_images', entry);
					continue;
				}
				if (entry && typeof entry === 'object' && Number(entry.size) > 0) {
					backendForm.append('review_images', entry, entry.name || 'review-image');
				}
			}

			const response = await fetch(`${API_BASE}/product/${encodeURIComponent(productId)}/reviews`, {
				method: 'POST',
				headers: buildUserHeaders(session),
				body: backendForm
			});
			const payload = await readJson(response);

			if (response.status === 401) {
				clearSessionAndRedirect(cookies);
			}

			if (!response.ok) {
				return fail(response.status || 400, {
					reviewError: payload?.message || t('product.reviewSubmitFailed'),
					reviewValues,
					reviewMeta:
						(await fetchReviewMeta({
							fetch,
							productLookup: productId,
							session
						})) ?? null
				});
			}

			productDetailCache.clear();
			const metadata = payload?.metadata ?? {};
			const reviewStatus =
				String(metadata?.review?.status || metadata?.reviewMeta?.review?.status || '').trim() ||
				'approved';
			return {
				reviewSuccess: true,
				reviewMessage: metadata?.updated
					? reviewStatus === 'pending'
						? t('product.reviewPendingUpdateSuccess')
						: t('product.reviewUpdateSuccess')
					: reviewStatus === 'pending'
						? t('product.reviewPendingSuccess')
						: t('product.reviewSubmitSuccess'),
				reviewProduct: metadata?.product ?? null,
				reviewMeta: metadata?.reviewMeta ?? null
			};
		} catch (submitError) {
			if (submitError?.status && submitError?.location) throw submitError;
			return fail(502, {
				reviewError: t('product.reviewSubmitFailed'),
				reviewValues
			});
		}
	}
};
