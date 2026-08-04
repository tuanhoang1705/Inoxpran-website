import { adminApiFetch } from '$lib/server/adminApi.js';
import {
	createOpenClawRequestId,
	isOpenClawObjectPayload,
	openClawProxyClientError,
	proxyOpenClawRequest
} from '$lib/server/openclawRoadmapProxy.js';

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,128}$/;

const exactRunBody = (body) => {
	if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
	const keys = Object.keys(body).sort();
	if (keys.length !== 2 || keys[0] !== 'action' || keys[1] !== 'profile') return null;
	if (typeof body.action !== 'string' || typeof body.profile !== 'string') return null;
	return body;
};

export const GET = async ({ url, cookies, fetch }) => {
	const requestId = createOpenClawRequestId();
	if ([...url.searchParams.keys()].length) {
		return openClawProxyClientError({
			status: 400,
			error: 'OpenClaw run query parameters are not supported',
			requestId
		});
	}
	return proxyOpenClawRequest({
		cookies,
		fetch,
		path: '/admin/openclaw/runs',
		validatePayload: isOpenClawObjectPayload,
		fallbackError: 'Unable to load OpenClaw runs',
		requestId,
		adminFetch: adminApiFetch
	});
};

export const POST = async ({ request, url, cookies, fetch }) => {
	const requestId = createOpenClawRequestId();
	if ([...url.searchParams.keys()].length) {
		return openClawProxyClientError({
			status: 400,
			error: 'OpenClaw run query parameters are not supported',
			requestId
		});
	}
	const body = await request.json().catch(() => ({}));
	const safeBody = exactRunBody(body);
	if (!safeBody) {
		return openClawProxyClientError({
			status: 400,
			error: 'OpenClaw run body must contain exactly string action and profile',
			requestId
		});
	}
	const idempotencyKey = String(request.headers.get('idempotency-key') || '').trim();
	if (!IDEMPOTENCY_KEY.test(idempotencyKey)) {
		return openClawProxyClientError({
			status: 400,
			error: 'A valid Idempotency-Key is required',
			requestId
		});
	}
	return proxyOpenClawRequest({
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
		},
		validatePayload: isOpenClawObjectPayload,
		fallbackError: 'Unable to start OpenClaw run',
		requestId,
		adminFetch: adminApiFetch
	});
};
