<script>
	import { onDestroy } from 'svelte';
	import { t } from '$lib/i18n/admin/index.js';
	import { blogImageErrorText, normalizeBlogImageError } from '$lib/blogImageError.js';

	let { open = false, postId = '', target = null, onClose = null, onApplied = null } = $props();

	let dialog;
	let fileInput = $state(null);
	let mode = $state('ai');
	let prompt = $state('');
	let suggestions = $state([]);
	let query = $state('');
	let page = $state(1);
	let hasMore = $state(false);
	let pexelsResults = $state([]);
	let localFile = $state(null);
	let localPreviewUrl = $state('');
	let localDragActive = $state(false);
	let selected = $state(null);
	let preview = $state(null);
	let loading = $state(false);
	let error = $state('');
	let initializedTarget = '';
	const MAX_LOCAL_UPLOAD_BYTES = 5 * 1024 * 1024;

	const apiPath = (operation) =>
		`/admin/api/blogs/${encodeURIComponent(postId)}/images/${operation}`;

	const requestJson = async (url, options = {}) => {
		const response = await fetch(url, options);
		const payload = await response.json().catch(() => null);
		if (!response.ok) {
			const normalized = normalizeBlogImageError(payload, response.headers);
			const requestError = new Error(blogImageErrorText(normalized, { t: $t }));
			requestError.code = normalized.errorCode;
			requestError.requestId = normalized.requestId;
			throw requestError;
		}
		return payload;
	};

	const targetJson = () => JSON.stringify(target || {});

	const formatBytes = (bytes) => {
		const size = Number(bytes) || 0;
		if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
		if (size >= 1024) return `${Math.round(size / 1024)} KB`;
		return `${size} B`;
	};

	const clearLocalPreview = () => {
		if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
		localPreviewUrl = '';
		localFile = null;
		localDragActive = false;
		if (fileInput) fileInput.value = '';
	};

	const loadSuggestions = async () => {
		const params = new URLSearchParams({ target: targetJson() });
		const payload = await requestJson(`${apiPath('suggestions')}?${params}`);
		suggestions = payload.suggestions || [];
		if (!prompt && suggestions[0]) prompt = suggestions[0];
	};

	const searchPexels = async ({ append = false } = {}) => {
		loading = true;
		error = '';
		try {
			const nextPage = append ? page + 1 : 1;
			const params = new URLSearchParams({
				target: targetJson(),
				query,
				page: String(nextPage),
				perPage: '10'
			});
			const payload = await requestJson(`${apiPath('pexels')}?${params}`);
			query = payload.query || query;
			page = Number(payload.page) || nextPage;
			hasMore = Boolean(payload.hasMore);
			pexelsResults = append
				? [...pexelsResults, ...(payload.candidates || [])]
				: payload.candidates || [];
			if (!suggestions.length) suggestions = payload.suggestions || [];
		} catch (requestError) {
			error = requestError?.message || $t('admin.blogImageReview.errors.search');
		} finally {
			loading = false;
		}
	};

	const switchMode = (nextMode) => {
		mode = nextMode;
		preview = null;
		selected = null;
		error = '';
		if (nextMode === 'pexels' && !pexelsResults.length) void searchPexels();
	};

	const generateImage = async () => {
		if (loading) return;
		if (prompt.trim().length < 20) {
			error = $t('admin.blogImageReview.errors.minPrompt');
			return;
		}
		loading = true;
		error = '';
		try {
			preview = await requestJson(apiPath('generate'), {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ target, prompt: prompt.trim() })
			});
		} catch (requestError) {
			error = requestError?.message || $t('admin.blogImageReview.errors.generate');
		} finally {
			loading = false;
		}
	};

	const selectPexels = (candidate) => {
		selected = candidate;
		preview = {
			kind: 'pexels',
			assetId: candidate.assetId,
			previewUrl: candidate.previewUrl,
			author: candidate.author,
			description: candidate.description
		};
	};

	const openLocalPicker = () => {
		fileInput?.click();
	};

	const selectLocalFile = (file) => {
		if (!file) return;
		error = '';
		if (!String(file.type || '').startsWith('image/')) {
			error = $t('admin.blogImageReview.errors.localType');
			return;
		}
		if (file.size > MAX_LOCAL_UPLOAD_BYTES) {
			error = $t('admin.blogImageReview.errors.localSize');
			return;
		}
		clearLocalPreview();
		localFile = file;
		localPreviewUrl = URL.createObjectURL(file);
		preview = {
			kind: 'local_upload',
			previewUrl: localPreviewUrl,
			fileName: file.name,
			sizeBytes: file.size,
			description: file.name
		};
	};

	const handleLocalInput = (event) => {
		selectLocalFile(event.currentTarget?.files?.[0]);
	};

	const handleLocalDrop = (event) => {
		event.preventDefault();
		localDragActive = false;
		selectLocalFile(event.dataTransfer?.files?.[0]);
	};

	const confirmReplacement = async () => {
		if (!preview) return;
		loading = true;
		error = '';
		try {
			let post;
			if (preview.kind === 'local_upload') {
				if (!localFile) throw new Error($t('admin.blogImageReview.errors.localMissing'));
				const formData = new FormData();
				formData.set('target', JSON.stringify(target || {}));
				formData.set(
					'selection',
					JSON.stringify({ kind: 'local_upload', fileName: localFile.name })
				);
				formData.set('image', localFile, localFile.name);
				post = await requestJson(apiPath('replace'), {
					method: 'POST',
					body: formData
				});
			} else {
				post = await requestJson(apiPath('replace'), {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						target,
						selection:
							preview.kind === 'ai' ? preview : { kind: 'pexels', assetId: preview.assetId }
					})
				});
			}
			onApplied?.(post);
			closeDialog();
		} catch (requestError) {
			error = requestError?.message || $t('admin.blogImageReview.errors.replace');
		} finally {
			loading = false;
		}
	};

	const closeDialog = () => {
		if (dialog?.open) {
			dialog.close();
			return;
		}
		onClose?.();
	};

	const reset = () => {
		mode = 'ai';
		prompt = '';
		suggestions = [];
		query = '';
		page = 1;
		hasMore = false;
		pexelsResults = [];
		clearLocalPreview();
		selected = null;
		preview = null;
		error = '';
	};

	$effect(() => {
		const key = open ? `${postId}:${target?.type}:${target?.imageId || target?.url}` : '';
		if (open && dialog && !dialog.open) dialog.showModal();
		if (open && key && key !== initializedTarget) {
			initializedTarget = key;
			reset();
			void loadSuggestions().catch((requestError) => {
				error = requestError?.message || $t('admin.blogImageReview.errors.suggestions');
			});
		}
		if (!open && dialog?.open) dialog.close();
	});

	onDestroy(() => {
		clearLocalPreview();
		if (dialog?.open) dialog.close();
	});
