import { fail, redirect } from '@sveltejs/kit';
import { API_BASE, API_KEY_HEADER } from '$lib/server/api.js';
import { getTranslator } from '$lib/i18n/server.js';
import { buildUserHeaders, clearSessionAndRedirect, getUserSession } from '$lib/server/userAuth.js';
import { buildFallbackShippingQuote } from '$lib/server/shippingFeeFallback.js';

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

const fetchCart = async ({ fetch, session }) => {
	const headers = buildUserHeaders(session);
	const response = await fetch(`${API_BASE}/cart`, { headers });
	const payload = await readJson(response);
	return { response, payload };
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
	if (response.status === 401) {
		clearSessionAndRedirect(cookies);
	}
	if (!response.ok) return [];
	const payload = await readJson(response);
	return payload?.metadata ?? [];
};

const buildCartItems = async ({ fetch, cart }) => {
	const cartProducts = Array.isArray(cart?.cart_products) ? cart.cart_products : [];
	const items = await Promise.all(
		cartProducts.map(async (entry) => {
			const product = await fetchProduct({ fetch, productId: entry.productId });
			const name = entry.name || product?.product_name || 'Product';
			const price = Number(entry.price ?? product?.product_price ?? 0);
			const quantity = Number(entry.quantity ?? 0);
			const originalPrice = Number(product?.product_original_price ?? 0);
			const rawWeight = Number(entry.weight ?? product?.product_weight ?? 0);
			const weight = Number.isFinite(rawWeight) && rawWeight > 0 ? rawWeight : 1000;
			const href = buildProductHref({ product, fallbackId: entry.productId });
			return {
				productId: String(entry.productId),
				shopId: entry.shopId ? String(entry.shopId) : '',
				name,
				price,
				quantity,
				originalPrice,
				weight,
				image: product?.product_thumb || '/images/optimized/product-item1-640.webp',
				href
			};
		})
	);
	return items.filter((item) => item.quantity > 0);
};

const parseIdList = (value) =>
	String(value || '')
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean);

const buildShopOrders = (cartProducts, discount = null) => {
	const discountCode = discount?.code ? String(discount.code) : '';
	const discountScope = discount?.scope === 'selected' ? 'selected' : 'all';
	const discountIds = new Set((discount?.productIds || []).map(String));
	const applyAll = Boolean(discountCode) && discountScope === 'all';

	const regularGroups = new Map();
	const discountGroups = new Map();

	for (const entry of cartProducts) {
		if (!entry?.productId) continue;
		const shopId = entry.shopId ? String(entry.shopId) : 'default';
		const productId = String(entry.productId);
		const isDiscounted = discountCode && (applyAll || discountIds.has(productId));
		const target = isDiscounted ? discountGroups : regularGroups;
		if (!target.has(shopId)) {
			target.set(shopId, {
				shopId,
				shop_discounts: isDiscounted ? [{ codeId: discountCode }] : [],
				item_products: []
			});
		}
		target.get(shopId).item_products.push({
			productId: entry.productId,
			quantity: entry.quantity,
			price: entry.price
		});
	}

	return [...regularGroups.values(), ...discountGroups.values()];
};

const buildSummary = (items) => {
	const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
	return { subtotal };
};

const resolveShopId = (cartProducts = []) => {
	for (const entry of cartProducts) {
		if (entry?.shopId) return String(entry.shopId);
	}
	return '';
};

const buildShippingFeePayload = ({ items, address }) => {
	const safeItems = Array.isArray(items) ? items : [];
	const weight = safeItems.reduce((sum, item) => {
		const itemWeight = Number(item?.weight) || 1000;
		const quantity = Number(item?.quantity) || 0;
		return sum + itemWeight * quantity;
	}, 0);
	const value = safeItems.reduce((sum, item) => {
		const price = Number(item?.price) || 0;
		const quantity = Number(item?.quantity) || 0;
		return sum + price * quantity;
	}, 0);

	return {
		receiver: {
			name: address.name,
			phone: address.phone,
			address: address.address,
			ward: address.ward,
			district: address.district,
			province: address.province
		},
		package: {
			weight: Math.max(1, Math.floor(weight || 0))
		},
		value: Math.max(0, Math.floor(value || 0)),
		transport: 'road'
	};
};

