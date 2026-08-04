import { adminApiFetch } from '$lib/server/adminApi.js';
import {
	createOpenClawRequestId,
	isOpenClawObjectPayload,
	openClawProxyClientError,
	proxyOpenClawRequest
} from '$lib/server/openclawRoadmapProxy.js';

export const GET = async ({ params, url, cookies, fetch }) => {
	const requestId = createOpenClawRequestId();
	if ([...url.searchParams.keys()].length) {
		return openClawProxyClientError({
			status: 400,
			error: 'OpenClaw run query parameters are not supported',
			requestId
		});
	}
	const runId = encodeURIComponent(params.runId || '');
	return proxyOpenClawRequest({
		cookies,
		fetch,
		path: `/admin/openclaw/runs/${runId}`,
		validatePayload: isOpenClawObjectPayload,
		fallbackError: 'Unable to load OpenClaw run',
		requestId,
		adminFetch: adminApiFetch
	});
};
