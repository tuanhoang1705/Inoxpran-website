import { env as privateEnv } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import fs from 'node:fs';
import path from 'node:path';
import { ensureAdminSession, clearAdminCookies } from '$lib/server/adminAuth.js';
import { clearUserCookies } from '$lib/server/userAuth.js';

const ADMIN_SUBDOMAIN = 'admin.inoxpran.com';
const shouldSkipTrailingSlashRedirect = (pathname) =>
	pathname.startsWith('/_app') || pathname.startsWith('/api');

const isAdminPath = (pathname) => pathname.startsWith('/admin');
const stripAdminPrefix = (pathname) => pathname.replace(/^\/admin(?=\/|$)/, '') || '/';
const isAdminRouteId = (routeId) => routeId === '/admin' || routeId.startsWith('/admin/');
const isAdminAuthRoute = (pathname) =>
	pathname === '/admin/login' ||
	pathname.startsWith('/admin/register') ||
	pathname.startsWith('/admin/logout');
const isAdminUploadRoute = (pathname) => pathname.startsWith('/admin/uploads');
const isPublicSitePath = (pathname, isAdminRequest = false) =>
	!isAdminRequest &&
	!pathname.startsWith('/admin') &&
	!pathname.startsWith('/api') &&
	!pathname.startsWith('/_app');
const LEGACY_GARBAGE_QUERY_KEY_PREFIXES = ['new/', 'hyzx/', 'qydt/', 'zzzs/', 'dqjs/'];
const LEGACY_GARBAGE_PATH_PREFIXES = ['/dqjs', '/zzzs', '/hyzx', '/qydt'];
const KNOWN_PUBLIC_TOP_LEVEL_PATHS = new Set([
	'',
	'404',
	'about',
	'account',
	'admin',
	'api',
	'blog',
	'cart',
	'categories',
	'category',
	'checkout',
	'contact',
	'faq',
	'forgot-password',
	'login',
	'logout',
	'orders',
	'policies',
	'product',
	'register',
	'reset-password',
	'robots.txt',
	'shop',
	'sitemap.xml',
	'verify'
]);
const HTML_LANG_PLACEHOLDER = '%html.lang%';
const LOCALE_COOKIE = 'site_lang';
const isEnglishPath = (pathname) => pathname === '/en' || pathname.startsWith('/en/');
const stripEnglishPrefix = (pathname) => pathname.replace(/^\/en(?=\/|$)/, '') || '/';
const isLocalePrefixedSystemPath = (pathname) => {
	if (!isEnglishPath(pathname)) return false;
	const stripped = stripEnglishPrefix(pathname);
	return (
		stripped.startsWith('/admin') || stripped.startsWith('/api') || stripped.startsWith('/_app')
	);
};

const hasLegacyGarbageQuery = (searchParams) => {
	if (!searchParams) return false;
	for (const [rawKey, rawValue] of searchParams.entries()) {
		const key = String(rawKey || '')
			.trim()
			.toLowerCase();
		const value = String(rawValue || '').trim();
		if (!key) continue;
		if (value) continue;
		// Preserve SvelteKit page actions that use query keys like "?/addToCart".
		if (key.startsWith('/')) continue;
		if (key.includes('/')) return true;
		if (LEGACY_GARBAGE_QUERY_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) return true;
		if (/^[a-z0-9]{4,12}\/?$/i.test(key)) return true;
	}
	return false;
};

