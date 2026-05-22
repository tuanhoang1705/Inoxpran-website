const GUEST_CART_KEY = 'inoxpran:guest-cart:v1';
const DEFAULT_IMAGE = '/images/optimized/product-item1-640.webp';

const hasStorage = () => typeof window !== 'undefined' && Boolean(window.localStorage);

const normalizeNumber = (value, fallback = 0) => {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return fallback;
	return numeric;
};

const normalizeQuantity = (value) => Math.max(1, Math.floor(normalizeNumber(value, 1)));

const normalizeLineId = ({ productId, variantColor, variantSize }) =>
	[productId, variantColor || '', variantSize || ''].map((part) => String(part || '').trim()).join('::');

export const normalizeGuestCartItem = (item) => {
	const productId = String(item?.productId || item?._id || '').trim();
	if (!productId) return null;
	const variantColor = String(item?.variantColor || item?.variant_color || '').trim();
	const variantSize = String(item?.variantSize || item?.variant_size || '').trim();
	const price = Math.max(0, Math.floor(normalizeNumber(item?.price ?? item?.product_price, 0)));
	const originalPrice = Math.max(
		0,
		Math.floor(normalizeNumber(item?.originalPrice ?? item?.product_original_price, 0))
	);
	const quantity = normalizeQuantity(item?.quantity);
	const lineId = String(item?.lineId || normalizeLineId({ productId, variantColor, variantSize }));
	return {
		lineId,
		productId,
		shopId: String(item?.shopId || item?.shop_id || '').trim(),
		name: String(item?.name || item?.product_name || 'Inoxpran product').trim(),
		price,
		originalPrice,
		quantity,
		weight: Math.max(1, Math.floor(normalizeNumber(item?.weight ?? item?.product_weight, 1000))),
		image: String(item?.image || item?.product_thumb || DEFAULT_IMAGE).trim() || DEFAULT_IMAGE,
		href: String(item?.href || '').trim() || '/shop',
		variantColor,
		variantSize
	};
};

export const readGuestCart = () => {
	if (!hasStorage()) return [];
	try {
		const parsed = JSON.parse(window.localStorage.getItem(GUEST_CART_KEY) || '[]');
		if (!Array.isArray(parsed)) return [];
		return parsed.map(normalizeGuestCartItem).filter(Boolean);
	} catch {
		return [];
	}
};

const dispatchGuestCartChange = (items) => {
	if (typeof window === 'undefined') return;
	const count = items.reduce((sum, item) => sum + normalizeQuantity(item.quantity), 0);
	window.dispatchEvent(new CustomEvent('cart:change', { detail: { count } }));
	window.dispatchEvent(new CustomEvent('guest-cart:change', { detail: { items, count } }));
};

export const writeGuestCart = (items) => {
	const normalized = Array.isArray(items) ? items.map(normalizeGuestCartItem).filter(Boolean) : [];
	if (hasStorage()) {
		window.localStorage.setItem(GUEST_CART_KEY, JSON.stringify(normalized));
	}
	dispatchGuestCartChange(normalized);
	return normalized;
};

export const addGuestCartItem = (item, quantity = 1) => {
	const nextItem = normalizeGuestCartItem({ ...item, quantity });
	if (!nextItem) return readGuestCart();
	const items = readGuestCart();
	const existingIndex = items.findIndex((entry) => entry.lineId === nextItem.lineId);
	if (existingIndex >= 0) {
		items[existingIndex] = {
			...items[existingIndex],
			...nextItem,
			quantity: normalizeQuantity(items[existingIndex].quantity) + normalizeQuantity(quantity)
		};
	} else {
		items.unshift(nextItem);
	}
	return writeGuestCart(items);
};

export const updateGuestCartItem = (lineId, quantity) => {
	const safeQuantity = normalizeQuantity(quantity);
	const items = readGuestCart().map((item) =>
		item.lineId === lineId ? { ...item, quantity: safeQuantity } : item
	);
	return writeGuestCart(items);
};

export const removeGuestCartItem = (lineId) =>
	writeGuestCart(readGuestCart().filter((item) => item.lineId !== lineId));

export const clearGuestCart = () => writeGuestCart([]);

export const getGuestCartCount = () =>
	readGuestCart().reduce((sum, item) => sum + normalizeQuantity(item.quantity), 0);

export const getGuestCartSummary = (items = readGuestCart()) => {
	const normalized = Array.isArray(items) ? items.map(normalizeGuestCartItem).filter(Boolean) : [];
	const subtotal = normalized.reduce((sum, item) => sum + item.price * item.quantity, 0);
	const itemCount = normalized.reduce((sum, item) => sum + item.quantity, 0);
	return { subtotal, itemCount, total: subtotal };
};
