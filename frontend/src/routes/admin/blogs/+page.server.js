import { fail, redirect } from '@sveltejs/kit';
import { API_BASE } from '$lib/server/api.js';
import { getTranslator } from '$lib/i18n/admin/server.js';
import { buildAdminHeaders, getAdminSession } from '$lib/server/adminAuth.js';
import { setAdminToast } from '$lib/server/adminToast.js';

const parsePayload = async (response) => {
	try {
		return await response.json();
	} catch {
		return null;
	}
};

const loadBlogs = async ({ fetch, headers, url }) => {
	const page = Math.max(Number(url.searchParams.get('page') || '1'), 1);
	const params = new URLSearchParams();
	params.set('page', String(page));
	params.set('limit', '20');

	const status = String(url.searchParams.get('status') || 'all').trim();
	const q = String(url.searchParams.get('q') || '').trim();
	const category = String(url.searchParams.get('category') || '').trim();

	if (status && status !== 'all') params.set('status', status);
	if (q) params.set('q', q);
	if (category && category !== 'all') params.set('category', category);

	const response = await fetch(`${API_BASE}/blog/admin/all?${params.toString()}`, {
		headers
	});
	const payload = await parsePayload(response);

	return {
		response,
		payload,
		filters: {
			page,
			status: status || 'all',
			q,
			category: category || 'all'
		}
	};
};

export const load = async ({ cookies, fetch, url }) => {
	const session = getAdminSession(cookies);
	const headers = buildAdminHeaders(session);
	const t = getTranslator(cookies);

	try {
		const { response, payload, filters } = await loadBlogs({ fetch, headers, url });
		if (!response.ok) {
			return {
				items: [],
				pagination: null,
				filters,
				apiError: t('admin.blogs.errors.load')
			};
		}

		const metadata = payload?.metadata || {};
		return {
			items: Array.isArray(metadata.items) ? metadata.items : [],
			pagination: {
				page: Number(metadata.page) || filters.page,
				limit: Number(metadata.limit) || 20,
				total: Number(metadata.total) || 0
			},
			filters,
			apiError: null
		};
	} catch {
		return {
			items: [],
			pagination: null,
			filters: {
				page: 1,
				status: String(url.searchParams.get('status') || 'all').trim() || 'all',
				q: String(url.searchParams.get('q') || '').trim(),
				category: String(url.searchParams.get('category') || 'all').trim() || 'all'
			},
			apiError: t('admin.blogs.errors.load')
		};
	}
};

const runStatusAction = async ({ fetch, headers, id, endpoint, t, cookies, message }) => {
	if (!id) {
		const errorMessage = t('admin.blogs.errors.missingId');
		return fail(400, { error: errorMessage, toast: { tone: 'error', message: errorMessage } });
	}

	const response = await fetch(`${API_BASE}/blog/${endpoint}/${id}`, {
		method: 'POST',
		headers
	});
	if (!response.ok) {
		const errorMessage =
			endpoint === 'publish'
				? t('admin.blogs.errors.publishFailed')
				: t('admin.blogs.errors.unpublishFailed');
		return fail(response.status, {
			error: errorMessage,
			toast: { tone: 'error', message: errorMessage }
		});
	}

	setAdminToast(cookies, {
		tone: 'success',
		message
	});
	throw redirect(303, '/admin/blogs');
};

export const actions = {
	publish: async ({ request, cookies, fetch }) => {
		const session = getAdminSession(cookies);
		const headers = buildAdminHeaders(session);
		const form = await request.formData();
		const t = getTranslator(cookies);
		const blogId = String(form.get('blog_id') || '').trim();
		return runStatusAction({
			fetch,
			headers,
			id: blogId,
			endpoint: 'publish',
			t,
			cookies,
			message: t('admin.blogs.success.published')
		});
	},
	unpublish: async ({ request, cookies, fetch }) => {
		const session = getAdminSession(cookies);
		const headers = buildAdminHeaders(session);
		const form = await request.formData();
		const t = getTranslator(cookies);
		const blogId = String(form.get('blog_id') || '').trim();
		return runStatusAction({
			fetch,
			headers,
			id: blogId,
			endpoint: 'unpublish',
			t,
			cookies,
			message: t('admin.blogs.success.unpublished')
		});
	}
};
