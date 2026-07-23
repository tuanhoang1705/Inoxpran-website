import { adminApiFetch } from '$lib/server/adminApi.js';
import { sanitizeOpenClawClientPayload } from '$lib/server/openclawClientPayload.js';

const read = async ({ cookies, fetch, path, fallback, errorKey, errors }) => {
	try {
		const response = await adminApiFetch({ cookies, fetch, path });
		const payload = await response.json().catch(() => null);
		if (!response.ok) {
			errors[errorKey] =
				response.status >= 500
					? 'Internal Server Error'
					: String(payload?.message || `Unable to load ${errorKey}`).slice(0, 500);
			return fallback;
		}
		return payload?.metadata ?? payload ?? fallback;
	} catch {
		errors[errorKey] = `Unable to load ${errorKey}`;
		return fallback;
	}
};

export const load = async ({ cookies, fetch }) => {
	const loadErrors = {};
	const base = '/admin/openclaw/content-operations';
	const [status, snapshots, opportunities, workOrders, signals, inventory, schedule, qaAccess] =
		await Promise.all([
			read({
				cookies,
				fetch,
				path: `${base}/status`,
				fallback: {},
				errorKey: 'status',
				errors: loadErrors
			}),
			read({
				cookies,
				fetch,
				path: `${base}/snapshots?limit=14&page=1`,
				fallback: { snapshots: [] },
				errorKey: 'snapshots',
				errors: loadErrors
			}),
			read({
				cookies,
				fetch,
				path: `${base}/opportunities?limit=20&page=1`,
				fallback: { opportunities: [] },
				errorKey: 'opportunities',
				errors: loadErrors
			}),
			read({
				cookies,
				fetch,
				path: `${base}/work-orders?limit=20&page=1`,
				fallback: { workOrders: [] },
				errorKey: 'workOrders',
				errors: loadErrors
			}),
			read({
				cookies,
				fetch,
				path: `${base}/signals?limit=20&page=1&status=active`,
				fallback: { signals: [] },
				errorKey: 'signals',
				errors: loadErrors
			}),
			read({
				cookies,
				fetch,
				path: `${base}/inventory?limit=24&page=1`,
				fallback: { items: [] },
				errorKey: 'inventory',
				errors: loadErrors
			}),
			read({
				cookies,
				fetch,
				path: `${base}/schedule`,
				fallback: {},
				errorKey: 'schedule',
				errors: loadErrors
			}),
			read({
				cookies,
				fetch,
				path: '/admin/openclaw/qa-batches?limit=1&page=1',
				fallback: { featureEnabled: false, actions: [] },
				errorKey: 'qaAccess',
				errors: loadErrors
			})
		]);
	const safeStatus = sanitizeOpenClawClientPayload(status);
	const capabilityHealth =
		status?.capabilityHealth &&
		typeof status.capabilityHealth === 'object' &&
		!Array.isArray(status.capabilityHealth)
			? status.capabilityHealth
			: { capabilities: {} };

	return {
		status: safeStatus,
		capabilityHealth: sanitizeOpenClawClientPayload(capabilityHealth),
		snapshots,
		opportunities,
		workOrders,
		signals,
		inventory,
		schedule,
		qaAccess: sanitizeOpenClawClientPayload(qaAccess),
		loadErrors
	};
};
