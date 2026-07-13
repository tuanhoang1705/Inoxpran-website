import { json } from '@sveltejs/kit';
import { getAdminSession } from '$lib/server/adminAuth.js';

const ALLOWED_IMAGE_HOSTS = new Set(['firebasestorage.googleapis.com', 'storage.googleapis.com']);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export const GET = async ({ cookies, fetch, url }) => {
	if (!getAdminSession(cookies)) {
		return json({ message: 'Admin session required' }, { status: 401 });
	}

	const rawSource = String(url.searchParams.get('url') || '').trim();
	let source;
	try {
		source = new URL(rawSource);
	} catch {
		return json({ message: 'A valid image URL is required' }, { status: 400 });
	}

	if (source.protocol !== 'https:' || !ALLOWED_IMAGE_HOSTS.has(source.hostname)) {
		return json({ message: 'Image host is not allowed' }, { status: 400 });
	}

	let response;
	try {
		response = await fetch(source, {
			headers: { accept: 'image/*' },
			redirect: 'error'
		});
	} catch {
		return json({ message: 'Unable to load the source image' }, { status: 502 });
	}

	if (!response.ok) {
		return json({ message: 'Unable to load the source image' }, { status: response.status });
	}

	const contentType = String(response.headers.get('content-type') || '').toLowerCase();
	if (!contentType.startsWith('image/')) {
		return json({ message: 'The source URL did not return an image' }, { status: 415 });
	}

	const declaredLength = Number(response.headers.get('content-length') || 0);
	if (declaredLength > MAX_IMAGE_BYTES) {
		return json({ message: 'The source image is too large' }, { status: 413 });
	}

	const image = await response.arrayBuffer();
	if (image.byteLength > MAX_IMAGE_BYTES) {
		return json({ message: 'The source image is too large' }, { status: 413 });
	}

	return new Response(image, {
		headers: {
			'content-type': contentType,
			'content-length': String(image.byteLength),
			'cache-control': 'private, max-age=300'
		}
	});
};
