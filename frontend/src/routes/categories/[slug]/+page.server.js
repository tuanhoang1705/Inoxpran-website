import { redirect } from '@sveltejs/kit';

export const load = async ({ params, url }) => {
	const localePrefix =
		url.pathname === '/en/categories' || url.pathname.startsWith('/en/categories/') ? '/en' : '';
	const slug = String(params.slug || '').trim();
	if (!slug) {
		throw redirect(308, `${localePrefix}/shop`);
	}
	throw redirect(308, `${localePrefix}/category/${encodeURIComponent(slug)}${url.search || ''}`);
};
