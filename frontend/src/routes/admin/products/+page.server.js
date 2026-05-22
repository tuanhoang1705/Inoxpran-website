import { API_BASE } from '$lib/server/api.js';
import { getTranslator } from '$lib/i18n/admin/server.js';
import { buildAdminHeaders, getAdminSession } from '$lib/server/adminAuth.js';

const parsePayload = async (response) => {
	try {
		return await response.json();
	} catch {
		return null;
	}
};

const isObjectId = (value) => /^[a-f\d]{24}$/i.test(value);

const fetchCreator = async ({ shopId, headers, fetch }) => {
	const adminRes = await fetch(`${API_BASE}/admin/admins/${shopId}`, { headers });
	if (adminRes.ok) {
		const adminPayload = await parsePayload(adminRes);
		const admin = adminPayload?.metadata;
		const name = admin?.name || admin?.email;
		if (name) return name;
	}

	const userRes = await fetch(`${API_BASE}/admin/users/${shopId}`, { headers });
	if (userRes.ok) {
		const userPayload = await parsePayload(userRes);
		const user = userPayload?.metadata;
		const name = user?.name || user?.email;
		if (name) return name;
	}

	return null;
};

const resolveCreatorLookup = async ({ products, headers, fetch }) => {
	const shopIds = new Set();

	for (const product of products) {
		const shop = product?.product_shop;
		if (typeof shop === 'string') {
			const trimmed = shop.trim();
			if (trimmed && isObjectId(trimmed)) {
				shopIds.add(trimmed);
			}
		}
	}

	if (!shopIds.size) return {};

	const shopIdList = Array.from(shopIds);
	const lookups = await Promise.allSettled(
		shopIdList.map((shopId) => fetchCreator({ shopId, headers, fetch }))
	);

	const creatorLookup = {};
	for (let i = 0; i < lookups.length; i += 1) {
		const result = lookups[i];
		const shopId = shopIdList[i];
		if (result.status !== 'fulfilled') continue;
		const name = result.value;
		if (name) creatorLookup[shopId] = name;
	}

	return creatorLookup;
};

export const load = async ({ cookies, fetch, url }) => {
	const session = getAdminSession(cookies);
	const headers = buildAdminHeaders(session);
	const t = getTranslator(cookies);

	const page = Math.max(Number(url.searchParams.get('page') || '1'), 1);
	const perPage = 10;
	const requestLimit = perPage + 1;

	const params = new URLSearchParams();
	params.set('limit', String(requestLimit));
	params.set('page', String(page));
	params.set('sort', url.searchParams.get('sort') || 'created');
	params.set('status', 'published');

	try {
		const response = await fetch(`${API_BASE}/product/admin/all?${params.toString()}`, {
			headers
		});

		if (!response.ok) {
			return {
				products: [],
				apiError: t('admin.products.errors.load'),
				pagination: null,
				creatorLookup: {}
			};
		}

		const payload = await parsePayload(response);
		const products = Array.isArray(payload?.metadata) ? payload.metadata : [];
		const creatorLookup = await resolveCreatorLookup({ products, headers, fetch });
		const hasNext = products.length > perPage;
		const trimmed = hasNext ? products.slice(0, perPage) : products;
		return {
			products: trimmed,
			creatorLookup,
			pagination: {
				page,
				perPage,
				hasNext,
				hasPrev: page > 1
			}
		};
	} catch {
		return {
			products: [],
			apiError: t('admin.products.errors.load'),
			pagination: null,
			creatorLookup: {}
		};
	}
};
