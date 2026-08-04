import { adminApiFetch } from '$lib/server/adminApi.js';
import {
	createOpenClawRequestId,
	isOpenClawObjectPayload,
	openClawProxyClientError,
	proxyOpenClawRequest
} from '$lib/server/openclawRoadmapProxy.js';
import {
	matchesOpenClawProxyPath,
	normalizeOpenClawProxyPath
} from '$lib/server/openclawProxyPath.js';

const ID = '[A-Za-z0-9_-]{1,128}';
const ALLOWED = Object.freeze({
	POST: [/^generate-today$/],
	PATCH: [new RegExp(`^${ID}$`)]
});

const proxy = async ({ request, cookies, fetch, params, method }) => {
	const requestId = createOpenClawRequestId();
	const suffix = normalizeOpenClawProxyPath(params.segments);
	if (suffix === null || !matchesOpenClawProxyPath({ method, path: suffix, contracts: ALLOWED })) {
		return openClawProxyClientError({
			status: 404,
			error: 'Unsupported editorial style request',
			requestId
		});
	}
	const options = { method };
	if (method !== 'GET') {
		options.headers = { 'content-type': 'application/json' };
		options.body = JSON.stringify(await request.json().catch(() => ({})));
	}
	return proxyOpenClawRequest({
		cookies,
		fetch,
		path: `/admin/openclaw/editorial-styles${suffix ? `/${suffix}` : ''}`,
		options,
		validatePayload: isOpenClawObjectPayload,
		fallbackError: 'Editorial style request failed',
		requestId,
		adminFetch: adminApiFetch
	});
};

export const GET = (event) => proxy({ ...event, method: 'GET' });
export const POST = (event) => proxy({ ...event, method: 'POST' });
export const PATCH = (event) => proxy({ ...event, method: 'PATCH' });
