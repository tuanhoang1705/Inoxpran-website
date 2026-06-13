import { fail } from '@sveltejs/kit';
import { getTranslator } from '$lib/i18n/admin/server.js';
import { adminApiFetch } from '$lib/server/adminApi.js';

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

const buildAttributesPayload = (form, t, { requireAll = false } = {}) => {
	const manufacturer = String(form.get('product_attribute_manufacturer') || '').trim();
	const model = String(form.get('product_attribute_model') || '').trim();
	const color = String(form.get('product_attribute_color') || '').trim();
	const rawColors = String(form.get('product_attribute_colors') || '').trim();
	const hasAny = Boolean(manufacturer || model || color);

	if (requireAll && !hasAny) {
		return { error: t('admin.productsNew.errors.attributesRequired') };
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

export const actions = {
	default: async ({ request, cookies, fetch }) => {
		const form = await request.formData();
		const t = getTranslator(cookies);

		const productName = String(form.get('product_name') || '').trim();
		const productDescription = String(form.get('product_description') || '').trim();
		const productType = String(form.get('product_type') || '').trim();
		const attributesResult = buildAttributesPayload(form, t);

		if (!productName || !productType) {
			const message = t('admin.productsNew.errors.missingFields');
			return fail(400, { error: message, toast: { tone: 'error', message } });
		}

		if (attributesResult.error) {
			const message = attributesResult.error;
			return fail(400, { error: message, toast: { tone: 'error', message } });
		}

		const productOriginalPrice = toNumber(form.get('product_original_price'));
		const productPrice = toNumber(form.get('product_price'));
		const productQuantity = toNumber(form.get('product_quantity'));
		const productWeight = toNumber(form.get('product_weight'));
		const productRatingsAverage = toNumber(form.get('product_ratingsAverage'));
		const productRatingsCount = toNumber(form.get('product_ratingsCount'));
		const variationsResult = buildVariationsPayload(form);
		const uploadSessionId = String(form.get('upload_session_id') || '').trim();

		const payload = {
			product_name: productName,
			product_description: productDescription,
			product_type: productType,
			product_attributes: attributesResult.parsed || {},
			product_variations: variationsResult.parsed || [],
			...(uploadSessionId ? { upload_session_id: uploadSessionId } : {}),
			...(productOriginalPrice !== undefined
				? { product_original_price: productOriginalPrice }
				: {}),
			...(productPrice !== undefined ? { product_price: productPrice } : {}),
			...(productQuantity !== undefined ? { product_quantity: productQuantity } : {}),
			...(productWeight !== undefined ? { product_weight: productWeight } : {}),
			...(productRatingsAverage !== undefined
				? { product_ratingsAverage }
				: {}),
			...(productRatingsCount !== undefined ? { product_ratingsCount } : {})
		};
		const response = await adminApiFetch({
			cookies,
			fetch,
			path: '/product/drafts',
			options: {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(payload)
			}
		});

		if (!response.ok) {
			const payload = await parsePayload(response);
			const message = payload?.message || t('admin.productsNew.errors.createFailed');
			return fail(response.status, { error: message, toast: { tone: 'error', message } });
		}

		const created = await parsePayload(response);
		return {
			success: true,
			productId: created?.metadata?._id,
			product: created?.metadata,
			toast: { tone: 'success', message: t('admin.productsNew.success.created') }
		};
	}
};
