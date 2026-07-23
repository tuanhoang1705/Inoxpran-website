import { json } from '@sveltejs/kit';
import { adminApiFetch } from '$lib/server/adminApi.js';
import { sanitizeOpenClawClientPayload } from '$lib/server/openclawClientPayload.js';

const ALLOWED_POST_OPERATIONS = new Set(['enable', 'disable', 'run-now']);
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,128}$/;

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
		return json(
			{ error: payload?.message || 'Unable to load executions' },
			{ status: response.status }
		);
	}
	return json(sanitizeOpenClawClientPayload(payload?.metadata || {}));
};

export const POST = async ({ request, cookies, fetch, params }) => {
	if (!ALLOWED_POST_OPERATIONS.has(params.operation)) {
		return json({ error: 'Unsupported operation' }, { status: 404 });
	}
	const options = { method: 'POST' };
	if (params.operation === 'run-now') {
		const idempotencyKey = String(request.headers.get('idempotency-key') || '').trim();
		if (!IDEMPOTENCY_KEY.test(idempotencyKey)) {
			return json({ error: 'A valid Idempotency-Key is required' }, { status: 400 });
		}
		options.headers = { 'Idempotency-Key': idempotencyKey };
	}
	const response = await adminApiFetch({
		cookies,
		fetch,
		path: `/admin/openclaw/blog-schedules/${encodeURIComponent(params.scheduleId)}/${params.operation}`,
		options
	});
	const payload = await response.json().catch(() => null);
	if (!response.ok) {
		return json(
			{ error: payload?.message || 'Unable to run schedule operation' },
			{ status: response.status }
		);
	}
	return json(sanitizeOpenClawClientPayload(payload?.metadata || {}));
};