const fetchShippingFee = async ({ fetch, headers, payload }) => {
	const response = await fetch(`${API_BASE}/shipping/fee`, {
		method: 'POST',
		headers: {
			...headers,
			'content-type': 'application/json'
		},
		body: JSON.stringify(payload)
	});
	const data = await readJson(response);
	return { response, data };
};

const extractShippingFeeAmount = (quote) => {
	const raw = quote?.fee?.total_fee ?? quote?.fee?.fee ?? 0;
	const numeric = Number(raw);
	return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
};

const normalizeProductId = (value) => String(value || '').trim();

const normalizeQuantity = (value) => {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) return 0;
	return Math.floor(parsed);
};

const normalizeCartProducts = (products) => {
	if (!Array.isArray(products)) return [];
	return products
		.map((entry) => {
			const productId = normalizeProductId(entry?.productId);
			const quantity = normalizeQuantity(entry?.quantity);
			if (!productId || quantity <= 0) return null;
			return {
				...entry,
				productId,
				quantity,
				shopId: entry?.shopId ? String(entry.shopId) : ''
			};
		})
		.filter(Boolean);
};

const parseGuestCartPayload = (value) => {
	try {
		const parsed = JSON.parse(String(value || '[]'));
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
};

const normalizeGuestCartProducts = (products) =>
	normalizeCartProducts(products).map((entry) => {
		const price = Number(entry?.price);
		const weight = Number(entry?.weight);
		return {
			...entry,
			price: Number.isFinite(price) && price > 0 ? Math.floor(price) : 0,
			weight: Number.isFinite(weight) && weight > 0 ? Math.floor(weight) : 1000
		};
	});

const buildProductStateMap = (products) => {
	const map = new Map();
	for (const entry of normalizeCartProducts(products)) {
		const existing = map.get(entry.productId);
		if (existing) {
			existing.quantity += entry.quantity;
			if (!existing.shopId && entry.shopId) {
				existing.shopId = entry.shopId;
			}
		} else {
			map.set(entry.productId, {
				productId: entry.productId,
				quantity: entry.quantity,
				shopId: entry.shopId || ''
			});
		}
	}
	return map;
};

const buildRemainingCartProducts = ({ originalProducts, orderedProducts }) => {
	const orderedMap = buildProductStateMap(orderedProducts);
	const remaining = [];
	for (const entry of normalizeCartProducts(originalProducts)) {
		const ordered = orderedMap.get(entry.productId)?.quantity ?? 0;
		const nextQuantity = Math.max(0, entry.quantity - ordered);
		if (nextQuantity > 0) {
			remaining.push({
				...entry,
				quantity: nextQuantity
			});
		}
	}
	return normalizeCartProducts(remaining);
};

const sumCartQuantity = (products) =>
	normalizeCartProducts(products).reduce((sum, entry) => sum + entry.quantity, 0);

const syncCartToExpectedState = async ({ fetch, session, expectedProducts }) => {
	const headers = {
		...buildUserHeaders(session),
		'content-type': 'application/json'
	};
	const expectedMap = buildProductStateMap(expectedProducts);
	const { response, payload } = await fetchCart({ fetch, session });
	if (!response.ok) return;
	const currentProducts = normalizeCartProducts(payload?.metadata?.cart_products ?? []);
	const currentMap = buildProductStateMap(currentProducts);

	for (const [productId] of currentMap) {
		if (expectedMap.has(productId)) continue;
		try {
			await fetch(`${API_BASE}/cart`, {
				method: 'DELETE',
				headers,
				body: JSON.stringify({ productId })
			});
		} catch {
			// Ignore post-order reconciliation failures to avoid blocking success response.
		}
	}

	for (const [productId, expected] of expectedMap) {
		const currentQuantity = currentMap.get(productId)?.quantity ?? 0;
		if (currentQuantity === expected.quantity) continue;

		try {
			if (currentQuantity > 0) {
				await fetch(`${API_BASE}/cart/update`, {
					method: 'POST',
					headers,
					body: JSON.stringify({
						shop_order_ids: [
							{
								shopId: expected.shopId || undefined,
								item_products: [{ productId, quantity: expected.quantity }]
							}
						]
					})
				});
			} else {
				await fetch(`${API_BASE}/cart`, {
					method: 'POST',
					headers,
					body: JSON.stringify({
						productId,
						quantity: expected.quantity
					})
				});
			}
		} catch {
			// Ignore post-order reconciliation failures to avoid blocking success response.
		}
	}
};

export const load = async ({ fetch, cookies, locals, url }) => {
	const session = getUserSession(cookies);
	if (!session) {
		return {
			authRequired: true,
			items: [],
			summary: buildSummary([])
		};
	}

	if (locals.accountSessionInvalid) {
		throw redirect(303, '/login?notice=session-expired');
	}

	const t = getTranslator(cookies);
	const buyNowProductIdParam = String(url.searchParams.get('buyNowProductId') || '').trim();
	const buyNowQuantityParam = Number(url.searchParams.get('buyNowQuantity'));
	const buyNowPriceParam = Number(url.searchParams.get('buyNowPrice'));
	const selectedProductIdsParam = String(url.searchParams.get('selectedProductIds') || '').trim();
	const discountCode = String(url.searchParams.get('discount_code') || '').trim();
	const discountScope = String(url.searchParams.get('discount_scope') || 'all').trim();
	const discountProductIds = parseIdList(url.searchParams.get('discount_product_ids'));
	const { response, payload } = await fetchCart({ fetch, session });
	if (!response.ok) {
		return {
			authRequired: false,
			items: [],
			summary: buildSummary([]),
			apiError: t('checkout.errors.loadFailed')
		};
	}

	const cart = payload?.metadata ?? null;
	const cartProducts = Array.isArray(cart?.cart_products) ? cart.cart_products : [];
	if (!buyNowProductIdParam && cartProducts.length === 0) {
		return {
			authRequired: false,
			items: [],
			summary: buildSummary([]),
			cartId: cart?._id || null
		};
	}

	let effectiveBuyNowProductId = null;
	let effectiveBuyNowQuantity = null;
	let effectiveBuyNowPrice = null;
	let effectiveSelectedIds = [];
	let effectiveCartProducts = cartProducts;

	if (buyNowProductIdParam) {
		effectiveBuyNowProductId = buyNowProductIdParam;
		effectiveBuyNowQuantity =
			Number.isFinite(buyNowQuantityParam) && buyNowQuantityParam > 0
				? Math.floor(buyNowQuantityParam)
				: 1;
		const matchedCartItem =
			cartProducts.find((entry) => String(entry.productId) === buyNowProductIdParam) ?? null;
		const normalizedPriceParam =
			Number.isFinite(buyNowPriceParam) && buyNowPriceParam > 0 ? Math.floor(buyNowPriceParam) : null;
		const matchedPriceRaw = Number(matchedCartItem?.price);
		const matchedPrice =
			Number.isFinite(matchedPriceRaw) && matchedPriceRaw > 0 ? Math.floor(matchedPriceRaw) : null;
		effectiveBuyNowPrice = normalizedPriceParam ?? matchedPrice;

		const buyNowEntry = {
			productId: buyNowProductIdParam,
			quantity: effectiveBuyNowQuantity
		};
		if (matchedCartItem?.shopId) {
			buyNowEntry.shopId = String(matchedCartItem.shopId);
		}
		if (effectiveBuyNowPrice !== null) {
			buyNowEntry.price = effectiveBuyNowPrice;
		}
		effectiveCartProducts = [buyNowEntry];
	} else if (selectedProductIdsParam) {
		const selectedIds = selectedProductIdsParam
			.split(',')
			.map((value) => value.trim())
			.filter(Boolean);
		if (selectedIds.length) {
			effectiveSelectedIds = selectedIds;
			effectiveCartProducts = cartProducts.filter((entry) =>
				selectedIds.includes(String(entry.productId))
			);
		}
	}

	const shouldOverrideCart =
		Boolean(effectiveBuyNowProductId || selectedProductIdsParam) ||
		effectiveCartProducts.length !== cartProducts.length;
	const items = await buildCartItems({
		fetch,
		cart: shouldOverrideCart ? { ...(cart || {}), cart_products: effectiveCartProducts } : cart
	});
	if (effectiveBuyNowProductId && effectiveBuyNowPrice === null) {
		const buyNowItem = items.find((item) => String(item.productId) === effectiveBuyNowProductId);
		const resolvedPriceRaw = Number(buyNowItem?.price);
		if (Number.isFinite(resolvedPriceRaw) && resolvedPriceRaw > 0) {
			effectiveBuyNowPrice = Math.floor(resolvedPriceRaw);
		}
	}
	if (effectiveBuyNowProductId && !items.length) {
		return {
			authRequired: false,
			items: [],
			summary: buildSummary([]),
			cartId: cart?._id || null,
			apiError: t('checkout.errors.cartEmpty')
		};
	}

	const effectiveCartProductsForOrder = effectiveBuyNowProductId
		? effectiveCartProducts.map((entry) => ({
				...entry,
				price:
					Number.isFinite(Number(entry?.price)) && Number(entry.price) > 0
						? Math.floor(Number(entry.price))
						: effectiveBuyNowPrice ?? 0
			}))
		: effectiveCartProducts;
	const shopOrders = buildShopOrders(
		effectiveCartProductsForOrder,
		discountCode
			? {
					code: discountCode,
					scope: discountScope,
					productIds: discountProductIds
				}
			: null
	);
	const shopId = resolveShopId(effectiveCartProductsForOrder);
	const discountOptions = await fetchDiscounts({ fetch, shopId, session, cookies });
	const headers = {
		...buildUserHeaders(session),
		'content-type': 'application/json'
	};
	const reviewBody = {
		shop_order_ids: shopOrders
	};
	if (cart?._id && !effectiveBuyNowProductId) {
		reviewBody.cartId = cart._id;
	}
	const reviewResponse = await fetch(`${API_BASE}/checkout/review`, {
		method: 'POST',
		headers,
		body: JSON.stringify(reviewBody)
	});
	const reviewPayload = await readJson(reviewResponse);
	const checkoutOrder = reviewPayload?.metadata?.checkout_order ?? null;
	const reviewError = reviewResponse.ok ? null : t('checkout.errors.reviewFailed');

	return {
		authRequired: false,
		items,
		summary: buildSummary(items),
		cartId: cart?._id || null,
		discountOptions,
		discountShopId: shopId,
		checkoutOrder,
		reviewError,
		buyNowProductId: effectiveBuyNowProductId,
		buyNowQuantity: effectiveBuyNowQuantity,
		buyNowPrice: effectiveBuyNowPrice,
		selectedProductIds: effectiveSelectedIds,
		discountCode,
		discountScope,
		discountProductIds
	};
};

export const actions = {
	guestPlaceOrder: async ({ request, fetch, cookies }) => {
		const t = getTranslator(cookies);
		const form = await request.formData();
		const name = String(form.get('name') || '').trim();
		const phone = String(form.get('phone') || '').trim();
		const email = String(form.get('email') || '').trim();
		const address = String(form.get('address') || '').trim();
		const ward = String(form.get('ward') || '').trim();
		const district = String(form.get('district') || '').trim();
		const province = String(form.get('province') || '').trim();
		const note = String(form.get('note') || '').trim();
		const campaignCode = String(form.get('campaignCode') || '').trim();
		const telemetrySessionId = String(form.get('telemetrySessionId') || '').trim();

		if (!name || !phone || !address || !ward || !district || !province) {
			return fail(400, { error: t('checkout.errors.missingAddress') });
		}

		const guestCartProducts = normalizeGuestCartProducts(
			parseGuestCartPayload(form.get('guestCartPayload'))
		);
		if (!guestCartProducts.length) {
			return fail(400, { error: t('checkout.errors.cartEmpty') });
		}

		const effectiveItems = await buildCartItems({
			fetch,
			cart: { cart_products: guestCartProducts }
		});
		if (!effectiveItems.length) {
			return fail(400, { error: t('checkout.errors.cartEmpty') });
		}

		const shopOrders = buildShopOrders(guestCartProducts);
		const headers = buildPublicHeaders();
		const shippingAddress = {
			name,
			phone,
			email: email || undefined,
			address,
			ward,
			district,
			province,
			note: note || undefined
		};
		const shippingFeePayload = buildShippingFeePayload({
			items: effectiveItems,
			address: shippingAddress
		});
		const buildFallbackQuote = (reason) =>
			buildFallbackShippingQuote({
				weight: shippingFeePayload?.package?.weight,
				reason,
				request: shippingFeePayload
			});

		let shippingFeeQuote = buildFallbackQuote('guest_checkout_shipping_fallback');
		try {
			const { response: shippingFeeResponse, data: shippingFeeData } = await fetchShippingFee({
				fetch,
				headers,
				payload: shippingFeePayload
			});
			if (shippingFeeResponse.ok && shippingFeeData?.metadata?.fee) {
				shippingFeeQuote = shippingFeeData.metadata;
			} else if (shippingFeeData?.metadata?.fee) {
				shippingFeeQuote = shippingFeeData.metadata;
			} else if (!shippingFeeResponse.ok) {
				shippingFeeQuote = buildFallbackQuote('guest_checkout_shipping_api_failed');
			} else {
				shippingFeeQuote = buildFallbackQuote('guest_checkout_shipping_response_empty');
			}
		} catch {
			shippingFeeQuote = buildFallbackQuote('guest_checkout_shipping_unreachable');
		}

		const shippingFee = extractShippingFeeAmount(shippingFeeQuote);
		const orderResponse = await fetch(`${API_BASE}/checkout/guest/orders`, {
			method: 'POST',
			headers: {
				...headers,
				'content-type': 'application/json'
			},
			body: JSON.stringify({
				shop_order_ids: shopOrders,
				user_address: shippingAddress,
				user_payment: {
					method: 'COD',
					shipping_fee: shippingFee,
					shipping_quote: shippingFeeQuote?.fee || undefined,
					shipping_quote_provider: shippingFeeQuote?.provider || 'GHTK',
					shipping_quote_fallback: Boolean(shippingFeeQuote?.fallback),
					shipping_quote_reason: shippingFeeQuote?.reason || undefined,
					shipping_quote_rate: shippingFeeQuote?.rate || undefined
				},
				guest: {
					name,
					phone,
					email: email || undefined,
					note: note || undefined
				},
				marketing: {
					campaignCode: campaignCode || undefined,
					source: 'guest_checkout'
				},
				telemetrySessionId: telemetrySessionId || undefined
			})
		});

		if (!orderResponse.ok) {
			const orderPayload = await readJson(orderResponse);
			return fail(orderResponse.status, {
				error: orderPayload?.message || t('checkout.errors.orderFailed')
			});
		}

		const orderPayload = await readJson(orderResponse);
		return {
			success: true,
			guestOrder: true,
			order: orderPayload?.metadata ?? null,
			cartCount: 0
		};
	},

	placeOrder: async ({ request, fetch, cookies }) => {
		const session = getUserSession(cookies);
		const t = getTranslator(cookies);
		if (!session) {
			return fail(401, { error: t('checkout.errors.loginRequired') });
		}

		const form = await request.formData();
		const name = String(form.get('name') || '').trim();
		const phone = String(form.get('phone') || '').trim();
		const email = String(form.get('email') || '').trim();
		const address = String(form.get('address') || '').trim();
		const ward = String(form.get('ward') || '').trim();
		const district = String(form.get('district') || '').trim();
		const province = String(form.get('province') || '').trim();
		const note = String(form.get('note') || '').trim();

		if (!name || !phone || !address || !ward || !district || !province) {
			return fail(400, { error: t('checkout.errors.missingAddress') });
		}

		const { response, payload } = await fetchCart({ fetch, session });
		if (!response.ok) {
			if (response.status === 401) {
				clearSessionAndRedirect(cookies);
			}
			return fail(response.status, { error: t('checkout.errors.cartLoadFailed') });
		}

		const cart = payload?.metadata ?? null;
		const cartProducts = Array.isArray(cart?.cart_products) ? cart.cart_products : [];
		const originalCartProducts = normalizeCartProducts(cartProducts);

		const buyNowProductId = String(form.get('buyNowProductId') || '').trim();
		const buyNowQuantityRaw = Number(form.get('buyNowQuantity'));
		const buyNowQuantity =
			Number.isFinite(buyNowQuantityRaw) && buyNowQuantityRaw > 0
				? Math.floor(buyNowQuantityRaw)
				: null;
		const buyNowPriceRaw = Number(form.get('buyNowPrice'));
		const buyNowPrice =
			Number.isFinite(buyNowPriceRaw) && buyNowPriceRaw > 0 ? Math.floor(buyNowPriceRaw) : null;
		const selectedProductIds = String(form.get('selectedProductIds') || '').trim();
		const discountCode = String(form.get('discount_code') || '').trim();
		const discountScope = String(form.get('discount_scope') || 'all').trim();
		const discountProductIds = parseIdList(form.get('discount_product_ids'));
		let effectiveCartProducts = originalCartProducts;
		if (buyNowProductId) {
			const quantity = buyNowQuantity ?? 1;
			const matchedCartItem =
				originalCartProducts.find((entry) => String(entry.productId) === buyNowProductId) ?? null;
			let resolvedPrice = buyNowPrice;
			if (resolvedPrice === null) {
				const matchedPriceRaw = Number(matchedCartItem?.price);
				if (Number.isFinite(matchedPriceRaw) && matchedPriceRaw > 0) {
					resolvedPrice = Math.floor(matchedPriceRaw);
				}
			}
			if (resolvedPrice === null) {
				const product = await fetchProduct({ fetch, productId: buyNowProductId });
				const productPriceRaw = Number(product?.product_price);
				if (Number.isFinite(productPriceRaw) && productPriceRaw > 0) {
					resolvedPrice = Math.floor(productPriceRaw);
				}
			}
			if (resolvedPrice === null) {
				return fail(400, { error: t('checkout.errors.orderFailed') });
			}

			const buyNowEntry = {
				productId: buyNowProductId,
				quantity,
				price: resolvedPrice
			};
			if (matchedCartItem?.shopId) {
				buyNowEntry.shopId = String(matchedCartItem.shopId);
			}
			effectiveCartProducts = [buyNowEntry];
		} else if (selectedProductIds) {
			const selectedIds = selectedProductIds
				.split(',')
				.map((value) => value.trim())
				.filter(Boolean);
			if (selectedIds.length) {
				effectiveCartProducts = originalCartProducts.filter((entry) =>
					selectedIds.includes(String(entry.productId))
				);
			}
		}
		if (!buyNowProductId && originalCartProducts.length === 0) {
			return fail(400, { error: t('checkout.errors.cartEmpty') });
		}
		const normalizedEffectiveCartProducts = normalizeCartProducts(effectiveCartProducts);
		if (!normalizedEffectiveCartProducts.length) {
			return fail(400, { error: t('checkout.errors.cartEmpty') });
		}
		const selectedCart =
			Boolean(buyNowProductId || selectedProductIds) ||
			normalizedEffectiveCartProducts.length !== originalCartProducts.length
				? { ...(cart || {}), cart_products: normalizedEffectiveCartProducts }
				: cart;
		const effectiveItems = await buildCartItems({
			fetch,
			cart: selectedCart
		});
		if (!effectiveItems.length) {
			return fail(400, { error: t('checkout.errors.cartEmpty') });
		}

		const shopOrders = buildShopOrders(
			normalizedEffectiveCartProducts,
			discountCode
				? {
						code: discountCode,
						scope: discountScope,
						productIds: discountProductIds
					}
				: null
		);
		const headers = buildUserHeaders(session);
		const shippingAddress = {
			name,
			phone,
			email,
			address,
			ward,
			district,
			province,
			note: note || undefined
		};
		const shippingFeePayload = buildShippingFeePayload({
			items: effectiveItems,
			address: shippingAddress
		});
		const buildFallbackQuote = (reason) =>
			buildFallbackShippingQuote({
				weight: shippingFeePayload?.package?.weight,
				reason,
				request: shippingFeePayload
			});
		let shippingFeeQuote = buildFallbackQuote('checkout_shipping_fallback');

		try {
			const { response: shippingFeeResponse, data: shippingFeeData } = await fetchShippingFee({
				fetch,
				headers,
				payload: shippingFeePayload
			});
			if (shippingFeeResponse.status === 401) {
				clearSessionAndRedirect(cookies);
			}

			if (shippingFeeResponse.ok && shippingFeeData?.metadata?.fee) {
				shippingFeeQuote = shippingFeeData.metadata;
			} else if (shippingFeeData?.metadata?.fee) {
				shippingFeeQuote = shippingFeeData.metadata;
			} else if (!shippingFeeResponse.ok) {
				shippingFeeQuote = buildFallbackQuote('checkout_shipping_api_failed');
			} else {
				shippingFeeQuote = buildFallbackQuote('checkout_shipping_response_empty');
			}
		} catch {
			shippingFeeQuote = buildFallbackQuote('checkout_shipping_unreachable');
		}

		const shippingFee = extractShippingFeeAmount(shippingFeeQuote);
		const isBuyNowFlow = Boolean(buyNowProductId);
		const orderPayloadBody = {
			shop_order_ids: shopOrders,
			user_address: shippingAddress,
			user_payment: {
				method: 'COD',
				shipping_fee: shippingFee,
				shipping_quote: shippingFeeQuote?.fee || undefined,
				shipping_quote_provider: shippingFeeQuote?.provider || 'GHTK',
				shipping_quote_fallback: Boolean(shippingFeeQuote?.fallback),
				shipping_quote_reason: shippingFeeQuote?.reason || undefined,
				shipping_quote_rate: shippingFeeQuote?.rate || undefined
			}
		};
		if (cart?._id && !isBuyNowFlow) {
			orderPayloadBody.cartId = cart._id;
		}

		const orderResponse = await fetch(`${API_BASE}/checkout/orders`, {
			method: 'POST',
			headers: {
				...headers,
				'content-type': 'application/json'
			},
			body: JSON.stringify(orderPayloadBody)
		});

		if (!orderResponse.ok) {
			if (orderResponse.status === 401) {
				clearSessionAndRedirect(cookies);
			}
			const orderPayload = await readJson(orderResponse);
			return fail(orderResponse.status, {
				error: orderPayload?.message || t('checkout.errors.orderFailed')
			});
		}

		const orderPayload = await readJson(orderResponse);
		let finalCartCount = sumCartQuantity(originalCartProducts);
		if (!isBuyNowFlow) {
			const remainingCartProducts = buildRemainingCartProducts({
				originalProducts: originalCartProducts,
				orderedProducts: normalizedEffectiveCartProducts
			});
			await syncCartToExpectedState({
				fetch,
				session,
				expectedProducts: remainingCartProducts
			});
			finalCartCount = sumCartQuantity(remainingCartProducts);
		}
		try {
			const { response: refreshedCartResponse, payload: refreshedCartPayload } = await fetchCart({
				fetch,
				session
			});
			if (refreshedCartResponse.ok) {
				finalCartCount = sumCartQuantity(refreshedCartPayload?.metadata?.cart_products ?? []);
			}
		} catch {
			// Keep expected count fallback when the final cart refresh is unavailable.
		}

		return {
			success: true,
			order: orderPayload?.metadata ?? null,
			cartCount: finalCartCount
		};
	}
};
