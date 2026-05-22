import { json } from '@sveltejs/kit';
import { callChatPersistenceApi } from '$lib/server/chatPersistenceApi.js';

const noStore = { 'cache-control': 'no-store' };

export const GET = async ({ url, fetch, request, cookies }) => {
	const sessionId = String(url.searchParams.get('sessionId') || '').trim();
	const after = String(url.searchParams.get('after') || '').trim();
	const limit = String(url.searchParams.get('limit') || '').trim();
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
		const params = new URLSearchParams({ sessionId });
		if (after) params.set('after', after);
		if (limit) params.set('limit', limit);
		const { response, payload } = await callChatPersistenceApi({
			fetch,
			request,
			cookies,
			path: `/messages?${params.toString()}`,
			method: 'GET'
		});
		if (response.ok && payload?.metadata) {
			return json(
				{
					ok: true,
					metadata: payload.metadata
				},
				{ headers: noStore }
			);
		}
	} catch {
		// fall back to an empty poll response
	}
	return json(
		{
			ok: true,
			metadata: {
				sessionId,
				items: [],
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
