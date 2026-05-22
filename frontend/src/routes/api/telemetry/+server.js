import { json } from '@sveltejs/kit';
import { API_BASE, API_KEY_HEADER } from '$lib/server/api.js';
import { getUserSession } from '$lib/server/userAuth.js';
import { getLocaleFromCookies } from '$lib/i18n/server.js';

const readJson = async (response) => {
	try {
		return await response.json();
	} catch {
		return null;
	}
};

const pickForwardHeaders = (request) => {
	const headers = {};
	const names = ['x-forwarded-for', 'x-real-ip', 'cf-connecting-ip', 'user-agent', 'referer'];
	for (const name of names) {
		const value = request.headers.get(name);
		if (value) headers[name] = value;
	}
	return headers;
};

export const POST = async ({ request, fetch, cookies }) => {
	let body = null;
	try {
		body = await request.json();
	} catch {
		return json({ ok: false, error: 'invalid_json' }, { status: 400 });
	}

	const incomingEvents = Array.isArray(body?.events) ? body.events : body?.event ? [body.event] : [];
	if (!incomingEvents.length) {
		return json({ ok: true, metadata: { accepted: 0 } }, { headers: { 'cache-control': 'no-store' } });
	}

	const session = getUserSession(cookies);
	const locale = getLocaleFromCookies(cookies);
	const payload = {
		sessionId: body?.sessionId || body?.session_id || null,
		events: incomingEvents.slice(0, 25),
		userId: session?.userId || null,
		locale: body?.locale || locale,
		timezoneOffsetMinutes:
			typeof body?.timezoneOffsetMinutes === 'number' ? body.timezoneOffsetMinutes : null
	};

	const headers = {
		'content-type': 'application/json',
		...pickForwardHeaders(request)
	};
	if (API_KEY_HEADER) {
		headers['x-api-key'] = API_KEY_HEADER;
	}

	try {
		const response = await fetch(`${API_BASE}/telemetry/events`, {
			method: 'POST',
			headers,
			body: JSON.stringify(payload)
		});

		const backendPayload = await readJson(response);
		const sessionId = response.headers.get('x-telemetry-session-id') || backendPayload?.metadata?.sessionId || null;
		if (!response.ok) {
			return json(
				{
					ok: false,
					metadata: {
						accepted: 0,
						sessionId
					}
				},
				{
					status: 202,
					headers: { 'cache-control': 'no-store' }
				}
			);
		}

		return json(
			{
				ok: true,
				...(backendPayload || {}),
				metadata: {
					...(backendPayload?.metadata || {}),
					sessionId
				}
			},
			{
				headers: { 'cache-control': 'no-store' }
			}
		);
	} catch {
		return json(
			{
				ok: false,
				metadata: {
					accepted: 0
				}
			},
			{
				status: 202,
				headers: { 'cache-control': 'no-store' }
			}
		);
	}
};
