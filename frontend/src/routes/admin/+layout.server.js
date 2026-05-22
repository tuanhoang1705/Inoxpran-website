import { redirect } from '@sveltejs/kit';
import { getAdminSession } from '$lib/server/adminAuth.js';
import { consumeAdminToast } from '$lib/server/adminToast.js';

export const load = ({ cookies, url, locals }) => {
	const session = locals?.admin ?? getAdminSession(cookies);
	const isAuthRoute =
		url.pathname === '/admin/login' || url.pathname.startsWith('/admin/register');
	const toast = consumeAdminToast(cookies);

	if (!session && !isAuthRoute) {
		throw redirect(303, '/admin/login');
	}

	return {
		admin: session
			? {
					userId: session.userId,
					name: session.name,
					email: session.email,
					roles: session.roles
				}
			: null,
		isAuthRoute,
		toast
	};
};
