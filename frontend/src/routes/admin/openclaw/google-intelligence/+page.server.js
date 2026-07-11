import { adminApiFetch } from '$lib/server/adminApi.js';

const get = async ({ cookies, fetch, path, fallback }) => {
	const response = await adminApiFetch({ cookies, fetch, path });
	const payload = await response.json().catch(() => null);
	return response.ok ? payload?.metadata || fallback : fallback;
};

export const load = async ({ cookies, fetch }) => {
	const [status, sources, snapshots, schedule, executions, relatedBlogs, styles] = await Promise.all([
		get({ cookies, fetch, path: '/admin/openclaw/google-intelligence/status', fallback: null }),
		get({ cookies, fetch, path: '/admin/openclaw/google-intelligence/sources', fallback: { sources: [] } }),
		get({ cookies, fetch, path: '/admin/openclaw/google-intelligence/snapshots?limit=20', fallback: { snapshots: [] } }),
		get({ cookies, fetch, path: '/admin/openclaw/google-intelligence/schedule', fallback: null }),
		get({ cookies, fetch, path: '/admin/openclaw/google-intelligence/executions?limit=30', fallback: { executions: [] } }),
		get({ cookies, fetch, path: '/admin/openclaw/google-intelligence/related-blogs?limit=30', fallback: { blogs: [] } }),
		get({ cookies, fetch, path: '/admin/openclaw/editorial-styles', fallback: { styles: [], recentProfiles: [] } })
	]);
	return {
		status,
		sources: sources.sources || [],
		snapshots: snapshots.snapshots || [],
		schedule,
		executions: executions.executions || [],
		relatedBlogs: relatedBlogs.blogs || [],
		styles: styles.styles || [],
		recentProfiles: styles.recentProfiles || [],
		loadError: status ? '' : 'Unable to load Google Intelligence status'
	};
};
