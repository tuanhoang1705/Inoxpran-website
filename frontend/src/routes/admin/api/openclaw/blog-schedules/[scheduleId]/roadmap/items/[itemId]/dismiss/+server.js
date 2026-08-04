import { json } from '@sveltejs/kit';
import { adminApiFetch } from '$lib/server/adminApi.js';
import {
	createOpenClawRequestId,
	isRoadmapPayload,
	proxyOpenClawRoadmapRequest,
	readRoadmapActionBody
} from '$lib/server/openclawRoadmapProxy.js';

export const POST = async ({ request, cookies, fetch, params }) => {
	const requestId = createOpenClawRequestId();
	const forwardedBody = await readRoadmapActionBody(request);
	if (!forwardedBody) {
		return json(
			{
				error: 'Reason must be a string of at most 160 characters',
				errorCode: 'OPENCLAW_INVALID_REQUEST',
				requestId
			},
			{ status: 400 }
		);
	}
	return proxyOpenClawRoadmapRequest({
		cookies,
		fetch,
		path: `/admin/openclaw/blog-schedules/${encodeURIComponent(params.scheduleId)}/roadmap/items/${encodeURIComponent(params.itemId)}/dismiss`,
		options: {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(forwardedBody)
		},
		validatePayload: isRoadmapPayload,
		fallbackError: 'Unable to dismiss roadmap item',
		requestId,
		adminFetch: adminApiFetch
	});
};
