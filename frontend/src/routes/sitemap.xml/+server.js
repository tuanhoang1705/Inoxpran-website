import { env } from '$env/dynamic/public';
import { API_BASE, API_KEY_HEADER } from '$lib/server/api.js';
import { CATEGORY_SLUG_MAP, resolveCategorySlug } from '$lib/utils/category.js';

const DEFAULT_SITE_URL = 'https://inoxpran.com';
const PRODUCT_PAGE_LIMIT = 100;
const BLOG_PAGE_LIMIT = 100;
const MAX_PAGES = 50;
const FALLBACK_CATEGORIES = Object.keys(CATEGORY_SLUG_MAP);
const SUPPORTED_LOCALES = ['vi', 'en'];
const HREFLANG_BY_LOCALE = {
	vi: 'vi-VN',
	en: 'en-US'
};

const buildHeaders = () => {
	const headers = {};
	if (API_KEY_HEADER) headers['x-api-key'] = API_KEY_HEADER;
	return headers;
};

const readJson = async (response) => {
	try {
		return await response.json();
	} catch {
		return null;
	}
};

const escapeXml = (value) =>
	String(value || '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');

const toIsoDate = (value) => {
	if (!value) return null;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return null;
	return date.toISOString();
};

const normalizeBaseUrl = (requestUrl) => {
	const configured = String(env.PUBLIC_SITE_URL || '').trim();
	if (configured) return configured.replace(/\/$/, '');

	if (requestUrl?.hostname && requestUrl.hostname !== 'localhost') {
		return `${requestUrl.protocol}//${requestUrl.host}`;
	}
	return DEFAULT_SITE_URL;
};

const fetchAllProducts = async (fetch) => {
	const headers = buildHeaders();
	const items = [];

	for (let page = 1; page <= MAX_PAGES; page += 1) {
		const endpoint = new URL(`${API_BASE}/product`);
		endpoint.searchParams.set('limit', String(PRODUCT_PAGE_LIMIT));
		endpoint.searchParams.set('page', String(page));

		const response = await fetch(endpoint, { headers });
		if (!response.ok) break;

		const payload = await readJson(response);
		const chunk = Array.isArray(payload?.metadata) ? payload.metadata : [];
		if (!chunk.length) break;

		items.push(...chunk);
		if (chunk.length < PRODUCT_PAGE_LIMIT) break;
	}

	return items;
};

const fetchAllBlogs = async (fetch) => {
	const headers = buildHeaders();
	const items = [];

	for (let page = 1; page <= MAX_PAGES; page += 1) {
		const endpoint = new URL(`${API_BASE}/blog`);
		endpoint.searchParams.set('limit', String(BLOG_PAGE_LIMIT));
		endpoint.searchParams.set('page', String(page));

		const response = await fetch(endpoint, { headers });
		if (!response.ok) break;

		const payload = await readJson(response);
		const metadata = payload?.metadata || {};
		const chunk = Array.isArray(metadata?.items) ? metadata.items : [];
		const total = Number(metadata?.total || 0);

		if (!chunk.length) break;
		items.push(...chunk);

		if (total > 0 && page * BLOG_PAGE_LIMIT >= total) break;
		if (chunk.length < BLOG_PAGE_LIMIT) break;
	}

	return items;
};

const extractCategories = (products) => {
	const unique = new Set();
	for (const product of products || []) {
		const raw =
			typeof product?.product_type === 'string'
				? product.product_type
				: typeof product?.category === 'string'
					? product.category
					: '';
		const value = String(raw || '').trim();
		if (value) unique.add(value);
	}
	if (!unique.size) {
		FALLBACK_CATEGORIES.forEach((category) => unique.add(category));
	}
	return Array.from(unique);
};

const toUrlNode = ({ loc, alternates, lastmod, changefreq, priority }) => {
	const nodes = [`<loc>${escapeXml(loc)}</loc>`];
	if (Array.isArray(alternates)) {
		for (const alternate of alternates) {
			const hreflang = String(alternate?.hreflang || '').trim();
			const href = String(alternate?.href || '').trim();
			if (!hreflang || !href) continue;
			nodes.push(
				`<xhtml:link rel="alternate" hreflang="${escapeXml(hreflang)}" href="${escapeXml(href)}" />`
			);
		}
	}
	if (lastmod) nodes.push(`<lastmod>${escapeXml(lastmod)}</lastmod>`);
	if (changefreq) nodes.push(`<changefreq>${changefreq}</changefreq>`);
	if (priority) nodes.push(`<priority>${priority}</priority>`);
	return `<url>${nodes.join('')}</url>`;
};

