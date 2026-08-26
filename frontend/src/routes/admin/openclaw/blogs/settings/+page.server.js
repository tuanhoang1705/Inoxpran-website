import { adminApiFetch } from '$lib/server/adminApi.js';
import { normalizeOpenClawUiError } from '$lib/openclaw/uiError.js';
import { sanitizeOpenClawClientPayload } from '$lib/server/openclawClientPayload.js';

const read = async ({ cookies, fetch, path, errorCode = 'OPENCLAW_REQUEST_FAILED' }) => {
	try {
		const response = await adminApiFetch({ cookies, fetch, path });
		const payload = await response.json().catch(() => null);
		return {
			ok: response.ok,
			status: response.status,
			payload,
			error: response.ok ? null : normalizeOpenClawUiError(payload, errorCode, response.headers)
		};
	} catch {
		return {
			ok: false,
			status: 0,
			payload: null,
			error: normalizeOpenClawUiError(null, errorCode)
		};
	}
};

export const load = async ({ cookies, fetch }) => {
	const [dashboardResult, schedulesResult, contentOperationsResult, runtimeControlsResult] =
		await Promise.all([
			read({
				cookies,
				fetch,
				path: '/admin/openclaw',
				errorCode: 'OPENCLAW_CORE_LOAD_FAILED'
			}),
			read({ cookies, fetch, path: '/admin/openclaw/blog-schedules?limit=50&page=1' }),
			read({ cookies, fetch, path: '/admin/openclaw/content-operations/status' }),
			read({ cookies, fetch, path: '/admin/openclaw/runtime-controls' })
		]);
	const scheduleIds = schedulesResult.ok
		? (schedulesResult.payload?.metadata?.schedules || [])
				.map((schedule) => String(schedule?.id || '').trim())
				.filter((scheduleId) => /^[a-fA-F0-9]{24}$/.test(scheduleId))
				.slice(0, 50)
		: [];
	const executionSummariesResult = scheduleIds.length
		? await read({
				cookies,
				fetch,
				path: `/admin/openclaw/blog-schedules/execution-summaries?${new URLSearchParams({
					scheduleIds: scheduleIds.join(','),
					limit: '5'
				})}`
			})
		: {
				ok: schedulesResult.ok,
				payload: { metadata: { summaries: [] } },
				error: schedulesResult.error
			};

	return {
		dashboard: dashboardResult.ok
			? sanitizeOpenClawClientPayload(dashboardResult.payload?.metadata || null)
			: null,
		capabilityHealth: dashboardResult.ok
			? sanitizeOpenClawClientPayload(
					dashboardResult.payload?.metadata?.capabilityHealth || {
						capabilities: dashboardResult.payload?.metadata?.capabilities || {}
					}
				)
			: null,
		schedules: schedulesResult.ok ? schedulesResult.payload?.metadata || null : null,
		contentOperations: contentOperationsResult.ok
			? sanitizeOpenClawClientPayload(
					contentOperationsResult.payload?.metadata ?? contentOperationsResult.payload ?? null
				)
			: null,
		runtimeControls: runtimeControlsResult.ok
			? sanitizeOpenClawClientPayload(
					runtimeControlsResult.payload?.metadata ?? runtimeControlsResult.payload ?? null
				)
			: null,
		executionSummaries: executionSummariesResult.ok
			? sanitizeOpenClawClientPayload(executionSummariesResult.payload?.metadata?.summaries || [])
			: null,
		availability: {
			dashboard: dashboardResult.ok,
			schedules: schedulesResult.ok,
			contentOperations: contentOperationsResult.ok,
			runtimeControls: runtimeControlsResult.ok,
			executionHistory: executionSummariesResult.ok
		},
		resourceErrors: {
			dashboard: dashboardResult.error,
			schedules: schedulesResult.error,
			contentOperations: contentOperationsResult.error,
			runtimeControls: runtimeControlsResult.error,
			executionHistory: executionSummariesResult.error
		},
		loadError: dashboardResult.error
	};
};
