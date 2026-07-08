import { json } from '@sveltejs/kit';
import { adminApiFetch } from '$lib/server/adminApi.js';

export const GET = async ({ params, cookies, fetch }) => {
	const runId = encodeURIComponent(params.runId || '');
	const response = await adminApiFetch({
		cookies,
		fetch,
		path: `/admin/openclaw/runs/${runId}`
	});
	const payload = await response.json().catch(() => null);
	if (!response.ok) {
		return json({ error: payload?.message || 'Unable to load OpenClaw run' }, { status: response.status });
	}
	return json(payload?.metadata || {});
};
