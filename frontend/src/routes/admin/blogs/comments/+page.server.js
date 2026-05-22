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

const loadComments = async ({ fetch, headers, url }) => {
	const page = Math.max(Number(url.searchParams.get('page') || '1'), 1);
	const limit = Math.max(Number(url.searchParams.get('limit') || '20'), 1);
	const status = String(url.searchParams.get('status') || 'all').trim();
	const q = String(url.searchParams.get('q') || '').trim();
	const blogId = String(url.searchParams.get('blogId') || '').trim();

	const params = new URLSearchParams();
	params.set('page', String(page));
	params.set('limit', String(limit));
	if (status && status !== 'all') params.set('status', status);
	if (q) params.set('q', q);
	if (blogId) params.set('blogId', blogId);

	const response = await fetch(`${API_BASE}/blog/admin/comments?${params.toString()}`, {
		headers
	});
	const payload = await parsePayload(response);

	return {
		response,
		payload,
		filters: { page, limit, status: status || 'all', q, blogId }
	};
};

export const load = async ({ cookies, fetch, url }) => {
	const session = getAdminSession(cookies);
	const headers = buildAdminHeaders(session);
	const t = getTranslator(cookies);

	try {
		const { response, payload, filters } = await loadComments({ fetch, headers, url });
		if (!response.ok) {
			return {
				items: [],
				pagination: null,
				filters,
				apiError: t('admin.blogsComments.errors.load')
			};
		}

		const metadata = payload?.metadata || {};
		return {
			items: Array.isArray(metadata.items) ? metadata.items : [],
			pagination: {
				page: Number(metadata.page) || filters.page,
				limit: Number(metadata.limit) || filters.limit,
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
				limit: 20,
				status: String(url.searchParams.get('status') || 'all').trim() || 'all',
				q: String(url.searchParams.get('q') || '').trim(),
				blogId: String(url.searchParams.get('blogId') || '').trim()
			},
			apiError: t('admin.blogsComments.errors.load')
		};
	}
};

const runStatusAction = async ({ fetch, headers, id, status, cookies, message, t }) => {
	if (!id) {
		const errorMessage = t('admin.blogsComments.errors.missingId');
		return fail(400, {
			error: errorMessage,
			toast: { tone: 'error', message: errorMessage }
		});
	}

	const response = await fetch(`${API_BASE}/blog/admin/comments/${id}`, {
		method: 'PATCH',
		headers: { ...headers, 'content-type': 'application/json' },
		body: JSON.stringify({ status })
	});

	if (!response.ok) {
		const errorMessage = t('admin.blogsComments.errors.updateFailed');
		return fail(response.status, {
			error: errorMessage,
			toast: { tone: 'error', message: errorMessage }
		});
	}

	setAdminToast(cookies, {
		tone: 'success',
		message
	});
	throw redirect(303, '/admin/blogs/comments');
};

export const actions = {
	approve: async ({ request, cookies, fetch }) => {
		const session = getAdminSession(cookies);
		const headers = buildAdminHeaders(session);
		const t = getTranslator(cookies);
		const form = await request.formData();
		const commentId = String(form.get('commentId') || '').trim();
		return runStatusAction({
			fetch,
			headers,
			id: commentId,
			status: 'approved',
			cookies,
			message: t('admin.blogsComments.success.approved'),
			t
		});
	},
	reject: async ({ request, cookies, fetch }) => {
		const session = getAdminSession(cookies);
		const headers = buildAdminHeaders(session);
		const t = getTranslator(cookies);
		const form = await request.formData();
		const commentId = String(form.get('commentId') || '').trim();
		return runStatusAction({
			fetch,
			headers,
			id: commentId,
			status: 'rejected',
			cookies,
			message: t('admin.blogsComments.success.rejected'),
			t
		});
	},
	delete: async ({ request, cookies, fetch }) => {
		const session = getAdminSession(cookies);
		const headers = buildAdminHeaders(session);
		const t = getTranslator(cookies);
		const form = await request.formData();
		const commentId = String(form.get('commentId') || '').trim();
		if (!commentId) {
			return fail(400, { error: t('admin.blogsComments.errors.missingId') });
		}

		const response = await fetch(`${API_BASE}/blog/admin/comments/${commentId}`, {
			method: 'DELETE',
			headers
		});

		if (!response.ok) {
			return fail(response.status, { error: t('admin.blogsComments.errors.deleteFailed') });
		}

		setAdminToast(cookies, {
			tone: 'success',
			message: t('admin.blogsComments.success.deleted')
		});
		throw redirect(303, '/admin/blogs/comments');
	}
};
