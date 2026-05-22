const normalizeCartCount = (value) => {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 0) return null;
	return Math.floor(parsed);
};

const dispatchCartCountChange = (count) => {
	if (typeof window === 'undefined') return;
	const safeCount = normalizeCartCount(count);
	if (safeCount === null) return;
	window.dispatchEvent(
		new CustomEvent('cart:change', {
			detail: { count: safeCount }
		})
	);
};

const extractCartCountFromActionResult = (result) => {
	const actionData = result?.data;
	const directCount = normalizeCartCount(actionData?.cartCount);
	if (directCount !== null) return directCount;
	return null;
};

const fetchCartCountFromServer = async () => {
	if (typeof window === 'undefined') return null;
	try {
		const response = await fetch('/api/cart/count', {
			method: 'GET',
			headers: { accept: 'application/json' },
			credentials: 'same-origin'
		});
		if (!response.ok) return null;
		const payload = await response.json().catch(() => null);
		return normalizeCartCount(payload?.count);
	} catch {
		return null;
	}
};

const syncCartCountFromActionResult = async (result) => {
	const actionCount = extractCartCountFromActionResult(result);
	if (actionCount !== null) {
		dispatchCartCountChange(actionCount);
		return actionCount;
	}
	const fetchedCount = await fetchCartCountFromServer();
	if (fetchedCount !== null) {
		dispatchCartCountChange(fetchedCount);
		return fetchedCount;
	}
	return null;
};

export {
	dispatchCartCountChange,
	extractCartCountFromActionResult,
	fetchCartCountFromServer,
	syncCartCountFromActionResult
};

