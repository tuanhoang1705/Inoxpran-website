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

const toSafeQuantity = (value) => {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) return 0;
	return Math.floor(parsed);
};

const extractCartCount = (payload) => {
	const cart = payload?.metadata ?? payload?.data ?? payload ?? null;
	const products = Array.isArray(cart?.cart_products) ? cart.cart_products : [];
	return products.reduce((sum, entry) => sum + toSafeQuantity(entry?.quantity), 0);
};

export const GET = async ({ fetch, cookies }) => {
	const session = getUserSession(cookies);
	if (!session) {
		return json({ count: 0 });
	}

	try {
		const response = await fetch(`${API_BASE}/cart`, {
			headers: buildUserHeaders(session)
		});
		if (!response.ok) {
			return json({ count: 0 });
		}
		const payload = await readJson(response);
		return json({ count: extractCartCount(payload) });
	} catch {
		return json({ count: 0 });
	}
};

