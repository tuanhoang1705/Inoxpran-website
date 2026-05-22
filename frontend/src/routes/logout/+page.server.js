import { redirect } from '@sveltejs/kit';
import { API_BASE } from '$lib/server/api.js';
import { buildUserHeaders, clearUserCookies, getUserSession } from '$lib/server/userAuth.js';

export const load = async ({ cookies, fetch }) => {
	const session = getUserSession(cookies);
	if (session) {
		try {
			const headers = buildUserHeaders(session);
			if (session.refreshToken) headers['x-rtoken-id'] = session.refreshToken;
			await fetch(`${API_BASE}/user/logout`, {
				method: 'POST',
				headers
			});
		} catch {
			// ignore logout errors
		}
	}

	clearUserCookies(cookies);
	throw redirect(303, '/');
};
