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
	if (hasAny && (!manufacturer || !model || !color)) {
		return { error: t('admin.productEditor.errors.attributesIncomplete') };
	}
	if (!hasAny) {
		return { value: undefined, parsed: undefined };
	}

	const parsed = { manufacturer, model, color };
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

const normalizeName = (value) =>
	String(value || '')
		.trim()
		.replace(/\s+/g, ' ')
		.toLowerCase();

const findDuplicateProduct = async ({ fetch, headers, name, excludeId }) => {
	const normalizedName = normalizeName(name);
	if (!normalizedName) return null;

	const limit = 200;
	const maxPages = 25;
	let page = 1;

	while (page <= maxPages) {
		const params = new URLSearchParams();
		params.set('limit', String(limit));
		params.set('page', String(page));
		params.set('status', 'all');
		params.set('sort', 'created');

		const response = await fetch(`${API_BASE}/product/admin/all?${params.toString()}`, { headers });
		if (!response.ok) return null;

		const payload = await parsePayload(response);
		const products = Array.isArray(payload?.metadata) ? payload.metadata : [];
		const match = products.find((product) => {
			if (normalizeName(product?.product_name) !== normalizedName) return false;
			if (excludeId && String(product?._id) === String(excludeId)) return false;
			return true;
		});
		if (match) return match;
		if (products.length < limit) return null;
		page += 1;
	}

	return null;
};

const resolveErrorMessage = async (response, fallback) => {
	const payload = await parsePayload(response);
	return payload?.message || fallback;
};

const isUploadFile = (value) =>
	value &&
	typeof value !== 'string' &&
	typeof value === 'object' &&
	typeof value.size === 'number';

const getFirstTextFormValue = (form, name) =>
	form
		.getAll(name)
		.find((value) => typeof value === 'string' && value.trim());

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
		if (name) {
			const duplicate = await findDuplicateProduct({
				fetch,
				headers,
				name,
				excludeId: params.productId
			});
			if (duplicate) {
				const message = t('admin.productEditor.errors.duplicateName');
				return fail(400, { error: message, toast: { tone: 'error', message } });
			}
		}
		const price = toNumber(form.get('product_price'));
		const originalPrice = toNumber(form.get('product_original_price'));
		const quantity = toNumber(form.get('product_quantity'));
		const weight = toNumber(form.get('product_weight'));
		const productRatingsAverage = toNumber(form.get('product_ratingsAverage'));
		const productRatingsCount = toNumber(form.get('product_ratingsCount'));

		const thumbFile = form.get('product_thumb');
		const thumbCropped = String(form.get('product_thumb_cropped') || '').trim();
		const thumbName = String(form.get('product_thumb_name') || '').trim();
		const thumbCropState = String(form.get('product_thumb_crop_state') || '').trim();
		const hasThumbCropped = thumbCropped.startsWith('data:image/');

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
		if (hasThumbCropped) {
			payload.set('product_thumb', thumbCropped);
			if (thumbName) payload.set('product_thumb_name', thumbName);
		} else if (thumbFile && thumbFile.size > 0) {
			payload.set('product_thumb', thumbFile);
		}
		if (thumbCropState) {
			payload.set('product_thumb_crop_state', thumbCropState);
		}
		const galleryExisting = String(getFirstTextFormValue(form, 'product_gallery') || '').trim();
		if (galleryExisting) {
			payload.set('product_gallery', galleryExisting);
		}
		const galleryCropped = String(form.get('product_gallery_cropped') || '').trim();
		const galleryNames = String(form.get('product_gallery_cropped_names') || '').trim();
		const galleryStates = String(form.get('product_gallery_cropped_states') || '').trim();
		if (galleryCropped) {
			payload.set('product_gallery_cropped', galleryCropped);
			if (galleryNames) payload.set('product_gallery_cropped_names', galleryNames);
			if (galleryStates) payload.set('product_gallery_cropped_states', galleryStates);
		}
		const galleryFiles = form.getAll('product_gallery');
		galleryFiles.forEach((f) => {
			if (isUploadFile(f) && f.size > 0) payload.append('product_gallery', f);
		});
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

