import { adminApiFetch } from '$lib/server/adminApi.js';
import {
	createOpenClawRequestId,
	isOpenClawObjectPayload,
	openClawProxyClientError,
	proxyOpenClawRequest
} from '$lib/server/openclawRoadmapProxy.js';
import { isExactEmptyJsonBody } from '$lib/server/exactEmptyJsonBody.js';

const FEATURE_KEY = '[a-z0-9_]{1,64}';
const ALLOWED = Object.freeze({
	GET: [/^status$/],
	POST: [/^check$/, new RegExp(`^${FEATURE_KEY}/check$`)]
});

const normalizePath = (value) =>
	String(value || '')
		.split('/')
		.map((segment) => segment.trim())
		.filter(Boolean)
		.join('/');

const hasExactEmptyBody = async (request) => {
	const contentLength = request.headers.get('content-length');
	if (Number(contentLength || 0) > 1024) return false;
	return isExactEmptyJsonBody({
		rawBody: await request.text(),
		contentLength
	});
};

const proxy = async ({ params, cookies, fetch, request, url, method }) => {
	const requestId = createOpenClawRequestId();
	const path = normalizePath(params.segments);
	if (!path || !(ALLOWED[method] || []).some((pattern) => pattern.test(path))) {
		return openClawProxyClientError({
			status: 404,
			error: 'Unsupported capability health request',
			requestId
		});
	}
	if (url.search) {
		return openClawProxyClientError({
			status: 400,
			error: 'Unsupported capability health query',
			requestId
		});
	}
	if (method === 'POST' && !(await hasExactEmptyBody(request))) {
		return openClawProxyClientError({
			status: 400,
			error: 'Capability health request body must be empty',
			requestId
		});
	}

	return proxyOpenClawRequest({
		cookies,
		fetch,
		path: `/admin/openclaw/capabilities/${path}`,
		options:
			method === 'POST'
				? {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: '{}'
					}
				: undefined,
		validatePayload: isOpenClawObjectPayload,
		fallbackError: 'Capability health request failed',
		requestId,
		adminFetch: adminApiFetch
	});
};

export const GET = (event) => proxy({ ...event, method: 'GET' });
export const POST = (event) => proxy({ ...event, method: 'POST' });
