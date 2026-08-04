import { adminApiFetch } from '$lib/server/adminApi.js';
import {
	createOpenClawRequestId,
	isOpenClawObjectPayload,
	proxyOpenClawRequest
} from '$lib/server/openclawRoadmapProxy.js';

export const GET = async ({ cookies, fetch }) => {
	const requestId = createOpenClawRequestId();
	return proxyOpenClawRequest({
		cookies,
		fetch,
		path: '/admin/openclaw/editorial-styles',
		validatePayload: isOpenClawObjectPayload,
		fallbackError: 'Unable to load editorial styles',
		requestId,
		adminFetch: adminApiFetch
	});
};
