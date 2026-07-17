import { json } from '@sveltejs/kit';
import { adminApiFetch } from '$lib/server/adminApi.js';

const forward = async ({ request, cookies, fetch, url, params, method }) => {
	const segments = String(params.segments || '').replace(/^\/+|\/+$/g, '');
	const options = { method, headers: {} };
	if (['POST', 'PATCH'].includes(method)) {
		options.headers['content-type'] = 'application/json';
		options.body = JSON.stringify(await request.json().catch(() => ({})));
	}
	const response = await adminApiFetch({
		cookies,
		fetch,
		path: `/admin/openclaw/product-seeding/${segments}${url.search || ''}`,
		options
	});
	const payload = await response.json().catch(() => null);
	if (!response.ok) return json({ error: payload?.message || 'Product seeding request failed' }, { status: response.status });
	return json(payload?.metadata || {});
};

export const GET = (event) => forward({ ...event, method: 'GET' });
export const POST = (event) => forward({ ...event, method: 'POST' });
export const PATCH = (event) => forward({ ...event, method: 'PATCH' });
