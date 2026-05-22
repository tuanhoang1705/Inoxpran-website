import { env } from '$env/dynamic/public';
import { API_BASE, API_KEY_HEADER } from '$lib/server/api.js';

const ADMIN_COOKIE = {
	accessToken: 'admin_access_token',
	refreshToken: 'admin_refresh_token',
	clientId: 'admin_client_id',
	name: 'admin_name',
	email: 'admin_email',
	roles: 'admin_roles'
};

const THIRTY_DAYS_SECONDS = 60 * 60 * 24 * 30;

const resolveCookieDomain = () => {
	const raw = String(env.PUBLIC_SITE_URL || '').trim();
	if (!raw) return undefined;
	try {
		const { hostname } = new URL(raw);
		if (!hostname || hostname === 'localhost' || hostname === '127.0.0.1') return undefined;
		return hostname;
	} catch {
		return undefined;
	}
};

const COOKIE_DOMAIN = resolveCookieDomain();
const COOKIE_SECURE = (() => {
	const raw = String(env.PUBLIC_SITE_URL || '').trim();
	if (!raw) return process.env.NODE_ENV === 'production';
	return raw.startsWith('https://');
})();

const cookieOptions = {
	path: '/',
	httpOnly: true,
	sameSite: 'lax',
	secure: COOKIE_SECURE,
	maxAge: THIRTY_DAYS_SECONDS,
	...(COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {})
};

export const getAdminSession = (cookies) => {
	const accessToken = cookies.get(ADMIN_COOKIE.accessToken);
	const refreshToken = cookies.get(ADMIN_COOKIE.refreshToken);
	const userId = cookies.get(ADMIN_COOKIE.clientId);

	if (!accessToken || !userId) return null;

	const name = cookies.get(ADMIN_COOKIE.name);
	const email = cookies.get(ADMIN_COOKIE.email);
	const rolesRaw = cookies.get(ADMIN_COOKIE.roles);
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
	if (API_KEY_HEADER) headers['x-api-key'] = API_KEY_HEADER;
	if (session?.userId) headers['x-client-id'] = session.userId;
	if (session?.accessToken) headers['authorization'] = session.accessToken;
	return headers;
};

export const setAdminCookies = (cookies, { admin, tokens }) => {
	if (!admin?._id || !tokens?.accessToken || !tokens?.refreshToken) return false;

	cookies.set(ADMIN_COOKIE.clientId, String(admin._id), cookieOptions);
	cookies.set(ADMIN_COOKIE.accessToken, tokens.accessToken, cookieOptions);
	cookies.set(ADMIN_COOKIE.refreshToken, tokens.refreshToken, cookieOptions);
	cookies.set(ADMIN_COOKIE.name, admin.name || '', cookieOptions);
	cookies.set(ADMIN_COOKIE.email, admin.email || '', cookieOptions);
	cookies.set(ADMIN_COOKIE.roles, JSON.stringify(admin.roles || []), cookieOptions);

	return true;
};

export const setAdminTokenCookies = (cookies, tokens) => {
	if (!tokens?.accessToken || !tokens?.refreshToken) return false;
	cookies.set(ADMIN_COOKIE.accessToken, tokens.accessToken, cookieOptions);
	cookies.set(ADMIN_COOKIE.refreshToken, tokens.refreshToken, cookieOptions);
	return true;
};

export const setAdminProfileCookies = (cookies, admin) => {
	if (!admin?._id) return false;
	cookies.set(ADMIN_COOKIE.clientId, String(admin._id), cookieOptions);
	cookies.set(ADMIN_COOKIE.name, admin.name || '', cookieOptions);
	cookies.set(ADMIN_COOKIE.email, admin.email || '', cookieOptions);
	cookies.set(ADMIN_COOKIE.roles, JSON.stringify(admin.roles || []), cookieOptions);
	return true;
};

export const refreshAdminSession = async ({ cookies, fetch }) => {
	const refreshToken = cookies.get(ADMIN_COOKIE.refreshToken);
	const userId = cookies.get(ADMIN_COOKIE.clientId);
	if (!refreshToken || !userId) return null;

	const headers = {
		'x-client-id': userId,
		'x-rtoken-id': refreshToken
	};
	if (API_KEY_HEADER) headers['x-api-key'] = API_KEY_HEADER;

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
	const tokens = payload?.metadata?.tokens;
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
	if (![401, 403].includes(response.status)) return session;

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
		if ([401, 403].includes(retry.status)) return null;
	} catch {
		return session;
	}

	return session;
};

export const clearAdminCookies = (cookies) => {
	const options = { path: '/', ...(COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {}) };
	Object.values(ADMIN_COOKIE).forEach((key) => cookies.delete(key, options));
};

export { ADMIN_COOKIE };
