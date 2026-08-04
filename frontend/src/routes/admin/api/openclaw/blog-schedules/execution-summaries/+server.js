import { json } from '@sveltejs/kit';
import { adminApiFetch } from '$lib/server/adminApi.js';
import {
	isExecutionSummariesPayload,
	createOpenClawRequestId,
	proxyOpenClawRoadmapRequest
} from '$lib/server/openclawRoadmapProxy.js';

const SCHEDULE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const ALLOWED_QUERY_KEYS = new Set(['scheduleIds', 'limit']);

export const GET = ({ cookies, fetch, url }) => {
	const requestId = createOpenClawRequestId();
	if ([...url.searchParams.keys()].some((key) => !ALLOWED_QUERY_KEYS.has(key))) {
		return json(
			{ error: 'Unsupported query parameter', errorCode: 'OPENCLAW_INVALID_REQUEST', requestId },
			{ status: 400 }
		);
	}
	const scheduleIds = [
		...new Set(
			String(url.searchParams.get('scheduleIds') || '')
				.split(',')
				.map((value) => value.trim())
				.filter(Boolean)
		)
	];
	const limit = Number(url.searchParams.get('limit') || 1);
	if (
		!scheduleIds.length ||
		scheduleIds.length > 50 ||
		scheduleIds.some((scheduleId) => !SCHEDULE_ID.test(scheduleId)) ||
		!Number.isInteger(limit) ||
		limit < 1 ||
		limit > 5
	) {
		return json(
			{
				error: 'Provide 1-50 valid scheduleIds and a limit from 1 to 5',
				errorCode: 'OPENCLAW_INVALID_REQUEST',
				requestId
			},
			{ status: 400 }
		);
	}

	const query = new URLSearchParams({ scheduleIds: scheduleIds.join(','), limit: String(limit) });
	return proxyOpenClawRoadmapRequest({
		cookies,
		fetch,
		path: `/admin/openclaw/blog-schedules/execution-summaries?${query}`,
		validatePayload: isExecutionSummariesPayload,
		fallbackError: 'Unable to load execution summaries',
		requestId,
		adminFetch: adminApiFetch
	});
};
