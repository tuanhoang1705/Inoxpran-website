import { fail, redirect } from '@sveltejs/kit';
import { API_BASE } from '$lib/server/api.js';
import { getTranslator } from '$lib/i18n/admin/server.js';
import { buildAdminHeaders, getAdminSession } from '$lib/server/adminAuth.js';
import { adminApiFetch } from '$lib/server/adminApi.js';
import { setAdminToast } from '$lib/server/adminToast.js';

const toNumber = (value) => {
	if (value === null || value === undefined || value === '') return undefined;
	const parsed = Number(value);
	return Number.isNaN(parsed) ? undefined : parsed;
};

const buildAttributesPayload = (form, t, { requireAll = false } = {}) => {
	const manufacturer = String(form.get('product_attribute_manufacturer') || '').trim();
	const model = String(form.get('product_attribute_model') || '').trim();
	const color = String(form.get('product_attribute_color') || '').trim();
	const rawColors = String(form.get('product_attribute_colors') || '').trim();
	const hasAny = Boolean(manufacturer || model || color);

	if (requireAll && !hasAny) {
		return { error: t('admin.productEditor.errors.attributesRequired') };
	}
	if (!hasAny) {
		return { value: undefined, parsed: undefined };
	}

	const parsed = Object.fromEntries(
		Object.entries({ manufacturer, model, color }).filter(([, value]) => Boolean(value))
	);
	if (rawColors) {
		try {
			const parsedColors = JSON.parse(rawColors);
			if (Array.isArray(parsedColors)) {
				parsed.colors = parsedColors.map((value) => String(value || '').trim()).filter(Boolean);
			}
		} catch {
			// ignore invalid colors payload
		}
	}
	return { value: JSON.stringify(parsed), parsed };
};

const buildVariationsPayload = (form, { allowEmpty = false } = {}) => {
	const rawVariations = String(form.get('product_variations') || '').trim();
	if (rawVariations) {
		try {
			const parsed = JSON.parse(rawVariations);
			if (Array.isArray(parsed)) {
				return { value: JSON.stringify(parsed), parsed };
			}
			if (parsed && typeof parsed === 'object') {
				return { value: JSON.stringify([parsed]), parsed: [parsed] };
			}
		} catch {
			// fall through to legacy format
		}
	}

	const sizes = form
		.getAll('product_variations')
		.map((value) => String(value || '').trim())
		.filter(Boolean);

	if (!sizes.length) {
		if (allowEmpty && form.get('product_variations_present')) {
			return { value: JSON.stringify([]), parsed: [] };
		}
		return { value: undefined, parsed: undefined };
	}

	const parsed = sizes.map((size) => ({ size }));
	return { value: JSON.stringify(parsed), parsed };
};

const parsePayload = async (response) => {
	try {
		return await response.json();
	} catch {
		return null;
	}
};

const resolveErrorMessage = async (response, fallback) => {
	const payload = await parsePayload(response);
	return payload?.message || fallback;
};

export const load = async ({ cookies, fetch, params }) => {
	const session = getAdminSession(cookies);
	const headers = buildAdminHeaders(session);
	const t = getTranslator(cookies);

	const response = await fetch(`${API_BASE}/product/admin/${params.productId}`, {
		headers
	});

	if (!response.ok) {
		return { product: null, apiError: t('admin.productEditor.errors.load') };
	}

	const payload = await parsePayload(response);
	return { product: payload?.metadata };
};

