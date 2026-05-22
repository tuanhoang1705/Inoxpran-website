import { fail } from '@sveltejs/kit';
import { API_BASE } from '$lib/server/api.js';
import { getTranslator } from '$lib/i18n/admin/server.js';
import { buildAdminHeaders, getAdminSession } from '$lib/server/adminAuth.js';

const parseError = async (response, fallback) => {
	try {
		const payload = await response.json();
		return payload?.message || fallback;
	} catch {
		return fallback;
	}
};

export const load = async ({ cookies, fetch }) => {
	const session = getAdminSession(cookies);
	const headers = buildAdminHeaders(session);
	const t = getTranslator(cookies);
	const response = await fetch(`${API_BASE}/admin/profile`, { headers });

	if (!response.ok) {
		return { profile: null, apiError: await parseError(response, t('admin.profile.errors.load')) };
	}

	const payload = await response.json();
	return { profile: payload?.metadata };
};

export const actions = {
	update: async ({ request, cookies, fetch }) => {
		const session = getAdminSession(cookies);
		const headers = buildAdminHeaders(session);
		const formData = await request.formData();
		const payload = new FormData();
		const t = getTranslator(cookies);

		const name = formData.get('name');
		const phone = formData.get('phone');
		const avatarUrl = formData.get('avatar_url');
		const avatarFile = formData.get('avatar_file');

		if (name) payload.set('name', String(name));
		if (phone) payload.set('phone', String(phone));
		if (avatarFile && avatarFile.size > 0) {
			payload.set('avatar', avatarFile);
		} else if (avatarUrl) {
			payload.set('avatar', String(avatarUrl));
		}

		const response = await fetch(`${API_BASE}/admin/profile`, {
			method: 'PATCH',
			headers,
			body: payload
		});

		if (!response.ok) {
			const message = await parseError(response, t('admin.profile.errors.updateFailed'));
			return fail(response.status, {
				error: message,
				toast: { tone: 'error', message }
			});
		}

		const updated = await response.json();
		return {
			success: true,
			profile: updated?.metadata,
			toast: { tone: 'success', message: t('admin.profile.success.updated') }
		};
	}
};
