import { fail, redirect } from '@sveltejs/kit';
import { API_BASE } from '$lib/server/api.js';
import { getTranslator } from '$lib/i18n/admin/server.js';
import { buildAdminHeaders, getAdminSession } from '$lib/server/adminAuth.js';
import { setAdminToast } from '$lib/server/adminToast.js';

const toNumber = (value) => {
	if (value === null || value === undefined || value === '') return undefined;
	const parsed = Number(value);
	return Number.isNaN(parsed) ? undefined : parsed;
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

const findDuplicateProduct = async ({ fetch, headers, name }) => {
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
		const match = products.find(
			(product) => normalizeName(product?.product_name) === normalizedName
		);
		if (match) return match;
		if (products.length < limit) return null;
		page += 1;
	}

	return null;
};

const buildAttributesPayload = (form, t, { requireAll = false } = {}) => {
	const manufacturer = String(form.get('product_attribute_manufacturer') || '').trim();
	const model = String(form.get('product_attribute_model') || '').trim();
	const color = String(form.get('product_attribute_color') || '').trim();
	const rawColors = String(form.get('product_attribute_colors') || '').trim();
	const hasAny = Boolean(manufacturer || model || color);

	if (requireAll && !hasAny) {
		return { error: t('admin.productsNew.errors.attributesRequired') };
	}
	if (hasAny && (!manufacturer || !model || !color)) {
		return { error: t('admin.productsNew.errors.attributesIncomplete') };
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

export const actions = {
	default: async ({ request, cookies, fetch }) => {
		const session = getAdminSession(cookies);
		const headers = buildAdminHeaders(session);
		const form = await request.formData();
		const t = getTranslator(cookies);

		const productName = String(form.get('product_name') || '').trim();
		const productDescription = String(form.get('product_description') || '').trim();
		const productType = String(form.get('product_type') || '').trim();
		const attributesResult = buildAttributesPayload(form, t, { requireAll: true });

		if (!productName || !productDescription || !productType) {
			const message = t('admin.productsNew.errors.missingFields');
			return fail(400, { error: message, toast: { tone: 'error', message } });
		}

		if (attributesResult.error) {
			const message = attributesResult.error;
			return fail(400, { error: message, toast: { tone: 'error', message } });
		}

		const duplicate = await findDuplicateProduct({ fetch, headers, name: productName });
		if (duplicate) {
			const message = t('admin.productsNew.errors.duplicateName');
			return fail(400, { error: message, toast: { tone: 'error', message } });
		}

		const productOriginalPrice = toNumber(form.get('product_original_price'));
		const productPrice = toNumber(form.get('product_price'));
		const productQuantity = toNumber(form.get('product_quantity'));
		const productWeight = toNumber(form.get('product_weight'));
		const productRatingsAverage = toNumber(form.get('product_ratingsAverage'));
		const productRatingsCount = toNumber(form.get('product_ratingsCount'));
		const variationsResult = buildVariationsPayload(form);

		const thumbFile = form.get('product_thumb');
		const thumbCropped = String(form.get('product_thumb_cropped') || '').trim();
		const thumbName = String(form.get('product_thumb_name') || '').trim();
		const thumbCropState = String(form.get('product_thumb_crop_state') || '').trim();
		const hasThumbCropped = thumbCropped.startsWith('data:image/');
		if ((!thumbFile || !thumbFile.size) && !hasThumbCropped) {
			const message = t('admin.productsNew.errors.thumbRequired');
			return fail(400, { error: message, toast: { tone: 'error', message } });
		}

		if (productOriginalPrice === undefined) {
			const message = t('admin.productsNew.errors.missingOriginalPrice');
			return fail(400, { error: message, toast: { tone: 'error', message } });
		}
		if (productPrice === undefined) {
			const message = t('admin.productsNew.errors.missingSalePrice');
			return fail(400, { error: message, toast: { tone: 'error', message } });
		}

		const payload = new FormData();
		payload.set('product_name', productName);
		payload.set('product_description', productDescription);
		payload.set('product_type', productType);
		payload.set('product_attributes', attributesResult.value);
		payload.set('product_original_price', String(productOriginalPrice));
		payload.set('product_price', String(productPrice));

		if (productQuantity !== undefined) payload.set('product_quantity', String(productQuantity));
		if (productWeight !== undefined) payload.set('product_weight', String(productWeight));
		if (productRatingsAverage !== undefined) {
			payload.set('product_ratingsAverage', String(productRatingsAverage));
		}
		if (productRatingsCount !== undefined) {
			payload.set('product_ratingsCount', String(productRatingsCount));
		}
		if (variationsResult.value) payload.set('product_variations', variationsResult.value);
		if (hasThumbCropped) {
			payload.set('product_thumb', thumbCropped);
			if (thumbName) payload.set('product_thumb_name', thumbName);
		} else if (thumbFile && thumbFile.size > 0) {
			payload.set('product_thumb', thumbFile);
		}
		if (thumbCropState) {
			payload.set('product_thumb_crop_state', thumbCropState);
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
		if (galleryFiles && galleryFiles.length > 0) {
			galleryFiles.forEach((file) => {
				if (file && file.size > 0) {
					payload.append('product_gallery', file);
				}
			});
		}
		const response = await fetch(`${API_BASE}/product`, {
			method: 'POST',
			headers,
			body: payload
		});

		if (!response.ok) {
			const payload = await parsePayload(response);
			const message = payload?.message || t('admin.productsNew.errors.createFailed');
			return fail(response.status, { error: message, toast: { tone: 'error', message } });
		}

		setAdminToast(cookies, {
			tone: 'success',
			message: t('admin.productsNew.success.created')
		});
		throw redirect(303, '/admin/products/drafts');
	}
};
