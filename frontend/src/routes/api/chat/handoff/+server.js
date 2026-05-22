import { json } from '@sveltejs/kit';
import { callChatPersistenceApi } from '$lib/server/chatPersistenceApi.js';

const noStore = { 'cache-control': 'no-store' };

export const POST = async ({ request, fetch, cookies }) => {
	const body = await request.json().catch(() => ({}));
	const sessionId = String(body?.sessionId || '').trim();

	if (!sessionId) {
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
			path: '/handoff',
			method: 'POST',
			body: {
				sessionId,
				visitorId: body?.visitorId || null,
				telemetrySessionId: body?.telemetrySessionId || null,
				locale: body?.locale || null,
				sourcePath: body?.sourcePath || null
			}
		});
		if (response.ok && payload?.metadata?.reply) {
			return json(
				{
					ok: true,
					metadata: payload.metadata
				},
				{ headers: noStore }
			);
		}
	} catch {}

	return json(
		{
			ok: false,
			error: 'chat_handoff_failed'
		},
		{ status: 502, headers: noStore }
	);
};
