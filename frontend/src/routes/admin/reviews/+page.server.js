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

const loadReviews = async ({ fetch, headers, url }) => {
	const page = Math.max(Number(url.searchParams.get('page') || '1'), 1);
	const limit = Math.max(Number(url.searchParams.get('limit') || '20'), 1);
	const status = String(url.searchParams.get('status') || 'all').trim();
	const q = String(url.searchParams.get('q') || '').trim();

	const params = new URLSearchParams();
	params.set('page', String(page));
	params.set('limit', String(limit));
	if (status && status !== 'all') params.set('status', status);
	if (q) params.set('q', q);

	const response = await fetch(`${API_BASE}/product/admin/reviews?${params.toString()}`, {
		headers
	});
	const payload = await parsePayload(response);

	return {
		response,
		payload,
		filters: { page, limit, status: status || 'all', q }
	};
};

const loadReviewTargets = async ({ fetch, headers, url }) => {
	const limit = Math.max(Number(url.searchParams.get('targetLimit') || '24'), 1);
	const q = String(url.searchParams.get('targetQ') || '').trim();
	const params = new URLSearchParams();
	params.set('limit', String(limit));
	if (q) params.set('q', q);

	const response = await fetch(`${API_BASE}/product/admin/reviews/targets?${params.toString()}`, {
		headers
	});
	const payload = await parsePayload(response);

	return {
		response,
		payload,
		filters: { limit, q }
	};
};

export const load = async ({ cookies, fetch, url }) => {
	const session = getAdminSession(cookies);
	const headers = buildAdminHeaders(session);
	const t = getTranslator(cookies);

	try {
		const [{ response, payload, filters }, targetResult] = await Promise.all([
			loadReviews({ fetch, headers, url }),
			loadReviewTargets({ fetch, headers, url }).catch(() => ({
				response: { ok: false },
				payload: null,
				filters: { limit: 24, q: '' }
			}))
		]);
		if (!response.ok) {
			return {
				items: [],
				pagination: null,
				filters,
				targets: Array.isArray(targetResult?.payload?.metadata) ? targetResult.payload.metadata : [],
				targetFilters: targetResult?.filters ?? { limit: 24, q: '' },
				apiError: t('admin.productReviews.errors.load')
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
			targets: Array.isArray(targetResult?.payload?.metadata) ? targetResult.payload.metadata : [],
			targetFilters: targetResult?.filters ?? { limit: 24, q: '' },
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
				q: String(url.searchParams.get('q') || '').trim()
			},
			targets: [],
			targetFilters: {
				limit: Math.max(Number(url.searchParams.get('targetLimit') || '24'), 1),
				q: String(url.searchParams.get('targetQ') || '').trim()
			},
			apiError: t('admin.productReviews.errors.load')
		};
	}
};

const runStatusAction = async ({ fetch, headers, reviewId, status, cookies, message, t }) => {
	if (!reviewId) {
		const errorMessage = t('admin.productReviews.errors.missingId');
		return fail(400, {
			error: errorMessage,
			toast: { tone: 'error', message: errorMessage }
		});
	}

	const response = await fetch(`${API_BASE}/product/admin/reviews/${reviewId}/status`, {
		method: 'PATCH',
		headers: { ...headers, 'content-type': 'application/json' },
		body: JSON.stringify({ status })
	});

	if (!response.ok) {
		const errorMessage = t('admin.productReviews.errors.updateFailed');
		return fail(response.status, {
			error: errorMessage,
			toast: { tone: 'error', message: errorMessage }
		});
	}

	setAdminToast(cookies, {
		tone: 'success',
		message
	});
	throw redirect(303, '/admin/reviews');
};

export const actions = {
	create: async ({ request, cookies, fetch }) => {
		const session = getAdminSession(cookies);
		const headers = buildAdminHeaders(session);
		const t = getTranslator(cookies);
		const form = await request.formData();
		const manualDraft = {
			productLookup: String(form.get('productLookup') || '').trim(),
			authorName: String(form.get('authorName') || '').trim(),
			authorEmail: String(form.get('authorEmail') || '').trim(),
			rating: String(form.get('rating') || '').trim(),
			title: String(form.get('title') || '').trim(),
			content: String(form.get('content') || '').trim(),
			status: String(form.get('status') || 'approved').trim() || 'approved',
			submittedAt: String(form.get('submittedAt') || '').trim(),
			verifiedPurchase: form.get('verifiedPurchase') ? 'true' : 'false'
		};

		if (!manualDraft.productLookup || !manualDraft.authorName || !manualDraft.rating || !manualDraft.content) {
			const message = t('admin.productReviews.errors.createMissingRequired');
			return fail(400, {
				createError: message,
				manualDraft,
				toast: { tone: 'error', message }
			});
		}

		const response = await fetch(`${API_BASE}/product/admin/reviews`, {
			method: 'POST',
			headers: { ...headers, 'content-type': 'application/json' },
			body: JSON.stringify({
				productLookup: manualDraft.productLookup,
				authorName: manualDraft.authorName,
				authorEmail: manualDraft.authorEmail,
				rating: manualDraft.rating,
				title: manualDraft.title,
				content: manualDraft.content,
				status: manualDraft.status,
				submittedAt: manualDraft.submittedAt,
				verifiedPurchase: manualDraft.verifiedPurchase === 'true'
			})
		});
		const payload = await parsePayload(response);

		if (!response.ok) {
			const message =
				String(payload?.message || payload?.error || '').trim() ||
				t('admin.productReviews.errors.createFailed');
			return fail(response.status, {
				createError: message,
				manualDraft,
				toast: { tone: 'error', message }
			});
		}

		setAdminToast(cookies, {
			tone: 'success',
			message: t('admin.productReviews.success.created')
		});
		throw redirect(303, '/admin/reviews');
	},
	approve: async ({ request, cookies, fetch }) => {
		const session = getAdminSession(cookies);
		const headers = buildAdminHeaders(session);
		const t = getTranslator(cookies);
		const form = await request.formData();
		const reviewId = String(form.get('reviewId') || '').trim();
		return runStatusAction({
			fetch,
			headers,
			reviewId,
			status: 'approved',
			cookies,
			message: t('admin.productReviews.success.approved'),
			t
		});
	},
	reject: async ({ request, cookies, fetch }) => {
		const session = getAdminSession(cookies);
		const headers = buildAdminHeaders(session);
		const t = getTranslator(cookies);
		const form = await request.formData();
		const reviewId = String(form.get('reviewId') || '').trim();
		return runStatusAction({
			fetch,
			headers,
			reviewId,
			status: 'rejected',
			cookies,
			message: t('admin.productReviews.success.rejected'),
			t
		});
	},
	delete: async ({ request, cookies, fetch }) => {
		const session = getAdminSession(cookies);
		const headers = buildAdminHeaders(session);
		const t = getTranslator(cookies);
		const form = await request.formData();
		const reviewId = String(form.get('reviewId') || '').trim();
		if (!reviewId) {
			return fail(400, { error: t('admin.productReviews.errors.missingId') });
		}

		const response = await fetch(`${API_BASE}/product/admin/reviews/${reviewId}`, {
			method: 'DELETE',
			headers
		});

		if (!response.ok) {
			return fail(response.status, { error: t('admin.productReviews.errors.deleteFailed') });
		}

		setAdminToast(cookies, {
			tone: 'success',
			message: t('admin.productReviews.success.deleted')
		});
		throw redirect(303, '/admin/reviews');
	}
};
