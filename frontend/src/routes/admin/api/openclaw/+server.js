import { json } from '@sveltejs/kit';
import { adminApiFetch } from '$lib/server/adminApi.js';
import {
	sanitizeOpenClawClientPayload,
	sanitizeOpenClawErrorMessage
} from '$lib/server/openclawClientPayload.js';

export const GET = async ({ url, cookies, fetch }) => {
	if ([...url.searchParams.keys()].length) {
		return json(
			{ error: 'OpenClaw dashboard query parameters are not supported' },
			{ status: 400 }
		);
	}
	const response = await adminApiFetch({
		cookies,
		fetch,
		path: '/admin/openclaw'
	});
	const payload = await response.json().catch(() => null);
	if (!response.ok) {
		return json(
			{
				error:
					response.status >= 500
						? 'Internal Server Error'
						: sanitizeOpenClawErrorMessage(payload?.message, 'Unable to load OpenClaw dashboard')
			},
			{ status: response.status }
		);
	}
	return json(sanitizeOpenClawClientPayload(payload?.metadata || {}));
};
