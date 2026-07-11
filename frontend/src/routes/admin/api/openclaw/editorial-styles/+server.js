import { json } from '@sveltejs/kit';
import { adminApiFetch } from '$lib/server/adminApi.js';

export const GET = async ({ cookies, fetch }) => {
	const response = await adminApiFetch({ cookies, fetch, path: '/admin/openclaw/editorial-styles' });
	const payload = await response.json().catch(() => null);
	if (!response.ok) return json({ error: payload?.message || 'Unable to load editorial styles' }, { status: response.status });
	return json(payload?.metadata || { styles: [], recentProfiles: [] });
};
