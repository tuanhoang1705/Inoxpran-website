import { fail, redirect } from '@sveltejs/kit';
import { API_BASE } from '$lib/server/api.js';
import { getTranslator } from '$lib/i18n/admin/server.js';
import { buildAdminHeaders, getAdminSession } from '$lib/server/adminAuth.js';
import { setAdminToast } from '$lib/server/adminToast.js';

const ORDER_STATUSES = [
	'pending',
	'confirmed',
	'shipped',
	'cancel_requested',
	'cancelled',
	'delivered',
	'returned'
];

const STATUS_TABS = {
	all: null,
	waiting: ['pending', 'confirmed'],
	shipping: ['shipped'],
	completed: ['delivered'],
	cancelRequested: ['cancel_requested'],
	cancelled: ['cancelled'],
	returned: ['returned']
};

const createEmptySummary = () => ({
	total: 0,
	byStatus: ORDER_STATUSES.reduce((summary, status) => {
		summary[status] = 0;
		return summary;
	}, {}),
	byTab: {
		waiting: 0,
		shipping: 0,
		completed: 0,
		cancel_requested: 0,
		cancelled: 0,
		returned: 0
	}
});

const createEmptyPagination = (page, limit) => ({
	total: 0,
	page,
	limit,
	totalPages: 1,
	hasNext: false,
	hasPrev: page > 1
});

const parsePayload = async (response) => {
	try {
		return await response.json();
	} catch {
		return null;
	}
};

const parseJsonIdList = (value) => {
	if (typeof value !== 'string' || !value.trim()) return [];
	try {
		const parsed = JSON.parse(value);
		if (!Array.isArray(parsed)) return [];
		return parsed
			.map((item) => String(item || '').trim())
			.filter(Boolean);
	} catch {
		return [];
	}
};

const resolveTab = (value) => {
	if (!value) return 'all';
	const normalized = String(value).trim();
	return Object.prototype.hasOwnProperty.call(STATUS_TABS, normalized) ? normalized : 'all';
};

const normalizePositiveNumber = (value, fallback, max = Number.MAX_SAFE_INTEGER) => {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return fallback;
	const rounded = Math.floor(numeric);
	if (rounded < 1) return fallback;
	return Math.min(rounded, max);
};

const sanitizeReturnTo = (value, fallback = '/admin/orders') => {
	const candidate = String(value || '').trim();
	if (!candidate.startsWith('/admin/orders')) return fallback;
	return candidate;
};

const buildReturnTo = (pathname, searchParams) => {
	const query = searchParams.toString();
	return query ? `${pathname}?${query}` : pathname;
};

export const load = async ({ cookies, fetch, url }) => {
	const session = getAdminSession(cookies);
	const headers = buildAdminHeaders(session);
	const t = getTranslator(cookies);

	const activeTab = resolveTab(url.searchParams.get('status'));
	const page = normalizePositiveNumber(url.searchParams.get('page'), 1);
	const limit = normalizePositiveNumber(url.searchParams.get('limit'), 20, 100);
	const q = String(url.searchParams.get('q') || '').trim();
	const from = String(url.searchParams.get('from') || '').trim();
	const to = String(url.searchParams.get('to') || '').trim();
	const sort = String(url.searchParams.get('sort') || 'ctime').trim();

	const params = new URLSearchParams({
		page: String(page),
		limit: String(limit),
		sort
	});

	const statuses = STATUS_TABS[activeTab];
	if (Array.isArray(statuses) && statuses.length > 0) {
		params.set('status', statuses.join(','));
	}
	if (q) params.set('q', q);
	if (from) params.set('from', from);
	if (to) params.set('to', to);

	const response = await fetch(`${API_BASE}/checkout/admin/orders?${params.toString()}`, {
		headers
	});
	if (!response.ok) {
		return {
			orders: [],
			pagination: createEmptyPagination(page, limit),
			summary: createEmptySummary(),
			activeTab,
			filters: { q, page, limit, from, to, sort },
			returnTo: buildReturnTo(url.pathname, url.searchParams),
			apiError: t('admin.orders.errors.load')
		};
	}

	const payload = await parsePayload(response);
	const metadata = payload?.metadata ?? {};
	const pagination = metadata?.pagination ?? createEmptyPagination(page, limit);
	const summary = metadata?.summary ?? createEmptySummary();
	return {
		orders: Array.isArray(metadata?.items) ? metadata.items : [],
		pagination: {
			total: Number(pagination.total) || 0,
			page: Number(pagination.page) || page,
			limit: Number(pagination.limit) || limit,
			totalPages: Number(pagination.totalPages) || 1,
			hasNext: Boolean(pagination.hasNext),
			hasPrev: Boolean(pagination.hasPrev)
		},
		summary,
		activeTab,
		filters: { q, page, limit, from, to, sort },
		returnTo: buildReturnTo(url.pathname, url.searchParams)
	};
};