export const actions = {
	update: async ({ request, cookies, fetch, params }) => {
		const session = getAdminSession(cookies);
		const headers = buildAdminHeaders(session);
		const form = await request.formData();
		const t = getTranslator(cookies);

		const productType = String(form.get('product_type') || '').trim();
		if (!productType) {
			const message = t('admin.productEditor.errors.missingType');
			return fail(400, { error: message, toast: { tone: 'error', message } });
		}

		const name = String(form.get('product_name') || '').trim();
		const description = String(form.get('product_description') || '').trim();
		const attributesResult = buildAttributesPayload(form, t);
		const variationsResult = buildVariationsPayload(form, { allowEmpty: true });
		const uploadSessionId = String(form.get('upload_session_id') || '').trim();

		if (attributesResult.error) {
			const message = attributesResult.error;
			return fail(400, { error: message, toast: { tone: 'error', message } });
		}
		const price = toNumber(form.get('product_price'));
		const originalPrice = toNumber(form.get('product_original_price'));
		const quantity = toNumber(form.get('product_quantity'));
		const weight = toNumber(form.get('product_weight'));
		const productRatingsAverage = toNumber(form.get('product_ratingsAverage'));
		const productRatingsCount = toNumber(form.get('product_ratingsCount'));

		const payload = new FormData();
		payload.set('product_type', productType);
		if (uploadSessionId) payload.set('upload_session_id', uploadSessionId);

		if (name) payload.set('product_name', name);
		if (description) payload.set('product_description', description);
		if (attributesResult.value) payload.set('product_attributes', attributesResult.value);
		if (variationsResult.value) payload.set('product_variations', variationsResult.value);
		if (originalPrice !== undefined) payload.set('product_original_price', String(originalPrice));
		if (price !== undefined) payload.set('product_price', String(price));
		if (quantity !== undefined) payload.set('product_quantity', String(quantity));
		if (weight !== undefined) payload.set('product_weight', String(weight));
		if (productRatingsAverage !== undefined) {
			payload.set('product_ratingsAverage', String(productRatingsAverage));
		}
		if (productRatingsCount !== undefined) {
			payload.set('product_ratingsCount', String(productRatingsCount));
		}
		const response = await adminApiFetch({
			cookies,
			fetch,
			path: `/product/${params.productId}`,
			options: {
				method: 'PATCH',
				body: payload
			}
		});
		if (!response.ok) {
			const message = await resolveErrorMessage(response, t('admin.productEditor.errors.updateFailed'));
			return fail(response.status, { error: message, toast: { tone: 'error', message } });
		}

		const updated = await parsePayload(response);
		return {
			success: true,
			product: updated?.metadata,
			toast: { tone: 'success', message: t('admin.productEditor.success.updated') }
		};
	},
	publish: async ({ cookies, fetch, params }) => {
		const session = getAdminSession(cookies);
		const headers = buildAdminHeaders(session);
		const t = getTranslator(cookies);

		const response = await fetch(`${API_BASE}/product/publish/${params.productId}`, {
			method: 'POST',
			headers
		});

		if (!response.ok) {
			const message = await resolveErrorMessage(response, t('admin.productEditor.errors.publishFailed'));
			return fail(response.status, { error: message, toast: { tone: 'error', message } });
		}

		setAdminToast(cookies, {
			tone: 'success',
			message: t('admin.productEditor.success.published')
		});
		throw redirect(303, `/admin/products/${params.productId}`);
	},
	unpublish: async ({ cookies, fetch, params }) => {
		const session = getAdminSession(cookies);
		const headers = buildAdminHeaders(session);
		const t = getTranslator(cookies);

		const response = await fetch(`${API_BASE}/product/unPublish/${params.productId}`, {
			method: 'POST',
			headers
		});

		if (!response.ok) {
			const message = await resolveErrorMessage(response, t('admin.productEditor.errors.unpublishFailed'));
			return fail(response.status, { error: message, toast: { tone: 'error', message } });
		}

		setAdminToast(cookies, {
			tone: 'success',
			message: t('admin.productEditor.success.unpublished')
		});
		throw redirect(303, `/admin/products/${params.productId}`);
	},
	delete: async ({ cookies, fetch, params }) => {
		const session = getAdminSession(cookies);
		const headers = buildAdminHeaders(session);
		const t = getTranslator(cookies);

		const response = await fetch(`${API_BASE}/product/${params.productId}`, {
			method: 'DELETE',
			headers
		});

		if (!response.ok) {
			const message = await resolveErrorMessage(response, t('admin.productEditor.errors.deleteFailed'));
			return fail(response.status, { error: message, toast: { tone: 'error', message } });
		}

		setAdminToast(cookies, {
			tone: 'success',
			message: t('admin.productEditor.success.deleted')
		});
		throw redirect(303, '/admin/products');
	}
};

