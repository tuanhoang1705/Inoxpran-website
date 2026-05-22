<script>
	import { onMount, onDestroy } from 'svelte';
	import { pushToast } from '$lib/stores/adminToast.js';
	import { t } from '$lib/i18n/admin/index.js';
	import { Editor } from '@tiptap/core';
	import StarterKit from '@tiptap/starter-kit';
	import Image from '@tiptap/extension-image';
	import Link from '@tiptap/extension-link';
	import Underline from '@tiptap/extension-underline';
	import TextAlign from '@tiptap/extension-text-align';
	import { TextStyle } from '@tiptap/extension-text-style';
	import Color from '@tiptap/extension-color';
	import Placeholder from '@tiptap/extension-placeholder';

	let { value = '', onChange = null, placeholder = '' } = $props();

	let editor;
	let editorElement;
	let imageInput;
	let showLinkModal = $state(false);
	let linkUrl = $state('');
	let linkText = $state('');
	let selectedColor = $state('#151515');
	let isUpdatingFromProp = false;
	let detachEditorHandlers = null;
	const editorPlaceholder = $derived(placeholder || $t('admin.editor.placeholder'));

	const emitChange = () => {
		if (onChange) {
			onChange(editor?.getHTML() || '');
		}
	};

	const uploadImage = async (file) => {
		const payload = new FormData();
		payload.set('image', file);

		const response = await fetch('/admin/uploads/description-image', {
			method: 'POST',
			body: payload
		});

		const data = await response.json().catch(() => null);
		if (!response.ok) {
			const message = data?.error || $t('admin.editor.imageUploadFailed');
			throw new Error(message);
		}

		if (!data?.url) {
			throw new Error($t('admin.editor.uploadMissingUrl'));
		}

		return data.url;
	};

	const insertImageFile = async (file) => {
		if (!file || !file.type?.startsWith('image/')) {
			pushToast({ tone: 'error', message: $t('admin.editor.onlyImagesAllowed') });
			return;
		}

		try {
			const url = await uploadImage(file);
			editor?.chain().focus().setImage({ src: url }).run();
			pushToast({ tone: 'success', message: $t('admin.editor.imageAdded') });
		} catch (error) {
			pushToast({ tone: 'error', message: error?.message || $t('admin.editor.imageUploadFailed') });
		}
	};

	const handleImageSelect = async (event) => {
		const file = event.target?.files?.[0];
		if (file) {
			await insertImageFile(file);
		}
		event.target.value = '';
	};

	const handleDrop = async (event) => {
		const files = Array.from(event.dataTransfer?.files || []);
		const imageFile = files.find((file) => file.type?.startsWith('image/'));
		if (!imageFile) return;

		event.preventDefault();
		await insertImageFile(imageFile);
	};

	const handlePaste = async (event) => {
		const items = Array.from(event.clipboardData?.items || []);
		const imageItem = items.find((item) => item.type?.startsWith('image/'));
		if (!imageItem) return;

		event.preventDefault();
		const file = imageItem.getAsFile();
		if (file) {
			await insertImageFile(file);
		}
	};

	const openLinkModal = () => {
		if (!editor) return;
		const { from, to } = editor.state.selection;
		const selected = editor.state.doc.textBetween(from, to, ' ');
		linkText = selected;
		linkUrl = '';
		showLinkModal = true;
	};

	const insertLink = () => {
		if (!editor) return;
		const rawUrl = linkUrl.trim();
		if (!rawUrl) {
			pushToast({ tone: 'error', message: $t('admin.editor.linkUrlRequired') });
			return;
		}

		const url = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
		const hasSelection = !editor.state.selection.empty;
		const fallbackText = linkText.trim() || url;

		const chain = editor.chain().focus();
		if (hasSelection) {
			chain.extendMarkRange('link').setLink({ href: url }).run();
		} else {
			chain.insertContent(fallbackText).extendMarkRange('link').setLink({ href: url }).run();
		}

		linkUrl = '';
		linkText = '';
		showLinkModal = false;
		emitChange();
		pushToast({ tone: 'success', message: $t('admin.editor.linkAdded') });
	};

	onMount(() => {
		editor = new Editor({
			element: editorElement,
			content: value || '',
			extensions: [
				StarterKit.configure({
					heading: { levels: [2, 3, 4] }
				}),
				Underline,
				TextStyle,
				Color,
				Link.configure({ openonclick: false }),
				Image.configure({ inline: false }),
				TextAlign.configure({ types: ['heading', 'paragraph'] }),
				Placeholder.configure({ placeholder: editorPlaceholder })
			],
			onUpdate: () => {
				if (isUpdatingFromProp) return;
				emitChange();
			}
		});

		const dom = editor.view.dom;
		dom.addEventListener('drop', handleDrop);
		dom.addEventListener('paste', handlePaste);
		detachEditorHandlers = () => {
			dom.removeEventListener('drop', handleDrop);
			dom.removeEventListener('paste', handlePaste);
		};
	});

	onDestroy(() => {
		detachEditorHandlers?.();
		editor?.destroy();
		editor = null;
	});

	$effect(() => {
		if (!editor) return;
		const nextValue = value || '';
		const currentValue = editor.getHTML();
		const isSame = currentValue === nextValue || (editor.isEmpty && !nextValue);
		if (isSame) return;
		isUpdatingFromProp = true;
		editor.commands.setContent(nextValue, false);
		isUpdatingFromProp = false;
	});
