import { redirect } from '@sveltejs/kit';

// The Agentic Blog QA room is BOS advanced diagnostics, not a standalone product.
export const load = () => {
	redirect(301, '/admin/openclaw/blogs/settings/operations/qa');
};
