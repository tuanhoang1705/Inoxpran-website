const TOAST_COOKIE = 'admin_toast';
const DEFAULT_MAX_AGE = 60;

const normalizeToast = (toast) => {
	if (!toast || !toast.message) return null;
	return {
		id: toast.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
		tone: toast.tone || 'info',
		message: toast.message,
		duration: typeof toast.duration === 'number' ? toast.duration : undefined
	};
};

export const setAdminToast = (cookies, toast) => {
	const payload = normalizeToast(toast);
	if (!payload) return;

	cookies.set(TOAST_COOKIE, JSON.stringify(payload), {
		path: '/admin',
		maxAge: DEFAULT_MAX_AGE,
		sameSite: 'lax'
	});
};

export const consumeAdminToast = (cookies) => {
	const raw = cookies.get(TOAST_COOKIE);
	if (!raw) return null;

	cookies.delete(TOAST_COOKIE, { path: '/admin' });

	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
};
