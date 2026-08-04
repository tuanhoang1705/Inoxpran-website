import { adminApiFetch } from '$lib/server/adminApi.js';
import {
	createOpenClawRequestId,
	isOpenClawObjectPayload,
	openClawProxyClientError,
	proxyOpenClawRequest
} from '$lib/server/openclawRoadmapProxy.js';
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
	const requestId = createOpenClawRequestId();
	const path = normalizePath(params.segments);
	if (url.search) {
		return openClawProxyClientError({
			status: 400,
			error: 'Runtime control query parameters are not supported',
			requestId
		});
	}
	if (method === 'GET' && path) {
		return openClawProxyClientError({
			status: 404,
			error: 'Unsupported runtime control request',
			requestId
		});
	}
	const controlKey = method === 'PATCH' ? safeRuntimeControlKey(path) : '';
	if (method === 'PATCH' && !controlKey) {
		return openClawProxyClientError({
			status: 404,
			error: 'Unsupported runtime control request',
			requestId
		});
	}

	const options = { method };
	if (method === 'PATCH') {
		const rawBody = await request.text().catch(() => '');
		if (rawBody.length > 4 * 1024) {
			return openClawProxyClientError({
				status: 413,
				error: 'Runtime control request is too large',
				requestId
			});
		}
		let parsed;
		try {
			parsed = JSON.parse(rawBody);
		} catch {
			return openClawProxyClientError({
				status: 400,
				error: 'Malformed JSON request body',
				requestId
			});
		}
		const body = safeRuntimeControlBody(parsed);
		if (!body) {
			return openClawProxyClientError({
				status: 400,
				error: 'Invalid runtime control request body',
				requestId
			});
		}
		const idempotencyKey = safeRuntimeControlIdempotencyKey(request.headers.get('idempotency-key'));
		if (!idempotencyKey) {
			return openClawProxyClientError({
				status: 400,
				error: 'A valid Idempotency-Key is required',
				requestId
			});
		}
		options.headers = {
			'content-type': 'application/json',
			'Idempotency-Key': idempotencyKey
		};
		options.body = JSON.stringify(body);
	}

	const suffix = controlKey ? `/${controlKey}` : '';
	return proxyOpenClawRequest({
		cookies,
		fetch,
		path: `/admin/openclaw/runtime-controls${suffix}`,
		options,
		validatePayload: isOpenClawObjectPayload,
		fallbackError: 'OpenClaw runtime control request failed',
		requestId,
		adminFetch: adminApiFetch
	});
};

export const GET = (event) => proxy({ ...event, method: 'GET' });
export const PATCH = (event) => proxy({ ...event, method: 'PATCH' });
