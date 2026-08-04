<script>
	import TrustedHtml from '$lib/components/TrustedHtml.svelte';
	import { onMount, onDestroy, untrack } from 'svelte';
	import { pushToast } from '$lib/stores/adminToast.js';
	import { t, locale } from '$lib/i18n/admin/index.js';
	import {
		normalizeLegacyBlogContent,
		computeContentStats
	} from '$lib/editor/blogContentAdapter.js';

	let {
		value = '',
		onChange = null,
		placeholder = '',
		uploadSessionId = '',
		uploadEntityType = 'product',
		onUploadStateChange = null,
		agenticImageReviewEnabled = false,
		agenticImages = [],
		onAgenticImageReview = null,
		saveStatus = ''
	} = $props();

	let editor;
	let editorElement;
	let imageInput;
	let ready = $state(false);
	let txCount = $state(0);
	let mode = $state('edit');
	let isFullscreen = $state(false);
	let showLinkModal = $state(false);
	let linkUrl = $state('');
	let linkText = $state('');
	let linkNewTab = $state(true);
	let showOutline = $state(false);
	let showImageDialog = $state(false);
	let imgAlt = $state('');
	let imgTitle = $state('');
	let selectedColor = $state('#151515');
	let imageUploadStatus = $state('idle');
	let imageUploadError = $state('');
	let failedImageFile = $state(null);
	let isUpdatingFromProp = false;
	let detachEditorHandlers = null;
	let reviewToolbar = $state(null);
	let hideReviewTimer;

	const isEn = $derived($locale === 'en');
	const editorPlaceholder = $derived(placeholder || $t('admin.editor.placeholder'));

	const L = $derived({
		undo: isEn ? 'Undo' : 'Hoàn tác',
		redo: isEn ? 'Redo' : 'Làm lại',
		paragraph: isEn ? 'Paragraph' : 'Đoạn văn',
		heading: isEn ? 'Heading' : 'Tiêu đề',
		bold: isEn ? 'Bold' : 'In đậm',
		italic: isEn ? 'Italic' : 'In nghiêng',
		underline: isEn ? 'Underline' : 'Gạch chân',
		strike: isEn ? 'Strikethrough' : 'Gạch ngang',
		inlineCode: isEn ? 'Inline code' : 'Mã nội dòng',
		bulletList: isEn ? 'Bullet list' : 'Danh sách chấm',
		orderedList: isEn ? 'Numbered list' : 'Danh sách số',
		taskList: isEn ? 'Task list' : 'Danh sách công việc',
		alignLeft: isEn ? 'Align left' : 'Canh trái',
		alignCenter: isEn ? 'Align center' : 'Canh giữa',
		alignRight: isEn ? 'Align right' : 'Canh phải',
		alignJustify: isEn ? 'Justify' : 'Canh đều',
		blockquote: isEn ? 'Quote' : 'Trích dẫn',
		codeBlock: isEn ? 'Code block' : 'Khối mã',
		horizontalRule: isEn ? 'Divider' : 'Đường kẻ ngang',
		link: isEn ? 'Insert link' : 'Chèn liên kết',
		image: isEn ? 'Insert image' : 'Chèn ảnh',
		table: isEn ? 'Insert table' : 'Chèn bảng',
		color: isEn ? 'Text color' : 'Màu chữ',
		clear: isEn ? 'Clear formatting' : 'Xoá định dạng',
		preview: isEn ? 'Preview' : 'Xem trước',
		edit: isEn ? 'Edit' : 'Chỉnh sửa',
		fullscreen: isEn ? 'Fullscreen' : 'Toàn màn hình',
		exitFullscreen: isEn ? 'Exit fullscreen' : 'Thoát toàn màn hình',
		addColBefore: isEn ? 'Add column before' : 'Thêm cột trước',
		addColAfter: isEn ? 'Add column after' : 'Thêm cột sau',
		delCol: isEn ? 'Delete column' : 'Xoá cột',
		addRowBefore: isEn ? 'Add row before' : 'Thêm hàng trên',
		addRowAfter: isEn ? 'Add row after' : 'Thêm hàng dưới',
		delRow: isEn ? 'Delete row' : 'Xoá hàng',
		toggleHeader: isEn ? 'Toggle header row' : 'Bật/tắt hàng tiêu đề',
		delTable: isEn ? 'Delete table' : 'Xoá bảng',
		words: isEn ? 'words' : 'từ',
		characters: isEn ? 'characters' : 'ký tự',
		readingTime: isEn ? 'min read' : 'phút đọc',
		headings: isEn ? 'headings' : 'tiêu đề',
		noH2: isEn ? 'No H2 heading yet' : 'Chưa có tiêu đề H2',
		badHierarchy: isEn ? 'Heading hierarchy skips a level' : 'Cấp tiêu đề bị nhảy bậc',
		linkNewTab: isEn ? 'Open in new tab' : 'Mở tab mới',
		outline: isEn ? 'Document outline' : 'Dàn ý bài viết',
		outlineEmpty: isEn ? 'No headings yet' : 'Chưa có tiêu đề',
		imageProps: isEn ? 'Image alt & title' : 'Alt & tiêu đề ảnh',
		altLabel: isEn ? 'Alt text' : 'Chữ thay thế (alt)',
		titleLabel: isEn ? 'Title' : 'Tiêu đề ảnh',
		save: isEn ? 'Save' : 'Lưu',
		saveUnsaved: isEn ? 'Unsaved' : 'Chưa lưu',
		saveSaving: isEn ? 'Saving…' : 'Đang lưu…',
		saveSaved: isEn ? 'Saved' : 'Đã lưu',
		saveFailed: isEn ? 'Save failed' : 'Lưu lỗi',
		add: isEn ? 'Add' : 'Thêm',
		cancel: isEn ? 'Cancel' : 'Huỷ'
	});

	const resolveAdminPath = (path) => {
		if (typeof window === 'undefined' || window.location.hostname !== 'admin.inoxpran.com') {
			return path;
		}
		return path.replace(/^\/admin(?=\/|$)/, '') || '/';
	};

	// Reactive helpers: reading txCount registers a dependency so toolbar/state
	// re-evaluate on every editor transaction (selection or content change).
	const isActive = (name, attrs) => txCount > -1 && Boolean(editor?.isActive(name, attrs));
	const can = (fn) => {
		void txCount;
		try {
			return Boolean(editor && fn(editor));
		} catch {
			return false;
		}
	};

	const headingValue = $derived.by(() => {
		void txCount;
		if (!editor) return 'paragraph';
		for (const level of [2, 3, 4, 5, 6]) {
			if (editor.isActive('heading', { level })) return `h${level}`;
		}
		return 'paragraph';
	});

	const stats = $derived.by(() => {
		void txCount;
		if (!ready || !editor) {
			return {
				words: 0,
				characters: 0,
				readingTime: 1,
				headings: { total: 0 },
				hasH2: false,
				invalidHierarchy: false
			};
		}
		return computeContentStats({ text: editor.getText(), html: editor.getHTML() });
	});

	const previewHtml = $derived.by(() => {
		void txCount;
		if (!editor) return '';
		return editor.getHTML();
	});

	const inTable = $derived(isActive('table'));
	const imageSelected = $derived(isActive('image') || isActive('figure'));

	const outline = $derived.by(() => {
		void txCount;
		if (!ready || !editorElement) return [];
		return Array.from(editorElement.querySelectorAll('h2, h3, h4')).map((el, index) => ({
			index,
			level: Number(el.tagName.slice(1)),
			text: el.textContent?.trim() || '—'
		}));
	});

	const scrollToHeading = (index) => {
		const nodes = editorElement?.querySelectorAll('h2, h3, h4');
		nodes?.[index]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
		showOutline = false;
	};

	const openImageDialog = () => {
		if (!editor) return;
		const type = editor.isActive('figure') ? 'figure' : 'image';
		const attrs = editor.getAttributes(type) || {};
		imgAlt = attrs.alt || '';
		imgTitle = attrs.title || '';
		showImageDialog = true;
	};

	const applyImageDialog = () => {
		if (!editor) return;
		const type = editor.isActive('figure') ? 'figure' : 'image';
		editor
			.chain()
			.focus()
			.updateAttributes(type, { alt: imgAlt || null, title: imgTitle || null })
			.run();
		showImageDialog = false;
		emitChange();
	};

	const emitChange = () => {
		if (onChange) onChange(editor?.getHTML() || '');
	};

	const setHeading = (event) => {
		const nextValue = event.currentTarget.value;
		if (!editor) return;
		if (nextValue === 'paragraph') {
			editor.chain().focus().setParagraph().run();
			return;
		}
		const level = Number(nextValue.replace('h', ''));
		editor.chain().focus().toggleHeading({ level }).run();
	};

	const insertTable = () => {
		editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
	};

	const findAgenticImage = (imageElement) => {
		const imageId = imageElement?.dataset?.imageId || '';
		const src = imageElement?.getAttribute?.('src') || '';
		const imageIndex = Array.from(editorElement?.querySelectorAll?.('img') || []).indexOf(
			imageElement
		);
		const metadata =
			agenticImages.find(
				(image) => (imageId && image.imageId === imageId) || (src && image.url === src)
			) || agenticImages[imageIndex];
		if (!metadata) return null;
		return { metadata, imageIndex, currentSrc: src };
	};

	const showReviewToolbar = (imageElement) => {
		if (!agenticImageReviewEnabled || !imageElement) return;
		const match = findAgenticImage(imageElement);
		if (!match) return;
		clearTimeout(hideReviewTimer);
		const root = editorElement?.closest('.rich-text-editor');
		const rootRect = root?.getBoundingClientRect();
		const imageRect = imageElement.getBoundingClientRect();
		if (!rootRect) return;
		reviewToolbar = {
			image: match.metadata,
			imageIndex: match.imageIndex,
			currentSrc: match.currentSrc,
			top: Math.max(58, imageRect.top - rootRect.top + 8),
			right: Math.max(8, rootRect.right - imageRect.right + 8)
		};
	};

	const scheduleHideReviewToolbar = () => {
		clearTimeout(hideReviewTimer);
		hideReviewTimer = setTimeout(() => {
			reviewToolbar = null;
		}, 180);
	};

	const handleEditorPointerOver = (event) => {
		const image = event.target?.closest?.('img');
		if (image && editorElement?.contains(image)) showReviewToolbar(image);
	};

	const handleEditorClick = (event) => {
		const image = event.target?.closest?.('img');
		if (image && editorElement?.contains(image)) showReviewToolbar(image);
	};

	const submitImageReview = (decision) => {
		if (!reviewToolbar?.image) return;
		onAgenticImageReview?.({
			decision,
			target: {
				type: 'inline',
				imageId: reviewToolbar.image.imageId,
				url: reviewToolbar.image.url,
				currentSrc: reviewToolbar.currentSrc,
				imageIndex: reviewToolbar.imageIndex,
				headingIndex: reviewToolbar.image.headingIndex,
				afterHeading: reviewToolbar.image.afterHeading
			}
		});
	};

	const setImageUploadState = (status, error = '') => {
		imageUploadStatus = status;
		imageUploadError = error;
		onUploadStateChange?.({ status, error });
	};

	const uploadImage = async (file) => {
		const payload = new FormData();
		payload.set('image', file);
		if (uploadSessionId) payload.set('upload_session_id', uploadSessionId);
		payload.set('entity_type', uploadEntityType === 'blog' ? 'blog' : 'product');

		const response = await fetch(resolveAdminPath('/admin/uploads/description-image'), {
			method: 'POST',
			body: payload
		});

		const data = await response.json().catch(() => null);
		if (!response.ok) {
			const message = data?.error || $t('admin.editor.imageUploadFailed');
			throw new Error(message);
		}
		if (!data?.url) throw new Error($t('admin.editor.uploadMissingUrl'));
		return data.url;
	};

	const insertImageFile = async (file) => {
		if (!file || !file.type?.startsWith('image/')) {
			pushToast({ tone: 'error', message: $t('admin.editor.onlyImagesAllowed') });
			return;
		}
		if (imageUploadStatus === 'uploading') {
			pushToast({ tone: 'error', message: 'Vui lòng chờ ảnh mô tả hiện tại tải xong.' });
			return;
		}

		failedImageFile = null;
		setImageUploadState('uploading');
		try {
			const url = await uploadImage(file);
			editor?.chain().focus().setImage({ src: url }).run();
			setImageUploadState('success');
			setImageUploadState('idle');
			pushToast({ tone: 'success', message: $t('admin.editor.imageAdded') });
		} catch (error) {
			const message = error?.message || $t('admin.editor.imageUploadFailed');
			failedImageFile = file;
			setImageUploadState('error', message);
			pushToast({ tone: 'error', message });
		}
	};

	const retryImageUpload = () => {
		if (!failedImageFile || imageUploadStatus === 'uploading') return;
		void insertImageFile(failedImageFile);
	};

	const dismissImageUploadError = () => {
		failedImageFile = null;
		setImageUploadState('idle');
	};

	const handleImageSelect = async (event) => {
		const file = event.target?.files?.[0];
		if (file) await insertImageFile(file);
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
		if (file) await insertImageFile(file);
	};

	const openLinkModal = () => {
		if (!editor) return;
		const { from, to } = editor.state.selection;
		const selected = editor.state.doc.textBetween(from, to, ' ');
		linkText = selected;
		const existingHref = editor.getAttributes('link')?.href || '';
		linkUrl = existingHref;
		showLinkModal = true;
	};

	const insertLink = () => {
		if (!editor) return;
		const rawUrl = linkUrl.trim();
		if (!rawUrl) {
			pushToast({ tone: 'error', message: $t('admin.editor.linkUrlRequired') });
			return;
		}

		const url = /^(https?:|mailto:|tel:|\/)/i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
		const hasSelection = !editor.state.selection.empty;
		const fallbackText = linkText.trim() || url;
		const attrs = { href: url, target: linkNewTab ? '_blank' : null };

		const chain = editor.chain().focus();
		if (hasSelection) {
			chain.extendMarkRange('link').setLink(attrs).run();
		} else {
			chain.insertContent(fallbackText).extendMarkRange('link').setLink(attrs).run();
		}

		linkUrl = '';
		linkText = '';
		showLinkModal = false;
		emitChange();
		pushToast({ tone: 'success', message: $t('admin.editor.linkAdded') });
	};

	const removeLink = () => {
		editor?.chain().focus().extendMarkRange('link').unsetLink().run();
		showLinkModal = false;
		emitChange();
	};

	const toggleFullscreen = () => {
		isFullscreen = !isFullscreen;
	};

	onMount(() => {
		let cancelled = false;

		void import('$lib/editor/tiptapRuntime.js')
			.then(({ loadTiptapRuntime }) => loadTiptapRuntime())
			.then(
				({
					Color,
					Editor,
					Figure,
					Image,
					Link,
					Placeholder,
					StarterKit,
					Table,
					TableCell,
					TableHeader,
					TableRow,
					TaskItem,
					TaskList,
					TextAlign,
					TextStyle,
					Underline
				}) => {
					if (cancelled || !editorElement) return;

					editor = new Editor({
						element: editorElement,
						content: normalizeLegacyBlogContent(value || ''),
						extensions: [
							StarterKit.configure({
								heading: { levels: [2, 3, 4, 5, 6] }
							}),
							Underline,
							TextStyle,
							Color,
							Link.configure({ openOnClick: false, autolink: true }),
							Image.extend({
								addAttributes() {
									return {
										...this.parent?.(),
										width: {
											default: null,
											parseHTML: (element) => element.getAttribute('width'),
											renderHTML: (attributes) =>
												attributes.width ? { width: attributes.width } : {}
										},
										height: {
											default: null,
											parseHTML: (element) => element.getAttribute('height'),
											renderHTML: (attributes) =>
												attributes.height ? { height: attributes.height } : {}
										},
										imageId: {
											default: null,
											parseHTML: (element) => element.getAttribute('data-image-id'),
											renderHTML: (attributes) =>
												attributes.imageId ? { 'data-image-id': attributes.imageId } : {}
										},
										sourceType: {
											default: null,
											parseHTML: (element) => element.getAttribute('data-source-type'),
											renderHTML: (attributes) =>
												attributes.sourceType ? { 'data-source-type': attributes.sourceType } : {}
										},
										reviewStatus: {
											default: null,
											parseHTML: (element) => element.getAttribute('data-review-status'),
											renderHTML: (attributes) =>
												attributes.reviewStatus
													? { 'data-review-status': attributes.reviewStatus }
													: {}
										}
									};
								}
							}).configure({ inline: false }),
							Figure,
							TextAlign.configure({ types: ['heading', 'paragraph'] }),
							Placeholder.configure({ placeholder: editorPlaceholder }),
							Table.configure({ resizable: true, allowTableNodeSelection: true }),
							TableRow,
							TableHeader,
							TableCell,
							TaskList,
							TaskItem.configure({ nested: true })
						],
						onUpdate: () => {
							txCount += 1;
							if (isUpdatingFromProp) return;
							emitChange();
						},
						onSelectionUpdate: () => {
							txCount += 1;
						}
					});

					const dom = editor.view.dom;
					dom.addEventListener('drop', handleDrop);
					dom.addEventListener('paste', handlePaste);
					dom.addEventListener('pointerover', handleEditorPointerOver);
					dom.addEventListener('click', handleEditorClick);
					dom.addEventListener('pointerleave', scheduleHideReviewToolbar);
					detachEditorHandlers = () => {
						dom.removeEventListener('drop', handleDrop);
						dom.removeEventListener('paste', handlePaste);
						dom.removeEventListener('pointerover', handleEditorPointerOver);
						dom.removeEventListener('click', handleEditorClick);
						dom.removeEventListener('pointerleave', scheduleHideReviewToolbar);
					};

					ready = true;
					txCount += 1;
				}
			)
			.catch(() => {
				if (cancelled) return;
				pushToast({
					tone: 'error',
					message: isEn
						? 'The editor could not be loaded. Please reload the page.'
						: 'Không thể tải trình soạn thảo. Vui lòng tải lại trang.'
				});
			});

		return () => {
			cancelled = true;
		};
	});

	onDestroy(() => {
		detachEditorHandlers?.();
		clearTimeout(hideReviewTimer);
		editor?.destroy();
		editor = null;
	});

	// Hydration: read `value` + `ready` first so this effect always tracks them
	// (fixes the blank-editor case where async content arrives after mount).
	$effect(() => {
		const nextValue = normalizeLegacyBlogContent(value || '');
		if (!ready || !editor) return;
		const currentValue = editor.getHTML();
		const normalizedCurrentValue = normalizeLegacyBlogContent(currentValue);
		const isSame =
			currentValue === nextValue ||
			normalizedCurrentValue === nextValue ||
			(editor.isEmpty && !nextValue);
		if (isSame) return;
		untrack(() => {
			isUpdatingFromProp = true;
			try {
				editor.commands.setContent(nextValue, false);
			} finally {
				isUpdatingFromProp = false;
			}
			txCount += 1;
		});
	});
