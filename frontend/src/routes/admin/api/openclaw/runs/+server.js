import { json } from '@sveltejs/kit';
import { adminApiFetch } from '$lib/server/adminApi.js';

export const GET = async ({ cookies, fetch }) => {
	const response = await adminApiFetch({
		cookies,
		fetch,
		path: '/admin/openclaw/runs'
	});
	const payload = await response.json().catch(() => null);
	if (!response.ok) {
		return json({ error: payload?.message || 'Unable to load OpenClaw runs' }, { status: response.status });
	}
	return json(payload?.metadata || { runs: [] });
};

export const POST = async ({ request, cookies, fetch }) => {
	const body = await request.json().catch(() => ({}));
	const response = await adminApiFetch({
		cookies,
		fetch,
		path: '/admin/openclaw/runs',
		options: {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				action: body?.action,
				profile: body?.profile
			})
		}
	});
	const payload = await response.json().catch(() => null);
	if (!response.ok) {
		return json({ error: payload?.message || 'Unable to start OpenClaw run' }, { status: response.status });
	}
	return json(payload?.metadata || {});
};
