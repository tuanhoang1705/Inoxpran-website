import { redirect } from '@sveltejs/kit';
import { API_KEY_HEADER } from '$lib/server/api.js';

const USER_COOKIE = {
	accessToken: 'user_access_token',
	refreshToken: 'user_refresh_token',
	clientId: 'user_client_id',
	name: 'user_name',
	email: 'user_email',
	roles: 'user_roles',
	avatar: 'user_avatar',
	remember: 'user_remember'
};

const SEVEN_DAYS_SECONDS = 60 * 60 * 24 * 7;

const baseCookieOptions = {
	path: '/',
	httpOnly: true,
	sameSite: 'lax',
	secure: false
};

const buildCookieOptions = (remember) =>
	remember ? { ...baseCookieOptions, maxAge: SEVEN_DAYS_SECONDS } : { ...baseCookieOptions };

const isRememberEnabled = (cookies, remember) => {
	if (typeof remember === 'boolean') return remember;
	return cookies.get(USER_COOKIE.remember) === '1';
};

export const getUserSession = (cookies) => {
	const accessToken = cookies.get(USER_COOKIE.accessToken);
	const refreshToken = cookies.get(USER_COOKIE.refreshToken);
	const userId = cookies.get(USER_COOKIE.clientId);

	if (!accessToken || !userId) return null;

	const name = cookies.get(USER_COOKIE.name);
	const email = cookies.get(USER_COOKIE.email);
	const rolesRaw = cookies.get(USER_COOKIE.roles);
	const avatar = cookies.get(USER_COOKIE.avatar);
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
		roles,
		avatar
	};
};

export const buildUserHeaders = (session) => {
	const headers = {};
	if (API_KEY_HEADER) headers['x-api-key'] = API_KEY_HEADER;
	if (session?.userId) headers['x-client-id'] = session.userId;
	if (session?.accessToken) headers['authorization'] = session.accessToken;
	return headers;
};

export const setUserCookies = (cookies, { user, tokens, remember = false } = {}) => {
	if (!user?._id || !tokens?.accessToken || !tokens?.refreshToken) return false;

	const options = buildCookieOptions(remember);

	cookies.set(USER_COOKIE.clientId, String(user._id), options);
	cookies.set(USER_COOKIE.accessToken, tokens.accessToken, options);
	cookies.set(USER_COOKIE.refreshToken, tokens.refreshToken, options);
	cookies.set(USER_COOKIE.name, user.name || '', options);
	cookies.set(USER_COOKIE.email, user.email || '', options);
	cookies.set(USER_COOKIE.roles, JSON.stringify(user.roles || []), options);
	cookies.set(USER_COOKIE.avatar, user.avatar || '', options);
	if (remember) {
		cookies.set(USER_COOKIE.remember, '1', options);
	} else {
		cookies.delete(USER_COOKIE.remember, { path: '/' });
	}

	return true;
};

export const setUserProfileCookies = (cookies, profile) => {
	if (!profile) return;
	const options = buildCookieOptions(isRememberEnabled(cookies));
	if (typeof profile.name === 'string') cookies.set(USER_COOKIE.name, profile.name, options);
	if (typeof profile.email === 'string') cookies.set(USER_COOKIE.email, profile.email, options);
	if (typeof profile.avatar === 'string') cookies.set(USER_COOKIE.avatar, profile.avatar, options);
};

export const clearUserCookies = (cookies) => {
	Object.values(USER_COOKIE).forEach((key) => cookies.delete(key, { path: '/' }));
};

export const clearSessionAndRedirect = (cookies) => {
	clearUserCookies(cookies);
	throw redirect(303, '/login?notice=session-expired');
};

export { USER_COOKIE };
