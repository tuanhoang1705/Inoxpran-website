import { fail, redirect } from '@sveltejs/kit';
import { API_BASE } from '$lib/server/api.js';
import { getTranslator } from '$lib/i18n/admin/server.js';
import { buildAdminHeaders, getAdminSession } from '$lib/server/adminAuth.js';
import { setAdminToast } from '$lib/server/adminToast.js';

const parsePayload = async (response) => {
	try {
		return await response.json();
	} catch {
		return null;
	}
};

export const load = async ({ cookies, fetch }) => {
	const session = getAdminSession(cookies);
	const headers = buildAdminHeaders(session);
	const t = getTranslator(cookies);

	try {
		const [bestSellingRes, productsRes] = await Promise.all([
			fetch(`${API_BASE}/product/best-selling?limit=50`, { headers }),
			fetch(`${API_BASE}/product/admin/all?limit=200&page=1&status=published&sort=created`, {
				headers
			})
		]);

		if (!bestSellingRes.ok || !productsRes.ok) {
			return {
				bestSelling: [],
				products: [],
				apiError: t('admin.bestSelling.errors.load')
			};
		}

		const bestSellingPayload = await parsePayload(bestSellingRes);
		const productsPayload = await parsePayload(productsRes);
		const bestSellingMeta = bestSellingPayload?.metadata;
		const productsMeta = productsPayload?.metadata;
		const bestSelling = Array.isArray(bestSellingMeta)
			? bestSellingMeta
			: Array.isArray(bestSellingMeta?.products)
				? bestSellingMeta.products
				: [];
		const products = Array.isArray(productsMeta)
			? productsMeta
			: Array.isArray(productsMeta?.products)
				? productsMeta.products
				: [];
		console.log('Loaded best selling products:', products.length, bestSelling.length);
		return {
			bestSelling,
			products
		};
	} catch {
		return {
			bestSelling: [],
			products: [],
			apiError: t('admin.bestSelling.errors.load')
		};
	}
};

export const actions = {
	save: async ({ request, cookies, fetch }) => {
		const session = getAdminSession(cookies);
		const headers = buildAdminHeaders(session);
		const t = getTranslator(cookies);
		const form = await request.formData();
		const rawOrder = String(form.get('best_selling_order') || '').trim();
		let productIds = [];

		if (rawOrder) {
			try {
				const parsed = JSON.parse(rawOrder);
				if (Array.isArray(parsed)) {
					productIds = parsed.map((id) => String(id)).filter(Boolean);
				}
			} catch {
				// ignore invalid JSON
			}
		}

		const response = await fetch(`${API_BASE}/product/best-selling/order`, {
			method: 'POST',
			headers: {
				...headers,
				'content-type': 'application/json'
			},
			body: JSON.stringify({ productIds })
		});

		if (!response.ok) {
			const payload = await parsePayload(response);
			const message = payload?.message || t('admin.bestSelling.errors.save');
			return fail(response.status, { error: message });
		}

		setAdminToast(cookies, {
			tone: 'success',
			message: t('admin.bestSelling.success.saved')
		});
		throw redirect(303, '/admin/best-selling');
	}
};
