import { json } from '@sveltejs/kit';
import { adminApiFetch } from '$lib/server/adminApi.js';

const forward = async ({ cookies, fetch, url, params, method }) => {
	const segments = String(params.segments || '').replace(/^\/+|\/+$/g, '');
	const response = await adminApiFetch({
		cookies,
		fetch,
		path: `/admin/openclaw/product-catalog/${segments}${url.search || ''}`,
		options: { method }
	});
	const payload = await response.json().catch(() => null);
	if (!response.ok) return json({ error: payload?.message || 'Product catalog request failed' }, { status: response.status });
	return json(payload?.metadata || {});
};

export const GET = (event) => forward({ ...event, method: 'GET' });
export const POST = (event) => forward({ ...event, method: 'POST' });
