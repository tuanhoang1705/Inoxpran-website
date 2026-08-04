import { adminApiFetch } from '$lib/server/adminApi.js';
import {
	createOpenClawRequestId,
	isOpenClawObjectPayload,
	openClawProxyClientError,
	proxyOpenClawRequest
} from '$lib/server/openclawRoadmapProxy.js';

export const GET = async ({ url, cookies, fetch }) => {
	const requestId = createOpenClawRequestId();
	if ([...url.searchParams.keys()].length) {
		return openClawProxyClientError({
			status: 400,
			error: 'OpenClaw dashboard query parameters are not supported',
			requestId
		});
	}
	return proxyOpenClawRequest({
		cookies,
		fetch,
		path: '/admin/openclaw',
		validatePayload: isOpenClawObjectPayload,
		fallbackError: 'Unable to load OpenClaw dashboard',
		requestId,
		adminFetch: adminApiFetch
	});
};
