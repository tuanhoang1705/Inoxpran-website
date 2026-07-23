import { json } from '@sveltejs/kit';
import { adminApiFetch } from '$lib/server/adminApi.js';
import {
	sanitizeOpenClawClientPayload,
	sanitizeOpenClawErrorMessage
} from '$lib/server/openclawClientPayload.js';
import { isExactEmptyJsonBody } from '$lib/server/exactEmptyJsonBody.js';

const FEATURE_KEY = '[a-z0-9_]{1,64}';
const ALLOWED = Object.freeze({
	GET: [/^status$/],
	POST: [/^check$/, new RegExp(`^${FEATURE_KEY}/check$`)]
});

const normalizePath = (value) =>
	String(value || '')
		.split('/')
		.map((segment) => segment.trim())
		.filter(Boolean)
		.join('/');

const hasExactEmptyBody = async (request) => {
	const contentLength = request.headers.get('content-length');
	if (Number(contentLength || 0) > 1024) return false;
	return isExactEmptyJsonBody({
		rawBody: await request.text(),
		contentLength
	});
};

const proxy = async ({ params, cookies, fetch, request, url, method }) => {
	const path = normalizePath(params.segments);
	if (!path || !(ALLOWED[method] || []).some((pattern) => pattern.test(path))) {
		return json({ error: 'Unsupported capability health request' }, { status: 404 });
	}
	if (url.search) {
		return json({ error: 'Unsupported capability health query' }, { status: 400 });
	}
	if (method === 'POST' && !(await hasExactEmptyBody(request))) {
		return json({ error: 'Capability health request body must be empty' }, { status: 400 });
	}

	const response = await adminApiFetch({
		cookies,
		fetch,
		path: `/admin/openclaw/capabilities/${path}`,
		options:
			method === 'POST'
				? {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: '{}'
					}
				: undefined
	});
	const payload = await response.json().catch(() => null);
	if (!response.ok) {
		return json(
			{
				error:
					response.status >= 500
						? 'Internal Server Error'
						: sanitizeOpenClawErrorMessage(payload?.message, 'Capability health request failed')
			},
			{ status: response.status }
		);
	}
	return json(sanitizeOpenClawClientPayload(payload?.metadata ?? payload ?? {}));
};

export const GET = (event) => proxy({ ...event, method: 'GET' });
export const POST = (event) => proxy({ ...event, method: 'POST' });
