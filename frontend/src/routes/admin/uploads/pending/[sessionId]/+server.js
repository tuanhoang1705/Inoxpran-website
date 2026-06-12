import { json } from '@sveltejs/kit';
import { adminApiFetch } from '$lib/server/adminApi.js';

export const DELETE = async ({ cookies, fetch, params }) => {
	const sessionId = String(params.sessionId || '').trim();
	if (!sessionId) return json({ error: 'Upload session is required' }, { status: 400 });

	const response = await adminApiFetch({
		cookies,
		fetch,
		path: `/admin/pending-uploads/${encodeURIComponent(sessionId)}`,
		options: { method: 'DELETE' }
	});
	const payload = await response.json().catch(() => null);
	if (!response.ok) {
		return json({ error: payload?.message || 'Cleanup failed' }, { status: response.status });
	}
	return json(payload?.metadata || { deleted: 0 });
};
