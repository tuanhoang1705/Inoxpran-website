import { json } from '@sveltejs/kit';
import { adminApiFetch } from '$lib/server/adminApi.js';

const ALLOWED_POST_OPERATIONS = new Set(['enable', 'disable', 'run-now']);

export const GET = async ({ cookies, fetch, params, url }) => {
	if (params.operation !== 'executions') {
		return json({ error: 'Unsupported operation' }, { status: 404 });
	}
	const response = await adminApiFetch({
		cookies,
		fetch,
		path: `/admin/openclaw/blog-schedules/${encodeURIComponent(params.scheduleId)}/executions${url.search || ''}`
	});
	const payload = await response.json().catch(() => null);
	if (!response.ok) {
		return json({ error: payload?.message || 'Unable to load executions' }, { status: response.status });
	}
	return json(payload?.metadata || {});
};

export const POST = async ({ cookies, fetch, params }) => {
	if (!ALLOWED_POST_OPERATIONS.has(params.operation)) {
		return json({ error: 'Unsupported operation' }, { status: 404 });
	}
	const response = await adminApiFetch({
		cookies,
		fetch,
		path: `/admin/openclaw/blog-schedules/${encodeURIComponent(params.scheduleId)}/${params.operation}`,
		options: { method: 'POST' }
	});
	const payload = await response.json().catch(() => null);
	if (!response.ok) {
		return json({ error: payload?.message || 'Unable to run schedule operation' }, { status: response.status });
	}
	return json(payload?.metadata || {});
};
