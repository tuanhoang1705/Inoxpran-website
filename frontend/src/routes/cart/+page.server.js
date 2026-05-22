import { fail } from '@sveltejs/kit';
import { API_BASE, API_KEY_HEADER } from '$lib/server/api.js';
import { redirect } from '@sveltejs/kit';
import { getTranslator } from '$lib/i18n/server.js';
import { buildUserHeaders, clearSessionAndRedirect, getUserSession } from '$lib/server/userAuth.js';

const readJson = async (response) => {
	try {
		return await response.json();
	} catch {
		return null;
	}
};

const buildPublicHeaders = () => {
	const headers = {};
	if (API_KEY_HEADER) headers['x-api-key'] = API_KEY_HEADER;
	return headers;
};

const toSafeQuantity = (value) => {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) return 0;
	return Math.floor(parsed);
};

const extractCartCount = (metadata) => {
	if (!metadata || typeof metadata !== 'object') return null;
	const cart = metadata?.cart_products
		? metadata
		: metadata?.cart?.cart_products
			? metadata.cart
			: null;
	if (cart?.cart_products && Array.isArray(cart.cart_products)) {
		return cart.cart_products.reduce((sum, item) => sum + toSafeQuantity(item?.quantity), 0);
	}
	return null;
};

const fetchDiscounts = async ({ fetch, shopId, session, cookies }) => {
	if (!shopId) return [];
	const params = new URLSearchParams({
		shopId: String(shopId),
		limit: '50',
		page: '1'
	});
	const response = await fetch(`${API_BASE}/discount?${params.toString()}`, {
		headers: buildUserHeaders(session)
	});
	console.log('Discount fetch response status:', response.status);
	if ([401, 403].includes(response.status)) {
		clearSessionAndRedirect(cookies);
	}
	if (!response.ok) return [];
	const payload = await readJson(response);
	return payload?.metadata ?? [];
};

const resolveShopId = (cartProducts = []) => {
	for (const entry of cartProducts) {
		if (entry?.shopId) return String(entry.shopId);
	}
	return '';
};

const fetchCart = async ({ fetch, session }) => {
	const headers = buildUserHeaders(session);
	const response = await fetch(`${API_BASE}/cart`, { headers });
	const payload = await readJson(response);
	return { response, payload };
};

const resolveCartCountFromApiPayload = async ({ payload, fetch, session }) => {
	const { response, payload: latestPayload } = await fetchCart({ fetch, session });
	if (!response.ok) return extractCartCount(payload?.metadata ?? payload ?? null);
	return extractCartCount(latestPayload?.metadata ?? latestPayload ?? null);
};

const fetchProduct = async ({ fetch, productId }) => {
	if (!productId) return null;
	const headers = buildPublicHeaders();
	const response = await fetch(`${API_BASE}/product/${productId}`, { headers });
	if (!response.ok) return null;
	const payload = await readJson(response);
	return payload?.metadata ?? null;
};

const buildProductHref = ({ product, fallbackId }) => {
	const slug = String(product?.product_slug || product?.slug || fallbackId || '').trim();
	return slug ? `/product/${slug}` : '/shop';
};

