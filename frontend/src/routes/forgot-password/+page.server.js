import { fail } from '@sveltejs/kit';
import { API_BASE, API_KEY_HEADER } from '$lib/server/api.js';
import { getLocaleFromCookies, getTranslator } from '$lib/i18n/server.js';
import { translateAuthApiMessage } from '$lib/server/authApiMessage.js';

export const actions = {
	default: async ({ request, fetch, cookies }) => {
		const form = await request.formData();
		const email = String(form.get('email') || '').trim();
		const t = getTranslator(cookies);
		const locale = getLocaleFromCookies(cookies);

		if (!email) {
			return fail(400, { error: t('auth.errors.emailRequired') });
		}

		const headers = { 'content-type': 'application/json' };
		if (API_KEY_HEADER) headers['x-api-key'] = API_KEY_HEADER;

		const response = await fetch(`${API_BASE}/user/forgot-password`, {
			method: 'POST',
			headers,
			body: JSON.stringify({ email, locale })
		});

		if (!response.ok) {
			let message = t('auth.errors.resetRequestFailed');
			try {
				const payload = await response.json();
				if (payload?.message) {
					message = t('auth.errors.resetRequestFailedWithReason', {
						reason: translateAuthApiMessage({ message: payload.message, locale, t })
					});
				}
			} catch {
				// ignore parse errors
			}
			return fail(response.status, { error: message });
		}

		const payload = await response.json();
		const metadata = payload?.metadata || {};

		return {
			success: true,
			message:
				translateAuthApiMessage({ message: metadata.message || payload?.message, locale, t }) ||
				t('auth.success.resetRequested')
		};
	}
};
