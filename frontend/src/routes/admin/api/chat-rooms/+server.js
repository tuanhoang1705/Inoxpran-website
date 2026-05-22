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

export const GET = async ({ cookies, fetch, url }) => {
	const session = await ensureAdminSession({ cookies, fetch });
	if (!session) {
		return json({ ok: false, error: 'admin_auth_required' }, { status: 401, headers: noStore });
	}

	const query = new URLSearchParams();
	for (const key of ['status', 'q', 'page', 'limit', 'mine', 'unreadOnly']) {
		const value = String(url.searchParams.get(key) || '').trim();
		if (value) query.set(key, value);
	}
	if (!query.get('status')) {
		query.set('status', 'handoff');
	}

	const response = await fetch(`${API_BASE}/admin/chat-rooms?${query.toString()}`, {
		headers: buildAdminHeaders(session)
	}).catch(() => null);

	if (!response) {
		return json({ ok: false, error: 'chat_room_list_unavailable' }, { status: 503, headers: noStore });
	}

	const payload = await readJson(response);
	if (!response.ok) {
		return json(
			{ ok: false, error: payload?.message || 'chat_room_list_failed' },
			{ status: response.status || 502, headers: noStore }
		);
	}

	return json(payload || { ok: true }, { headers: noStore });
};
