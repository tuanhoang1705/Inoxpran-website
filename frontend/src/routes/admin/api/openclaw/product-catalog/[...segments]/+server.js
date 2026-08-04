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

const ALLOWED = Object.freeze({
	GET: [/^status$/],
	POST: [/^rebuild$/]
});

const forward = async ({ cookies, fetch, url, params, method }) => {
	const requestId = createOpenClawRequestId();
	const segments = normalizeOpenClawProxyPath(params.segments);
	if (
		segments === null ||
		!matchesOpenClawProxyPath({ method, path: segments, contracts: ALLOWED })
	) {
		return openClawProxyClientError({
			status: 404,
			error: 'Unsupported product catalog request',
			requestId
		});
	}
	return proxyOpenClawRequest({
		cookies,
		fetch,
		path: `/admin/openclaw/product-catalog/${segments}${url.search || ''}`,
		options: { method },
		validatePayload: isOpenClawObjectPayload,
		fallbackError: 'Product catalog request failed',
		requestId,
		adminFetch: adminApiFetch
	});
};

export const GET = (event) => forward({ ...event, method: 'GET' });
export const POST = (event) => forward({ ...event, method: 'POST' });
