import { redirect } from '@sveltejs/kit';

// The Content Operations Center is consolidated into BOS.
export const load = () => {
	redirect(301, '/admin/openclaw/blogs/settings/operations');
};
