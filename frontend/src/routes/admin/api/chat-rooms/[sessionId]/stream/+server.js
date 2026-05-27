import { API_BASE } from '$lib/server/api.js';
import { buildAdminHeaders, ensureAdminSession } from '$lib/server/adminAuth.js';

const STREAM_HEADERS = {
	'content-type': 'text/event-stream; charset=utf-8',
	'cache-control': 'no-cache, no-transform',
	connection: 'keep-alive',
	'x-accel-buffering': 'no'
};

// Hidden from admin by request.
const ADMIN_CHAT_ROOMS_ENABLED = false;

export const GET = async ({ cookies, fetch, params, request }) => {
	if (!ADMIN_CHAT_ROOMS_ENABLED) {
		return new Response('chat_rooms_disabled', { status: 404 });
	}

	const session = await ensureAdminSession({ cookies, fetch });
	if (!session) {
		return new Response('admin_auth_required', { status: 401 });
	}

	const response = await fetch(`${API_BASE}/admin/chat-rooms/${params.sessionId}/stream`, {
		headers: {
			...buildAdminHeaders(session),
			accept: 'text/event-stream'
		},
		signal: request.signal
	}).catch(() => null);

	if (!response || !response.ok || !response.body) {
		return new Response('chat_room_stream_unavailable', {
			status: response?.status || 503
		});
	}

	return new Response(response.body, {
		status: 200,
		headers: STREAM_HEADERS
	});
};
