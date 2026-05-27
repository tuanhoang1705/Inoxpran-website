export const load = ({ url }) => {
	const cartCountRaw = Number(url.searchParams.get('cartCount'));
	const cartCount = Number.isFinite(cartCountRaw) && cartCountRaw >= 0 ? Math.floor(cartCountRaw) : null;

	return {
		orderId: String(url.searchParams.get('orderId') || '').trim(),
		cartCount,
		mode: String(url.searchParams.get('mode') || '').trim()
	};
};
