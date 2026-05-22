import { fail } from '@sveltejs/kit';
import { API_BASE, API_KEY_HEADER } from '$lib/server/api.js';
import { getLocaleFromCookies, getTranslator } from '$lib/i18n/server.js';
import { translateAuthApiMessage } from '$lib/server/authApiMessage.js';

export const load = ({ url }) => {
	return {
		token: url.searchParams.get('token') || ''
	};
};

export const actions = {
	default: async ({ request, fetch, url, cookies }) => {
		const form = await request.formData();
		const token = String(form.get('token') || url.searchParams.get('token') || '').trim();
		const password = String(form.get('password') || '');
		const confirmPassword = String(form.get('confirmPassword') || '');
		const t = getTranslator(cookies);
		const locale = getLocaleFromCookies(cookies);

		if (!token) {
			return fail(400, { error: t('auth.errors.resetInvalid'), token: '' });
		}

		if (!password) {
			return fail(400, { error: t('auth.errors.newPasswordRequired'), token });
		}

		if (password !== confirmPassword) {
			return fail(400, { error: t('auth.errors.passwordMismatch'), token });
		}

		const headers = { 'content-type': 'application/json' };
		if (API_KEY_HEADER) headers['x-api-key'] = API_KEY_HEADER;

		const response = await fetch(`${API_BASE}/user/reset-password`, {
			method: 'POST',
			headers,
			body: JSON.stringify({ token, password })
		});

		if (!response.ok) {
			let message = t('auth.errors.resetFailed');
			try {
				const payload = await response.json();
				if (payload?.message) {
					message = t('auth.errors.resetFailedWithReason', {
						reason: translateAuthApiMessage({ message: payload.message, locale, t })
					});
				}
			} catch {
				// ignore parse errors
			}
			return fail(response.status, { error: message, token });
		}

		const payload = await response.json();
		return {
			success: true,
			message:
				translateAuthApiMessage({ message: payload?.message, locale, t }) ||
				t('auth.success.resetSuccess'),
			token: ''
		};
	}
};
