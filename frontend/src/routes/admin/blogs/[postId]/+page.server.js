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

export const load = async ({ cookies, fetch, params }) => {
	const session = getAdminSession(cookies);
	const headers = buildAdminHeaders(session);
	const t = getTranslator(cookies);

	const [postResponse, optionsResponse] = await Promise.all([
		fetch(`${API_BASE}/blog/admin/${params.postId}`, { headers }),
		fetch(`${API_BASE}/blog/admin/all?status=all&limit=200&page=1`, { headers })
	]);

	if (!postResponse.ok) {
		return {
			post: null,
			apiError: t('admin.blogEditor.errors.load'),
			relatedOptions: []
		};
	}

	const postPayload = await parsePayload(postResponse);
	const optionsPayload = await parsePayload(optionsResponse);
	const post = postPayload?.metadata || null;
	const optionsRaw = optionsPayload?.metadata?.items;
	const relatedOptions = Array.isArray(optionsRaw)
		? optionsRaw.filter((item) => item?._id && item._id !== post?._id)
		: [];

	return {
		post,
		relatedOptions,
		apiError: null
	};
};

const resolveErrorMessage = async (response, fallback) => {
	const payload = await parsePayload(response);
	return payload?.message || fallback;
};

export const actions = {
	update: async ({ request, cookies, fetch, params }) => {
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
		const blogExcerpt = String(form.get('blog_excerpt') || '').trim();
		const blogContent = String(form.get('blog_content') || '').trim();
		const existingImage = String(form.get('blog_image_existing') || '').trim();
		const blogImageCropped = String(form.get('blog_image_cropped') || '').trim();
		const blogImageName = String(form.get('blog_image_name') || '').trim();
		const blogImageCropState = String(form.get('blog_image_crop_state') || '').trim();
		const imageFile = form.get('blog_image');
		const hasCroppedImage = blogImageCropped.startsWith('data:image/');
		const hasNewImage = isFileLike(imageFile) && imageFile.size > 0;
		const hasImage = hasCroppedImage || hasNewImage || Boolean(existingImage);

		if (!blogTitle || !blogExcerpt || !blogContent || !hasImage) {
			const message = t('admin.blogEditor.errors.missingRequired');
			return failWithToast(400, message);
		}

		if (hasNewImage && imageFile.size > MAX_IMAGE_BYTES) {
			return failWithToast(400, 'Cover image must be 5MB or smaller.');
		}

		if (hasNewImage && !imageFile.type.startsWith('image/')) {
			return failWithToast(400, 'Only image files are allowed for blog cover.');
		}

		const payload = new FormData();
		payload.set('blog_title', blogTitle);
		payload.set('blog_excerpt', blogExcerpt);
		payload.set('blog_content', blogContent);
		payload.set('blog_category_key', String(form.get('blog_category_key') || 'guide').trim());
		payload.set('status', String(form.get('status') || 'draft').trim());

		if (hasCroppedImage) {
			payload.set('blog_image', blogImageCropped);
			if (blogImageName) payload.set('blog_image_name', blogImageName);
		} else if (hasNewImage) {
			payload.set('blog_image', imageFile);
		} else {
			payload.set('blog_image', existingImage);
		}
		if (blogImageCropState) {
			payload.set('blog_image_crop_state', blogImageCropState);
		}

		const optionalFields = [
			'blog_slug',
			'blog_author_name',
			'blog_author_avatar',
			'blog_tags',
			'blog_seo_title',
			'blog_seo_description',
			'blog_read_time_minutes',
			'blog_comments_count',
			'blog_views',
			'blog_related_post_ids',
			'send_newsletter'
		];
		optionalFields.forEach((field) => {
			const value = String(form.get(field) || '').trim();
			if (value) payload.set(field, value);
		});

		let response;
		try {
			response = await fetch(`${API_BASE}/blog/${params.postId}`, {
				method: 'PATCH',
				headers,
				body: payload
			});
		} catch {
			return failWithToast(502, 'Cannot connect to backend API while updating blog post.');
		}
		if (!response.ok) {
			const message = await resolveErrorMessage(
				response,
				t('admin.blogEditor.errors.updateFailed')
			);
			return failWithToast(response.status, message);
		}

		const updated = await parsePayload(response);
		return {
			success: true,
			post: updated?.metadata,
			toast: { tone: 'success', message: t('admin.blogEditor.success.updated') }
		};
	},
	publish: async ({ cookies, fetch, params, request }) => {
		const session = getAdminSession(cookies);
		const headers = buildAdminHeaders(session);
		const t = getTranslator(cookies);
		let body;
		try {
			const form = await request.formData();
			const sendNewsletter = String(form.get('send_newsletter') || '').trim();
			if (sendNewsletter) {
				headers['content-type'] = 'application/json';
				body = JSON.stringify({ send_newsletter: sendNewsletter });
			}
		} catch {
			body = undefined;
		}

		const response = await fetch(`${API_BASE}/blog/publish/${params.postId}`, {
			method: 'POST',
			headers,
			body
		});
		if (!response.ok) {
			const message = await resolveErrorMessage(
				response,
				t('admin.blogEditor.errors.publishFailed')
			);
			return fail(response.status, { error: message, toast: { tone: 'error', message } });
		}

		setAdminToast(cookies, { tone: 'success', message: t('admin.blogEditor.success.published') });
		throw redirect(303, `/admin/blogs/${params.postId}`);
	},
	unpublish: async ({ cookies, fetch, params }) => {
		const session = getAdminSession(cookies);
		const headers = buildAdminHeaders(session);
		const t = getTranslator(cookies);
		const response = await fetch(`${API_BASE}/blog/unpublish/${params.postId}`, {
			method: 'POST',
			headers
		});
		if (!response.ok) {
			const message = await resolveErrorMessage(
				response,
				t('admin.blogEditor.errors.unpublishFailed')
			);
			return fail(response.status, { error: message, toast: { tone: 'error', message } });
		}

		setAdminToast(cookies, { tone: 'success', message: t('admin.blogEditor.success.unpublished') });
		throw redirect(303, `/admin/blogs/${params.postId}`);
	},
	delete: async ({ cookies, fetch, params }) => {
		const session = getAdminSession(cookies);
		const headers = buildAdminHeaders(session);
		const t = getTranslator(cookies);
		const response = await fetch(`${API_BASE}/blog/${params.postId}`, {
			method: 'DELETE',
			headers
		});
		if (!response.ok) {
			const message = await resolveErrorMessage(
				response,
				t('admin.blogEditor.errors.deleteFailed')
			);
			return fail(response.status, { error: message, toast: { tone: 'error', message } });
		}

		setAdminToast(cookies, { tone: 'success', message: t('admin.blogEditor.success.deleted') });
		throw redirect(303, '/admin/blogs');
	}
};
