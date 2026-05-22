import { fail, redirect } from '@sveltejs/kit';
import { API_BASE } from '$lib/server/api.js';
import { getLocaleFromCookies, getTranslator } from '$lib/i18n/admin/server.js';
import { buildAdminHeaders, getAdminSession } from '$lib/server/adminAuth.js';
import { translateAuthApiMessage } from '$lib/server/authApiMessage.js';

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

	const response = await fetch(`${API_BASE}/admin/users/${params.userId}`, { headers });
	if (!response.ok) {
		return { user: null, apiError: t('admin.users.errors.notFound') };
	}
	const payload = await parsePayload(response);
	return { user: payload?.metadata };
};

export const actions = {
	updateStatus: async ({ cookies, fetch, params, request }) => {
		const session = getAdminSession(cookies);
		const headers = buildAdminHeaders(session);
		const t = getTranslator(cookies);

		const form = await request.formData();
		const status = String(form.get('status') || '').trim();

		const response = await fetch(`${API_BASE}/admin/users/${params.userId}/status`, {
			method: 'PATCH',
			headers: {
				...headers,
				'content-type': 'application/json'
			},
			body: JSON.stringify({ status })
		});

		if (!response.ok) {
			const message = t('admin.users.errors.updateFailed');
			return fail(response.status, { error: message, toast: { tone: 'error', message } });
		}

		const payload = await parsePayload(response);
		return {
			success: true,
			user: payload?.metadata,
			toast: { tone: 'success', message: t('admin.users.success.updated') }
		};
	},
	sendResetPassword: async ({ cookies, fetch, params }) => {
		const session = getAdminSession(cookies);
		const headers = buildAdminHeaders(session);
		const t = getTranslator(cookies);
		const locale = getLocaleFromCookies(cookies);

		const response = await fetch(`${API_BASE}/admin/users/${params.userId}/reset-password`, {
			method: 'POST',
			headers: {
				...headers,
				'content-type': 'application/json'
			},
			body: JSON.stringify({ locale })
		});

		const payload = await parsePayload(response);
		if (!response.ok) {
			const fallbackMessage =
				locale === 'en'
					? 'Failed to send password reset email.'
					: 'Không thể gửi email cấp lại mật khẩu.';
			return fail(response.status, {
				error: fallbackMessage,
				toast: {
					tone: 'error',
					message:
						translateAuthApiMessage({ message: payload?.message, locale, t }) || fallbackMessage
				}
			});
		}

		return {
			success: true,
			toast: {
				tone: 'success',
				message:
					translateAuthApiMessage({
						message: payload?.metadata?.message || payload?.message,
						locale,
						t
					}) ||
					(locale === 'en'
						? 'Password reset email sent.'
						: 'Đã gửi email cấp lại mật khẩu.')
			}
		};
	},
	deleteUser: async ({ cookies, fetch, params }) => {
		const session = getAdminSession(cookies);
		const headers = buildAdminHeaders(session);
		const locale = getLocaleFromCookies(cookies);

		const response = await fetch(`${API_BASE}/admin/users/${params.userId}`, {
			method: 'DELETE',
			headers
		});

		if (!response.ok) {
			return fail(response.status, {
				toast: {
					tone: 'error',
					message:
						locale === 'en' ? 'Failed to delete user.' : 'Không thể xóa người dùng.'
				}
			});
		}

		throw redirect(303, '/admin/users?deleted=1');
	}
};
