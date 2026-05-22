import { fail, redirect } from '@sveltejs/kit';
import { API_BASE, API_BASE_CANDIDATES, API_KEY_HEADER } from '$lib/server/api.js';
import { getTranslator } from '$lib/i18n/server.js';
import { buildUserHeaders, clearSessionAndRedirect, getUserSession } from '$lib/server/userAuth.js';
import { resolveCategorySlug } from '$lib/utils/category.js';
import { fetchAllCatalogProducts } from '$lib/server/shopCatalogData.js';
import {
	computeCatalogFacetCounts,
	createEmptyFacetCounts,
	normalizeShopTagValue,
	paginateCatalogProducts
} from '$lib/shop/catalogFilters.js';

const buildHeaders = () => {
	const headers = {};
	if (API_KEY_HEADER) headers['x-api-key'] = API_KEY_HEADER;
	return headers;
};

const isEnglishPath = (pathname) => pathname === '/en' || pathname.startsWith('/en/');

const parseNumber = (value, fallback = undefined) => {
	if (value === null || value === undefined || value === '') return fallback;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeCatalogQuery = (searchParams) => {
	const normalized = new URLSearchParams();
	Array.from(searchParams.entries())
		.map(([key, value]) => [String(key || '').trim(), String(value || '').trim()])
		.filter(([key, value]) => key && value)
		.sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
		.forEach(([key, value]) => {
			if (key === 'page') {
				const parsedPage = Number(value);
				if (!Number.isFinite(parsedPage) || parsedPage <= 1) return;
				normalized.append(key, String(Math.floor(parsedPage)));
				return;
			}
			normalized.append(key, value);
		});
	return normalized.toString();
};

const readJson = async (response) => {
	try {
		return await response.json();
	} catch {
		return null;
	}
};

const toProducts = (payload) => (Array.isArray(payload?.metadata) ? payload.metadata : []);

const stripHtml = (value) =>
	String(value || '')
		.replace(/<[^>]*>/g, ' ')
		.replace(/&nbsp;/gi, ' ')
		.replace(/\s+/g, ' ')
		.trim();

const truncateText = (value, limit = 260) => {
	const text = String(value || '').trim();
	if (!text) return '';
	if (text.length <= limit) return text;
	const sliced = text.slice(0, limit);
	const wordBoundary = sliced.lastIndexOf(' ');
	const safeSlice = wordBoundary > Math.floor(limit * 0.6) ? sliced.slice(0, wordBoundary) : sliced;
	return `${safeSlice.trim()}...`;
};

const toShopListingProduct = (product) => ({
	_id: product?._id ?? '',
	product_name: String(product?.product_name || '').trim(),
	product_slug: String(product?.product_slug || product?.slug || '').trim(),
	product_thumb: String(product?.product_thumb || '').trim(),
	product_description: truncateText(stripHtml(product?.product_description || ''), 320),
	product_price: Number(product?.product_price) || 0,
	product_original_price: Number(product?.product_original_price) || 0,
	product_type: String(product?.product_type || '').trim(),
	product_ratingsAverage: Number(product?.product_ratingsAverage) || 0,
	product_ratingsCount: Number(product?.product_ratingsCount) || 0,
	product_weight: Number(product?.product_weight) || 1000,
	product_shop: String(product?.product_shop || product?.shopId || '').trim()
});

const buildProductRequestUrl = ({
	base,
	requestLimit,
	page,
	searchTerm,
	minPrice,
	maxPrice,
	sort,
	category
}) => {
	const apiUrl = new URL(`${base}/product`);
	apiUrl.searchParams.set('limit', String(requestLimit));
	apiUrl.searchParams.set('page', String(page));
	if (searchTerm) apiUrl.searchParams.set('q', searchTerm);
	if (category) apiUrl.searchParams.set('category', category);
	if (Number.isFinite(minPrice)) apiUrl.searchParams.set('minPrice', String(minPrice));
	if (Number.isFinite(maxPrice)) apiUrl.searchParams.set('maxPrice', String(maxPrice));
	if (sort) apiUrl.searchParams.set('sort', sort);
	return apiUrl;
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

const toSafeQuantity = (value) => {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) return 0;
	return Math.floor(parsed);
};

const fetchCartCount = async ({ fetch, session }) => {
	if (!session) return null;
	try {
		const response = await fetch(`${API_BASE}/cart`, {
			headers: buildUserHeaders(session)
		});
		if (!response.ok) return null;
		const payload = await readJson(response);
		const cart = payload?.metadata ?? payload?.data ?? payload ?? null;
		const products = Array.isArray(cart?.cart_products) ? cart.cart_products : [];
		return products.reduce((sum, item) => sum + toSafeQuantity(item?.quantity), 0);
	} catch {
		return null;
	}
};

export const load = async ({ fetch, url, cookies }) => {
	const headers = buildHeaders();
	const t = getTranslator(cookies);
	const localePrefix = isEnglishPath(url.pathname) ? '/en' : '';
	const localeAwareShopPath = `${localePrefix}/shop`;
	const category = url.searchParams.get('category')?.trim() || '';

	const q = url.searchParams.get('q')?.trim() || '';
	const tag = normalizeShopTagValue(url.searchParams.get('tag')?.trim() || '');
	const sort = url.searchParams.get('sort')?.trim() || '';
	const minPrice = parseNumber(url.searchParams.get('minPrice'));
	const maxPrice = parseNumber(url.searchParams.get('maxPrice'));
	const limit = parseNumber(url.searchParams.get('limit'), 15);
	const page = parseNumber(url.searchParams.get('page'), 1);
	const requestLimit = Math.max(limit + 1, 1);

	if (category) {
		const categorySlug = resolveCategorySlug(category);
		const params = new URLSearchParams(url.searchParams);
		params.delete('category');
		const query = normalizeCatalogQuery(params);
		throw redirect(
			308,
			`${localePrefix}/category/${encodeURIComponent(categorySlug)}${query ? `?${query}` : ''}`
		);
	}

	const normalizedQuery = normalizeCatalogQuery(url.searchParams);
	const currentQuery = url.searchParams.toString();
	if (normalizedQuery !== currentQuery) {
		throw redirect(308, `${url.pathname}${normalizedQuery ? `?${normalizedQuery}` : ''}`);
	}

	const searchTerm = q;
	const activeFacetFilters = { q, tag, category, minPrice, maxPrice };
	const requestUrls = API_BASE_CANDIDATES.map((base) =>
		buildProductRequestUrl({
			base,
			requestLimit,
			page,
			searchTerm,
			minPrice,
			maxPrice,
			sort,
			category
		})
	);

	let fallbackProducts = [];
	let resolvedProducts = [];
	let errorStatus = null;
	let hadNetworkFailure = false;
	let hadSuccessfulResponse = false;
	let facets = createEmptyFacetCounts();

	for (const apiUrl of requestUrls) {
		try {
			const response = await fetch(apiUrl, { headers });
			if (!response.ok) {
				if (errorStatus === null) errorStatus = response.status;
				continue;
			}

			hadSuccessfulResponse = true;
			const payload = await readJson(response);
			const products = toProducts(payload);
			if (products.length) {
				resolvedProducts = products;
				break;
			}
			if (!fallbackProducts.length) {
				fallbackProducts = products;
			}
		} catch {
			hadNetworkFailure = true;
		}
	}

	const products = resolvedProducts.length ? resolvedProducts : fallbackProducts;
	if (!products.length && !hadSuccessfulResponse && errorStatus !== null) {
		return {
			products: [],
			filters: { q, tag, category, minPrice, maxPrice, sort, page, limit },
			pagination: { hasNextPage: false },
			facets,
			basePath: localeAwareShopPath,
			shopPath: localeAwareShopPath,
			categoryRouteEnabled: true,
			apiError: t('common.errors.productRequestFailedWithStatus', { status: errorStatus }),
			seo: { disableDefaults: true }
		};
	}

	if (!products.length && !hadSuccessfulResponse && hadNetworkFailure) {
		return {
			products: [],
			filters: { q, tag, category, minPrice, maxPrice, sort, page, limit },
			pagination: { hasNextPage: false },
			facets,
			basePath: localeAwareShopPath,
			shopPath: localeAwareShopPath,
			categoryRouteEnabled: true,
			apiError: t('common.errors.productRequestFailed'),
			seo: { disableDefaults: true }
		};
	}

	const hasNextPage = products.length > limit;
	const trimmedProducts = products.slice(0, limit);
	let finalProducts = trimmedProducts;
	let finalHasNextPage = hasNextPage;
	try {
		const catalogSnapshot = await fetchAllCatalogProducts({ fetch, headers });
		const facetSourceProducts = catalogSnapshot.products.length
			? catalogSnapshot.products
			: products;
		facets = computeCatalogFacetCounts({
			products: facetSourceProducts,
			filters: activeFacetFilters
		});

		if (tag) {
			const localPage = paginateCatalogProducts({
				products: facetSourceProducts,
				filters: { q, tag, category, minPrice, maxPrice },
				sort,
				page,
				limit
			});
			finalProducts = localPage.items;
			finalHasNextPage = localPage.hasNextPage;
		}
	} catch {
		facets = computeCatalogFacetCounts({
			products,
			filters: activeFacetFilters
		});
		if (tag) {
			const localPage = paginateCatalogProducts({
				products: products,
				filters: { q, tag, category, minPrice, maxPrice },
				sort,
				page,
				limit
			});
			finalProducts = localPage.items;
			finalHasNextPage = localPage.hasNextPage;
		}
	}

	return {
		products: finalProducts.map(toShopListingProduct),
		filters: { q, tag, category, minPrice, maxPrice, sort, page, limit },
		pagination: { hasNextPage: finalHasNextPage },
		facets,
		basePath: localeAwareShopPath,
		shopPath: localeAwareShopPath,
		categoryRouteEnabled: true,
		seo: { disableDefaults: true }
	};
};

export const actions = {
	addToCart: async ({ request, fetch, cookies }) => {
		const session = getUserSession(cookies);
		const t = getTranslator(cookies);
		if (!session) {
			return fail(401, { error: t('cart.errors.loginRequired') });
		}

		const payload = await readRequestBody(request);
		const productId = String(payload?.productId ?? '').trim();
		if (!productId) {
			return fail(400, { error: t('cart.errors.addFailed') });
		}

		const headers = {
			...buildUserHeaders(session),
			'content-type': 'application/json'
		};

		const response = await fetch(`${API_BASE}/cart`, {
			method: 'POST',
			headers,
			body: JSON.stringify({ productId, quantity: 1 })
		});

		const apiPayload = await readJson(response);
		if (!response.ok) {
			if ([401, 403].includes(response.status)) {
				clearSessionAndRedirect(cookies);
			}
			return fail(response.status, {
				error: apiPayload?.message ?? t('cart.errors.addFailed')
			});
		}

		const cartCount = await fetchCartCount({ fetch, session });
		return { success: true, metadata: apiPayload?.metadata ?? null, cartCount };
	}
};
