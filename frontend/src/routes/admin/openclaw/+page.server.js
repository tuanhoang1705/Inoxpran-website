import { redirect } from '@sveltejs/kit';

// The OpenClaw AI console is no longer a standalone product. The primary
// Blog OpenClaw surface is the simple scheduling page; the console lives on
// inside BOS at /admin/openclaw/blogs/settings/console.
export const load = () => {
	redirect(301, '/admin/openclaw/blogs');
};
