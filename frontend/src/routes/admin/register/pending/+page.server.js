import { redirect } from '@sveltejs/kit';

const PENDING_COOKIE = 'pending_admin_email';

export const load = ({ cookies }) => {
	const pendingEmail = cookies.get(PENDING_COOKIE);
	if (!pendingEmail) {
		throw redirect(303, '/admin/register');
	}

	return {
		pendingEmail
	};
};
