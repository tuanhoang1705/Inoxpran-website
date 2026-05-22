import { fail } from '@sveltejs/kit';
import { API_BASE, API_KEY_HEADER } from '$lib/server/api.js';
import { getTranslator } from '$lib/i18n/admin/server.js';

const PENDING_COOKIE = 'pending_admin_email';
const PENDING_COOKIE_MAX_AGE = 60 * 60 * 24;

export const actions = {
	default: async ({ request, cookies, fetch }) => {
		const form = await request.formData();
		const name = String(form.get('name') || '').trim();
		const email = String(form.get('email') || '').trim();
		const phone = String(form.get('phone') || '').trim();
		const password = String(form.get('password') || '');
		const t = getTranslator(cookies);

		if (!name || !email || !password) {
			const message = t('admin.auth.errors.registerMissingFields');
			return fail(400, { error: message, toast: { tone: 'error', message } });
		}

		const headers = {
			'content-type': 'application/json'
		};
		if (API_KEY_HEADER) headers['x-api-key'] = API_KEY_HEADER;

		const response = await fetch(`${API_BASE}/admin/signup`, {
			method: 'POST',
			headers,
			body: JSON.stringify({ name, email, phone, password })
		});

		if (!response.ok) {
			let message = t('admin.auth.errors.registerFailed');
			try {
				const payload = await response.json();
				if (payload?.message) {
					message = t('admin.auth.errors.registerFailedWithReason', { reason: payload.message });
				}
			} catch {
				// ignore parse errors
			}
			return fail(response.status, { error: message, toast: { tone: 'error', message } });
		}

		const payload = await response.json();

		cookies.set(PENDING_COOKIE, email, {
			path: '/admin/register',
			httpOnly: true,
			sameSite: 'lax',
			maxAge: PENDING_COOKIE_MAX_AGE
		});

		return {
			success: true,
			pendingEmail: email,
			toast: {
				tone: 'success',
				message: payload?.message || t('admin.auth.success.registered')
			}
		};
	}
};
