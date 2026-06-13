import { adminApiFetch } from '$lib/server/adminApi.js';

const parsePayload = async (response) => {
	try {
		return await response.json();
	} catch {
		return null;
	}
};

export const getAdminProductNameStatus = async ({ cookies, fetch, name, excludeId = '' }) => {
	const params = new URLSearchParams();
	params.set('name', String(name || '').trim());
	if (excludeId) params.set('excludeId', String(excludeId));

	const response = await adminApiFetch({
		cookies,
		fetch,
		path: `/product/admin/name-exists?${params.toString()}`
	});
	const payload = await parsePayload(response);
	return {
		ok: response.ok,
		status: response.status,
		exists: Boolean(payload?.metadata?.exists),
		product: payload?.metadata?.product || null,
		message: payload?.message || ''
	};
};
