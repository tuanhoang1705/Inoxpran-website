import { env } from '$env/dynamic/public';
import { dev } from '$app/environment';
import { ADMIN_BFF_API_KEY_HEADER, API_BASE } from '$lib/server/api.js';
import {
	buildHostOnlyCookieOptions,
	resolveLegacyCookieDomain
} from '$lib/server/cookieSecurity.js';
import {
	coordinateAdminRefresh,
	shouldRefreshAdminSession
} from '$lib/server/adminSessionRefresh.js';
import { readAdminCookie, rememberAdminCookie } from '$lib/server/adminCookieState.js';

const ADMIN_COOKIE = {
	accessToken: 'admin_access_token',
	refreshToken: 'admin_refresh_token',
	clientId: 'admin_client_id',
	name: 'admin_name',
	email: 'admin_email',
	roles: 'admin_roles'
};

const THIRTY_DAYS_SECONDS = 60 * 60 * 24 * 30;

const LEGACY_COOKIE_DOMAIN = resolveLegacyCookieDomain(env.PUBLIC_SITE_URL);
const cookieOptions = buildHostOnlyCookieOptions({
	siteUrl: env.PUBLIC_SITE_URL,
	nodeEnv: dev ? 'development' : 'production',
	maxAge: THIRTY_DAYS_SECONDS
});

const deleteLegacyDomainCookie = (cookies, key) => {
	if (!LEGACY_COOKIE_DOMAIN) return;
	cookies.delete(key, { path: '/', domain: LEGACY_COOKIE_DOMAIN });
};

const setHostOnlyAdminCookie = (cookies, key, value) => {
	deleteLegacyDomainCookie(cookies, key);
	cookies.set(key, value, cookieOptions);
	rememberAdminCookie(cookies, key, value);
};

export const getAdminSession = (cookies) => {
	const accessToken = readAdminCookie(cookies, ADMIN_COOKIE.accessToken);
	const refreshToken = readAdminCookie(cookies, ADMIN_COOKIE.refreshToken);
	const userId = readAdminCookie(cookies, ADMIN_COOKIE.clientId);

	if (!accessToken || !userId) return null;

	const name = readAdminCookie(cookies, ADMIN_COOKIE.name);
	const email = readAdminCookie(cookies, ADMIN_COOKIE.email);
	const rolesRaw = readAdminCookie(cookies, ADMIN_COOKIE.roles);
	let roles = [];

	if (rolesRaw) {
		try {
			roles = JSON.parse(rolesRaw);
		} catch {
			roles = [rolesRaw];
		}
	}

	return {
		userId,
		accessToken,
		refreshToken,
		name,
		email,
		roles
	};
};

export const buildAdminHeaders = (session) => {
	const headers = {};
	if (ADMIN_BFF_API_KEY_HEADER) headers['x-api-key'] = ADMIN_BFF_API_KEY_HEADER;
	if (session?.userId) headers['x-client-id'] = session.userId;
	if (session?.accessToken) headers['authorization'] = session.accessToken;
	return headers;
};

export const setAdminCookies = (cookies, { admin, tokens }) => {
	if (!admin?._id || !tokens?.accessToken || !tokens?.refreshToken) return false;

	setHostOnlyAdminCookie(cookies, ADMIN_COOKIE.clientId, String(admin._id));
	setHostOnlyAdminCookie(cookies, ADMIN_COOKIE.accessToken, tokens.accessToken);
	setHostOnlyAdminCookie(cookies, ADMIN_COOKIE.refreshToken, tokens.refreshToken);
	setHostOnlyAdminCookie(cookies, ADMIN_COOKIE.name, admin.name || '');
	setHostOnlyAdminCookie(cookies, ADMIN_COOKIE.email, admin.email || '');
	setHostOnlyAdminCookie(cookies, ADMIN_COOKIE.roles, JSON.stringify(admin.roles || []));

	return true;
};

