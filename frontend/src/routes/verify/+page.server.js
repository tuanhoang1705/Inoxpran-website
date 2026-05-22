import { API_BASE, API_KEY_HEADER } from '$lib/server/api.js';
import { getLocaleFromCookies, getTranslator } from '$lib/i18n/server.js';
import { translateAuthApiMessage } from '$lib/server/authApiMessage.js';

const buildHeaders = () => {
	const headers = {};
	if (API_KEY_HEADER) headers['x-api-key'] = API_KEY_HEADER;
	return headers;
};

const readMessage = async (response) => {
	try {
		const payload = await response.json();
		return payload?.message || payload?.metadata?.message || '';
	} catch {
		return '';
	}
};

export const load = async ({ fetch, url, cookies }) => {
	const t = getTranslator(cookies);
	const locale = getLocaleFromCookies(cookies);
	const token = url.searchParams.get('token');
	if (!token) {
		return {
			status: 'missing',
			message: t('auth.errors.verifyInvalid')
		};
	}

	const headers = buildHeaders();
	const verifyUrl = new URL(`${API_BASE}/user/verify`);
	verifyUrl.searchParams.set('token', token);

	try {
		const response = await fetch(verifyUrl, { headers });
		if (!response.ok) {
			const rawMessage = await readMessage(response);
			const message =
				translateAuthApiMessage({ message: rawMessage, locale, t }) || t('auth.errors.verifyFailed');
			return { status: 'error', message };
		}

		const rawMessage = await readMessage(response);
		const message =
			translateAuthApiMessage({ message: rawMessage, locale, t }) || t('auth.success.verifySuccess');
		return { status: 'success', message };
	} catch {
		return { status: 'error', message: t('auth.errors.verifyFailed') };
	}
};
