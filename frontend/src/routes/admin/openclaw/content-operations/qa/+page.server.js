import { adminApiFetch } from '$lib/server/adminApi.js';
import { normalizeQaBatchDetail, qaBatchList, qaEntityId } from '$lib/openclaw/blogQa.js';
import {
	sanitizeOpenClawClientPayload,
	sanitizeOpenClawErrorMessage
} from '$lib/server/openclawClientPayload.js';

const read = async ({ cookies, fetch, path }) => {
	try {
		const response = await adminApiFetch({ cookies, fetch, path });
		const payload = await response.json().catch(() => null);
		return {
			ok: response.ok,
			status: response.status,
			data: sanitizeOpenClawClientPayload(payload?.metadata ?? payload ?? {}),
			error:
				response.ok || response.status === 404
					? ''
					: response.status >= 500
						? 'Internal Server Error'
						: sanitizeOpenClawErrorMessage(payload?.message, 'Unable to load Agentic Blog QA')
		};
	} catch {
		return { ok: false, status: 0, data: {}, error: 'Unable to load Agentic Blog QA' };
	}
};

const serializableAccess = (payload = {}) => {
	const root = payload?.metadata ?? payload ?? {};
	const rawActions = root.actions ?? root.allowedActions ?? root.permissions ?? [];
	const actions = Array.isArray(rawActions)
		? rawActions.map(String)
		: Object.entries(rawActions || {})
				.filter(([, allowed]) => allowed === true)
				.map(([action]) => action);
	return {
		enabled: root.featureEnabled === true || root.enabled === true,
		environment: ['local', 'staging'].includes(String(root.environment))
			? String(root.environment)
			: '',
		actions
	};
};

export const load = async ({ cookies, fetch, url }) => {
	const listResult = await read({
		cookies,
		fetch,
		path: '/admin/openclaw/qa-batches?limit=20&page=1'
	});
	const batches = qaBatchList(listResult.data);
	const requestedId = qaEntityId(url.searchParams.get('batch'));
	const selectedId = requestedId || batches[0]?.id || '';
	let batch = batches.find((item) => item.id === selectedId) || null;
	let reports = [];
	const detailErrors = [];

	if (selectedId) {
		const [detailResult, reportResult] = await Promise.all([
			read({
				cookies,
				fetch,
				path: `/admin/openclaw/qa-batches/${encodeURIComponent(selectedId)}`
			}),
			read({
				cookies,
				fetch,
				path: `/admin/openclaw/qa-batches/${encodeURIComponent(selectedId)}/reports`
			})
		]);
		if (detailResult.ok) batch = normalizeQaBatchDetail(detailResult.data);
		else if (detailResult.error) detailErrors.push(detailResult.error);
		if (reportResult.ok) {
			reports = reportResult.data?.reports || reportResult.data?.items || reportResult.data || [];
		} else if (reportResult.error) detailErrors.push(reportResult.error);
	}

	return {
		batches: listResult.data,
		batch,
		reports: Array.isArray(reports) ? reports : [],
		qaAccess: serializableAccess(listResult.data),
		loadError: [listResult.error, ...detailErrors].filter(Boolean).join(' · ')
	};
};
