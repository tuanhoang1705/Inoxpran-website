import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';
import { getPolicyDetail, getPolicyPath } from '$lib/content/policies.js';

const DEFAULT_SITE_URL = 'https://inoxpran.com';

const normalizeBaseUrl = (requestUrl) => {
	const configured = String(env.PUBLIC_SITE_URL || '').trim();
	if (configured) return configured.replace(/\/$/, '');
	if (requestUrl?.hostname && requestUrl.hostname !== 'localhost') {
		return `${requestUrl.protocol}//${requestUrl.host}`;
	}
	return DEFAULT_SITE_URL;
};

export const load = ({ params, url }) => {
	const localeValue = url.pathname === '/en' || url.pathname.startsWith('/en/') ? 'en' : 'vi';
	const slug = String(params.slug || '').trim();
	const policy = getPolicyDetail(localeValue, slug);
	if (!policy) {
		throw error(404, localeValue === 'en' ? 'Policy not found' : 'Không tìm thấy chính sách');
	}

	const baseUrl = normalizeBaseUrl(url);
	const canonicalPath = getPolicyPath(slug, localeValue);
	const canonicalUrl = `${baseUrl}${canonicalPath}`;
	const viPath = getPolicyPath(slug, 'vi');
	const enPath = getPolicyPath(slug, 'en');

	return {
		policy,
		canonicalUrl,
		hreflang: {
			vi: `${baseUrl}${viPath}`,
			en: `${baseUrl}${enPath}`,
			xDefault: `${baseUrl}${viPath}`
		},
		robots: {
			index: true,
			content: 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1'
		},
		seo: {
			disableDefaults: true
		}
	};
};