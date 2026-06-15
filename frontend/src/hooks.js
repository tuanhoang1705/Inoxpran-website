const EN_PREFIX = '/en';
const ADMIN_SUBDOMAIN = 'admin.inoxpran.com';
const ADMIN_STATIC_PATHS = new Set([
	'/app.css',
	'/browserconfig.xml',
	'/favicon-16x16.png',
	'/favicon-32x32.png',
	'/favicon.ico',
	'/favicon.png',
	'/favicon-96x96.png',
	'/robots.txt',
	'/site.webmanifest',
	'/sitemap.xml'
]);
const ADMIN_STATIC_PREFIXES = ['/_app/', '/icons/', '/images/', '/vendor/'];

const shouldStripEnglishPrefix = (pathname) => pathname === EN_PREFIX || pathname.startsWith('/en/');
const shouldRouteAdminSubdomain = (url, pathname) => {
	if (url?.hostname !== ADMIN_SUBDOMAIN) return false;
	if (pathname === '/admin' || pathname.startsWith('/admin/')) return false;
	if (ADMIN_STATIC_PATHS.has(pathname)) return false;
	if (ADMIN_STATIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return false;
	return true;
};

export const reroute = ({ url }) => {
	const pathname = String(url?.pathname || '/');
	if (shouldRouteAdminSubdomain(url, pathname)) {
		return pathname === '/' ? '/admin' : `/admin${pathname}`;
	}
	if (!shouldStripEnglishPrefix(pathname)) return;
	const stripped = pathname.slice(EN_PREFIX.length) || '/';
	return stripped;
};

export const transport = {};
