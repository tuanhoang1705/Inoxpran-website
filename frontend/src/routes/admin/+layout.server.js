import { redirect } from '@sveltejs/kit';
import { getAdminSession } from '$lib/server/adminAuth.js';
import { consumeAdminToast } from '$lib/server/adminToast.js';

const ADMIN_SUBDOMAIN = 'admin.inoxpran.com';
const toAdminRoutePath = ({ url, route }) => {
	const routeId = String(route?.id || '');
	if (routeId === '/admin' || routeId.startsWith('/admin/')) return routeId;
	return url.pathname;
};

export const load = ({ cookies, url, locals, route }) => {
	const session = locals?.admin ?? getAdminSession(cookies);
	const adminRoutePath = toAdminRoutePath({ url, route });
	const isAuthRoute =
		adminRoutePath === '/admin/login' || adminRoutePath.startsWith('/admin/register');
	const toast = consumeAdminToast(cookies);

	if (!session && !isAuthRoute) {
		throw redirect(303, url.hostname === ADMIN_SUBDOMAIN ? '/login' : '/admin/login');
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
