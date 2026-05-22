import { fail, redirect } from '@sveltejs/kit';
import { API_BASE } from '$lib/server/api.js';
import { getTranslator } from '$lib/i18n/admin/server.js';
import { buildAdminHeaders, getAdminSession } from '$lib/server/adminAuth.js';
import { setAdminToast } from '$lib/server/adminToast.js';

const buildParams = (url) => {
	const params = new URLSearchParams();
	const status = url.searchParams.get('status');
	const q = url.searchParams.get('q');
	const page = url.searchParams.get('page');
	const limit = url.searchParams.get('limit');
	if (status) params.set('status', status);
	if (q) params.set('q', q);
	if (page) params.set('page', page);
	if (limit) params.set('limit', limit);
	return params;
};

const parsePayload = async (response) => {
	try {
		return await response.json();
	} catch {
		return null;
	}
};

const parseJsonIdList = (value) => {
	if (typeof value !== 'string' || !value.trim()) return [];
	try {
		const parsed = JSON.parse(value);
		if (!Array.isArray(parsed)) return [];
		return parsed
			.map((item) => String(item || '').trim())
			.filter(Boolean);
	} catch {
		return [];
	}
};

const sanitizeReturnTo = (value, fallback = '/admin/contacts') => {
	const candidate = String(value || '').trim();
	if (!candidate.startsWith('/admin/contacts')) return fallback;
	return candidate;
};

const buildReturnTo = (url) => {
	const query = url.searchParams.toString();
	return query ? `${url.pathname}?${query}` : url.pathname;
};

export const load = async ({ fetch, cookies, url }) => {
	const session = getAdminSession(cookies);
	const headers = buildAdminHeaders(session);
	const params = buildParams(url);
	const response = await fetch(`${API_BASE}/admin/contacts?${params.toString()}`, { headers });

	if (!response.ok) {
		let apiError = 'Failed to load contacts.';
		try {
			const payload = await response.json();
			if (payload?.message) apiError = payload.message;
		} catch {
			// ignore
		}
		return {
			contacts: [],
			pagination: { page: 1, limit: 20, total: 0 },
			filters: {
				status: url.searchParams.get('status') || '',
				q: url.searchParams.get('q') || ''
			},
			returnTo: buildReturnTo(url),
			apiError
		};
	}

	const data = await response.json();
	const metadata = data?.metadata || {};

	return {
		contacts: metadata.items || [],
		pagination: {
			page: metadata.page || 1,
			limit: metadata.limit || 20,
			total: metadata.total || 0
		},
		filters: {
			status: url.searchParams.get('status') || '',
			q: url.searchParams.get('q') || ''
		},
		returnTo: buildReturnTo(url)
	};
};

export const actions = {
	update: async ({ request, cookies, fetch }) => {
		const session = getAdminSession(cookies);
		const headers = buildAdminHeaders(session);
		const t = getTranslator(cookies);
		const form = await request.formData();
		const contactId = String(form.get('contactId') || '').trim();
		const status = String(form.get('status') || '').trim();
		const internalNote = String(form.get('internalNote') || '').trim();
		const assignToMe = String(form.get('assignToMe') || '') === 'on';

		if (!contactId) {
			const message = t('admin.contacts.errors.missingId');
			return fail(400, { error: message, toast: { tone: 'error', message } });
		}

		const payload = {
			status: status || undefined,
			internalNote: internalNote || undefined,
			assignedTo: assignToMe ? session?.userId : undefined
		};

		const response = await fetch(`${API_BASE}/admin/contacts/${contactId}`, {
			method: 'PATCH',
			headers: {
				...headers,
				'content-type': 'application/json'
			},
			body: JSON.stringify(payload)
		});

		if (!response.ok) {
			let message = t('admin.contacts.errors.updateFailed');
			try {
				const data = await response.json();
				if (data?.message) {
					message = t('admin.contacts.errors.updateFailedWithReason', {
						reason: data.message
					});
				}
			} catch {
				// ignore
			}
			return fail(response.status, { error: message, toast: { tone: 'error', message } });
		}

		return {
			success: true,
			toast: { tone: 'success', message: t('admin.contacts.success.updated') }
		};
	},

	deleteSelected: async ({ request, cookies, fetch }) => {
		const session = getAdminSession(cookies);
		const headers = buildAdminHeaders(session);
		const t = getTranslator(cookies);
		const form = await request.formData();
		const ids = parseJsonIdList(String(form.get('selected_ids') || ''));
		const returnTo = sanitizeReturnTo(form.get('return_to'));

		if (!ids.length) {
			const message = t('admin.contacts.errors.deleteSelectedMissing');
			return fail(400, { error: message, toast: { tone: 'error', message } });
		}

		const response = await fetch(`${API_BASE}/admin/contacts/bulk-delete`, {
			method: 'POST',
			headers: {
				...headers,
				'content-type': 'application/json'
			},
			body: JSON.stringify({ ids, allFiltered: false })
		});

		if (!response.ok) {
			const payload = await parsePayload(response);
			const message = payload?.message || t('admin.contacts.errors.deleteFailed');
			return fail(response.status, { error: message, toast: { tone: 'error', message } });
		}

		setAdminToast(cookies, { tone: 'success', message: t('admin.contacts.success.deletedSelected') });
		throw redirect(303, returnTo);
	},

	deleteAll: async ({ request, cookies, fetch }) => {
		const session = getAdminSession(cookies);
		const headers = buildAdminHeaders(session);
		const t = getTranslator(cookies);
		const form = await request.formData();
		const status = String(form.get('status') || '').trim();
		const q = String(form.get('q') || '').trim();
		const returnTo = sanitizeReturnTo(form.get('return_to'));

		const response = await fetch(`${API_BASE}/admin/contacts/bulk-delete`, {
			method: 'POST',
			headers: {
				...headers,
				'content-type': 'application/json'
			},
			body: JSON.stringify({
				allFiltered: true,
				filters: { status, q }
			})
		});

		if (!response.ok) {
			const payload = await parsePayload(response);
			const message = payload?.message || t('admin.contacts.errors.deleteAllFailed');
			return fail(response.status, { error: message, toast: { tone: 'error', message } });
		}

		setAdminToast(cookies, { tone: 'success', message: t('admin.contacts.success.deletedAll') });
		throw redirect(303, returnTo);
	}
};