</script>

<div class="rich-text-editor">
	<div class="toolbar">
		<div class="toolbar-group">
			<button
				type="button"
				class="toolbar-btn"
				class:is-active={editor?.isActive('bold')}
				title={$t('admin.editor.bold')}
				onclick={() => editor?.chain().focus().toggleBold().run()}
			>
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
					<path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"></path>
					<path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"></path>
				</svg>
			</button>
			<button
				type="button"
				class="toolbar-btn"
				class:is-active={editor?.isActive('italic')}
				title={$t('admin.editor.italic')}
				onclick={() => editor?.chain().focus().toggleItalic().run()}
			>
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
					<line x1="19" y1="4" x2="10" y2="4"></line>
					<line x1="14" y1="20" x2="5" y2="20"></line>
					<line x1="15" y1="4" x2="9" y2="20"></line>
				</svg>
			</button>
			<button
				type="button"
				class="toolbar-btn"
				class:is-active={editor?.isActive('underline')}
				title={$t('admin.editor.underline')}
				onclick={() => editor?.chain().focus().toggleUnderline().run()}
			>
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
					<path d="M6 3v7a6 6 0 0 0 6 6 6 6 0 0 0 6-6V3"></path>
					<line x1="4" y1="21" x2="20" y2="21"></line>
				</svg>
			</button>
			<button
				type="button"
				class="toolbar-btn"
				class:is-active={editor?.isActive('strike')}
				title={$t('admin.editor.strike')}
				onclick={() => editor?.chain().focus().toggleStrike().run()}
			>
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
					<path d="M17.3 13.61A6.3 6.3 0 0 0 12.61 10H10V4h8v6h-2.7" />
					<path d="M6.7 10.39A6.3 6.3 0 0 1 11.39 14H14v6H6v-6h2.7" />
					<line x1="4" y1="12" x2="20" y2="12"></line>
				</svg>
			</button>
		</div>

		<div class="toolbar-group">
			<button
				type="button"
				class="toolbar-btn"
				class:is-active={editor?.isActive('bulletList')}
				title={$t('admin.editor.bulletList')}
				onclick={() => editor?.chain().focus().toggleBulletList().run()}
			>
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
					<line x1="9" y1="6" x2="20" y2="6"></line>
					<line x1="9" y1="12" x2="20" y2="12"></line>
					<line x1="9" y1="18" x2="20" y2="18"></line>
					<line x1="5" y1="6" x2="5" y2="6.01"></line>
					<line x1="5" y1="12" x2="5" y2="12.01"></line>
					<line x1="5" y1="18" x2="5" y2="18.01"></line>
				</svg>
			</button>
			<button
				type="button"
				class="toolbar-btn"
				class:is-active={editor?.isActive('orderedList')}
				title={$t('admin.editor.numberedList')}
				onclick={() => editor?.chain().focus().toggleOrderedList().run()}
			>
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
					<line x1="10" y1="6" x2="21" y2="6"></line>
					<line x1="10" y1="12" x2="21" y2="12"></line>
					<line x1="10" y1="18" x2="21" y2="18"></line>
					<path d="M4 6h1v4"></path>
					<path d="M4 10h2"></path>
					<path d="M6 18H4c0-1 3-2 3-3s-1-1.5-2-1"></path>
				</svg>
			</button>
		</div>

		<div class="toolbar-group">
			<button
				type="button"
				class="toolbar-btn"
				class:is-active={editor?.isActive({ textAlign: 'left' })}
				title={$t('admin.editor.alignLeft')}
				onclick={() => editor?.chain().focus().setTextAlign('left').run()}
			>
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
					<line x1="17" y1="10" x2="3" y2="10"></line>
					<line x1="21" y1="6" x2="3" y2="6"></line>
					<line x1="21" y1="14" x2="3" y2="14"></line>
					<line x1="17" y1="18" x2="3" y2="18"></line>
				</svg>
			</button>
			<button
				type="button"
				class="toolbar-btn"
				class:is-active={editor?.isActive({ textAlign: 'center' })}
				title={$t('admin.editor.alignCenter')}
				onclick={() => editor?.chain().focus().setTextAlign('center').run()}
			>
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
					<line x1="18" y1="10" x2="6" y2="10"></line>
					<line x1="21" y1="6" x2="3" y2="6"></line>
					<line x1="21" y1="14" x2="3" y2="14"></line>
					<line x1="18" y1="18" x2="6" y2="18"></line>
				</svg>
			</button>
			<button
				type="button"
				class="toolbar-btn"
				class:is-active={editor?.isActive({ textAlign: 'right' })}
				title={$t('admin.editor.alignRight')}
				onclick={() => editor?.chain().focus().setTextAlign('right').run()}
			>
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
					<line x1="21" y1="10" x2="7" y2="10"></line>
					<line x1="21" y1="6" x2="3" y2="6"></line>
					<line x1="21" y1="14" x2="3" y2="14"></line>
					<line x1="21" y1="18" x2="7" y2="18"></line>
				</svg>
			</button>
		</div>

		<div class="toolbar-group">
			<div class="color-picker-wrapper">
				<button
					type="button"
					class="toolbar-btn color-btn"
					title={$t('admin.editor.textColor')}
					style="--color: {selectedColor}"
				>
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
						<path d="M20 21H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1z"
						></path>
						<polyline points="7 15 10 8 13 15"></polyline>
						<line x1="8" y1="11" x2="12" y2="11"></line>
					</svg>
				</button>
				<input
					type="color"
					bind:value={selectedColor}
					class="color-input"
					oninput={(event) => {
						selectedColor = event.target.value;
						editor?.chain().focus().setColor(selectedColor).run();
					}}
				/>
			</div>

			<label class="toolbar-btn file-input-btn" title={$t('admin.editor.insertImage')}>
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
					<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
					<circle cx="8.5" cy="8.5" r="1.5"></circle>
					<polyline points="21 15 16 10 5 21"></polyline>
				</svg>
				<input
					type="file"
					accept="image/*"
					onchange={handleImageSelect}
					bind:this={imageInput}
					style="display: none;"
				/>
			</label>

			<button
				type="button"
				class="toolbar-btn"
				title={$t('admin.editor.insertLink')}
				onclick={openLinkModal}
			>
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
					<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
					<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
				</svg>
			</button>

			{#if showLinkModal}
				<div class="link-modal">
					<div class="link-modal-content">
						<input
							type="text"
							placeholder={$t('admin.editor.linkUrlPlaceholder')}
							bind:value={linkUrl}
							class="link-input"
						/>
						<input
							type="text"
							placeholder={$t('admin.editor.linkTextPlaceholder')}
							bind:value={linkText}
							class="link-input"
						/>
						<div class="link-actions">
							<button type="button" class="btn-small btn-primary" onclick={insertLink}>
								{$t('admin.editor.add')}
							</button>
							<button type="button" class="btn-small" onclick={() => (showLinkModal = false)}>
								{$t('admin.editor.cancel')}
							</button>
						</div>
					</div>
				</div>
			{/if}
		</div>

		<div class="toolbar-group">
			<button
				type="button"
				class="toolbar-btn"
				title={$t('admin.editor.clearFormatting')}
				onclick={() => editor?.chain().focus().clearNodes().unsetAllMarks().run()}
			>
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
					<path d="M3 6h18"></path>
					<path d="M8 6v12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V6"></path>
					<line x1="12" y1="6" x2="12" y2="18"></line>
				</svg>
			</button>
		</div>
	</div>

	<div bind:this={editorElement} class="editor-content"></div>
</div>

<style>
	.rich-text-editor {
		border: 1px solid #e3e1dc;
		border-radius: 12px;
		overflow: hidden;
		background: #fff;
		font-family: 'Sora', 'Work Sans', system-ui, sans-serif;
	}

	.toolbar {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		padding: 12px;
		background: #f6f2ea;
		border-bottom: 1px solid #e3e1dc;
	}

	.toolbar-group {
		display: flex;
		gap: 4px;
		padding: 0 8px;
		border-right: 1px solid #d0ccc4;
		position: relative;
	}

	.toolbar-group:last-child {
		border-right: none;
		padding-right: 0;
	}

	.toolbar-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		padding: 0;
		border: 1px solid transparent;
		border-radius: 8px;
		background: transparent;
		color: #151515;
		cursor: pointer;
		transition: all 0.2s ease;
		font-size: 14px;
	}

	.toolbar-btn:hover {
		background: rgba(192, 122, 45, 0.1);
		border-color: #c07a2d;
	}

	.toolbar-btn:active,
	.toolbar-btn.is-active {
		background: rgba(192, 122, 45, 0.2);
		border-color: #8a561f;
	}

	.toolbar-btn.is-active {
		color: #8a561f;
	}

	.color-btn {
		position: relative;
	}

	.color-btn::after {
		content: '';
		position: absolute;
		bottom: 6px;
		left: 50%;
		transform: translateX(-50%);
		width: 12px;
		height: 3px;
		background: var(--color, #000);
		border-radius: 2px;
	}

	.color-picker-wrapper {
		position: relative;
	}

	.color-input {
		position: absolute;
		top: 0;
		left: 0;
		width: 36px;
		height: 36px;
		opacity: 0;
		cursor: pointer;
	}

	.file-input-btn {
		cursor: pointer;
	}

	.link-modal {
		position: absolute;
		top: 44px;
		left: 0;
		background: white;
		border: 1px solid #e3e1dc;
		border-radius: 8px;
		padding: 12px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
		z-index: 100;
		min-width: 260px;
	}

	.link-modal-content {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.link-input {
		width: 100%;
		padding: 8px 12px;
		border: 1px solid #e3e1dc;
		border-radius: 6px;
		font-size: 14px;
		font-family: inherit;
	}

	.link-input:focus {
		outline: none;
		border-color: #c07a2d;
		box-shadow: 0 0 0 3px rgba(192, 122, 45, 0.1);
	}

	.link-actions {
		display: flex;
		gap: 8px;
		margin-top: 4px;
	}

	.btn-small {
		flex: 1;
		padding: 6px 12px;
		border: 1px solid #e3e1dc;
		border-radius: 6px;
		background: #fff;
		color: #151515;
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.btn-small:hover {
		background: #f6f2ea;
		border-color: #c07a2d;
	}

	.btn-small.btn-primary {
		background: #151515;
		color: #fff;
		border-color: #151515;
	}

	.btn-small.btn-primary:hover {
		background: #333;
		border-color: #333;
	}

	.editor-content {
		min-height: 300px;
		padding: 16px;
		font-size: 15px;
		line-height: 1.6;
		color: #151515;
		outline: none;
		overflow-y: auto;
		max-height: 600px;
	}

	.editor-content .ProseMirror {
		outline: none;
	}

	.editor-content .ProseMirror p.is-editor-empty:first-child::before {
		content: attr(data-placeholder);
		color: #6b6b6b;
		float: left;
		height: 0;
		pointer-events: none;
	}

	.editor-content img {
		width: 100%;
		max-width: 100%;
		height: auto;
		display: block;
		margin: 12px 0;
		border-radius: 8px;
		border: 1px solid #e3e1dc;
	}

	.editor-content a {
		color: #0070c0;
		text-decoration: underline;
		cursor: pointer;
	}

	.editor-content ul,
	.editor-content ol {
		margin: 8px 0 8px 24px;
	}

	.editor-content li {
		margin: 4px 0;
	}

	@media (max-width: 768px) {
		.toolbar {
			gap: 4px;
		}

		.toolbar-group {
			padding: 0 4px;
		}

		.toolbar-btn {
			width: 32px;
			height: 32px;
		}

		.editor-content {
			min-height: 200px;
			max-height: 400px;
			font-size: 14px;
		}
	}
</style>
