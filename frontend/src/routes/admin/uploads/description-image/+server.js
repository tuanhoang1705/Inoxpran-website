import { json } from '@sveltejs/kit';
import { adminApiFetch } from '$lib/server/adminApi.js';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const isFileLike = (value) =>
	Boolean(
		value &&
			typeof value === 'object' &&
			typeof value.size === 'number' &&
			typeof value.type === 'string' &&
			typeof value.arrayBuffer === 'function'
	);

export const POST = async ({ request, cookies, fetch }) => {
	let form;
	try {
		form = await request.formData();
	} catch {
		return json(
			{ error: 'Upload failed: request body is too large. Increase frontend BODY_SIZE_LIMIT.' },
			{ status: 413 }
		);
	}

	const file = form.get('image');
	if (!isFileLike(file)) {
		return json({ error: 'Image is required' }, { status: 400 });
	}
	if (file.size > MAX_IMAGE_BYTES) {
		return json({ error: 'Image must be 5MB or smaller' }, { status: 400 });
	}
	if (!file.type.startsWith('image/')) {
		return json({ error: 'Only image files are allowed' }, { status: 400 });
	}

	const payload = new FormData();
	payload.set('image', file);
	const uploadSessionId = String(form.get('upload_session_id') || '').trim();
	const entityType = String(form.get('entity_type') || 'product').trim();
	if (uploadSessionId) payload.set('upload_session_id', uploadSessionId);
	payload.set('entity_type', entityType === 'blog' ? 'blog' : 'product');

	let response;
	try {
		response = await adminApiFetch({
			cookies,
			fetch,
			path: '/admin/description-images',
			options: {
				method: 'POST',
				body: payload
			}
		});
	} catch {
		return json({ error: 'Cannot connect to backend API' }, { status: 502 });
	}

	const data = await response.json().catch(() => null);
	if (!response.ok) {
		return json({ error: data?.message || 'Upload failed' }, { status: response.status });
	}

	return json({
		url: data?.metadata?.url,
		path: data?.metadata?.path
	});
};
