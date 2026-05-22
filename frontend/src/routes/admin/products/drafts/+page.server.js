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

export const load = async ({ cookies, fetch }) => {
	const session = getAdminSession(cookies);
	const headers = buildAdminHeaders(session);
	const t = getTranslator(cookies);

	const params = new URLSearchParams();
	params.set('scope', 'all');
	const response = await fetch(`${API_BASE}/product/drafts/all?${params.toString()}`, {
		headers
	});
	if (!response.ok) {
		return { drafts: [], apiError: t('admin.productsDrafts.errors.load'), creatorLookup: {} };
	}

	const payload = await parsePayload(response);
	const drafts = Array.isArray(payload?.metadata) ? payload.metadata : [];
	const creatorLookup = await resolveCreatorLookup({ products: drafts, headers, fetch });
	return { drafts, creatorLookup };
};

export const actions = {
	publish: async ({ request, cookies, fetch }) => {
		const session = getAdminSession(cookies);
		const headers = buildAdminHeaders(session);
		const form = await request.formData();
		const t = getTranslator(cookies);
		const productId = String(form.get('product_id') || '').trim();

		if (!productId) {
			const message = t('admin.productsDrafts.errors.missingId');
			return fail(400, { error: message, toast: { tone: 'error', message } });
		}

		const response = await fetch(`${API_BASE}/product/publish/${productId}`, {
			method: 'POST',
			headers
		});

		if (!response.ok) {
			const message = t('admin.productsDrafts.errors.publishFailed');
			return fail(response.status, { error: message, toast: { tone: 'error', message } });
		}

		setAdminToast(cookies, {
			tone: 'success',
			message: t('admin.productsDrafts.success.publish')
		});
		throw redirect(303, '/admin/products');
	}
};
