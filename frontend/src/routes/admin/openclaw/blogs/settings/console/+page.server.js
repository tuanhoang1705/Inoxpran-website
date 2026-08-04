import { adminApiFetch } from '$lib/server/adminApi.js';
import { normalizeOpenClawUiError } from '$lib/openclaw/uiError.js';
import { sanitizeOpenClawClientPayload } from '$lib/server/openclawClientPayload.js';

const read = async ({ cookies, fetch, path, errorCode }) => {
	try {
		const response = await adminApiFetch({ cookies, fetch, path });
		const payload = await response.json().catch(() => null);
		return {
			ok: response.ok,
			payload,
			error: response.ok ? null : normalizeOpenClawUiError(payload, errorCode, response.headers)
		};
	} catch {
		return {
			ok: false,
			payload: null,
			error: normalizeOpenClawUiError(null, errorCode)
		};
	}
};

export const load = async ({ cookies, fetch }) => {
	const [dashboardResult, schedulesResult] = await Promise.all([
		read({
			cookies,
			fetch,
			path: '/admin/openclaw',
			errorCode: 'OPENCLAW_CONSOLE_LOAD_FAILED'
		}),
		read({
			cookies,
			fetch,
			path: '/admin/openclaw/blog-schedules?limit=50&page=1',
			errorCode: 'OPENCLAW_CONSOLE_LOAD_FAILED'
		})
	]);

	if (!dashboardResult.ok) {
		return {
			dashboard: null,
			schedules: null,
			capabilityHealth: null,
			loadError: dashboardResult.error
		};
	}

	const payload = dashboardResult.payload;
	return {
		dashboard: sanitizeOpenClawClientPayload(payload?.metadata || null),
		schedules: schedulesResult.ok ? schedulesResult.payload?.metadata || null : null,
		capabilityHealth: sanitizeOpenClawClientPayload(
			payload?.metadata?.capabilityHealth || { capabilities: payload?.metadata?.capabilities || {} }
		),
		loadError: null
	};
};
