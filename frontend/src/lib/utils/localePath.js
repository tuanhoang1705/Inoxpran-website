const DEFAULT_LOCALE = 'vi';

const normalizePathname = (value) => {
	const pathname = String(value || '').trim() || '/';
	if (pathname === '/') return '/';
	return pathname.replace(/\/+$/, '');
};

export const stripLocalePrefix = (pathname) =>
	normalizePathname(String(pathname || '').replace(/^\/en(?=\/|$)/, '') || '/');

export const buildLocalizedPathname = (pathname, targetLocale = DEFAULT_LOCALE) => {
	const basePath = stripLocalePrefix(pathname);
	if (targetLocale === 'en') {
		return `/en${basePath === '/' ? '' : basePath}`;
	}
	return basePath;
};

export const localizeInternalHref = (href, targetLocale = DEFAULT_LOCALE) => {
	const raw = String(href || '').trim();
	if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return raw;
	if (raw.startsWith('/admin') || raw.startsWith('/api') || raw.startsWith('/_app')) return raw;

	try {
		const parsed = new URL(raw, 'https://inoxpran.local');
		const nextPathname = buildLocalizedPathname(parsed.pathname, targetLocale);
		return `${nextPathname}${parsed.search}${parsed.hash}`;
	} catch {
		return raw;
	}
};
