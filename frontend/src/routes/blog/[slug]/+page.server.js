import { fail } from '@sveltejs/kit';
import { API_BASE, API_KEY_HEADER } from '$lib/server/api.js';
import { getTranslator, translate } from '$lib/i18n/server.js';
import { subscribeNewsletter } from '$lib/server/newsletter.js';
import { env } from '$env/dynamic/public';

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
const buildLocaleAlternates = ({ baseUrl, path }) => {
	const normalizedPath = String(path || '').trim() || '/';
	const basePath = normalizedPath.replace(/^\/en(?=\/|$)/, '') || '/';
	return {
		vi: `${baseUrl}${basePath}`,
		en: `${baseUrl}/en${basePath === '/' ? '' : basePath}`,
		xDefault: `${baseUrl}${basePath}`
	};
};

export const load = async ({ params, fetch, url }) => {
	const headers = buildHeaders();
	const slug = String(params.slug || '').trim();
	const baseUrl = normalizeBaseUrl(url);
	const robots = buildLocaleRobots(url.pathname);
	const lang = isEnglishPath(url.pathname) ? 'en' : 'vi';
	const localePrefix = isEnglishPath(url.pathname) ? '/en' : '';
	const useVietnameseCanonical = robots?.index === false;
	const canonicalLocalePrefix = useVietnameseCanonical ? '' : localePrefix;
	const includeEnglishAlternate = !useVietnameseCanonical;
	const canonicalBlogPath = slug ? `/blog/${encodeURIComponent(slug)}` : '';
	const canonicalPath = canonicalBlogPath ? `${canonicalLocalePrefix}${canonicalBlogPath}` : '';
	const hreflang = canonicalBlogPath
		? includeEnglishAlternate
			? buildLocaleAlternates({
					baseUrl,
					path: canonicalBlogPath
				})
			: {
					vi: `${baseUrl}${canonicalBlogPath}`,
					en: null,
					xDefault: `${baseUrl}${canonicalBlogPath}`
				}
		: null;
	if (!slug) {
		return {
			post: null,
			apiError: 'Blog slug is required',
			comments: [],
			commentsTotal: 0,
			commentsError: '',
			canonicalUrl: null,
			hreflang: null,
			robots,
			seo: { disableDefaults: true }
		};
	}

	const endpoint = `${API_BASE}/blog/${encodeURIComponent(slug)}`;
	const commentsEndpoint = `${API_BASE}/blog/${encodeURIComponent(slug)}/comments`;

	try {
		const [response, commentsResponse] = await Promise.all([
			fetch(endpoint, { headers }),
			fetch(commentsEndpoint, { headers })
		]);

		if (!response.ok) {
			return {
				post: null,
				apiError: `Blog detail request failed: ${response.status}`,
				comments: [],
				commentsTotal: 0,
				commentsError: '',
				canonicalUrl: `${baseUrl}${canonicalPath}`,
				hreflang,
				robots,
				seo: { disableDefaults: true }
			};
		}

		const payload = await readJson(response);
		const post = payload?.metadata ?? null;
		const canonicalSlug = String(post?.slug || post?.blog_slug || slug).trim() || slug;
		const postCanonicalBlogPath = `/blog/${encodeURIComponent(canonicalSlug)}`;
		const postCanonicalPath = `${canonicalLocalePrefix}${postCanonicalBlogPath}`;
		const postHreflang = includeEnglishAlternate
			? buildLocaleAlternates({
					baseUrl,
					path: postCanonicalBlogPath
				})
			: {
					vi: `${baseUrl}${postCanonicalBlogPath}`,
					en: null,
					xDefault: `${baseUrl}${postCanonicalBlogPath}`
				};
		const commentsPayload = commentsResponse.ok ? await readJson(commentsResponse) : null;
		const commentItems = Array.isArray(commentsPayload?.metadata?.items)
			? commentsPayload.metadata.items
			: [];
		const commentTotal = Number(commentsPayload?.metadata?.total) || commentItems.length;

		return {
			post,
			apiError: '',
			comments: commentItems,
			commentsTotal: commentTotal,
			commentsError: commentsResponse.ok ? '' : translate(lang, 'blogDetail.commentsLoadFailed'),
			canonicalUrl: `${baseUrl}${postCanonicalPath}`,
			hreflang: postHreflang,
			robots,
			seo: { disableDefaults: true }
		};
	} catch {
		return {
			post: null,
			apiError: 'Blog detail request failed',
			comments: [],
			commentsTotal: 0,
			commentsError: '',
			canonicalUrl: `${baseUrl}${canonicalPath}`,
			hreflang,
			robots,
			seo: { disableDefaults: true }
		};
	}
};

export const actions = {
	subscribe: async ({ request, fetch, url, cookies }) => {
		const t = getTranslator(cookies);
		const form = await request.formData();
		const email = String(form.get('email') || '').trim();

		if (!email) {
			return fail(400, { newsletterError: t('blogDetail.newsletterError') });
		}

		let response;
		let payload;
		try {
			const result = await subscribeNewsletter({
				email,
				sourcePage: url?.pathname,
				referrer: request.headers.get('referer'),
				fetch
			});
			response = result.response;
			payload = result.payload;
		} catch {
			return fail(502, { newsletterError: t('blogDetail.newsletterError') });
		}

		if (!response?.ok) {
			const message = payload?.message || t('blogDetail.newsletterError');
			return fail(response?.status || 400, { newsletterError: message });
		}

		return {
			newsletterSuccess: true,
			newsletterMessage: payload?.message || t('blogDetail.newsletterSuccess')
		};
	},
	comment: async ({ request, fetch, params, cookies }) => {
		const t = getTranslator(cookies);
		const form = await request.formData();
		const slug = String(params.slug || '').trim();
		const author = String(form.get('author') || '').trim();
		const email = String(form.get('email') || '').trim();
		const content = String(form.get('content') || '').trim();
		const parentId = String(form.get('parentId') || '').trim();

		if (!slug) {
			return fail(400, { commentError: t('blogDetail.commentMissingSlug') });
		}

		if (!author || !email || !content) {
			return fail(400, { commentError: t('blogDetail.commentMissingFields') });
		}

		const headers = {
			...buildHeaders(),
			'content-type': 'application/json'
		};

		try {
			const response = await fetch(`${API_BASE}/blog/${encodeURIComponent(slug)}/comments`, {
				method: 'POST',
				headers,
				body: JSON.stringify({
					author,
					email,
					content,
					parentId: parentId || undefined
				})
			});
			const payload = await readJson(response);

			if (!response.ok) {
				return fail(response.status, {
					commentError: payload?.message || t('blogDetail.submitFailed')
				});
			}

			return {
				commentSuccess: true,
				commentMessage: payload?.message || t('blogDetail.commentPending')
			};
		} catch {
			return fail(502, { commentError: t('blogDetail.submitFailed') });
		}
	}
};
