import { writable } from 'svelte/store';

const clampCount = (value) => {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return 0;
	return Math.max(0, Math.floor(numeric));
};

const cartCount = writable(0);

const setCartCount = (value) => {
	cartCount.set(clampCount(value));
};

const bumpCartCount = (delta) => {
	const numeric = Number(delta);
	if (!Number.isFinite(numeric) || numeric === 0) return;
	cartCount.update((current) => clampCount(current + numeric));
};

export { cartCount, setCartCount, bumpCartCount };
