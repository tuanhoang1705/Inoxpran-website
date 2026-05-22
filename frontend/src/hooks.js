const EN_PREFIX = '/en';

const shouldStripEnglishPrefix = (pathname) => pathname === EN_PREFIX || pathname.startsWith('/en/');

export const reroute = ({ url }) => {
	const pathname = String(url?.pathname || '/');
	if (!shouldStripEnglishPrefix(pathname)) return;
	const stripped = pathname.slice(EN_PREFIX.length) || '/';
	return stripped;
};

export const transport = {};
