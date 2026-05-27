import { fail, redirect } from '@sveltejs/kit';
import { API_BASE } from '$lib/server/api.js';
import { buildAdminHeaders, ensureAdminSession } from '$lib/server/adminAuth.js';

// Hidden from admin by request.
const ADMIN_CHAT_ROOMS_ENABLED = false;

const parsePayload = async (response) => {
	try {
		return await response.json();
	} catch {
		return null;
	}
};

const sanitizeReturnTo = (value, fallback = '/admin/chat-rooms') => {
	const candidate = String(value || '').trim();
	if (!candidate.startsWith('/admin/chat-rooms')) return fallback;
	return candidate;
};

export const load = async ({ cookies, fetch, params, url }) => {
	if (!ADMIN_CHAT_ROOMS_ENABLED) {
		throw redirect(303, '/admin');
	}

	const session = await ensureAdminSession({ cookies, fetch });
	const headers = buildAdminHeaders(session);
	const [roomResponse, consultantsResponse, roomListResponse] = await Promise.all([
		fetch(`${API_BASE}/admin/chat-rooms/${params.sessionId}`, { headers }),
		fetch(`${API_BASE}/admin/live-support/consultants`, { headers }),
		fetch(`${API_BASE}/admin/chat-rooms?limit=48`, { headers })
	]);

	if (!roomResponse.ok) {
		return {
			room: null,
			roomList: [],
			consultants: [],
			returnTo: sanitizeReturnTo(url.searchParams.get('returnTo')),
			apiError: 'Chat room not found.'
		};
	}

	const payload = await parsePayload(roomResponse);
	const consultantsPayload = consultantsResponse.ok ? await parsePayload(consultantsResponse) : null;
	const roomListPayload = roomListResponse.ok ? await parsePayload(roomListResponse) : null;
	const roomList = Array.isArray(roomListPayload?.metadata?.items) ? roomListPayload.metadata.items : [];
	const currentRoom = payload?.metadata || null;
	if (currentRoom?.session?.sessionId && !roomList.some((item) => item?.sessionId === currentRoom.session.sessionId)) {
		roomList.unshift({
			...(currentRoom.session || {}),
			sessionId: currentRoom.session.sessionId,
			latestMessage: Array.isArray(currentRoom.messages) && currentRoom.messages.length
				? {
					role: currentRoom.messages[currentRoom.messages.length - 1]?.role,
					text: currentRoom.messages[currentRoom.messages.length - 1]?.text,
					createdAt: currentRoom.messages[currentRoom.messages.length - 1]?.createdAt
				}
				: null,
			latestLead: currentRoom.latestLead || null,
			unreadCount: Number(currentRoom.summary?.unreadCount || 0),
			sla: currentRoom.sla || null
		});
	}

	return {
		room: currentRoom,
		roomList,
		consultants: Array.isArray(consultantsPayload?.metadata) ? consultantsPayload.metadata : [],
		returnTo: sanitizeReturnTo(url.searchParams.get('returnTo')),
		currentAdmin: session
	};
};

const updateRoom = async ({ cookies, fetch, params, request, payload, returnToOverride }) => {
	if (!ADMIN_CHAT_ROOMS_ENABLED) {
		throw redirect(303, '/admin');
	}

	const session = await ensureAdminSession({ cookies, fetch });
	if (!session) {
		throw redirect(303, '/admin/login');
	}

	const headers = {
		...buildAdminHeaders(session),
		'content-type': 'application/json'
	};
	const response = await fetch(`${API_BASE}/admin/chat-rooms/${params.sessionId}`, {
		method: 'PATCH',
		headers,
		body: JSON.stringify(payload)
	});

	if (!response.ok) {
		const apiError = await parsePayload(response);
		return fail(response.status || 400, {
			error: apiError?.message || 'Không cập nhật được phòng chat.'
		});
	}

	const returnTo = returnToOverride
		? sanitizeReturnTo(returnToOverride)
		: sanitizeReturnTo((await request.formData()).get('returnTo'));
	throw redirect(303, `/admin/chat-rooms/${params.sessionId}?returnTo=${encodeURIComponent(returnTo)}`);
};

export const actions = {
	transferRoom: async ({ cookies, fetch, params, request }) => {
		const form = await request.formData();
		return updateRoom({
			cookies,
			fetch,
			params,
			request,
			returnToOverride: form.get('returnTo'),
			payload: {
				transferToAdminId: String(form.get('targetConsultantAdminId') || '').trim()
			}
		});
	},
	closeRoom: async (event) =>
		updateRoom({
			...event,
			payload: {
				status: 'closed',
				markResolved: true
			}
		}),
	reopenRoom: async (event) =>
		updateRoom({
			...event,
			payload: {
				status: 'handoff',
				reopen: true
			}
		})
};
