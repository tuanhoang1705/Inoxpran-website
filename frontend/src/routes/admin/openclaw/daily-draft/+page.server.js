import { adminApiFetch } from '$lib/server/adminApi.js';
import { sanitizeOpenClawClientPayload } from '$lib/server/openclawClientPayload.js';

const read = async ({ cookies, fetch, path }) => {
	try {
		const response = await adminApiFetch({ cookies, fetch, path });
		const payload = await response.json().catch(() => null);
		return { ok: response.ok, status: response.status, payload };
	} catch {
		return { ok: false, status: 0, payload: null };
	}
};

export const load = async ({ cookies, fetch }) => {
	const [dashboardResult, schedulesResult, contentOperationsResult] = await Promise.all([
		read({
			cookies,
			fetch,
			path: '/admin/openclaw'
		}),
		read({
			cookies,
			fetch,
			path: '/admin/openclaw/blog-schedules?limit=50&page=1'
		}),
		read({
			cookies,
			fetch,
			path: '/admin/openclaw/content-operations/status'
		})
	]);

	if (!dashboardResult.ok) {
		return {
			dashboard: null,
			schedules: schedulesResult.ok ? schedulesResult.payload?.metadata || null : null,
			contentOperations: contentOperationsResult.ok
				? (contentOperationsResult.payload?.metadata ?? contentOperationsResult.payload ?? null)
				: null,
			loadError:
				dashboardResult.status >= 500
					? 'Internal Server Error'
					: String(dashboardResult.payload?.message || 'Unable to load OpenClaw dashboard').slice(
							0,
							500
						)
		};
	}

	return {
		dashboard: sanitizeOpenClawClientPayload(dashboardResult.payload?.metadata || null),
		schedules: schedulesResult.ok ? schedulesResult.payload?.metadata || null : null,
		contentOperations: contentOperationsResult.ok
			? (contentOperationsResult.payload?.metadata ?? contentOperationsResult.payload ?? null)
			: null,
		loadError: ''
	};
};
