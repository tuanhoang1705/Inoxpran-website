import { fail, redirect } from '@sveltejs/kit';
import { API_BASE } from '$lib/server/api.js';
import { getTranslator } from '$lib/i18n/server.js';
import {
	getUserSession,
	buildUserHeaders,
	clearUserCookies,
	setUserProfileCookies,
	clearSessionAndRedirect
} from '$lib/server/userAuth.js';

const readJson = async (response) => {
	try {
		return await response.json();
	} catch {
		return null;
	}
};

const requireSession = (cookies) => {
	const session = getUserSession(cookies);
	if (!session) {
		throw redirect(303, '/login');
	}
	return session;
};

export const load = ({ cookies, locals }) => {
	requireSession(cookies);
	if (locals.accountSessionInvalid) {
		throw redirect(303, '/login?notice=session-expired');
	}
	return {};
};

export const actions = {
	updateProfile: async ({ request, fetch, cookies }) => {
		const session = requireSession(cookies);
		const t = getTranslator(cookies);
		const form = await request.formData();
		const name = String(form.get('name') || '').trim();
		const phone = String(form.get('phone') || '').trim();
		const addressesRaw = String(form.get('addresses') || '').trim();

		const payload = {};
		if (name) payload.name = name;
		if (phone) payload.phone = phone;
		if (addressesRaw) {
			payload.addresses = addressesRaw
				.split(/\r?\n/)
				.map((line) => line.trim())
				.filter(Boolean);
		}

		if (!Object.keys(payload).length) {
			return fail(400, { section: 'profile', error: t('account.errors.profileEmpty') });
		}

		const headers = {
			...buildUserHeaders(session),
			'content-type': 'application/json'
		};

		const response = await fetch(`${API_BASE}/user/profile`, {
			method: 'PATCH',
			headers,
			body: JSON.stringify(payload)
		});

		if (!response.ok) {
			if ([401, 403].includes(response.status)) {
				clearSessionAndRedirect(cookies);
			}
			let message = t('account.errors.profileUpdateFailed');
			const payloadError = await readJson(response);
			if (payloadError?.message) {
				message = t('account.errors.profileUpdateFailedWithReason', { reason: payloadError.message });
			}
			return fail(response.status, { section: 'profile', error: message });
		}

		const payloadJson = await readJson(response);
		setUserProfileCookies(cookies, payloadJson?.metadata);
		return {
			section: 'profile',
			success: true,
			message: t('account.success.profileUpdated'),
			profile: payloadJson?.metadata || null
		};
	},
	updateAvatar: async ({ request, fetch, cookies }) => {
		const session = requireSession(cookies);
		const t = getTranslator(cookies);
		const form = await request.formData();
		const avatar = form.get('avatar');

		if (!avatar || typeof avatar === 'string' || avatar.size === 0) {
			return fail(400, { section: 'avatar', error: t('account.errors.avatarMissing') });
		}

		const body = new FormData();
		body.set('avatar', avatar);

		const headers = buildUserHeaders(session);
		const response = await fetch(`${API_BASE}/user/profile`, {
			method: 'PATCH',
			headers,
			body
		});

		if (!response.ok) {
			if ([401, 403].includes(response.status)) {
				clearSessionAndRedirect(cookies);
			}
			let message = t('account.errors.avatarUpdateFailed');
			const payloadError = await readJson(response);
			if (payloadError?.message) {
				message = t('account.errors.avatarUpdateFailedWithReason', { reason: payloadError.message });
			}
			return fail(response.status, { section: 'avatar', error: message });
		}

		const payloadJson = await readJson(response);
		setUserProfileCookies(cookies, payloadJson?.metadata);
		return {
			section: 'avatar',
			success: true,
			message: t('account.success.avatarUpdated'),
			profile: payloadJson?.metadata || null
		};
	},
	changePassword: async ({ request, fetch, cookies }) => {
		const session = requireSession(cookies);
		const t = getTranslator(cookies);
		const form = await request.formData();
		const currentPassword = String(form.get('currentPassword') || '');
		const newPassword = String(form.get('newPassword') || '');
		const confirmPassword = String(form.get('confirmPassword') || '');

		if (!currentPassword || !newPassword || !confirmPassword) {
			return fail(400, { section: 'password', error: t('account.errors.passwordMissing') });
		}

		if (newPassword !== confirmPassword) {
			return fail(400, { section: 'password', error: t('account.errors.passwordMismatch') });
		}

		const headers = {
			...buildUserHeaders(session),
			'content-type': 'application/json'
		};

		const response = await fetch(`${API_BASE}/user/change-password`, {
			method: 'POST',
			headers,
			body: JSON.stringify({
				currentPassword,
				newPassword
			})
		});

		if (!response.ok) {
			if ([401, 403].includes(response.status)) {
				clearSessionAndRedirect(cookies);
			}
			let message = t('account.errors.passwordUpdateFailed');
			const payloadError = await readJson(response);
			if (payloadError?.message) {
				message = t('account.errors.passwordUpdateFailedWithReason', { reason: payloadError.message });
			}
			return fail(response.status, { section: 'password', error: message });
		}

		clearUserCookies(cookies);
		throw redirect(303, '/login?notice=password-changed');
	}
};
