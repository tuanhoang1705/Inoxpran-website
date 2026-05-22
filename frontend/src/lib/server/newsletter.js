import { API_BASE, API_KEY_HEADER } from '$lib/server/api.js';

const buildHeaders = () => {
	const headers = { 'content-type': 'application/json' };
	if (API_KEY_HEADER) {
		headers['x-api-key'] = API_KEY_HEADER;
	}
	return headers;
};

export const subscribeNewsletter = async ({ email, sourcePage, referrer, fetch }) => {
	const response = await fetch(`${API_BASE}/newsletter/subscribe`, {
		method: 'POST',
		headers: buildHeaders(),
		body: JSON.stringify({ email, sourcePage, referrer })
	});

	let payload = null;
	try {
		payload = await response.json();
	} catch {
		payload = null;
	}

	return { response, payload };
};
