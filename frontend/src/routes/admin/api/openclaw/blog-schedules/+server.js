import { adminApiFetch } from '$lib/server/adminApi.js';
import {
	createOpenClawRequestId,
	isOpenClawObjectPayload,
	proxyOpenClawRequest
} from '$lib/server/openclawRoadmapProxy.js';

export const GET = async ({ cookies, fetch, url }) => {
	const requestId = createOpenClawRequestId();
	return proxyOpenClawRequest({
		cookies,
		fetch,
		path: `/admin/openclaw/blog-schedules${url.search || ''}`,
		validatePayload: isOpenClawObjectPayload,
		fallbackError: 'Unable to load blog schedules',
		requestId,
		adminFetch: adminApiFetch
	});
};

export const POST = async ({ request, cookies, fetch }) => {
	const requestId = createOpenClawRequestId();
	const body = await request.json().catch(() => ({}));
	return proxyOpenClawRequest({
		cookies,
		fetch,
		path: '/admin/openclaw/blog-schedules',
		options: {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		},
		validatePayload: isOpenClawObjectPayload,
		fallbackError: 'Unable to create blog schedule',
		requestId,
		adminFetch: adminApiFetch
	});
};
