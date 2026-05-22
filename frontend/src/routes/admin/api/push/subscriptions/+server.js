import { json } from '@sveltejs/kit';
import { API_BASE } from '$lib/server/api.js';
import { buildAdminHeaders, ensureAdminSession } from '$lib/server/adminAuth.js';

const noStore = { 'cache-control': 'no-store' };

const readJson = async (response) => {
	try {
		return await response.json();
	} catch {
		return null;
	}
};

const readBody = async (request) => {
	try {
		return await request.json();
	} catch {
		return {};
	}
};

const proxyRequest = async ({ cookies, fetch, request, method }) => {
	const session = await ensureAdminSession({ cookies, fetch });
	if (!session) {
		return json({ ok: false, error: 'admin_auth_required' }, { status: 401, headers: noStore });
	}

	const body = await readBody(request);
	const response = await fetch(`${API_BASE}/admin/push/subscriptions`, {
		method,
		headers: {
			...buildAdminHeaders(session),
			'content-type': 'application/json',
			accept: 'application/json',
			'user-agent': request.headers.get('user-agent') || ''
		},
		body: JSON.stringify(body)
	}).catch(() => null);

	if (!response) {
		return json(
			{ ok: false, error: 'push_subscription_unavailable' },
			{ status: 503, headers: noStore }
		);
	}

	const payload = await readJson(response);
	if (!response.ok) {
		return json(
			{ ok: false, error: payload?.message || 'push_subscription_failed' },
			{ status: response.status || 502, headers: noStore }
		);
	}

	return json(payload || { ok: true }, { headers: noStore });
};

export const POST = async (event) => proxyRequest({ ...event, method: 'POST' });
export const DELETE = async (event) => proxyRequest({ ...event, method: 'DELETE' });
