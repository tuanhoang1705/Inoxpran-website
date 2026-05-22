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

export const load = async ({ cookies, fetch, params }) => {
	const session = getAdminSession(cookies);
	const headers = buildAdminHeaders(session);
	const t = getTranslator(cookies);

	const response = await fetch(`${API_BASE}/admin/anonymous-visitors/${params.sessionId}`, { headers });
	if (!response.ok) {
		return {
			visitor: null,
			apiError: t('admin.users.errors.notFound') || 'Anonymous visitor session not found.'
		};
	}

	const payload = await parsePayload(response);
	return {
		visitor: payload?.metadata || null
	};
};
