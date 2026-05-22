import { redirect } from '@sveltejs/kit';

export const load = ({ url }) => {
	const localePrefix = url.pathname === '/en/categories' ? '/en' : '';
	throw redirect(308, `${localePrefix}/shop${url.search || ''}`);
};
