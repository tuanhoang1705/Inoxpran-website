import { json } from '@sveltejs/kit';
import { adminApiFetch } from '$lib/server/adminApi.js';

const ID = '[A-Za-z0-9_-]{1,128}';
const ALLOWED = Object.freeze({
	GET: [
		/^status$/,
		/^snapshots(?:\/[A-Za-z0-9_-]{1,128})?$/,
		/^opportunities(?:\/[A-Za-z0-9_-]{1,128})?$/,
		/^work-orders(?:\/[A-Za-z0-9_-]{1,128})?$/,
		/^signals(?:\/[A-Za-z0-9_-]{1,128})?$/,
		/^inventory$/,
		new RegExp(`^performance/${ID}$`),
		new RegExp(`^learning/${ID}$`),
		/^schedule$/
	],
	POST: [
		/^run-now$/,
		/^preview$/,
		new RegExp(`^opportunities/${ID}/(accept|dismiss|convert)$`),
		/^work-orders$/,
		new RegExp(`^work-orders/${ID}/approve$`),
		new RegExp(`^work-orders/${ID}/run$`),
		/^signals$/,
		/^inventory\/rebuild$/,
		/^schedule\/(enable|disable)$/
	],
	PATCH: [
		new RegExp(`^opportunities/${ID}$`),
		new RegExp(`^work-orders/${ID}$`),
		new RegExp(`^signals/${ID}$`),
		/^schedule$/
	]
});

const MAX_BODY_CHARACTERS = 64 * 1024;
const SAFE_ERROR_CODE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/;
const SAFE_ERROR_FIELD = /^[A-Za-z][A-Za-z0-9_.-]{0,119}$/;

const normalizeSegments = (value) =>
	String(value || '')
		.split('/')
		.map((segment) => segment.trim())
		.filter(Boolean)
		.join('/');

const isAllowed = (method, path) => (ALLOWED[method] || []).some((pattern) => pattern.test(path));

const safeBackendError = (payload, httpStatus) => {
	const numericStatus = Number.isInteger(httpStatus) ? httpStatus : 500;
	const result = {
		error:
			numericStatus >= 500
				? 'Internal Server Error'
				: String(payload?.message || 'Content Operations request failed').slice(0, 500)
	};
	if (Number.isInteger(payload?.code) && payload.code >= 400 && payload.code <= 599) {
		result.code = payload.code;
	} else if (SAFE_ERROR_CODE.test(String(payload?.code || ''))) {
		result.code = String(payload.code);
	}
	if (SAFE_ERROR_CODE.test(String(payload?.errorCode || ''))) {
		result.errorCode = String(payload.errorCode);
	}
	if (SAFE_ERROR_FIELD.test(String(payload?.field || ''))) {
		result.field = String(payload.field);
	}
	return result;
};

const proxy = async ({ request, cookies, fetch, params, url, method }) => {
	const path = normalizeSegments(params.segments);
	if (!path || path.includes('..') || !isAllowed(method, path)) {
		return json({ error: 'Unsupported Content Operations request' }, { status: 404 });
	}

	const options = { method };
	if (!['GET', 'HEAD'].includes(method)) {
		let rawBody;
		try {
			rawBody = await request.text();
		} catch {
			return json(
				{ error: 'Unable to read JSON request body', code: 'INVALID_JSON' },
				{ status: 400 }
			);
		}
		if (rawBody.length > MAX_BODY_CHARACTERS) {
			return json({ error: 'Content Operations request is too large' }, { status: 413 });
		}
		let body = {};
		if (rawBody.trim()) {
			try {
				body = JSON.parse(rawBody);
			} catch {
				return json(
					{ error: 'Malformed JSON request body', code: 'INVALID_JSON' },
					{ status: 400 }
				);
			}
		}
		const serialized = JSON.stringify(body || {});
		options.headers = { 'content-type': 'application/json' };
		options.body = serialized;
	}

	const response = await adminApiFetch({
		cookies,
		fetch,
		path: `/admin/openclaw/content-operations/${path}${url.search || ''}`,
		options
	});
	const payload = await response.json().catch(() => null);
	if (!response.ok) {
		return json(safeBackendError(payload, response.status), { status: response.status });
	}
	return json(payload?.metadata ?? payload ?? {});
};

export const GET = (event) => proxy({ ...event, method: 'GET' });
export const POST = (event) => proxy({ ...event, method: 'POST' });
export const PATCH = (event) => proxy({ ...event, method: 'PATCH' });
