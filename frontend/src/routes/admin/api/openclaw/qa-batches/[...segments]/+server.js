import { json } from '@sveltejs/kit';
import { adminApiFetch } from '$lib/server/adminApi.js';
import {
	sanitizeOpenClawClientPayload,
	sanitizeOpenClawErrorMessage
} from '$lib/server/openclawClientPayload.js';
import {
	safeQaCreateBody,
	safeQaEmptyActionBody,
	safeQaResumeBody
} from '$lib/server/agenticBlogQaRequest.js';

const ID = '[A-Za-z0-9_-]{1,128}';
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,128}$/;
const ALLOWED = Object.freeze({
	GET: [/^$/, new RegExp(`^${ID}$`), new RegExp(`^${ID}/reports$`)],
	POST: [
		/^$/,
		new RegExp(`^${ID}/run$`),
		new RegExp(`^${ID}/review$`),
		new RegExp(`^${ID}/remediate$`),
		new RegExp(`^${ID}/remediation/${ID}/resume$`)
	]
});

const normalizePath = (value) => {
	const path = String(value || '');
	if (!path) return '';
	const segments = path.split('/');
	if (segments.some((segment) => !segment || segment !== segment.trim())) return null;
	return segments.join('/');
};

const safeListSearch = (url, path) => {
	const allowedKeys = new Set(['page', 'limit', 'environment']);
	const queryKeys = [...url.searchParams.keys()];
	if (path) return queryKeys.length ? null : '';
	if (queryKeys.some((key) => !allowedKeys.has(key))) return null;
	const search = new URLSearchParams();
	const rawPage = url.searchParams.get('page');
	const rawLimit = url.searchParams.get('limit');
	const page = Number(rawPage);
	const limit = Number(rawLimit);
	const environment = String(url.searchParams.get('environment') || '').trim();
	if (rawPage !== null && (!Number.isInteger(page) || page < 1 || page > 1_000_000)) return null;
	if (rawLimit !== null && (!Number.isInteger(limit) || limit < 1 || limit > 100)) return null;
	if (environment && !['local', 'staging'].includes(environment)) return null;
	if (rawPage !== null) search.set('page', String(page));
	if (rawLimit !== null) search.set('limit', String(limit));
	if (environment) search.set('environment', environment);
	return search.size ? `?${search.toString()}` : '';
};

const proxy = async ({ request, params, cookies, fetch, url, method }) => {
	const path = normalizePath(params.segments);
	if (path === null || !(ALLOWED[method] || []).some((pattern) => pattern.test(path))) {
		return json({ error: 'Unsupported Agentic Blog QA request' }, { status: 404 });
	}
	const safeSearch = method === 'GET' ? safeListSearch(url, path) : url.search ? null : '';
	if (safeSearch === null) {
		return json({ error: 'Unsupported Agentic Blog QA query' }, { status: 400 });
	}

	const options = { method };
	if (method === 'POST') {
		const rawBody = await request.text().catch(() => '');
		if (rawBody.length > 16 * 1024) {
			return json({ error: 'Agentic Blog QA request is too large' }, { status: 413 });
		}
		let body = {};
		if (rawBody.trim()) {
			try {
				body = JSON.parse(rawBody);
			} catch {
				return json({ error: 'Malformed JSON request body' }, { status: 400 });
			}
		}
		options.headers = { 'content-type': 'application/json' };
		const idempotencyKey = String(request.headers.get('idempotency-key') || '').trim();
		if (idempotencyKey && !IDEMPOTENCY_KEY.test(idempotencyKey)) {
			return json({ error: 'Invalid Idempotency-Key' }, { status: 400 });
		}
		if (idempotencyKey) options.headers['Idempotency-Key'] = idempotencyKey;
		const isResume = new RegExp(`^${ID}/remediation/${ID}/resume$`).test(path);
		const forwardedBody = !path
			? safeQaCreateBody(body)
			: isResume
				? safeQaResumeBody(body)
				: safeQaEmptyActionBody(body);
		if (!forwardedBody) {
			return json({ error: 'Invalid Agentic Blog QA request body' }, { status: 400 });
		}
		options.body = JSON.stringify(forwardedBody);
	}

	const suffix = path ? `/${path}` : '';
	const response = await adminApiFetch({
		cookies,
		fetch,
		path: `/admin/openclaw/qa-batches${suffix}${safeSearch}`,
		options
	});
	const payload = await response.json().catch(() => null);
	if (!response.ok) {
		return json(
			{
				error:
					response.status >= 500
						? 'Internal Server Error'
						: sanitizeOpenClawErrorMessage(payload?.message, 'Agentic Blog QA request failed')
			},
			{ status: response.status }
		);
	}
	return json(sanitizeOpenClawClientPayload(payload?.metadata ?? payload ?? {}));
};

export const GET = (event) => proxy({ ...event, method: 'GET' });
export const POST = (event) => proxy({ ...event, method: 'POST' });
