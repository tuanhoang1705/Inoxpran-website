import { json, redirect } from '@sveltejs/kit';
import { API_BASE, API_KEY_HEADER } from '$lib/server/api.js';

const resolveReturnUrl = (candidate, baseUrl) => {
	if (candidate) {
		try {
			return new URL(candidate, baseUrl);
		} catch {
			// ignore and fall back
		}
	}
	return new URL('/', baseUrl);
};

const readJson = async (response) => {
	try {
		return await response.json();
	} catch {
		return null;
	}
};

const wantsJsonResponse = (request) => {
	const accept = String(request.headers.get('accept') || '').toLowerCase();
	const ajaxFlag = String(request.headers.get('x-inoxpran-ajax') || '').trim();
	return accept.includes('application/json') || ajaxFlag === '1';
};

export async function POST({ request, fetch, url }) {
	const form = await request.formData();
	const name = String(form.get('name') || '').trim();
	const contact = String(form.get('contact') || '').trim();
	const message = String(form.get('message') || '').trim();
	const returnTo = String(form.get('returnTo') || '').trim();
	const referer = request.headers.get('referer');

	const headers = { 'content-type': 'application/json' };
	if (API_KEY_HEADER) headers['x-api-key'] = API_KEY_HEADER;

	const payload = {
		name,
		contact,
		message,
		sourcePage: referer || undefined,
		referrer: referer || undefined
	};

	const response = await fetch(`${API_BASE}/contact`, {
		method: 'POST',
		headers,
		body: JSON.stringify(payload)
	});
	const backendPayload = await readJson(response);

	if (wantsJsonResponse(request)) {
		if (response.ok) {
			return json({
				success: true,
				message: backendPayload?.message || 'Contact request submitted successfully.'
			});
		}
		return json(
			{
				success: false,
				message: backendPayload?.message || 'Unable to submit contact request.'
			},
			{ status: response.status || 400 }
		);
	}

	const returnUrl = resolveReturnUrl(returnTo || referer, url);
	returnUrl.searchParams.set('contact', response.ok ? 'success' : 'error');
	throw redirect(303, returnUrl.toString());
}
