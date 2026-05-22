import { json } from '@sveltejs/kit';
import { callChatPersistenceApi } from '$lib/server/chatPersistenceApi.js';

const noStore = { 'cache-control': 'no-store' };

export const POST = async ({ request, fetch, cookies }) => {
	const body = await request.json().catch(() => ({}));
	const sessionId = String(body?.sessionId || '').trim();
	const state = String(body?.state || '').trim().toLowerCase();

	if (!sessionId || !['active', 'left'].includes(state)) {
		return json(
			{
				ok: false,
				error: 'invalid_payload'
			},
			{ status: 400, headers: noStore }
		);
	}
	try {
		const { response, payload } = await callChatPersistenceApi({
			fetch,
			request,
			cookies,
			path: '/presence',
			method: 'POST',
			body: {
				sessionId,
				visitorId: body?.visitorId || null,
				telemetrySessionId: body?.telemetrySessionId || null,
				locale: body?.locale || null,
				sourcePath: body?.sourcePath || null,
				state
			}
		});
		if (response.ok && payload?.metadata) {
			return json({ ok: true, metadata: payload.metadata }, { headers: noStore });
		}
	} catch {
		// ignore persistence failures; the widget already treats presence as best-effort
	}
	return json({ ok: true, metadata: { sessionId, state } }, { headers: noStore });
};
