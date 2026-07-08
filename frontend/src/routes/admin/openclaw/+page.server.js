import { adminApiFetch } from '$lib/server/adminApi.js';

export const load = async ({ cookies, fetch }) => {
	const response = await adminApiFetch({
		cookies,
		fetch,
		path: '/admin/openclaw'
	});
	const payload = await response.json().catch(() => null);

	if (!response.ok) {
		return {
			dashboard: null,
			loadError: payload?.message || 'Unable to load OpenClaw dashboard'
		};
	}

	return {
		dashboard: payload?.metadata || null,
		loadError: ''
	};
};
