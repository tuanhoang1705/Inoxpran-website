import { json } from '@sveltejs/kit';
import { adminApiFetch } from '$lib/server/adminApi.js';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const POST = async ({ request, cookies, fetch }) => {
	const form = await request.formData();
	const file = form.get('image');
	const kind = String(form.get('kind') || 'gallery') === 'thumb' ? 'thumb' : 'gallery';
	if (!file || typeof file.arrayBuffer !== 'function') {
		return json({ error: 'Image is required' }, { status: 400 });
	}
	if (file.size > MAX_IMAGE_BYTES) {
		return json({ error: 'Image must be 5MB or smaller' }, { status: 400 });
	}

	const payload = new FormData();
	payload.set('image', file);
	const uploadSessionId = String(form.get('upload_session_id') || '').trim();
	if (uploadSessionId) payload.set('upload_session_id', uploadSessionId);
	const response = await adminApiFetch({
		cookies,
		fetch,
		path: `/admin/product-images/${kind}`,
		options: { method: 'POST', body: payload }
	});
	const result = await response.json().catch(() => null);
	if (!response.ok) {
		return json({ error: result?.message || 'Upload failed' }, { status: response.status });
	}
	return json(result?.metadata || {});
};
