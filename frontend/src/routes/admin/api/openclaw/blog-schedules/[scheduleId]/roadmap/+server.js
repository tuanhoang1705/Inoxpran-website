import { adminApiFetch } from '$lib/server/adminApi.js';
import { isRoadmapPayload, proxyOpenClawRoadmapRequest } from '$lib/server/openclawRoadmapProxy.js';

export const GET = ({ cookies, fetch, params }) =>
	proxyOpenClawRoadmapRequest({
		cookies,
		fetch,
		path: `/admin/openclaw/blog-schedules/${encodeURIComponent(params.scheduleId)}/roadmap`,
		validatePayload: isRoadmapPayload,
		fallbackError: 'Unable to load topic roadmap',
		adminFetch: adminApiFetch
	});