const toTimestampMs = (value) => {
	if (value === null || value === undefined || value === '') return null;
	if (typeof value === 'number' && Number.isFinite(value)) {
		const normalized = value > 1e12 ? value : value * 1000;
		return Number.isFinite(normalized) ? normalized : null;
	}
	if (typeof value === 'string') {
		const asNumber = Number(value);
		if (Number.isFinite(asNumber)) {
			const normalized = asNumber > 1e12 ? asNumber : asNumber * 1000;
			return Number.isFinite(normalized) ? normalized : null;
		}
		const parsed = Date.parse(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
};

const getCartProductSortTimestamp = (entry) => {
	const candidates = [
		entry?.updatedAt,
		entry?.updated_at,
		entry?.modifiedAt,
		entry?.modified_at,
		entry?.createdAt,
		entry?.created_at,
		entry?.addedAt,
		entry?.added_at
	];
	for (const value of candidates) {
		const timestamp = toTimestampMs(value);
		if (timestamp !== null) return timestamp;
	}
	return null;
};

const sortCartProductsNewestFirst = (products = []) => {
	const annotated = products.map((entry, index) => ({
		entry,
		index,
		timestamp: getCartProductSortTimestamp(entry)
	}));
	const hasTimestamp = annotated.some((item) => item.timestamp !== null);
	annotated.sort((a, b) => {
		if (hasTimestamp) {
			const aTs = a.timestamp ?? -Infinity;
			const bTs = b.timestamp ?? -Infinity;
			if (aTs !== bTs) return bTs - aTs;
		}
		return b.index - a.index;
	});
	return annotated.map((item) => item.entry);
};

const buildCartItems = async ({ fetch, cart }) => {
	const cartProducts = sortCartProductsNewestFirst(
		Array.isArray(cart?.cart_products) ? cart.cart_products : []
	);
	const items = await Promise.all(
		cartProducts.map(async (entry) => {
			const product = await fetchProduct({ fetch, productId: entry.productId });
			const name = entry.name || product?.product_name || 'Product';
			const price = Number(entry.price ?? product?.product_price ?? 0);
			const quantity = Number(entry.quantity ?? 0);
			const originalPrice = Number(product?.product_original_price ?? 0);
			const href = buildProductHref({ product, fallbackId: entry.productId });
			return {
				productId: String(entry.productId),
				shopId: entry.shopId ? String(entry.shopId) : '',
				name,
				price,
				quantity,
				originalPrice,
				image: product?.product_thumb || '/images/optimized/product-item1-640.webp',
				href
			};
		})
	);
	return items.filter((item) => item.quantity > 0);
};

const buildSummary = (items) => {
	const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
	const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
	return {
		subtotal,
		itemCount,
		total: subtotal
	};
};

export const load = async ({ fetch, cookies, locals }) => {
	if (locals.accountSessionInvalid) {
		throw redirect(303, '/login?notice=session-expired');
	}
	const session = getUserSession(cookies);
	if (!session) {
		return {
			authRequired: true,
			items: [],
			summary: buildSummary([])
		};
	}

	const t = getTranslator(cookies);
	const { response, payload } = await fetchCart({ fetch, session });
	if (!response.ok) {
		if ([401, 403].includes(response.status)) {
			return {
				authRequired: true,
				items: [],
				summary: buildSummary([])
			};
		}
		return {
			authRequired: false,
			items: [],
			summary: buildSummary([]),
			apiError: t('cart.errors.loadFailed')
		};
	}

	const cart = payload?.metadata ?? null;
	if (!cart || !Array.isArray(cart.cart_products) || cart.cart_products.length === 0) {
		return {
			authRequired: false,
			items: [],
			summary: buildSummary([]),
			cartId: cart?._id || null
		};
	}

	const items = await buildCartItems({ fetch, cart });
	const cartProducts = Array.isArray(cart.cart_products) ? cart.cart_products : [];
	const shopId = resolveShopId(cartProducts);
	console.log('Resolved shopId:', cart.cart_userId);
	const discountOptions = await fetchDiscounts({ fetch, shopId: cart.cart_userId, session, cookies });

	return {
		authRequired: false,
		items,
		summary: buildSummary(items),
		cartId: cart?._id || null,
		discountOptions,
		discountShopId: shopId
	};
};

export const actions = {
	updateItem: async ({ request, fetch, cookies }) => {
		const session = getUserSession(cookies);
		const t = getTranslator(cookies);
		if (!session) {
			return fail(401, { error: t('cart.errors.loginRequired') });
		}

		const form = await request.formData();
		const productId = String(form.get('productId') || '').trim();
		const shopId = String(form.get('shopId') || '').trim();
		const quantityRaw = Number(form.get('quantity'));
		const quantity = Number.isFinite(quantityRaw) ? Math.max(1, Math.floor(quantityRaw)) : NaN;

		if (!productId || !Number.isFinite(quantity)) {
			return fail(400, { error: t('cart.errors.updateFailed') });
		}

		const headers = {
			...buildUserHeaders(session),
			'content-type': 'application/json'
		};

		const response = await fetch(`${API_BASE}/cart/update`, {
			method: 'POST',
			headers,
			body: JSON.stringify({
				shop_order_ids: [
					{
						shopId: shopId || undefined,
						item_products: [{ productId, quantity }]
					}
				]
			})
		});

		if (!response.ok) {
			if ([401, 403].includes(response.status)) {
				clearSessionAndRedirect(cookies);
			}
			const payload = await readJson(response);
			return fail(response.status, {
				error: payload?.message || t('cart.errors.updateFailed')
			});
		}

		const payload = await readJson(response);
		const cartCount = await resolveCartCountFromApiPayload({ payload, fetch, session });
		return { success: true, cartCount };
	},
	removeItem: async ({ request, fetch, cookies }) => {
		const session = getUserSession(cookies);
		const t = getTranslator(cookies);
		if (!session) {
			return fail(401, { error: t('cart.errors.loginRequired') });
		}

		const form = await request.formData();
		const productId = String(form.get('productId') || '').trim();

		if (!productId) {
			return fail(400, { error: t('cart.errors.removeFailed') });
		}

		const headers = {
			...buildUserHeaders(session),
			'content-type': 'application/json'
		};

		const response = await fetch(`${API_BASE}/cart`, {
			method: 'DELETE',
			headers,
			body: JSON.stringify({ productId })
		});

		if (!response.ok) {
			if ([401, 403].includes(response.status)) {
				clearSessionAndRedirect(cookies);
			}
			const payload = await readJson(response);
			return fail(response.status, {
				error: payload?.message || t('cart.errors.removeFailed')
			});
		}

		const payload = await readJson(response);
		const cartCount = await resolveCartCountFromApiPayload({ payload, fetch, session });
		return { success: true, cartCount };
	}
};
