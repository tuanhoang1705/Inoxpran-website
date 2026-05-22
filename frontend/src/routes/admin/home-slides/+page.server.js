import { fail, redirect } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { API_BASE } from '$lib/server/api.js';
import { buildAdminHeaders, getAdminSession } from '$lib/server/adminAuth.js';
import { setAdminToast } from '$lib/server/adminToast.js';

const MAX_SLIDES = 5;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const parsePayload = async (response) => {
	try {
		return await response.json();
	} catch {
		return null;
	}
};

const isFileLike = (value) =>
	Boolean(value) &&
	typeof value === 'object' &&
	typeof value.size === 'number' &&
	typeof value.type === 'string' &&
	typeof value.name === 'string';

const normalizeSlide = (value = {}) => ({
	id: String(value?.id || '').trim(),
	imageUrl: String(value?.imageUrl || '').trim(),
	imagePath: String(value?.imagePath || '').trim(),
	imageVariants:
		value?.imageVariants && typeof value.imageVariants === 'object' && !Array.isArray(value.imageVariants)
			? value.imageVariants
			: null
});

const normalizeSlides = (value) => {
	const slides = Array.isArray(value) ? value : [];
	return slides.map(normalizeSlide).filter((slide) => slide.id && slide.imageUrl);
};

export const load = async ({ cookies, fetch }) => {
	const session = getAdminSession(cookies);
	const headers = buildAdminHeaders(session);

	try {
		const response = await fetch(`${API_BASE}/admin/home-slides`, { headers });
		if (!response.ok) {
			const payload = await parsePayload(response);
			return {
				slides: [],
				maxItems: MAX_SLIDES,
				apiError: payload?.message || 'Cannot load home slides.'
			};
		}

		const payload = await parsePayload(response);
		const metadata = payload?.metadata || {};
		return {
			slides: normalizeSlides(metadata?.slides),
			maxItems: Number(metadata?.maxItems) || MAX_SLIDES,
			updatedAt: metadata?.updatedAt || null
		};
	} catch {
		return {
			slides: [],
			maxItems: MAX_SLIDES,
			apiError: 'Cannot connect to backend API while loading home slides.'
		};
	}
};

export const actions = {
	upload: async ({ request, cookies, fetch }) => {
		const session = getAdminSession(cookies);
		const headers = buildAdminHeaders(session);
		const form = await request.formData();

		const currentCountValue = Number(form.get('current_count') || 0);
		const currentCount = Number.isFinite(currentCountValue) && currentCountValue > 0 ? currentCountValue : 0;
		const remainingSlots = Math.max(0, MAX_SLIDES - currentCount);
		if (remainingSlots <= 0) {
			return fail(400, {
				action: 'upload',
				uploadError: `Maximum ${MAX_SLIDES} slides allowed.`,
				toast: { tone: 'error', message: `Maximum ${MAX_SLIDES} slides allowed.` }
			});
		}

		const pickedFiles = form
			.getAll('images')
			.filter(isFileLike)
			.filter((file) => file.size > 0);
		const legacyImage = form.get('image');
		const images = pickedFiles.length
			? pickedFiles
			: isFileLike(legacyImage) && legacyImage.size > 0
				? [legacyImage]
				: [];

		if (!images.length) {
			return fail(400, {
				action: 'upload',
				uploadError: 'Please choose an image to upload.'
			});
		}

		if (images.length > remainingSlots) {
			return fail(400, {
				action: 'upload',
				uploadError: `You can upload up to ${remainingSlots} more image${remainingSlots > 1 ? 's' : ''}.`
			});
		}

		for (const image of images) {
			if (!String(image.type || '').startsWith('image/')) {
				return fail(400, {
					action: 'upload',
					uploadError: `Only image files are allowed (${image.name || 'unknown file'}).`
				});
			}
			if (image.size > MAX_IMAGE_BYTES) {
				return fail(400, {
					action: 'upload',
					uploadError: `Image "${image.name || 'file'}" must be 5MB or smaller.`
				});
			}
		}

		const uploadedSlides = [];

		for (const image of images) {
			const payload = new FormData();
			payload.set('image', image);

			const uploadRes = await fetch(`${API_BASE}/admin/home-slides/image`, {
				method: 'POST',
				headers,
				body: payload
			});
			const uploadResult = await parsePayload(uploadRes);
			if (!uploadRes.ok) {
				const uploadBatchToken = uploadedSlides.length ? randomUUID() : '';
				return fail(uploadRes.status, {
					action: 'upload',
					uploadBatchToken,
					uploadedSlides,
					uploadError:
						uploadResult?.message ||
						(uploadedSlides.length
							? 'One or more slide uploads failed. Uploaded slides were kept in the draft list.'
							: 'Slide image upload failed.')
				});
			}

			const imageUrl = String(uploadResult?.metadata?.url || '').trim();
			const imagePath = String(uploadResult?.metadata?.path || '').trim();
			const imageVariants =
				uploadResult?.metadata?.variants &&
				typeof uploadResult.metadata.variants === 'object' &&
				!Array.isArray(uploadResult.metadata.variants)
					? uploadResult.metadata.variants
					: null;
			if (!imageUrl) {
				const uploadBatchToken = uploadedSlides.length ? randomUUID() : '';
				return fail(500, {
					action: 'upload',
					uploadBatchToken,
					uploadedSlides,
					uploadError:
						uploadedSlides.length
							? 'One or more slide uploads failed. Uploaded slides were kept in the draft list.'
							: 'Slide image upload failed.'
				});
			}

			uploadedSlides.push({
				id: randomUUID(),
				imageUrl,
				imagePath,
				imageVariants
			});
		}

		return {
			action: 'upload',
			uploadBatchToken: randomUUID(),
			uploadedSlides,
			toast: {
				tone: 'success',
				message: `${uploadedSlides.length} slide image${uploadedSlides.length > 1 ? 's' : ''} uploaded. Review and click Save.`
			}
		};
	},
	save: async ({ request, cookies, fetch }) => {
		const session = getAdminSession(cookies);
		const headers = buildAdminHeaders(session);
		const form = await request.formData();
		const rawSlides = String(form.get('slides_json') || '').trim();

		let slides = [];
		if (rawSlides) {
			try {
				slides = normalizeSlides(JSON.parse(rawSlides));
			} catch {
				return fail(400, { action: 'save', saveError: 'Invalid slide payload.' });
			}
		}

		if (slides.length > MAX_SLIDES) {
			return fail(400, {
				action: 'save',
				saveError: `Maximum ${MAX_SLIDES} slides allowed.`
			});
		}

		const response = await fetch(`${API_BASE}/admin/home-slides`, {
			method: 'PUT',
			headers: {
				...headers,
				'content-type': 'application/json'
			},
			body: JSON.stringify({ slides })
		});
		const payload = await parsePayload(response);
		if (!response.ok) {
			return fail(response.status, {
				action: 'save',
				saveError: payload?.message || 'Cannot save home slides.'
			});
		}

		setAdminToast(cookies, {
			tone: 'success',
			message: 'Home slides updated successfully.'
		});
		throw redirect(303, '/admin/home-slides');
	}
};
