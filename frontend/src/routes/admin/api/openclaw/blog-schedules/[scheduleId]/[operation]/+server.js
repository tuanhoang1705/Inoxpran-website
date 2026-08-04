import { json } from '@sveltejs/kit';
import { adminApiFetch } from '$lib/server/adminApi.js';
import {
	isExecutionListPayload,
	isOpenClawOperationPayload,
	createOpenClawRequestId,
	proxyOpenClawRoadmapRequest
} from '$lib/server/openclawRoadmapProxy.js';

// Per-schedule operations. run-now triggers one immediate, draft-only
// execution of that specific schedule through the same audited pipeline;
// it requires an Idempotency-Key so a retry cannot create a duplicate run.
const ALLOWED_POST_OPERATIONS = new Set(['enable', 'disable', 'pause', 'resume', 'run-now']);
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,128}$/;

export const GET = async ({ cookies, fetch, params, url }) => {
	const requestId = createOpenClawRequestId();
	if (params.operation !== 'executions') {
		return json(
			{ error: 'Unsupported operation', errorCode: 'OPENCLAW_INVALID_REQUEST', requestId },
			{ status: 404 }
		);
	}
	return proxyOpenClawRoadmapRequest({
		cookies,
		fetch,
		path: `/admin/openclaw/blog-schedules/${encodeURIComponent(params.scheduleId)}/executions${url.search || ''}`,
		validatePayload: isExecutionListPayload,
		fallbackError: 'Unable to load executions',
		requestId,
		adminFetch: adminApiFetch
	});
};

export const POST = async ({ request, cookies, fetch, params }) => {
	const requestId = createOpenClawRequestId();
	if (!ALLOWED_POST_OPERATIONS.has(params.operation)) {
		return json(
			{ error: 'Unsupported operation', errorCode: 'OPENCLAW_INVALID_REQUEST', requestId },
			{ status: 404 }
		);
	}
	const options = { method: 'POST' };
	if (params.operation === 'run-now') {
		const idempotencyKey = String(request.headers.get('idempotency-key') || '').trim();
		if (!IDEMPOTENCY_KEY.test(idempotencyKey)) {
			return json(
				{
					error: 'A valid Idempotency-Key is required',
					errorCode: 'OPENCLAW_INVALID_REQUEST',
					requestId
				},
				{ status: 400 }
			);
		}
		options.headers = { 'Idempotency-Key': idempotencyKey };
	}
	return proxyOpenClawRoadmapRequest({
		cookies,
		fetch,
		path: `/admin/openclaw/blog-schedules/${encodeURIComponent(params.scheduleId)}/${params.operation}`,
		options,
		validatePayload: isOpenClawOperationPayload,
		fallbackError: 'Unable to run schedule operation',
		requestId,
		adminFetch: adminApiFetch
	});
};
