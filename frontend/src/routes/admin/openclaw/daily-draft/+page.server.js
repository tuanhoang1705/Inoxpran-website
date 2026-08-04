import { redirect } from '@sveltejs/kit';

// The user-facing "Run Daily Draft Now" surface has been removed. Blog
// production is schedule-based; schedules are managed on the Blog
// Scheduling page and internals live in BOS.
export const load = () => {
	redirect(301, '/admin/openclaw/blogs');
};
