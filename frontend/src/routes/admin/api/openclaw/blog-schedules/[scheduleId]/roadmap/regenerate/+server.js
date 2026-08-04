import { json } from '@sveltejs/kit';
import { adminApiFetch } from '$lib/server/adminApi.js';
import {
	ROADMAP_ENQUEUE_TIMEOUT_MS,
	createOpenClawRequestId,
	isRoadmapEnqueuePayload,
	proxyOpenClawRoadmapRequest,
	readRoadmapActionBody,
	safeRoadmapIdempotencyKey
} from '$lib/server/openclawRoadmapProxy.js';

export const POST = async ({ request, cookies, fetch, params }) => {
	const requestId = createOpenClawRequestId();
	const idempotencyKey = safeRoadmapIdempotencyKey(request.headers.get('idempotency-key'));
	if (!idempotencyKey) {
		return json(
			{
				error: 'A valid Idempotency-Key is required',
				errorCode: 'OPENCLAW_INVALID_REQUEST',
				requestId
			},
			{ status: 400 }
		);
	}
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
		path: `/admin/openclaw/blog-schedules/${encodeURIComponent(params.scheduleId)}/roadmap/regenerate`,
		options: {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'Idempotency-Key': idempotencyKey
			},
			body: JSON.stringify(forwardedBody)
		},
		timeoutMs: ROADMAP_ENQUEUE_TIMEOUT_MS,
		validatePayload: isRoadmapEnqueuePayload,
		fallbackError: 'Unable to queue topic roadmap regeneration',
		requestId,
		adminFetch: adminApiFetch
	});
};
