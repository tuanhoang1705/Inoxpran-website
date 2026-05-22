import { json } from '@sveltejs/kit';
import { API_BASE } from '$lib/server/api.js';
import { buildUserHeaders, getUserSession } from '$lib/server/userAuth.js';

const readJson = async (response) => {
	try {
		return await response.json();
	} catch {
		return null;
	}
};

export const POST = async ({ request, fetch, cookies }) => {
	let body = null;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid request payload.' }, { status: 400 });
	}

	const codeId = String(body?.codeId || body?.code || '').trim();
	if (!codeId) {
		return json({ error: 'Discount code is required.' }, { status: 400 });
	}

	const products = Array.isArray(body?.products) ? body.products : [];
	const session = getUserSession(cookies);

	const headers = {
		...buildUserHeaders(session),
		'content-type': 'application/json'
	};

	const response = await fetch(`${API_BASE}/discount/amount`, {
		method: 'POST',
		headers,
		body: JSON.stringify({
			codeId,
			shopId: body?.shopId || undefined,
			userId: session?.userId || undefined,
			products
		})
	});

	const payload = await readJson(response);
	if (!response.ok) {
		return json({ error: payload?.message || 'Unable to apply voucher.' }, { status: response.status });
	}

	return json({ metadata: payload?.metadata ?? null });
};
