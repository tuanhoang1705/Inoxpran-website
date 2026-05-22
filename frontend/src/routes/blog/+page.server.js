import { fail } from '@sveltejs/kit';
import { API_BASE, API_KEY_HEADER } from '$lib/server/api.js';
import { getTranslator } from '$lib/i18n/server.js';
import { subscribeNewsletter } from '$lib/server/newsletter.js';

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

export const load = async ({ fetch, url }) => {
	const headers = buildHeaders();
	const endpoint = new URL(`${API_BASE}/blog`);
	endpoint.searchParams.set('limit', '200');
	endpoint.searchParams.set('page', '1');
	endpoint.searchParams.set('sort', 'published');

	const category = String(url.searchParams.get('category') || '').trim();
	const tag = String(url.searchParams.get('tag') || '').trim();
	const q = String(url.searchParams.get('q') || '').trim();
	if (category) endpoint.searchParams.set('category', category);
	if (tag) endpoint.searchParams.set('tag', tag);
	if (q) endpoint.searchParams.set('q', q);

	try {
		const response = await fetch(endpoint, { headers });
		if (!response.ok) {
			return {
				blogs: [],
				total: 0,
				categories: [],
				apiError: `Blog request failed: ${response.status}`,
				seo: { disableDefaults: true }
			};
		}

		const payload = await readJson(response);
		const metadata = payload?.metadata || {};
		return {
			blogs: Array.isArray(metadata.items) ? metadata.items : [],
			total: Number(metadata.total || 0),
			categories: Array.isArray(metadata.categories) ? metadata.categories : [],
			apiError: '',
			seo: { disableDefaults: true }
		};
	} catch {
		return {
			blogs: [],
			total: 0,
			categories: [],
			apiError: 'Blog request failed',
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
			return fail(400, { newsletterError: t('blog.newsletterError') });
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
			return fail(502, { newsletterError: t('blog.newsletterError') });
		}

		if (!response?.ok) {
			const message = payload?.message || t('blog.newsletterError');
			return fail(response?.status || 400, { newsletterError: message });
		}

		return {
			newsletterSuccess: true,
			newsletterMessage: payload?.message || t('blog.newsletterSuccess')
		};
	}
};
