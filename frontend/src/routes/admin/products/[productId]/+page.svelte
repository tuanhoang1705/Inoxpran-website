<script>
	import { browser } from '$app/environment';
	import { onDestroy } from 'svelte';
	import { pushToast } from '$lib/stores/adminToast.js';
	import { locale, t } from '$lib/i18n/admin/index.js';
	import RichTextEditor from '$lib/components/RichTextEditor.svelte';

	let { data, form } = $props();
	let lastToastKey = '';

	const productTypes = $derived([
		{ value: 'Inoxs', label: $t('admin.productsNew.typeInox') },
		{ value: 'CastIrons', label: $t('admin.productsNew.typeCastIron') },
		{ value: 'Electronics', label: $t('admin.productsNew.typeElectronics') }
	]);
	const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
	const MAX_IMAGE_WIDTH = 1920;
	const MAX_IMAGE_HEIGHT = 1920;
	const GALLERY_MAX_WIDTH = 1920;
	const GALLERY_MAX_HEIGHT = 1920;
	const IMAGE_SIZE_LABEL = '5MB';
	const MAX_GALLERY_FILES = 7;
	const product = $derived(form?.product ?? data?.product);
	const loadError = $derived(data?.apiError);
	const isPublished = $derived(Boolean(product?.isPublished));
	const isDraft = $derived(Boolean(product?.isDraft));
	const inventoryStock = $derived.by(() => {
		const value = Number(product?.inventory_stock ?? product?.product_quantity ?? 0);
		return Number.isFinite(value) ? value : 0;
	});

	const formatPrice = (value) => {
		const numeric = Number(value);
		if (Number.isNaN(numeric)) return '--';
		const localeValue = $locale === 'en' ? 'en-US' : 'vi-VN';
		return new Intl.NumberFormat(localeValue).format(numeric);
	};

	const formatDate = (value) => {
		if (!value) return '--';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '--';
		const localeValue = $locale === 'en' ? 'en-US' : 'vi-VN';
		return date.toLocaleString(localeValue);
	};

	const thumbUrl = $derived(product?.product_thumb || '');
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
	let thumbProgress = $state(0);
	let isThumbUploading = $state(false);
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
	let variantsInitialized = $state(false);
	let descriptionValue = $state('');
	let lastProductId = $state('');
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
	let galleryInitialized = $state(false);
	let hadExistingGallery = $state(false);
	let isGalleryUploading = $state(false);
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
	const previewThumbUrl = $derived(thumbCroppedUrl || thumbPreviewUrl || thumbUrl);
	let galleryExistingPayload = $derived(
		galleryItems
			.filter((item) => item?.isExisting && item?.url && !item?.croppedUrl)
			.map((item) => {
				const payload = { url: item.url };
				if (item.path) payload.path = item.path;
				if (item.cropState) payload.crop_state = item.cropState;
				return payload;
			})
	);
	let galleryCropPayload = $derived(
		galleryItems
			.map((item) => {
				const dataUrl =
					item?.croppedUrl || (!item?.isExisting && !item?.file ? item?.dataUrl : '');
				if (!dataUrl) return null;
				return { dataUrl, fileName: item?.fileName || '' };
			})
			.filter(Boolean)
	);
	let galleryCropStatesPayload = $derived(
		galleryItems
			.filter((item) => item?.croppedUrl)
			.map((item) => item?.cropState || null)
	);

	const confirmDelete = (event) => {
		if (!confirm($t('admin.productEditor.confirmDelete'))) {
			event.preventDefault();
		}
	};

	const guardPublish = (event) => {
		if (isPublished && !isDraft) {
			event.preventDefault();
		}
	};

	const guardUnpublish = (event) => {
		if (isDraft && !isPublished) {
			event.preventDefault();
		}
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

	const deriveFileName = (value) => {
		if (!value) return '';
		let raw = String(value);
		try {
			const parsed = new URL(raw);
			raw = parsed.pathname || raw;
		} catch {
			raw = String(value);
		}
		const clean = raw.split('?')[0] || raw;
		const parts = clean.split('/');
		const last = parts[parts.length - 1] || '';
		const decoded = decodeURIComponent(last);
		const nameParts = decoded.split('/');
		return nameParts[nameParts.length - 1] || decoded;
	};

	const buildExistingGalleryItems = (gallery = []) =>
		(gallery || [])
			.map((entry) => {
				if (typeof entry === 'string') {
					const url = entry.trim();
					if (!url) return null;
					return {
						isExisting: true,
						url,
						path: '',
						previewUrl: url,
						dataUrl: '',
						croppedUrl: '',
						cropState: null,
						fileName: deriveFileName(url)
					};
				}
				if (entry && typeof entry === 'object') {
					const url = typeof entry.url === 'string' ? entry.url.trim() : '';
					if (!url) return null;
					const path = typeof entry.path === 'string' ? entry.path.trim() : '';
					return {
						isExisting: true,
						url,
						path,
						previewUrl: url,
						dataUrl: '',
						croppedUrl: '',
						cropState: entry?.crop_state || entry?.cropState || null,
						fileName: deriveFileName(path || url)
					};
				}
				return null;
			})
			.filter(Boolean);

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
				isExisting: false,
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

	const appendGalleryItems = (items) => {
		if (!items?.length) return;
		galleryItems = [...galleryItems, ...items];
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
			return $t('admin.productEditor.imageTooLarge', { size: IMAGE_SIZE_LABEL });
		}
		try {
			const { width, height } = await getImageDimensions(file);
			if (width > maxWidth || height > maxHeight) {
				return $t('admin.productEditor.imageDimensions', {
					width: maxWidth,
					height: maxHeight
				});
			}
		} catch {
			return $t('admin.productEditor.imageInvalid');
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
		} else if (cropMode === 'gallery' && cropTargetIndex >= 0) {
			galleryItems = galleryItems.map((item, index) =>
				index === cropTargetIndex
					? {
							...item,
							croppedUrl: croppedDataUrl,
							cropState: {
								zoom: cropZoom,
								offsetX: cropOffsetX,
								offsetY: cropOffsetY
							}
						}
					: item
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

		const validationMessage = await validateImageFile(file, MAX_IMAGE_WIDTH, MAX_IMAGE_HEIGHT);
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
	};

	const handleGalleryChange = async (event) => {
		const input = event.currentTarget;
		const files = input?.files ? Array.from(input.files) : [];
		galleryError = '';

		if (!files.length) return;

		const remainingSlots = MAX_GALLERY_FILES - galleryItems.length;
		if (remainingSlots <= 0) {
			reportGalleryError(
				$t('admin.productEditor.galleryLimit', { count: MAX_GALLERY_FILES }),
				input
			);
			return;
		}

		// Check max gallery files
		if (files.length > remainingSlots) {
			reportGalleryError(
				$t('admin.productEditor.galleryLimit', { count: MAX_GALLERY_FILES }),
				input
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
				reportGalleryError(validationMessage, input);
				return;
			}
			validFiles.push(file);
		}

		// All valid, update previews and input
		const items = await buildGalleryItems(validFiles);
		appendGalleryItems(items);
		syncGalleryInputFiles();
	};

	const handleGalleryDrop = async (event) => {
		event.preventDefault();
		event.stopPropagation();
		isGalleryDragActive = false;
		const files = event.dataTransfer?.files ? Array.from(event.dataTransfer.files) : [];
		if (!files.length) return;

		// Check max gallery files
		galleryError = '';
		const remainingSlots = MAX_GALLERY_FILES - galleryItems.length;
		if (remainingSlots <= 0) {
			reportGalleryError(
				$t('admin.productEditor.galleryLimit', { count: MAX_GALLERY_FILES }),
				galleryInput
			);
			return;
		}
		if (files.length > remainingSlots) {
			reportGalleryError(
				$t('admin.productEditor.galleryLimit', { count: MAX_GALLERY_FILES }),
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
		appendGalleryItems(items);
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

	onDestroy(() => {
		clearGalleryItems();
		if (thumbPreviewUrl) {
			URL.revokeObjectURL(thumbPreviewUrl);
		}
	});

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

	$effect(() => {
		if (product) {
			originalPrice = product.product_original_price ?? '';
			salePrice = product.product_price ?? '';
			ratingAverage = product.product_ratingsAverage ?? 0;
			ratingCount = product.product_ratingsCount ?? 0;
		}
	});

	const parseVariations = (productValue) => {
		const variations = Array.isArray(productValue?.product_variations)
			? productValue.product_variations
			: [];
		const colorMap = new Map();
		const sizeMap = new Map();
		const comboMap = new Map();

		const addColor = (name, price) => {
			if (!name) return;
			if (!colorMap.has(name)) {
				colorMap.set(name, { name, price });
			} else if (price !== undefined) {
				colorMap.set(name, { name, price });
			}
		};

		const addSize = (name, price) => {
			if (!name) return;
			if (!sizeMap.has(name)) {
				sizeMap.set(name, { name, price });
			} else if (price !== undefined) {
				sizeMap.set(name, { name, price });
			}
		};

		const addCombo = (color, size, price) => {
			if (!color || !size) return;
			const key = `${color.toLowerCase()}::${size.toLowerCase()}`;
			comboMap.set(key, { color, size, price });
		};

		variations.forEach((item) => {
			if (typeof item === 'string' || typeof item === 'number') {
				addSize(String(item).trim(), undefined);
				return;
			}
			if (!item || typeof item !== 'object') return;
			const color = normalizeOption(item.color || item.colour);
			const size =
				normalizeOption(item.size ?? item.label ?? item.name ?? item.sku ?? item.value) || '';
			const price = normalizePrice(item.price);

			if (color && size) {
				addCombo(color, size, price);
			} else if (color) {
				addColor(color, price);
			} else if (size) {
				addSize(size, price);
			}
		});

		const attrColors = productValue?.product_attributes?.colors;
		if (Array.isArray(attrColors)) {
			attrColors
				.map((value) => normalizeOption(value))
				.filter(Boolean)
				.forEach((name) => addColor(name, undefined));
		}
		const primaryColor = normalizeOption(productValue?.product_attributes?.color);
		if (primaryColor) addColor(primaryColor, undefined);

		return {
			colors: Array.from(colorMap.values()),
			sizes: Array.from(sizeMap.values()),
			combos: Array.from(comboMap.values())
		};
	};

	$effect(() => {
		if (!product || variantsInitialized) return;
		const parsed = parseVariations(product);
		colors = parsed.colors;
		sizes = parsed.sizes;
		combos = parsed.combos;
		variantsInitialized = true;
	});

	$effect(() => {
		if (!product?._id) return;
		if (product._id !== lastProductId) {
			descriptionValue = product.product_description ?? '';
			lastProductId = product._id;
			variantsInitialized = false;
			thumbCropState = product?.product_thumb_crop_state || null;
			galleryInitialized = false;
		}
	});

	$effect(() => {
		if (!product?._id || galleryInitialized) return;
		const existingItems = buildExistingGalleryItems(product.product_gallery);
		clearGalleryItems();
		galleryItems = existingItems;
		hadExistingGallery = existingItems.length > 0;
		galleryInitialized = true;
	});

	$effect(() => {
		discountPercent = computeDiscount(originalPrice, salePrice);
	});

	$effect(() => {
		if (!browser) return;
		const toast = form?.toast;
		if (!toast?.message) return;
		const key = toast.id || `${toast.tone || 'info'}:${toast.message}`;
		if (key === lastToastKey) return;
		lastToastKey = key;
		pushToast(toast);
	});

	const handleFormSubmit = () => {
		// Ensure gallery files are still in the input before submit
		syncGalleryInputFiles();
	};
</script>

<svelte:head>
	<title>{$t('admin.productEditor.title')} | Admin - Inoxpran</title>
</svelte:head>

<section class="admin-product-page" data-product-id={product?._id}>
	<header class="product-header">
		<div class="header-content">
			<div class="header-left">
				<a class="back-link" href="/admin/products">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M19 12H5M12 19l-7-7 7-7"/>
					</svg>
					<span>{$t('admin.productEditor.back')}</span>
				</a>
				<div class="header-title">
					<h1>{$t('admin.productEditor.title')}</h1>
					<p class="header-meta">{product?.product_name || '--'}</p>
				</div>
			</div>
			<div class="header-right">
				<div class="status-badge" class:published={isPublished} class:draft={isDraft}>
					<span class="status-dot"></span>
					{isPublished ? $t('admin.products.published') : $t('admin.products.draft')}
				</div>
			</div>
		</div>
	</header>

	{#if loadError}
		<div class="alert alert-danger">{loadError}</div>
	{/if}

	{#if product}
		<div class="editor-grid">
			<form
				method="post"
				enctype="multipart/form-data"
				action="?/update"
				class="editor-card"
				onsubmit={handleFormSubmit}
			>
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
				{#if hadExistingGallery || galleryExistingPayload.length}
					<input
						type="hidden"
						name="product_gallery"
						value={JSON.stringify(galleryExistingPayload)}
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
				<section class="form-section">
					<div class="section-header">
						<h3>{$t('admin.productEditor.sectionBasics')}</h3>
						<p>{$t('admin.productEditor.sectionBasicsDesc')}</p>
					</div>
					<div class="field-grid">
						<div>
							<label class="field-label" for="edit-product-name">
								{$t('admin.productEditor.productName')}
							</label>
							<input
								class="field-input"
								id="edit-product-name"
								name="product_name"
								placeholder={$t('admin.productEditor.productNamePlaceholder')}
								value={product.product_name}
							/>
						</div>
						<div>
							<label class="field-label" for="edit-product-type">
								{$t('admin.productEditor.productType')}
							</label>
							<select class="field-input" id="edit-product-type" name="product_type" required>
								{#each productTypes as type}
									<option value={type.value} selected={type.value === product.product_type}>
										{type.label}
									</option>
								{/each}
							</select>
						</div>
					</div>
				</section>

				<section class="form-section">
					<div class="section-header">
						<h3>{$t('admin.productEditor.sectionPricing')}</h3>
						<p>{$t('admin.productEditor.sectionPricingDesc')}</p>
					</div>
					<div class="field-grid">
						<div>
							<label class="field-label" for="edit-product-original-price">
								{$t('admin.productEditor.originalPrice')}
							</label>
							<input
								class="field-input"
								id="edit-product-original-price"
								type="number"
								name="product_original_price"
								min="0"
								step="1"
								bind:value={originalPrice}
								inputmode="numeric"
							/>
						</div>
						<div>
							<label class="field-label" for="edit-product-sale-price">
								{$t('admin.productEditor.salePrice')}
							</label>
							<input
								class="field-input"
								id="edit-product-sale-price"
								type="number"
								name="product_price"
								min="0"
								step="1"
								bind:value={salePrice}
								inputmode="numeric"
							/>
						</div>
						<div>
							<label class="field-label" for="edit-product-quantity">
								{$t('admin.productEditor.quantity')}
							</label>
							<input
								class="field-input"
								id="edit-product-quantity"
								type="number"
								name="product_quantity"
								min="0"
								step="1"
								value={inventoryStock}
								inputmode="numeric"
							/>
						</div>
						<div>
							<label class="field-label" for="edit-product-weight">
								{$t('admin.productEditor.weight')}
							</label>
							<input
								class="field-input"
								id="edit-product-weight"
								type="number"
								name="product_weight"
								min="0"
								step="1"
								value={product.product_weight}
								inputmode="numeric"
							/>
							<span class="field-help">{$t('admin.productEditor.weightHelp')}</span>
						</div>
						<div>
							<label class="field-label" for="edit-product-rating-average">
								{$t('admin.productEditor.ratingAverage')}
							</label>
							<input
								class="field-input"
								id="edit-product-rating-average"
								type="number"
								name="product_ratingsAverage"
								min="0"
								max="5"
								step="0.1"
								bind:value={ratingAverage}
								inputmode="decimal"
							/>
						</div>
						<div>
							<label class="field-label" for="edit-product-rating-count">
								{$t('admin.productEditor.ratingCount')}
							</label>
							<input
								class="field-input"
								id="edit-product-rating-count"
								type="number"
								name="product_ratingsCount"
								min="0"
								step="1"
								bind:value={ratingCount}
								inputmode="numeric"
							/>
						</div>
					</div>
					<span class="field-help">
						{$t('admin.productEditor.discountLabel')}: {discountPercent
							? `${discountPercent}%`
							: '--'}
					</span>
					<span class="field-help">{$t('admin.productEditor.ratingHelp')}</span>
				</section>

				<section class="form-section">
					<div class="section-header">
						<h3>{$t('admin.productEditor.sectionImages')}</h3>
						<p>{$t('admin.productEditor.sectionImagesDesc')}</p>
					</div>
					<div class="media-grid">
						<div class="media-preview">
							{#if previewThumbUrl}
								<img src={previewThumbUrl} alt={product.product_name} />
							{:else}
								<div class="media-placeholder">{$t('admin.productEditor.noImage')}</div>
							{/if}
						</div>
						<div class="field-grid">
							<div>
								<div class="upload-field-header">
									<label class="field-label" for="edit-product-thumb">
										{$t('admin.productEditor.uploadLabel')}
									</label>
									<button
										type="button"
										class="upload-pick-button"
										onclick={() => openFileInput(thumbInput)}
										aria-controls="edit-product-thumb"
										disabled={isThumbUploading}
									>
										{$t('admin.productEditor.chooseImage')}
									</button>
								</div>
								<div class="thumb-upload-wrapper">
									<div class="thumb-upload-card">
										<input
											class="upload-file-input"
											id="edit-product-thumb"
											name="product_thumb"
											type="file"
											accept="image/*"
											onchange={handleThumbChange}
											bind:this={thumbInput}
											disabled={isThumbUploading}
										/>
										<div class="upload-card-copy">
											<strong>{$t('admin.productEditor.uploadLabel')}</strong>
											<span>{$t('admin.productEditor.uploadHelp')}</span>
										</div>
									</div>
									{#if isThumbUploading}
										<div class="upload-progress-container mt-2">
											<div class="progress" style="height: 4px;">
												<div
													class="progress-bar"
													style="width: {thumbProgress}%; transition: width 0.2s ease;"
												></div>
											</div>
											<span class="progress-text">{thumbProgress}%</span>
										</div>
									{/if}
									{#if imageError}
										<div class="text-danger small mt-2">{imageError}</div>
									{/if}
									{#if thumbPreviewUrl}
										<div class="thumb-preview mt-3">
											<img
												src={thumbCroppedUrl || thumbPreviewUrl}
												alt={$t('admin.productEditor.uploadLabel')}
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
							<div>
								<div class="upload-field-header">
									<label class="field-label" for="edit-product-gallery">
										{$t('admin.productEditor.gallery')}
									</label>
									<button
										type="button"
										class="upload-pick-button"
										onclick={() => openFileInput(galleryInput)}
										aria-controls="edit-product-gallery"
										disabled={galleryPreviewUrls.length >= MAX_GALLERY_FILES || isGalleryUploading}
									>
										{$t('admin.productEditor.chooseImages')}
									</button>
								</div>
								<div class="gallery-upload-wrapper">
									<div
										class="gallery-drop-zone"
										class:active={isGalleryDragActive}
										class:uploading={isGalleryUploading}
									>
										<input
											class="gallery-input"
											id="edit-product-gallery"
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
											<strong>{$t('admin.productEditor.galleryPrompt')}</strong>
											<span>{$t('admin.productEditor.galleryHint')}</span>
											<span class="gallery-count"
												>({galleryPreviewUrls.length}/{MAX_GALLERY_FILES})</span
											>
										</div>
									</div>

									{#if galleryError}
										<div class="text-danger small mt-2">{galleryError}</div>
									{/if}

									{#if galleryPreviewUrls.length}
										<div class="gallery-thumbs-wrapper mt-3">
											<div class="gallery-thumbs-header">
												<h6>
													{$t('admin.productEditor.gallery')} ({galleryPreviewUrls.length}/{MAX_GALLERY_FILES})
												</h6>
											</div>
											<div class="gallery-thumbs">
												{#each galleryItems as item, index}
													<div class="gallery-thumb-item">
														<img
															src={item.croppedUrl || item.previewUrl}
															alt={`${$t('admin.productEditor.gallery')} ${index + 1}`}
														/>
														<button
															class="gallery-crop-btn"
															type="button"
															onclick={() =>
																openCropper({
																	mode: 'gallery',
																	sourceUrl: item.croppedUrl || item.dataUrl || item.previewUrl,
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
															title={$t('admin.productEditor.removeImage') || 'Remove'}
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
															<span class="gallery-thumb-badge">
																{$t('admin.productEditor.cropped')}
															</span>
														{/if}
													</div>
												{/each}
											</div>
										</div>
									{/if}
								</div>
							</div>
						</div>
					</div>
				</section>

				<section class="form-section">
					<div class="section-header">
						<h3>{$t('admin.productEditor.sectionDescription')}</h3>
						<p>{$t('admin.productEditor.sectionDescriptionDesc')}</p>
					</div>
					<div style="margin-bottom: 16px;">
						<RichTextEditor
							value={descriptionValue}
							onChange={(content) => {
								descriptionValue = content;
							}}
							placeholder={$t('admin.productEditor.descriptionPlaceholder')}
						/>
					</div>
					<input type="hidden" name="product_description" value={descriptionValue} />
				</section>

				<details class="form-section advanced">
					<summary>{$t('admin.productEditor.advancedSummary')}</summary>
					<p class="advanced-note">{$t('admin.productEditor.advancedNote')}</p>
					<div class="field-grid">
						<div>
							<label class="field-label" for="edit-product-manufacturer">
								{$t('admin.productEditor.manufacturer')}
							</label>
							<input
								class="field-input"
								id="edit-product-manufacturer"
								name="product_attribute_manufacturer"
								placeholder={$t('admin.productEditor.manufacturer')}
								value={product?.product_attributes?.manufacturer || ''}
							/>
						</div>
						<div>
							<label class="field-label" for="edit-product-model">
								{$t('admin.productEditor.model')}
							</label>
							<input
								class="field-input"
								id="edit-product-model"
								name="product_attribute_model"
								placeholder={$t('admin.productEditor.model')}
								value={product?.product_attributes?.model || ''}
							/>
						</div>
						<div>
							<label class="field-label" for="edit-product-color">
								{$t('admin.productEditor.color')}
							</label>
							<input
								class="field-input"
								id="edit-product-color"
								name="product_attribute_color"
								placeholder={$t('admin.productEditor.color')}
								value={product?.product_attributes?.color || ''}
							/>
						</div>
					</div>
					<div class="variant-manager">
						<label class="field-label">{$t('admin.productEditor.variantsTitle')}</label>
						<div class="variant-grid">
							<div class="variant-card">
								<h6>{$t('admin.productEditor.colors')}</h6>
								<div class="variant-row">
									<input
										class="field-input"
										placeholder={$t('admin.productEditor.colorNamePlaceholder')}
										bind:value={colorInput}
										onkeydown={handleColorKey}
									/>
									<input
										class="field-input"
										type="number"
										min="0"
										step="1"
										placeholder={$t('admin.productEditor.priceOverride')}
										bind:value={colorPriceInput}
									/>
									<button class="btn-outline" type="button" onclick={addColor}>
										{$t('admin.productEditor.addColor')}
									</button>
								</div>
								{#if colors.length}
									<div class="variant-list">
										{#each colors as item}
											<div class="variant-pill">
												<span>{item.name}</span>
												<input
													class="field-input compact"
													type="number"
													min="0"
													step="1"
													placeholder={$t('admin.productEditor.priceOverride')}
													value={item.price ?? ''}
													oninput={(event) =>
														updateColorPrice(item.name, event.currentTarget.value)}
												/>
												<button type="button" onclick={() => removeColor(item.name)}>x</button>
											</div>
										{/each}
									</div>
								{:else}
									<span class="field-help">{$t('admin.productEditor.colorsEmpty')}</span>
								{/if}
							</div>

							<div class="variant-card">
								<h6>{$t('admin.productEditor.sizes')}</h6>
								<div class="variant-row">
									<input
										class="field-input"
										placeholder={$t('admin.productEditor.sizePlaceholder')}
										bind:value={sizeInput}
										onkeydown={handleSizeKey}
									/>
									<input
										class="field-input"
										type="number"
										min="0"
										step="1"
										placeholder={$t('admin.productEditor.priceOverride')}
										bind:value={sizePriceInput}
									/>
									<button class="btn-outline" type="button" onclick={addSize}>
										{$t('admin.productEditor.addSize')}
									</button>
								</div>
								{#if sizes.length}
									<div class="variant-list">
										{#each sizes as item}
											<div class="variant-pill">
												<span>{item.name}</span>
												<input
													class="field-input compact"
													type="number"
													min="0"
													step="1"
													placeholder={$t('admin.productEditor.priceOverride')}
													value={item.price ?? ''}
													oninput={(event) =>
														updateSizePrice(item.name, event.currentTarget.value)}
												/>
												<button type="button" onclick={() => removeSize(item.name)}>x</button>
											</div>
										{/each}
									</div>
								{:else}
									<span class="field-help">{$t('admin.productEditor.sizeEmpty')}</span>
								{/if}
							</div>
						</div>

						<div class="variant-card">
							<h6>{$t('admin.productEditor.comboTitle')}</h6>
							<p class="field-help">{$t('admin.productEditor.comboHint')}</p>
							<div class="variant-row">
								<select class="field-input" bind:value={comboColor}>
									<option value="">{$t('admin.productEditor.selectColor')}</option>
									{#each colors as item}
										<option value={item.name}>{item.name}</option>
									{/each}
								</select>
								<select class="field-input" bind:value={comboSize}>
									<option value="">{$t('admin.productEditor.selectSize')}</option>
									{#each sizes as item}
										<option value={item.name}>{item.name}</option>
									{/each}
								</select>
								<input
									class="field-input"
									type="number"
									min="0"
									step="1"
									placeholder={$t('admin.productEditor.priceOverride')}
									bind:value={comboPriceInput}
								/>
								<button class="btn-outline" type="button" onclick={addCombo}>
									{$t('admin.productEditor.addCombo')}
								</button>
							</div>
							{#if combos.length}
								<div class="variant-list">
									{#each combos as item}
										<div class="variant-pill">
											<span>{item.color} / {item.size}</span>
											<span class="field-help">
												{item.price !== undefined && item.price !== null ? `${item.price}` : '--'}
											</span>
											<button type="button" onclick={() => removeCombo(item)}>x</button>
										</div>
									{/each}
								</div>
							{:else}
								<span class="field-help">{$t('admin.productEditor.comboEmpty')}</span>
							{/if}
						</div>

						<input type="hidden" name="product_variations_present" value="1" />
						<input type="hidden" name="product_variations" value={buildVariationsPayload()} />
						<input type="hidden" name="product_attribute_colors" value={buildColorListPayload()} />
					</div>
				</details>

				<div class="form-actions">
					<button class="btn-primary" type="submit">{$t('admin.productEditor.save')}</button>
					<span class="action-note">{$t('admin.productEditor.saveHint')}</span>
				</div>
			</form>

			<aside class="editor-side">
				<div class="side-card">
					<h3>{$t('admin.productEditor.preview')}</h3>
					<div class="preview-card">
						{#if previewThumbUrl}
							<img src={previewThumbUrl} alt={product.product_name} />
						{:else}
							<div class="media-placeholder">{$t('admin.productEditor.noImage')}</div>
						{/if}
						<div class="preview-info">
							<div class="preview-title">{product.product_name}</div>
							<div class="preview-price">
								{formatPrice(product.product_price)}
								{$t('common.currency')}
							</div>
							<div class="preview-meta">
								<span>{product.product_type}</span>
								<span
									>{$t('admin.productEditor.stockLabel', { count: inventoryStock })}</span
								>
							</div>
						</div>
					</div>
					<div class="stats-row">
						<div>
							<span class="meta-label">{$t('admin.productEditor.admin')}</span>
							<span class="meta-value">{data?.admin?.name || data?.admin?.email || '--'}</span>
						</div>
						<div>
							<span class="meta-label">{$t('admin.productEditor.weightLabel')}</span>
							<span class="meta-value">
								{product.product_weight ? `${product.product_weight} g` : '--'}
							</span>
						</div>
					</div>
				</div>

				<div class="side-card">
					<h3>{$t('admin.productEditor.quickActions')}</h3>
					<p class="side-note">{$t('admin.productEditor.quickActionsDesc')}</p>
					<div class="action-row">
						<form method="post" action="?/publish" onsubmit={guardPublish}>
							<button
								class="btn-outline success"
								class:is-disabled={isPublished}
								type="submit"
								disabled={isPublished}
							>
								{isPublished
									? $t('admin.productEditor.published')
									: $t('admin.productEditor.publish')}
							</button>
						</form>
						<form method="post" action="?/unpublish" onsubmit={guardUnpublish}>
							<button
								class="btn-outline danger"
								class:is-disabled={isDraft}
								type="submit"
								disabled={isDraft}
							>
								{isDraft
									? $t('admin.productEditor.unpublished')
									: $t('admin.productEditor.unpublish')}
							</button>
						</form>
						<form method="post" action="?/delete" onsubmit={confirmDelete}>
							<button class="btn-outline danger" type="submit"
								>{$t('admin.productEditor.delete')}</button
							>
						</form>
					</div>
				</div>

				<div class="side-card tips">
					<h3>{$t('admin.productEditor.tipsTitle')}</h3>
					<ul>
						<li>{$t('admin.productEditor.tip1')}</li>
						<li>{$t('admin.productEditor.tip2')}</li>
						<li>{$t('admin.productEditor.tip3')}</li>
					</ul>
				</div>
			</aside>
		</div>
	{:else}
		<p class="text-black-50">{$t('admin.productEditor.notFound')}</p>
	{/if}

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
						crossorigin="anonymous"
						onload={updateCropBaseScale}
						draggable="false"
						style={`transform: translate(-50%, -50%) translate(${cropOffsetX}px, ${cropOffsetY}px) scale(${cropBaseScale * cropZoom});`}
					/>
				</div>
				<div class="cropper-controls">
					<div class="cropper-zoom">
						<label for="edit-product-crop-zoom">{$t('admin.blogEditor.cropZoom')}</label>
						<input
							id="edit-product-crop-zoom"
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
	:root {
		--primary-color: #0f766e;
		--primary-light: #14b8a6;
		--accent-color: #dc2626;
		--success-color: #16a34a;
		--border-color: #e5e7eb;
		--text-primary: #1f2937;
		--text-secondary: #6b7280;
		--bg-light: #f9fafb;
		--shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
		--shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1);
		--shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1);
	}

	.admin-product-page {
		padding: 0;
		background: linear-gradient(135deg, #f9fafb 0%, #f3f4f6 100%);
		color: var(--text-primary);
		min-height: 100vh;
	}

	/* ==================== HEADER ==================== */
	.product-header {
		background: #fff;
		border-bottom: 1px solid var(--border-color);
		padding: 20px 32px;
		margin-bottom: 32px;
		box-shadow: var(--shadow-sm);
		position: sticky;
		top: 0;
		z-index: 100;
	}

	.header-content {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 24px;
		flex-wrap: wrap;
	}

	.header-left {
		display: flex;
		align-items: center;
		gap: 16px;
		flex: 1 1 auto;
	}

	.back-link {
		display: flex;
		align-items: center;
		gap: 8px;
		color: var(--primary-color);
		text-decoration: none;
		font-weight: 600;
		font-size: 0.95rem;
		transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
		padding: 8px 12px;
		border-radius: 8px;
		margin: -8px -12px;
	}

	.back-link:hover {
		color: var(--primary-light);
		background: rgba(15, 118, 110, 0.08);
		transform: translateX(-2px);
	}

	.back-link svg {
		transition: transform 0.3s ease;
	}

	.back-link:hover svg {
		transform: translateX(-3px);
	}

	.header-title h1 {
		font-size: 1.875rem;
		margin: 0 0 4px 0;
		font-weight: 700;
		letter-spacing: -0.02em;
	}

	.header-meta {
		font-size: 0.95rem;
		color: var(--text-secondary);
		margin: 0;
		font-weight: 500;
	}

	.header-right {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.status-badge {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 8px 14px;
		border-radius: 999px;
		font-weight: 600;
		font-size: 0.85rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		background: #f3f4f6;
		color: var(--text-secondary);
		border: 1px solid var(--border-color);
		animation: slideIn 0.4s ease both;
	}

	.status-badge.published {
		background: rgba(22, 163, 74, 0.1);
		color: var(--success-color);
		border-color: rgba(22, 163, 74, 0.3);
	}

	.status-badge.draft {
		background: rgba(245, 158, 11, 0.1);
		color: #b45309;
		border-color: rgba(245, 158, 11, 0.3);
	}

	.status-dot {
		display: inline-block;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: currentColor;
		animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
	}

	@keyframes slideIn {
		from {
			opacity: 0;
			transform: translateX(8px);
		}
		to {
			opacity: 1;
			transform: translateX(0);
		}
	}

	@keyframes pulse {
		0%, 100% {
			opacity: 1;
		}
		50% {
			opacity: 0.5;
		}
	}

	/* ==================== LAYOUT ==================== */
	.editor-grid {
		display: grid;
		grid-template-columns: 1fr 380px;
		gap: 32px;
		padding: 0 32px 40px;
		max-width: 1600px;
		margin: 0 auto;
	}

	.editor-card {
		background: #fff;
		border-radius: 16px;
		border: 1px solid var(--border-color);
		padding: 32px;
		box-shadow: var(--shadow-md);
		display: grid;
		gap: 32px;
		animation: fadeInUp 0.6s ease both;
	}

	.editor-side {
		display: grid;
		gap: 20px;
		animation: fadeInUp 0.6s ease 0.1s both;
	}

	@keyframes fadeInUp {
		from {
			opacity: 0;
			transform: translateY(16px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	/* ==================== FORM SECTIONS ==================== */
	.form-section {
		display: grid;
		gap: 16px;
		padding-bottom: 20px;
		border-bottom: 1px solid var(--border-color);
	}

	.form-section:last-of-type {
		border-bottom: none;
		padding-bottom: 0;
	}

	.section-header h3 {
		margin: 0 0 4px 0;
		font-size: 1.125rem;
		font-weight: 700;
		letter-spacing: -0.01em;
	}

	.section-header p {
		margin: 0;
		color: var(--text-secondary);
		font-size: 0.9rem;
	}

	.field-grid {
		display: grid;
		gap: 16px;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
	}

	.field-label {
		font-weight: 600;
		margin-bottom: 6px;
		display: block;
		font-size: 0.9rem;
		color: var(--text-primary);
	}

	.field-input {
		width: 100%;
		border: 1px solid var(--border-color);
		border-radius: 10px;
		padding: 10px 14px;
		font-size: 0.95rem;
		background: #fff;
		color: var(--text-primary);
		transition: all 0.3s ease;
		font-family: inherit;
	}

	.field-input:focus {
		outline: none;
		border-color: var(--primary-color);
		box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.1);
		background: #fafbff;
	}

	.field-help {
		display: block;
		margin-top: 6px;
		font-size: 0.8rem;
		color: var(--text-secondary);
	}

	/* ==================== MEDIA SECTION ==================== */
	.media-grid {
		display: grid;
		grid-template-columns: minmax(0, 0.45fr) minmax(0, 0.55fr);
		gap: 20px;
		align-items: start;
	}

	.media-preview {
		border-radius: 14px;
		border: 2px dashed var(--border-color);
		background: #fff;
		aspect-ratio: 1 / 1;
		display: grid;
		place-items: center;
		overflow: hidden;
		transition: all 0.3s ease;
		position: relative;
		padding: 10px;
	}

	.media-preview:hover {
		border-color: var(--primary-color);
		background: rgba(15, 118, 110, 0.02);
	}

	.media-preview img {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}

	.media-placeholder {
		color: var(--text-secondary);
		font-weight: 600;
		text-align: center;
	}

	/* ==================== GALLERY UPLOAD ==================== */
	.gallery-drop-zone {
		position: relative;
		border: 2px dashed var(--border-color);
		border-radius: 12px;
		padding: 24px;
		display: flex;
		align-items: center;
		justify-content: center;
		text-align: center;
		background: var(--bg-light);
		transition: all 0.3s ease;
		cursor: pointer;
		min-height: 140px;
	}

	.gallery-drop-zone:hover {
		border-color: var(--primary-color);
		background: rgba(15, 118, 110, 0.03);
	}

	.gallery-drop-zone.active {
		border-color: var(--primary-light);
		background: rgba(20, 184, 166, 0.08);
		border-style: solid;
		transform: scale(1.02);
	}

	.gallery-drop-zone .gallery-input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0;
		cursor: pointer;
	}

	.gallery-drop-zone .gallery-drop-text {
		pointer-events: none;
		font-size: 0.9rem;
		color: var(--text-primary);
		display: grid;
		justify-items: center;
		gap: 6px;
	}

	.gallery-drop-zone .gallery-drop-text strong {
		display: block;
		font-weight: 700;
		font-size: 0.95rem;
	}

	.gallery-count {
		font-size: 0.8rem;
		color: var(--primary-color);
		font-weight: 600;
	}

	/* ==================== GALLERY THUMBS ==================== */
	.gallery-thumbs-wrapper {
		display: grid;
		gap: 12px;
	}

	.gallery-thumbs {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
		gap: 12px;
	}

	.gallery-thumb-item {
		position: relative;
		border-radius: 10px;
		overflow: hidden;
		border: 1px solid var(--border-color);
		background: #fff;
		aspect-ratio: 1 / 1;
		transition: all 0.3s ease;
		cursor: grab;
	}

	.gallery-thumb-item:active {
		cursor: grabbing;
	}

	.gallery-thumb-item:hover {
		box-shadow: var(--shadow-lg);
		border-color: var(--primary-color);
		transform: translateY(-2px);
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
		transition: all 0.2s ease;
		backdrop-filter: blur(4px);
		font-weight: bold;
		font-size: 16px;
	}

	.gallery-thumb-item:hover .gallery-remove-btn {
		opacity: 1;
	}

	.gallery-remove-btn:hover {
		background: rgba(220, 53, 69, 1);
		transform: scale(1.15);
	}

	.gallery-crop-btn {
		position: absolute;
		top: 6px;
		left: 6px;
		background: rgba(15, 118, 110, 0.85);
		color: #fff;
		border: none;
		border-radius: 6px;
		padding: 4px 8px;
		font-size: 0.7rem;
		font-weight: 600;
		cursor: pointer;
		opacity: 0;
		transition: all 0.2s ease;
		backdrop-filter: blur(4px);
	}

	.gallery-thumb-item:hover .gallery-crop-btn {
		opacity: 1;
	}

	.gallery-crop-btn:hover {
		background: var(--primary-color);
		transform: scale(1.05);
	}

	.gallery-thumb-badge {
		position: absolute;
		right: 6px;
		bottom: 6px;
		background: rgba(34, 197, 94, 0.9);
		color: #fff;
		border-radius: 999px;
		padding: 2px 8px;
		font-size: 0.65rem;
		font-weight: 600;
		backdrop-filter: blur(4px);
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
		font-weight: 700;
		backdrop-filter: blur(4px);
	}

	/* ==================== VARIANT MANAGER ==================== */
	.variant-manager {
		display: grid;
		gap: 16px;
		padding-top: 8px;
	}

	.variant-grid {
		display: grid;
		gap: 16px;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
	}

	.variant-card {
		border: 1px solid var(--border-color);
		border-radius: 10px;
		padding: 16px;
		background: var(--bg-light);
		display: grid;
		gap: 12px;
	}

	.variant-card h6 {
		margin: 0 0 8px 0;
		font-size: 0.95rem;
		font-weight: 700;
		color: var(--text-primary);
	}

	.variant-row {
		display: grid;
		gap: 8px;
		grid-template-columns: auto;
		grid-auto-flow: column;
		align-items: end;
	}

	.variant-list {
		display: grid;
		gap: 8px;
	}

	.variant-pill {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		border-radius: 6px;
		background: #fff;
		border: 1px solid var(--border-color);
		font-weight: 500;
		font-size: 0.9rem;
		transition: all 0.2s ease;
	}

	.variant-pill:hover {
		border-color: var(--primary-color);
		background: rgba(15, 118, 110, 0.05);
		box-shadow: var(--shadow-sm);
	}

	.variant-pill button {
		border: none;
		background: transparent;
		color: var(--accent-color);
		font-weight: 700;
		cursor: pointer;
		padding: 0 4px;
		line-height: 1;
		transition: all 0.2s ease;
	}

	.variant-pill button:hover {
		transform: scale(1.2);
	}

	/* ==================== BUTTONS ==================== */
	.btn-primary {
		background: var(--primary-color);
		color: #fff;
		border: none;
		padding: 10px 20px;
		border-radius: 10px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.3s ease;
		font-size: 0.95rem;
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}

	.btn-primary:hover {
		background: var(--primary-light);
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(15, 118, 110, 0.3);
	}

	.btn-primary:active {
		transform: translateY(0);
	}

	.btn-outline {
		padding: 10px 16px;
		border-radius: 8px;
		background: transparent;
		border: 1.5px solid var(--border-color);
		font-weight: 600;
		cursor: pointer;
		transition: all 0.3s ease;
		font-size: 0.9rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
	}

	.btn-outline:hover {
		border-color: var(--primary-color);
		background: rgba(15, 118, 110, 0.05);
		color: var(--primary-color);
	}

	.btn-outline.success {
		border-color: var(--success-color);
		color: var(--success-color);
	}

	.btn-outline.success:hover {
		background: rgba(22, 163, 74, 0.05);
	}

	.btn-outline.success.is-disabled {
		background: var(--success-color);
		color: white;
		cursor: not-allowed;
		opacity: 0.9;
	}

	.btn-outline.danger {
		border-color: var(--accent-color);
		color: var(--accent-color);
	}

	.btn-outline.danger:hover {
		background: rgba(220, 38, 38, 0.05);
	}

	.btn-outline.danger.is-disabled {
		background: var(--accent-color);
		color: white;
		cursor: not-allowed;
		opacity: 0.9;
	}

	/* ==================== SIDEBAR ==================== */
	.side-card {
		background: #fff;
		border: 1px solid var(--border-color);
		border-radius: 14px;
		padding: 20px;
		box-shadow: var(--shadow-sm);
		display: grid;
		gap: 14px;
		transition: all 0.3s ease;
	}

	.side-card:hover {
		box-shadow: var(--shadow-md);
	}

	.side-card h3 {
		margin: 0 0 8px 0;
		font-size: 1rem;
		font-weight: 700;
		color: var(--text-primary);
	}

	.side-note {
		color: var(--text-secondary);
		font-size: 0.85rem;
		margin: 0;
	}

	.preview-card {
		display: grid;
		gap: 12px;
	}

	.preview-card img {
		width: 100%;
		border-radius: 10px;
		object-fit: contain;
		aspect-ratio: 1;
		background: #fff;
		border: 1px solid var(--border-color);
		transition: all 0.3s ease;
	}

	.preview-card img:hover {
		box-shadow: var(--shadow-md);
	}

	.preview-info {
		display: grid;
		gap: 8px;
	}

	.preview-title {
		font-weight: 700;
		font-size: 0.95rem;
		color: var(--text-primary);
		line-height: 1.4;
	}

	.preview-price {
		color: var(--primary-color);
		font-weight: 700;
		font-size: 1.1rem;
	}

	.preview-meta {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		color: var(--text-secondary);
		font-size: 0.8rem;
	}

	.stats-row {
		display: grid;
		gap: 10px;
		padding-top: 12px;
		border-top: 1px solid var(--border-color);
	}

	.meta-label {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-secondary);
		font-weight: 600;
	}

	.meta-value {
		display: block;
		font-weight: 600;
		color: var(--text-primary);
		font-size: 0.9rem;
	}

	.action-row {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.action-row button {
		width: 100%;
		justify-content: center;
	}

	.tips ul {
		padding-left: 18px;
		margin: 0;
		color: var(--text-secondary);
		display: grid;
		gap: 8px;
		font-size: 0.85rem;
		line-height: 1.5;
	}

	/* ==================== CROPPER ==================== */
	.cropper-modal {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 20px;
		z-index: 2000;
		backdrop-filter: blur(4px);
	}

	.cropper-dialog {
		width: min(540px, 95vw);
		background: #fff;
		border-radius: 16px;
		padding: 20px;
		display: grid;
		gap: 16px;
		box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
		animation: scaleIn 0.3s ease both;
	}

	@keyframes scaleIn {
		from {
			opacity: 0;
			transform: scale(0.95);
		}
		to {
			opacity: 1;
			transform: scale(1);
		}
	}

	.cropper-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 4px;
	}

	.cropper-header h5 {
		margin: 0;
		font-size: 1.1rem;
		font-weight: 700;
	}

	.cropper-close {
		background: transparent;
		border: none;
		font-size: 28px;
		cursor: pointer;
		color: var(--text-secondary);
		transition: all 0.2s ease;
		line-height: 1;
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 8px;
	}

	.cropper-close:hover {
		background: var(--bg-light);
		color: var(--text-primary);
	}

	.cropper-frame {
		position: relative;
		width: 100%;
		aspect-ratio: 1 / 1;
		border: 2px solid var(--border-color);
		border-radius: 10px;
		overflow: hidden;
		background: var(--bg-light);
		cursor: grab;
	}

	.cropper-frame:active {
		cursor: grabbing;
	}

	.cropper-image {
		position: absolute;
		top: 50%;
		left: 50%;
		user-select: none;
	}

	.cropper-controls {
		display: grid;
		gap: 12px;
		padding-top: 8px;
		border-top: 1px solid var(--border-color);
	}

	.cropper-zoom {
		display: grid;
		gap: 8px;
	}

	.cropper-zoom label {
		font-weight: 600;
		font-size: 0.85rem;
	}

	.cropper-zoom input {
		width: 100%;
		cursor: pointer;
	}

	.cropper-actions {
		display: grid;
		grid-auto-flow: column;
		gap: 8px;
	}

	/* ==================== RESPONSIVE ==================== */
	@media (max-width: 1200px) {
		.editor-grid {
			grid-template-columns: 1fr;
			gap: 24px;
		}

		.media-grid {
			grid-template-columns: 1fr;
		}

		.header-content {
			flex-direction: column;
			align-items: flex-start;
		}
	}

	@media (max-width: 768px) {
		.admin-product-page {
			padding: 0;
		}

		.product-header {
			padding: 16px 20px;
			margin-bottom: 24px;
		}

		.editor-grid {
			padding: 0 20px 32px;
		}

		.editor-card {
			padding: 20px;
			gap: 24px;
		}

		.header-title h1 {
			font-size: 1.5rem;
		}

		.field-grid {
			grid-template-columns: 1fr;
		}

		.variant-grid {
			grid-template-columns: 1fr;
		}

		.gallery-thumbs {
			grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
		}

		.media-grid {
			gap: 16px;
		}

		.media-preview {
			min-height: auto;
		}

		.action-row {
			flex-direction: row;
		}

		.action-row button {
			width: auto;
		}
	}

	/* ==================== ADVANCED SECTION ==================== */
	.advanced {
		border-top: 1px dashed var(--border-color);
		padding-top: 16px;
		margin-top: 8px;
	}

	.advanced summary {
		font-weight: 600;
		cursor: pointer;
		color: var(--text-primary);
		padding: 8px;
		margin: -8px;
		border-radius: 6px;
		transition: all 0.2s ease;
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.advanced summary:hover {
		background: var(--bg-light);
	}

	.advanced-note {
		color: var(--text-secondary);
		margin-top: 12px;
		font-size: 0.9rem;
	}

	/* ==================== FORM ACTIONS ==================== */
	.form-actions {
		display: flex;
		align-items: center;
		gap: 16px;
		flex-wrap: wrap;
		padding-top: 16px;
		border-top: 1px solid var(--border-color);
		margin-top: 16px;
	}

	.action-note {
		color: var(--text-secondary);
		font-size: 0.85rem;
	}

	/* ==================== UPLOAD SECTION ==================== */
	.upload-field-header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 8px;
	}

	.upload-field-header .field-label {
		margin-bottom: 0;
	}

	.thumb-upload-wrapper {
		position: relative;
	}

	.thumb-upload-card {
		position: relative;
		border: 2px dashed var(--border-color);
		border-radius: 12px;
		padding: 22px;
		min-height: 140px;
		display: grid;
		place-items: center;
		background: var(--bg-light);
		text-align: center;
		cursor: pointer;
		transition: all 0.25s ease;
	}

	.thumb-upload-card:hover {
		border-color: var(--primary-color);
		background: rgba(15, 118, 110, 0.03);
	}

	.upload-file-input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0;
		cursor: pointer;
	}

	.upload-file-input:disabled {
		cursor: not-allowed;
	}

	.upload-card-copy {
		pointer-events: none;
		display: grid;
		justify-items: center;
		gap: 8px;
		font-size: 0.9rem;
		color: var(--text-primary);
	}

	.upload-card-copy strong {
		font-weight: 700;
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
		background: var(--primary-color);
		color: #fff;
		font-size: 0.85rem;
		font-weight: 700;
		cursor: pointer;
		transition:
			background 0.2s ease,
			box-shadow 0.2s ease,
			transform 0.2s ease;
	}

	.upload-pick-button:hover:not(:disabled) {
		background: #0b665f;
		box-shadow: 0 8px 16px rgba(15, 118, 110, 0.18);
		transform: translateY(-1px);
	}

	.upload-pick-button:disabled {
		cursor: not-allowed;
		opacity: 0.55;
		box-shadow: none;
		transform: none;
	}

	.thumb-preview {
		border: 1px solid var(--border-color);
		border-radius: 10px;
		padding: 12px;
		display: grid;
		gap: 12px;
		background: var(--bg-light);
		margin-top: 12px;
	}

	.thumb-preview img {
		width: 100%;
		max-width: 320px;
		aspect-ratio: 1 / 1;
		object-fit: contain;
		background: #fff;
		border-radius: 8px;
		border: 1px solid var(--border-color);
	}

	.thumb-actions {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}

	/* ==================== RICH TEXT EDITOR ==================== */
	:global(.rich-editor) {
		border: 1px solid var(--border-color);
		border-radius: 10px;
		overflow: hidden;
	}

	:global(.rich-editor:focus-within) {
		border-color: var(--primary-color);
		box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.1);
	}

</style>

