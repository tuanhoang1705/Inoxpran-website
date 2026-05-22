import { fail, redirect } from '@sveltejs/kit';
import { API_BASE, API_KEY_HEADER } from '$lib/server/api.js';
import { getLocaleFromCookies, getTranslator } from '$lib/i18n/server.js';
import { translateAuthApiMessage } from '$lib/server/authApiMessage.js';
import { setUserCookies } from '$lib/server/userAuth.js';

const pickForwardHeaders = (request) => {
	const headers = {};
	for (const name of ['x-forwarded-for', 'x-real-ip', 'cf-connecting-ip', 'user-agent']) {
		const value = request.headers.get(name);
		if (value) headers[name] = value;
	}
	return headers;
};

const resolvePostLoginRedirect = (value) => {
	const raw = String(value || '').trim();
	if (!raw) return '';
	if (!raw.startsWith('/') || raw.startsWith('//')) return '';

	try {
		const parsed = new URL(raw, 'http://localhost');
		const target = `${parsed.pathname}${parsed.search}${parsed.hash}`;
		if (!target) return '';
		if (target === '/login' || target.startsWith('/login?')) return '';
		return target;
	} catch {
		return '';
	}
};

const resolveRedirectFromReferer = (refererValue, origin) => {
	const raw = String(refererValue || '').trim();
	if (!raw || !origin) return '';
	try {
		const refererUrl = new URL(raw);
		if (refererUrl.origin !== origin) return '';
		return resolvePostLoginRedirect(`${refererUrl.pathname}${refererUrl.search}${refererUrl.hash}`);
	} catch {
		return '';
	}
};

const getLoginNetworkErrorReason = (locale) =>
	locale === 'vi' ? 'Không thể kết nối backend API.' : 'Cannot reach backend API.';

export const actions = {
	default: async ({ request, cookies, fetch, url, getClientAddress }) => {
		const form = await request.formData();
		const email = String(form.get('email') || '').trim();
		const password = String(form.get('password') || '');
		const telemetrySessionId = String(form.get('telemetrySessionId') || '').trim();
		const telemetryConsentAnalytics =
			String(form.get('telemetryConsentAnalytics') || '').trim() === '1';
		const rememberValue = form.get('remember');
		const remember = rememberValue === '1' || rememberValue === 'on' || rememberValue === 'true';
		const redirectFromForm = resolvePostLoginRedirect(form.get('redirect'));
		const redirectFromQuery = resolvePostLoginRedirect(url.searchParams.get('redirect'));
		const redirectFromReferer = resolveRedirectFromReferer(
			request.headers.get('referer'),
			url.origin
		);
		const postLoginRedirect =
			redirectFromForm || redirectFromQuery || redirectFromReferer || '/shop';
		const t = getTranslator(cookies);
		const locale = getLocaleFromCookies(cookies);

		if (!email || !password) {
			return fail(400, { error: t('auth.errors.missingCredentials') });
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

		let response;
		try {
			response = await fetch(`${API_BASE}/user/login`, {
				method: 'POST',
				headers,
				body: JSON.stringify({
					email,
					password,
					telemetrySessionId: telemetrySessionId || null,
					telemetryConsentAnalytics
				})
			});
		} catch {
			return fail(503, {
				error: t('auth.errors.loginFailedWithReason', {
					reason: getLoginNetworkErrorReason(locale)
				})
			});
		}

		if (!response.ok) {
			let reason = `HTTP ${response.status}`;
			try {
				const payload = await response.json();
				if (payload?.message) {
					reason = translateAuthApiMessage({ message: payload.message, locale, t });
				}
			} catch {
				// ignore parse errors
			}
			return fail(response.status, {
				error: t('auth.errors.loginFailedWithReason', { reason })
			});
		}

		const payload = await response.json();
		const user = payload?.metadata?.user;
		const tokens = payload?.metadata?.tokens;

		if (!setUserCookies(cookies, { user, tokens, remember })) {
			return fail(500, { error: t('auth.errors.sessionInitFailed') });
		}

		throw redirect(303, postLoginRedirect);
	}
};

