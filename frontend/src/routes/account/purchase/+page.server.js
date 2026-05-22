import { redirect } from '@sveltejs/kit';
import { API_BASE } from '$lib/server/api.js';
import { getTranslator } from '$lib/i18n/server.js';
import { buildUserHeaders, clearSessionAndRedirect, getUserSession } from '$lib/server/userAuth.js';

const readJson = async (response) => {
	try {
		return await response.json();
	} catch {
		return null;
	}
};

const STATUS_TABS = {
	all: null,
	shipping: ['shipped'],
	waiting: ['pending', 'confirmed'],
	completed: ['delivered'],
	cancelled: ['cancelled'],
	returned: ['returned']
};

const resolveTab = (value) => {
	if (!value) return 'all';
	const normalized = String(value).trim();
	return STATUS_TABS[normalized] ? normalized : 'all';
};

export const load = async ({ fetch, cookies, locals, url }) => {
	const session = getUserSession(cookies);
	if (!session) {
		throw redirect(303, '/login');
	}
	if (locals.accountSessionInvalid) {
		throw redirect(303, '/login?notice=session-expired');
	}

	const t = getTranslator(cookies);
	const activeTab = resolveTab(url.searchParams.get('status'));
	const statusFilter = STATUS_TABS[activeTab];
	const params = new URLSearchParams({
		limit: '50',
		page: '1',
		sort: 'ctime'
	});
	if (Array.isArray(statusFilter) && statusFilter.length) {
		params.set('status', statusFilter.join(','));
	}

	const response = await fetch(`${API_BASE}/checkout/orders?${params.toString()}`, {
		headers: buildUserHeaders(session)
	});
	if ([401, 403].includes(response.status)) {
		clearSessionAndRedirect(cookies);
	}
	if (!response.ok) {
		return {
			activeTab,
			orders: [],
			apiError: t('purchase.errors.loadFailed')
		};
	}
	const payload = await readJson(response);
	return {
		activeTab,
		orders: payload?.metadata ?? []
	};
};
