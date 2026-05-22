import { fail, redirect } from '@sveltejs/kit';
import { API_BASE, API_KEY_HEADER } from '$lib/server/api.js';
import { getTranslator } from '$lib/i18n/admin/server.js';
import { setAdminCookies } from '$lib/server/adminAuth.js';
import { setAdminToast } from '$lib/server/adminToast.js';

export const actions = {
	default: async ({ request, cookies, fetch }) => {
		const form = await request.formData();
		const email = String(form.get('email') || '').trim();
		const password = String(form.get('password') || '');
		const t = getTranslator(cookies);

		if (!email || !password) {
			const message = t('admin.auth.errors.missingCredentials');
			return fail(400, { error: message, toast: { tone: 'error', message } });
		}

		const headers = {
			'content-type': 'application/json'
		};
		if (API_KEY_HEADER) headers['x-api-key'] = API_KEY_HEADER;

		const response = await fetch(`${API_BASE}/admin/login`, {
			method: 'POST',
			headers,
			body: JSON.stringify({ email, password })
		});

		if (!response.ok) {
			let message = t('admin.auth.errors.loginFailed');
			try {
				const payload = await response.json();
				if (payload?.message) {
					message = t('admin.auth.errors.loginFailedWithReason', { reason: payload.message });
				}
			} catch {
				// ignore parse errors
			}
			return fail(response.status, { error: message, toast: { tone: 'error', message } });
		}

		const payload = await response.json();
		const admin = payload?.metadata?.admin;
		const tokens = payload?.metadata?.tokens;

		if (!setAdminCookies(cookies, { admin, tokens })) {
			const message = t('admin.auth.errors.sessionInitFailed');
			return fail(500, { error: message, toast: { tone: 'error', message } });
		}

		setAdminToast(cookies, {
			tone: 'success',
			message: t('admin.auth.success.login')
		});
		throw redirect(303, '/admin');
	}
};