const normalizePathname = (value) => {
	const pathname = String(value || '').trim() || '/';
	if (pathname === '/') return '/';
	return pathname.replace(/\/+$/, '');
};

const buildLocalizedPath = (pathname, locale) => {
	const normalized = normalizePathname(pathname);
	const basePath = normalized.replace(/^\/en(?=\/|$)/, '') || '/';
	if (locale === 'en') {
		return `/en${basePath === '/' ? '' : basePath}`;
	}
	return basePath;
};

const expandLocaleEntries = (entries, baseUrl) => {
	const localized = [];
	for (const entry of entries || []) {
		if (!entry?.loc) continue;
		let rawUrl;
		try {
			rawUrl = new URL(entry.loc);
		} catch {
			continue;
		}
		const alternates = SUPPORTED_LOCALES.map((locale) => ({
			hreflang: HREFLANG_BY_LOCALE[locale] || locale,
			href: `${baseUrl}${buildLocalizedPath(rawUrl.pathname, locale)}${rawUrl.search}`
		}));
		alternates.push({
			hreflang: 'x-default',
			href: `${baseUrl}${buildLocalizedPath(rawUrl.pathname, 'vi')}${rawUrl.search}`
		});
		for (const locale of SUPPORTED_LOCALES) {
			const path = buildLocalizedPath(rawUrl.pathname, locale);
			localized.push({
				...entry,
				loc: `${baseUrl}${path}${rawUrl.search}`,
				alternates
			});
		}
	}
	return localized;
};

export const GET = async ({ fetch, url }) => {
	const baseUrl = normalizeBaseUrl(url);

	const staticEntries = [
		{ path: '/', changefreq: 'daily', priority: '1.0' },
		{ path: '/about', changefreq: 'monthly', priority: '0.6' },
		{ path: '/shop', changefreq: 'daily', priority: '0.9' },
		{ path: '/blog', changefreq: 'daily', priority: '0.9' },
		{ path: '/faq', changefreq: 'monthly', priority: '0.5' },
		{ path: '/policies', changefreq: 'monthly', priority: '0.4' },
		{ path: '/policies/returns-policy', changefreq: 'monthly', priority: '0.4' },
		{ path: '/policies/shipping-policy', changefreq: 'monthly', priority: '0.4' },
		{ path: '/policies/privacy-policy', changefreq: 'monthly', priority: '0.4' }
	].map((entry) => ({
		loc: `${baseUrl}${entry.path}`,
		changefreq: entry.changefreq,
		priority: entry.priority
	}));

	const [products, blogs] = await Promise.all([fetchAllProducts(fetch), fetchAllBlogs(fetch)]);
	const categories = extractCategories(products);

	const productEntries = products
		.map((product) => {
			const slug = String(product?.product_slug || product?._id || '').trim();
			if (!slug) return null;
			return {
				loc: `${baseUrl}/product/${encodeURIComponent(slug)}`,
				lastmod: toIsoDate(product?.updatedAt || product?.createdAt),
				changefreq: 'weekly',
				priority: '0.8'
			};
		})
		.filter(Boolean);

	const categoryEntries = categories
		.map((category) => {
			const slug = resolveCategorySlug(category);
			if (!slug) return null;
			return {
				loc: `${baseUrl}/category/${encodeURIComponent(slug)}`,
				changefreq: 'weekly',
				priority: '0.7'
			};
		})
		.filter(Boolean);

	const blogEntries = blogs
		.map((post) => {
			const slug = String(post?.slug || post?.blog_slug || '').trim();
			if (!slug) return null;
			return {
				loc: `${baseUrl}/blog/${encodeURIComponent(slug)}`,
				lastmod: toIsoDate(post?.updatedAt || post?.createdAt),
				changefreq: 'weekly',
				priority: '0.7'
			};
		})
		.filter(Boolean);

	const localizedStaticEntries = expandLocaleEntries(staticEntries, baseUrl);

	const mergedEntries = [
		...localizedStaticEntries,
		...categoryEntries,
		...productEntries,
		...blogEntries
	];
	const unique = [];
	const seen = new Set();
	for (const entry of mergedEntries) {
		if (!entry?.loc) continue;
		if (seen.has(entry.loc)) continue;
		seen.add(entry.loc);
		unique.push(entry);
	}

	const urlNodes = unique.map((entry) => toUrlNode(entry)).join('');
	const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urlNodes}</urlset>`;

	return new Response(xml, {
		headers: {
			'content-type': 'application/xml; charset=utf-8',
			'cache-control': 'public, max-age=0, s-maxage=3600'
		}
	});
};
