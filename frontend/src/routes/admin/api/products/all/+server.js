import { API_BASE } from '$lib/server/api.js';
import { buildAdminHeaders, getAdminSession } from '$lib/server/adminAuth.js';
import { json } from '@sveltejs/kit';

const parsePayload = async (response) => {
	try {
		return await response.json();
	} catch {
		return null;
	}
};

export const GET = async ({ cookies, fetch, url }) => {
	try {
		const session = getAdminSession(cookies);
		const headers = buildAdminHeaders(session);

		const params = new URLSearchParams();
		params.set('limit', '10000');
		params.set('page', '1');
		params.set('sort', url.searchParams.get('sort') || 'created');
		params.set('status', url.searchParams.get('status') || 'published');

		const response = await fetch(`${API_BASE}/product/admin/all?${params.toString()}`, {
			headers
		});

		if (!response.ok) {
			return json(
				{ error: 'Failed to fetch products', data: [] },
				{ status: response.status }
			);
		}

		const payload = await parsePayload(response);
		const products = Array.isArray(payload?.metadata) ? payload.metadata : [];

		return json({ data: products, success: true });
	} catch (error) {
		console.error('Error fetching all products:', error);
		return json(
			{ error: 'Internal server error', data: [] },
			{ status: 500 }
		);
	}
};
