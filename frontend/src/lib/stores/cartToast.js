import { writable } from 'svelte/store';

const DEFAULT_TOAST = {
	visible: false,
	message: '',
	type: 'success',
	placement: 'corner',
	overlay: false
};

const createCartToast = () => {
	const { subscribe, set, update } = writable({ ...DEFAULT_TOAST });
	let timer;

	const show = (message, type = 'success', ms = 2200, options = {}) => {
		set({
			...DEFAULT_TOAST,
			visible: true,
			message,
			type,
			...options
		});
		clearTimeout(timer);
		timer = setTimeout(() => {
			set((state) => ({ ...state, visible: false }));
		}, ms);
	};

	const hide = () => {
		clearTimeout(timer);
		update((state) => ({ ...state, visible: false }));
	};

	return { subscribe, show, hide };
};

export const cartToast = createCartToast();
