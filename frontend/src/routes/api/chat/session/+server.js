import { json } from '@sveltejs/kit';
import { callChatPersistenceApi } from '$lib/server/chatPersistenceApi.js';

const noStore = { 'cache-control': 'no-store' };
const createSessionId = () =>
	`chat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

export const POST = async ({ request, fetch, cookies }) => {
	const body = await request.json().catch(() => ({}));
	try {
		const { response, payload } = await callChatPersistenceApi({
			fetch,
			request,
			cookies,
			path: '/session',
			method: 'POST',
			body: {
				sessionId: body?.sessionId || null,
				visitorId: body?.visitorId || null,
				telemetrySessionId: body?.telemetrySessionId || null,
				locale: body?.locale || null,
				sourcePath: body?.sourcePath || null
			}
		});
		if (response.ok && payload?.metadata?.sessionId) {
			return json(
				{
					ok: true,
					metadata: payload.metadata
				},
				{ headers: noStore }
			);
		}
	} catch {
		// fall through to a local session id so the widget keeps working
	}

	return json(
		{
			ok: true,
			metadata: {
				sessionId: String(body?.sessionId || '').trim() || createSessionId(),
				visitorId: body?.visitorId || null,
				telemetrySessionId: body?.telemetrySessionId || null,
				locale: body?.locale || null,
				sourcePath: body?.sourcePath || null,
				status: 'open',
				liveSupport: {
					active: false,
					typing: {
						active: false,
						until: null
					}
				},
				customerPresence: {
					state: 'active'
				}
			}
		},
		{ headers: noStore }
	);
};
