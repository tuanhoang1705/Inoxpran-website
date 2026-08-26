import { json } from '@sveltejs/kit';
import { API_BASE } from '$lib/server/api.js';
import { buildAdminHeaders, getAdminSession } from '$lib/server/adminAuth.js';
import { normalizeBlogImageError } from '$lib/blogImageError.js';

const OPERATIONS = {
	suggestions: { method: 'GET', backendMethod: 'GET' },
	pexels: { method: 'GET', backendMethod: 'GET' },
	generate: { method: 'POST', backendMethod: 'POST' },
	review: { method: 'PATCH', backendMethod: 'PATCH' },
	replace: { method: 'POST', backendMethod: 'POST' }
};

const parsePayload = async (response) => {
	try {
		return await response.json();
	} catch {
		return null;
	}
};

const forward = async ({ request, cookies, fetch, params, url }, expectedMethod) => {
	const operation = OPERATIONS[params.operation];
	if (!operation || operation.method !== expectedMethod) {
		return json({ errorCode: 'IMAGE_OPERATION_NOT_FOUND', requestId: '' }, { status: 404 });
	}
	const session = getAdminSession(cookies);
	if (!session) {
		return json({ errorCode: 'ADMIN_SESSION_REQUIRED', requestId: '' }, { status: 401 });
	}

	const headers = buildAdminHeaders(session);
	const backendUrl = new URL(
		`${API_BASE}/blog/admin/${encodeURIComponent(params.postId)}/images/${params.operation}`
	);
	let body;
	if (expectedMethod === 'GET') {
		url.searchParams.forEach((value, key) => backendUrl.searchParams.set(key, value));
	} else {
		const contentType = request.headers.get('content-type') || '';
		if (contentType.includes('multipart/form-data')) {
			body = await request.formData();
		} else {
			headers['content-type'] = 'application/json';
			body = JSON.stringify(await request.json());
		}
	}

	let response;
	try {
		response = await fetch(backendUrl, {
			method: operation.backendMethod,
			headers,
			body
		});
	} catch {
		return json({ errorCode: 'IMAGE_BACKEND_UNAVAILABLE', requestId: '' }, { status: 502 });
	}
	const payload = await parsePayload(response);
	if (!response.ok) {
		return json(normalizeBlogImageError(payload, response.headers), { status: response.status });
	}
	return json(payload?.metadata || payload || {});
};

export const GET = (event) => forward(event, 'GET');
export const POST = (event) => forward(event, 'POST');
export const PATCH = (event) => forward(event, 'PATCH');
