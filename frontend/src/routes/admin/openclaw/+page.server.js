import { adminApiFetch } from '$lib/server/adminApi.js';
import {
	sanitizeOpenClawClientPayload,
	sanitizeOpenClawErrorMessage
} from '$lib/server/openclawClientPayload.js';

export const load = async ({ cookies, fetch }) => {
	const [response, schedulesResponse] = await Promise.all([
		adminApiFetch({
			cookies,
			fetch,
			path: '/admin/openclaw'
		}),
		adminApiFetch({
			cookies,
			fetch,
			path: '/admin/openclaw/blog-schedules?limit=50&page=1'
		})
	]);
	const payload = await response.json().catch(() => null);
	const schedulesPayload = await schedulesResponse.json().catch(() => null);

	if (!response.ok) {
		return {
			dashboard: null,
			schedules: null,
			capabilityHealth: null,
			loadError:
				response.status >= 500
					? 'Internal Server Error'
					: sanitizeOpenClawErrorMessage(payload?.message, 'Unable to load OpenClaw dashboard')
		};
	}

	return {
		dashboard: sanitizeOpenClawClientPayload(payload?.metadata || null),
		schedules: schedulesResponse.ok ? schedulesPayload?.metadata || null : null,
		capabilityHealth: sanitizeOpenClawClientPayload(
			payload?.metadata?.capabilityHealth || { capabilities: payload?.metadata?.capabilities || {} }
		),
		loadError: ''
	};
};
