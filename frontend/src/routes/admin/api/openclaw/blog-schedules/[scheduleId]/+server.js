import { json } from '@sveltejs/kit';
import { adminApiFetch } from '$lib/server/adminApi.js';

export const GET = async ({ cookies, fetch, params }) => {
	const response = await adminApiFetch({
		cookies,
		fetch,
		path: `/admin/openclaw/blog-schedules/${encodeURIComponent(params.scheduleId)}`
	});
	const payload = await response.json().catch(() => null);
	if (!response.ok) {
		return json({ error: payload?.message || 'Unable to load blog schedule' }, { status: response.status });
	}
	return json(payload?.metadata || {});
};

export const PATCH = async ({ request, cookies, fetch, params }) => {
	const body = await request.json().catch(() => ({}));
	const response = await adminApiFetch({
		cookies,
		fetch,
		path: `/admin/openclaw/blog-schedules/${encodeURIComponent(params.scheduleId)}`,
		options: {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		}
	});
	const payload = await response.json().catch(() => null);
	if (!response.ok) {
		return json({ error: payload?.message || 'Unable to update blog schedule' }, { status: response.status });
	}
	return json(payload?.metadata || {});
};

export const DELETE = async ({ cookies, fetch, params }) => {
	const response = await adminApiFetch({
		cookies,
		fetch,
		path: `/admin/openclaw/blog-schedules/${encodeURIComponent(params.scheduleId)}`,
		options: { method: 'DELETE' }
	});
	const payload = await response.json().catch(() => null);
	if (!response.ok) {
		return json({ error: payload?.message || 'Unable to delete blog schedule' }, { status: response.status });
	}
	return json(payload?.metadata || {});
};
