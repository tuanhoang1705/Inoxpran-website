import { json } from '@sveltejs/kit';
import { adminApiFetch } from '$lib/server/adminApi.js';
import { sanitizeOpenClawClientPayload } from '$lib/server/openclawClientPayload.js';

export const GET = async ({ params, url, cookies, fetch }) => {
	if ([...url.searchParams.keys()].length) {
		return json({ error: 'OpenClaw run query parameters are not supported' }, { status: 400 });
	}
	const runId = encodeURIComponent(params.runId || '');
	const response = await adminApiFetch({
		cookies,
		fetch,
		path: `/admin/openclaw/runs/${runId}`
	});
	const payload = await response.json().catch(() => null);
	if (!response.ok) {
		return json(
			{ error: payload?.message || 'Unable to load OpenClaw run' },
			{ status: response.status }
		);
	}
	return json(sanitizeOpenClawClientPayload(payload?.metadata || {}));
};
