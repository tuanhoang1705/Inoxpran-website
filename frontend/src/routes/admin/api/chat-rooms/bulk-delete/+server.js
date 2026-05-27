import { json } from '@sveltejs/kit';
import { API_BASE } from '$lib/server/api.js';
import { buildAdminHeaders, ensureAdminSession } from '$lib/server/adminAuth.js';

const noStore = { 'cache-control': 'no-store' };

// Hidden from admin by request.
const ADMIN_CHAT_ROOMS_ENABLED = false;

const readJson = async (response) => {
	try {
		return await response.json();
	} catch {
		return null;
	}
};

const isRootAdmin = (session) => Array.isArray(session?.roles) && session.roles.includes('SUPER_ADMIN');

const buildListParams = (filters = {}, page = 1, limit = 200) => {
	const params = new URLSearchParams();
	const status = String(filters?.status || '').trim();
	const q = String(filters?.q || '').trim();
	const mine = Boolean(filters?.mine);
	const unreadOnly = Boolean(filters?.unreadOnly);
	if (status) params.set('status', status);
	if (q) params.set('q', q);
	if (page > 1) params.set('page', String(page));
	params.set('limit', String(limit));
	if (mine) params.set('mine', '1');
	if (unreadOnly) params.set('unreadOnly', '1');
	return params;
};

const fetchAllMatchingSessionIds = async ({ fetch, session, filters }) => {
	const sessionIds = [];
	let page = 1;
	let totalPages = 1;

	do {
		const params = buildListParams(filters, page);
		const response = await fetch(`${API_BASE}/admin/chat-rooms?${params.toString()}`, {
			headers: buildAdminHeaders(session)
		}).catch(() => null);
		if (!response) {
			throw new Error('chat_room_list_unavailable');
		}
		const payload = await readJson(response);
		if (!response.ok) {
			throw new Error(payload?.message || 'chat_room_list_failed');
		}
		const metadata = payload?.metadata || {};
		const items = Array.isArray(metadata?.items) ? metadata.items : [];
		for (const item of items) {
			const sessionId = String(item?.sessionId || '').trim();
			if (sessionId) sessionIds.push(sessionId);
		}
		totalPages = Math.max(1, Number(metadata?.pagination?.totalPages) || 1);
		page += 1;
	} while (page <= totalPages);

	return [...new Set(sessionIds)];
};

export const POST = async ({ cookies, fetch, request }) => {
	if (!ADMIN_CHAT_ROOMS_ENABLED) {
		return json({ ok: false, error: 'chat_rooms_disabled' }, { status: 404, headers: noStore });
	}

	const session = await ensureAdminSession({ cookies, fetch });
	if (!session) {
		return json({ ok: false, error: 'admin_auth_required' }, { status: 401, headers: noStore });
	}
	if (!isRootAdmin(session)) {
		return json({ ok: false, error: 'admin_root_required' }, { status: 403, headers: noStore });
	}

	const body = await request.json().catch(() => ({}));
	let sessionIds = Array.isArray(body?.sessionIds)
		? body.sessionIds.map((value) => String(value || '').trim()).filter(Boolean)
		: [];
	const selectAllMatching = Boolean(body?.selectAllMatching);
	const filters = body?.filters && typeof body.filters === 'object' ? body.filters : {};

	if (selectAllMatching) {
		try {
			sessionIds = await fetchAllMatchingSessionIds({ fetch, session, filters });
		} catch (error) {
			return json(
				{ ok: false, error: error?.message || 'chat_room_list_failed' },
				{ status: 502, headers: noStore }
			);
		}
	}

	if (!sessionIds.length) {
		return json({ ok: false, error: 'missing_session_ids' }, { status: 400, headers: noStore });
	}

	const results = [];
	for (const sessionId of sessionIds) {
		const response = await fetch(`${API_BASE}/admin/chat-rooms/${encodeURIComponent(sessionId)}`, {
			method: 'DELETE',
			headers: buildAdminHeaders(session)
		}).catch(() => null);

		if (!response) {
			results.push({ sessionId, ok: false, error: 'chat_room_delete_unavailable' });
			continue;
		}

		const payload = await readJson(response);
		if (!response.ok) {
			results.push({
				sessionId,
				ok: false,
				error: payload?.message || 'chat_room_delete_failed',
				status: response.status || 502
			});
			continue;
		}

		results.push({ sessionId, ok: true });
	}

	const failed = results.filter((item) => !item.ok);
	return json(
		{
			ok: failed.length === 0,
			results
		},
		{ status: failed.length ? 207 : 200, headers: noStore }
	);
};
