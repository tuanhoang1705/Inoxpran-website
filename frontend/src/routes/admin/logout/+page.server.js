import { redirect } from '@sveltejs/kit';
import { API_BASE } from '$lib/server/api.js';
import { getTranslator } from '$lib/i18n/admin/server.js';
import { buildAdminHeaders, clearAdminCookies, getAdminSession } from '$lib/server/adminAuth.js';
import { setAdminToast } from '$lib/server/adminToast.js';

export const load = async ({ cookies, fetch }) => {
	const session = getAdminSession(cookies);
	const t = getTranslator(cookies);
	if (session) {
		try {
			const headers = buildAdminHeaders(session);
			if (session.refreshToken) headers['x-rtoken-id'] = session.refreshToken;
			await fetch(`${API_BASE}/admin/logout`, {
				method: 'POST',
				headers
			});
		} catch {
			// ignore logout errors
		}
	}

	clearAdminCookies(cookies);
	setAdminToast(cookies, {
		tone: 'success',
		message: t('admin.auth.success.loggedOut')
	});
	throw redirect(303, '/admin/login');
};
