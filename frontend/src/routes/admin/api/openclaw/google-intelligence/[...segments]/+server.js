import { adminApiFetch } from '$lib/server/adminApi.js';
import {
	createOpenClawRequestId,
	isOpenClawObjectPayload,
	openClawProxyClientError,
	proxyOpenClawRequest
} from '$lib/server/openclawRoadmapProxy.js';
import {
	matchesOpenClawProxyPath,
	normalizeOpenClawProxyPath
} from '$lib/server/openclawProxyPath.js';

const ID = '[A-Za-z0-9_-]{1,128}';
const ALLOWED = Object.freeze({
	GET: [
		/^status$/,
		/^snapshots$/,
		new RegExp(`^snapshots/${ID}$`),
		/^sources$/,
		/^schedule$/,
		/^executions$/,
		/^related-blogs$/
	],
	POST: [
		new RegExp(`^snapshots/${ID}/override$`),
		/^run-now$/,
		/^sources$/,
		new RegExp(`^sources/${ID}/run-now$`),
		/^schedule\/(?:enable|disable)$/
	],
	PATCH: [new RegExp(`^sources/${ID}$`), /^schedule$/]
});

const proxy = async ({ request, cookies, fetch, params, url, method }) => {
	const requestId = createOpenClawRequestId();
	const suffix = normalizeOpenClawProxyPath(params.segments);
	if (suffix === null || !matchesOpenClawProxyPath({ method, path: suffix, contracts: ALLOWED })) {
		return openClawProxyClientError({
			status: 404,
			error: 'Unsupported Google Intelligence request',
			requestId
		});
	}
	const options = { method };
	if (!['GET', 'HEAD'].includes(method)) {
		options.headers = { 'content-type': 'application/json' };
		options.body = JSON.stringify(await request.json().catch(() => ({})));
	}
	return proxyOpenClawRequest({
		cookies,
		fetch,
		path: `/admin/openclaw/google-intelligence/${suffix}${url.search || ''}`,
		options,
		validatePayload: isOpenClawObjectPayload,
		fallbackError: 'Google Intelligence request failed',
		requestId,
		adminFetch: adminApiFetch
	});
};

export const GET = (event) => proxy({ ...event, method: 'GET' });
export const POST = (event) => proxy({ ...event, method: 'POST' });
export const PATCH = (event) => proxy({ ...event, method: 'PATCH' });
