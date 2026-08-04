import { adminApiFetch } from '$lib/server/adminApi.js';
import {
	createOpenClawRequestId,
	isOpenClawObjectPayload,
	proxyOpenClawRequest
} from '$lib/server/openclawRoadmapProxy.js';

export const GET = async ({ cookies, fetch, params }) => {
	const requestId = createOpenClawRequestId();
	return proxyOpenClawRequest({
		cookies,
		fetch,
		path: `/admin/openclaw/blog-schedules/${encodeURIComponent(params.scheduleId)}`,
		validatePayload: isOpenClawObjectPayload,
		fallbackError: 'Unable to load blog schedule',
		requestId,
		adminFetch: adminApiFetch
	});
};

export const PATCH = async ({ request, cookies, fetch, params }) => {
	const requestId = createOpenClawRequestId();
	const body = await request.json().catch(() => ({}));
	return proxyOpenClawRequest({
		cookies,
		fetch,
		path: `/admin/openclaw/blog-schedules/${encodeURIComponent(params.scheduleId)}`,
		options: {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		},
		validatePayload: isOpenClawObjectPayload,
		fallbackError: 'Unable to update blog schedule',
		requestId,
		adminFetch: adminApiFetch
	});
};

export const DELETE = async ({ cookies, fetch, params }) => {
	const requestId = createOpenClawRequestId();
	return proxyOpenClawRequest({
		cookies,
		fetch,
		path: `/admin/openclaw/blog-schedules/${encodeURIComponent(params.scheduleId)}`,
		options: { method: 'DELETE' },
		validatePayload: isOpenClawObjectPayload,
		fallbackError: 'Unable to delete blog schedule',
		requestId,
		adminFetch: adminApiFetch
	});
};
