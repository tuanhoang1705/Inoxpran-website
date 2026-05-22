import { setCartCount } from '$lib/stores/cartCount.js';
import { cartToast } from '$lib/stores/cartToast.js';

const SMOOTHER_SCROLL_KEY = 'inoxpran_smoother_scroll';

const clearClientAccountState = () => {
	setCartCount(0);
	cartToast.hide();

	if (typeof window === 'undefined') return;
	try {
		window.sessionStorage.removeItem(SMOOTHER_SCROLL_KEY);
	} catch {
		// ignore storage errors (private mode, browser policies...)
	}
};

export { clearClientAccountState };
