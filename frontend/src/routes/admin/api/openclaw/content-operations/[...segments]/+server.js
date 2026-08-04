import { adminApiFetch } from '$lib/server/adminApi.js';
import {
	createOpenClawRequestId,
	isOpenClawObjectPayload,
	openClawProxyClientError,
	proxyOpenClawRequest
} from '$lib/server/openclawRoadmapProxy.js';

const ID = '[A-Za-z0-9_-]{1,128}';
const ALLOWED = Object.freeze({
	GET: [
		/^status$/,
		/^snapshots(?:\/[A-Za-z0-9_-]{1,128})?$/,
		/^opportunities(?:\/[A-Za-z0-9_-]{1,128})?$/,
		/^work-orders(?:\/[A-Za-z0-9_-]{1,128})?$/,
		/^signals(?:\/[A-Za-z0-9_-]{1,128})?$/,
		/^inventory$/,
		new RegExp(`^performance/${ID}$`),
		new RegExp(`^learning/${ID}$`),
		/^schedule$/
	],
	POST: [
		/^run-now$/,
		/^preview$/,
		new RegExp(`^opportunities/${ID}/(accept|dismiss|convert)$`),
		/^work-orders$/,
		new RegExp(`^work-orders/${ID}/approve$`),
		new RegExp(`^work-orders/${ID}/run$`),
		/^signals$/,
		/^inventory\/rebuild$/,
		/^schedule\/(enable|disable)$/
	],
	PATCH: [
		new RegExp(`^opportunities/${ID}$`),
		new RegExp(`^work-orders/${ID}$`),
		new RegExp(`^signals/${ID}$`),
		/^schedule$/
	]
});

const MAX_BODY_CHARACTERS = 64 * 1024;

const normalizeSegments = (value) =>
	String(value || '')
		.split('/')
		.map((segment) => segment.trim())
		.filter(Boolean)
		.join('/');

const isAllowed = (method, path) => (ALLOWED[method] || []).some((pattern) => pattern.test(path));

const proxy = async ({ request, cookies, fetch, params, url, method }) => {
	const requestId = createOpenClawRequestId();
	const path = normalizeSegments(params.segments);
	if (!path || path.includes('..') || !isAllowed(method, path)) {
		return openClawProxyClientError({
			status: 404,
			error: 'Unsupported Content Operations request',
			requestId
		});
	}

	const options = { method };
	if (!['GET', 'HEAD'].includes(method)) {
		let rawBody;
		try {
			rawBody = await request.text();
		} catch {
			return openClawProxyClientError({
				status: 400,
				error: 'Unable to read JSON request body',
				requestId
			});
		}
		if (rawBody.length > MAX_BODY_CHARACTERS) {
			return openClawProxyClientError({
				status: 413,
				error: 'Content Operations request is too large',
				requestId
			});
		}
		let body = {};
		if (rawBody.trim()) {
			try {
				body = JSON.parse(rawBody);
			} catch {
				return openClawProxyClientError({
					status: 400,
					error: 'Malformed JSON request body',
					requestId
				});
			}
		}
		const serialized = JSON.stringify(body || {});
		options.headers = { 'content-type': 'application/json' };
		options.body = serialized;
	}

	return proxyOpenClawRequest({
		cookies,
		fetch,
		path: `/admin/openclaw/content-operations/${path}${url.search || ''}`,
		options,
		validatePayload: isOpenClawObjectPayload,
		fallbackError: 'Content Operations request failed',
		requestId,
		adminFetch: adminApiFetch
	});
};

export const GET = (event) => proxy({ ...event, method: 'GET' });
export const POST = (event) => proxy({ ...event, method: 'POST' });
export const PATCH = (event) => proxy({ ...event, method: 'PATCH' });
