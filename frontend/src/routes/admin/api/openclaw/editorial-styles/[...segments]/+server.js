import { json } from '@sveltejs/kit';
import { adminApiFetch } from '$lib/server/adminApi.js';

const proxy = async ({ request, cookies, fetch, params, method }) => {
	const suffix = String(params.segments || '').replace(/^\/+/, '');
	const options = { method };
	if (method !== 'GET') {
		options.headers = { 'content-type': 'application/json' };
		options.body = JSON.stringify(await request.json().catch(() => ({})));
	}
	const response = await adminApiFetch({
		cookies,
		fetch,
		path: `/admin/openclaw/editorial-styles${suffix ? `/${suffix}` : ''}`,
		options
	});
	const payload = await response.json().catch(() => null);
	if (!response.ok) return json({ error: payload?.message || 'Editorial style request failed' }, { status: response.status });
	return json(payload?.metadata || {});
};

export const GET = (event) => proxy({ ...event, method: 'GET' });
export const POST = (event) => proxy({ ...event, method: 'POST' });
export const PATCH = (event) => proxy({ ...event, method: 'PATCH' });
