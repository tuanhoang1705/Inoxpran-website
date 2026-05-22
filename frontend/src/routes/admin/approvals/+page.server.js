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

export const load = async ({ cookies, fetch }) => {
	const session = getAdminSession(cookies);
	const headers = buildAdminHeaders(session);
	const t = getTranslator(cookies);

	const response = await fetch(`${API_BASE}/admin/pending-admins`, { headers });
	if (!response.ok) {
		return { pendingAdmins: [], apiError: t('admin.approvals.errors.load') };
	}

	const payload = await parsePayload(response);
	return { pendingAdmins: payload?.metadata || [] };
};

export const actions = {
	approve: async ({ cookies, fetch, request }) => {
		const session = getAdminSession(cookies);
		const headers = buildAdminHeaders(session);
		const form = await request.formData();
		const t = getTranslator(cookies);

		const adminId = String(form.get('adminId') || '').trim();
		const note = String(form.get('note') || '').trim();
		const roles = form
			.getAll('roles')
			.map((value) => String(value || '').trim())
			.filter(Boolean);

		if (!adminId) {
			const message = t('admin.approvals.errors.missingId');
			return fail(400, { error: message, toast: { tone: 'error', message } });
		}

		const response = await fetch(`${API_BASE}/admin/admins/${adminId}/approve`, {
			method: 'POST',
			headers: {
				...headers,
				'content-type': 'application/json'
			},
			body: JSON.stringify({
				note: note || null,
				roles: roles.length ? roles : ['ADMIN']
			})
		});

		if (!response.ok) {
			const payload = await parsePayload(response);
			const message = payload?.message || t('admin.approvals.errors.approveFailed');
			return fail(response.status, { error: message, toast: { tone: 'error', message } });
		}

		setAdminToast(cookies, { tone: 'success', message: t('admin.approvals.success.approved') });
		throw redirect(303, '/admin/approvals');
	},
	reject: async ({ cookies, fetch, request }) => {
		const session = getAdminSession(cookies);
		const headers = buildAdminHeaders(session);
		const form = await request.formData();
		const t = getTranslator(cookies);

		const adminId = String(form.get('adminId') || '').trim();
		const reason = String(form.get('reason') || '').trim();

		if (!adminId) {
			const message = t('admin.approvals.errors.missingId');
			return fail(400, { error: message, toast: { tone: 'error', message } });
		}

		const response = await fetch(`${API_BASE}/admin/admins/${adminId}/reject`, {
			method: 'POST',
			headers: {
				...headers,
				'content-type': 'application/json'
			},
			body: JSON.stringify({ reason: reason || null })
		});

		if (!response.ok) {
			const payload = await parsePayload(response);
			const message = payload?.message || t('admin.approvals.errors.rejectFailed');
			return fail(response.status, { error: message, toast: { tone: 'error', message } });
		}

		setAdminToast(cookies, { tone: 'success', message: t('admin.approvals.success.rejected') });
		throw redirect(303, '/admin/approvals');
	}
};
