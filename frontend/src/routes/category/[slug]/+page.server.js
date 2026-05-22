import { fail, redirect } from '@sveltejs/kit';
import { API_BASE, API_BASE_CANDIDATES, API_KEY_HEADER } from '$lib/server/api.js';
import { getTranslator } from '$lib/i18n/server.js';
import { buildUserHeaders, clearSessionAndRedirect, getUserSession } from '$lib/server/userAuth.js';
import { env } from '$env/dynamic/public';
import {
	CATEGORY_SLUG_MAP,
	resolveCategorySlug,
	resolveCategoryValue
} from '$lib/utils/category.js';
import { fetchAllCatalogProducts } from '$lib/server/shopCatalogData.js';
import {
	computeCatalogFacetCounts,
	createEmptyFacetCounts,
	normalizeShopTagValue,
	paginateCatalogProducts
} from '$lib/shop/catalogFilters.js';

const CATEGORY_VALUES = Object.keys(CATEGORY_SLUG_MAP);
const DEFAULT_SITE_URL = 'https://inoxpran.com';
const UNTRANSLATED_ENGLISH_ROBOTS = Object.freeze({
	index: false,
	content: 'noindex, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1'
});

const buildHeaders = () => {
	const headers = {};
	if (API_KEY_HEADER) headers['x-api-key'] = API_KEY_HEADER;
	return headers;
};

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
const buildLocaleAlternates = ({ baseUrl, path }) => {
	const normalizedPath = String(path || '').trim() || '/';
	const basePath = normalizedPath.replace(/^\/en(?=\/|$)/, '') || '/';
	return {
		vi: `${baseUrl}${basePath}`,
		en: `${baseUrl}/en${basePath === '/' ? '' : basePath}`,
		xDefault: `${baseUrl}${basePath}`
	};
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

const toProducts = (payload) => (Array.isArray(payload?.metadata) ? payload.metadata : []);

const buildProductRequestUrl = ({
	base,
	requestLimit,
	page,
	searchTerm,
	minPrice,
	maxPrice,
	sort,
	categoryKey,
	categoryValue
}) => {
	const apiUrl = new URL(`${base}/product`);
	apiUrl.searchParams.set('limit', String(requestLimit));
	apiUrl.searchParams.set('page', String(page));
	if (categoryKey && categoryValue) {
		apiUrl.searchParams.set(categoryKey, categoryValue);
	}
	if (searchTerm) apiUrl.searchParams.set('q', searchTerm);
	if (Number.isFinite(minPrice)) apiUrl.searchParams.set('minPrice', String(minPrice));
	if (Number.isFinite(maxPrice)) apiUrl.searchParams.set('maxPrice', String(maxPrice));
	if (sort) apiUrl.searchParams.set('sort', sort);
	return apiUrl;
};

export const load = async ({ fetch, url, params, cookies }) => {
	const headers = buildHeaders();
	const t = getTranslator(cookies);
	const baseUrl = normalizeBaseUrl(url);
	const robots = buildLocaleRobots(url.pathname);
	const localePrefix = isEnglishPath(url.pathname) ? '/en' : '';
	const useVietnameseCanonical = robots?.index === false;
	const canonicalLocalePrefix = useVietnameseCanonical ? '' : localePrefix;
	const includeEnglishAlternate = !useVietnameseCanonical;
	const slug = String(params.slug || '').trim();
	const mappedCategory = resolveCategoryValue(slug, CATEGORY_VALUES);
	const canonicalSlug = resolveCategorySlug(mappedCategory || slug);
	const normalizedCategorySlug = canonicalSlug || slug;
	const categoryPathVi = `/category/${encodeURIComponent(normalizedCategorySlug)}`;
	const categoryCanonicalPath = `${canonicalLocalePrefix}${categoryPathVi}`;
	const hreflang = normalizedCategorySlug
		? includeEnglishAlternate
			? buildLocaleAlternates({ baseUrl, path: categoryPathVi })
			: {
					vi: `${baseUrl}${categoryPathVi}`,
					en: null,
					xDefault: `${baseUrl}${categoryPathVi}`
				}
		: null;

	if (canonicalSlug && slug && canonicalSlug !== slug) {
		const normalizedQuery = normalizeCatalogQuery(url.searchParams);
		throw redirect(
			308,
			`${localePrefix}/category/${encodeURIComponent(canonicalSlug)}${normalizedQuery ? `?${normalizedQuery}` : ''}`
		);
	}

	const normalizedQuery = normalizeCatalogQuery(url.searchParams);
	const currentQuery = url.searchParams.toString();
	if (normalizedQuery !== currentQuery) {
		throw redirect(308, `${url.pathname}${normalizedQuery ? `?${normalizedQuery}` : ''}`);
	}

	const q = url.searchParams.get('q')?.trim() || '';
	const tag = normalizeShopTagValue(url.searchParams.get('tag')?.trim() || '');
	const sort = url.searchParams.get('sort')?.trim() || '';
	const minPrice = parseNumber(url.searchParams.get('minPrice'));
	const maxPrice = parseNumber(url.searchParams.get('maxPrice'));
	const limit = parseNumber(url.searchParams.get('limit'), 12);
	const page = parseNumber(url.searchParams.get('page'), 1);
	const requestLimit = Math.max(limit + 1, 1);
	const category = mappedCategory || slug;

	const searchTerm = q;
	const activeFacetFilters = { q, tag, category, minPrice, maxPrice };
	const categoryCandidates = Array.from(
		new Set(
			[mappedCategory, slug, canonicalSlug]
				.map((value) => String(value || '').trim())
				.filter(Boolean)
		)
	);
	const requestUrls = [];
	const requestUrlSet = new Set();

	API_BASE_CANDIDATES.forEach((base) => {
		categoryCandidates.forEach((candidate) => {
			['category', 'product_type'].forEach((categoryKey) => {
				const apiUrl = buildProductRequestUrl({
					base,
					requestLimit,
					page,
					searchTerm,
					minPrice,
					maxPrice,
					sort,
					categoryKey,
					categoryValue: candidate
				});
				const key = apiUrl.toString();
				if (requestUrlSet.has(key)) return;
				requestUrlSet.add(key);
				requestUrls.push(apiUrl);
			});
		});
	});

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
	const basePath = categoryCanonicalPath;
	const shopPath = `${localePrefix}/shop`;
	if (!products.length && !hadSuccessfulResponse && errorStatus !== null) {
		return {
			products: [],
			filters: { q, tag, category, minPrice, maxPrice, sort, page, limit },
			pagination: { hasNextPage: false },
			facets,
			apiError: t('common.errors.productRequestFailedWithStatus', { status: errorStatus }),
			basePath,
			shopPath,
			canonicalUrl: `${baseUrl}${categoryCanonicalPath}`,
			hreflang,
			robots,
			categoryRouteEnabled: true
		};
	}

	if (!products.length && !hadSuccessfulResponse && hadNetworkFailure) {
		return {
			products: [],
			filters: { q, tag, category, minPrice, maxPrice, sort, page, limit },
			pagination: { hasNextPage: false },
			facets,
			basePath,
			shopPath,
			canonicalUrl: `${baseUrl}${categoryCanonicalPath}`,
			hreflang,
			robots,
			categoryRouteEnabled: true,
			apiError: t('common.errors.productRequestFailed')
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
		products: finalProducts,
		filters: { q, tag, category, minPrice, maxPrice, sort, page, limit },
		pagination: { hasNextPage: finalHasNextPage },
		facets,
		basePath,
		shopPath,
		canonicalUrl: `${baseUrl}${categoryCanonicalPath}`,
		hreflang,
		robots,
		categoryRouteEnabled: true
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
