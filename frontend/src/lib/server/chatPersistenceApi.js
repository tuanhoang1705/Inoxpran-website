import { API_BASE, API_KEY_HEADER } from '$lib/server/api.js';
import { getUserSession } from '$lib/server/userAuth.js';

const pickForwardHeaders = (request) => {
	const headers = {};
	const names = ['x-forwarded-for', 'x-real-ip', 'cf-connecting-ip', 'user-agent', 'referer'];
	for (const name of names) {
		const value = request?.headers?.get?.(name);
		if (value) headers[name] = value;
	}
	return headers;
};

const readJson = async (response) => {
	try {
		return await response.json();
	} catch {
		return null;
	}
};

export const callChatPersistenceApi = async ({
	fetch,
	request,
	cookies,
	path,
	method = 'GET',
	body
}) => {
	const userSession = cookies ? getUserSession(cookies) : null;
	const headers = {
		...pickForwardHeaders(request)
	};
	if (API_KEY_HEADER) {
		headers['x-api-key'] = API_KEY_HEADER;
	}

	let payloadBody = undefined;
	if (method !== 'GET') {
		headers['content-type'] = 'application/json';
		if (body && typeof body === 'object' && !Array.isArray(body)) {
			payloadBody = JSON.stringify({
				...body,
				userId: body.userId ?? userSession?.userId ?? null
			});
		} else {
			payloadBody = body;
		}
	}

	const response = await fetch(`${API_BASE}/ai/chat${path}`, {
		method,
		headers,
		body: payloadBody
	});
	const payload = await readJson(response);
	return { response, payload, userSession };
};
