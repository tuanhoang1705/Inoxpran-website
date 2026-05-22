<script>
	import { enhance } from '$app/forms';
	import { locale } from '$lib/i18n/admin/index.js';
	import { pushToast } from '$lib/stores/adminToast.js';

	let { data, form } = $props();

	let slides = $state(Array.isArray(data?.slides) ? [...data.slides] : []);
	let draggingId = $state('');
	let draggingIndex = $state(-1);
	let dragOverIndex = $state(-1);
	let lastToastKey = $state('');
	let handledUploadBatchToken = $state('');
	let uploadFormEl = $state(null);
	let uploadInputEl = $state(null);
	let isUploadDragActive = $state(false);
	let uploadDragDepth = $state(0);
	let selectedUploadFiles = $state([]);
	let uploadSelectionNote = $state({ tone: '', message: '' });
	let isUploading = $state(false);
	let isSaving = $state(false);
	let uploadStatus = $state({ tone: '', message: '' });
	let saveStatus = $state({ tone: '', message: '' });

	const maxItems = $derived(Number(data?.maxItems) || 5);
	const canUploadMore = $derived(slides.length < maxItems);
	const remainingSlots = $derived(Math.max(0, maxItems - slides.length));
	const hasSelectedUploadFiles = $derived(selectedUploadFiles.length > 0);
	const slidesPayload = $derived(
		JSON.stringify(
			slides.map((slide) => ({
				id: slide.id,
				imageUrl: slide.imageUrl,
				imagePath: slide.imagePath || '',
				imageVariants: slide.imageVariants || null
			}))
		)
	);

	const getAutoAltVi = (index) => `Slide quảng cáo trang chủ Inoxpran ${index + 1}`;
	const getAutoAltEn = (index) => `Inoxpran homepage promotional slide ${index + 1}`;

	const uploadDropCopy = $derived.by(() =>
		$locale === 'en'
			? {
					prompt: 'Drag and drop images here',
					browse: 'or click to choose files',
					empty: 'No images selected yet.',
					ready: (count) => `${count} image${count === 1 ? '' : 's'} ready to upload`,
					imagesOnly: 'Only image files were kept.',
					limit: (count) =>
						count > 0
							? `Only the first ${count} image${count === 1 ? '' : 's'} were kept.`
							: 'Maximum slide count reached. Remove a slide to upload more.'
				}
			: {
					prompt: 'Kéo thả ảnh vào đây',
					browse: 'hoặc bấm để chọn tệp',
					empty: 'Chưa có ảnh nào được chọn.',
					ready: (count) => `Đã chọn ${count} ảnh sẵn sàng tải lên`,
					imagesOnly: 'Chỉ giữ lại các tệp hình ảnh.',
					limit: (count) =>
						count > 0
							? `Chỉ giữ lại ${count} ảnh đầu tiên do giới hạn slot.`
							: 'Đã đạt tối đa số lượng slide. Hãy xóa bớt ảnh trước khi tải thêm.'
				}
	);
	const selectedUploadSummary = $derived.by(() =>
		selectedUploadFiles.length
			? uploadDropCopy.ready(selectedUploadFiles.length)
			: uploadDropCopy.empty
	);

	const pageCopy = $derived.by(() =>
		$locale === 'en'
			? {
					title: 'Home slides',
					lede: 'Manage the homepage Inox-section ad slider. Upload images, reorder them, then save.',
					uploadTitle: 'Upload images',
					uploadHint:
						'Select one or more images at once. Each image must be exactly 940 x 788px and 5MB or smaller.',
					autoAltTitle: 'Alt text is generated automatically',
					autoAltDesc:
						'VI/EN alt text is auto-created from slide order. You only need to upload images and save.',
					currentTitle: 'Slide list',
					currentHint:
						'Drag to reorder. On the homepage, clicking the slide image moves to the next slide.',
					empty: 'No slides yet. Upload your first image.',
					save: 'Save slides',
					remove: 'Remove',
					moveUp: 'Move up',
					moveDown: 'Move down',
					image: 'Images',
					upload: 'Upload to draft',
					limitReached: 'Maximum slide count reached. Remove a slide to upload more.',
					slotsLeft: 'slots left',
					updatedAt: 'Last updated',
					autoAltViLabel: 'Auto Alt (VI)',
					autoAltEnLabel: 'Auto Alt (EN)',
					orderLabel: 'Order',
					pathLabel: 'Storage path'
				}
			: {
					title: 'Slide trang chủ',
					lede: 'Quản lý slider quảng cáo ở section Inox trang chủ. Tải ảnh lên, sắp xếp rồi bấm lưu.',
					uploadTitle: 'Tải ảnh lên',
					uploadHint:
						'Có thể chọn nhiều ảnh cùng lúc. Mỗi ảnh phải đúng 940 x 788px và tối đa 5MB.',
					autoAltTitle: 'Alt text được tạo tự động',
					autoAltDesc:
						'Alt text VI/EN sẽ tự sinh theo thứ tự slide. Bạn chỉ cần tải ảnh lên và lưu.',
					currentTitle: 'Danh sách slide',
					currentHint:
						'Kéo thả để sắp xếp. Ở trang chủ, khi click ảnh slide sẽ chuyển sang ảnh tiếp theo.',
					empty: 'Chưa có slide nào. Hãy tải lên ảnh đầu tiên.',
					save: 'Lưu slide',
					remove: 'Xóa',
					moveUp: 'Lên',
					moveDown: 'Xuống',
					image: 'Ảnh',
					upload: 'Tải vào bản nháp',
					limitReached: 'Đã đạt tối đa số slide. Hãy xóa bớt trước khi tải thêm.',
					slotsLeft: 'slot còn lại',
					updatedAt: 'Cập nhật lần cuối',
					autoAltViLabel: 'Alt tự sinh (VI)',
					autoAltEnLabel: 'Alt tự sinh (EN)',
					orderLabel: 'Thứ tự',
					pathLabel: 'Đường dẫn lưu trữ'
				}
	);

	const actionCopy = $derived.by(() =>
		$locale === 'en'
			? {
					uploading: 'Uploading images to draft...',
					uploadSuccess: 'Draft updated. Review and click Save.',
					uploadError: 'Upload failed. Please review the selected files and try again.',
					saving: 'Saving slide list...',
					saveSuccess: 'Slides saved successfully.',
					saveError: 'Save failed. Please try again.'
				}
			: {
					uploading: 'Đang tải ảnh vào bản nháp...',
					uploadSuccess: 'Đã cập nhật bản nháp. Kiểm tra lại rồi bấm Lưu slide.',
					uploadError: 'Tải ảnh thất bại. Vui lòng kiểm tra ảnh và thử lại.',
					saving: 'Đang lưu danh sách slide...',
					saveSuccess: 'Đã lưu slide thành công.',
					saveError: 'Lưu slide thất bại. Vui lòng thử lại.'
				}
	);

	const formatDate = (value) => {
		if (!value) return '--';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '--';
		return date.toLocaleString($locale === 'en' ? 'en-US' : 'vi-VN');
	};

	const formatFileSize = (value) => {
		const bytes = Number(value);
		if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
		if (bytes >= 1024 * 1024) {
			const sizeInMb = bytes / (1024 * 1024);
			return `${sizeInMb >= 10 ? sizeInMb.toFixed(0) : sizeInMb.toFixed(1)} MB`;
		}
		if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
		return `${bytes} B`;
	};

	const syncUploadInputFiles = (files) => {
		if (!uploadInputEl) return;
		const dt = new DataTransfer();
		for (const file of files) {
			if (file) dt.items.add(file);
		}
		uploadInputEl.files = dt.files;
	};

	const clearUploadDragState = () => {
		uploadDragDepth = 0;
		isUploadDragActive = false;
	};

	const clearUploadSelection = () => {
		selectedUploadFiles = [];
		uploadSelectionNote = { tone: '', message: '' };
		clearUploadDragState();
	};

	const applyUploadSelection = (files) => {
		const incomingFiles = Array.isArray(files) ? files.filter(Boolean) : [];
		const imageFiles = incomingFiles.filter((file) =>
			String(file?.type || '').startsWith('image/')
		);
		const acceptedFiles = imageFiles.slice(0, remainingSlots);
		const notes = [];
		if (incomingFiles.length !== imageFiles.length) {
			notes.push(uploadDropCopy.imagesOnly);
		}
		if (imageFiles.length > remainingSlots) {
			notes.push(uploadDropCopy.limit(remainingSlots));
		}
		selectedUploadFiles = acceptedFiles;
		syncUploadInputFiles(acceptedFiles);
		uploadSelectionNote = notes.length
			? {
					tone: incomingFiles.length !== imageFiles.length ? 'error' : 'info',
					message: notes.join(' ')
				}
			: { tone: '', message: '' };
	};

	const handleUploadInputChange = (event) => {
		const files = event.currentTarget?.files ? Array.from(event.currentTarget.files) : [];
		applyUploadSelection(files);
	};

	const handleUploadDragEnter = (event) => {
		if (!canUploadMore || isUploading) return;
		event.preventDefault();
		uploadDragDepth += 1;
		isUploadDragActive = true;
	};

	const handleUploadDragOver = (event) => {
		if (!canUploadMore || isUploading) return;
		event.preventDefault();
		if (event.dataTransfer) {
			event.dataTransfer.dropEffect = 'copy';
		}
		isUploadDragActive = true;
	};

	const handleUploadDragLeave = (event) => {
		if (!canUploadMore || isUploading) return;
		event.preventDefault();
		uploadDragDepth = Math.max(0, uploadDragDepth - 1);
		if (uploadDragDepth === 0) {
			isUploadDragActive = false;
		}
	};

	const handleUploadDrop = (event) => {
		event.preventDefault();
		event.stopPropagation();
		clearUploadDragState();
		if (!canUploadMore || isUploading) return;
		const files = event.dataTransfer?.files ? Array.from(event.dataTransfer.files) : [];
		if (!files.length) return;
		applyUploadSelection(files);
	};

	const moveItem = (from, to) => {
		if (from < 0 || to < 0 || from >= slides.length || to >= slides.length || from === to) return;
		const next = [...slides];
		const [moved] = next.splice(from, 1);
		next.splice(to, 0, moved);
		slides = next;
	};

	const removeSlide = (slideId) => {
		slides = slides.filter((slide) => slide.id !== slideId);
	};

	const handleDragStart = (event, slide, index) => {
		if (!slide?.id) return;
		draggingId = String(slide.id);
		draggingIndex = Number.isFinite(index) ? index : -1;
		event.dataTransfer?.setData('text/plain', draggingId);
		event.dataTransfer?.setData('application/x-inoxpran-index', String(draggingIndex));
		event.dataTransfer?.setDragImage?.(event.currentTarget, 12, 12);
	};

	const handleDragEnd = () => {
		draggingId = '';
		draggingIndex = -1;
		dragOverIndex = -1;
	};

	const handleListDragOver = (event) => {
		event.preventDefault();
		const items = Array.from(event.currentTarget?.querySelectorAll('.slide-item') || []);
		if (!items.length) {
			dragOverIndex = 0;
			return;
		}
		const pointerY = event.clientY;
		let nextIndex = items.findIndex((item) => {
			const rect = item.getBoundingClientRect();
			return pointerY < rect.top + rect.height / 2;
		});
		if (nextIndex === -1) nextIndex = items.length;
		dragOverIndex = nextIndex;
	};

	const handleDropOnList = (event) => {
		event.preventDefault();
		const id = event.dataTransfer?.getData('text/plain') || draggingId;
		const fromIndex = Number(event.dataTransfer?.getData('application/x-inoxpran-index'));
		if (!id || !Number.isFinite(fromIndex)) {
			handleDragEnd();
			return;
		}
		const targetIndex = dragOverIndex >= 0 ? dragOverIndex : slides.length - 1;
		const adjustedIndex = targetIndex > fromIndex ? targetIndex - 1 : targetIndex;
		moveItem(fromIndex, adjustedIndex);
		handleDragEnd();
	};

	const handleItemDragOver = (event, index) => {
		event.preventDefault();
		dragOverIndex = index;
	};

	const handleItemDragLeave = (event) => {
		if (!event.currentTarget?.contains(event.relatedTarget)) {
			dragOverIndex = -1;
		}
	};

	const enhanceUploadForm = () => {
		isUploading = true;
		uploadStatus = { tone: 'info', message: actionCopy.uploading };

		return async ({ result, update }) => {
			try {
				await update({ reset: false });
			} finally {
				isUploading = false;
			}

			if (result?.type === 'success') {
				uploadStatus = {
					tone: 'success',
					message: result?.data?.toast?.message || actionCopy.uploadSuccess
				};
				return;
			}

			if (result?.type === 'failure') {
				uploadStatus = {
					tone: 'error',
					message: result?.data?.uploadError || actionCopy.uploadError
				};
				return;
			}

			if (result?.type === 'error') {
				uploadStatus = { tone: 'error', message: actionCopy.uploadError };
			}
		};
	};

	const enhanceSaveForm = () => {
		isSaving = true;
		saveStatus = { tone: 'info', message: actionCopy.saving };

		return async ({ result, update }) => {
			try {
				await update({ reset: false });
			} finally {
				isSaving = false;
			}

			if (result?.type === 'redirect') {
				saveStatus = { tone: 'success', message: actionCopy.saveSuccess };
				return;
			}

			if (result?.type === 'success') {
				saveStatus = {
					tone: 'success',
					message: result?.data?.toast?.message || actionCopy.saveSuccess
				};
				return;
			}

			if (result?.type === 'failure') {
				saveStatus = {
					tone: 'error',
					message: result?.data?.saveError || actionCopy.saveError
				};
				return;
			}

			if (result?.type === 'error') {
				saveStatus = { tone: 'error', message: actionCopy.saveError };
			}
		};
	};

	$effect(() => {
		const uploadBatchToken = String(form?.uploadBatchToken || '');
		if (!uploadBatchToken) return;
		if (String(form?.action || '') !== 'upload') return;
		if (handledUploadBatchToken === uploadBatchToken) return;
		const uploadedSlides = Array.isArray(form?.uploadedSlides) ? form.uploadedSlides : [];
		if (!uploadedSlides.length) return;
		handledUploadBatchToken = uploadBatchToken;

		const existingIds = new Set(slides.map((slide) => slide.id));
		const available = Math.max(0, maxItems - slides.length);
		if (!available) return;

		const nextSlides = uploadedSlides
			.map((slide) => ({
				id: String(slide?.id || '').trim(),
				imageUrl: String(slide?.imageUrl || '').trim(),
				imagePath: String(slide?.imagePath || '').trim(),
				imageVariants:
					slide?.imageVariants &&
					typeof slide.imageVariants === 'object' &&
					!Array.isArray(slide.imageVariants)
						? slide.imageVariants
						: null
			}))
			.filter((slide) => slide.id && slide.imageUrl && !existingIds.has(slide.id))
			.slice(0, available);

		if (!nextSlides.length) return;
		slides = [...slides, ...nextSlides];
		uploadFormEl?.reset?.();
		clearUploadSelection();
	});

	$effect(() => {
		if (!form?.toast?.message) return;
		const key = `${form.toast.tone || 'info'}:${form.toast.message}`;
		if (key === lastToastKey) return;
		lastToastKey = key;
		pushToast(form.toast);
	});