export const setAdminTokenCookies = (cookies, tokens) => {
	if (!tokens?.accessToken || !tokens?.refreshToken) return false;
	setHostOnlyAdminCookie(cookies, ADMIN_COOKIE.accessToken, tokens.accessToken);
	setHostOnlyAdminCookie(cookies, ADMIN_COOKIE.refreshToken, tokens.refreshToken);
	return true;
};

export const setAdminProfileCookies = (cookies, admin) => {
	if (!admin?._id) return false;
	setHostOnlyAdminCookie(cookies, ADMIN_COOKIE.clientId, String(admin._id));
	setHostOnlyAdminCookie(cookies, ADMIN_COOKIE.name, admin.name || '');
	setHostOnlyAdminCookie(cookies, ADMIN_COOKIE.email, admin.email || '');
	setHostOnlyAdminCookie(cookies, ADMIN_COOKIE.roles, JSON.stringify(admin.roles || []));
	return true;
};

export const refreshAdminSession = async ({ cookies, fetch }) => {
	const refreshToken = cookies.get(ADMIN_COOKIE.refreshToken);
	const userId = cookies.get(ADMIN_COOKIE.clientId);
	if (!refreshToken || !userId) return null;

	const tokens = await coordinateAdminRefresh({
		userId,
		refreshToken,
		refresh: async () => {
			const headers = {
				'x-client-id': userId,
				'x-rtoken-id': refreshToken
			};
			if (ADMIN_BFF_API_KEY_HEADER) headers['x-api-key'] = ADMIN_BFF_API_KEY_HEADER;

			let response;
			try {
				response = await fetch(`${API_BASE}/admin/refresh-token`, {
					method: 'POST',
					headers
				});
			} catch {
				return null;
			}

			if (!response.ok) return null;
			const payload = await response.json().catch(() => null);
			const refreshedTokens = payload?.metadata?.tokens;
			if (!refreshedTokens?.accessToken || !refreshedTokens?.refreshToken) return null;
			return refreshedTokens;
		}
	});
	if (!tokens?.accessToken || !tokens?.refreshToken) return null;

	setAdminTokenCookies(cookies, tokens);
	return tokens;
};

export const ensureAdminSession = async ({ cookies, fetch }) => {
	let session = getAdminSession(cookies);

	if (!session) {
		await refreshAdminSession({ cookies, fetch });
		session = getAdminSession(cookies);
		if (!session) return null;
	}

	const headers = buildAdminHeaders(session);
	let response;
	try {
		response = await fetch(`${API_BASE}/admin/profile`, { headers });
	} catch {
		return session;
	}

	if (response.ok) {
		const payload = await response.json().catch(() => null);
		const admin = payload?.metadata;
		if (admin?._id) {
			setAdminProfileCookies(cookies, admin);
			return {
				...session,
				userId: String(admin._id),
				name: admin.name || session.name,
				email: admin.email || session.email,
				roles: Array.isArray(admin.roles) ? admin.roles : session.roles
			};
		}
		return session;
	}
	if (!shouldRefreshAdminSession(response.status)) return session;

	await refreshAdminSession({ cookies, fetch });
	session = getAdminSession(cookies);
	if (!session) return null;

	const retryHeaders = buildAdminHeaders(session);
	try {
		const retry = await fetch(`${API_BASE}/admin/profile`, { headers: retryHeaders });
		if (retry.ok) {
			const payload = await retry.json().catch(() => null);
			const admin = payload?.metadata;
			if (admin?._id) {
				setAdminProfileCookies(cookies, admin);
				return {
					...session,
					userId: String(admin._id),
					name: admin.name || session.name,
					email: admin.email || session.email,
					roles: Array.isArray(admin.roles) ? admin.roles : session.roles
				};
			}
			return session;
		}
		if (shouldRefreshAdminSession(retry.status)) return null;
	} catch {
		return session;
	}

	return session;
};

export const clearAdminCookies = (cookies) => {
	Object.values(ADMIN_COOKIE).forEach((key) => {
		cookies.delete(key, { path: '/' });
		deleteLegacyDomainCookie(cookies, key);
		rememberAdminCookie(cookies, key, undefined);
	});
};

export { ADMIN_COOKIE };