</script>

<dialog bind:this={dialog} class="image-review-dialog" onclose={() => open && onClose?.()}>
	<div class="dialog-shell">
		<header>
			<div>
				<span class="eyebrow"
					>{$t(
						target?.type === 'cover'
							? 'admin.blogImageReview.dialog.cover'
							: 'admin.blogImageReview.dialog.inline'
					)}</span
				>
				<h2>{$t('admin.blogImageReview.dialog.title')}</h2>
			</div>
			<button
				class="close-button"
				type="button"
				aria-label={$t('admin.blogImageReview.dialog.close')}
				onclick={closeDialog}>×</button
			>
		</header>

		{#if preview}
			<section class="preview-step">
				<div class="preview-frame">
					<img
						src={preview.previewDataUrl || preview.previewUrl}
						alt={preview.description || $t('admin.blogImageReview.dialog.title')}
					/>
				</div>
				<div class="preview-copy">
					<span class="step-label">{$t('admin.blogImageReview.dialog.preview')}</span>
					<h3>
						{$t(
							preview.kind === 'ai'
								? 'admin.blogImageReview.dialog.aiPreview'
								: preview.kind === 'local_upload'
									? 'admin.blogImageReview.dialog.localPreview'
									: 'admin.blogImageReview.dialog.pexelsPreview'
						)}
					</h3>
					{#if preview.author}<p>{preview.author} / Pexels</p>{/if}
					{#if preview.kind === 'local_upload'}
						<p>{preview.fileName} - {formatBytes(preview.sizeBytes)}</p>
					{/if}
					<p>{$t('admin.blogImageReview.dialog.replacementNote')}</p>
				</div>
			</section>
			<footer>
				<button class="secondary" type="button" onclick={() => (preview = null)} disabled={loading}>
					{$t('admin.blogImageReview.dialog.back')}
				</button>
				<button class="primary" type="button" onclick={confirmReplacement} disabled={loading}>
					{loading
						? $t('admin.blogImageReview.dialog.saving')
						: $t('admin.blogImageReview.dialog.confirm')}
				</button>
			</footer>
		{:else}
			<div class="mode-switch" aria-label={$t('admin.blogImageReview.dialog.sourceLabel')}>
				<button
					type="button"
					class:active={mode === 'ai'}
					aria-pressed={mode === 'ai'}
					onclick={() => switchMode('ai')}>{$t('admin.blogImageReview.dialog.aiTab')}</button
				>
				<button
					type="button"
					class:active={mode === 'pexels'}
					aria-pressed={mode === 'pexels'}
					onclick={() => switchMode('pexels')}
					>{$t('admin.blogImageReview.dialog.pexelsTab')}</button
				>
				<button
					type="button"
					class:active={mode === 'local'}
					aria-pressed={mode === 'local'}
					onclick={() => switchMode('local')}>{$t('admin.blogImageReview.dialog.localTab')}</button
				>
			</div>

			{#if mode === 'ai'}
				<section class="ai-panel">
					<label for="agentic-image-prompt">{$t('admin.blogImageReview.dialog.promptLabel')}</label>
					<textarea
						id="agentic-image-prompt"
						rows="5"
						bind:value={prompt}
						placeholder={$t('admin.blogImageReview.dialog.promptPlaceholder')}
					></textarea>
					<div class="suggestions">
						<span>{$t('admin.blogImageReview.dialog.suggestions')}</span>
						{#each suggestions as suggestion, __eachIndex1 (suggestion?._id ?? suggestion?.id ?? __eachIndex1)}
							<button type="button" onclick={() => (prompt = suggestion)}>{suggestion}</button>
						{/each}
					</div>
					<button class="primary generate" type="button" onclick={generateImage} disabled={loading}>
						{loading
							? $t('admin.blogImageReview.dialog.generating')
							: $t('admin.blogImageReview.dialog.generate')}
					</button>
				</section>
			{:else if mode === 'pexels'}
				<section class="pexels-panel">
					<div class="search-row">
						<input
							aria-label={$t('admin.blogImageReview.dialog.searchAria')}
							bind:value={query}
							placeholder={$t('admin.blogImageReview.dialog.searchPlaceholder')}
							onkeydown={(event) => event.key === 'Enter' && searchPexels()}
						/>
						<button type="button" onclick={() => searchPexels()} disabled={loading}
							>{$t('admin.blogImageReview.dialog.search')}</button
						>
					</div>
					<div class="image-grid">
						{#each pexelsResults as candidate (candidate.assetId)}
							<button
								type="button"
								class:selected={selected?.assetId === candidate.assetId}
								onclick={() => selectPexels(candidate)}
								aria-label={`${$t('admin.blogImageReview.dialog.confirm')}: ${candidate.author || 'Pexels'}`}
							>
								<img src={candidate.previewUrl} alt={candidate.description || ''} loading="lazy" />
								<span>{candidate.author || 'Pexels'}</span>
							</button>
						{/each}
					</div>
					{#if hasMore}
						<button
							class="load-more"
							type="button"
							onclick={() => searchPexels({ append: true })}
							disabled={loading}
						>
							{loading
								? $t('admin.blogImageReview.dialog.loading')
								: $t('admin.blogImageReview.dialog.loadMore')}
						</button>
					{/if}
				</section>
			{:else}
				<section class="local-panel">
					<div
						class="upload-drop"
						class:dragging={localDragActive}
						role="button"
						tabindex="0"
						onclick={openLocalPicker}
						onkeydown={(event) => {
							if (event.key === 'Enter' || event.key === ' ') {
								event.preventDefault();
								openLocalPicker();
							}
						}}
						ondragover={(event) => {
							event.preventDefault();
							localDragActive = true;
						}}
						ondragleave={() => (localDragActive = false)}
						ondrop={handleLocalDrop}
					>
						<input
							bind:this={fileInput}
							class="file-input"
							type="file"
							accept="image/*"
							onchange={handleLocalInput}
						/>
						<strong>{$t('admin.blogImageReview.dialog.localTitle')}</strong>
						<span>{$t('admin.blogImageReview.dialog.localHint')}</span>
						<button
							class="secondary"
							type="button"
							onclick={(event) => {
								event.stopPropagation();
								openLocalPicker();
							}}>{$t('admin.blogImageReview.dialog.localChoose')}</button
						>
					</div>
				</section>
			{/if}

			{#if error}<div class="dialog-error" role="alert">{error}</div>{/if}
			<footer>
				<button class="secondary" type="button" onclick={closeDialog}
					>{$t('admin.blogImageReview.dialog.cancel')}</button
				>
			</footer>
		{/if}
	</div>
</dialog>

<style>
	.image-review-dialog {
		width: min(940px, calc(100vw - 32px));
		max-height: calc(100vh - 32px);
		margin: auto;
		padding: 0;
		border: 0;
		border-radius: 8px;
		background: #f8faf8;
		box-shadow: 0 32px 90px rgba(8, 31, 22, 0.34);
		color: #17211d;
	}

	.image-review-dialog::backdrop {
		background: rgba(8, 20, 15, 0.72);
		backdrop-filter: blur(3px);
	}

	.dialog-shell {
		display: grid;
		max-height: calc(100vh - 32px);
		overflow: auto;
	}

	header,
	footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 20px 24px;
		border-bottom: 1px solid #dfe6e1;
		background: #fff;
	}

	footer {
		justify-content: flex-end;
		border-top: 1px solid #dfe6e1;
		border-bottom: 0;
	}

	h2,
	h3,
	p {
		margin: 0;
	}

	h2 {
		margin-top: 3px;
		font-size: 1.45rem;
		letter-spacing: 0;
	}

	.eyebrow,
	.step-label {
		color: #34715a;
		font-size: 0.72rem;
		font-weight: 800;
		text-transform: uppercase;
	}

	.close-button {
		width: 38px;
		height: 38px;
		border: 1px solid #d8dfda;
		border-radius: 50%;
		background: #fff;
		font-size: 24px;
		line-height: 1;
		cursor: pointer;
	}

	.mode-switch {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		margin: 20px 24px 0;
		padding: 4px;
		border: 1px solid #d6dfd9;
		border-radius: 8px;
		background: #edf2ee;
	}

	.mode-switch button {
		min-height: 42px;
		border: 0;
		border-radius: 6px;
		background: transparent;
		color: #58635e;
		font-weight: 700;
		cursor: pointer;
	}

	.mode-switch button.active {
		background: #17251f;
		box-shadow: 0 3px 10px rgba(11, 42, 30, 0.18);
		color: #fff;
	}

	.ai-panel,
	.pexels-panel,
	.local-panel {
		display: grid;
		gap: 14px;
		padding: 20px 24px 24px;
	}

	label,
	.suggestions > span {
		font-size: 0.8rem;
		font-weight: 800;
	}

	textarea,
	.search-row input {
		width: 100%;
		border: 1px solid #cdd7d0;
		border-radius: 7px;
		background: #fff;
		color: inherit;
		font: inherit;
	}

	textarea {
		resize: vertical;
		padding: 13px;
		line-height: 1.55;
	}

	textarea:focus,
	.search-row input:focus {
		outline: 3px solid rgba(31, 128, 91, 0.15);
		border-color: #1f805b;
	}

	.suggestions {
		display: grid;
		gap: 8px;
	}

	.suggestions button {
		width: 100%;
		border: 1px solid #dae2dc;
		border-radius: 7px;
		padding: 10px 12px;
		background: #fff;
		color: #3e4944;
		text-align: left;
		line-height: 1.4;
		cursor: pointer;
	}

	.suggestions button:hover {
		border-color: #66957f;
		background: #f2f8f4;
	}

	.primary,
	.secondary,
	.search-row button,
	.load-more {
		min-height: 40px;
		border-radius: 7px;
		padding: 0 16px;
		font-weight: 800;
		cursor: pointer;
	}

	.primary,
	.search-row button {
		border: 1px solid #0b6b49;
		background: #0b6b49;
		color: #fff;
	}

	.secondary,
	.load-more {
		border: 1px solid #cfd8d2;
		background: #fff;
		color: #26342e;
	}

	.generate {
		justify-self: end;
	}

	button:disabled {
		opacity: 0.55;
		cursor: wait;
	}

	.search-row {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 8px;
	}

	.search-row input {
		min-height: 42px;
		padding: 0 12px;
	}

	.image-grid {
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: 10px;
	}

	.image-grid button {
		position: relative;
		aspect-ratio: 4 / 3;
		overflow: hidden;
		border: 2px solid transparent;
		border-radius: 7px;
		padding: 0;
		background: #dfe7e1;
		cursor: pointer;
	}

	.image-grid button.selected {
		border-color: #0b8056;
		box-shadow: 0 0 0 3px rgba(11, 128, 86, 0.18);
	}

	.image-grid img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.image-grid span {
		position: absolute;
		right: 0;
		bottom: 0;
		left: 0;
		overflow: hidden;
		padding: 5px 7px;
		background: rgba(8, 24, 17, 0.72);
		color: #fff;
		font-size: 10px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.load-more {
		justify-self: center;
	}

	.upload-drop {
		display: grid;
		justify-items: center;
		gap: 12px;
		border: 1px dashed #9eb2a7;
		border-radius: 8px;
		padding: 34px 24px;
		background: #f4faf6;
		color: #415048;
		text-align: center;
		cursor: pointer;
		transition:
			border-color 160ms ease,
			background 160ms ease,
			box-shadow 160ms ease;
	}

	.upload-drop:hover,
	.upload-drop.dragging,
	.upload-drop:focus {
		border-color: #0b8056;
		background: #edf8f1;
		box-shadow: 0 0 0 3px rgba(11, 128, 86, 0.12);
		outline: 0;
	}

	.upload-drop strong {
		color: #1d2a24;
		font-size: 1rem;
	}

	.upload-drop span {
		max-width: 520px;
		color: #68766e;
		line-height: 1.5;
	}

	.file-input {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
		clip-path: inset(50%);
	}

	.dialog-error {
		margin: 0 24px 18px;
		border: 1px solid #f2b8b0;
		border-radius: 7px;
		padding: 10px 12px;
		background: #fff1ef;
		color: #a52d20;
	}

	.preview-step {
		display: grid;
		grid-template-columns: minmax(0, 1.5fr) minmax(240px, 0.7fr);
		gap: 24px;
		padding: 24px;
	}

	.preview-frame {
		overflow: hidden;
		aspect-ratio: 16 / 9;
		border-radius: 7px;
		background: #dfe7e1;
	}

	.preview-frame img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.preview-copy {
		display: grid;
		align-content: start;
		gap: 10px;
		padding-top: 6px;
	}

	.preview-copy p {
		color: #637069;
		line-height: 1.55;
	}

	@media (max-width: 720px) {
		.image-review-dialog {
			width: calc(100vw - 16px);
			max-height: calc(100vh - 16px);
		}

		.image-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.preview-step {
			grid-template-columns: 1fr;
		}

		header,
		footer,
		.ai-panel,
		.pexels-panel,
		.local-panel,
		.preview-step {
			padding-right: 16px;
			padding-left: 16px;
		}
	}
</style>
