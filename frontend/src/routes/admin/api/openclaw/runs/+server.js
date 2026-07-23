import { json } from '@sveltejs/kit';
import { adminApiFetch } from '$lib/server/adminApi.js';
import { sanitizeOpenClawClientPayload } from '$lib/server/openclawClientPayload.js';

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,128}$/;

const exactRunBody = (body) => {
	if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
	const keys = Object.keys(body).sort();
	if (keys.length !== 2 || keys[0] !== 'action' || keys[1] !== 'profile') return null;
	if (typeof body.action !== 'string' || typeof body.profile !== 'string') return null;
	return body;
};

export const GET = async ({ url, cookies, fetch }) => {
	if ([...url.searchParams.keys()].length) {
		return json({ error: 'OpenClaw run query parameters are not supported' }, { status: 400 });
	}
	const response = await adminApiFetch({
		cookies,
		fetch,
		path: '/admin/openclaw/runs'
	});
	const payload = await response.json().catch(() => null);
	if (!response.ok) {
		return json(
			{ error: payload?.message || 'Unable to load OpenClaw runs' },
			{ status: response.status }
		);
	}
	return json(sanitizeOpenClawClientPayload(payload?.metadata || { runs: [] }));
};

export const POST = async ({ request, url, cookies, fetch }) => {
	if ([...url.searchParams.keys()].length) {
		return json({ error: 'OpenClaw run query parameters are not supported' }, { status: 400 });
	}
	const body = await request.json().catch(() => ({}));
	const safeBody = exactRunBody(body);
	if (!safeBody) {
		return json(
			{ error: 'OpenClaw run body must contain exactly string action and profile' },
			{ status: 400 }
		);
	}
	const idempotencyKey = String(request.headers.get('idempotency-key') || '').trim();
	if (!IDEMPOTENCY_KEY.test(idempotencyKey)) {
		return json({ error: 'A valid Idempotency-Key is required' }, { status: 400 });
	}
	const response = await adminApiFetch({
		cookies,
		fetch,
		path: '/admin/openclaw/runs',
		options: {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'Idempotency-Key': idempotencyKey
			},
			body: JSON.stringify({
				action: safeBody.action,
				profile: safeBody.profile
			})
		}
	});
	const payload = await response.json().catch(() => null);
	if (!response.ok) {
		return json(
			{ error: payload?.message || 'Unable to start OpenClaw run' },
			{ status: response.status }
		);
	}
	return json(sanitizeOpenClawClientPayload(payload?.metadata || {}));
};
