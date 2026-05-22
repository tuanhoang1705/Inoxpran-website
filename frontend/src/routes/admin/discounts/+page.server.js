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

const resolveErrorMessage = async (response, fallback) => {
	const payload = await parsePayload(response);
	return payload?.message || fallback;
};

const parseProductIds = (value) => {
	const raw = String(value || '').trim();
	if (!raw) return [];
	return raw
		.split(/[\n,]+/)
		.map((item) => item.trim())
		.filter(Boolean);
};

export const load = async ({ cookies, fetch, url }) => {
	const session = getAdminSession(cookies);
	const headers = buildAdminHeaders(session);
	const t = getTranslator(cookies);

	const params = new URLSearchParams();
	params.set('limit', url.searchParams.get('limit') || '50');
	params.set('page', url.searchParams.get('page') || '1');

	const response = await fetch(`${API_BASE}/discount?${params.toString()}`, { headers });

	if (!response.ok) {
		return { discounts: [], apiError: t('admin.discounts.errors.load') };
	}

	const payload = await parsePayload(response);
	return { discounts: payload?.metadata || [] };
};

export const actions = {
	create: async ({ request, cookies, fetch }) => {
		const session = getAdminSession(cookies);
		const headers = buildAdminHeaders(session);
		const form = await request.formData();
		const t = getTranslator(cookies);

		const code = String(form.get('discount_code') || '').trim();
		const name = String(form.get('discount_name') || '').trim();
		const description = String(form.get('discount_description') || '').trim();
		const type = String(form.get('discount_type') || '').trim();
		const appliesTo = String(form.get('discount_applies_to') || '').trim();
		const customerAppliesTo = String(form.get('discount_customer_applies_to') || 'all').trim();
		const startDate = String(form.get('discount_start_date') || '').trim();
		const endDate = String(form.get('discount_end_date') || '').trim();
		const value = toNumber(form.get('discount_value'));
		const maxValue = toNumber(form.get('discount_max_value'));
		const minOrderValue = toNumber(form.get('discount_min_order_value'));
		const maxUses = toNumber(form.get('discount_max_uses'));
		const maxUsesPerUser = toNumber(form.get('discount_max_uses_per_user'));
		const isActive = Boolean(form.get('discount_is_active'));
		const productIds = parseProductIds(form.get('discount_product_ids'));
		const customerIds = parseProductIds(form.get('discount_customer_ids'));

		if (
			!code ||
			!name ||
			!type ||
			!appliesTo ||
			!startDate ||
			!endDate ||
			value === undefined ||
			maxValue === undefined ||
			minOrderValue === undefined ||
			maxUses === undefined ||
			maxUsesPerUser === undefined
		) {
			const message = t('admin.discounts.errors.missingFields');
			return fail(400, { error: message, toast: { tone: 'error', message } });
		}

		if (appliesTo === 'specific' && !productIds.length) {
			const message = t('admin.discounts.errors.missingProductIds');
			return fail(400, { error: message, toast: { tone: 'error', message } });
		}

		if (customerAppliesTo === 'specific' && !customerIds.length) {
			const message = t('admin.discounts.errors.missingCustomerIds');
			return fail(400, { error: message, toast: { tone: 'error', message } });
		}

		const payload = {
			code,
			name_discount: name,
			description,
			type,
			value,
			max_value: maxValue,
			min_order_value: minOrderValue,
			start_date: startDate,
			end_date: endDate,
			max_uses: maxUses,
			max_uses_per_user: maxUsesPerUser,
			applies_to: appliesTo,
			product_ids: appliesTo === 'specific' ? productIds : [],
			customer_applies_to: customerAppliesTo || 'all',
			customer_ids: customerAppliesTo === 'specific' ? customerIds : [],
			is_active: isActive,
			uses_count: 0
		};

		const response = await fetch(`${API_BASE}/discount`, {
			method: 'POST',
			headers: { ...headers, 'content-type': 'application/json' },
			body: JSON.stringify(payload)
		});

		if (!response.ok) {
			const message = await resolveErrorMessage(response, t('admin.discounts.errors.createFailed'));
			return fail(response.status, { error: message, toast: { tone: 'error', message } });
		}

		setAdminToast(cookies, {
			tone: 'success',
			message: t('admin.discounts.success.created')
		});
		throw redirect(303, '/admin/discounts');
	},
	delete: async ({ request, cookies, fetch }) => {
		const session = getAdminSession(cookies);
		const headers = buildAdminHeaders(session);
		const form = await request.formData();
		const t = getTranslator(cookies);
		const discountId = String(form.get('discount_id') || '').trim();

		if (!discountId) {
			const message = t('admin.discounts.errors.deleteMissingId');
			return fail(400, { error: message, toast: { tone: 'error', message } });
		}

		const response = await fetch(`${API_BASE}/discount/${discountId}`, {
			method: 'DELETE',
			headers
		});

		if (!response.ok) {
			const message = await resolveErrorMessage(response, t('admin.discounts.errors.deleteFailed'));
			return fail(response.status, { error: message, toast: { tone: 'error', message } });
		}

		setAdminToast(cookies, {
			tone: 'success',
			message: t('admin.discounts.success.deleted')
		});
		throw redirect(303, '/admin/discounts');
	}
};
