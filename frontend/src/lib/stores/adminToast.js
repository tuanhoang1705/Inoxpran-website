import { writable } from 'svelte/store';

const DEFAULT_DURATION = 4500;

const createId = () => {
	if (typeof crypto !== 'undefined' && crypto.randomUUID) {
		return crypto.randomUUID();
	}
	return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const toasts = writable([]);

const removeToast = (id) => {
	toasts.update((items) => items.filter((item) => item.id !== id));
};

const pushToast = (toast) => {
	if (!toast || !toast.message) return null;
	const entry = {
		id: toast.id || createId(),
		tone: toast.tone || 'info',
		message: toast.message,
		duration: typeof toast.duration === 'number' ? toast.duration : DEFAULT_DURATION
	};

	toasts.update((items) => [...items, entry]);

	if (entry.duration > 0) {
		setTimeout(() => removeToast(entry.id), entry.duration);
	}

	return entry.id;
};

export { toasts, pushToast, removeToast };
