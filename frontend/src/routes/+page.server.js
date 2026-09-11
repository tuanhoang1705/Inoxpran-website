import { fail } from '@sveltejs/kit';
import { API_BASE } from '$lib/server/api.js';
import { getTranslator } from '$lib/i18n/server.js';
import { buildUserHeaders, clearSessionAndRedirect, getUserSession } from '$lib/server/userAuth.js';
import {
	getHomeFeed,
	readHomeFeedSnapshot,
	resolveHomeFeedForRender
} from '$lib/server/homeFeed.js';

// Deliberately short. A render is not the place to wait for the database: the warm
// loop in homeFeed.js keeps a snapshot current in the background, so missing this
// budget costs a visitor a slightly older feed, not an error page.
const HOME_FEED_SSR_BUDGET_MS = 800;

const readJson = async (response) => {
	try {
		return await response.json();
	} catch {
		return null;
	}
};

const waitWithTimeout = async (promise, timeoutMs) => {
	let timeoutId = null;
	const timeoutToken = Symbol('timeout');
	try {
		const result = await Promise.race([
			promise,
			new Promise((resolve) => {
				timeoutId = setTimeout(() => resolve(timeoutToken), timeoutMs);
			})
		]);
		return result === timeoutToken ? null : result;
	} finally {
		if (timeoutId) clearTimeout(timeoutId);
	}
};

const readRequestBody = async (request) => {
	const contentType = request.headers.get('content-type') || '';
	if (contentType.includes('application/json')) {
		try {
			return await request.json();
		} catch {
			return {};
		}
	}
	try {
		const form = await request.formData();
		return Object.fromEntries(form);
	} catch {
		return {};
	}
};

const toSafeQuantity = (value) => {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) return 0;
	return Math.floor(parsed);
};

const fetchCartCount = async ({ fetch, session }) => {
	if (!session) return null;
	try {
		const response = await fetch(`${API_BASE}/cart`, {
			headers: buildUserHeaders(session)
		});
		if (!response.ok) return null;
		const payload = await readJson(response);
		const cart = payload?.metadata ?? payload?.data ?? payload ?? null;
		const products = Array.isArray(cart?.cart_products) ? cart.cart_products : [];
		return products.reduce((sum, item) => sum + toSafeQuantity(item?.quantity), 0);
	} catch {
		return null;
	}
};

export const load = async ({ setHeaders, fetch, cookies }) => {
	const t = getTranslator(cookies);
	// Missing the budget is not the same as having no data. A single upstream list
	// query costs more than this whole budget when the database is slow, so a visitor
	// arriving on a cache miss could be shown "product request failed" while a
	// perfectly good feed sat one lookup away. Fall back to the last good snapshot
	// rather than reporting a failure; the refresh this abandons keeps running.
	const fresh = await waitWithTimeout(getHomeFeed({ fetch }), HOME_FEED_SSR_BUDGET_MS);
	// Only pay for the snapshot lookup when the fresh path did not deliver. The lookup
	// is process memory first and Redis second, so a restarted or newly scaled-out
	// container starts warm instead of showing the first visitors an error.
	const snapshot = fresh?.loaded ? null : await readHomeFeedSnapshot();
	const { feed: homeFeed, cacheControl } = resolveHomeFeedForRender({ fresh, snapshot });
	const hasHomeFeed = Boolean(homeFeed?.loaded);
	setHeaders({ 'cache-control': cacheControl });
	return {
		bestSelling: hasHomeFeed && Array.isArray(homeFeed?.bestSelling) ? homeFeed.bestSelling : [],
		latestPosts: hasHomeFeed && Array.isArray(homeFeed?.latestPosts) ? homeFeed.latestPosts : [],
		apiError: hasHomeFeed ? '' : t('common.errors.productRequestFailed'),
		homeFeedLoaded: hasHomeFeed
	};
};

export const actions = {
	addToCart: async ({ request, fetch, cookies }) => {
		const session = getUserSession(cookies);
		const t = getTranslator(cookies);
		if (!session) {
			return fail(401, { error: t('cart.errors.loginRequired') });
		}

		const payload = await readRequestBody(request);
		const productId = String(payload?.productId ?? '').trim();
		if (!productId) {
			return fail(400, { error: t('cart.errors.addFailed') });
		}

		const headers = {
			...buildUserHeaders(session),
			'content-type': 'application/json'
		};

		const response = await fetch(`${API_BASE}/cart`, {
			method: 'POST',
			headers,
			body: JSON.stringify({ productId, quantity: 1 })
		});

		const apiPayload = await readJson(response);
		if (!response.ok) {
			if ([401, 403].includes(response.status)) {
				clearSessionAndRedirect(cookies);
			}
			return fail(response.status, {
				error: apiPayload?.message ?? t('cart.errors.addFailed')
			});
		}

		const cartCount = await fetchCartCount({ fetch, session });
		return { success: true, metadata: apiPayload?.metadata ?? null, cartCount };
	}
};
