import { json } from '@sveltejs/kit';
import { adminApiFetch } from '$lib/server/adminApi.js';

const proxy = async ({ request, cookies, fetch, params, url, method }) => {
	const suffix = String(params.segments || '').replace(/^\/+/, '');
	const options = { method };
	if (!['GET', 'HEAD'].includes(method)) {
		options.headers = { 'content-type': 'application/json' };
		options.body = JSON.stringify(await request.json().catch(() => ({})));
	}
	const response = await adminApiFetch({
		cookies,
		fetch,
		path: `/admin/openclaw/google-intelligence/${suffix}${url.search || ''}`,
		options
	});
	const payload = await response.json().catch(() => null);
	if (!response.ok) {
		return json({ error: payload?.message || 'Google Intelligence request failed' }, { status: response.status });
	}
	return json(payload?.metadata || {});
};

export const GET = (event) => proxy({ ...event, method: 'GET' });
export const POST = (event) => proxy({ ...event, method: 'POST' });
export const PATCH = (event) => proxy({ ...event, method: 'PATCH' });
