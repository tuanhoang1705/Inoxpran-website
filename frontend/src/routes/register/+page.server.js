import { fail } from '@sveltejs/kit';
import { API_BASE, API_KEY_HEADER } from '$lib/server/api.js';
import { getLocaleFromCookies, getTranslator } from '$lib/i18n/server.js';
import { translateAuthApiMessage } from '$lib/server/authApiMessage.js';

const pickForwardHeaders = (request) => {
	const headers = {};
	for (const name of ['x-forwarded-for', 'x-real-ip', 'cf-connecting-ip', 'user-agent']) {
		const value = request.headers.get(name);
		if (value) headers[name] = value;
	}
	return headers;
};

export const actions = {
	default: async ({ request, fetch, cookies, getClientAddress }) => {
		const form = await request.formData();
		const name = String(form.get('name') || '').trim();
		const email = String(form.get('email') || '').trim();
		const phone = String(form.get('phone') || '').trim();
		const password = String(form.get('password') || '');
		const confirmPassword = String(form.get('confirmPassword') || '');
		const telemetrySessionId = String(form.get('telemetrySessionId') || '').trim();
		const telemetryConsentAnalytics =
			String(form.get('telemetryConsentAnalytics') || '').trim() === '1';
		const t = getTranslator(cookies);
		const locale = getLocaleFromCookies(cookies);

		if (!name || !email || !password) {
			return fail(400, { error: t('auth.errors.registerMissingFields') });
		}

		if (password !== confirmPassword) {
			return fail(400, { error: t('auth.errors.passwordMismatch') });
		}

		const headers = {
			'content-type': 'application/json',
			...pickForwardHeaders(request)
		};
		if (!headers['x-forwarded-for']) {
			try {
				const clientAddress = getClientAddress?.();
				if (clientAddress) headers['x-forwarded-for'] = clientAddress;
			} catch {
				// ignore
			}
		}
		if (API_KEY_HEADER) headers['x-api-key'] = API_KEY_HEADER;

		const response = await fetch(`${API_BASE}/user/signup`, {
			method: 'POST',
			headers,
			body: JSON.stringify({
				name,
				email,
				phone,
				password,
				locale,
				telemetrySessionId: telemetrySessionId || null,
				telemetryConsentAnalytics
			})
		});

		if (!response.ok) {
			let message = t('auth.errors.registerFailed');
			try {
				const payload = await response.json();
				if (payload?.message) {
					message = t('auth.errors.registerFailedWithReason', {
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
			email,
			emailSent: metadata.emailSent ?? false,
			message:
				translateAuthApiMessage({ message: metadata.message || payload?.message, locale, t }) ||
				t('auth.success.registered')
		};
	}
};