const hasLegacyGarbagePath = (pathname) => {
	const normalized = String(pathname || '')
		.trim()
		.toLowerCase()
		.replace(/\/+$/, '') || '/';
	if (normalized === '/') return false;
	const segments = normalized.split('/').filter(Boolean);
	if (
		segments.length === 1 &&
		!KNOWN_PUBLIC_TOP_LEVEL_PATHS.has(segments[0]) &&
		/^[a-z0-9]{6,12}$/i.test(segments[0])
	) {
		return true;
	}
	return LEGACY_GARBAGE_PATH_PREFIXES.some(
		(prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`)
	);
};

const resolveHtmlLang = (pathname) => (isEnglishPath(pathname) ? 'en' : 'vi');

const RELEASE_COOKIE = 'app_release';
const readGitRelease = () => {
	try {
		const headPath = path.resolve(process.cwd(), '.git', 'HEAD');
		if (!fs.existsSync(headPath)) return null;
		const head = fs.readFileSync(headPath, 'utf8').trim();
		if (!head) return null;
		if (head.startsWith('ref:')) {
			const refPath = head.replace('ref:', '').trim();
			const refFile = path.resolve(process.cwd(), '.git', refPath);
			if (!fs.existsSync(refFile)) return null;
			return fs.readFileSync(refFile, 'utf8').trim().slice(0, 12);
		}
		return head.slice(0, 12);
	} catch {
		return null;
	}
};

const APP_RELEASE =
	String(privateEnv.APP_RELEASE || publicEnv.PUBLIC_APP_RELEASE || '').trim() ||
	readGitRelease() ||
	null;

const resolveCookieDomain = () => {
	const raw = String(publicEnv.PUBLIC_SITE_URL || '').trim();
	if (!raw) return undefined;
	try {
		const { hostname } = new URL(raw);
		if (!hostname || hostname === 'localhost' || hostname === '127.0.0.1') return undefined;
		return hostname;
	} catch {
		return undefined;
	}
};

const COOKIE_DOMAIN = resolveCookieDomain();
const COOKIE_SECURE = (() => {
	const raw = String(publicEnv.PUBLIC_SITE_URL || '').trim();
	if (!raw) return process.env.NODE_ENV === 'production';
	return raw.startsWith('https://');
})();

const releaseCookieOptions = {
	path: '/',
	httpOnly: true,
	sameSite: 'lax',
	secure: COOKIE_SECURE,
	maxAge: 60 * 60 * 24 * 365,
	...(COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {})
};
const localeCookieOptions = {
	path: '/',
	httpOnly: false,
	sameSite: 'lax',
	secure: COOKIE_SECURE,
	maxAge: 60 * 60 * 24 * 365,
	...(COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {})
};

const SECURITY_HEADERS = Object.freeze({
	'x-content-type-options': 'nosniff',
	'x-frame-options': 'SAMEORIGIN',
	'referrer-policy': 'strict-origin-when-cross-origin'
});

const setHeaderIfMissing = (headers, name, value) => {
	if (!headers.has(name)) {
		headers.set(name, value);
	}
};

const isSecureRequest = (event) => {
	if (event.url.protocol === 'https:') return true;
	const forwardedProto = String(event.request.headers.get('x-forwarded-proto') || '')
		.split(',')
		.map((value) => value.trim().toLowerCase())
		.filter(Boolean);
	return forwardedProto.includes('https');
};

export const handle = async ({ event, resolve }) => {
	const { url } = event;
	const { pathname } = url;
	const normalizedPathname = pathname.replace(/\/+$/, '') || '/';
	const routeId = String(event.route?.id || '');
	const isAdminRequest = isAdminPath(pathname) || isAdminRouteId(routeId);
	const adminPathname = isAdminPath(pathname) ? pathname : isAdminRouteId(routeId) ? routeId : pathname;
	const adminLoginPath = url.hostname === ADMIN_SUBDOMAIN ? '/login' : '/admin/login';

	if (url.hostname === ADMIN_SUBDOMAIN && isAdminPath(pathname)) {
		const cleanPath = stripAdminPrefix(pathname);
		return new Response(null, {
			status: 308,
			headers: {
				location: `${cleanPath}${url.search}${url.hash}`,
				'x-robots-tag': 'noindex, nofollow, noarchive'
			}
		});
	}

	if (normalizedPathname === '/categories' || normalizedPathname === '/en/categories') {
		const targetPath = normalizedPathname === '/en/categories' ? '/en/shop' : '/shop';
		return new Response(null, {
			status: 308,
			headers: { location: `${url.origin}${targetPath}${url.search}` }
		});
	}

	if (
		isPublicSitePath(pathname, isAdminRequest) &&
		(hasLegacyGarbagePath(pathname) || hasLegacyGarbageQuery(url.searchParams))
	) {
		return new Response('Gone', {
			status: 410,
			headers: {
				'content-type': 'text/plain; charset=utf-8',
				'x-robots-tag': 'noindex, nofollow'
			}
		});
	}

	if (APP_RELEASE) {
		const currentRelease = event.cookies.get(RELEASE_COOKIE);
		if (currentRelease !== APP_RELEASE) {
			clearAdminCookies(event.cookies);
			clearUserCookies(event.cookies);
			event.cookies.set(RELEASE_COOKIE, APP_RELEASE, releaseCookieOptions);
		}
	}

	if (isLocalePrefixedSystemPath(pathname)) {
		const destinationPath = stripEnglishPrefix(pathname);
		const destination = `${url.origin}${destinationPath}${url.search}`;
		return new Response(null, {
			status: 308,
			headers: { location: destination }
		});
	}

	const localeFromPath = isPublicSitePath(pathname, isAdminRequest)
		? isEnglishPath(pathname)
			? 'en'
			: 'vi'
		: null;
	if (localeFromPath && event.cookies.get(LOCALE_COOKIE) !== localeFromPath) {
		event.cookies.set(LOCALE_COOKIE, localeFromPath, localeCookieOptions);
	}

	if (pathname.length > 1 && pathname.endsWith('/') && !shouldSkipTrailingSlashRedirect(pathname)) {
		const normalizedPath = pathname.replace(/\/+$/, '');
		const destination = `${url.origin}${normalizedPath}${url.search}`;
		return new Response(null, {
			status: 308,
			headers: { location: destination }
		});
	}

	if (isAdminRequest && !isAdminAuthRoute(adminPathname)) {
		const session = await ensureAdminSession({ cookies: event.cookies, fetch: event.fetch });
		if (!session) {
			clearAdminCookies(event.cookies);
			if (isAdminUploadRoute(adminPathname)) {
				return new Response(JSON.stringify({ error: 'Unauthorized' }), {
					status: 401,
					headers: { 'content-type': 'application/json' }
				});
			}
			return new Response(null, {
				status: 303,
				headers: { location: adminLoginPath }
			});
		}
		event.locals.admin = session;
	}

	const htmlLang = resolveHtmlLang(isAdminRequest ? '/admin' : pathname);
	const response = await resolve(event, {
		transformPageChunk: ({ html }) => html.replace(HTML_LANG_PLACEHOLDER, htmlLang)
	});

	if ((response.headers.get('content-type') || '').includes('text/html')) {
		response.headers.set('content-language', htmlLang);
		if (isAdminRequest) {
			response.headers.delete('link');
		}
	}

	for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
		setHeaderIfMissing(response.headers, name, value);
	}

	if (isSecureRequest(event)) {
		setHeaderIfMissing(response.headers, 'strict-transport-security', 'max-age=15552000');
	}

	if (isAdminRequest) {
		setHeaderIfMissing(response.headers, 'x-robots-tag', 'noindex, nofollow, noarchive');
	}

	return response;
};