</script>

<svelte:head>
	<title>{pageCopy.title} | Admin</title>
</svelte:head>

<section class="home-slides-page">
	<header class="page-header">
		<div>
			<h1>{pageCopy.title}</h1>
			<p class="text-muted">{pageCopy.lede}</p>
			{#if data?.updatedAt}
				<p class="text-muted small mb-0">{pageCopy.updatedAt}: {formatDate(data.updatedAt)}</p>
			{/if}
		</div>
	</header>

	{#if data?.apiError}
		<div class="alert alert-danger">{data.apiError}</div>
	{/if}

	<div class="slides-layout">
		<div class="panel">
			<div class="panel-header">
				<div>
					<h2>{pageCopy.uploadTitle}</h2>
					<p class="panel-hint">{pageCopy.uploadHint}</p>
				</div>
				<div class="count-pill">{slides.length}/{maxItems}</div>
			</div>

			<div class="auto-alt-note" aria-live="polite">
				<div class="auto-alt-note__title">{pageCopy.autoAltTitle}</div>
				<div class="auto-alt-note__desc">{pageCopy.autoAltDesc}</div>
				<div class="auto-alt-note__meta">
					{remainingSlots}
					{pageCopy.slotsLeft}
				</div>
			</div>

			{#if !canUploadMore}
				<div class="alert alert-warning mb-3">{pageCopy.limitReached}</div>
			{/if}

			<form
				method="post"
				action="?/upload"
				enctype="multipart/form-data"
				use:enhance={enhanceUploadForm}
				bind:this={uploadFormEl}
			>
				<input type="hidden" name="current_count" value={slides.length} />

				<div class="field">
					<label for="slide-image-input">{pageCopy.image}</label>
					<div
						class="upload-dropzone"
						class:is-active={isUploadDragActive}
						class:is-disabled={!canUploadMore || isUploading}
						ondragenter={handleUploadDragEnter}
						ondragover={handleUploadDragOver}
						ondragleave={handleUploadDragLeave}
						ondrop={handleUploadDrop}
					>
						<input
							id="slide-image-input"
							class="upload-input"
							type="file"
							name="images"
							accept="image/*"
							multiple
							onchange={handleUploadInputChange}
							bind:this={uploadInputEl}
							disabled={!canUploadMore || isUploading}
						/>
						<div class="upload-dropzone__copy">
							<strong>{uploadDropCopy.prompt}</strong>
							<span>{uploadDropCopy.browse}</span>
							<span class="upload-dropzone__meta">{selectedUploadSummary}</span>
						</div>
					</div>

					{#if selectedUploadFiles.length}
						<ul class="upload-file-list" aria-live="polite">
							{#each selectedUploadFiles as file (`${file.name}-${file.size}-${file.lastModified}`)}
								<li class="upload-file-item">
									<span class="mono text-break">{file.name}</span>
									<span class="upload-file-size">{formatFileSize(file.size)}</span>
								</li>
							{/each}
						</ul>
					{:else}
						<div class="upload-file-empty">{uploadDropCopy.empty}</div>
					{/if}
				</div>

				{#if uploadSelectionNote.message}
					<div
						class={`inline-status inline-status--${uploadSelectionNote.tone || 'info'} mt-3`}
						role="status"
						aria-live="polite"
					>
						{uploadSelectionNote.message}
					</div>
				{/if}

				{#if form?.action === 'upload' && form?.uploadError}
					<div class="alert alert-danger mt-3 mb-0">{form.uploadError}</div>
				{/if}

				<div class="panel-actions">
					<button
						class="btn btn-dark"
						type="submit"
						disabled={!canUploadMore || isUploading || !hasSelectedUploadFiles}
					>
						{isUploading ? actionCopy.uploading : pageCopy.upload}
					</button>
				</div>
			</form>

			{#if uploadStatus.message}
				<div
					class={`inline-status inline-status--${uploadStatus.tone || 'info'}`}
					role="status"
					aria-live="polite"
				>
					{uploadStatus.message}
				</div>
			{/if}
		</div>

		<form method="post" action="?/save" class="panel" use:enhance={enhanceSaveForm}>
			<input type="hidden" name="slides_json" value={slidesPayload} />

			<div class="panel-header">
				<div>
					<h2>{pageCopy.currentTitle}</h2>
					<p class="panel-hint">{pageCopy.currentHint}</p>
				</div>
				<button class="btn btn-dark" type="submit" disabled={isSaving}>
					{isSaving ? actionCopy.saving : pageCopy.save}
				</button>
			</div>

			{#if form?.action === 'save' && form?.saveError}
				<div class="alert alert-danger mb-3">{form.saveError}</div>
			{/if}

			<ul class="slide-list" ondragover={handleListDragOver} ondrop={handleDropOnList}>
				{#if slides.length}
					{#each slides as slide, index (slide.id)}
						<li
							class="slide-item"
							class:is-dragging={draggingId === String(slide.id)}
							class:is-drop-over={dragOverIndex === index && draggingId !== String(slide.id)}
							draggable="true"
							ondragstart={(event) => handleDragStart(event, slide, index)}
							ondragend={handleDragEnd}
							ondragover={(event) => handleItemDragOver(event, index)}
							ondragleave={handleItemDragLeave}
						>
							<div class="slide-order" aria-label={`${pageCopy.orderLabel} ${index + 1}`}>
								{index + 1}
							</div>

							<div class="slide-preview">
								<img
									src={slide.imageUrl}
									alt={$locale === 'en' ? getAutoAltEn(index) : getAutoAltVi(index)}
								/>
							</div>

							<div class="slide-content">
								<div class="slide-kv">
									<span>{pageCopy.autoAltViLabel}</span>
									<strong>{getAutoAltVi(index)}</strong>
								</div>
								<div class="slide-kv">
									<span>{pageCopy.autoAltEnLabel}</span>
									<strong>{getAutoAltEn(index)}</strong>
								</div>
								<div class="slide-meta">
									<span class="slide-meta__label">{pageCopy.pathLabel}</span>
									<span class="mono text-break">{slide.imagePath || slide.imageUrl}</span>
								</div>
							</div>

							<div class="slide-actions">
								<button
									type="button"
									class="btn btn-outline-dark btn-sm"
									onclick={() => moveItem(index, index - 1)}
									disabled={index === 0}
									aria-label={pageCopy.moveUp}
									title={pageCopy.moveUp}
								>
									&uarr;
								</button>
								<button
									type="button"
									class="btn btn-outline-dark btn-sm"
									onclick={() => moveItem(index, index + 1)}
									disabled={index === slides.length - 1}
									aria-label={pageCopy.moveDown}
									title={pageCopy.moveDown}
								>
									&darr;
								</button>
								<button
									type="button"
									class="btn btn-outline-danger btn-sm"
									onclick={() => removeSlide(slide.id)}
								>
									{pageCopy.remove}
								</button>
							</div>
						</li>
					{/each}
				{:else}
					<li class="slide-empty">{pageCopy.empty}</li>
				{/if}
			</ul>

			{#if saveStatus.message}
				<div
					class={`inline-status inline-status--${saveStatus.tone || 'info'}`}
					role="status"
					aria-live="polite"
				>
					{saveStatus.message}
				</div>
			{/if}
		</form>
	</div>
</section>

<style>
	.home-slides-page {
		display: grid;
		gap: 1rem;
	}

	.page-header h1 {
		margin: 0;
		font-size: 1.6rem;
	}

	.page-header .text-muted {
		margin: 0.35rem 0 0;
	}

	.slides-layout {
		display: grid;
		grid-template-columns: minmax(0, 360px) minmax(0, 1fr);
		gap: 1rem;
		align-items: start;
	}

	.panel {
		background: #fff;
		border: 1px solid rgba(15, 23, 42, 0.08);
		border-radius: 16px;
		padding: 1rem;
		box-shadow: 0 10px 24px rgba(15, 23, 42, 0.05);
	}

	.panel-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
	}

	.panel-header h2 {
		margin: 0;
		font-size: 1.05rem;
	}

	.panel-hint {
		margin: 0.35rem 0 0;
		color: rgba(15, 23, 42, 0.62);
		font-size: 0.88rem;
	}

	.count-pill {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.28rem 0.7rem;
		border-radius: 999px;
		background: #eef7fb;
		border: 1px solid rgba(11, 135, 153, 0.18);
		color: #0d6674;
		font-weight: 700;
		font-size: 0.82rem;
	}

	.auto-alt-note {
		margin-bottom: 0.9rem;
		padding: 0.75rem 0.85rem;
		border-radius: 12px;
		border: 1px solid rgba(11, 135, 153, 0.16);
		background: linear-gradient(180deg, rgba(11, 135, 153, 0.06), rgba(11, 135, 153, 0.02));
		display: grid;
		gap: 0.25rem;
	}

	.auto-alt-note__title {
		font-weight: 700;
		font-size: 0.9rem;
		color: #0b4f5a;
	}

	.auto-alt-note__desc {
		font-size: 0.82rem;
		color: rgba(15, 23, 42, 0.72);
	}

	.auto-alt-note__meta {
		font-size: 0.78rem;
		font-weight: 700;
		color: #0d6674;
	}

	.field {
		display: grid;
		gap: 0.35rem;
	}

	.field label {
		font-size: 0.78rem;
		font-weight: 700;
		color: rgba(15, 23, 42, 0.74);
	}

	.upload-dropzone {
		position: relative;
		display: grid;
		place-items: center;
		min-height: 168px;
		padding: 1rem;
		border-radius: 14px;
		border: 1.5px dashed rgba(11, 135, 153, 0.28);
		background: linear-gradient(180deg, rgba(11, 135, 153, 0.04), rgba(255, 255, 255, 0.98));
		transition:
			border-color 0.16s ease,
			box-shadow 0.16s ease,
			transform 0.16s ease,
			background 0.16s ease;
	}

	.upload-dropzone.is-active,
	.upload-dropzone:focus-within {
		border-color: rgba(11, 135, 153, 0.7);
		box-shadow: 0 0 0 4px rgba(11, 135, 153, 0.12);
		background: linear-gradient(180deg, rgba(11, 135, 153, 0.09), rgba(255, 255, 255, 1));
		transform: translateY(-1px);
	}

	.upload-dropzone.is-disabled {
		opacity: 0.66;
		border-style: solid;
		background: rgba(15, 23, 42, 0.03);
	}

	.upload-input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0;
		cursor: pointer;
	}

	.upload-input:disabled {
		cursor: not-allowed;
	}

	.upload-dropzone__copy {
		pointer-events: none;
		display: grid;
		gap: 0.3rem;
		text-align: center;
		color: rgba(15, 23, 42, 0.72);
	}

	.upload-dropzone__copy strong {
		font-size: 0.96rem;
		color: rgba(15, 23, 42, 0.92);
	}

	.upload-dropzone__copy span {
		font-size: 0.82rem;
	}

	.upload-dropzone__meta {
		font-weight: 700;
		color: #0d6674;
	}

	.upload-file-list {
		list-style: none;
		margin: 0.25rem 0 0;
		padding: 0;
		display: grid;
		gap: 0.45rem;
	}

	.upload-file-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.55rem 0.7rem;
		border-radius: 10px;
		border: 1px solid rgba(15, 23, 42, 0.08);
		background: #fff;
		font-size: 0.8rem;
	}

	.upload-file-item .mono {
		flex: 1 1 auto;
		min-width: 0;
	}

	.upload-file-size {
		flex: 0 0 auto;
		font-size: 0.74rem;
		font-weight: 700;
		color: rgba(15, 23, 42, 0.58);
	}

	.upload-file-empty {
		margin-top: 0.25rem;
		padding: 0.8rem 0.85rem;
		border-radius: 12px;
		border: 1px dashed rgba(15, 23, 42, 0.12);
		background: rgba(15, 23, 42, 0.02);
		font-size: 0.8rem;
		color: rgba(15, 23, 42, 0.62);
	}

	.panel-actions {
		margin-top: 0.9rem;
		display: flex;
		justify-content: flex-start;
	}

	.inline-status {
		margin-top: 0.75rem;
		padding: 0.65rem 0.8rem;
		border-radius: 10px;
		font-size: 0.82rem;
		border: 1px solid rgba(15, 23, 42, 0.08);
		background: rgba(15, 23, 42, 0.03);
		color: rgba(15, 23, 42, 0.85);
	}

	.inline-status--info {
		background: rgba(59, 130, 246, 0.08);
		border-color: rgba(59, 130, 246, 0.16);
		color: #1d4ed8;
	}

	.inline-status--success {
		background: rgba(16, 185, 129, 0.08);
		border-color: rgba(16, 185, 129, 0.16);
		color: #047857;
	}

	.inline-status--error {
		background: rgba(239, 68, 68, 0.08);
		border-color: rgba(239, 68, 68, 0.16);
		color: #b91c1c;
	}

	.slide-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.8rem;
	}

	.slide-item {
		display: grid;
		grid-template-columns: auto minmax(180px, 240px) minmax(0, 1fr) auto;
		gap: 0.8rem;
		align-items: start;
		padding: 0.75rem;
		border: 1px solid rgba(15, 23, 42, 0.08);
		border-radius: 14px;
		background: #fbfdfe;
		transition:
			border-color 0.16s ease,
			box-shadow 0.16s ease,
			transform 0.12s ease;
	}

	.slide-item:hover {
		border-color: rgba(11, 135, 153, 0.22);
		box-shadow: 0 10px 18px rgba(15, 23, 42, 0.05);
	}

	.slide-item.is-dragging {
		opacity: 0.55;
		transform: scale(0.99);
	}

	.slide-item.is-drop-over {
		border-color: rgba(11, 135, 153, 0.4);
		box-shadow: 0 0 0 3px rgba(11, 135, 153, 0.12);
	}

	.slide-order {
		width: 32px;
		height: 32px;
		border-radius: 999px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: #0b8799;
		color: #fff;
		font-weight: 700;
		font-size: 0.84rem;
		margin-top: 2px;
	}

	.slide-preview {
		width: 100%;
		aspect-ratio: 940 / 788;
		border-radius: 12px;
		overflow: hidden;
		border: 1px solid rgba(15, 23, 42, 0.08);
		background: #e8eef2;
	}

	.slide-preview img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.slide-content {
		display: grid;
		gap: 0.6rem;
		min-width: 0;
	}

	.slide-kv {
		display: grid;
		gap: 0.18rem;
		padding: 0.45rem 0.55rem;
		border-radius: 10px;
		background: #fff;
		border: 1px solid rgba(15, 23, 42, 0.06);
	}

	.slide-kv span {
		font-size: 0.72rem;
		color: rgba(15, 23, 42, 0.58);
	}

	.slide-kv strong {
		font-size: 0.84rem;
		color: rgba(15, 23, 42, 0.9);
		font-weight: 700;
		word-break: break-word;
	}

	.slide-meta {
		display: grid;
		gap: 0.25rem;
		font-size: 0.72rem;
		color: rgba(15, 23, 42, 0.58);
		padding: 0.45rem 0.55rem;
		border-radius: 10px;
		background: rgba(15, 23, 42, 0.03);
	}

	.slide-meta__label {
		font-weight: 700;
		color: rgba(15, 23, 42, 0.7);
	}

	.mono {
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
	}

	.slide-actions {
		display: grid;
		gap: 0.4rem;
		align-content: start;
	}

	.slide-empty {
		padding: 1rem;
		border: 1px dashed rgba(15, 23, 42, 0.14);
		border-radius: 12px;
		color: rgba(15, 23, 42, 0.65);
		background: #fbfdfe;
	}

	.alert {
		border-radius: 12px;
	}

	.alert-warning {
		background: rgba(245, 158, 11, 0.09);
		border: 1px solid rgba(245, 158, 11, 0.18);
		color: #92400e;
	}

	@media (max-width: 1200px) {
		.slide-item {
			grid-template-columns: auto minmax(160px, 210px) minmax(0, 1fr);
		}

		.slide-actions {
			grid-column: 2 / -1;
			display: flex;
			flex-wrap: wrap;
			justify-content: flex-end;
		}
	}

	@media (max-width: 992px) {
		.slides-layout {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 768px) {
		.upload-file-item {
			flex-direction: column;
			align-items: flex-start;
		}

		.slide-item {
			grid-template-columns: auto 1fr;
			gap: 0.7rem;
		}

		.slide-preview,
		.slide-content {
			grid-column: 1 / -1;
		}

		.slide-actions {
			grid-column: 1 / -1;
			justify-content: flex-start;
		}

		.panel-header {
			flex-direction: column;
		}
	}
</style>
