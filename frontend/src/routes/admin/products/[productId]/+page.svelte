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
	const MAX_IMAGE_BYTES = 1024 * 1024;
	const REQUIRED_WIDTH = 300;
	const REQUIRED_HEIGHT = 300;
	const GALLERY_REQUIRED_WIDTH = 300;
	const GALLERY_REQUIRED_HEIGHT = 300;
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
	let galleryInput;
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
		requiredWidth = REQUIRED_WIDTH,
		requiredHeight = REQUIRED_HEIGHT
	) => {
		if (!file) return null;
		if (file.size > MAX_IMAGE_BYTES) {
			return $t('admin.productEditor.imageTooLarge', { size: '1MB' });
		}
		try {
			const { width, height } = await getImageDimensions(file);
			if (width !== requiredWidth || height !== requiredHeight) {
				return $t('admin.productEditor.imageDimensions', {
					width: requiredWidth,
					height: requiredHeight
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
			cropMode === 'gallery' ? GALLERY_REQUIRED_WIDTH : REQUIRED_WIDTH;
		const outputHeight =
			cropMode === 'gallery' ? GALLERY_REQUIRED_HEIGHT : REQUIRED_HEIGHT;
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

		const validationMessage = await validateImageFile(file, REQUIRED_WIDTH, REQUIRED_HEIGHT);
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
				GALLERY_REQUIRED_WIDTH,
				GALLERY_REQUIRED_HEIGHT
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
				GALLERY_REQUIRED_WIDTH,
				GALLERY_REQUIRED_HEIGHT
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
	<title>{$t('admin.productEditor.title')} | Admin</title>
</svelte:head>

<section class="admin-product-page">
	<header class="admin-header">
		<div>
			<a class="link-back" href="/admin/products">{$t('admin.productEditor.back')}</a>
			<h1>{$t('admin.productEditor.title')}</h1>
			<p class="lead">{$t('admin.productEditor.lede')}</p>
		</div>
		<div class="meta-grid">
			<div>
				<span class="meta-label">{$t('admin.productEditor.slug')}</span>
				<span class="meta-value">{product?.product_slug || '--'}</span>
			</div>
			<div>
				<span class="meta-label">{$t('admin.productEditor.updated')}</span>
				<span class="meta-value">{formatDate(product?.updatedAt)}</span>
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
								<label class="field-label" for="edit-product-thumb">
									{$t('admin.productEditor.uploadLabel')}
								</label>
								<div class="thumb-upload-wrapper">
									<input
										class="field-input"
										id="edit-product-thumb"
										name="product_thumb"
										type="file"
										accept="image/*"
										onchange={handleThumbChange}
										disabled={isThumbUploading}
									/>
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
									<span class="field-help mt-2">{$t('admin.productEditor.uploadHelp')}</span>
								</div>
							</div>
							<div>
								<label class="field-label" for="edit-product-gallery">
									{$t('admin.productEditor.gallery')}
								</label>
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
	.admin-product-page {
		padding: 0;
		background: transparent;
		color: var(--admin-ink);
	}

	.admin-header {
		display: flex;
		justify-content: space-between;
		gap: 24px;
		flex-wrap: wrap;
		margin-bottom: 24px;
	}

	.admin-header h1 {
		font-size: 2rem;
		margin: 8px 0 8px;
	}

	.lead {
		color: var(--admin-muted);
		max-width: 520px;
	}

	.link-back {
		color: var(--admin-accent-strong);
		font-weight: 600;
		text-decoration: none;
	}

	.meta-grid {
		display: grid;
		gap: 10px;
		background: rgba(255, 255, 255, 0.6);
		border: 1px solid var(--admin-border);
		border-radius: 14px;
		padding: 12px 16px;
		min-width: 260px;
	}

	.meta-label {
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--admin-muted);
	}

	.meta-value {
		display: block;
		font-weight: 600;
	}

	.editor-grid {
		display: grid;
		grid-template-columns: minmax(0, 1.2fr) minmax(0, 0.6fr);
		gap: 24px;
	}

	.editor-card {
		background: var(--admin-card);
		border-radius: var(--admin-radius);
		padding: 28px;
		box-shadow: var(--admin-shadow);
		border: 1px solid var(--admin-border);
		display: grid;
		gap: 24px;
		animation: fadeUp 0.6s ease both;
	}

	.section-header h3 {
		margin: 0 0 6px;
	}

	.section-header p {
		margin: 0;
		color: var(--admin-muted);
	}

	.form-section {
		display: grid;
		gap: 16px;
	}

	.field-grid {
		display: grid;
		gap: 16px;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
	}

	.field-label {
		font-weight: 600;
		margin-bottom: 6px;
		display: block;
	}

	.field-input {
		width: 100%;
		border: 1px solid var(--admin-border);
		border-radius: 12px;
		padding: 12px 14px;
		font-size: 0.95rem;
		background: #fff;
	}

	.field-help {
		display: block;
		margin-top: 6px;
		font-size: 0.85rem;
		color: var(--admin-muted);
	}

	.size-manager {
		display: grid;
		gap: 12px;
	}

	.size-input-row {
		display: flex;
		gap: 12px;
		flex-wrap: wrap;
		align-items: center;
	}

	.size-input-row .field-input {
		flex: 1 1 220px;
	}

	.size-list {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.size-chip {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 6px 12px;
		border-radius: 999px;
		border: 1px solid var(--admin-border);
		background: #f8f4ec;
		font-weight: 600;
	}

	.size-chip button {
		border: none;
		background: transparent;
		color: #b23b3b;
		font-weight: 700;
		cursor: pointer;
	}

	.media-grid {
		display: grid;
		grid-template-columns: minmax(0, 0.45fr) minmax(0, 0.55fr);
		gap: 20px;
		align-items: center;
	}

	.media-preview {
		border-radius: 16px;
		border: 1px dashed var(--admin-border);
		background: #faf7f1;
		min-height: 180px;
		display: grid;
		place-items: center;
		overflow: hidden;
	}

	.media-preview img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.media-placeholder {
		color: var(--admin-muted);
		font-weight: 600;
	}

	.advanced {
		border-top: 1px dashed var(--admin-border);
		padding-top: 16px;
	}

	.advanced summary {
		font-weight: 600;
		cursor: pointer;
	}

	.advanced-note {
		color: var(--admin-muted);
		margin-top: 10px;
	}

	.code-input {
		font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
		font-size: 0.85rem;
	}

	.form-actions {
		display: flex;
		align-items: center;
		gap: 16px;
		flex-wrap: wrap;
	}

	.btn-primary {
		background: var(--admin-ink);
		color: #fff;
		border: none;
		padding: 12px 20px;
		border-radius: 12px;
		font-weight: 600;
		cursor: pointer;
	}

	.action-note {
		color: var(--admin-muted);
		font-size: 0.9rem;
	}

	.editor-side {
		display: grid;
		gap: 18px;
		animation: fadeUp 0.6s ease 0.08s both;
	}

	.side-card {
		background: var(--admin-card);
		border: 1px solid var(--admin-border);
		border-radius: var(--admin-radius);
		padding: 20px;
		box-shadow: var(--admin-shadow);
		display: grid;
		gap: 14px;
	}

	.preview-card {
		display: grid;
		gap: 12px;
	}

	.preview-card img {
		width: 100%;
		border-radius: 14px;
		object-fit: cover;
	}

	.preview-info {
		display: grid;
		gap: 6px;
	}

	.preview-title {
		font-weight: 700;
		font-size: 1.05rem;
	}

	.preview-price {
		color: var(--admin-accent);
		font-weight: 700;
		font-size: 1.1rem;
	}

	.preview-meta {
		display: flex;
		gap: 12px;
		color: var(--admin-muted);
		font-size: 0.9rem;
	}

	.stats-row {
		display: grid;
		gap: 10px;
	}

	.side-note {
		color: var(--admin-muted);
	}

	.action-row {
		display: flex;
		gap: 12px;
		flex-wrap: wrap;
	}

	.btn-outline {
		padding: 10px 16px;
		border-radius: 999px;
		background: transparent;
		border: 1px solid var(--admin-border);
		font-weight: 600;
		cursor: pointer;
	}

	.btn-outline.success {
		border-color: #2d8a45;
		color: #2d8a45;
	}

	.btn-outline.danger {
		border-color: #b23b3b;
		color: #b23b3b;
	}

	.btn-outline.is-disabled {
		opacity: 0.9;
		cursor: not-allowed;
	}

	.btn-outline.success.is-disabled {
		background: #2d8a45;
		border-color: #2d8a45;
		color: #fff;
	}

	.btn-outline.danger.is-disabled {
		background: #b23b3b;
		border-color: #b23b3b;
		color: #fff;
	}

	.tips ul {
		padding-left: 18px;
		margin: 0;
		color: var(--admin-muted);
		display: grid;
		gap: 8px;
	}

	@keyframes fadeUp {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@media (max-width: 1100px) {
		.editor-grid {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 720px) {
		.admin-product-page {
			padding: 20px;
		}

		.media-grid {
			grid-template-columns: 1fr;
		}

		.meta-grid {
			min-width: unset;
			width: 100%;
		}
	}

	.gallery-drop-zone {
		position: relative;
		border: 2px dashed rgba(0, 0, 0, 0.15);
		border-radius: 12px;
		padding: 22px;
		display: flex;
		align-items: center;
		justify-content: center;
		text-align: center;
		background: #fafafa;
		transition:
			border-color 0.2s ease,
			background 0.2s ease,
			transform 0.2s ease;
		cursor: pointer;
		min-height: 120px;
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

	.gallery-drop-zone .gallery-drop-text {
		pointer-events: none;
		font-size: 0.9rem;
		color: #3c3c3c;
		display: grid;
		gap: 6px;
	}

	.gallery-drop-zone .gallery-drop-text strong {
		display: block;
		font-weight: 600;
		margin-bottom: 2px;
	}

	.gallery-count {
		font-size: 0.8rem;
		color: #6c757d;
		font-weight: 500;
	}

	.thumb-upload-wrapper {
		position: relative;
	}

	.gallery-upload-wrapper {
		display: grid;
		gap: 12px;
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
		background: linear-gradient(90deg, #007bff 0%, #0056b3 100%);
		height: 100%;
		transition: width 0.2s ease;
		box-shadow: 0 1px 3px rgba(0, 123, 255, 0.3);
	}

	.progress-text {
		font-size: 0.75rem;
		font-weight: 600;
		color: #6c757d;
		display: flex;
		align-items: center;
		justify-content: flex-end;
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
		aspect-ratio: 1;
		group: thumb;
		transition: all 0.2s ease;
	}

	.gallery-thumb-item:hover {
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
		border-color: rgba(0, 0, 0, 0.15);
	}

	.gallery-thumb-item img {
		width: 100%;
		height: 100%;
		object-fit: cover;
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
		max-width: 240px;
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

	.gallery-thumb {
		border-radius: 14px;
		overflow: hidden;
		border: 1px solid rgba(0, 0, 0, 0.08);
		background: #fff;
	}

	.gallery-thumb img {
		width: 100%;
		height: 100px;
		object-fit: cover;
		display: block;
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

	@media (max-width: 576px) {
		.gallery-drop-zone {
			padding: 16px;
			min-height: 100px;
		}

		.gallery-thumbs {
			grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
		}
	}

	.variant-manager {
		display: grid;
		gap: 16px;
	}

	.variant-grid {
		display: grid;
		gap: 16px;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
	}

	.variant-card {
		border: 1px solid var(--admin-border);
		border-radius: 14px;
		padding: 14px;
		background: #faf7f1;
		display: grid;
		gap: 10px;
	}

	.variant-card h6 {
		margin: 0;
		font-weight: 600;
	}

	.variant-row {
		display: grid;
		gap: 10px;
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
		border-radius: 999px;
		padding: 6px 12px;
		background: #fff;
		border: 1px solid var(--admin-border);
	}

	.field-input.compact {
		max-width: 140px;
	}
</style>

