<script>
	import { resolve } from '$app/paths';
	import { onDestroy, onMount } from 'svelte';
	import { pushToast } from '$lib/stores/adminToast.js';
	import { t } from '$lib/i18n/admin/index.js';
	import RichTextEditor from '$lib/components/RichTextEditor.svelte';
	import { toSeoSlug } from '$lib/utils/seoSlug.js';

	let { data, form } = $props();

	const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
	const WORDS_PER_MINUTE = 220;
	const MAX_RELATED_POSTS = 3;
	let blogTitle = $state('');
	let blogSlug = $state('');
	let blogExcerpt = $state('');
	let blogContent = $state('');
	let tagInput = $state('');
	let tags = $state([]);
	let relatedPostIds = $state([]);
	let slugTouched = $state(false);
	let coverPreviewUrl = $state('');
	let cropFrame = $state(null);
	let cropImageEl = $state(null);
	let cropZoom = $state(1);
	let cropOffsetX = $state(0);
	let cropOffsetY = $state(0);
	let cropBaseScale = $state(1);
	let croppedPreviewUrl = $state('');
	let lastCropState = $state(null);
	let cropFileName = $state('');
	let isDraggingCrop = $state(false);
	let dragStartX = $state(0);
	let dragStartY = $state(0);
	let dragStartOffsetX = $state(0);
	let dragStartOffsetY = $state(0);
	let sendNewsletter = $state(false);
	let imageError = $state('');

	const categories = $derived([
		{ value: 'guide', label: $t('blog.categoryGuide') },
		{ value: 'care', label: $t('blog.categoryCare') },
		{ value: 'knowledge', label: $t('blog.categoryKnowledge') },
		{ value: 'trend', label: $t('blog.categoryTrend') },
		{ value: 'product', label: $t('blog.categoryProduct') },
		{ value: 'design', label: $t('blog.categoryDesign') }
	]);

	const plainTextFromHtml = (html) =>
		String(html || '')
			.replace(/<[^>]+>/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();

	const wordCount = $derived.by(
		() => plainTextFromHtml(blogContent).split(' ').filter(Boolean).length
	);

	const autoReadTime = $derived(Math.max(1, Math.ceil(wordCount / WORDS_PER_MINUTE)));
	const previewCover = $derived(croppedPreviewUrl || coverPreviewUrl);

	const updateSlugManually = (event) => {
		slugTouched = true;
		blogSlug = toSeoSlug(event.currentTarget.value);
	};

	const regenerateSlugFromTitle = () => {
		slugTouched = false;
		blogSlug = toSeoSlug(blogTitle);
	};

	const resetCropState = () => {
		cropZoom = 1;
		cropOffsetX = 0;
		cropOffsetY = 0;
		cropBaseScale = 1;
		croppedPreviewUrl = '';
	};

	const isSameCropState = (state) => {
		if (!state) return false;
		return (
			Math.abs(cropZoom - (state.zoom ?? 1)) < 0.001 &&
			Math.abs(cropOffsetX - (state.offsetX ?? 0)) < 0.5 &&
			Math.abs(cropOffsetY - (state.offsetY ?? 0)) < 0.5
		);
	};

	const restoreLastCropState = () => {
		if (!lastCropState) return false;
		cropZoom = lastCropState.zoom ?? 1;
		cropOffsetX = lastCropState.offsetX ?? 0;
		cropOffsetY = lastCropState.offsetY ?? 0;
		const clamped = clampCropOffsets(cropOffsetX, cropOffsetY);
		cropOffsetX = clamped.x;
		cropOffsetY = clamped.y;
		return true;
	};

	const addTag = () => {
		const value = String(tagInput || '').trim();
		if (!value) return;
		const exists = tags.some((tag) => tag.toLowerCase() === value.toLowerCase());
		if (!exists) tags = [...tags, value];
		tagInput = '';
	};

	const removeTag = (value) => {
		tags = tags.filter((tag) => tag !== value);
	};

	const handleTagKey = (event) => {
		if (event.key !== 'Enter') return;
		event.preventDefault();
		addTag();
	};

	const toggleRelatedPost = (id) => {
		const normalizedId = String(id || '').trim();
		if (!normalizedId) return;
		if (relatedPostIds.includes(normalizedId)) {
			relatedPostIds = relatedPostIds.filter((value) => value !== normalizedId);
			return;
		}
		if (relatedPostIds.length >= MAX_RELATED_POSTS) return;
		relatedPostIds = [...relatedPostIds, normalizedId];
	};

	const handleCoverChange = (event) => {
		const input = event.currentTarget;
		const file = input?.files?.[0];
		imageError = '';

		if (coverPreviewUrl) {
			URL.revokeObjectURL(coverPreviewUrl);
			coverPreviewUrl = '';
		}
		cropFileName = '';
		lastCropState = null;
		resetCropState();

		if (!file) return;
		if (!file.type?.startsWith('image/')) {
			imageError = $t('admin.blogEditor.errors.imageInvalid');
			input.value = '';
			return;
		}
		if (file.size > MAX_IMAGE_BYTES) {
			imageError = $t('admin.blogEditor.errors.imageTooLarge', { size: '5MB' });
			input.value = '';
			return;
		}
		cropFileName = file.name || '';
		coverPreviewUrl = URL.createObjectURL(file);
	};

	const updateCropBaseScale = () => {
		if (!cropFrame || !cropImageEl) return;
		const frameWidth = cropFrame.clientWidth;
		const frameHeight = cropFrame.clientHeight;
		const imageWidth = cropImageEl.naturalWidth;
		const imageHeight = cropImageEl.naturalHeight;
		if (!frameWidth || !frameHeight || !imageWidth || !imageHeight) return;
		cropBaseScale = Math.max(frameWidth / imageWidth, frameHeight / imageHeight);
		const clamped = clampCropOffsets(cropOffsetX, cropOffsetY);
		cropOffsetX = clamped.x;
		cropOffsetY = clamped.y;
	};

	const clampCropOffsets = (nextX, nextY) => {
		if (!cropFrame || !cropImageEl) return { x: nextX, y: nextY };
		const frameWidth = cropFrame.clientWidth;
		const frameHeight = cropFrame.clientHeight;
		const imageWidth = cropImageEl.naturalWidth;
		const imageHeight = cropImageEl.naturalHeight;
		if (!frameWidth || !frameHeight || !imageWidth || !imageHeight) {
			return { x: nextX, y: nextY };
		}
		const scale = cropBaseScale * cropZoom;
		const scaledWidth = imageWidth * scale;
		const scaledHeight = imageHeight * scale;
		const maxX = Math.max(0, (scaledWidth - frameWidth) / 2);
		const maxY = Math.max(0, (scaledHeight - frameHeight) / 2);
		return {
			x: Math.min(maxX, Math.max(-maxX, nextX)),
			y: Math.min(maxY, Math.max(-maxY, nextY))
		};
	};

	const handleCropPointerDown = (event) => {
		if (!cropFrame) return;
		isDraggingCrop = true;
		dragStartX = event.clientX;
		dragStartY = event.clientY;
		dragStartOffsetX = cropOffsetX;
		dragStartOffsetY = cropOffsetY;
		cropFrame.setPointerCapture?.(event.pointerId);
	};

	const handleCropPointerMove = (event) => {
		if (!isDraggingCrop) return;
		const nextX = dragStartOffsetX + (event.clientX - dragStartX);
		const nextY = dragStartOffsetY + (event.clientY - dragStartY);
		const clamped = clampCropOffsets(nextX, nextY);
		cropOffsetX = clamped.x;
		cropOffsetY = clamped.y;
	};

	const handleCropPointerUp = (event) => {
		if (!isDraggingCrop) return;
		isDraggingCrop = false;
		cropFrame?.releasePointerCapture?.(event.pointerId);
	};

	const applyCrop = () => {
		if (!cropFrame || !cropImageEl) return;
		const frameWidth = cropFrame.clientWidth;
		const frameHeight = cropFrame.clientHeight;
		const imageWidth = cropImageEl.naturalWidth;
		const imageHeight = cropImageEl.naturalHeight;
		if (!frameWidth || !frameHeight || !imageWidth || !imageHeight) return;

		const scale = cropBaseScale * cropZoom;
		const scaledWidth = imageWidth * scale;
		const scaledHeight = imageHeight * scale;
		const topLeftX = (frameWidth - scaledWidth) / 2 + cropOffsetX;
		const topLeftY = (frameHeight - scaledHeight) / 2 + cropOffsetY;

		const cropX = Math.max(0, -topLeftX / scale);
		const cropY = Math.max(0, -topLeftY / scale);
		const cropWidth = Math.min(imageWidth, frameWidth / scale);
		const cropHeight = Math.min(imageHeight, frameHeight / scale);

		const outputWidth = 1200;
		const outputHeight = Math.round(outputWidth * (frameHeight / frameWidth));
		const canvas = document.createElement('canvas');
		canvas.width = outputWidth;
		canvas.height = outputHeight;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		ctx.drawImage(
			cropImageEl,
			cropX,
			cropY,
			cropWidth,
			cropHeight,
			0,
			0,
			outputWidth,
			outputHeight
		);
		croppedPreviewUrl = canvas.toDataURL('image/jpeg', 0.9);
		lastCropState = {
			zoom: cropZoom,
			offsetX: cropOffsetX,
			offsetY: cropOffsetY
		};
	};

	onMount(() => {
		if (form?.toast) {
			pushToast(form.toast);
		}

		if (typeof window !== 'undefined') {
			const handleResize = () => updateCropBaseScale();
			window.addEventListener('resize', handleResize);
			return () => window.removeEventListener('resize', handleResize);
		}
	});

	onDestroy(() => {
		if (coverPreviewUrl) {
			URL.revokeObjectURL(coverPreviewUrl);
		}
	});

	$effect(() => {
		if (slugTouched) return;
		blogSlug = toSeoSlug(blogTitle);
	});
</script>

<svelte:head>
	<title>{$t('admin.blogEditor.createTitle')} | Inoxpran</title>
</svelte:head>

<section class="d-grid gap-3">
	<div class="d-flex flex-wrap gap-2 justify-content-between align-items-start">
		<div>
			<h2 class="mb-1">{$t('admin.blogEditor.createTitle')}</h2>
			<p class="text-black-50 mb-0">{$t('admin.blogEditor.lede')}</p>
		</div>
		<a class="btn btn-outline-dark" href={resolve('/admin/blogs')}>{$t('admin.blogEditor.back')}</a>
	</div>

	{#if form?.error}
		<div class="alert alert-danger mb-0">{form.error}</div>
	{/if}

	<form method="post" enctype="multipart/form-data" class="row g-3">
		<input type="hidden" name="blog_content" value={blogContent} />
		<input type="hidden" name="blog_tags" value={JSON.stringify(tags)} />
		<input type="hidden" name="blog_related_post_ids" value={JSON.stringify(relatedPostIds)} />
		{#if croppedPreviewUrl}
			<input type="hidden" name="blog_image_cropped" value={croppedPreviewUrl} />
			<input type="hidden" name="blog_image_name" value={cropFileName} />
		{/if}
		{#if lastCropState}
			<input
				type="hidden"
				name="blog_image_crop_state"
				value={JSON.stringify(lastCropState)}
			/>
		{/if}

		<div class="col-12 col-xl-8 d-grid gap-3">
			<div class="border rounded-3 bg-white p-3">
				<h5 class="mb-3">{$t('admin.blogEditor.basicInfo')}</h5>
				<div class="row g-3">
					<div class="col-12">
						<label class="form-label" for="blog-title">{$t('admin.blogEditor.title')}</label>
						<input
							id="blog-title"
							name="blog_title"
							class="form-control"
							required
							bind:value={blogTitle}
						/>
					</div>
					<div class="col-12">
						<label class="form-label" for="blog-slug">{$t('admin.blogEditor.slug')}</label>
						<div class="input-group">
							<input
								id="blog-slug"
								name="blog_slug"
								class="form-control"
								value={blogSlug}
								oninput={updateSlugManually}
							/>
							<button
								type="button"
								class="btn btn-outline-secondary"
								onclick={regenerateSlugFromTitle}
								disabled={!String(blogTitle || '').trim()}
							>
								{$t('admin.blogEditor.regenerateSlug')}
							</button>
						</div>
					</div>
					<div class="col-12">
						<label class="form-label" for="blog-excerpt">{$t('admin.blogEditor.excerpt')}</label>
						<textarea
							id="blog-excerpt"
							name="blog_excerpt"
							class="form-control"
							rows="3"
							required
							bind:value={blogExcerpt}
						></textarea>
					</div>
				</div>
			</div>

			<div class="border rounded-3 bg-white p-3">
				<h5 class="mb-2">{$t('admin.blogEditor.coverImage')}</h5>
				<p class="text-black-50 small mb-2">{$t('admin.blogEditor.coverHint')}</p>
				<input
					type="file"
					name="blog_image"
					class="form-control"
					accept="image/*"
					required
					onchange={handleCoverChange}
				/>
				{#if imageError}
					<div class="text-danger small mt-2">{imageError}</div>
				{/if}
				{#if coverPreviewUrl}
					<div class="cropper mt-3">
						<div
							class="cropper-frame"
							bind:this={cropFrame}
							onpointerdown={handleCropPointerDown}
							onpointermove={handleCropPointerMove}
							onpointerup={handleCropPointerUp}
							onpointerleave={handleCropPointerUp}
						>
							<img
								bind:this={cropImageEl}
								src={coverPreviewUrl}
								alt={$t('admin.blogEditor.cropPreviewAlt')}
								class="cropper-image"
								onload={updateCropBaseScale}
								draggable="false"
								style={`transform: translate(-50%, -50%) translate(${cropOffsetX}px, ${cropOffsetY}px) scale(${cropBaseScale * cropZoom});`}
							/>
						</div>
						<div class="cropper-controls">
							<div class="cropper-zoom">
								<label for="crop-zoom">{$t('admin.blogEditor.cropZoom')}</label>
								<input
									id="crop-zoom"
									type="range"
									min="1"
									max="3"
									step="0.01"
									bind:value={cropZoom}
									oninput={() => {
										const clamped = clampCropOffsets(cropOffsetX, cropOffsetY);
										cropOffsetX = clamped.x;
										cropOffsetY = clamped.y;
									}}
								/>
							</div>
							<div class="cropper-actions">
								<button
									type="button"
									class="btn btn-outline-secondary btn-sm"
									onclick={() => {
										if (lastCropState && !isSameCropState(lastCropState)) {
											restoreLastCropState();
										} else {
											resetCropState();
										}
										updateCropBaseScale();
									}}
								>
									{$t('common.reset')}
								</button>
								<button type="button" class="btn btn-dark btn-sm" onclick={applyCrop}>
									{$t('admin.blogEditor.cropApply')}
								</button>
							</div>
						</div>
						<p class="cropper-hint text-black-50 small mb-0">
							{$t('admin.blogEditor.cropHint')}
						</p>
					</div>
				{/if}
			</div>

			<div class="border rounded-3 bg-white p-3">
				<h5 class="mb-2">{$t('admin.blogEditor.content')}</h5>
				<p class="text-black-50 small mb-2">{$t('admin.blogEditor.contentHint')}</p>
				<RichTextEditor
					value={blogContent}
					onChange={(value) => {
						blogContent = value;
					}}
					placeholder={$t('admin.editor.placeholder')}
				/>
				<div class="d-flex justify-content-between align-items-center mt-2 text-black-50 small">
					<span>{$t('admin.blogEditor.wordCount', { count: wordCount })}</span>
					<span>{$t('admin.blogEditor.autoReadTime', { minutes: autoReadTime })}</span>
				</div>
			</div>

			<div class="border rounded-3 bg-white p-3">
				<h5 class="mb-2">{$t('admin.blogEditor.tags')}</h5>
				<div class="input-group mb-2">
					<input
						class="form-control"
						placeholder={$t('admin.blogEditor.tagPlaceholder')}
						bind:value={tagInput}
						onkeydown={handleTagKey}
					/>
					<button class="btn btn-outline-dark" type="button" onclick={addTag}>Add</button>
				</div>
				<div class="text-black-50 small mb-2">{$t('admin.blogEditor.tagsHint')}</div>
				<div class="d-flex flex-wrap gap-2">
					{#each tags as tag (tag)}
						<button
							type="button"
							class="btn btn-sm btn-outline-secondary"
							onclick={() => removeTag(tag)}
						>
							#{tag} x
						</button>
					{/each}
				</div>
			</div>

			<div class="border rounded-3 bg-white p-3">
				<h5 class="mb-3">{$t('admin.blogEditor.seo')}</h5>
				<div class="row g-3">
					<div class="col-12">
						<label class="form-label" for="blog-seo-title">{$t('admin.blogEditor.seoTitle')}</label>
						<input id="blog-seo-title" name="blog_seo_title" class="form-control" />
					</div>
					<div class="col-12">
						<label class="form-label" for="blog-seo-description"
							>{$t('admin.blogEditor.seoDescription')}</label
						>
						<textarea
							id="blog-seo-description"
							name="blog_seo_description"
							class="form-control"
							rows="3"
						></textarea>
					</div>
				</div>
			</div>
		</div>

		<div class="col-12 col-xl-4 d-grid gap-3">
			<div class="border rounded-3 bg-white p-3">
				<h5 class="mb-3">{$t('admin.blogEditor.meta')}</h5>
				<div class="d-grid gap-2">
					<div>
						<label class="form-label" for="blog-status">{$t('admin.blogEditor.status')}</label>
						<select id="blog-status" name="status" class="form-select">
							<option value="draft">{$t('admin.blogEditor.statusDraft')}</option>
							<option value="published">{$t('admin.blogEditor.statusPublished')}</option>
						</select>
					</div>
					<div class="form-check">
						<input
							class="form-check-input"
							type="checkbox"
							id="send-newsletter"
							name="send_newsletter"
							bind:checked={sendNewsletter}
						/>
						<label class="form-check-label" for="send-newsletter">
							{$t('admin.blogEditor.sendNewsletterLabel')}
						</label>
						<div class="form-text">{$t('admin.blogEditor.sendNewsletterHint')}</div>
					</div>
					<div>
						<label class="form-label" for="blog-category">{$t('admin.blogEditor.category')}</label>
						<select id="blog-category" name="blog_category_key" class="form-select">
							{#each categories as category (category.value)}
								<option value={category.value}>{category.label}</option>
							{/each}
						</select>
					</div>
					<div>
						<label class="form-label" for="blog-author-name"
							>{$t('admin.blogEditor.authorName')}</label
						>
						<input id="blog-author-name" name="blog_author_name" class="form-control" />
					</div>
					<div>
						<label class="form-label" for="blog-author-avatar"
							>{$t('admin.blogEditor.authorAvatar')}</label
						>
						<input
							id="blog-author-avatar"
							name="blog_author_avatar"
							class="form-control"
							maxlength="2"
						/>
					</div>
					<div>
						<label class="form-label" for="blog-read-time">{$t('admin.blogEditor.readTime')}</label>
						<input
							id="blog-read-time"
							name="blog_read_time_minutes"
							type="number"
							min="1"
							class="form-control"
							placeholder={String(autoReadTime)}
						/>
					</div>
					<div>
						<label class="form-label" for="blog-comments-count"
							>{$t('admin.blogEditor.commentsCount')}</label
						>
						<input
							id="blog-comments-count"
							name="blog_comments_count"
							type="number"
							min="0"
							class="form-control"
							value="0"
						/>
					</div>
					<div>
						<label class="form-label" for="blog-views">{$t('admin.blogEditor.views')}</label>
						<input
							id="blog-views"
							name="blog_views"
							type="number"
							min="0"
							class="form-control"
							value="0"
						/>
					</div>
				</div>
			</div>

			<div class="border rounded-3 bg-white p-3">
				<h5 class="mb-1">{$t('admin.blogEditor.relatedPosts')}</h5>
				<p class="text-black-50 small mb-2">{$t('admin.blogEditor.relatedHint')}</p>
				{#if data?.relatedOptions?.length}
					<div class="d-grid gap-2 related-list">
						{#each data.relatedOptions as post (post._id)}
							<label class="related-item">
								<input
									type="checkbox"
									checked={relatedPostIds.includes(post._id)}
									onchange={() => toggleRelatedPost(post._id)}
									disabled={!relatedPostIds.includes(post._id) &&
										relatedPostIds.length >= MAX_RELATED_POSTS}
								/>
								<span>{post.title}</span>
							</label>
						{/each}
					</div>
				{:else}
					<div class="text-black-50 small">{$t('admin.blogEditor.relatedEmpty')}</div>
				{/if}
			</div>

			<div class="border rounded-3 bg-white p-3">
				<h5 class="mb-2">{$t('admin.blogEditor.preview')}</h5>
					{#if blogTitle || blogExcerpt}
						<div class="preview-card">
							{#if previewCover}
								<img src={previewCover} alt="Preview cover" />
							{/if}
						<div class="preview-content">
							<h6>{blogTitle || '--'}</h6>
							<p>{blogExcerpt || '--'}</p>
						</div>
					</div>
				{:else}
					<div class="text-black-50 small">{$t('admin.blogEditor.previewEmpty')}</div>
				{/if}
			</div>

			<button class="btn btn-dark btn-lg" type="submit">{$t('admin.blogEditor.create')}</button>
		</div>
	</form>
</section>

<style>
	.related-list {
		max-height: 240px;
		overflow: auto;
	}

	.related-item {
		display: flex;
		gap: 8px;
		align-items: flex-start;
		font-size: 0.9rem;
	}

	.preview-card {
		border: 1px solid #ececec;
		border-radius: 12px;
		overflow: hidden;
		background: #fff;
	}

	.preview-card img {
		width: 100%;
		aspect-ratio: 16 / 9;
		object-fit: cover;
		display: block;
	}

	.preview-content {
		padding: 12px;
	}

	.preview-content h6 {
		margin-bottom: 8px;
	}

	.preview-content p {
		margin: 0;
		color: #666;
		font-size: 0.9rem;
	}

	.cropper {
		display: grid;
		gap: 0.75rem;
	}

	.cropper-frame {
		position: relative;
		width: 100%;
		aspect-ratio: 16 / 9;
		border: 1px dashed #d6d6d6;
		border-radius: 12px;
		overflow: hidden;
		background: #f7f7f7;
		cursor: grab;
		touch-action: none;
	}

	.cropper-frame:active {
		cursor: grabbing;
	}

	.cropper-image {
		position: absolute;
		top: 50%;
		left: 50%;
		will-change: transform;
		user-select: none;
		pointer-events: none;
	}

	.cropper-controls {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.cropper-zoom {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex: 1 1 220px;
	}

	.cropper-zoom input {
		flex: 1;
	}

	.cropper-actions {
		display: flex;
		gap: 0.5rem;
	}
</style>
