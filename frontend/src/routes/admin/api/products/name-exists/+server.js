import { json } from '@sveltejs/kit';
import { getAdminProductNameStatus } from '$lib/server/adminProduct.js';

export const GET = async ({ cookies, fetch, url }) => {
	const name = String(url.searchParams.get('name') || '').trim();
	if (!name) {
		return json({ exists: false, error: 'Product name is required' }, { status: 400 });
	}

	const result = await getAdminProductNameStatus({
		cookies,
		fetch,
		name,
		excludeId: url.searchParams.get('excludeId') || ''
	});
	if (!result.ok) {
		return json(
			{ exists: false, error: result.message || 'Unable to check product name' },
			{ status: result.status || 500 }
		);
	}

	return json({ exists: result.exists, product: result.product });
};
