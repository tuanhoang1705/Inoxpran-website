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
	GET: [/^plans$/, new RegExp(`^plans/${ID}$`)]
});

const forward = async ({ request, cookies, fetch, url, params, method }) => {
	const requestId = createOpenClawRequestId();
	const segments = normalizeOpenClawProxyPath(params.segments);
	if (
		segments === null ||
		!matchesOpenClawProxyPath({ method, path: segments, contracts: ALLOWED })
	) {
		return openClawProxyClientError({
			status: 404,
			error: 'Unsupported product placement request',
			requestId
		});
	}
	const options = { method, headers: {} };
	if (['POST', 'PATCH'].includes(method)) {
		options.headers['content-type'] = 'application/json';
		options.body = JSON.stringify(await request.json().catch(() => ({})));
	}
	return proxyOpenClawRequest({
		cookies,
		fetch,
		path: `/admin/openclaw/product-placement/${segments}${url.search || ''}`,
		options,
		validatePayload: isOpenClawObjectPayload,
		fallbackError: 'Product placement request failed',
		requestId,
		adminFetch: adminApiFetch
	});
};

export const GET = (event) => forward({ ...event, method: 'GET' });
export const POST = (event) => forward({ ...event, method: 'POST' });
export const PATCH = (event) => forward({ ...event, method: 'PATCH' });