</script>

<div class="rich-text-editor" class:is-fullscreen={isFullscreen}>
	<div class="toolbar">
		<div class="toolbar-group">
			<button
				type="button"
				class="toolbar-btn"
				title={L.undo}
				disabled={!can((e) => e.can().undo())}
				onclick={() => editor?.chain().focus().undo().run()}>↺</button
			>
			<button
				type="button"
				class="toolbar-btn"
				title={L.redo}
				disabled={!can((e) => e.can().redo())}
				onclick={() => editor?.chain().focus().redo().run()}>↻</button
			>
		</div>

		<div class="toolbar-group">
			<select class="heading-select" title={L.heading} value={headingValue} onchange={setHeading}>
				<option value="paragraph">{L.paragraph}</option>
				<option value="h2">H2</option>
				<option value="h3">H3</option>
				<option value="h4">H4</option>
				<option value="h5">H5</option>
				<option value="h6">H6</option>
			</select>
		</div>

		<div class="toolbar-group">
			<button
				type="button"
				class="toolbar-btn"
				class:is-active={isActive('bold')}
				title={L.bold}
				onclick={() => editor?.chain().focus().toggleBold().run()}><b>B</b></button
			>
			<button
				type="button"
				class="toolbar-btn"
				class:is-active={isActive('italic')}
				title={L.italic}
				onclick={() => editor?.chain().focus().toggleItalic().run()}><i>I</i></button
			>
			<button
				type="button"
				class="toolbar-btn"
				class:is-active={isActive('underline')}
				title={L.underline}
				onclick={() => editor?.chain().focus().toggleUnderline().run()}><u>U</u></button
			>
			<button
				type="button"
				class="toolbar-btn"
				class:is-active={isActive('strike')}
				title={L.strike}
				onclick={() => editor?.chain().focus().toggleStrike().run()}><s>S</s></button
			>
			<button
				type="button"
				class="toolbar-btn mono"
				class:is-active={isActive('code')}
				title={L.inlineCode}
				onclick={() => editor?.chain().focus().toggleCode().run()}>&lt;/&gt;</button
			>
		</div>

		<div class="toolbar-group">
			<button
				type="button"
				class="toolbar-btn"
				class:is-active={isActive('bulletList')}
				title={L.bulletList}
				onclick={() => editor?.chain().focus().toggleBulletList().run()}>•≡</button
			>
			<button
				type="button"
				class="toolbar-btn"
				class:is-active={isActive('orderedList')}
				title={L.orderedList}
				onclick={() => editor?.chain().focus().toggleOrderedList().run()}>1.</button
			>
			<button
				type="button"
				class="toolbar-btn"
				class:is-active={isActive('taskList')}
				title={L.taskList}
				onclick={() => editor?.chain().focus().toggleTaskList().run()}>☑</button
			>
		</div>

		<div class="toolbar-group">
			<button
				type="button"
				class="toolbar-btn"
				class:is-active={isActive({ textAlign: 'left' })}
				title={L.alignLeft}
				onclick={() => editor?.chain().focus().setTextAlign('left').run()}>⯇</button
			>
			<button
				type="button"
				class="toolbar-btn"
				class:is-active={isActive({ textAlign: 'center' })}
				title={L.alignCenter}
				onclick={() => editor?.chain().focus().setTextAlign('center').run()}>≡</button
			>
			<button
				type="button"
				class="toolbar-btn"
				class:is-active={isActive({ textAlign: 'right' })}
				title={L.alignRight}
				onclick={() => editor?.chain().focus().setTextAlign('right').run()}>⯈</button
			>
			<button
				type="button"
				class="toolbar-btn"
				class:is-active={isActive({ textAlign: 'justify' })}
				title={L.alignJustify}
				onclick={() => editor?.chain().focus().setTextAlign('justify').run()}>☰</button
			>
		</div>

		<div class="toolbar-group">
			<button
				type="button"
				class="toolbar-btn"
				class:is-active={isActive('blockquote')}
				title={L.blockquote}
				onclick={() => editor?.chain().focus().toggleBlockquote().run()}>❝</button
			>
			<button
				type="button"
				class="toolbar-btn"
				class:is-active={isActive('codeBlock')}
				title={L.codeBlock}
				onclick={() => editor?.chain().focus().toggleCodeBlock().run()}>{'{ }'}</button
			>
			<button
				type="button"
				class="toolbar-btn"
				title={L.horizontalRule}
				onclick={() => editor?.chain().focus().setHorizontalRule().run()}>―</button
			>
		</div>

		<div class="toolbar-group">
			<button type="button" class="toolbar-btn" title={L.link} onclick={openLinkModal}>🔗</button>
			<label class="toolbar-btn file-input-btn" title={L.image}>
				🖼
				<input
					type="file"
					accept="image/*"
					onchange={handleImageSelect}
					bind:this={imageInput}
					disabled={imageUploadStatus === 'uploading'}
					style="display:none"
				/>
			</label>
			<button type="button" class="toolbar-btn" title={L.table} onclick={insertTable}>▦</button>
			<button
				type="button"
				class="toolbar-btn"
				title={L.imageProps}
				disabled={!imageSelected}
				onclick={openImageDialog}>ℹ</button
			>
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
						<label class="link-checkbox"
							><input type="checkbox" bind:checked={linkNewTab} /> {L.linkNewTab}</label
						>
						<div class="link-actions">
							<button type="button" class="btn-small btn-primary" onclick={insertLink}
								>{L.add}</button
							>
							<button type="button" class="btn-small" onclick={removeLink}>✕ 🔗</button>
							<button type="button" class="btn-small" onclick={() => (showLinkModal = false)}
								>{L.cancel}</button
							>
						</div>
					</div>
				</div>
			{/if}
			{#if showImageDialog}
				<div class="link-modal">
					<div class="link-modal-content">
						<label class="dlg-label">
							{L.altLabel}
							<input type="text" bind:value={imgAlt} class="link-input" />
						</label>
						<label class="dlg-label">
							{L.titleLabel}
							<input type="text" bind:value={imgTitle} class="link-input" />
						</label>
						<div class="link-actions">
							<button type="button" class="btn-small btn-primary" onclick={applyImageDialog}
								>{L.save}</button
							>
							<button type="button" class="btn-small" onclick={() => (showImageDialog = false)}
								>{L.cancel}</button
							>
						</div>
					</div>
				</div>
			{/if}
		</div>

		<div class="toolbar-group">
			<div class="color-picker-wrapper">
				<button
					type="button"
					class="toolbar-btn color-btn"
					title={L.color}
					style="--color: {selectedColor}">A</button
				>
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
			<button
				type="button"
				class="toolbar-btn"
				title={L.clear}
				onclick={() => editor?.chain().focus().clearNodes().unsetAllMarks().run()}>⌫</button
			>
		</div>

		<div class="toolbar-group toolbar-group--view">
			<button
				type="button"
				class="toolbar-btn outline-btn"
				class:is-active={showOutline}
				title={L.outline}
				onclick={() => (showOutline = !showOutline)}>TOC</button
			>
			{#if showOutline}
				<div class="outline-panel">
					<div class="outline-head">{L.outline}</div>
					{#if outline.length}
						<ul>
							{#each outline as item (item.index)}
								<li class={`lvl-${item.level}`}>
									<button type="button" onclick={() => scrollToHeading(item.index)}
										>{item.text}</button
									>
								</li>
							{/each}
						</ul>
					{:else}
						<div class="outline-empty">{L.outlineEmpty}</div>
					{/if}
				</div>
			{/if}
			<button
				type="button"
				class="toolbar-btn"
				class:is-active={mode === 'preview'}
				title={mode === 'preview' ? L.edit : L.preview}
				onclick={() => (mode = mode === 'preview' ? 'edit' : 'preview')}>👁</button
			>
			<button
				type="button"
				class="toolbar-btn"
				title={isFullscreen ? L.exitFullscreen : L.fullscreen}
				onclick={toggleFullscreen}>⛶</button
			>
		</div>
	</div>

	{#if inTable && mode === 'edit'}
		<div class="table-toolbar">
			<button type="button" onclick={() => editor?.chain().focus().addColumnBefore().run()}
				>{L.addColBefore}</button
			>
			<button type="button" onclick={() => editor?.chain().focus().addColumnAfter().run()}
				>{L.addColAfter}</button
			>
			<button type="button" onclick={() => editor?.chain().focus().deleteColumn().run()}
				>{L.delCol}</button
			>
			<button type="button" onclick={() => editor?.chain().focus().addRowBefore().run()}
				>{L.addRowBefore}</button
			>
			<button type="button" onclick={() => editor?.chain().focus().addRowAfter().run()}
				>{L.addRowAfter}</button
			>
			<button type="button" onclick={() => editor?.chain().focus().deleteRow().run()}
				>{L.delRow}</button
			>
			<button type="button" onclick={() => editor?.chain().focus().toggleHeaderRow().run()}
				>{L.toggleHeader}</button
			>
			<button
				type="button"
				class="danger"
				onclick={() => editor?.chain().focus().deleteTable().run()}>{L.delTable}</button
			>
		</div>
	{/if}

	{#if imageUploadStatus === 'uploading' || imageUploadStatus === 'error'}
		<div
			class="editor-upload-state"
			class:error={imageUploadStatus === 'error'}
			role="status"
			aria-live="polite"
		>
			{#if imageUploadStatus === 'uploading'}
				<span class="editor-upload-spinner" aria-hidden="true"></span>
				<span>Đang tải ảnh mô tả...</span>
			{:else}
				<span class="editor-upload-error-icon" aria-hidden="true">!</span>
				<span>{imageUploadError || 'Không thể tải ảnh mô tả.'}</span>
				<div class="editor-upload-actions">
					<button type="button" onclick={retryImageUpload}>Thử lại</button>
					<button type="button" onclick={dismissImageUploadError}>Bỏ qua ảnh</button>
				</div>
			{/if}
		</div>
	{/if}

	<div class="editor-body">
		<div
			bind:this={editorElement}
			class="editor-content"
			class:is-hidden={mode === 'preview'}
		></div>
		{#if mode === 'preview'}
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			<div class="editor-preview blog-content"><TrustedHtml html={previewHtml} /></div>
		{/if}

		{#if agenticImageReviewEnabled && reviewToolbar && mode === 'edit'}
			<div
				class="agentic-image-toolbar"
				role="toolbar"
				tabindex="0"
				aria-label={isEn ? 'Image review actions' : 'Thao tác duyệt ảnh'}
				style={`top:${reviewToolbar.top}px;right:${reviewToolbar.right}px`}
				onpointerenter={() => clearTimeout(hideReviewTimer)}
				onpointerleave={scheduleHideReviewToolbar}
			>
				<span
					class={`review-status status-${reviewToolbar.image.reviewStatus || 'pending_review'}`}
				>
					{$t(
						`admin.blogImageReview.status.${reviewToolbar.image.reviewStatus || 'pending_review'}`
					)}
				</span>
				{#if (reviewToolbar.image.reviewStatus || 'pending_review') === 'pending_review'}
					<button type="button" class="approve" onclick={() => submitImageReview('approved')}>
						{$t('admin.blogImageReview.actions.approve')}
					</button>
					<button type="button" class="reject" onclick={() => submitImageReview('rejected')}>
						{$t('admin.blogImageReview.actions.reject')}
					</button>
				{:else}
					<button type="button" class="edit" onclick={() => submitImageReview('edit')}>
						{$t('admin.blogImageReview.actions.edit')}
					</button>
				{/if}
			</div>
		{/if}
	</div>

	<div class="editor-stats">
		<span>{stats.words} {L.words}</span>
		<span>{stats.characters} {L.characters}</span>
		<span>{stats.readingTime} {L.readingTime}</span>
		<span>{stats.headings.total} {L.headings}</span>
		{#if !stats.hasH2 && stats.words > 0}
			<span class="warn">⚠ {L.noH2}</span>
		{/if}
		{#if stats.invalidHierarchy}
			<span class="warn">⚠ {L.badHierarchy}</span>
		{/if}
		{#if saveStatus}
			<span class={`save-status save-${saveStatus}`}>
				{saveStatus === 'unsaved'
					? L.saveUnsaved
					: saveStatus === 'saving'
						? L.saveSaving
						: saveStatus === 'saved'
							? L.saveSaved
							: saveStatus === 'failed'
								? L.saveFailed
								: ''}
			</span>
		{/if}
	</div>
</div>

<style>
	.rich-text-editor {
		position: relative;
		border: 1px solid #e3e1dc;
		border-radius: 12px;
		overflow: hidden;
		background: #fff;
		font-family: 'Sora', 'Work Sans', system-ui, sans-serif;
	}

	.rich-text-editor.is-fullscreen {
		position: fixed;
		inset: 0;
		z-index: 1200;
		border-radius: 0;
		display: flex;
		flex-direction: column;
	}

	.rich-text-editor.is-fullscreen .editor-body {
		flex: 1;
		min-height: 0;
	}

	.rich-text-editor.is-fullscreen .editor-content,
	.rich-text-editor.is-fullscreen .editor-preview {
		max-height: none;
		height: 100%;
	}

	.agentic-image-toolbar {
		position: absolute;
		z-index: 60;
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px;
		border: 1px solid rgba(255, 255, 255, 0.22);
		border-radius: 8px;
		background: #17251f;
		box-shadow: 0 10px 28px rgba(12, 31, 24, 0.24);
		color: #fff;
		font-size: 12px;
	}

	.agentic-image-toolbar .review-status {
		padding: 0 4px;
		color: #dce8e2;
		font-weight: 600;
	}

	.agentic-image-toolbar .status-pending_review {
		color: #ffd98b;
	}
	.agentic-image-toolbar .status-approved {
		color: #87dfb5;
	}
	.agentic-image-toolbar .status-rejected {
		color: #ffaaa0;
	}
	.agentic-image-toolbar .status-replaced {
		color: #aebfff;
	}

	.agentic-image-toolbar button {
		min-height: 30px;
		border: 0;
		border-radius: 6px;
		padding: 0 10px;
		font: inherit;
		font-weight: 700;
		cursor: pointer;
	}

	.agentic-image-toolbar .approve {
		background: #dff7e9;
		color: #09613a;
	}
	.agentic-image-toolbar .reject {
		background: #fff0ed;
		color: #a52d20;
	}
	.agentic-image-toolbar .edit {
		background: #e9efff;
		color: #294f9e;
	}

	.toolbar {
		position: sticky;
		top: 0;
		z-index: 20;
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		padding: 10px 12px;
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
	.toolbar-group--view {
		margin-left: auto;
		border-right: none;
	}

	.toolbar-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 34px;
		height: 34px;
		padding: 0 6px;
		border: 1px solid transparent;
		border-radius: 8px;
		background: transparent;
		color: #151515;
		cursor: pointer;
		transition: all 0.15s ease;
		font-size: 14px;
		line-height: 1;
	}

	.toolbar-btn.mono {
		font-family: ui-monospace, monospace;
		font-size: 12px;
	}
	.toolbar-btn:hover {
		background: rgba(192, 122, 45, 0.1);
		border-color: #c07a2d;
	}
	.toolbar-btn:active,
	.toolbar-btn.is-active {
		background: rgba(192, 122, 45, 0.2);
		border-color: #8a561f;
		color: #8a561f;
	}
	.toolbar-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.heading-select {
		height: 34px;
		border: 1px solid #d0ccc4;
		border-radius: 8px;
		background: #fff;
		padding: 0 8px;
		font: inherit;
		font-size: 13px;
		cursor: pointer;
	}

	.table-toolbar {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		padding: 8px 12px;
		background: #fbf7ef;
		border-bottom: 1px solid #e9e2d5;
	}

	.table-toolbar button {
		border: 1px solid #ddd6ca;
		border-radius: 6px;
		background: #fff;
		padding: 4px 8px;
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
	}

	.table-toolbar button:hover {
		border-color: #c07a2d;
	}
	.table-toolbar button.danger {
		color: #b42318;
		border-color: #f3c6c1;
	}

	.editor-upload-state {
		display: flex;
		align-items: center;
		gap: 9px;
		min-height: 42px;
		padding: 8px 12px;
		border-bottom: 1px solid #cce7e2;
		background: #effaf8;
		color: #0f766e;
		font-size: 0.82rem;
		font-weight: 600;
	}

	.editor-upload-state.error {
		border-bottom-color: #fecaca;
		background: #fff1f2;
		color: #b42318;
	}

	.editor-upload-spinner {
		width: 17px;
		height: 17px;
		flex: 0 0 17px;
		border: 2px solid rgba(15, 118, 110, 0.22);
		border-top-color: #0f766e;
		border-radius: 50%;
		animation: editor-upload-spin 0.75s linear infinite;
	}

	.editor-upload-error-icon {
		display: grid;
		place-items: center;
		width: 18px;
		height: 18px;
		flex: 0 0 18px;
		border-radius: 50%;
		background: #dc2626;
		color: #fff;
		font-size: 0.72rem;
	}

	.editor-upload-actions {
		display: flex;
		gap: 6px;
		margin-left: auto;
	}
	.editor-upload-actions button {
		border: 1px solid currentColor;
		border-radius: 6px;
		padding: 4px 8px;
		background: #fff;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}

	@keyframes editor-upload-spin {
		to {
			transform: rotate(360deg);
		}
	}

	.color-btn {
		position: relative;
		font-weight: 800;
	}
	.color-btn::after {
		content: '';
		position: absolute;
		bottom: 5px;
		left: 50%;
		transform: translateX(-50%);
		width: 14px;
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
		width: 34px;
		height: 34px;
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
	.link-checkbox {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: #555;
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
		padding: 6px 10px;
		border: 1px solid #e3e1dc;
		border-radius: 6px;
		background: #fff;
		color: #151515;
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
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

	.editor-body {
		position: relative;
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

	.editor-content.is-hidden {
		display: none;
	}

	.editor-preview {
		min-height: 300px;
		max-height: 600px;
		overflow-y: auto;
		padding: 20px;
	}

	.editor-content :global(.ProseMirror) {
		outline: none;
	}
	.editor-content :global(.ProseMirror p.is-editor-empty:first-child::before) {
		content: attr(data-placeholder);
		color: #6b6b6b;
		float: left;
		height: 0;
		pointer-events: none;
	}

	.editor-content :global(img),
	.editor-preview :global(img) {
		max-width: 100%;
		height: auto;
		display: block;
		margin: 12px 0;
		border-radius: 8px;
		border: 1px solid #e3e1dc;
	}

	.editor-content :global(figure),
	.editor-preview :global(figure) {
		margin: 16px 0;
	}
	.editor-content :global(figcaption),
	.editor-preview :global(figcaption) {
		margin-top: 6px;
		font-size: 0.85rem;
		color: #6b6b6b;
		text-align: center;
	}

	.editor-content :global(a),
	.editor-preview :global(a) {
		color: #0070c0;
		text-decoration: underline;
		cursor: pointer;
	}

	.editor-content :global(ul),
	.editor-content :global(ol),
	.editor-preview :global(ul),
	.editor-preview :global(ol) {
		margin: 8px 0 8px 24px;
	}

	.editor-content :global(ul[data-type='taskList']),
	.editor-preview :global(ul[data-type='taskList']) {
		list-style: none;
		margin-left: 0;
		padding-left: 0;
	}
	.editor-content :global(ul[data-type='taskList'] li),
	.editor-preview :global(ul[data-type='taskList'] li) {
		display: flex;
		gap: 8px;
		align-items: flex-start;
	}

	.editor-content :global(blockquote),
	.editor-preview :global(blockquote) {
		border-left: 3px solid #c07a2d;
		margin: 12px 0;
		padding: 4px 14px;
		color: #4b4b4b;
	}

	.editor-content :global(pre),
	.editor-preview :global(pre) {
		background: #17201b;
		color: #e6f0ea;
		border-radius: 8px;
		padding: 12px 14px;
		overflow-x: auto;
		font-family: ui-monospace, monospace;
		font-size: 0.85rem;
	}

	.editor-content :global(hr),
	.editor-preview :global(hr) {
		border: none;
		border-top: 1px solid #ddd6ca;
		margin: 18px 0;
	}

	.editor-content :global(table),
	.editor-preview :global(table) {
		border-collapse: collapse;
		width: 100%;
		margin: 14px 0;
		overflow: hidden;
	}

	.editor-content :global(th),
	.editor-content :global(td),
	.editor-preview :global(th),
	.editor-preview :global(td) {
		border: 1px solid #d8d2c6;
		padding: 6px 10px;
		vertical-align: top;
	}

	.editor-content :global(th),
	.editor-preview :global(th) {
		background: #f6f2ea;
		font-weight: 700;
		text-align: left;
	}

	.editor-stats {
		display: flex;
		flex-wrap: wrap;
		gap: 14px;
		padding: 8px 14px;
		border-top: 1px solid #e3e1dc;
		background: #faf8f4;
		font-size: 0.78rem;
		color: #6b6b6b;
	}

	.editor-stats .warn {
		color: #b45309;
		font-weight: 700;
	}

	.save-status {
		margin-left: auto;
		font-weight: 700;
	}
	.save-status.save-unsaved {
		color: #b45309;
	}
	.save-status.save-saving {
		color: #6b6b6b;
	}
	.save-status.save-saved {
		color: #13795b;
	}
	.save-status.save-failed {
		color: #b42318;
	}

	.outline-btn {
		font-size: 11px;
		font-weight: 800;
		letter-spacing: 0.03em;
	}

	.dlg-label {
		display: grid;
		gap: 4px;
		font-size: 12px;
		font-weight: 600;
		color: #555;
	}

	.outline-panel {
		position: absolute;
		top: 44px;
		right: 0;
		width: 280px;
		max-height: 360px;
		overflow-y: auto;
		background: #fff;
		border: 1px solid #e3e1dc;
		border-radius: 8px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
		z-index: 100;
		padding: 8px;
	}

	.outline-head {
		font-size: 12px;
		font-weight: 800;
		color: #8a561f;
		padding: 4px 6px;
	}

	.outline-panel ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.outline-panel li button {
		display: block;
		width: 100%;
		text-align: left;
		border: 0;
		background: transparent;
		padding: 5px 6px;
		border-radius: 6px;
		cursor: pointer;
		font: inherit;
		font-size: 13px;
		color: #151515;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.outline-panel li button:hover {
		background: #f6f2ea;
	}
	.outline-panel li.lvl-3 button {
		padding-left: 18px;
		color: #444;
	}
	.outline-panel li.lvl-4 button {
		padding-left: 30px;
		color: #666;
		font-size: 12px;
	}
	.outline-empty {
		padding: 8px 6px;
		color: #6b6b6b;
		font-size: 13px;
	}

	@media (max-width: 768px) {
		.toolbar {
			gap: 4px;
			padding: 8px;
		}
		.toolbar-group {
			padding: 0 4px;
		}
		.toolbar-group--view {
			margin-left: 0;
		}
		.toolbar-btn {
			min-width: 30px;
			height: 30px;
		}
		.editor-content {
			min-height: 200px;
			max-height: 400px;
			font-size: 14px;
		}
	}
</style>
