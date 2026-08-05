const adminCookieOverrides = new WeakMap();

const getOverrides = (cookies, create = false) => {
	if (!cookies || (typeof cookies !== 'object' && typeof cookies !== 'function')) return null;
	let overrides = adminCookieOverrides.get(cookies);
	if (!overrides && create) {
		overrides = new Map();
		adminCookieOverrides.set(cookies, overrides);
	}
	return overrides || null;
};

export const rememberAdminCookie = (cookies, name, value) => {
	getOverrides(cookies, true)?.set(name, value);
};

export const readAdminCookie = (cookies, name) => {
	const overrides = getOverrides(cookies);
	if (overrides?.has(name)) return overrides.get(name);
	return cookies?.get?.(name);
};
