<script>
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { onDestroy, onMount } from 'svelte';
	import { pushToast } from '$lib/stores/adminToast.js';
	import { t } from '$lib/i18n/admin/index.js';
	import RichTextEditor from '$lib/components/RichTextEditor.svelte';
	let { form } = $props();

	const productTypes = $derived([
		{ value: 'Inoxs', label: $t('admin.productsNew.typeInox') },
		{ value: 'CastIrons', label: $t('admin.productsNew.typeCastIron') },
		{ value: 'Electronics', label: $t('admin.productsNew.typeElectronics') }
	]);
	const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
	const GALLERY_MAX_WIDTH = 1920;
	const GALLERY_MAX_HEIGHT = 1920;
	const MAX_IMAGE_WIDTH = 1920;
	const MAX_IMAGE_HEIGHT = 1920;
	const IMAGE_SIZE_LABEL = '5MB';
	const MAX_GALLERY_FILES = 7;
	const computeDiscount = (original, sale) => {
		const originalValue = Number(original);
		const saleValue = Number(sale);
		if (!Number.isFinite(originalValue) || !Number.isFinite(saleValue)) return null;
		if (originalValue <= 0 || saleValue <= 0 || saleValue >= originalValue) return null;
		return Math.round(((originalValue - saleValue) / originalValue) * 100);
	};
	let originalPrice = $state('');
	let salePrice = $state('');
	let ratingAverage = $state('0');
	let ratingCount = $state('0');
	let discountPercent = $state(null);
	let imageError = $state('');
	let galleryError = $state('');
	let thumbPreviewUrl = $state('');
	let thumbDataUrl = $state('');
	let thumbCroppedUrl = $state('');
	let thumbFileName = $state('');
	let thumbCropState = $state(null);
	let galleryItems = $state([]);
	let thumbInput = $state(null);
	let galleryInput = $state(null);
	let isGalleryDragActive = $state(false);
	let galleryPreviewUrls = $derived(
		galleryItems.map((item) => item.croppedUrl || item.previewUrl).filter(Boolean)
	);
	let galleryCropPayload = $derived(
		galleryItems
			.map((item) => {
				if (!item?.croppedUrl) return null;
				return { dataUrl: item.croppedUrl, fileName: item.fileName || '' };
			})
			.filter(Boolean)
	);
	let galleryCropStatesPayload = $derived(
		galleryItems
			.filter((item) => item?.croppedUrl)
			.map((item) => item?.cropState || null)
	);
	let isCropperOpen = $state(false);
	let cropMode = $state('');
	let cropTargetIndex = $state(-1);
	let cropSourceUrl = $state('');
	let cropFileName = $state('');
	let cropFrame = $state(null);
	let cropImageEl = $state(null);
	let cropZoom = $state(1);
	let cropOffsetX = $state(0);
	let cropOffsetY = $state(0);
	let cropBaseScale = $state(1);
	let isDraggingCrop = $state(false);
	let dragStartX = $state(0);
	let dragStartY = $state(0);
	let dragStartOffsetX = $state(0);
	let dragStartOffsetY = $state(0);
	let colorInput = $state('');
	let colorPriceInput = $state('');
	let colors = $state([]);
	let sizeInput = $state('');
	let sizePriceInput = $state('');
	let sizes = $state([]);
	let comboColor = $state('');
	let comboSize = $state('');
	let comboPriceInput = $state('');
	let combos = $state([]);
	let descriptionValue = $state('');
	let uploadSessionId = $state('');
	let isSavingProduct = $state(false);
	const uploadAssetCache = new Map();

	const resolveAdminPath = (path) => {
		if (typeof window === 'undefined' || window.location.hostname !== 'admin.inoxpran.com') {
			return path;
		}
		return path.replace(/^\/admin(?=\/|$)/, '') || '/';
	};

	const cleanupPendingUploads = () => {
		if (!uploadSessionId || isSavingProduct || typeof window === 'undefined') return;
		fetch(resolveAdminPath(`/admin/uploads/pending/${encodeURIComponent(uploadSessionId)}`), {
			method: 'DELETE',
			keepalive: true
		}).catch(() => {});
	};

	const dataUrlToFile = async (dataUrl, fileName) => {
		const blob = await fetch(dataUrl).then((response) => response.blob());
		return new File([blob], fileName || 'cropped-product-image.jpg', {
			type: blob.type || 'image/jpeg'
		});
	};

	const uploadProductImage = async (file, kind) => {
		const payload = new FormData();
		payload.set('image', file);
		payload.set('kind', kind);
		payload.set('upload_session_id', uploadSessionId);
		const response = await fetch(resolveAdminPath('/admin/uploads/product-image'), {
			method: 'POST',
			body: payload
		});
		const result = await response.json().catch(() => null);
		if (!response.ok || !result?.url) {
			throw new Error(result?.error || 'Không thể tải ảnh sản phẩm lên storage.');
		}
		return result;
	};

	const uploadProductImageCached = async (file, kind, cacheKey = file) => {
		if (uploadAssetCache.has(cacheKey)) {
			return await uploadAssetCache.get(cacheKey);
		}
		const uploadPromise = uploadProductImage(file, kind);
		uploadAssetCache.set(cacheKey, uploadPromise);
		try {
			return await uploadPromise;
		} catch (error) {
			uploadAssetCache.delete(cacheKey);
			throw error;
		}
	};

	const mapWithConcurrency = async (items, limit, mapper) => {
		const results = new Array(items.length);
		let nextIndex = 0;
		const worker = async () => {
			while (nextIndex < items.length) {
				const index = nextIndex++;
				results[index] = await mapper(items[index], index);
			}
		};
		await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
		return results;
	};

	const preUploadProductImage = (file, kind, cacheKey = file) => {
		if (!file || !uploadSessionId) return;
		void uploadProductImageCached(file, kind, cacheKey).catch(() => {});
	};

	const preUploadGalleryItems = (items) => {
		if (!items?.length || !uploadSessionId) return;
		void mapWithConcurrency(items, 3, async (item) => {
			if (!item?.file) return null;
			return await uploadProductImageCached(item.file, 'gallery', item);
		}).catch(() => {});
	};

	const preUploadCroppedProductImage = (dataUrl, fileName, kind, cacheKey) => {
		if (!dataUrl || !uploadSessionId) return;
		void dataUrlToFile(dataUrl, fileName)
			.then((file) => uploadProductImageCached(file, kind, cacheKey))
			.catch(() => {});
	};

	const normalizeOption = (value) => String(value || '').trim();
	const normalizePrice = (value) => {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	};

	const addColor = () => {
		const name = normalizeOption(colorInput);
		if (!name) return;
		const price = normalizePrice(colorPriceInput);
		const existingIndex = colors.findIndex(
			(item) => item.name.toLowerCase() === name.toLowerCase()
		);
		if (existingIndex >= 0) {
			colors = colors.map((item, index) =>
				index === existingIndex ? { ...item, price: price ?? item.price } : item
			);
		} else {
			colors = [...colors, { name, price }];
		}
		colorInput = '';
		colorPriceInput = '';
	};

	const removeColor = (name) => {
		colors = colors.filter((item) => item.name !== name);
		combos = combos.filter((item) => item.color !== name);
	};

	const addSize = () => {
		const name = normalizeOption(sizeInput);
		if (!name) return;
		const price = normalizePrice(sizePriceInput);
		const existingIndex = sizes.findIndex(
			(item) => item.name.toLowerCase() === name.toLowerCase()
		);
		if (existingIndex >= 0) {
			sizes = sizes.map((item, index) =>
				index === existingIndex ? { ...item, price: price ?? item.price } : item
			);
		} else {
			sizes = [...sizes, { name, price }];
		}
		sizeInput = '';
		sizePriceInput = '';
	};

	const removeSize = (name) => {
		sizes = sizes.filter((item) => item.name !== name);
		combos = combos.filter((item) => item.size !== name);
	};

	const handleSizeKey = (event) => {
		if (event.key !== 'Enter') return;
		event.preventDefault();
		addSize();
	};

	const handleColorKey = (event) => {
		if (event.key !== 'Enter') return;
		event.preventDefault();
		addColor();
	};

	const addCombo = () => {
		const color = normalizeOption(comboColor);
		const size = normalizeOption(comboSize);
		const price = normalizePrice(comboPriceInput);
		if (!color || !size || price === undefined) return;

		const key = `${color.toLowerCase()}::${size.toLowerCase()}`;
		const existingIndex = combos.findIndex(
			(item) => `${item.color.toLowerCase()}::${item.size.toLowerCase()}` === key
		);
		if (existingIndex >= 0) {
			combos = combos.map((item, index) =>
				index === existingIndex ? { ...item, price } : item
			);
		} else {
			combos = [...combos, { color, size, price }];
		}
		comboPriceInput = '';
	};

	const removeCombo = (target) => {
		combos = combos.filter(
			(item) => !(item.color === target.color && item.size === target.size)
		);
	};

	const updateColorPrice = (name, value) => {
		colors = colors.map((item) =>
			item.name === name ? { ...item, price: value === '' ? undefined : value } : item
		);
	};

	const updateSizePrice = (name, value) => {
		sizes = sizes.map((item) =>
			item.name === name ? { ...item, price: value === '' ? undefined : value } : item
		);
	};

	const buildVariationsPayload = () => {
		const variations = [];
		colors.forEach((item) => {
			if (!item.name) return;
			const price = normalizePrice(item.price);
			const entry = { color: item.name };
			if (price !== undefined) entry.price = price;
			variations.push(entry);
		});
		sizes.forEach((item) => {
			if (!item.name) return;
			const price = normalizePrice(item.price);
			const entry = { size: item.name };
			if (price !== undefined) entry.price = price;
			variations.push(entry);
		});
		combos.forEach((item) => {
			if (!item.color || !item.size) return;
			const price = normalizePrice(item.price);
			const entry = { color: item.color, size: item.size };
			if (price !== undefined) entry.price = price;
			variations.push(entry);
		});
		return JSON.stringify(variations);
	};

	const buildColorListPayload = () => {
		const list = colors.map((item) => item.name).filter(Boolean);
		return JSON.stringify(list);
	};

	const getImageDimensions = (file) =>
		new Promise((resolve, reject) => {
			const url = URL.createObjectURL(file);
			const img = new Image();
			img.onload = () => {
				URL.revokeObjectURL(url);
				resolve({ width: img.width, height: img.height });
			};
			img.onerror = () => {
				URL.revokeObjectURL(url);
				reject(new Error('invalid-image'));
			};
			img.src = url;
		});

	const readFileAsDataUrl = (file) =>
		new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result || ''));
			reader.onerror = () => reject(new Error('invalid-image'));
			reader.readAsDataURL(file);
		});

	const reportFileError = (message, input, setter) => {
		setter(message);
		pushToast({ tone: 'error', message });
		if (input) input.value = '';
	};

	const reportImageError = (message, input) =>
		reportFileError(message, input, (value) => (imageError = value));

	const reportGalleryError = (message, input) =>
		reportFileError(message, input, (value) => (galleryError = value));

	const openFileInput = (input) => {
		if (!input || input.disabled) return;
		input.click();
	};

	const clearGalleryItems = () => {
		galleryItems.forEach((item) => {
			if (item?.previewUrl && String(item.previewUrl).startsWith('blob:')) {
				URL.revokeObjectURL(item.previewUrl);
			}
		});
		galleryItems = [];
	};

	const buildGalleryItems = async (files) => {
		const items = [];
		for (const file of files) {
			const previewUrl = URL.createObjectURL(file);
			let dataUrl = '';
			try {
				dataUrl = await readFileAsDataUrl(file);
			} catch {
				dataUrl = '';
			}
			items.push({
				file,
				previewUrl,
				dataUrl,
				croppedUrl: '',
				cropState: null,
				fileName: file.name || ''
			});
		}
		return items;
	};

	const updateGalleryItems = (items) => {
		clearGalleryItems();
		galleryItems = items;
	};

	const syncGalleryInputFiles = () => {
		if (!galleryInput) return;
		const dt = new DataTransfer();
		galleryItems.forEach((item) => {
			if (item?.file && !item?.croppedUrl) dt.items.add(item.file);
		});
		galleryInput.files = dt.files;
	};

	const validateImageFile = async (
		file,
		maxWidth = MAX_IMAGE_WIDTH,
		maxHeight = MAX_IMAGE_HEIGHT
	) => {
		if (!file) return null;
		if (file.size > MAX_IMAGE_BYTES) {
			return $t('admin.productsNew.imageTooLarge', { size: IMAGE_SIZE_LABEL });
		}
		try {
			const { width, height } = await getImageDimensions(file);
			if (width > maxWidth || height > maxHeight) {
				return $t('admin.productsNew.imageDimensions', {
					width: maxWidth,
					height: maxHeight
				});
			}
		} catch {
			return $t('admin.productsNew.imageInvalid');
		}
		return null;
	};

	const resetCropState = () => {
		cropZoom = 1;
		cropOffsetX = 0;
		cropOffsetY = 0;
		cropBaseScale = 1;
	};

	const openCropper = ({ mode, sourceUrl, fileName, index }) => {
		if (!sourceUrl) return;
		cropMode = mode;
		cropTargetIndex = Number.isFinite(index) ? index : -1;
		cropSourceUrl = sourceUrl;
		cropFileName = fileName || '';
		if (mode === 'thumb') {
			if (thumbCropState) {
				cropZoom = thumbCropState.zoom ?? 1;
				cropOffsetX = thumbCropState.offsetX ?? 0;
				cropOffsetY = thumbCropState.offsetY ?? 0;
			} else {
				resetCropState();
			}
		} else if (mode === 'gallery' && cropTargetIndex >= 0) {
			const state = galleryItems[cropTargetIndex]?.cropState;
			if (state) {
				cropZoom = state.zoom ?? 1;
				cropOffsetX = state.offsetX ?? 0;
				cropOffsetY = state.offsetY ?? 0;
			} else {
				resetCropState();
			}
		} else {
			resetCropState();
		}
		isCropperOpen = true;
	};

	const closeCropper = () => {
		isCropperOpen = false;
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

		const outputWidth =
			cropMode === 'gallery' ? GALLERY_MAX_WIDTH : MAX_IMAGE_WIDTH;
		const outputHeight =
			cropMode === 'gallery' ? GALLERY_MAX_HEIGHT : MAX_IMAGE_HEIGHT;
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
		const croppedDataUrl = canvas.toDataURL('image/jpeg', 0.9);

		if (cropMode === 'thumb') {
			thumbCroppedUrl = croppedDataUrl;
			thumbFileName = cropFileName || thumbFileName;
			thumbCropState = {
				zoom: cropZoom,
				offsetX: cropOffsetX,
				offsetY: cropOffsetY
			};
			preUploadCroppedProductImage(croppedDataUrl, thumbFileName, 'thumb', croppedDataUrl);
		} else if (cropMode === 'gallery' && cropTargetIndex >= 0) {
			let croppedGalleryItem = null;
			galleryItems = galleryItems.map((item, index) =>
				index === cropTargetIndex
					? (croppedGalleryItem = {
							...item,
							croppedUrl: croppedDataUrl,
							cropState: {
								zoom: cropZoom,
								offsetX: cropOffsetX,
								offsetY: cropOffsetY
							}
						})
					: item
			);
			preUploadCroppedProductImage(
				croppedDataUrl,
				croppedGalleryItem?.fileName,
				'gallery',
				croppedGalleryItem
			);
			syncGalleryInputFiles();
		}
		closeCropper();
	};

	const handleCropKeydown = (event) => {
		if (!isCropperOpen) return;
		if (event.key === 'Escape') {
			closeCropper();
		}
	};

	const handleThumbChange = async (event) => {
		const input = event.currentTarget;
		const file = input?.files?.[0];
		imageError = '';
		if (thumbPreviewUrl) {
			URL.revokeObjectURL(thumbPreviewUrl);
		}
		thumbPreviewUrl = '';
		thumbDataUrl = '';
		thumbCroppedUrl = '';
		thumbFileName = '';
		thumbCropState = null;
		if (!file) return;

		const validationMessage = await validateImageFile(file);
		if (validationMessage) {
			reportImageError(validationMessage, input);
			return;
		}
		thumbFileName = file.name || '';
		thumbPreviewUrl = URL.createObjectURL(file);
		try {
			thumbDataUrl = await readFileAsDataUrl(file);
		} catch {
			thumbDataUrl = '';
		}
		preUploadProductImage(file, 'thumb', file);
	};

	const handleGalleryChange = async (event) => {
		const input = event.currentTarget;
		const files = input?.files ? Array.from(input.files) : [];
		galleryError = '';

		if (!files.length) return;

		// Check max gallery files
		if (files.length > MAX_GALLERY_FILES) {
			reportGalleryError($t('admin.productsNew.galleryLimit', { count: MAX_GALLERY_FILES }), input);
			return;
		}

		// Validate each file
		const validFiles = [];
		for (const file of files) {
			const validationMessage = await validateImageFile(
				file,
				GALLERY_MAX_WIDTH,
				GALLERY_MAX_HEIGHT
			);
			if (validationMessage) {
				reportGalleryError(validationMessage, input);
				return;
			}
			validFiles.push(file);
		}

		// All valid, update previews and input
		const items = await buildGalleryItems(validFiles);
		updateGalleryItems(items);
		preUploadGalleryItems(items);
		const dt = new DataTransfer();
		validFiles.forEach((file) => dt.items.add(file));
		galleryInput.files = dt.files;
	};

	const handleGalleryDrop = async (event) => {
		event.preventDefault();
		event.stopPropagation();
		isGalleryDragActive = false;
		const files = event.dataTransfer?.files ? Array.from(event.dataTransfer.files) : [];
		if (!files.length) return;

		// Check max gallery files
		galleryError = '';
		if (files.length > MAX_GALLERY_FILES) {
			reportGalleryError(
				$t('admin.productsNew.galleryLimit', { count: MAX_GALLERY_FILES }),
				galleryInput
			);
			return;
		}

		// Validate each file
		const validFiles = [];
		for (const file of files) {
			const validationMessage = await validateImageFile(
				file,
				GALLERY_MAX_WIDTH,
				GALLERY_MAX_HEIGHT
			);
			if (validationMessage) {
				reportGalleryError(validationMessage, galleryInput);
				return;
			}
			validFiles.push(file);
		}

		// All valid, update previews and input
		const items = await buildGalleryItems(validFiles);
		updateGalleryItems(items);
		preUploadGalleryItems(items);
		const dt = new DataTransfer();
		validFiles.forEach((file) => dt.items.add(file));
		galleryInput.files = dt.files;
	};

	const removeGalleryImage = (index) => {
		// Remove preview URL
		const removedItem = galleryItems[index];
		if (removedItem?.previewUrl && String(removedItem.previewUrl).startsWith('blob:')) {
			URL.revokeObjectURL(removedItem.previewUrl);
		}
		galleryItems = galleryItems.filter((_, i) => i !== index);

		// Update file input with remaining files
		syncGalleryInputFiles();
	};

	const handleGalleryDragEnter = (event) => {
		event.preventDefault();
		isGalleryDragActive = true;
	};

	const handleGalleryDragOver = (event) => {
		event.preventDefault();
		isGalleryDragActive = true;
	};

	const handleGalleryDragLeave = (event) => {
		event.preventDefault();
		isGalleryDragActive = false;
	};

	onDestroy(() => {
		cleanupPendingUploads();
		clearGalleryItems();
		if (thumbPreviewUrl) {
			URL.revokeObjectURL(thumbPreviewUrl);
		}
	});

	onMount(() => {
		uploadSessionId =
			window.crypto?.randomUUID?.() ||
			`product-new-${Date.now()}-${Math.random().toString(16).slice(2)}`;
		if (form?.toast) {
			pushToast(form.toast);
		}
	});

	$effect(() => {
		discountPercent = computeDiscount(originalPrice, salePrice);
	});

	const handleFormSubmit = () => {
		syncGalleryInputFiles();
	};

	const stripProductMediaFields = (formData) => {
		[
			'product_thumb',
			'product_thumb_asset',
			'product_thumb_cropped',
			'product_thumb_name',
			'product_thumb_crop_state',
			'product_gallery',
			'product_gallery_assets',
			'product_gallery_cropped',
			'product_gallery_cropped_names',
			'product_gallery_cropped_states'
		].forEach((field) => formData.delete(field));
	};

	const collectUploadedProductMedia = async () => {
		const thumbFile = thumbCroppedUrl
			? await dataUrlToFile(thumbCroppedUrl, thumbFileName)
			: thumbInput?.files?.[0];
		const uploadTasks = [];
		if (thumbFile) {
			uploadTasks.push({
				type: 'thumb',
				file: thumbFile,
				cacheKey: thumbCroppedUrl || thumbFile
			});
		}
		galleryItems.forEach((item) => uploadTasks.push({ type: 'gallery', item, cacheKey: item }));
		const uploadedAssets = await mapWithConcurrency(uploadTasks, 3, async (task) => {
			if (task.type === 'thumb') {
				return {
					type: 'thumb',
					asset: await uploadProductImageCached(task.file, 'thumb', task.cacheKey)
				};
			}
			const file = task.item?.croppedUrl
				? await dataUrlToFile(task.item.croppedUrl, task.item.fileName)
				: task.item?.file;
			if (!file) return null;
			const asset = await uploadProductImageCached(file, 'gallery', task.cacheKey);
			return {
				type: 'gallery',
				asset: task.item?.cropState ? { ...asset, crop_state: task.item.cropState } : asset
			};
		});
		const thumbAsset = uploadedAssets.find((entry) => entry?.type === 'thumb')?.asset;
		return {
			upload_session_id: uploadSessionId,
			...(thumbAsset
				? {
						product_thumb: thumbAsset.url,
						...(thumbAsset.path ? { product_thumb_path: thumbAsset.path } : {}),
						...(thumbAsset.variants
							? { product_thumb_variants: thumbAsset.variants }
							: {}),
						...(thumbCropState ? { product_thumb_crop_state: thumbCropState } : {})
					}
				: {}),
			product_gallery: uploadedAssets
				.filter((entry) => entry?.type === 'gallery')
				.map((entry) => entry.asset)
		};
	};

	const syncProductMedia = async (productId, mediaPayload) => {
		const response = await fetch(
			resolveAdminPath(`/admin/api/products/${encodeURIComponent(productId)}/media`),
			{
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(mediaPayload)
			}
		);
		const result = await response.json().catch(() => null);
		if (!response.ok) {
			throw new Error(result?.error || 'Không thể đồng bộ ảnh cho bản nháp.');
		}
		return result;
	};

	const handleCreateEnhance = async ({ formData, cancel }) => {
		handleFormSubmit();
		isSavingProduct = true;
		let mediaSyncPromise;
		try {
			mediaSyncPromise = collectUploadedProductMedia();
			void mediaSyncPromise.catch(() => {});
			stripProductMediaFields(formData);
		} catch (error) {
			cancel();
			isSavingProduct = false;
			pushToast({ tone: 'error', message: error?.message || 'Không thể tải ảnh sản phẩm.' });
			return;
		}
		return async ({ result, update }) => {
			try {
				if (result?.type === 'success' && result?.data?.productId) {
					const productId = result.data.productId;
					try {
						await syncProductMedia(productId, await mediaSyncPromise);
						pushToast(result?.data?.toast);
					} catch (error) {
						pushToast({
							tone: 'error',
							message:
								error?.message ||
								'Bản nháp đã được tạo nhưng chưa thể đồng bộ ảnh. Bạn có thể thử lưu lại.'
						});
					}
					await goto(resolveAdminPath(`/admin/products/${productId}`));
					return;
				}
				if (result?.type === 'failure') {
					pushToast(
						result?.data?.toast || {
							tone: 'error',
							message: result?.data?.error || 'Không thể tạo bản nháp sản phẩm.'
						}
					);
				} else if (result?.type === 'error') {
					pushToast({ tone: 'error', message: 'Không thể tạo bản nháp sản phẩm.' });
				}
				await update({ reset: result?.type === 'success' });
			} finally {
				isSavingProduct = false;
			}
		};
	};