export const actions = {
	updateStatus: async ({ request, cookies, fetch }) => {
		const session = getAdminSession(cookies);
		const headers = buildAdminHeaders(session);
		const t = getTranslator(cookies);
		const form = await request.formData();
		const orderId = String(form.get('order_id') || '').trim();
		const status = String(form.get('status') || '').trim();
		const returnTo = sanitizeReturnTo(form.get('return_to'));

		if (!orderId || !status) {
			const message = t('admin.orders.errors.missingFields');
			return fail(400, { error: message, toast: { tone: 'error', message } });
		}

		if (!ORDER_STATUSES.includes(status)) {
			const message = t('admin.orders.errors.invalidStatus');
			return fail(400, { error: message, toast: { tone: 'error', message } });
		}

		const response = await fetch(`${API_BASE}/checkout/admin/orders/${orderId}/status`, {
			method: 'PATCH',
			headers: {
				...headers,
				'content-type': 'application/json'
			},
			body: JSON.stringify({ status })
		});

		if (!response.ok) {
			const payload = await parsePayload(response);
			const message = payload?.message || t('admin.orders.errors.updateFailed');
			return fail(response.status, { error: message, toast: { tone: 'error', message } });
		}

		setAdminToast(cookies, { tone: 'success', message: t('admin.orders.success.updated') });
		throw redirect(303, returnTo);
	},

	deleteSelected: async ({ request, cookies, fetch }) => {
		const session = getAdminSession(cookies);
		const headers = buildAdminHeaders(session);
		const t = getTranslator(cookies);
		const form = await request.formData();
		const returnTo = sanitizeReturnTo(form.get('return_to'));
		const ids = parseJsonIdList(String(form.get('selected_ids') || ''));

		if (!ids.length) {
			const message = t('admin.orders.errors.deleteSelectedMissing');
			return fail(400, { error: message, toast: { tone: 'error', message } });
		}

		const response = await fetch(`${API_BASE}/checkout/admin/orders/bulk-delete`, {
			method: 'POST',
			headers: {
				...headers,
				'content-type': 'application/json'
			},
			body: JSON.stringify({
				ids,
				allFiltered: false
			})
		});

		if (!response.ok) {
			const payload = await parsePayload(response);
			const message = payload?.message || t('admin.orders.errors.deleteFailed');
			return fail(response.status, { error: message, toast: { tone: 'error', message } });
		}

		setAdminToast(cookies, { tone: 'success', message: t('admin.orders.success.deletedSelected') });
		throw redirect(303, returnTo);
	},

	deleteAll: async ({ request, cookies, fetch }) => {
		const session = getAdminSession(cookies);
		const headers = buildAdminHeaders(session);
		const t = getTranslator(cookies);
		const form = await request.formData();
		const returnTo = sanitizeReturnTo(form.get('return_to'));
		const activeTab = resolveTab(form.get('active_tab'));
		const q = String(form.get('q') || '').trim();
		const from = String(form.get('from') || '').trim();
		const to = String(form.get('to') || '').trim();
		const sort = String(form.get('sort') || 'ctime').trim();

		const statuses = STATUS_TABS[activeTab];
		const status = Array.isArray(statuses) && statuses.length > 0 ? statuses.join(',') : undefined;

		const response = await fetch(`${API_BASE}/checkout/admin/orders/bulk-delete`, {
			method: 'POST',
			headers: {
				...headers,
				'content-type': 'application/json'
			},
			body: JSON.stringify({
				allFiltered: true,
				filters: {
					status,
					q,
					from,
					to,
					sort
				}
			})
		});

		if (!response.ok) {
			const payload = await parsePayload(response);
			const message = payload?.message || t('admin.orders.errors.deleteAllFailed');
			return fail(response.status, { error: message, toast: { tone: 'error', message } });
		}

		setAdminToast(cookies, { tone: 'success', message: t('admin.orders.success.deletedAll') });
		throw redirect(303, returnTo);
	}
};
