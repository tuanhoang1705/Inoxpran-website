import { json } from '@sveltejs/kit';
import { API_BASE } from '$lib/server/api.js';
import { buildAdminHeaders, ensureAdminSession } from '$lib/server/adminAuth.js';

const readJson = async (response) => {
	try {
		return await response.json();
	} catch {
		return null;
	}
};

const noStore = { 'cache-control': 'no-store' };

export const GET = async ({ cookies, fetch, params, url }) => {
	const session = await ensureAdminSession({ cookies, fetch });
	if (!session) {
		return json({ ok: false, error: 'admin_auth_required' }, { status: 401, headers: noStore });
	}

	const headers = buildAdminHeaders(session);
	const query = new URLSearchParams();
	const messageLimit = String(url.searchParams.get('messageLimit') || '').trim();
	if (messageLimit) query.set('messageLimit', messageLimit);
	const markRead = String(url.searchParams.get('markRead') || '').trim();
	if (markRead) query.set('markRead', markRead);

	const response = await fetch(
		`${API_BASE}/admin/chat-rooms/${params.sessionId}${query.toString() ? `?${query.toString()}` : ''}`,
		{ headers }
	).catch(() => null);

	if (!response) {
		return json({ ok: false, error: 'chat_room_unavailable' }, { status: 503, headers: noStore });
	}

	const payload = await readJson(response);
	if (!response.ok) {
		return json(
			{ ok: false, error: payload?.message || 'chat_room_failed' },
			{ status: response.status || 502, headers: noStore }
		);
	}

	return json(payload || { ok: true }, { headers: noStore });
};

export const PATCH = async ({ cookies, fetch, params, request }) => {
	const session = await ensureAdminSession({ cookies, fetch });
	if (!session) {
		return json({ ok: false, error: 'admin_auth_required' }, { status: 401, headers: noStore });
	}

	const body = await request.json().catch(() => ({}));
	const response = await fetch(`${API_BASE}/admin/chat-rooms/${params.sessionId}`, {
		method: 'PATCH',
		headers: {
			...buildAdminHeaders(session),
			'content-type': 'application/json'
		},
		body: JSON.stringify(body)
	}).catch(() => null);

	if (!response) {
		return json({ ok: false, error: 'chat_room_update_unavailable' }, { status: 503, headers: noStore });
	}

	const payload = await readJson(response);
	if (!response.ok) {
		return json(
			{ ok: false, error: payload?.message || 'chat_room_update_failed' },
			{ status: response.status || 502, headers: noStore }
		);
	}

	return json(payload || { ok: true }, { headers: noStore });
};

export const DELETE = async ({ cookies, fetch, params }) => {
	const session = await ensureAdminSession({ cookies, fetch });
	if (!session) {
		return json({ ok: false, error: 'admin_auth_required' }, { status: 401, headers: noStore });
	}

	const response = await fetch(`${API_BASE}/admin/chat-rooms/${params.sessionId}`, {
		method: 'DELETE',
		headers: buildAdminHeaders(session)
	}).catch(() => null);

	if (!response) {
		return json({ ok: false, error: 'chat_room_delete_unavailable' }, { status: 503, headers: noStore });
	}

	const payload = await readJson(response);
	if (!response.ok) {
		return json(
			{ ok: false, error: payload?.message || 'chat_room_delete_failed' },
			{ status: response.status || 502, headers: noStore }
		);
	}

	return json(payload || { ok: true }, { headers: noStore });
};
