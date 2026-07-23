import { json } from '@sveltejs/kit';
import { adminApiFetch } from '$lib/server/adminApi.js';
import {
	sanitizeOpenClawClientPayload,
	sanitizeOpenClawErrorMessage
} from '$lib/server/openclawClientPayload.js';
import {
	safeRuntimeControlBody,
	safeRuntimeControlIdempotencyKey,
	safeRuntimeControlKey
} from '$lib/server/openclawRuntimeControlRequest.js';

const normalizePath = (value) =>
	String(value || '')
		.split('/')
		.map((segment) => segment.trim())
		.filter(Boolean)
		.join('/');

const proxy = async ({ params, cookies, fetch, request, url, method }) => {
	const path = normalizePath(params.segments);
	if (url.search) {
		return json({ error: 'Runtime control query parameters are not supported' }, { status: 400 });
	}
	if (method === 'GET' && path) {
		return json({ error: 'Unsupported runtime control request' }, { status: 404 });
	}
	const controlKey = method === 'PATCH' ? safeRuntimeControlKey(path) : '';
	if (method === 'PATCH' && !controlKey) {
		return json({ error: 'Unsupported runtime control request' }, { status: 404 });
	}

	const options = { method };
	if (method === 'PATCH') {
		const rawBody = await request.text().catch(() => '');
		if (rawBody.length > 4 * 1024) {
			return json({ error: 'Runtime control request is too large' }, { status: 413 });
		}
		let parsed;
		try {
			parsed = JSON.parse(rawBody);
		} catch {
			return json({ error: 'Malformed JSON request body' }, { status: 400 });
		}
		const body = safeRuntimeControlBody(parsed);
		if (!body) {
			return json({ error: 'Invalid runtime control request body' }, { status: 400 });
		}
		const idempotencyKey = safeRuntimeControlIdempotencyKey(request.headers.get('idempotency-key'));
		if (!idempotencyKey) {
			return json({ error: 'A valid Idempotency-Key is required' }, { status: 400 });
		}
		options.headers = {
			'content-type': 'application/json',
			'Idempotency-Key': idempotencyKey
		};
		options.body = JSON.stringify(body);
	}

	const suffix = controlKey ? `/${controlKey}` : '';
	const response = await adminApiFetch({
		cookies,
		fetch,
		path: `/admin/openclaw/runtime-controls${suffix}`,
		options
	});
	const payload = await response.json().catch(() => null);
	if (!response.ok) {
		return json(
			{
				error:
					response.status >= 500
						? 'Internal Server Error'
						: sanitizeOpenClawErrorMessage(
								payload?.message,
								'OpenClaw runtime control request failed'
							)
			},
			{ status: response.status }
		);
	}
	return json(sanitizeOpenClawClientPayload(payload?.metadata ?? payload ?? {}));
};

export const GET = (event) => proxy({ ...event, method: 'GET' });
export const PATCH = (event) => proxy({ ...event, method: 'PATCH' });