</script>

<svelte:head>
	<title>{$t('admin.productsNew.title')} | Admin</title>
</svelte:head>

<section>
	<a class="btn btn-link mb-3" href="/admin/products">{$t('admin.productsNew.back')}</a>
	<h2 class="mb-4">{$t('admin.productsNew.heading')}</h2>

	<form
		method="post"
		enctype="multipart/form-data"
		class="border rounded-3 p-4 bg-white row g-3"
		onsubmit={handleFormSubmit}
		use:enhance={handleCreateEnhance}
	>
		<input type="hidden" name="upload_session_id" value={uploadSessionId} />
		{#if thumbCroppedUrl}
			<input type="hidden" name="product_thumb_cropped" value={thumbCroppedUrl} />
			<input type="hidden" name="product_thumb_name" value={thumbFileName} />
		{/if}
		{#if thumbCropState}
			<input
				type="hidden"
				name="product_thumb_crop_state"
				value={JSON.stringify(thumbCropState)}
			/>
		{/if}
		{#if galleryCropPayload.length}
			<input
				type="hidden"
				name="product_gallery_cropped"
				value={JSON.stringify(galleryCropPayload.map((item) => item.dataUrl))}
			/>
			<input
				type="hidden"
				name="product_gallery_cropped_names"
				value={JSON.stringify(galleryCropPayload.map((item) => item.fileName || ''))}
			/>
			<input
				type="hidden"
				name="product_gallery_cropped_states"
				value={JSON.stringify(galleryCropStatesPayload)}
			/>
		{/if}
		<div class="col-md-6">
			<label class="form-label" for="product-name">{$t('admin.productsNew.name')}</label>
			<input class="form-control" id="product-name" name="product_name" required />
		</div>
		<div class="col-md-6">
			<label class="form-label" for="product-type">{$t('admin.productsNew.type')}</label>
			<select class="form-select" id="product-type" name="product_type" required>
				{#each productTypes as type}
					<option value={type.value}>{type.label}</option>
				{/each}
			</select>
		</div>
		<div class="col-md-3">
			<label class="form-label" for="product-original-price">
				{$t('admin.productsNew.originalPrice')}
			</label>
			<input
				class="form-control"
				id="product-original-price"
				type="number"
				name="product_original_price"
				min="0"
				step="1"
				bind:value={originalPrice}
			/>
		</div>
		<div class="col-md-3">
			<label class="form-label" for="product-sale-price">{$t('admin.productsNew.salePrice')}</label>
			<input
				class="form-control"
				id="product-sale-price"
				type="number"
				name="product_price"
				min="0"
				step="1"
				bind:value={salePrice}
			/>
		</div>
		<div class="col-md-3">
			<label class="form-label" for="product-quantity">{$t('admin.productsNew.quantity')}</label>
			<input
				class="form-control"
				id="product-quantity"
				type="number"
				name="product_quantity"
			/>
		</div>

		<div class="col-md-3">
			<label class="form-label" for="product-weight">{$t('admin.productsNew.weight')}</label>
			<input class="form-control" id="product-weight" type="number" name="product_weight" />
		</div>
		<div class="col-md-3">
			<label class="form-label" for="product-rating-average">
				{$t('admin.productsNew.ratingAverage')}
			</label>
			<input
				class="form-control"
				id="product-rating-average"
				type="number"
				name="product_ratingsAverage"
				min="0"
				max="5"
				step="0.1"
				bind:value={ratingAverage}
				inputmode="decimal"
			/>
		</div>
		<div class="col-md-3">
			<label class="form-label" for="product-rating-count">
				{$t('admin.productsNew.ratingCount')}
			</label>
			<input
				class="form-control"
				id="product-rating-count"
				type="number"
				name="product_ratingsCount"
				min="0"
				step="1"
				bind:value={ratingCount}
				inputmode="numeric"
			/>
		</div>
		<div class="col-12">
			<span class="text-black-50 small">
				{$t('admin.productsNew.discountLabel')}: {discountPercent ? `${discountPercent}%` : '--'}
			</span>
		</div>
		<div class="col-12">
			<span class="text-black-50 small">{$t('admin.productsNew.ratingHelp')}</span>
		</div>
		<div class="col-12">
			<label class="form-label" for="product-description">
				{$t('admin.productsNew.description')}
			</label>
			<RichTextEditor
				value={descriptionValue}
				uploadSessionId={uploadSessionId}
				uploadEntityType="product"
				onChange={(content) => {
					descriptionValue = content;
				}}
				placeholder={$t('admin.productsNew.descriptionPlaceholder')}
			/>
			<input
				type="hidden"
				id="product-description"
				name="product_description"
				value={descriptionValue}
			/>
		</div>
		<div class="col-md-6">
			<div class="upload-field-header">
				<label class="form-label" for="product-thumb">{$t('admin.productsNew.thumb')}</label>
				<button
					type="button"
					class="upload-pick-button"
					onclick={() => openFileInput(thumbInput)}
					aria-controls="product-thumb"
				>
					{$t('admin.productsNew.chooseImage')}
				</button>
			</div>
				<div class="thumb-upload-wrapper">
					<div class="thumb-upload-card">
						<input
							class="upload-file-input"
							id="product-thumb"
							name="product_thumb"
							type="file"
							accept="image/*"
							onchange={handleThumbChange}
							bind:this={thumbInput}
						/>
						<div class="upload-card-copy">
							<strong>{$t('admin.productsNew.thumb')}</strong>
							<span>{$t('admin.productsNew.thumbHint')}</span>
						</div>
					</div>
					{#if imageError}
						<div class="text-danger small mt-2">{imageError}</div>
					{/if}
					{#if thumbPreviewUrl}
						<div class="thumb-preview mt-3">
							<img
								src={thumbCroppedUrl || thumbPreviewUrl}
								alt={$t('admin.productsNew.thumb')}
							/>
							<div class="thumb-actions">
								<button
									type="button"
									class="btn btn-outline-dark btn-sm"
									onclick={() =>
										openCropper({
											mode: 'thumb',
											sourceUrl: thumbDataUrl || thumbPreviewUrl,
											fileName: thumbFileName
										})}
								>
									{$t('admin.blogEditor.cropApply')}
								</button>
								{#if thumbCroppedUrl}
									<button
										type="button"
										class="btn btn-outline-secondary btn-sm"
										onclick={() => (thumbCroppedUrl = '')}
									>
										{$t('common.reset')}
									</button>
								{/if}
							</div>
						</div>
					{/if}
				</div>
			</div>
		<div class="col-12">
			<div class="upload-field-header">
				<label class="form-label" for="product-gallery">{$t('admin.productsNew.gallery')}</label>
				<button
					type="button"
					class="upload-pick-button"
					onclick={() => openFileInput(galleryInput)}
					aria-controls="product-gallery"
					disabled={galleryPreviewUrls.length >= MAX_GALLERY_FILES}
				>
					{$t('admin.productsNew.chooseImages')}
				</button>
			</div>
			<div class="gallery-upload-wrapper">
				<div
					class="gallery-drop-zone"
					class:active={isGalleryDragActive}
				>
					<input
						class="gallery-input"
						id="product-gallery"
						name="product_gallery"
						type="file"
						accept="image/*"
						multiple
						onchange={handleGalleryChange}
						ondragenter={handleGalleryDragEnter}
						ondragover={handleGalleryDragOver}
						ondragleave={handleGalleryDragLeave}
						ondrop={handleGalleryDrop}
						bind:this={galleryInput}
						disabled={galleryPreviewUrls.length >= MAX_GALLERY_FILES}
					/>
					<div class="gallery-drop-text">
						<strong>{$t('admin.productsNew.galleryPrompt')}</strong>
						<span>{$t('admin.productsNew.galleryHint')}</span>
						<span class="gallery-count">({galleryPreviewUrls.length}/{MAX_GALLERY_FILES})</span>
					</div>
				</div>

				{#if galleryError}
					<div class="text-danger small mt-2">{galleryError}</div>
				{/if}

				{#if galleryPreviewUrls.length}
					<div class="gallery-thumbs-wrapper mt-3">
						<div class="gallery-thumbs-header">
							<h6>
								{$t('admin.productsNew.gallery')} ({galleryPreviewUrls.length}/{MAX_GALLERY_FILES})
							</h6>
						</div>
						<div class="gallery-thumbs">
							{#each galleryItems as item, index}
								<div class="gallery-thumb-item">
									<img
										src={item.croppedUrl || item.previewUrl}
										alt={`${$t('admin.productsNew.gallery')} ${index + 1}`}
									/>
									<button
										class="gallery-crop-btn"
										type="button"
										onclick={() =>
											openCropper({
												mode: 'gallery',
												sourceUrl: item.dataUrl || item.previewUrl,
												fileName: item.fileName,
												index
											})}
									>
										{$t('admin.blogEditor.cropApply')}
									</button>
									<button
										class="gallery-remove-btn"
										type="button"
										onclick={() => removeGalleryImage(index)}
										title={$t('admin.productsNew.removeImage') || 'Remove'}
									>
										<svg
											width="16"
											height="16"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2"
										>
											<line x1="18" y1="6" x2="6" y2="18"></line>
											<line x1="6" y1="6" x2="18" y2="18"></line>
										</svg>
									</button>
									<div class="gallery-thumb-number">{index + 1}</div>
									{#if item.croppedUrl}
										<span class="gallery-thumb-badge">Cropped</span>
									{/if}
								</div>
							{/each}
						</div>
					</div>
				{/if}
			</div>
		</div>
		<div class="col-12">
			<div class="form-label">{$t('admin.productsNew.attributes')}</div>
			<div class="row g-2">
				<div class="col-md-4">
					<input
						class="form-control"
						id="product-attribute-manufacturer"
						name="product_attribute_manufacturer"
						placeholder={$t('admin.productsNew.manufacturer')}
					/>
				</div>
				<div class="col-md-4">
					<input
						class="form-control"
						id="product-attribute-model"
						name="product_attribute_model"
						placeholder={$t('admin.productsNew.model')}
					/>
				</div>
				<div class="col-md-4">
					<input
						class="form-control"
						id="product-attribute-color"
						name="product_attribute_color"
						placeholder={$t('admin.productsNew.color')}
					/>
				</div>
			</div>
		</div>
		<div class="col-12">
			<div class="form-label">{$t('admin.productsNew.variantsTitle')}</div>
			<div class="variant-grid">
				<div class="variant-card">
					<h6>{$t('admin.productsNew.colors')}</h6>
					<div class="variant-row">
						<input
							class="form-control"
							placeholder={$t('admin.productsNew.colorNamePlaceholder')}
							bind:value={colorInput}
							onkeydown={handleColorKey}
						/>
						<input
							class="form-control"
							type="number"
							min="0"
							step="1"
							placeholder={$t('admin.productsNew.priceOverride')}
							bind:value={colorPriceInput}
						/>
						<button class="btn btn-outline-dark" type="button" onclick={addColor}>
							{$t('admin.productsNew.addColor')}
						</button>
					</div>
					{#if colors.length}
						<div class="variant-list">
							{#each colors as item}
								<div class="variant-pill">
									<span>{item.name}</span>
									<input
										class="form-control form-control-sm"
										type="number"
										min="0"
										step="1"
										placeholder={$t('admin.productsNew.priceOverride')}
										value={item.price ?? ''}
										oninput={(event) => updateColorPrice(item.name, event.currentTarget.value)}
									/>
									<button
										class="btn btn-link text-danger p-0"
										type="button"
										onclick={() => removeColor(item.name)}
									>
										x
									</button>
								</div>
							{/each}
						</div>
					{:else}
						<div class="text-black-50 small mt-1">{$t('admin.productsNew.colorsEmpty')}</div>
					{/if}
				</div>

				<div class="variant-card">
					<h6>{$t('admin.productsNew.sizes')}</h6>
					<div class="variant-row">
						<input
							class="form-control"
							placeholder={$t('admin.productsNew.sizePlaceholder')}
							bind:value={sizeInput}
							onkeydown={handleSizeKey}
						/>
						<input
							class="form-control"
							type="number"
							min="0"
							step="1"
							placeholder={$t('admin.productsNew.priceOverride')}
							bind:value={sizePriceInput}
						/>
						<button class="btn btn-outline-dark" type="button" onclick={addSize}>
							{$t('admin.productsNew.addSize')}
						</button>
					</div>
					{#if sizes.length}
						<div class="variant-list">
							{#each sizes as item}
								<div class="variant-pill">
									<span>{item.name}</span>
									<input
										class="form-control form-control-sm"
										type="number"
										min="0"
										step="1"
										placeholder={$t('admin.productsNew.priceOverride')}
										value={item.price ?? ''}
										oninput={(event) => updateSizePrice(item.name, event.currentTarget.value)}
									/>
									<button
										class="btn btn-link text-danger p-0"
										type="button"
										onclick={() => removeSize(item.name)}
									>
										x
									</button>
								</div>
							{/each}
						</div>
					{:else}
						<div class="text-black-50 small mt-1">{$t('admin.productsNew.sizeEmpty')}</div>
					{/if}
				</div>
			</div>

			<div class="variant-card mt-3">
				<h6>{$t('admin.productsNew.comboTitle')}</h6>
				<p class="text-black-50 small mb-2">{$t('admin.productsNew.comboHint')}</p>
				<div class="variant-row">
					<select class="form-select" bind:value={comboColor}>
						<option value="">{$t('admin.productsNew.selectColor')}</option>
						{#each colors as item}
							<option value={item.name}>{item.name}</option>
						{/each}
					</select>
					<select class="form-select" bind:value={comboSize}>
						<option value="">{$t('admin.productsNew.selectSize')}</option>
						{#each sizes as item}
							<option value={item.name}>{item.name}</option>
						{/each}
					</select>
					<input
						class="form-control"
						type="number"
						min="0"
						step="1"
						placeholder={$t('admin.productsNew.priceOverride')}
						bind:value={comboPriceInput}
					/>
					<button class="btn btn-outline-dark" type="button" onclick={addCombo}>
						{$t('admin.productsNew.addCombo')}
					</button>
				</div>
				{#if combos.length}
					<div class="variant-list">
						{#each combos as item}
								<div class="variant-pill">
									<span>{item.color} / {item.size}</span>
									<span class="text-black-50 small">
									{item.price !== undefined && item.price !== null ? `${item.price}` : '--'}
									</span>
								<button
									class="btn btn-link text-danger p-0"
									type="button"
									onclick={() => removeCombo(item)}
								>
									x
								</button>
							</div>
						{/each}
					</div>
				{:else}
					<div class="text-black-50 small mt-1">{$t('admin.productsNew.comboEmpty')}</div>
				{/if}
			</div>

			<input type="hidden" name="product_variations_present" value="1" />
			<input type="hidden" name="product_variations" value={buildVariationsPayload()} />
			<input type="hidden" name="product_attribute_colors" value={buildColorListPayload()} />
		</div>
		<div class="col-12">
			<button class="btn btn-dark" type="submit" disabled={isSavingProduct}>
				{isSavingProduct ? 'Đang tạo bản nháp...' : $t('admin.productsNew.create')}
			</button>
		</div>
		{#if isSavingProduct}
			<div class="product-saving-overlay" role="status" aria-live="polite">
				<div class="product-saving-spinner"></div>
				<strong>Đang tối ưu ảnh và tạo bản nháp...</strong>
				<span>Vui lòng giữ nguyên trang cho đến khi hoàn tất.</span>
			</div>
		{/if}
	</form>

	{#if isCropperOpen}
		<div
			class="cropper-modal"
			role="dialog"
			aria-modal="true"
			tabindex="0"
			onclick={(event) => {
				if (event.target !== event.currentTarget) return;
				closeCropper();
			}}
			onkeydown={handleCropKeydown}
		>
			<div class="cropper-dialog">
				<div class="cropper-header">
					<h5 class="mb-0">{$t('admin.blogEditor.cropApply')}</h5>
					<button
						class="cropper-close"
						type="button"
						onclick={closeCropper}
						aria-label={$t('admin.blogEditor.closeLabel')}
					>
						×
					</button>
				</div>
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
						src={cropSourceUrl}
						alt={$t('admin.blogEditor.cropPreviewAlt')}
						class="cropper-image"
						onload={updateCropBaseScale}
						draggable="false"
						style={`transform: translate(-50%, -50%) translate(${cropOffsetX}px, ${cropOffsetY}px) scale(${cropBaseScale * cropZoom});`}
					/>
				</div>
				<div class="cropper-controls">
					<div class="cropper-zoom">
						<label for="product-crop-zoom">{$t('admin.blogEditor.cropZoom')}</label>
						<input
							id="product-crop-zoom"
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
								resetCropState();
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
		</div>
	{/if}
</section>

<style>
	.upload-field-header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 8px;
	}

	.upload-field-header .form-label {
		margin-bottom: 0;
	}

	.thumb-upload-wrapper {
		position: relative;
	}

	.thumb-upload-card {
		position: relative;
		border: 2px dashed rgba(0, 0, 0, 0.15);
		border-radius: 12px;
		padding: 22px;
		min-height: 140px;
		display: grid;
		place-items: center;
		background: #fafafa;
		text-align: center;
		cursor: pointer;
		transition:
			border-color 0.2s ease,
			background 0.2s ease;
	}

	.thumb-upload-card:hover {
		border-color: #1f1a14;
		background: #fff;
	}

	.upload-file-input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0;
		cursor: pointer;
	}

	.upload-card-copy {
		pointer-events: none;
		display: grid;
		justify-items: center;
		gap: 8px;
		font-size: 0.95rem;
		color: #3a3a3a;
	}

	.upload-card-copy strong {
		font-weight: 600;
	}

	.upload-pick-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: fit-content;
		flex-shrink: 0;
		min-height: 34px;
		border: 0;
		border-radius: 8px;
		padding: 7px 12px;
		background: #1f1a14;
		color: #fff;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		transition:
			background 0.2s ease,
			box-shadow 0.2s ease,
			transform 0.2s ease;
	}

	.upload-pick-button:hover:not(:disabled) {
		background: #0f766e;
		box-shadow: 0 8px 16px rgba(15, 118, 110, 0.18);
		transform: translateY(-1px);
	}

	.upload-pick-button:disabled {
		cursor: not-allowed;
		opacity: 0.55;
		box-shadow: none;
		transform: none;
	}

	.gallery-upload-wrapper {
		display: grid;
		gap: 16px;
	}

	.upload-progress-container {
		display: grid;
		gap: 8px;
	}

	.progress {
		background-color: #e9ecef;
		border-radius: 10px;
		overflow: hidden;
		box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.05);
	}

	.progress-bar {
		width: 100%;
		height: 5px;
		background-color: #e0e0e0;
		position: relative;
		margin-top: 5px;
	}

	.progress-bar-fill {
		height: 100%;
		background-color: #4caf50;
		transition: width 0.2s ease-in-out;
	}

	.progress-text {
		font-size: 0.75rem;
		font-weight: 600;
		color: #6c757d;
		display: flex;
		align-items: center;
		justify-content: flex-end;
	}

	.gallery-drop-zone {
		position: relative;
		border: 2px dashed rgba(0, 0, 0, 0.15);
		border-radius: 12px;
		padding: 26px;
		display: flex;
		align-items: center;
		justify-content: center;
		text-align: center;
		background: #fafafa;
		cursor: pointer;
		transition:
			border-color 0.2s ease,
			background 0.2s ease,
			transform 0.2s ease;
		min-height: 140px;
	}

	.gallery-drop-zone.active {
		border-color: #1f1a14;
		background: #fff;
		border-style: solid;
		transform: scale(1.01);
	}

	.gallery-drop-zone.uploading {
		pointer-events: none;
		opacity: 0.7;
	}

	.gallery-drop-zone .gallery-input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0;
		cursor: pointer;
	}

	.gallery-drop-zone .gallery-input:disabled {
		cursor: not-allowed;
	}

	.gallery-drop-text {
		pointer-events: none;
		font-size: 0.95rem;
		color: #3a3a3a;
		display: grid;
		justify-items: center;
		gap: 6px;
	}

	.gallery-drop-text strong {
		display: block;
		font-weight: 600;
		margin-bottom: 2px;
	}

	.gallery-count {
		font-size: 0.85rem;
		color: #6c757d;
		font-weight: 500;
	}

	.gallery-thumbs-wrapper {
		display: grid;
		gap: 12px;
	}

	.gallery-thumbs-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 4px;
	}

	.gallery-thumbs-header h6 {
		margin: 0;
		font-size: 0.95rem;
		font-weight: 600;
		color: #3a3a3a;
	}

	.gallery-thumbs {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
		gap: 12px;
	}

	.gallery-thumb-item {
		position: relative;
		border-radius: 12px;
		overflow: hidden;
		border: 1px solid rgba(0, 0, 0, 0.08);
		background: #fff;
		aspect-ratio: 1 / 1;
		transition: all 0.2s ease;
	}

	.gallery-thumb-item:hover {
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
		border-color: rgba(0, 0, 0, 0.15);
	}

	.gallery-thumb-item img {
		width: 100%;
		height: 100%;
		object-fit: contain;
		display: block;
	}

	.gallery-remove-btn {
		position: absolute;
		top: 6px;
		right: 6px;
		background: rgba(220, 53, 69, 0.9);
		color: white;
		border: none;
		border-radius: 6px;
		width: 28px;
		height: 28px;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		opacity: 0;
		transition:
			opacity 0.2s ease,
			background 0.2s ease;
		backdrop-filter: blur(4px);
	}

	.gallery-thumb-item:hover .gallery-remove-btn {
		opacity: 1;
	}

	.gallery-remove-btn:hover {
		background: rgba(220, 53, 69, 1);
		transform: scale(1.1);
	}

	.gallery-remove-btn svg {
		stroke-width: 2.5;
	}

	.gallery-thumb-number {
		position: absolute;
		bottom: 6px;
		left: 6px;
		background: rgba(0, 0, 0, 0.6);
		color: white;
		width: 24px;
		height: 24px;
		border-radius: 4px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.75rem;
		font-weight: 600;
		backdrop-filter: blur(4px);
	}

	.gallery-crop-btn {
		position: absolute;
		top: 6px;
		left: 6px;
		background: rgba(31, 26, 20, 0.85);
		color: #fff;
		border: none;
		border-radius: 6px;
		padding: 4px 8px;
		font-size: 0.7rem;
		cursor: pointer;
		opacity: 0;
		transition: opacity 0.2s ease;
	}

	.gallery-thumb-item:hover .gallery-crop-btn {
		opacity: 1;
	}

	.gallery-thumb-badge {
		position: absolute;
		right: 6px;
		bottom: 6px;
		background: rgba(25, 135, 84, 0.9);
		color: #fff;
		border-radius: 999px;
		padding: 2px 8px;
		font-size: 0.65rem;
		font-weight: 600;
	}

	.thumb-preview {
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 12px;
		padding: 12px;
		display: grid;
		gap: 12px;
		background: #fafafa;
	}

	.thumb-preview img {
		width: 100%;
		max-width: 320px;
		aspect-ratio: 1 / 1;
		object-fit: contain;
		background: #fff;
		border-radius: 10px;
		border: 1px solid rgba(0, 0, 0, 0.08);
	}

	.thumb-actions {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}

	.cropper-modal {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 24px;
		z-index: 2000;
	}

	.cropper-dialog {
		width: min(560px, 92vw);
		background: #fff;
		border-radius: 16px;
		padding: 16px;
		display: grid;
		gap: 12px;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
	}

	.cropper-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.cropper-close {
		border: none;
		background: transparent;
		font-size: 24px;
		line-height: 1;
		cursor: pointer;
	}

	.cropper-frame {
		position: relative;
		width: 100%;
		aspect-ratio: 1 / 1;
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

	@media (max-width: 576px) {
		.gallery-drop-zone {
			padding: 16px;
			min-height: 100px;
		}

		.gallery-thumbs {
			grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
		}
	}

	.variant-grid {
		display: grid;
		gap: 16px;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
	}

	.variant-card {
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 12px;
		padding: 16px;
		background: #fafafa;
		display: grid;
		gap: 12px;
	}

	.variant-card h6 {
		margin: 0;
		font-weight: 600;
	}

	.variant-row {
		display: grid;
		gap: 8px;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		align-items: center;
	}

	.variant-list {
		display: grid;
		gap: 8px;
	}

	.variant-pill {
		display: flex;
		align-items: center;
		gap: 8px;
		background: #fff;
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 999px;
		padding: 6px 12px;
	}

	.variant-pill input {
		max-width: 120px;
	}

	.product-saving-overlay {
		position: fixed;
		inset: 0;
		z-index: 1200;
		display: grid;
		place-content: center;
		justify-items: center;
		gap: 10px;
		padding: 24px;
		text-align: center;
		background: rgba(255, 255, 255, 0.9);
		color: #1f2937;
	}

	.product-saving-overlay span {
		color: #6b7280;
	}

	.product-saving-spinner {
		width: 42px;
		height: 42px;
		border: 4px solid #d1d5db;
		border-top-color: #0f8578;
		border-radius: 50%;
		animation: product-saving-spin 0.8s linear infinite;
	}

	@keyframes product-saving-spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>

