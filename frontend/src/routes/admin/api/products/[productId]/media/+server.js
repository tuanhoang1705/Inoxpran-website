import { json } from '@sveltejs/kit';
import { adminApiFetch } from '$lib/server/adminApi.js';

export const PATCH = async ({ request, cookies, fetch, params }) => {
	const payload = await request.json().catch(() => null);
	if (!payload || typeof payload !== 'object') {
		return json({ error: 'Product media payload is required' }, { status: 400 });
	}

	const response = await adminApiFetch({
		cookies,
		fetch,
		path: `/product/${encodeURIComponent(params.productId)}/media`,
		options: {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(payload)
		}
	});
	const result = await response.json().catch(() => null);
	if (!response.ok) {
		return json(
			{ error: result?.message || 'Unable to sync product media' },
			{ status: response.status }
		);
	}
	return json(result?.metadata || {});
};
