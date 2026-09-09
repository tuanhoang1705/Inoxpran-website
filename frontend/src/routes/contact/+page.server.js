import { fail } from '@sveltejs/kit';
import { API_BASE, PUBLIC_API_KEY_HEADER } from '$lib/server/api.js';
import { getTranslator } from '$lib/i18n/server.js';

const OPTIONAL_FIELDS = [
	'phone',
	'email',
	'company',
	'address',
	'city',
	'productInterest',
	'budgetRange',
	'timeline',
	'preferredContactMethod',
	'preferredContactTime'
];

const buildHeaders = () => {
	const headers = { 'content-type': 'application/json' };
	if (PUBLIC_API_KEY_HEADER) headers['x-api-key'] = PUBLIC_API_KEY_HEADER;
	return headers;
};

const readJson = async (response) => {
	try {
		return await response.json();
	} catch {
		return null;
	}
};

const readField = (form, name) => String(form.get(name) || '').trim();

const isValidEmail = (value) => /\S+@\S+\.\S+/.test(value);
const isValidPhone = (value) => value.replace(/\D/g, '').length >= 6;

export const actions = {
	default: async ({ request, fetch, cookies }) => {
		const t = getTranslator(cookies);
		const form = await request.formData();

		const fullName = readField(form, 'fullName');
		const message = readField(form, 'message');
		const phone = readField(form, 'phone');
		const email = readField(form, 'email');

		// Mirror the backend's own guards so a rejected submission comes back as a translated
		// field message instead of a raw 400 from the API.
		if (!fullName) return fail(400, { error: t('contact.errors.missingName') });
		if (!message) return fail(400, { error: t('contact.errors.missingMessage') });
		if (!phone && !email) return fail(400, { error: t('contact.errors.missingContact') });
		if (email && !isValidEmail(email)) {
			return fail(400, { error: t('contact.errors.missingContact') });
		}
		if (phone && !isValidPhone(phone)) {
			return fail(400, { error: t('contact.errors.missingContact') });
		}

		const referer = request.headers.get('referer');
		const payload = { fullName, message };
		for (const field of OPTIONAL_FIELDS) {
			const value = readField(form, field);
			if (value) payload[field] = value;
		}
		if (referer) {
			payload.sourcePage = referer;
			payload.referrer = referer;
		}

		try {
			const response = await fetch(`${API_BASE}/contact`, {
				method: 'POST',
				headers: buildHeaders(),
				body: JSON.stringify(payload)
			});
			const body = await readJson(response);

			if (!response.ok) {
				const reason = String(body?.message || '').trim();
				return fail(response.status || 400, {
					error: reason
						? t('contact.errors.submitFailedWithReason', { reason })
						: t('contact.errors.submitFailed')
				});
			}

			return { success: true, message: t('contact.success.submit') };
		} catch {
			return fail(502, { error: t('contact.errors.submitFailed') });
		}
	}
};
