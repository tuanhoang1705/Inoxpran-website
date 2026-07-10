import { json } from '@sveltejs/kit';
import { adminApiFetch } from '$lib/server/adminApi.js';

export const GET = async ({ cookies, fetch, url }) => {
	const response = await adminApiFetch({
		cookies,
		fetch,
		path: `/admin/openclaw/blog-schedules${url.search || ''}`
	});
	const payload = await response.json().catch(() => null);
	if (!response.ok) {
		return json({ error: payload?.message || 'Unable to load blog schedules' }, { status: response.status });
	}
	return json(payload?.metadata || {});
};

export const POST = async ({ request, cookies, fetch }) => {
	const body = await request.json().catch(() => ({}));
	const response = await adminApiFetch({
		cookies,
		fetch,
		path: '/admin/openclaw/blog-schedules',
		options: {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		}
	});
	const payload = await response.json().catch(() => null);
	if (!response.ok) {
		return json({ error: payload?.message || 'Unable to create blog schedule' }, { status: response.status });
	}
	return json(payload?.metadata || {});
};
