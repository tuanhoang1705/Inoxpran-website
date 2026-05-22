import { fail, redirect } from '@sveltejs/kit';
import { API_BASE } from '$lib/server/api.js';
import { getTranslator } from '$lib/i18n/admin/server.js';
import { buildAdminHeaders, getAdminSession } from '$lib/server/adminAuth.js';
import { setAdminToast } from '$lib/server/adminToast.js';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const parsePayload = async (response) => {
	try {
		return await response.json();
	} catch {
		return null;
	}
};

const isFileLike = (value) =>
	Boolean(
		value &&
			typeof value === 'object' &&
			typeof value.size === 'number' &&
			typeof value.type === 'string' &&
			typeof value.arrayBuffer === 'function'
	);

const failWithToast = (status, message) =>
	fail(status, {
		error: message,
		toast: { tone: 'error', message }
	});

const loadRelatedOptions = async ({ fetch, headers }) => {
	const params = new URLSearchParams();
	params.set('status', 'all');
	params.set('limit', '200');
	params.set('page', '1');
	const response = await fetch(`${API_BASE}/blog/admin/all?${params.toString()}`, {
		headers
	});
	const payload = await parsePayload(response);
	if (!response.ok) return [];
	const items = payload?.metadata?.items;
	return Array.isArray(items) ? items : [];
};

export const load = async ({ cookies, fetch }) => {
	const session = getAdminSession(cookies);
	const headers = buildAdminHeaders(session);

	return {
		relatedOptions: await loadRelatedOptions({ fetch, headers })
	};
};

export const actions = {
	default: async ({ request, cookies, fetch }) => {
		const session = getAdminSession(cookies);
		const headers = buildAdminHeaders(session);
		const t = getTranslator(cookies);
		let form;

		try {
			form = await request.formData();
		} catch {
			const message =
				'Upload failed: request body is too large. Increase frontend BODY_SIZE_LIMIT (e.g. 10M).';
			return failWithToast(413, message);
		}

		const blogTitle = String(form.get('blog_title') || '').trim();
		const blogSlug = String(form.get('blog_slug') || '').trim();
		const blogExcerpt = String(form.get('blog_excerpt') || '').trim();
		const blogContent = String(form.get('blog_content') || '').trim();
		const blogCategoryKey = String(form.get('blog_category_key') || 'guide').trim();
		const blogImageCropped = String(form.get('blog_image_cropped') || '').trim();
		const blogImageName = String(form.get('blog_image_name') || '').trim();
		const blogImageCropState = String(form.get('blog_image_crop_state') || '').trim();
		const blogImage = form.get('blog_image');
		const hasCroppedImage = blogImageCropped.startsWith('data:image/');
		const hasUploadImage = isFileLike(blogImage) && blogImage.size > 0;
		const hasImage = hasCroppedImage || hasUploadImage;

		if (!blogTitle || !blogExcerpt || !blogContent || !hasImage) {
			return failWithToast(400, t('admin.blogEditor.errors.missingRequired'));
		}

		if (hasUploadImage && blogImage.size > MAX_IMAGE_BYTES) {
			return failWithToast(400, 'Cover image must be 5MB or smaller.');
		}

		if (hasUploadImage && !blogImage.type.startsWith('image/')) {
			return failWithToast(400, 'Only image files are allowed for blog cover.');
		}

		const payload = new FormData();
		payload.set('blog_title', blogTitle);
		payload.set('blog_excerpt', blogExcerpt);
		payload.set('blog_content', blogContent);
		payload.set('blog_category_key', blogCategoryKey);
		if (hasCroppedImage) {
			payload.set('blog_image', blogImageCropped);
			if (blogImageName) payload.set('blog_image_name', blogImageName);
		} else {
			payload.set('blog_image', blogImage);
		}
		if (blogImageCropState) {
			payload.set('blog_image_crop_state', blogImageCropState);
		}
		if (blogSlug) payload.set('blog_slug', blogSlug);

		const optionalFields = [
			'blog_author_name',
			'blog_author_avatar',
			'blog_tags',
			'blog_seo_title',
			'blog_seo_description',
			'blog_read_time_minutes',
			'blog_comments_count',
			'blog_views',
			'blog_related_post_ids',
			'status',
			'send_newsletter'
		];

		optionalFields.forEach((field) => {
			const value = String(form.get(field) || '').trim();
			if (value) payload.set(field, value);
		});

		let response;
		try {
			response = await fetch(`${API_BASE}/blog`, {
				method: 'POST',
				headers,
				body: payload
			});
		} catch {
			return failWithToast(502, 'Cannot connect to backend API while creating blog post.');
		}

		const result = await parsePayload(response);
		if (!response.ok) {
			const message = result?.message || t('admin.blogEditor.errors.createFailed');
			return failWithToast(response.status, message);
		}

		const createdId = result?.metadata?._id || result?.metadata?.id;
		setAdminToast(cookies, {
			tone: 'success',
			message: t('admin.blogEditor.success.created')
		});

		if (createdId) {
			throw redirect(303, `/admin/blogs/${createdId}`);
		}
		throw redirect(303, '/admin/blogs');
	}
};
