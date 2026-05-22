<script>
	import '$lib/styles/product-page.css';
	import { onDestroy, onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { env } from '$env/dynamic/public';
	import { flyToCart } from '$lib/client/flyToCart.js';
	import { addGuestCartItem } from '$lib/client/guestCart.js';
	import { syncCartCountFromActionResult } from '$lib/client/cartCountSync.js';
	import RichTextDisplay from '$lib/components/RichTextDisplay.svelte';
	import { locale, t } from '$lib/i18n/index.js';
	import {
		buildStaticReviewsForProduct,
		getMarketingRatingSummary
	} from '$lib/data/staticReviews.js';
	import { buildOfferShippingDetailsJsonLd } from '$lib/seo/shippingSchema.js';
	import { cartToast } from '$lib/stores/cartToast.js';
	import { localizeInternalHref } from '$lib/utils/localePath.js';
	import { resolveCategorySlug } from '$lib/utils/category.js';

	let { data, form } = $props();
	let isAddingToCart = $state(false);
	let isSubmittingReview = $state(false);
	let relatedAddingId = $state(null);
	let relatedAddedId = $state(null);
	let relatedLockedAddIds = $state(new Set());
	let isGalleryOpen = $state(false);
	let galleryIndex = $state(0);
	let galleryZoom = $state(1);
	let galleryPanX = $state(0);
	let galleryPanY = $state(0);
	let isGalleryPanning = $state(false);
	let galleryPanStartX = $state(0);
	let galleryPanStartY = $state(0);
	let galleryPanOriginX = $state(0);
	let galleryPanOriginY = $state(0);
	let galleryPanPointerId = $state(null);
	let galleryViewportEl = $state(null);
	let galleryImageEl = $state(null);
	let mainGalleryEl = $state(null);
	let reviewImageInputEl = $state(null);
	let reviewsSectionEl = $state(null);
	let largeSwiperInstance = null;
	let reviewSelectedImages = $state([]);
	let retainedReviewImages = $state([]);
	let reviewImageSyncKey = $state('');
	let isMobile = $state(
		typeof window !== 'undefined' ? window.matchMedia('(max-width: 768px)').matches : false
	);
	const isAuthenticated = $derived(Boolean(data?.user));
	const MAX_REVIEW_IMAGES = 4;
	const MAX_REVIEW_IMAGE_BYTES = 5 * 1024 * 1024;

	const fallbackThumbs = [
		'/images/optimized/product-item1-640.webp',
		'/images/optimized/product-item2-640.webp',
		'/images/optimized/product-item3-640.webp',
		'/images/optimized/product-item4-640.webp'
	];

	const fallbackGallery = [
		'/images/optimized/product-large-1-1200.webp',
		'/images/optimized/product-large-2-1200.webp',
		'/images/optimized/product-large-3-1200.webp'
	];
	const FLY_TO_CART_Y_OFFSET = -60;
	const FLY_TO_CART_X_OFFSET = -50;
	const DEFAULT_SITE_URL = 'https://inoxpran.com';
	const MERCHANT_RETURN_DAYS = 7;
	const STRUCTURED_IDENTIFIER_MAX_LENGTH = 50;
	const PRODUCT_TYPE_LABELS = {
		Inoxs: {
			vi: 'Đồ Inox',
			en: 'Stainless cookware'
		},
		CastIrons: {
			vi: 'Đồ Gang',
			en: 'Cast iron cookware'
		},
		Electronics: {
			vi: 'Đồ Điện Tử',
			en: 'Home appliances'
		}
	};
	const normalizeSiteUrl = (value) => {
		const raw = String(value || '').trim();
		if (!raw) return DEFAULT_SITE_URL;
		return raw.replace(/\/+$/, '');
	};
	const siteUrl = $derived(normalizeSiteUrl(env.PUBLIC_SITE_URL));

	const toAbsoluteUrl = (value) => {
		const raw = String(value || '').trim();
		if (!raw) return '';
		if (/^https?:\/\//i.test(raw)) return raw;
		const normalizedPath = raw.startsWith('/') ? raw : `/${raw}`;
		return `${siteUrl}${normalizedPath}`;
	};
	const escapeJsonLd = (value) =>
		String(value || '')
			.replace(/</g, '\\u003c')
			.replace(/>/g, '\\u003e')
			.replace(/&/g, '\\u0026')
			.replace(/\u2028/g, '\\u2028')
			.replace(/\u2029/g, '\\u2029');
	const buildMerchantReturnPolicyJsonLd = (localeValue = 'vi') => ({
		'@type': 'MerchantReturnPolicy',
		'@id': `${siteUrl}/#merchant-return-policy`,
		url: `${siteUrl}${localeValue === 'en' ? '/en/policies/returns-policy' : '/policies/returns-policy'}`,
		applicableCountry: 'VN',
		returnPolicyCountry: 'VN',
		returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
		merchantReturnDays: MERCHANT_RETURN_DAYS,
		returnMethod: 'https://schema.org/ReturnByMail',
		returnFees: 'https://schema.org/ReturnFeesCustomerResponsibility',
		itemCondition: 'https://schema.org/NewCondition',
		description:
			localeValue === 'en'
				? 'Returns for manufacturer defects are supported within 7 days, with transit issue claims accepted within 48 hours.'
				: 'Hỗ trợ đổi trả lỗi do nhà sản xuất trong 7 ngày và tiếp nhận khiếu nại ngoại quan do vận chuyển trong 48 giờ.'
	});
	const normalizeStructuredIdentifier = (value) => {
		const raw = String(value || '')
			.trim()
			.replace(/\s+/g, ' ');
		if (!raw || raw.length > STRUCTURED_IDENTIFIER_MAX_LENGTH) return '';
		return raw;
	};
	const extractStructuredProductCode = (value) => {
		const raw = String(value || '').trim();
		if (!raw) return '';
		const match = raw.match(/\bINP\d{3,}[A-Z0-9]*\b/i);
		return normalizeStructuredIdentifier(match?.[0] || '');
	};
	const resolveStructuredSku = (productValue) => {
		const candidates = [
			productValue?.product_attributes?.model,
			productValue?.product_attributes?.sku,
			productValue?.product_code,
			productValue?.sku
		];
		for (const candidate of candidates) {
			const normalized = normalizeStructuredIdentifier(candidate);
			if (normalized) return normalized;
		}
		return extractStructuredProductCode(productValue?.product_name);
	};
	const getProductTypeLabel = (value, localeValue = 'vi') => {
		const normalized = String(value || '').trim();
		if (!normalized) return '';
		return PRODUCT_TYPE_LABELS[normalized]?.[localeValue] || normalized;
	};

	const formatPrice = (value) => {
		const numeric = Number(value);
		if (Number.isNaN(numeric)) return '';
		const localeValue = $locale === 'en' ? 'en-US' : 'vi-VN';
		return `${new Intl.NumberFormat(localeValue).format(numeric)}${$t('common.currency')}`;
	};

	const formatDecimal = (value, localeValue = 'vi-VN') => {
		const numeric = Number(value);
		if (!Number.isFinite(numeric)) return '0';
		const rounded = Math.round(numeric * 10) / 10;
		const hasFraction = Math.abs(rounded % 1) > Number.EPSILON;
		return new Intl.NumberFormat(localeValue, {
			minimumFractionDigits: hasFraction ? 1 : 0,
			maximumFractionDigits: 1
		}).format(rounded);
	};

	const clampRating = (value) => {
		const numeric = Number(value);
		if (!Number.isFinite(numeric) || numeric <= 0) return 0;
		return Math.min(5, Math.round(numeric * 10) / 10);
	};

	const buildRatingStars = (value) =>
		Array.from({ length: 5 }, (_, index) => {
			const delta = clampRating(value) - index;
			if (delta >= 0.75) {
				return { type: 'full', href: '#star-fill', viewBox: '0 0 24 24' };
			}
			if (delta >= 0.25) {
				return { type: 'half', href: '#star-half', viewBox: '0 0 16 16' };
			}
			return { type: 'empty', href: '#star-empty', viewBox: '0 0 16 16' };
		});

	const formatReviewDate = (value, localeValue = 'vi') => {
		const raw = String(value ?? '').trim();
		if (!raw) return '';
		const parsed = new Date(raw);
		if (Number.isNaN(parsed.getTime())) return raw;
		return new Intl.DateTimeFormat(localeValue === 'en' ? 'en-US' : 'vi-VN', {
			day: '2-digit',
			month: 'short',
			year: 'numeric'
		}).format(parsed);
	};

	const toReviewArray = (value) => {
		if (Array.isArray(value)) return value;
		if (Array.isArray(value?.items)) return value.items;
		if (Array.isArray(value?.data)) return value.data;
		return [];
	};

	const normalizeReviewImageItems = (value) => {
		const source = Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : [];
		return source
			.map((item) => {
				if (typeof item === 'string') {
					const url = String(item).trim();
					return url ? { url } : null;
				}
				if (!item || typeof item !== 'object') return null;
				const url = String(
					item?.url ?? item?.src ?? item?.image ?? item?.canonical?.url ?? ''
				).trim();
				if (!url) return null;
				const path = String(item?.path ?? '').trim();
				return {
					url,
					...(path ? { path } : {}),
					...(item?.variants ? { variants: item.variants } : {})
				};
			})
			.filter(Boolean)
			.slice(0, MAX_REVIEW_IMAGES);
	};

	const resolveReviewImageUrl = (item) =>
		String(item?.variants?.canonical?.url || item?.url || item?.src || '').trim();

	const revokeReviewImagePreviews = (items = []) => {
		items.forEach((item) => {
			const url = String(item?.previewUrl || '').trim();
			if (url.startsWith('blob:')) {
				URL.revokeObjectURL(url);
			}
		});
	};

	const buildReviewPreviewItems = (files = []) =>
		files.map((file, index) => ({
			id: `${file.name}-${file.size}-${file.lastModified}-${index}`,
			file,
			name: file.name,
			previewUrl: URL.createObjectURL(file)
		}));

	const normalizeReviewItems = (value, localeValue = 'vi') =>
		toReviewArray(value)
			.map((item, index) => {
				const rating = clampRating(
					item?.rating ?? item?.stars ?? item?.score ?? item?.product_rating
				);
				const title = String(item?.title ?? item?.headline ?? item?.subject ?? '').trim();
				const content = String(
					item?.content ?? item?.comment ?? item?.review ?? item?.body ?? item?.message ?? ''
				).trim();
				const author = String(
					item?.author ??
						item?.name ??
						item?.customerName ??
						item?.customer_name ??
						item?.user?.name ??
						(localeValue === 'en' ? 'Customer' : 'Khách hàng')
				).trim();
				const dateLabel = formatReviewDate(
					item?.createdAt ?? item?.created_at ?? item?.date ?? item?.reviewedAt ?? item?.updatedAt,
					localeValue
				);
				const rawDate = String(
					item?.createdAt ??
						item?.created_at ??
						item?.date ??
						item?.reviewedAt ??
						item?.updatedAt ??
						''
				).trim();
				const verified = Boolean(
					item?.verified ??
					item?.verifiedPurchase ??
					item?.isVerifiedPurchase ??
					item?.purchase_verified
				);

				if (!title && !content && !author && !dateLabel && rating <= 0) return null;

				return {
					id: String(item?._id ?? item?.id ?? item?.reviewId ?? `review-${index + 1}`),
					title,
					content,
					author,
					dateLabel,
					rawDate,
					rating,
					stars: buildRatingStars(rating),
					verified,
					images: normalizeReviewImageItems(
						item?.images ?? item?.review_images ?? item?.photos ?? item?.media
					)
				};
			})
			.filter(Boolean);

	const calculateAverageRating = (items) => {
		if (!Array.isArray(items) || !items.length) return 0;
		const ratings = items.map((item) => clampRating(item?.rating)).filter((item) => item > 0);
		if (!ratings.length) return 0;
		return Math.round((ratings.reduce((sum, item) => sum + item, 0) / ratings.length) * 10) / 10;
	};

	const stripHtml = (value) => {
		if (!value) return '';
		return value
			.replace(/<[^>]*>/g, ' ')
			.replace(/&nbsp;/gi, ' ')
			.replace(/\s+/g, ' ')
			.trim();
	};

	const truncate = (text, limit = 200) => {
		if (!text) return '';
		if (text.length <= limit) return text;
		return `${text.slice(0, limit).trim()}...`;
	};

	const truncateAtWordBoundary = (text, limit = 200) => {
		if (!text) return '';
		if (text.length <= limit) return text;
		const sliced = text.slice(0, limit);
		const wordBoundary = sliced.lastIndexOf(' ');
		const safeSlice =
			wordBoundary > Math.floor(limit * 0.6) ? sliced.slice(0, wordBoundary) : sliced;
		return `${safeSlice.trim()}...`;
	};

	const normalizeGalleryIndex = (value) => {
		const total = galleryImages?.length ?? 0;
		if (!total) return 0;
		const parsed = Number(value);
		if (!Number.isFinite(parsed)) return 0;
		const rounded = Math.round(parsed);
		return ((rounded % total) + total) % total;
	};

	const resetGalleryTransform = () => {
		galleryZoom = 1;
		galleryPanX = 0;
		galleryPanY = 0;
		isGalleryPanning = false;
		galleryPanPointerId = null;
	};

	const setGalleryIndex = (nextIndex, options = {}) => {
		const { syncMainSlider = false, resetTransform = false } = options;
		if (!Array.isArray(galleryImages) || !galleryImages.length) return;

		const safeIndex = normalizeGalleryIndex(nextIndex);
		galleryIndex = safeIndex;

		if (syncMainSlider && largeSwiperInstance) {
			const currentIndex = Number.isFinite(largeSwiperInstance.realIndex)
				? largeSwiperInstance.realIndex
				: largeSwiperInstance.activeIndex;
			if (Number(currentIndex) !== safeIndex) {
				largeSwiperInstance.slideTo(safeIndex);
			}
		}

		if (resetTransform) {
			resetGalleryTransform();
		}
	};

	const openGallery = (index) => {
		if (!Array.isArray(galleryImages) || galleryImages.length === 0) return;
		setGalleryIndex(index, { syncMainSlider: true, resetTransform: true });
		isGalleryOpen = true;
	};

	const openGalleryFromActiveSlide = () => {
		if (!Array.isArray(galleryImages) || galleryImages.length === 0) return;
		const activeIndex = normalizeGalleryIndex(largeSwiperInstance?.realIndex ?? galleryIndex);
		openGallery(activeIndex);
	};

	const portalToBody = (node) => {
		if (typeof document === 'undefined') return {};
		document.body.appendChild(node);
		return {
			destroy() {
				if (node.parentNode) {
					node.parentNode.removeChild(node);
				}
			}
		};
	};

	const closeGallery = () => {
		isGalleryOpen = false;
		resetGalleryTransform();
	};

	const zoomInGallery = () => {
		galleryZoom = Math.min(4, Number(galleryZoom) + 0.25);
		scheduleGalleryPanClamp();
	};

	const zoomOutGallery = () => {
		galleryZoom = Math.max(1, Number(galleryZoom) - 0.25);
		if (galleryZoom <= 1) {
			resetGalleryTransform();
		} else {
			scheduleGalleryPanClamp();
		}
	};

	const resetGalleryZoom = () => {
		resetGalleryTransform();
	};

	const selectGalleryImage = (index) => {
		setGalleryIndex(index, { syncMainSlider: true, resetTransform: true });
	};

	const goGalleryPrev = () => {
		setGalleryIndex(galleryIndex - 1, { syncMainSlider: true, resetTransform: true });
	};

	const goGalleryNext = () => {
		setGalleryIndex(galleryIndex + 1, { syncMainSlider: true, resetTransform: true });
	};

	const handleGalleryKeydown = (event) => {
		if (!isGalleryOpen) return;
		if (event.key === 'Escape') {
			closeGallery();
			return;
		}
		if (event.key === 'ArrowLeft') {
			event.preventDefault();
			goGalleryPrev();
			return;
		}
		if (event.key === 'ArrowRight') {
			event.preventDefault();
			goGalleryNext();
			return;
		}
		if (event.key === '+' || event.key === '=') {
			event.preventDefault();
			zoomInGallery();
			return;
		}
		if (event.key === '-') {
			event.preventDefault();
			zoomOutGallery();
			return;
		}
		if (event.key === '0') {
			event.preventDefault();
			resetGalleryZoom();
		}
	};

	const clampGalleryPan = (x, y) => {
		if (!galleryViewportEl || !galleryImageEl) return { x, y };
		const viewportRect = galleryViewportEl.getBoundingClientRect();
		const imageRect = galleryImageEl.getBoundingClientRect();
		const maxX = Math.max(0, (imageRect.width - viewportRect.width) / 2);
		const maxY = Math.max(0, (imageRect.height - viewportRect.height) / 2);
		return {
			x: Math.min(maxX, Math.max(-maxX, x)),
			y: Math.min(maxY, Math.max(-maxY, y))
		};
	};

	const applyGalleryPan = (nextX, nextY) => {
		const clamped = clampGalleryPan(nextX, nextY);
		if (clamped.x !== galleryPanX) galleryPanX = clamped.x;
		if (clamped.y !== galleryPanY) galleryPanY = clamped.y;
	};

	const scheduleGalleryPanClamp = () => {
		if (typeof window === 'undefined') return;
		requestAnimationFrame(() => {
			if (!isGalleryOpen) return;
			applyGalleryPan(galleryPanX, galleryPanY);
		});
	};

	const handleGalleryPanStart = (event) => {
		if (galleryZoom <= 1) return;
		if (event.button && event.button !== 0) return;
		isGalleryPanning = true;
		galleryPanPointerId = event.pointerId ?? null;
		galleryPanStartX = event.clientX;
		galleryPanStartY = event.clientY;
		galleryPanOriginX = galleryPanX;
		galleryPanOriginY = galleryPanY;
		if (galleryViewportEl?.setPointerCapture && event.pointerId != null) {
			galleryViewportEl.setPointerCapture(event.pointerId);
		}
		event.preventDefault();
	};

	const handleGalleryPanMove = (event) => {
		if (!isGalleryPanning) return;
		if (galleryPanPointerId != null && event.pointerId !== galleryPanPointerId) return;
		const dx = event.clientX - galleryPanStartX;
		const dy = event.clientY - galleryPanStartY;
		applyGalleryPan(galleryPanOriginX + dx, galleryPanOriginY + dy);
	};

	const handleGalleryPanEnd = (event) => {
		if (!isGalleryPanning) return;
		if (galleryPanPointerId != null && event.pointerId !== galleryPanPointerId) return;
		isGalleryPanning = false;
		if (galleryViewportEl?.releasePointerCapture && galleryPanPointerId != null) {
			galleryViewportEl.releasePointerCapture(galleryPanPointerId);
		}
		galleryPanPointerId = null;
	};

	const handleGalleryTriggerKeydown = (event, index) => {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			openGallery(index);
		}
	};

	const handleGalleryWheel = (event) => {
		if (!isGalleryOpen) return;
		event.preventDefault();
		const delta = event.deltaY < 0 ? 1 / 5 : -1 / 5;
		const nextZoom = Math.min(4, Math.max(1, Number(galleryZoom) + delta));
		galleryZoom = Number(nextZoom.toFixed(2));
		if (galleryZoom <= 1) {
			resetGalleryTransform();
		} else {
			scheduleGalleryPanClamp();
		}
	};

	const preventGalleryOverlayScroll = (event) => {
		if (!isGalleryOpen) return;
		event.preventDefault();
	};

	const getDiscountPercent = (valueOrOriginal, saleValue) => {
		const isObject = valueOrOriginal && typeof valueOrOriginal === 'object';
		const originalPrice = isObject
			? Number(valueOrOriginal?.product_original_price)
			: Number(valueOrOriginal);
		const salePrice = isObject ? Number(valueOrOriginal?.product_price) : Number(saleValue);
		if (!Number.isFinite(originalPrice) || !Number.isFinite(salePrice)) return '';
		if (originalPrice <= 0 || salePrice <= 0 || salePrice >= originalPrice) return '';
		return Math.round(((originalPrice - salePrice) / originalPrice) * 100);
	};

	const getOriginalPrice = (valueOrOriginal, saleValue) => {
		const isObject = valueOrOriginal && typeof valueOrOriginal === 'object';
		const originalPrice = isObject
			? Number(valueOrOriginal?.product_original_price)
			: Number(valueOrOriginal);
		const salePrice = isObject ? Number(valueOrOriginal?.product_price) : Number(saleValue);
		if (!Number.isFinite(originalPrice) || originalPrice <= 0) return '';
		if (Number.isFinite(salePrice) && salePrice >= originalPrice) return '';
		return formatPrice(originalPrice);
	};

	const normalizeAssetIndex = (value, max, fallback = 1) => {
		const parsed = Number.parseInt(String(value || ''), 10);
		if (!Number.isFinite(parsed) || parsed < 1) return fallback;
		return ((parsed - 1) % max) + 1;
	};

	const getProductItemKey = (imageValue) => {
		const raw = String(imageValue || '').trim();
		if (!raw) return '';
		let decoded = raw;
		try {
			decoded = decodeURIComponent(raw);
		} catch {
			decoded = raw;
		}
		const itemMatch = decoded.match(/product-item(\d+)(?:-\d+)?\.(?:png|webp|avif)/i);
		if (itemMatch) {
			return `product-item${normalizeAssetIndex(itemMatch[1], fallbackThumbs.length, 1)}`;
		}
		const thumbnailMatch = decoded.match(/product-thumbnail-(\d+)(?:-\d+)?\.(?:png|webp|avif)/i);
		if (thumbnailMatch) {
			return `product-item${normalizeAssetIndex(thumbnailMatch[1], fallbackThumbs.length, 1)}`;
		}
		return '';
	};

	const getProductLargeKey = (imageValue) => {
		const raw = String(imageValue || '').trim();
		if (!raw) return '';
		let decoded = raw;
		try {
			decoded = decodeURIComponent(raw);
		} catch {
			decoded = raw;
		}
		const largeMatch = decoded.match(/product-large-(\d+)(?:-\d+)?\.(?:png|webp|avif)/i);
		if (!largeMatch) return '';
		return `product-large-${normalizeAssetIndex(largeMatch[1], fallbackGallery.length, 1)}`;
	};

	const normalizeProductImage = (imageValue) => {
		const raw = String(imageValue || '').trim();
		if (!raw) return '';
		const itemKey = getProductItemKey(raw);
		if (itemKey) {
			return `/images/optimized/${itemKey}-640.webp`;
		}
		const largeKey = getProductLargeKey(raw);
		if (largeKey) {
			return `/images/optimized/${largeKey}-1200.webp`;
		}
		return raw;
	};

	const resolveThumb = (thumb, index = 0) => {
		if (typeof thumb === 'string' && thumb.trim()) return normalizeProductImage(thumb);
		return fallbackThumbs[index % fallbackThumbs.length];
	};

	const buildGallery = (productValue) => {
		const images = [];
		const pushUnique = (src) => {
			if (!src || images.includes(src)) return;
			images.push(src);
		};

		const resolveEntry = (entry) => {
			if (!entry) return '';
			if (typeof entry === 'string') return normalizeProductImage(entry);
			if (typeof entry === 'object' && typeof entry.url === 'string') {
				return normalizeProductImage(entry.url);
			}
			return '';
		};

		const addCollection = (collection) => {
			if (!collection) return;
			if (Array.isArray(collection)) {
				collection.forEach((item) => pushUnique(resolveEntry(item)));
				return;
			}
			pushUnique(resolveEntry(collection));
		};

		addCollection(productValue?.product_thumb);
		addCollection(productValue?.product_gallery);
		addCollection(productValue?.product_attributes?.gallery);

		if (!images.length) {
			fallbackGallery.forEach((src) => pushUnique(src));
		}

		return images.length ? images : fallbackGallery;
	};

	const normalizeOption = (value) => String(value || '').trim();
	const normalizePrice = (value) => {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	};

	const parseVariationData = (productValue) => {
		const variations = Array.isArray(productValue?.product_variations)
			? productValue.product_variations
			: [];
		const colors = new Set();
		const sizes = new Set();
		const comboOverrides = [];
		const colorOverrides = new Map();
		const sizeOverrides = new Map();

		variations.forEach((item) => {
			if (typeof item === 'string' || typeof item === 'number') {
				const sizeValue = normalizeOption(item);
				if (sizeValue) sizes.add(sizeValue);
				return;
			}
			if (!item || typeof item !== 'object') return;
			const color = normalizeOption(item.color || item.colour);
			const size = normalizeOption(item.size ?? item.label ?? item.name ?? item.sku ?? item.value);
			const price = normalizePrice(item.price);
			const originalPrice = normalizePrice(item.original_price ?? item.originalPrice);

			if (color && size) {
				colors.add(color);
				sizes.add(size);
				comboOverrides.push({ color, size, price, originalPrice });
			} else if (color) {
				colors.add(color);
				if (price !== undefined || originalPrice !== undefined) {
					colorOverrides.set(color, { price, originalPrice });
				}
			} else if (size) {
				sizes.add(size);
				if (price !== undefined || originalPrice !== undefined) {
					sizeOverrides.set(size, { price, originalPrice });
				}
			}
		});

		const attrColors = productValue?.product_attributes?.colors;
		if (Array.isArray(attrColors)) {
			attrColors.forEach((value) => {
				const color = normalizeOption(value);
				if (color) colors.add(color);
			});
		}
		const primaryColor = normalizeOption(productValue?.product_attributes?.color);
		if (primaryColor) colors.add(primaryColor);

		return {
			colors: Array.from(colors),
			sizes: Array.from(sizes),
			comboOverrides,
			colorOverrides,
			sizeOverrides
		};
	};

	const resolvePricing = (productValue, variationData, selectedColorValue, selectedSizeValue) => {
		const basePrice = Number(productValue?.product_price);
		const baseOriginal = Number(productValue?.product_original_price);
		const safeBasePrice = Number.isFinite(basePrice) ? basePrice : 0;
		const safeBaseOriginal = Number.isFinite(baseOriginal) ? baseOriginal : undefined;
		const comboMatch =
			selectedColorValue && selectedSizeValue
				? variationData.comboOverrides.find(
						(item) => item.color === selectedColorValue && item.size === selectedSizeValue
					)
				: null;
		const colorOverride = selectedColorValue
			? variationData.colorOverrides.get(selectedColorValue)
			: null;
		const sizeOverride = selectedSizeValue
			? variationData.sizeOverrides.get(selectedSizeValue)
			: null;

		const resolveField = (field, baseValue) => {
			if (comboMatch && comboMatch[field] !== undefined) return comboMatch[field];
			if (colorOverride && colorOverride[field] !== undefined) return colorOverride[field];
			if (sizeOverride && sizeOverride[field] !== undefined) return sizeOverride[field];
			return baseValue;
		};

		const price = resolveField('price', safeBasePrice);
		const originalPrice = resolveField('originalPrice', safeBaseOriginal);

		return {
			price,
			originalPrice,
			formattedPrice: formatPrice(price),
			formattedOriginal: originalPrice ? getOriginalPrice(originalPrice, price) : '',
			discountPercent: getDiscountPercent(originalPrice, price)
		};
	};

	let product = $derived(data?.product ?? null);
	let apiError = $derived(data?.apiError ?? '');
	let canonicalUrl = $derived(data?.canonicalUrl ?? '');
	let priceValidUntil = $derived(String(data?.priceValidUntil || '').trim());
	let showDiscountBadge = $derived(Boolean(data?.siteFeatures?.showDiscountBadge));
	let reviewMeta = $derived(form?.reviewMeta ?? data?.reviewMeta ?? null);
	let reviewSourceProduct = $derived(form?.reviewProduct ?? product ?? null);
	let reviewSuccessMessage = $derived(
		form?.reviewSuccess ? String(form?.reviewMessage || '').trim() : ''
	);
	let reviewErrorMessage = $derived(String(form?.reviewError || '').trim());
	let currentUserReview = $derived(reviewMeta?.review ?? null);
	let currentUserReviewImages = $derived(
		normalizeReviewImageItems(currentUserReview?.images ?? currentUserReview?.review_images)
	);
	let currentUserReviewStatus = $derived(
		String(currentUserReview?.status || '').trim() || 'approved'
	);
	let canSubmitReview = $derived(Boolean(reviewMeta?.canReview));
	let hasSubmittedReview = $derived(Boolean(reviewMeta?.hasReviewed));
	let reviewExistingStatusHint = $derived.by(() => {
		if (!hasSubmittedReview) return '';
		if (currentUserReviewStatus === 'pending') return $t('product.reviewPendingStatus');
		if (currentUserReviewStatus === 'rejected') return $t('product.reviewRejectedStatus');
		return $t('product.reviewExistingHint');
	});
	let reviewAuthorName = $derived(String(data?.user?.name || '').trim());
	let reviewAuthorEmail = $derived(String(data?.user?.email || '').trim());
	let reviewFormValues = $derived.by(() => {
		const draft = form?.reviewValues ?? {};
		return {
			rating: Number(draft?.rating ?? currentUserReview?.rating ?? 0) || 0,
			title: String(draft?.title ?? currentUserReview?.title ?? '').trim(),
			content: String(draft?.content ?? currentUserReview?.content ?? '').trim()
		};
	});
	let reviewSubmitLabel = $derived(
		hasSubmittedReview ? $t('product.reviewUpdateSubmit') : $t('product.reviewSubmit')
	);
	let realReviewItems = $derived.by(() =>
		normalizeReviewItems(
			reviewSourceProduct?.product_reviews ??
				reviewSourceProduct?.reviews ??
				reviewSourceProduct?.productReviews ??
				[],
			$locale
		)
	);
	let staticReviewItems = $derived.by(() =>
		buildStaticReviewsForProduct(reviewSourceProduct, $locale, 5)
	);
	let reviewItems = $derived(realReviewItems.length ? realReviewItems : staticReviewItems);
	let detailedReviewCount = $derived(reviewItems.length);
	let detailedReviewAverage = $derived.by(() => calculateAverageRating(reviewItems));
	let stockQuantity = $derived.by(() => {
		const value = Number(product?.inventory_stock ?? product?.product_quantity ?? 0);
		return Number.isFinite(value) ? value : 0;
	});
	let ratingAverage = $derived.by(() => {
		const value = Number(reviewSourceProduct?.product_ratingsAverage);
		if (Number.isFinite(value) && value > 0) return clampRating(value);
		return detailedReviewAverage;
	});
	let ratingCount = $derived.by(() => {
		const value = Number(reviewSourceProduct?.product_ratingsCount);
		if (Number.isFinite(value) && value > 0) return Math.floor(value);
		return detailedReviewCount;
	});
	let hasRating = $derived(ratingAverage > 0 && ratingCount > 0);
	let formattedRatingAverage = $derived.by(() =>
		formatDecimal(ratingAverage, $locale === 'en' ? 'en-US' : 'vi-VN')
	);
	let ratingStars = $derived(buildRatingStars(hasRating ? ratingAverage : 0));
	let ratingSatisfactionPercent = $derived(
		hasRating ? Math.max(0, Math.min(100, Math.round((ratingAverage / 5) * 100))) : 0
	);
	let relatedProducts = $derived(
		(data?.relatedProducts ?? [])
			.filter((item) => item?._id && item._id !== product?._id)
			.slice(0, 8)
	);
	let galleryImages = $derived(buildGallery(product));
	let activeGalleryImage = $derived(galleryImages[galleryIndex] || '');
	let variationData = $derived(parseVariationData(product));
	let sizeOptions = $derived(variationData.sizes);
	let colorOptions = $derived(variationData.colors);
	let hasVariantOptions = $derived(sizeOptions.length > 0 || colorOptions.length > 0);
	let initialActionRequestSeed = $derived(String(data?.actionRequestSeed || '').trim());
	let initialAddToCartRequestId = $derived(
		initialActionRequestSeed ? `add-${initialActionRequestSeed}` : ''
	);
	let initialBuyNowRequestId = $derived(
		initialActionRequestSeed ? `buy-${initialActionRequestSeed}` : ''
	);
	let selectedSize = $state('');
	let selectedColor = $state('');
	let selectedQuantity = $state(1);
	let addToCartRequestId = $state('');
	let buyNowRequestId = $state('');
	let shouldReloadBeforeCartAction = $state(false);
	let activeTab = $state('description');
	let pricing = $derived(resolvePricing(product, variationData, selectedColor, selectedSize));
	let variantSelectionValid = $derived(
		(!sizeOptions.length || Boolean(selectedSize)) &&
			(!colorOptions.length || Boolean(selectedColor))
	);
	let seoTitle = $derived(
		product?.product_name
			? `${product.product_name} | Inoxpran`
			: `${$t('product.titleFallback')} | Inoxpran`
	);
	let seoDescription = $derived.by(() => {
		const rawDescription = stripHtml(product?.product_description || '');
		if (!rawDescription) return $t('product.descriptionEmpty');
		return rawDescription.length > 160
			? `${rawDescription.slice(0, 157).trim()}...`
			: rawDescription;
	});
	let seoImage = $derived(toAbsoluteUrl(resolveThumb(product?.product_thumb, 0)));
	let productCategoryLabel = $derived(getProductTypeLabel(product?.product_type, $locale));
	let productCategorySlug = $derived.by(() => {
		const rawCategory = String(product?.product_type || '').trim();
		return rawCategory ? resolveCategorySlug(rawCategory) : '';
	});
	let productsListingUrl = $derived(`${siteUrl}${localizeInternalHref('/shop', $locale)}`);
	let productCategoryUrl = $derived.by(() => {
		if (!productCategorySlug) return '';
		return `${siteUrl}${localizeInternalHref(`/category/${encodeURIComponent(productCategorySlug)}`, $locale)}`;
	});
	let productCanonicalUrl = $derived.by(() => {
		const rawCanonical = String(canonicalUrl || '').trim();
		if (rawCanonical) return rawCanonical;
		const slug = String(product?.product_slug || product?.slug || product?._id || '').trim();
		if (!slug) return productsListingUrl;
		return `${siteUrl}${localizeInternalHref(`/product/${encodeURIComponent(slug)}`, $locale)}`;
	});
	let productBreadcrumbId = $derived(`${productCanonicalUrl}#breadcrumb`);
	let productSchemaImages = $derived.by(() => {
		const absoluteGalleryImages = (galleryImages || [])
			.map((image) => toAbsoluteUrl(image))
			.filter(Boolean);
		if (absoluteGalleryImages.length) {
			return Array.from(new Set(absoluteGalleryImages));
		}
		return seoImage ? [seoImage] : [];
	});
	let productBreadcrumbJsonLd = $derived.by(() => {
		if (!product?.product_name) return '';
		const itemListElement = [
			{
				'@type': 'ListItem',
				position: 1,
				name: $t('common.home'),
				item: `${siteUrl}${localizeInternalHref('/', $locale)}`
			},
			{
				'@type': 'ListItem',
				position: 2,
				name: $t('nav.products'),
				item: productsListingUrl
			}
		];

		if (productCategoryLabel && productCategoryUrl) {
			itemListElement.push({
				'@type': 'ListItem',
				position: itemListElement.length + 1,
				name: productCategoryLabel,
				item: productCategoryUrl
			});
		}

		itemListElement.push({
			'@type': 'ListItem',
			position: itemListElement.length + 1,
			name: product.product_name,
			item: productCanonicalUrl
		});

		return JSON.stringify({
			'@context': 'https://schema.org',
			'@type': 'BreadcrumbList',
			'@id': productBreadcrumbId,
			itemListElement
		});
	});
	let productFaqItems = $derived.by(() => {
		const name = product?.product_name || ($locale === 'en' ? 'this product' : 'sản phẩm này');
		return $locale === 'en'
			? [
					{
						question: `Is ${name} suitable for daily family cooking?`,
						answer:
							'Yes. Inoxpran products are positioned for everyday kitchen use with COD confirmation, support advice, and warranty-backed after-sales service.'
					},
					{
						question: 'How does delivery and COD confirmation work?',
						answer:
							'You can place an order online. Inoxpran confirms by phone or Zalo, then ships nationwide with COD where available.'
					},
					{
						question: 'What warranty support is included?',
						answer:
							'Inoxpran highlights 12-month warranty support for eligible products and handles defect or transit claims through the customer support team.'
					}
				]
			: [
					{
						question: `${name} có phù hợp nấu ăn hằng ngày không?`,
						answer:
							'Có. Inoxpran định vị sản phẩm cho căn bếp gia đình, có xác nhận COD, tư vấn sử dụng và hỗ trợ sau bán hàng.'
					},
					{
						question: 'Giao hàng và xác nhận COD diễn ra như thế nào?',
						answer:
							'Bạn có thể đặt hàng trực tuyến. Inoxpran xác nhận qua điện thoại hoặc Zalo, sau đó giao hàng toàn quốc và hỗ trợ COD tại khu vực phù hợp.'
					},
					{
						question: 'Chính sách bảo hành gồm những gì?',
						answer:
							'Inoxpran nhấn mạnh hỗ trợ Bảo hành 12 tháng cho sản phẩm đủ điều kiện và tiếp nhận lỗi sản xuất hoặc sự cố vận chuyển qua đội CSKH.'
					}
				];
	});
	let productFaqJsonLd = $derived.by(() => {
		if (!product?.product_name || !productFaqItems.length) return '';
		return JSON.stringify({
			'@context': 'https://schema.org',
			'@type': 'FAQPage',
			'@id': `${productCanonicalUrl}#faq`,
			mainEntity: productFaqItems.map((item) => ({
				'@type': 'Question',
				name: item.question,
				acceptedAnswer: {
					'@type': 'Answer',
					text: item.answer
				}
			}))
		});
	});
	let productJsonLd = $derived.by(() => {
		if (!product?.product_name) return '';

		const priceValue = Number(pricing?.price ?? product?.product_price);
		const ratingAverageValue = clampRating(ratingAverage);
		const ratingCountValue = Math.max(0, Math.floor(Number(ratingCount) || 0));
		const quantityValue = stockQuantity;
		const skuValue = resolveStructuredSku(product);
		const mpnValue = normalizeStructuredIdentifier(product?.product_attributes?.model);
		const categoryValue = productCategoryLabel;
		const colorValue = String(product?.product_attributes?.color || '').trim();
		const descriptionValue = stripHtml(product?.product_description || '');
		const productWeightValue = Number(product?.product_weight);
		const shippingDetailsJsonLd = buildOfferShippingDetailsJsonLd({
			offerId: `${productCanonicalUrl}#offer`,
			weightGram: productWeightValue
		});
		const reviewSchemaItems = reviewItems
			.slice(0, 5)
			.map((review) => {
				const authorName = String(review?.author || '').trim();
				const reviewBody = truncateAtWordBoundary(String(review?.content || '').trim(), 800);
				const reviewTitle = String(review?.title || '').trim();
				const reviewDate = String(review?.rawDate || '').trim();
				const reviewRating = clampRating(review?.rating);
				if (!authorName || reviewRating <= 0) return null;
				return {
					'@type': 'Review',
					author: {
						'@type': 'Person',
						name: authorName
					},
					reviewRating: {
						'@type': 'Rating',
						ratingValue: reviewRating,
						bestRating: 5,
						worstRating: 1
					},
					...(reviewBody ? { reviewBody } : {}),
					...(reviewTitle ? { name: reviewTitle } : {}),
					...(reviewDate ? { datePublished: reviewDate } : {})
				};
			})
			.filter(Boolean);
		const schemaData = {
			'@context': 'https://schema.org',
			'@type': 'Product',
			'@id': `${productCanonicalUrl}#product`,
			name: product.product_name,
			url: productCanonicalUrl,
			mainEntityOfPage: productCanonicalUrl,
			breadcrumb: {
				'@id': productBreadcrumbId
			},
			brand: {
				'@type': 'Brand',
				name: 'Inoxpran'
			},
			offers: {
				'@type': 'Offer',
				'@id': `${productCanonicalUrl}#offer`,
				url: productCanonicalUrl,
				priceCurrency: 'VND',
				availability:
					quantityValue > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
				itemCondition: 'https://schema.org/NewCondition',
				seller: {
					'@id': `${siteUrl}/#organization`
				},
				shippingDetails: shippingDetailsJsonLd,
				hasMerchantReturnPolicy: buildMerchantReturnPolicyJsonLd($locale)
			}
		};

		if (productSchemaImages.length === 1) {
			schemaData.image = productSchemaImages[0];
		} else if (productSchemaImages.length > 1) {
			schemaData.image = productSchemaImages;
		}

		if (descriptionValue) {
			schemaData.description = descriptionValue;
		}

		if (skuValue) {
			schemaData.sku = skuValue;
		}

		if (mpnValue) {
			schemaData.mpn = mpnValue;
		}

		if (categoryValue) {
			schemaData.category = categoryValue;
		}

		if (colorValue) {
			schemaData.color = colorValue;
		}

		if (product?.product_weight) {
			schemaData.weight = {
				'@type': 'QuantitativeValue',
				value: Number(product.product_weight),
				unitCode: 'GRM'
			};
		}

		if (
			Number.isFinite(ratingAverageValue) &&
			ratingAverageValue > 0 &&
			Number.isFinite(ratingCountValue) &&
			ratingCountValue > 0
		) {
			schemaData.aggregateRating = {
				'@type': 'AggregateRating',
				ratingValue: Math.round(ratingAverageValue * 10) / 10,
				reviewCount: Math.floor(ratingCountValue),
				ratingCount: Math.floor(ratingCountValue),
				bestRating: 5,
				worstRating: 1
			};
		}

		if (reviewSchemaItems.length) {
			schemaData.review = reviewSchemaItems;
		}

		if (Number.isFinite(priceValue) && priceValue > 0) {
			schemaData.offers.price = priceValue.toString();
			if (priceValidUntil) {
				schemaData.offers.priceValidUntil = priceValidUntil;
			}
		}

		return JSON.stringify(schemaData);
	});

	$effect(() => {
		if (!sizeOptions.length) {
			selectedSize = '';
			return;
		}
		if (selectedSize && !sizeOptions.includes(selectedSize)) {
			selectedSize = '';
		}
	});

	$effect(() => {
		if (!colorOptions.length) {
			selectedColor = '';
			return;
		}
		if (selectedColor && !colorOptions.includes(selectedColor)) {
			selectedColor = '';
		}
	});

	const shortRelatedDescription = (productValue) => {
		const plain = stripHtml(productValue?.product_description || '');
		if (!plain) return '';
		const limit = isMobile ? 520 : 900;
		return truncateAtWordBoundary(plain, limit);
	};

	const getProductHref = (productValue) => {
		const slug = productValue?.product_slug || productValue?.slug || productValue?._id;
		return slug
			? localizeInternalHref(`/product/${slug}`, $locale)
			: localizeInternalHref('/shop', $locale);
	};

	const toGuestCartProduct = (productValue, quantity = 1) => ({
		productId: productValue?._id,
		name: productValue?.product_name,
		price: Number(pricing?.price ?? productValue?.product_price) || 0,
		originalPrice: Number(pricing?.originalPrice ?? productValue?.product_original_price) || 0,
		quantity,
		image: resolveThumb(productValue?.product_thumb, 0),
		href: getProductHref(productValue),
		weight: Number(productValue?.product_weight) || 1000,
		shopId: productValue?.product_shop || productValue?.shopId || '',
		variantColor: selectedColor,
		variantSize: selectedSize
	});

	const productCardImageSizes = '(max-width: 576px) 50vw, (max-width: 992px) 33vw, 25vw';
	const productGalleryImageSizes = '(max-width: 768px) 92vw, 540px';
	const getProductCardAvifSrcSet = (imageValue) => {
		const key = getProductItemKey(imageValue);
		if (!key) return '';
		return `/images/optimized/${key}-320.avif 320w, /images/optimized/${key}-640.avif 640w`;
	};

	const getProductCardWebpSrcSet = (imageValue) => {
		const key = getProductItemKey(imageValue);
		if (!key) return '';
		return `/images/optimized/${key}-320.webp 320w, /images/optimized/${key}-640.webp 640w`;
	};

	const getProductGalleryAvifSrcSet = (imageValue) => {
		const key = getProductLargeKey(imageValue);
		if (key) {
			return `/images/optimized/${key}-640.avif 640w, /images/optimized/${key}-1200.avif 1200w`;
		}
		return getProductCardAvifSrcSet(imageValue);
	};

	const getProductGalleryWebpSrcSet = (imageValue) => {
		const key = getProductLargeKey(imageValue);
		if (key) {
			return `/images/optimized/${key}-640.webp 640w, /images/optimized/${key}-1200.webp 1200w`;
		}
		return getProductCardWebpSrcSet(imageValue);
	};

	const getFirstSrcFromSrcSet = (srcsetValue) => {
		const firstEntry = String(srcsetValue || '')
			.split(',')
			.map((part) => part.trim())
			.filter(Boolean)[0];
		if (!firstEntry) return '';
		return firstEntry.split(' ')[0] || '';
	};

	let lcpGalleryImage = $derived(galleryImages[0] || '');
	let lcpGalleryAvifSrcSet = $derived(getProductGalleryAvifSrcSet(lcpGalleryImage));
	let lcpGalleryWebpSrcSet = $derived(getProductGalleryWebpSrcSet(lcpGalleryImage));
	let lcpGalleryAvifHref = $derived(getFirstSrcFromSrcSet(lcpGalleryAvifSrcSet));
	let lcpGalleryWebpHref = $derived(getFirstSrcFromSrcSet(lcpGalleryWebpSrcSet));

	$effect(() => {
		if (typeof document === 'undefined') return;
		const html = document.documentElement;
		const { body } = document;
		if (!html || !body) return;
		if (!isGalleryOpen) return;

		const scrollY = window.scrollY || window.pageYOffset || 0;
		const previous = {
			htmlOverflow: html.style.overflow,
			htmlOverscroll: html.style.overscrollBehavior,
			bodyOverflow: body.style.overflow,
			bodyPosition: body.style.position,
			bodyTop: body.style.top,
			bodyLeft: body.style.left,
			bodyRight: body.style.right,
			bodyWidth: body.style.width
		};

		html.classList.add('gallery-zoom-open');
		body.classList.add('gallery-zoom-open');
		html.style.overflow = 'hidden';
		html.style.overscrollBehavior = 'none';
		body.style.overflow = 'hidden';
		body.style.position = 'fixed';
		body.style.top = `-${scrollY}px`;
		body.style.left = '0';
		body.style.right = '0';
		body.style.width = '100%';

		return () => {
			html.classList.remove('gallery-zoom-open');
			body.classList.remove('gallery-zoom-open');
			html.style.overflow = previous.htmlOverflow;
			html.style.overscrollBehavior = previous.htmlOverscroll;
			body.style.overflow = previous.bodyOverflow;
			body.style.position = previous.bodyPosition;
			body.style.top = previous.bodyTop;
			body.style.left = previous.bodyLeft;
			body.style.right = previous.bodyRight;
			body.style.width = previous.bodyWidth;
			window.scrollTo({ top: scrollY, left: 0, behavior: 'auto' });
		};
	});

	const hideTooltips = () => {
		if (typeof window === 'undefined' || !window.bootstrap?.Tooltip) return;
		document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach((el) => {
			const instance = window.bootstrap.Tooltip.getInstance(el);
			instance?.hide();
		});
	};

	const resolveLoginRedirectHref = () => {
		if (typeof window === 'undefined') return '/login';
		const pathname = window.location.pathname || '/';
		const search = window.location.search || '';
		const hash = window.location.hash || '';
		const redirectTarget = `${pathname}${search}${hash}`;
		return `/login?${new URLSearchParams({ redirect: redirectTarget }).toString()}`;
	};

	const redirectToLogin = () => {
		hideTooltips();
		const loginHref = resolveLoginRedirectHref();
		if (typeof window === 'undefined') {
			void goto(loginHref);
			return;
		}
		window.location.assign(loginHref);
	};

	const initTooltips = () => {
		if (typeof window === 'undefined' || !window.bootstrap?.Tooltip) return;
		document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach((el) => {
			const existing = window.bootstrap.Tooltip.getInstance(el);
			if (existing) existing.dispose();
			const trigger = el.getAttribute('data-bs-trigger') || 'hover';
			// eslint-disable-next-line no-new
			new window.bootstrap.Tooltip(el, { trigger });
		});
	};

	const pulseRelatedAdded = (productId) => {
		relatedAddedId = productId;
		setTimeout(() => {
			if (relatedAddedId === productId) relatedAddedId = null;
		}, 900);
	};

	const isRelatedAddLocked = (id) => {
		if (!id) return false;
		return relatedLockedAddIds.has(String(id));
	};

	const lockRelatedAddId = (id) => {
		if (!id) return;
		const next = new Set(relatedLockedAddIds);
		next.add(String(id));
		relatedLockedAddIds = next;
	};

	const unlockRelatedAddId = (id) => {
		if (!id) return;
		const next = new Set(relatedLockedAddIds);
		next.delete(String(id));
		relatedLockedAddIds = next;
	};

	const createRelatedAddToCartEnhance = (productValue) => {
		return ({ form, cancel }) => {
			cartToast.hide();
			if (!ensureFreshPageForCartAction()) {
				cancel();
				return;
			}

			const productId = productValue?._id;
			if (!productId) {
				cancel();
				return;
			}

			if (!isAuthenticated) {
				cancel();
				addGuestCartItem(
					{
						productId,
						name: productValue?.product_name,
						price: Number(productValue?.product_price) || 0,
						originalPrice: Number(productValue?.product_original_price) || 0,
						image: resolveThumb(productValue?.product_thumb, 0),
						href: getProductHref(productValue),
						weight: Number(productValue?.product_weight) || 1000,
						shopId: productValue?.product_shop || productValue?.shopId || ''
					},
					1
				);
				lockRelatedAddId(productId);
				setTimeout(() => unlockRelatedAddId(productId), 2200);
				setTimeout(() => pulseRelatedAdded(productId), 120);
				cartToast.show($t('cart.addedNotice', { count: 1 }), 'success', 2200);
				const card = form?.closest('.product-card') || form?.closest('.card');
				const img = card?.querySelector('img');
				if (img) {
					flyToCart(img, {
						xOffset: FLY_TO_CART_X_OFFSET,
						yOffset: FLY_TO_CART_Y_OFFSET
					});
				}
				return;
			}

			if (relatedAddingId || isRelatedAddLocked(productId)) {
				cancel();
				return;
			}

			relatedAddingId = productId;
			const card = form?.closest('.product-card') || form?.closest('.card');
			const img = card?.querySelector('img');

			return async ({ result }) => {
				relatedAddingId = null;

				if (result?.type === 'success') {
					lockRelatedAddId(productId);
					setTimeout(() => unlockRelatedAddId(productId), 2200);
					setTimeout(() => pulseRelatedAdded(productId), 120);
					cartToast.show($t('cart.addedNotice', { count: 1 }), 'success', 2200);
					if (img) {
						flyToCart(img, {
							xOffset: FLY_TO_CART_X_OFFSET,
							yOffset: FLY_TO_CART_Y_OFFSET
						});
					}
					await syncCartCountFromActionResult(result);
					return;
				}

				if (result?.type === 'failure') {
					if (result.status === 401) {
						redirectToLogin();
						return;
					}
					cartToast.show(result.data?.error ?? $t('cart.errors.addFailed'), 'danger', 2800);
					return;
				}

				cartToast.show($t('cart.errors.addFailed'), 'danger', 2800);
			};
		};
	};

	const getMissingVariantFields = () => {
		const missing = [];
		if (sizeOptions.length && !selectedSize) missing.push($t('product.size'));
		if (colorOptions.length && !selectedColor) missing.push($t('product.color'));
		return missing;
	};

	const describeVariantFields = (fields) => {
		if (!fields.length) return '';
		if (fields.length === 1) return fields[0];
		const conjunction = $locale === 'en' ? ' and ' : ' và ';
		if (fields.length === 2) {
			return `${fields[0]}${conjunction}${fields[1]}`;
		}
		const prefix = fields.slice(0, -1).join(', ');
		return `${prefix}${conjunction}${fields[fields.length - 1]}`;
	};

	const createActionRequestId = () => {
		if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
			return crypto.randomUUID();
		}
		return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
	};

	const normalizeQuantity = (value) => {
		const parsed = Number(value);
		if (!Number.isFinite(parsed)) return 1;
		return Math.max(1, Math.floor(parsed));
	};

	const adjustQuantity = (delta) => {
		if (hasVariantOptions && !variantSelectionValid) {
			ensureVariantSelection();
			return;
		}
		selectedQuantity = normalizeQuantity(selectedQuantity + delta);
	};

	const handleQuantityInput = () => {
		if (hasVariantOptions && !variantSelectionValid) {
			selectedQuantity = 1;
			return;
		}
		selectedQuantity = normalizeQuantity(selectedQuantity);
	};

	const ensureVariantSelection = (event) => {
		const missing = getMissingVariantFields();
		if (!missing.length) return true;
		if (event && typeof event.preventDefault === 'function') {
			event.preventDefault();
		}
		cartToast.show(
			$t('product.errors.variantSelectionRequired', {
				fields: describeVariantFields(missing)
			}),
			'warning',
			3200
		);
		return false;
	};

	const ensureFreshPageForCartAction = (event) => {
		if (!shouldReloadBeforeCartAction) return true;
		if (event && typeof event.preventDefault === 'function') {
			event.preventDefault();
		}
		cartToast.show(
			$locale === 'en'
				? 'Please reload this page before continuing checkout actions.'
				: 'Vui lòng tải lại trang trước khi thực hiện thao tác mua hàng.',
			'warning',
			3600
		);
		return false;
	};

	const handleAddToCartEnhance = ({ formData, cancel }) => {
		if (!ensureFreshPageForCartAction()) {
			cancel();
			return;
		}
		if (!ensureVariantSelection()) {
			cancel();
			return;
		}
		if (isAddingToCart) {
			cancel();
			return;
		}
		cartToast.hide();
		const submittedQuantity = normalizeQuantity(selectedQuantity);
		if (!isAuthenticated) {
			cancel();
			addGuestCartItem(toGuestCartProduct(product, submittedQuantity), submittedQuantity);
			cartToast.show($t('cart.addedNotice', { count: submittedQuantity }), 'success');
			selectedSize = '';
			selectedColor = '';
			selectedQuantity = 1;
			return;
		}
		isAddingToCart = true;
		formData?.set?.('quantity', String(submittedQuantity));
		if (!addToCartRequestId) {
			addToCartRequestId = initialAddToCartRequestId || createActionRequestId();
		}
		formData?.set?.('clientRequestId', addToCartRequestId);
		return async ({ result }) => {
			isAddingToCart = false;
			addToCartRequestId = createActionRequestId();
			if (result?.type === 'success') {
				cartToast.show($t('cart.addedNotice', { count: submittedQuantity }), 'success');
				await syncCartCountFromActionResult(result);
				selectedSize = '';
				selectedColor = '';
				selectedQuantity = 1;
				return;
			}

			if (result?.type === 'failure') {
				if (result.status === 401) {
					redirectToLogin();
					return;
				}
				cartToast.show(result.data?.error ?? $t('cart.errors.addFailed'), 'danger');
				return;
			}

			cartToast.show($t('cart.errors.addFailed'), 'danger');
		};
	};

	const handleBuyNowEnhance = ({ formData, cancel }) => {
		if (!ensureFreshPageForCartAction()) {
			cancel();
			return;
		}
		if (!ensureVariantSelection()) {
			cancel();
			return;
		}
		cartToast.hide();
		const submittedQuantity = normalizeQuantity(selectedQuantity);
		if (!isAuthenticated) {
			cancel();
			addGuestCartItem(toGuestCartProduct(product, submittedQuantity), submittedQuantity);
			cartToast.show($t('cart.addedNotice', { count: submittedQuantity }), 'success');
			goto(localizeInternalHref('/checkout?guest=1', $locale));
			return;
		}
		formData?.set?.('quantity', String(submittedQuantity));
		if (!buyNowRequestId) {
			buyNowRequestId = initialBuyNowRequestId || createActionRequestId();
		}
		formData?.set?.('clientRequestId', buyNowRequestId);
		return async ({ result }) => {
			buyNowRequestId = createActionRequestId();
			if (result?.type === 'redirect') {
				goto(result.location);
				return;
			}

			if (result?.type === 'failure') {
				if (result.status === 401) {
					redirectToLogin();
					return;
				}
				cartToast.show(result.data?.error ?? $t('cart.errors.addFailed'), 'danger');
			}
		};
	};

	const syncReviewImageInputFiles = () => {
		if (typeof DataTransfer === 'undefined' || !reviewImageInputEl) return;
		const dt = new DataTransfer();
		reviewSelectedImages.forEach((item) => {
			if (item?.file) dt.items.add(item.file);
		});
		reviewImageInputEl.files = dt.files;
	};

	const clearReviewSelectedImages = () => {
		revokeReviewImagePreviews(reviewSelectedImages);
		reviewSelectedImages = [];
		if (reviewImageInputEl) {
			reviewImageInputEl.value = '';
		}
	};

	const validateReviewImageFiles = (files = []) => {
		if (files.length > MAX_REVIEW_IMAGES) {
			return $t('product.reviewImagesTooMany', { count: MAX_REVIEW_IMAGES });
		}
		for (const file of files) {
			if (!String(file?.type || '').startsWith('image/')) {
				return $t('product.reviewImagesInvalid');
			}
			if (Number(file?.size) > MAX_REVIEW_IMAGE_BYTES) {
				return $t('product.reviewImagesTooLarge');
			}
		}
		return '';
	};

	const handleReviewImagesChange = (event) => {
		const incoming = Array.from(event.currentTarget?.files || []);
		const combinedFiles = [...reviewSelectedImages.map((item) => item.file), ...incoming];
		const dedupedFiles = [];
		const seen = new Set();

		for (const file of combinedFiles) {
			const key = `${file.name}:${file.size}:${file.lastModified}`;
			if (seen.has(key)) continue;
			seen.add(key);
			dedupedFiles.push(file);
		}

		const totalImageCount = retainedReviewImages.length + dedupedFiles.length;
		const validationError = validateReviewImageFiles(dedupedFiles);
		if (validationError || totalImageCount > MAX_REVIEW_IMAGES) {
			cartToast.show(
				validationError || $t('product.reviewImagesTooMany', { count: MAX_REVIEW_IMAGES }),
				'danger',
				2800
			);
			syncReviewImageInputFiles();
			return;
		}

		revokeReviewImagePreviews(reviewSelectedImages);
		reviewSelectedImages = buildReviewPreviewItems(dedupedFiles);
		syncReviewImageInputFiles();
	};

	const removeReviewSelectedImage = (index) => {
		const item = reviewSelectedImages[index];
		revokeReviewImagePreviews(item ? [item] : []);
		reviewSelectedImages = reviewSelectedImages.filter((_, currentIndex) => currentIndex !== index);
		syncReviewImageInputFiles();
	};

	const removeRetainedReviewImage = (index) => {
		retainedReviewImages = retainedReviewImages.filter((_, currentIndex) => currentIndex !== index);
	};

	const handleReviewEnhance = ({ cancel }) => {
		if (!isAuthenticated) {
			cancel();
			redirectToLogin();
			return;
		}
		isSubmittingReview = true;
		activeTab = 'reviews';
		return async ({ result, update }) => {
			isSubmittingReview = false;

			if (result?.type === 'redirect') {
				goto(result.location);
				return;
			}

			if (result?.type === 'success' || result?.type === 'failure') {
				if (result.type === 'failure' && result.status === 401) {
					redirectToLogin();
					return;
				}
				await update({ reset: result.type === 'success' });
				if (result.type === 'success') {
					clearReviewSelectedImages();
				}
				openReviewsTab();
				return;
			}

			cartToast.show($t('product.reviewSubmitFailed'), 'danger', 2800);
		};
	};

	$effect(() => {
		const syncKey = [
			String(currentUserReview?.id || ''),
			currentUserReviewImages.map((item) => item.path || item.url).join('|')
		].join(':');
		if (syncKey === reviewImageSyncKey) return;
		reviewImageSyncKey = syncKey;
		retainedReviewImages = currentUserReviewImages.map((item) => ({ ...item }));
		clearReviewSelectedImages();
	});

	const getHeaderOffset = () => {
		if (typeof window === 'undefined') return 0;
		const rootStyles = window.getComputedStyle(document.documentElement);
		const cssHeaderHeight = Number.parseFloat(rootStyles.getPropertyValue('--site-header-height'));
		if (Number.isFinite(cssHeaderHeight) && cssHeaderHeight > 0) {
			return cssHeaderHeight;
		}
		const headerElement = document.querySelector('.site-header');
		const headerHeight = headerElement ? headerElement.getBoundingClientRect().height : 0;
		return Number.isFinite(headerHeight) ? headerHeight : 0;
	};

	const scrollToElementWithHeaderOffset = (element, behavior = 'smooth') => {
		if (typeof window === 'undefined' || !element) return;
		const headerOffset = getHeaderOffset() + 18;
		const currentY = window.scrollY;
		const nextY = Math.max(0, currentY + element.getBoundingClientRect().top - headerOffset);
		window.scrollTo({ top: nextY, left: 0, behavior });
	};

	const setProductTab = (tab, { scroll = false, updateHash = false } = {}) => {
		activeTab = tab;
		if (typeof window === 'undefined') return;

		if (updateHash) {
			const baseUrl = `${window.location.pathname}${window.location.search}`;
			const nextUrl = tab === 'reviews' ? `${baseUrl}#product-reviews` : baseUrl;
			window.history.replaceState(window.history.state, '', nextUrl);
		}

		if (scroll && tab === 'reviews') {
			requestAnimationFrame(() => {
				scrollToElementWithHeaderOffset(
					reviewsSectionEl || document.getElementById('product-reviews'),
					'smooth'
				);
			});
		}
	};

	const openReviewsTab = () => {
		setProductTab('reviews', { scroll: true, updateHash: true });
	};

	const scrollToMainGallery = () => {
		if (typeof window === 'undefined') return;
		const targetElement = mainGalleryEl || document.querySelector('.product-main .main-gallery');
		if (!targetElement) {
			window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
			return;
		}
		scrollToElementWithHeaderOffset(targetElement, 'auto');
	};

	onMount(() => {
		if (!addToCartRequestId) {
			addToCartRequestId = initialAddToCartRequestId || createActionRequestId();
		}
		if (!buyNowRequestId) {
			buyNowRequestId = initialBuyNowRequestId || createActionRequestId();
		}
		try {
			const navigationEntries = performance?.getEntriesByType?.('navigation') || [];
			const navEntry = navigationEntries[0];
			if (navEntry?.type === 'back_forward') {
				shouldReloadBeforeCartAction = true;
			}
		} catch {
			// no-op
		}

		const handlePageShow = (event) => {
			if (event?.persisted) {
				shouldReloadBeforeCartAction = true;
			}
		};
		window.addEventListener('pageshow', handlePageShow);

		const mq = window.matchMedia('(max-width: 768px)');
		const handleMq = () => {
			isMobile = mq.matches;
		};
		handleMq();
		if (mq.addEventListener) {
			mq.addEventListener('change', handleMq);
		} else {
			mq.addListener(handleMq);
		}

		const cleanupMediaQuery = () => {
			if (mq.removeEventListener) {
				mq.removeEventListener('change', handleMq);
			} else {
				mq.removeListener(handleMq);
			}
		};

		scrollToMainGallery();
		requestAnimationFrame(() => {
			requestAnimationFrame(() => scrollToMainGallery());
		});
		const initialScrollTimer = setTimeout(() => scrollToMainGallery(), 140);

		initTooltips();
		if (window.location.hash === '#product-reviews') {
			setProductTab('reviews');
			requestAnimationFrame(() => {
				scrollToElementWithHeaderOffset(
					reviewsSectionEl || document.getElementById('product-reviews'),
					'auto'
				);
			});
		}

		let galleryRafId = 0;
		let thumbRafId = 0;
		let nativeMainIndex = 0;
		let pendingMainScrollIndex = null;
		let pendingMainScrollTimer = 0;
		let largeEl = null;
		let thumbTrackEl = null;
		let thumbPrevEl = null;
		let thumbNextEl = null;

		const setButtonDisabled = (button, disabled) => {
			if (!button) return;
			button.disabled = Boolean(disabled);
			button.setAttribute('aria-disabled', disabled ? 'true' : 'false');
		};

		const getMainSlides = () =>
			Array.from(document.querySelectorAll('.large-swiper .swiper-slide'));

		const getThumbSlides = () =>
			Array.from(document.querySelectorAll('.thumb-swiper .swiper-wrapper .swiper-slide'));

		const scrollMainToIndex = (index, animate = true) => {
			if (!largeEl) return;
			const slides = getMainSlides();
			if (!slides.length) return;
			const safeIndex = Math.max(0, Math.min(index, slides.length - 1));
			nativeMainIndex = safeIndex;
			pendingMainScrollIndex = animate ? safeIndex : null;
			if (pendingMainScrollTimer) {
				clearTimeout(pendingMainScrollTimer);
				pendingMainScrollTimer = 0;
			}
			if (animate) {
				pendingMainScrollTimer = window.setTimeout(() => {
					pendingMainScrollIndex = null;
					pendingMainScrollTimer = 0;
				}, 550);
			}
			largeSwiperInstance = {
				realIndex: nativeMainIndex,
				activeIndex: nativeMainIndex,
				slideTo(nextIndex) {
					scrollMainToIndex(nextIndex, true);
				}
			};
			const target = slides[safeIndex];
			largeEl.scrollTo({
				left: target?.offsetLeft ?? safeIndex * largeEl.clientWidth,
				top: 0,
				behavior: animate ? 'smooth' : 'auto'
			});
		};

		const updateThumbNavState = () => {
			if (!thumbTrackEl) return;
			const maxScroll = Math.max(0, thumbTrackEl.scrollWidth - thumbTrackEl.clientWidth);
			const current = Math.max(0, thumbTrackEl.scrollLeft);
			setButtonDisabled(thumbPrevEl, current <= 2 || maxScroll <= 2);
			setButtonDisabled(thumbNextEl, current >= maxScroll - 2 || maxScroll <= 2);
		};

		const queueThumbNavUpdate = () => {
			if (thumbRafId) return;
			thumbRafId = requestAnimationFrame(() => {
				thumbRafId = 0;
				updateThumbNavState();
			});
		};

		const syncThumbViewport = (activeIndex) => {
			if (!thumbTrackEl) return;
			const slides = getThumbSlides();
			if (!slides.length) return;
			const safeIndex = Math.max(0, Math.min(activeIndex, slides.length - 1));
			const target = slides[safeIndex];
			if (!target) return;
			const targetLeft =
				target.offsetLeft - Math.max(0, (thumbTrackEl.clientWidth - target.offsetWidth) / 2);
			thumbTrackEl.scrollTo({
				left: Math.max(0, targetLeft),
				top: 0,
				behavior: 'smooth'
			});
			queueThumbNavUpdate();
		};

		const updateGalleryIndexFromMainScroll = () => {
			if (!largeEl) return;
			const slides = getMainSlides();
			if (!slides.length) return;
			const currentLeft = largeEl.scrollLeft;
			let nextIndex = nativeMainIndex;
			if (Number.isInteger(pendingMainScrollIndex)) {
				const pendingSlide = slides[pendingMainScrollIndex];
				if (pendingSlide) {
					const pendingDistance = Math.abs(pendingSlide.offsetLeft - currentLeft);
					if (pendingDistance > 8) {
						return;
					}
					nextIndex = pendingMainScrollIndex;
				}
				pendingMainScrollIndex = null;
			} else {
				let bestDistance = Number.POSITIVE_INFINITY;
				for (let i = 0; i < slides.length; i += 1) {
					const distance = Math.abs(slides[i].offsetLeft - currentLeft);
					if (distance < bestDistance) {
						bestDistance = distance;
						nextIndex = i;
					}
				}
			}
			if (nextIndex !== nativeMainIndex) {
				nativeMainIndex = nextIndex;
				if (largeSwiperInstance) {
					largeSwiperInstance.realIndex = nextIndex;
					largeSwiperInstance.activeIndex = nextIndex;
				}
				setGalleryIndex(nextIndex);
				syncThumbViewport(nextIndex);
			}
		};

		const queueGalleryScrollSync = () => {
			if (galleryRafId) return;
			galleryRafId = requestAnimationFrame(() => {
				galleryRafId = 0;
				updateGalleryIndexFromMainScroll();
			});
		};

		const handleThumbPrevClick = (event) => {
			event?.preventDefault?.();
			if (!thumbTrackEl || thumbPrevEl?.disabled) return;
			const step = Math.max(140, Math.round(thumbTrackEl.clientWidth * 0.7));
			thumbTrackEl.scrollBy({ left: -step, top: 0, behavior: 'smooth' });
		};

		const handleThumbNextClick = (event) => {
			event?.preventDefault?.();
			if (!thumbTrackEl || thumbNextEl?.disabled) return;
			const step = Math.max(140, Math.round(thumbTrackEl.clientWidth * 0.7));
			thumbTrackEl.scrollBy({ left: step, top: 0, behavior: 'smooth' });
		};

		const initNativeGallerySlider = () => {
			largeEl = document.querySelector('.large-swiper');
			thumbTrackEl = document.querySelector('.thumb-swiper .swiper-wrapper');
			thumbPrevEl = document.querySelector('.thumb-swiper-prev');
			thumbNextEl = document.querySelector('.thumb-swiper-next');
			if (!largeEl) {
				largeSwiperInstance = null;
				return;
			}

			largeSwiperInstance = {
				realIndex: nativeMainIndex,
				activeIndex: nativeMainIndex,
				slideTo(nextIndex) {
					scrollMainToIndex(nextIndex, true);
				}
			};

			const handleLargeScroll = () => queueGalleryScrollSync();
			largeEl.addEventListener('scroll', handleLargeScroll, { passive: true });

			if (thumbTrackEl) {
				const handleThumbScroll = () => queueThumbNavUpdate();
				thumbTrackEl.addEventListener('scroll', handleThumbScroll, { passive: true });
				if (thumbPrevEl) thumbPrevEl.addEventListener('click', handleThumbPrevClick);
				if (thumbNextEl) thumbNextEl.addEventListener('click', handleThumbNextClick);
				window.addEventListener('resize', queueThumbNavUpdate, { passive: true });
				queueThumbNavUpdate();
				setTimeout(queueThumbNavUpdate, 60);

				const teardownThumb = () => {
					thumbTrackEl?.removeEventListener('scroll', handleThumbScroll);
					thumbPrevEl?.removeEventListener('click', handleThumbPrevClick);
					thumbNextEl?.removeEventListener('click', handleThumbNextClick);
					window.removeEventListener('resize', queueThumbNavUpdate);
				};
				const teardownLarge = () => {
					largeEl?.removeEventListener('scroll', handleLargeScroll);
				};

				nativeMainIndex = normalizeGalleryIndex(galleryIndex);
				largeSwiperInstance.realIndex = nativeMainIndex;
				largeSwiperInstance.activeIndex = nativeMainIndex;
				scrollMainToIndex(nativeMainIndex, false);
				syncThumbViewport(nativeMainIndex);

				return () => {
					teardownThumb();
					teardownLarge();
					largeSwiperInstance = null;
					largeEl = null;
					thumbTrackEl = null;
					thumbPrevEl = null;
					thumbNextEl = null;
					pendingMainScrollIndex = null;
					if (pendingMainScrollTimer) {
						clearTimeout(pendingMainScrollTimer);
						pendingMainScrollTimer = 0;
					}
					if (galleryRafId) {
						cancelAnimationFrame(galleryRafId);
						galleryRafId = 0;
					}
					if (thumbRafId) {
						cancelAnimationFrame(thumbRafId);
						thumbRafId = 0;
					}
				};
			}

			const teardownLargeOnly = () => {
				largeEl?.removeEventListener('scroll', handleLargeScroll);
				largeSwiperInstance = null;
				largeEl = null;
				pendingMainScrollIndex = null;
				if (pendingMainScrollTimer) {
					clearTimeout(pendingMainScrollTimer);
					pendingMainScrollTimer = 0;
				}
				if (galleryRafId) {
					cancelAnimationFrame(galleryRafId);
					galleryRafId = 0;
				}
			};

			nativeMainIndex = normalizeGalleryIndex(galleryIndex);
			largeSwiperInstance.realIndex = nativeMainIndex;
			largeSwiperInstance.activeIndex = nativeMainIndex;
			scrollMainToIndex(nativeMainIndex, false);
			return teardownLargeOnly;
		};

		const cleanupNativeGallerySlider = initNativeGallerySlider();

		return () => {
			clearTimeout(initialScrollTimer);
			cleanupMediaQuery();
			cleanupNativeGallerySlider?.();
			window.removeEventListener('pageshow', handlePageShow);
		};
	});

	onDestroy(() => {
		clearReviewSelectedImages();
	});
</script>

<svelte:head>
	<title>{seoTitle}</title>
	<meta name="description" content={seoDescription} />
	{#if lcpGalleryAvifSrcSet && lcpGalleryAvifHref}
		<link
			rel="preload"
			as="image"
			href={lcpGalleryAvifHref}
			type="image/avif"
			imagesrcset={lcpGalleryAvifSrcSet}
			imagesizes={productGalleryImageSizes}
			fetchpriority="high"
		/>
	{:else if lcpGalleryWebpSrcSet && lcpGalleryWebpHref}
		<link
			rel="preload"
			as="image"
			href={lcpGalleryWebpHref}
			type="image/webp"
			imagesrcset={lcpGalleryWebpSrcSet}
			imagesizes={productGalleryImageSizes}
			fetchpriority="high"
		/>
	{/if}
	<meta property="og:url" content={productCanonicalUrl} />
	<meta property="og:type" content="product" />
	<meta property="og:title" content={seoTitle} />
	<meta property="og:description" content={seoDescription} />
	<meta property="og:image" content={seoImage} />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={seoTitle} />
	<meta name="twitter:description" content={seoDescription} />
	<meta name="twitter:image" content={seoImage} />
	{#if productBreadcrumbJsonLd}
		{@html '<script type="application/ld+json">' + escapeJsonLd(productBreadcrumbJsonLd) + '</script>'}
	{/if}
	{#if productJsonLd}
		{@html '<script type="application/ld+json">' + escapeJsonLd(productJsonLd) + '</script>'}
	{/if}
	{#if productFaqJsonLd}
		{@html '<script type="application/ld+json">' + escapeJsonLd(productFaqJsonLd) + '</script>'}
	{/if}
</svelte:head>

<svelte:window
	onkeydown={handleGalleryKeydown}
	onpointermove={handleGalleryPanMove}
	onpointerup={handleGalleryPanEnd}
	onpointercancel={handleGalleryPanEnd}
/>

<main class="product-main">
	<div class="container" style="max-width: 1200px; margin: 0 auto">
		{#if product}
			<div class="product-grid">
				<div class="product-hero">
					<div class="gallery-container">
						<div
							class="main-gallery"
							bind:this={mainGalleryEl}
							role="button"
							tabindex="0"
							aria-label="Phóng to ảnh sản phẩm"
							onclick={openGalleryFromActiveSlide}
							onkeydown={(event) =>
								handleGalleryTriggerKeydown(
									event,
									normalizeGalleryIndex(largeSwiperInstance?.realIndex ?? galleryIndex)
								)}
						>
							<div class="swiper large-swiper">
								<div class="swiper-wrapper">
									{#each galleryImages as image, index}
										{@const galleryAvifSrcSet = getProductGalleryAvifSrcSet(image)}
										{@const galleryWebpSrcSet = getProductGalleryWebpSrcSet(image)}
										<div class="swiper-slide">
											<picture>
												{#if galleryAvifSrcSet}
													<source
														type="image/avif"
														srcset={galleryAvifSrcSet}
														sizes={productGalleryImageSizes}
													/>
												{/if}
												{#if galleryWebpSrcSet}
													<source
														type="image/webp"
														srcset={galleryWebpSrcSet}
														sizes={productGalleryImageSizes}
													/>
												{/if}
												<img
													src={image}
													alt={product.product_name}
													width="1200"
													height="1200"
													loading={index === 0 ? 'eager' : 'lazy'}
													fetchpriority={index === 0 ? 'high' : 'low'}
													decoding="async"
													sizes={productGalleryImageSizes}
													class="gallery-zoomable"
												/>
											</picture>
										</div>
									{/each}
								</div>
							</div>
						</div>

						<div class="thumbnail-gallery swiper thumb-swiper">
							<div class="swiper-wrapper">
								{#each galleryImages as image, index}
									<button
										type="button"
										class="swiper-slide thumbnail-image"
										class:is-active={index === galleryIndex}
										aria-label={`Xem ảnh ${index + 1}`}
										onclick={() => setGalleryIndex(index, { syncMainSlider: true })}
									>
										<img
											src={image}
											alt={`${product.product_name} - ${index + 1}`}
											width="140"
											height="140"
											loading="lazy"
											fetchpriority="low"
											decoding="async"
										/>
									</button>
								{/each}
							</div>
							<button
								class="thumb-swiper-nav thumb-swiper-prev"
								type="button"
								aria-label="Previous image"
							>
								<span aria-hidden="true">&#10094;</span>
							</button>
							<button
								class="thumb-swiper-nav thumb-swiper-next"
								type="button"
								aria-label="Next image"
							>
								<span aria-hidden="true">&#10095;</span>
							</button>
						</div>
					</div>
				</div>

				<div class="product-info">
					<div class="product-header">
						<h1 class="product-title">{product.product_name}</h1>
						<div class="product-meta-row">
							<button
								type="button"
								class="rating-summary"
								class:rating-summary--empty={!hasRating}
								aria-controls="product-reviews"
								title={$t('product.reviewJump')}
								onclick={openReviewsTab}
							>
								<span class="rating-badge" class:rating-badge--empty={!hasRating}>
									<span class="rating-stars" aria-hidden="true">
										{#each ratingStars as star}
											<svg
												class="rating-star"
												class:rating-star--filled={star.type === 'full'}
												class:rating-star--half={star.type === 'half'}
												class:rating-star--empty={star.type === 'empty'}
												viewBox={star.viewBox}
											>
												<use xlink:href={star.href}></use>
											</svg>
										{/each}
									</span>
									<span class="rating-text rating-text--summary">
										{#if hasRating}
											<strong>{formattedRatingAverage}</strong>
											<span>/5</span>
										{:else}
											{$t('product.ratingEmpty')}
										{/if}
									</span>
								</span>
								<span class="rating-summary-meta">
									{#if hasRating}
										({$t('product.ratingCount', { count: ratingCount })})
									{:else}
										{$t('product.reviewJump')}
									{/if}
								</span>
							</button>
							<div class="stock-status">
								<span
									class="stock-badge"
									class:in-stock={stockQuantity > 10}
									class:low-stock={stockQuantity > 0 && stockQuantity <= 10}
									class:out-stock={stockQuantity === 0}
								>
									{stockQuantity > 10
										? $t('product.inStock')
										: stockQuantity > 0
											? $t('product.lowStock')
											: $t('product.outOfStock')}
								</span>
								<span>({$t('product.stockCount', { count: stockQuantity })})</span>
							</div>
						</div>
					</div>

					<div class="price-section">
						{#if showDiscountBadge && pricing.formattedOriginal}
							<span class="discount-badge bg-primary">-{pricing.discountPercent}%</span>
						{/if}
						<span class="price-current">{pricing.formattedPrice}</span>
						{#if pricing.formattedOriginal}
							<span class="price-original">{pricing.formattedOriginal}</span>
						{/if}
					</div>

					<div class="options-section">
						<div class="option-grid">
							{#if sizeOptions.length}
								<div class="option-group">
									<div class="option-label">{$t('product.size')}</div>
									<ul class="option-list">
										{#each sizeOptions as size}
											<li class="option-item">
												<button
													class="option-btn"
													class:active={selectedSize === size}
													onclick={() => (selectedSize = size)}
												>
													{size}
												</button>
											</li>
										{/each}
									</ul>
								</div>
							{/if}

							{#if colorOptions.length}
								<div class="option-group">
									<div class="option-label">{$t('product.color')}</div>
									<ul class="option-list">
										{#each colorOptions as color}
											<li class="option-item">
												<button
													class="option-btn"
													class:active={selectedColor === color}
													onclick={() => (selectedColor = color)}
												>
													{color}
												</button>
											</li>
										{/each}
									</ul>
								</div>
							{/if}
						</div>
						{#if (sizeOptions.length || colorOptions.length) && !variantSelectionValid}
							<p class="variant-warning">Vui lòng chọn phân loại hàng</p>
						{/if}
						<div class="quantity-row" class:is-locked={hasVariantOptions && !variantSelectionValid}>
							<span class="quantity-label">{$t('product.quantity')}</span>
							<div class="qty-control">
								<button
									type="button"
									class="qty-btn"
									aria-label={$t('product.decreaseQuantity')}
									disabled={hasVariantOptions && !variantSelectionValid}
									aria-disabled={hasVariantOptions && !variantSelectionValid}
									onclick={() => adjustQuantity(-1)}
								>
									-
								</button>
								<input
									type="number"
									min="1"
									class="form-control qty-input"
									disabled={hasVariantOptions && !variantSelectionValid}
									aria-disabled={hasVariantOptions && !variantSelectionValid}
									bind:value={selectedQuantity}
									oninput={handleQuantityInput}
								/>
								<button
									type="button"
									class="qty-btn"
									aria-label={$t('product.increaseQuantity')}
									disabled={hasVariantOptions && !variantSelectionValid}
									aria-disabled={hasVariantOptions && !variantSelectionValid}
									onclick={() => adjustQuantity(1)}
								>
									+
								</button>
							</div>
						</div>
					</div>

					<div class="action-buttons" class:action-buttons-mobile={isMobile}>
						<div class="action-buy-now">
							<form
								method="POST"
								action="?/buyNow"
								class="action-form"
								use:enhance={handleBuyNowEnhance}
							>
								<input type="hidden" name="productId" value={product?._id} />
								<input type="hidden" name="variant_color" value={selectedColor} />
								<input type="hidden" name="variant_size" value={selectedSize} />
								<input type="hidden" name="variant_price" value={pricing.price} />
								<input type="hidden" name="quantity" value={selectedQuantity} />
								<input
									type="hidden"
									name="clientRequestId"
									value={buyNowRequestId || initialBuyNowRequestId}
								/>
								<button
									type="submit"
									class="btn-primary-action"
									disabled={!variantSelectionValid}
									aria-disabled={!variantSelectionValid}
									data-track="begin_checkout_click"
									data-track-section="product_detail"
								>
									{$t('product.buyNow')}
								</button>
							</form>
						</div>
						<div class="action-secondary-row">
							<form
								method="POST"
								action="?/addToCart"
								class="action-form"
								use:enhance={handleAddToCartEnhance}
							>
								<input type="hidden" name="productId" value={product?._id} />
								<input type="hidden" name="variant_color" value={selectedColor} />
								<input type="hidden" name="variant_size" value={selectedSize} />
								<input type="hidden" name="variant_price" value={pricing.price} />
								<input type="hidden" name="quantity" value={selectedQuantity} />
								<input
									type="hidden"
									name="clientRequestId"
									value={addToCartRequestId || initialAddToCartRequestId}
								/>
								<button
									type="submit"
									class="btn-secondary-action"
									disabled={isAddingToCart || !variantSelectionValid}
									aria-disabled={isAddingToCart || !variantSelectionValid}
									data-track="add_to_cart_click"
									data-track-section="product_detail"
								>
									{$t('common.addToCart')}
								</button>
							</form>
						</div>
					</div>

					<div class="product-meta">
						<div class="meta-item">
							<span class="meta-label">{$t('product.metaModel')}:</span>
							<span class="meta-value">{product.product_attributes?.model}</span>
						</div>
						{#if product.product_type}
							<div class="meta-item">
								<span class="meta-label">{$t('product.metaCategory')}:</span>
								<span class="meta-value">{getProductTypeLabel(product.product_type, $locale)}</span>
							</div>
						{/if}
						{#if product.product_attributes?.manufacturer}
							<div class="meta-item">
								<span class="meta-label">{$t('product.metaManufacturer')}:</span>
								<span class="meta-value">{product.product_attributes.manufacturer}</span>
							</div>
						{/if}
						{#if product.product_weight}
							<div class="meta-item">
								<span class="meta-label">{$t('product.metaWeight')}:</span>
								<span class="meta-value">{product.product_weight}g</span>
							</div>
						{/if}
					</div>
				</div>
			</div>
		{:else}
			<div style="text-align: center; padding: 4rem 2rem; background: white; border-radius: 12px;">
				<h1 class="product-title">{$t('product.notFound')}</h1>
				{#if apiError}
					<p style="color: #999; margin: 1rem 0;">{apiError}</p>
				{/if}
				<a href="/shop" class="btn-primary-action" style="display: inline-block;">
					{$t('product.backToShop')}
				</a>
			</div>
		{/if}
	</div>
</main>

{#if product}
	<section style="padding: 2rem 1rem; background: #f9f9f9;">
		<div class="container" style="max-width: 1200px; margin: 0 auto;">
			<div class="tabs-wrapper">
				<div class="tabs-nav">
					<button
						class="tab-button"
						class:active={activeTab === 'description'}
						onclick={() => setProductTab('description', { updateHash: true })}
					>
						{$t('product.tabDescription')}
					</button>
					<button
						class="tab-button"
						class:active={activeTab === 'specifications'}
						onclick={() => setProductTab('specifications', { updateHash: true })}
					>
						{$t('product.tabSpecs')}
					</button>
					<button
						class="tab-button"
						class:active={activeTab === 'shipping'}
						onclick={() => setProductTab('shipping', { updateHash: true })}
					>
						{$t('product.tabShipping')}
					</button>
					<button
						class="tab-button"
						class:active={activeTab === 'reviews'}
						aria-controls="product-reviews"
						onclick={() => setProductTab('reviews', { updateHash: true })}
					>
						{$t('product.tabReviews')}
						{#if ratingCount > 0}
							<span class="tab-button-badge">{ratingCount}</span>
						{/if}
					</button>
				</div>

				<div class="tab-content" class:active={activeTab === 'description'}>
					{#if product.product_description}
						<div class="description-text">
							<RichTextDisplay content={product.product_description} />
						</div>
					{:else}
						<p class="description-text">{$t('product.descriptionEmpty')}</p>
					{/if}
				</div>

				<div class="tab-content" class:active={activeTab === 'specifications'}>
					<ul class="info-list">
						{#if product.product_attributes?.manufacturer}
							<li>
								<strong>{$t('product.specManufacturer')}:</strong>
								{product.product_attributes.manufacturer}
							</li>
						{/if}
						{#if product.product_attributes?.model}
							<li>
								<strong>{$t('product.specModel')}:</strong>
								{product.product_attributes.model}
							</li>
						{/if}
						{#if product.product_attributes?.color}
							<li>
								<strong>{$t('product.specColor')}:</strong>
								{product.product_attributes.color}
							</li>
						{/if}
						{#if product.product_weight}
							<li><strong>{$t('product.specWeight')}:</strong> {product.product_weight}g</li>
						{/if}
						{#if product?.inventory_stock != null || product?.product_quantity != null}
							<li><strong>{$t('product.specStock')}:</strong> {stockQuantity}</li>
						{/if}
						{#if product.product_attributes?.dimensions}
							<li>
								<strong>{$t('product.specDimensions')}:</strong>
								{product.product_attributes.dimensions}
							</li>
						{/if}
						{#if product.product_attributes?.warranty}
							<li>
								<strong>{$t('product.specWarranty')}:</strong>
								{product.product_attributes.warranty}
							</li>
						{/if}
					</ul>
				</div>

				<div class="tab-content" class:active={activeTab === 'shipping'}>
					<div style="color: #555; line-height: 1.8;">
						<h3 style="color: #333; margin-bottom: 1rem;">{$t('product.returnsTitle')}</h3>
						<p>{$t('product.returnsDesc')}</p>

						<h3 style="color: #333; margin-bottom: 1rem; margin-top: 2rem;">
							{$t('product.shippingTitle')}
						</h3>
						<ul style="margin-left: 1.5rem;">
							<li>{$t('product.shippingItem1')}</li>
							<li>{$t('product.shippingItem2')}</li>
							<li>{$t('product.shippingItem3')}</li>
						</ul>
						<div class="product-faq-list">
							<h3>{$locale === 'en' ? 'Common questions' : 'Câu hỏi thường gặp'}</h3>
							{#each productFaqItems as item}
								<details>
									<summary>{item.question}</summary>
									<p>{item.answer}</p>
								</details>
							{/each}
						</div>
					</div>
				</div>

				<div
					id="product-reviews"
					class="tab-content tab-content--reviews"
					class:active={activeTab === 'reviews'}
					bind:this={reviewsSectionEl}
				>
					<div class="reviews-layout">
						<aside class="reviews-summary-card">
							<div class="reviews-summary-score">
								<div class="reviews-score-row">
									<span class="reviews-score-value">{formattedRatingAverage}</span>
									<span class="reviews-score-scale">/5</span>
								</div>
								<div class="rating-stars rating-stars--summary" aria-hidden="true">
									{#each ratingStars as star}
										<svg
											class="rating-star"
											class:rating-star--filled={star.type === 'full'}
											class:rating-star--half={star.type === 'half'}
											class:rating-star--empty={star.type === 'empty'}
											viewBox={star.viewBox}
										>
											<use xlink:href={star.href}></use>
										</svg>
									{/each}
								</div>
								<p class="reviews-score-caption">
									{#if hasRating}
										{$t('product.ratingCount', { count: ratingCount })}
									{:else}
										{$t('product.ratingEmpty')}
									{/if}
								</p>
							</div>

							<div class="reviews-progress-card">
								<div class="reviews-progress-header">
									<span>{$t('product.reviewSatisfactionLabel')}</span>
									<strong>{ratingSatisfactionPercent}%</strong>
								</div>
								<div class="reviews-progress-track" aria-hidden="true">
									<span style={`width: ${ratingSatisfactionPercent}%`}></span>
								</div>
							</div>

							<div class="reviews-metric-grid">
								<div class="reviews-metric-card">
									<span>{$t('product.reviewAverageLabel')}</span>
									<strong>{formattedRatingAverage}</strong>
								</div>
								<div class="reviews-metric-card">
									<span>{$t('product.reviewTotalLabel')}</span>
									<strong>{ratingCount}</strong>
								</div>
								<div class="reviews-metric-card">
									<span>{$t('product.reviewDetailCountLabel')}</span>
									<strong>{detailedReviewCount}</strong>
								</div>
							</div>
						</aside>

						<div class="reviews-stream">
							<div class="reviews-heading">
								<h3>{$t('product.reviewOverviewTitle')}</h3>
								<p>
									{#if hasRating}
										{$t('product.reviewOverviewDesc', { count: ratingCount })}
									{:else}
										{$t('product.reviewEmptyDesc')}
									{/if}
								</p>
							</div>

							<section class="review-compose-card" aria-label={reviewSubmitLabel}>
								<div class="review-compose-head">
									<h4>
										{hasSubmittedReview
											? $t('product.reviewUpdateTitle')
											: $t('product.reviewAddTitle')}
									</h4>
									<p>
										{#if !isAuthenticated}
											{$t('product.reviewLoginRequiredDesc')}
										{:else if hasSubmittedReview}
											{reviewExistingStatusHint}
										{:else if canSubmitReview}
											{$t('product.reviewEligibleHint')}
										{:else}
											{$t('product.reviewPurchaseRequired')}
										{/if}
									</p>
								</div>

								{#if reviewSuccessMessage}
									<div class="review-form-notice success">{reviewSuccessMessage}</div>
								{/if}
								{#if reviewErrorMessage}
									<div class="review-form-notice error">{reviewErrorMessage}</div>
								{/if}

								{#if !isAuthenticated}
									<div class="review-login-card">
										<strong>{$t('product.reviewLoginRequiredTitle')}</strong>
										<p>{$t('product.reviewLoginRequiredDesc')}</p>
										<a
											class="review-login-link"
											href={localizeInternalHref(resolveLoginRedirectHref(), $locale)}
											>{$t('product.reviewLoginCta')}</a
										>
									</div>
								{:else if canSubmitReview}
									<form
										method="POST"
										action="?/submitReview"
										class="review-form"
										use:enhance={handleReviewEnhance}
									>
										<input type="hidden" name="productId" value={reviewSourceProduct?._id || ''} />
										<input
											type="hidden"
											name="review_images"
											value={JSON.stringify(retainedReviewImages)}
										/>

										<div class="review-form-grid">
											<div class="review-field">
												<label for="review-author-name">{$t('product.reviewNameLabel')}</label>
												<input
													id="review-author-name"
													class="review-input"
													type="text"
													value={reviewAuthorName}
													placeholder={$t('product.reviewNamePlaceholder')}
													readonly
												/>
											</div>
											<div class="review-field">
												<label for="review-author-email">{$t('product.reviewEmailLabel')}</label>
												<input
													id="review-author-email"
													class="review-input"
													type="email"
													value={reviewAuthorEmail}
													placeholder={$t('product.reviewEmailPlaceholder')}
													readonly
												/>
											</div>
										</div>

										<div class="review-field">
											<span class="review-field-caption">{$t('product.reviewRatingLabel')}</span>
											<div
												class="review-rating-group"
												role="radiogroup"
												aria-label={$t('product.reviewRatingLabel')}
											>
												{#each [5, 4, 3, 2, 1] as star}
													<label
														class="review-rating-option"
														class:active={reviewFormValues.rating === star}
													>
														<input
															type="radio"
															name="rating"
															value={star}
															checked={reviewFormValues.rating === star}
															required
														/>
														<span class="rating-stars rating-stars--selector" aria-hidden="true">
															{#each buildRatingStars(star) as icon}
																<svg
																	class="rating-star"
																	class:rating-star--filled={icon.type === 'full'}
																	class:rating-star--half={icon.type === 'half'}
																	class:rating-star--empty={icon.type === 'empty'}
																	viewBox={icon.viewBox}
																>
																	<use xlink:href={icon.href}></use>
																</svg>
															{/each}
														</span>
														<span class="review-rating-value">{star}</span>
													</label>
												{/each}
											</div>
											<p class="review-inline-note">{$t('product.reviewStarsHelper')}</p>
										</div>

										<div class="review-field">
											<input
												class="review-input"
												type="text"
												name="title"
												maxlength="160"
												value={reviewFormValues.title}
												placeholder={$t('product.reviewTitlePlaceholder')}
											/>
										</div>

										<div class="review-field">
											<textarea
												class="review-textarea"
												name="content"
												rows="5"
												maxlength="2000"
												required
												placeholder={$t('product.reviewCommentPlaceholder')}
												>{reviewFormValues.content}</textarea
											>
										</div>

										<div class="review-field">
											<label for="review-images">{$t('product.reviewImagesLabel')}</label>
											<input
												id="review-images"
												bind:this={reviewImageInputEl}
												class="review-file-input"
												type="file"
												name="review_images"
												accept="image/*"
												multiple
												onchange={handleReviewImagesChange}
											/>
											<p class="review-inline-note">
												{$t('product.reviewImagesHint', { count: MAX_REVIEW_IMAGES })}
											</p>

											{#if retainedReviewImages.length || reviewSelectedImages.length}
												<div class="review-image-grid">
													{#each retainedReviewImages as image, index (`existing-${image.path || image.url || index}`)}
														<div class="review-image-chip">
															<img
																src={resolveReviewImageUrl(image)}
																alt={$t('product.reviewImagesLabel')}
															/>
															<button
																type="button"
																class="review-image-remove"
																onclick={() => removeRetainedReviewImage(index)}
															>
																{$t('product.reviewRemoveImage')}
															</button>
														</div>
													{/each}
													{#each reviewSelectedImages as image, index (image.id)}
														<div class="review-image-chip">
															<img src={image.previewUrl} alt={image.name} />
															<button
																type="button"
																class="review-image-remove"
																onclick={() => removeReviewSelectedImage(index)}
															>
																{$t('product.reviewRemoveImage')}
															</button>
														</div>
													{/each}
												</div>
											{:else}
												<p class="review-inline-note">{$t('product.reviewImagesEmpty')}</p>
											{/if}
										</div>

										<p class="review-inline-note">{$t('product.reviewHint')}</p>

										<button
											type="submit"
											class="review-submit-button"
											disabled={isSubmittingReview}
										>
											{isSubmittingReview ? `${reviewSubmitLabel}...` : reviewSubmitLabel}
										</button>
									</form>
								{:else}
									<div class="review-locked-card">
										<strong>{$t('product.reviewAddTitle')}</strong>
										<p>{$t('product.reviewPurchaseRequired')}</p>
									</div>
								{/if}
							</section>

							{#if reviewItems.length}
								<div class="review-list">
									{#each reviewItems as review}
										<article class="review-card">
											<div class="review-card-head">
												<div>
													<h4 class="review-author">{review.author}</h4>
													<div class="review-meta">
														{#if review.dateLabel}
															<span>{review.dateLabel}</span>
														{/if}
														{#if review.verified}
															<span class="review-verified"
																>{$t('product.reviewVerifiedPurchase')}</span
															>
														{/if}
													</div>
												</div>
												{#if review.rating > 0}
													<div class="rating-stars rating-stars--compact" aria-hidden="true">
														{#each review.stars as star}
															<svg
																class="rating-star"
																class:rating-star--filled={star.type === 'full'}
																class:rating-star--half={star.type === 'half'}
																class:rating-star--empty={star.type === 'empty'}
																viewBox={star.viewBox}
															>
																<use xlink:href={star.href}></use>
															</svg>
														{/each}
													</div>
												{/if}
											</div>
											{#if review.title}
												<h5 class="review-title">{review.title}</h5>
											{/if}
											<p class="review-body">
												{review.content || $t('product.reviewNoComment')}
											</p>
											{#if review.images?.length}
												<div class="review-gallery">
													{#each review.images as image, index (`review-${review.id}-${image.path || image.url || index}`)}
														<a
															class="review-gallery-item"
															href={resolveReviewImageUrl(image)}
															target="_blank"
															rel="noreferrer"
														>
															<img
																src={resolveReviewImageUrl(image)}
																alt={review.title || review.author}
															/>
														</a>
													{/each}
												</div>
											{/if}
										</article>
									{/each}
								</div>
							{:else if hasRating}
								<div class="reviews-empty-state">
									<h4>{$t('product.reviewDetailsPendingTitle')}</h4>
									<p>{$t('product.reviewDetailsPending')}</p>
								</div>
							{:else}
								<div class="reviews-empty-state">
									<h4>{$t('product.reviewEmptyTitle')}</h4>
									<p>{$t('product.reviewEmptyDesc')}</p>
								</div>
							{/if}
						</div>
					</div>
				</div>
			</div>
		</div>
	</section>

	<section class="related-section position-relative">
		<div class="container" style="max-width: 1200px; margin: 0 auto; padding: 0 1rem;">
			<div class="section-title d-md-flex justify-content-between align-items-center mb-4">
				<h3 class="d-flex align-items-center">{$t('product.relatedTitle')}</h3>
				<a href="/shop" class="btn">{$t('common.viewAll')}</a>
			</div>
			<div
				class="position-absolute top-50 end-0 pe-0 pe-xxl-5 me-0 me-xxl-5 swiper-next product-slider-button-next"
			>
				<svg
					class="chevron-forward-circle d-flex justify-content-center align-items-center p-2"
					width="80"
					height="80"
				>
					<use xlink:href="#alt-arrow-right-outline"></use>
				</svg>
			</div>
			<div
				class="position-absolute top-50 start-0 ps-0 ps-xxl-5 ms-0 ms-xxl-5 swiper-prev product-slider-button-prev"
			>
				<svg
					class="chevron-back-circle d-flex justify-content-center align-items-center p-2"
					width="80"
					height="80"
				>
					<use xlink:href="#alt-arrow-left-outline"></use>
				</svg>
			</div>
			<div class="swiper product-swiper">
				<div class="swiper-wrapper">
					{#if relatedProducts.length}
						{#each relatedProducts as item, index}
							{@const discountPercent = getDiscountPercent(item)}
							{@const originalPrice = getOriginalPrice(item)}
							{@const relatedThumb = resolveThumb(item.product_thumb, index)}
							{@const relatedThumbAvifSrcSet = getProductCardAvifSrcSet(relatedThumb)}
							{@const relatedThumbWebpSrcSet = getProductCardWebpSrcSet(relatedThumb)}
							{@const relatedRatingSummary = getMarketingRatingSummary(item, $locale)}
							<div class="swiper-slide">
								<div class="card product-card position-relative p-3 border rounded-3 related-card">
									{#if showDiscountBadge && discountPercent}
										<div class="position-absolute">
											<p class="bg-primary py-1 px-3 fs-6 text-white rounded-2">
												-{discountPercent}%
											</p>
										</div>
									{/if}
									<a
										class="product-card-link"
										href={getProductHref(item)}
										aria-label={item.product_name}
										data-track="product_click"
										data-track-section="product_related"
										data-product-id={item?._id}
										data-product-slug={item?.product_slug || item?.slug || ''}
										data-product-name={item?.product_name || ''}
									>
										<div class="product-thumb">
											<picture>
												{#if relatedThumbAvifSrcSet}
													<source
														type="image/avif"
														srcset={relatedThumbAvifSrcSet}
														sizes={productCardImageSizes}
													/>
												{/if}
												{#if relatedThumbWebpSrcSet}
													<source
														type="image/webp"
														srcset={relatedThumbWebpSrcSet}
														sizes={productCardImageSizes}
													/>
												{/if}
												<img
													src={relatedThumb}
													class="img-fluid shadow-sm"
													alt={item.product_name}
													width="640"
													height="640"
													loading="lazy"
													fetchpriority="low"
													decoding="async"
													sizes={productCardImageSizes}
												/>
											</picture>
										</div>
										<h6 class="mt-2 mb-0 fw-bold">{item.product_name}</h6>
										<div class="price-block mt-2">
											<span class="price text-primary fw-bold fs-6"
												>{formatPrice(item.product_price)}</span
											>
											<span class="old-price fw-bold">{originalPrice}</span>
										</div>
										<div class="product-rating-row" aria-label={relatedRatingSummary.label}>
											<span aria-hidden="true">★★★★★</span>
											<strong>{relatedRatingSummary.formattedAverage}</strong>
											<small>({relatedRatingSummary.count})</small>
										</div>
										<div class="product-desc-box">
											<p class="product-desc mb-0">
												{shortRelatedDescription(item) || $t('product.relatedFallbackDesc')}
											</p>
										</div>
									</a>
									<div class="card-concern position-absolute start-0 end-0 d-flex gap-2">
										<form
											method="POST"
											action="?/addToCart"
											class="d-inline-flex m-0"
											use:enhance={createRelatedAddToCartEnhance(item)}
										>
											<input type="hidden" name="productId" value={item?._id} />
											<button
												type="submit"
												class="btn btn-dark home-addcart-btn"
												class:is-adding={relatedAddingId === item?._id}
												class:is-added={relatedAddedId === item?._id}
												disabled={relatedAddingId || isRelatedAddLocked(item?._id)}
												data-track="add_to_cart_click"
												data-track-section="product_related"
												data-product-id={item?._id}
												data-product-slug={item?.product_slug || item?.slug || ''}
												data-product-name={item?.product_name || ''}
												data-bs-toggle="tooltip"
												data-bs-placement="top"
												data-bs-title={$t('common.addToCart')}
												aria-label={$t('common.addToCart')}
												title={$t('common.addToCart')}
											>
												<span class="home-addcart-icon">
													<svg class="cart">
														<use xlink:href="#cart"></use>
													</svg>
												</span>
											</button>
										</form>
									</div>
								</div>
							</div>
						{/each}
					{:else}
						<div class="swiper-slide">
							<div class="card product-card position-relative p-3 border rounded-3 related-card">
								<h6 class="mt-2 mb-0 fw-bold">{$t('product.noRelated')}</h6>
							</div>
						</div>
					{/if}
				</div>
			</div>
		</div>
	</section>

	{#if isGalleryOpen}
		<div
			class="gallery-overlay"
			use:portalToBody
			onwheel={preventGalleryOverlayScroll}
			ontouchmove={preventGalleryOverlayScroll}
		>
			<button
				type="button"
				class="gallery-overlay-backdrop"
				aria-label="Close product gallery"
				onclick={closeGallery}
			></button>
			<div
				class="gallery-modal"
				role="dialog"
				aria-modal="true"
				aria-label="Product gallery"
				tabindex="-1"
				onwheel={preventGalleryOverlayScroll}
				onkeydown={(e) => {
					if (e.key === 'Escape') closeGallery();
				}}
			>
				<div class="gallery-modal-topbar">
					<div class="gallery-modal-count">{galleryIndex + 1} / {galleryImages.length}</div>
					<div class="gallery-modal-toolbar">
						<button
							type="button"
							class="gallery-toolbar-btn"
							aria-label="Zoom out"
							onclick={zoomOutGallery}
							disabled={galleryZoom <= 1}
						>
							-
						</button>
						<button
							type="button"
							class="gallery-toolbar-btn"
							aria-label="Reset zoom"
							onclick={resetGalleryZoom}
							disabled={galleryZoom === 1}
						>
							100%
						</button>
						<button
							type="button"
							class="gallery-toolbar-btn"
							aria-label="Zoom in"
							onclick={zoomInGallery}
							disabled={galleryZoom >= 4}
						>
							+
						</button>
						<button
							class="gallery-toolbar-btn gallery-toolbar-close"
							type="button"
							aria-label="Close"
							onclick={closeGallery}
						>
							×
						</button>
					</div>
				</div>

				<div class="gallery-modal-body">
					<div class="gallery-modal-thumbs gallery-modal-thumbs-desktop">
						{#each galleryImages as image, index}
							<button
								type="button"
								class="gallery-modal-thumb"
								class:is-active={index === galleryIndex}
								aria-label={`Xem ảnh ${index + 1}`}
								onclick={() => selectGalleryImage(index)}
							>
								<img
									src={image}
									alt={`${product?.product_name || 'Product'} - ${index + 1}`}
									width="120"
									height="120"
								/>
							</button>
						{/each}
					</div>

					<div class="gallery-stage-wrap">
						<button
							type="button"
							class="gallery-nav-btn gallery-nav-prev"
							aria-label="Previous image"
							onclick={goGalleryPrev}
							disabled={galleryImages.length <= 1}
						>
							‹
						</button>

						<div
							class="gallery-modal-image"
							class:is-zoomed={galleryZoom > 1}
							class:is-panning={isGalleryPanning}
							bind:this={galleryViewportEl}
							onpointerdown={handleGalleryPanStart}
							onwheel={handleGalleryWheel}
						>
							<div
								class="gallery-pan"
								style={`transform: translate3d(${galleryPanX}px, ${galleryPanY}px, 0);`}
							>
								<img
									bind:this={galleryImageEl}
									src={activeGalleryImage || fallbackGallery[0]}
									alt={product?.product_name || 'Gallery image'}
									width="1200"
									height="1200"
									draggable="false"
									style={`transform: scale(${galleryZoom})`}
								/>
							</div>
						</div>

						<button
							type="button"
							class="gallery-nav-btn gallery-nav-next"
							aria-label="Next image"
							onclick={goGalleryNext}
							disabled={galleryImages.length <= 1}
						>
							›
						</button>
					</div>
				</div>

				<div class="gallery-modal-thumbs gallery-modal-thumbs-mobile">
					{#each galleryImages as image, index}
						<button
							type="button"
							class="gallery-modal-thumb"
							class:is-active={index === galleryIndex}
							aria-label={`Xem ảnh ${index + 1}`}
							onclick={() => selectGalleryImage(index)}
						>
							<img
								src={image}
								alt={`${product?.product_name || 'Product'} - ${index + 1}`}
								width="120"
								height="120"
							/>
						</button>
					{/each}
				</div>
			</div>
		</div>
	{/if}

	<div
		class="product-action-spacer"
		class:product-action-spacer--on={isMobile}
		aria-hidden="true"
	></div>
{/if}

<style>
	.gallery-overlay {
		position: fixed;
		inset: 0;
		--gallery-overlay-pad: clamp(10px, 2vw, 24px);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--gallery-overlay-pad);
		background: rgba(15, 20, 24, 0.82);
		backdrop-filter: blur(6px);
		-webkit-backdrop-filter: blur(6px);
		z-index: 2147483000;
		overflow: hidden;
		touch-action: none;
		overscroll-behavior: contain;
	}

	.gallery-overlay-backdrop {
		position: absolute;
		inset: 0;
		border: 0;
		padding: 0;
		margin: 0;
		background: transparent;
		cursor: pointer;
	}

	:global(html.gallery-zoom-open),
	:global(body.gallery-zoom-open) {
		overflow: hidden !important;
		overscroll-behavior: none !important;
	}

	:global(body.gallery-zoom-open #smooth-content) {
		position: relative;
		z-index: 2147482999 !important;
	}

	:global(body.gallery-zoom-open .site-header) {
		z-index: 10 !important;
	}

	/* Force mobile action bar visibility even after client-side navigation */
	:global(.product-main .action-buttons) {
		display: flex !important;
		flex-direction: column !important;
		opacity: 1 !important;
		visibility: visible !important;
		pointer-events: auto !important;
	}
	.product-hero {
		display: flex;
		justify-content: center;
	}

	.gallery-container {
		width: 100%;
		max-width: 540px;
		display: grid;
		gap: 16px;
		position: relative;
		cursor: default;
	}

	.main-gallery {
		width: 100%;
		border-radius: 16px;
		overflow: hidden;
		background: #fff;
		border: 1px solid rgba(0, 0, 0, 0.08);
		position: relative;
		cursor: zoom-in;
	}

	.main-gallery::before {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(180deg, rgba(0, 0, 0, 0.08), rgba(0, 0, 0, 0.02));
		opacity: 0;
		transition: opacity 0.2s ease;
		pointer-events: none;
		z-index: 1;
	}

	.main-gallery::after {
		content: 'Zoom';
		position: absolute;
		bottom: 16px;
		right: 16px;
		padding: 6px 12px;
		border-radius: 999px;
		background: rgba(20, 20, 20, 0.85);
		color: #fff;
		font-size: 0.75rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		opacity: 0;
		transform: translateY(6px);
		transition:
			opacity 0.2s ease,
			transform 0.2s ease;
		pointer-events: none;
		z-index: 2;
	}

	.main-gallery .large-swiper {
		width: 100%;
		height: 100%;
		overflow-x: auto;
		overflow-y: hidden;
		scroll-snap-type: x mandatory;
		scroll-behavior: smooth;
		-webkit-overflow-scrolling: touch;
		scrollbar-width: none;
		touch-action: pan-y pinch-zoom;
	}

	.main-gallery .large-swiper::-webkit-scrollbar {
		display: none;
	}

	.large-swiper .swiper-wrapper {
		display: flex;
		align-items: stretch;
		width: max-content;
		min-width: 100%;
		height: 100%;
	}

	.large-swiper .swiper-slide {
		flex: 0 0 100%;
		scroll-snap-align: start;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #fff;
	}

	.large-swiper img {
		width: 100%;
		height: auto;
		max-height: 480px;
		object-fit: contain;
		display: block;
	}

	.gallery-zoomable {
		cursor: inherit;
		position: relative;
		z-index: 0;
	}

	.gallery-container:hover .main-gallery::before,
	.gallery-container:hover .main-gallery::after {
		opacity: 1;
	}

	.gallery-container:hover .main-gallery::after {
		transform: translateY(0);
	}

	.gallery-modal {
		position: relative;
		inset: auto;
		z-index: auto;
		padding: 0;
		width: min(1220px, calc(100vw - (var(--gallery-overlay-pad) * 2)));
		height: min(92dvh, 860px);
		max-height: 100%;
		margin: 0 auto;
		border-radius: 20px;
		border: 1px solid rgba(255, 255, 255, 0.14);
		background: linear-gradient(180deg, #151a21, #0f141a 60%);
		box-shadow:
			0 34px 80px rgba(0, 0, 0, 0.58),
			inset 0 1px 0 rgba(255, 255, 255, 0.06);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.gallery-modal-topbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 14px 16px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.1);
		background: rgba(10, 14, 19, 0.72);
	}

	.gallery-modal-count {
		font-size: 0.92rem;
		font-weight: 700;
		letter-spacing: 0.03em;
		color: rgba(255, 255, 255, 0.88);
	}

	.gallery-modal-toolbar {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.gallery-toolbar-btn {
		min-width: 42px;
		height: 38px;
		padding: 0 12px;
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.08);
		color: #fff;
		font-size: 0.9rem;
		font-weight: 700;
		cursor: pointer;
		transition:
			background-color 0.2s ease,
			border-color 0.2s ease,
			transform 0.2s ease,
			opacity 0.2s ease;
	}

	.gallery-toolbar-btn:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.16);
		border-color: rgba(255, 255, 255, 0.36);
		transform: translateY(-1px);
	}

	.gallery-toolbar-btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
		transform: none;
	}

	.gallery-toolbar-close {
		font-size: 1.15rem;
		padding: 0 14px;
	}

	.gallery-modal-body {
		flex: 1;
		min-height: 0;
		display: flex;
		gap: 14px;
		padding: 14px;
	}

	.gallery-modal-thumbs {
		display: flex;
		gap: 10px;
	}

	.gallery-modal-thumbs-desktop {
		width: 92px;
		flex-direction: column;
		overflow-y: auto;
		overflow-x: hidden;
		padding: 6px 4px 6px 2px;
		border-radius: 14px;
		border: 1px solid rgba(255, 255, 255, 0.07);
		background: rgba(255, 255, 255, 0.03);
		scrollbar-width: none;
	}

	.gallery-modal-thumbs-desktop::-webkit-scrollbar {
		display: none;
	}

	.gallery-modal-thumbs-mobile {
		display: none;
	}

	.gallery-modal-thumb {
		position: relative;
		width: 78px;
		height: 78px;
		padding: 4px;
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 12px;
		background:
			linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.02)),
			rgba(255, 255, 255, 0.02);
		cursor: pointer;
		overflow: hidden;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.04),
			0 6px 12px rgba(0, 0, 0, 0.18);
		outline: none;
		transition:
			border-color 0.2s ease,
			transform 0.2s ease,
			box-shadow 0.2s ease,
			background-color 0.2s ease;
	}

	.gallery-modal-thumb::after {
		content: '';
		position: absolute;
		inset: 3px;
		border: 2px solid transparent;
		border-radius: 10px;
		pointer-events: none;
		transition:
			border-color 0.2s ease,
			opacity 0.2s ease;
	}

	.gallery-modal-thumb img {
		width: 100%;
		height: 100%;
		object-fit: contain;
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.04);
		display: block;
	}

	.gallery-modal-thumb.is-active {
		border-color: rgba(13, 202, 240, 0.38);
		background:
			linear-gradient(180deg, rgba(13, 202, 240, 0.14), rgba(13, 202, 240, 0.04)),
			rgba(255, 255, 255, 0.03);
		box-shadow:
			0 0 0 1px rgba(13, 202, 240, 0.18),
			0 10px 22px rgba(13, 202, 240, 0.16);
	}

	.gallery-modal-thumb.is-active::after {
		border-color: rgba(13, 202, 240, 0.95);
	}

	.gallery-modal-thumb:hover,
	.gallery-modal-thumb:focus-visible {
		transform: translateY(-1px);
		border-color: rgba(13, 202, 240, 0.3);
		box-shadow:
			0 0 0 1px rgba(13, 202, 240, 0.12),
			0 10px 18px rgba(0, 0, 0, 0.24);
	}

	.gallery-modal-thumb:hover::after,
	.gallery-modal-thumb:focus-visible::after {
		border-color: rgba(13, 202, 240, 0.5);
	}

	.gallery-stage-wrap {
		flex: 1;
		min-width: 0;
		position: relative;
		isolation: isolate;
		background: radial-gradient(circle at center, #151b22 10%, #0d1218 70%);
		border-radius: 14px;
		overflow: hidden;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.gallery-modal-image {
		position: relative;
		z-index: 1;
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		cursor: zoom-in;
	}

	.gallery-modal-image.is-zoomed {
		cursor: grab;
		touch-action: none;
	}

	.gallery-modal-image.is-panning {
		cursor: grabbing;
	}

	.gallery-pan {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		will-change: transform;
		max-width: 100%;
		max-height: 100%;
	}

	.gallery-modal-image img {
		max-width: 100%;
		max-height: 100%;
		object-fit: contain;
		transition: transform 0.18s ease;
		user-select: none;
		-webkit-user-drag: none;
	}

	.gallery-nav-btn {
		position: absolute;
		z-index: 3;
		top: 50%;
		transform: translateY(-50%);
		width: 44px;
		height: 44px;
		border: 1px solid rgba(255, 255, 255, 0.22);
		border-radius: 999px;
		background: rgba(18, 22, 28, 0.72);
		color: #fff;
		font-size: 1.65rem;
		line-height: 1;
		display: grid;
		place-items: center;
		pointer-events: auto;
		cursor: pointer;
		transition:
			background-color 0.2s ease,
			border-color 0.2s ease,
			transform 0.2s ease,
			opacity 0.2s ease;
	}

	.gallery-nav-prev {
		left: 14px;
	}

	.gallery-nav-next {
		right: 14px;
	}

	.gallery-nav-btn:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.22);
		border-color: rgba(255, 255, 255, 0.44);
		transform: translateY(-50%) scale(1.03);
	}

	.gallery-nav-btn:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	@media (max-width: 992px) {
		.gallery-modal {
			height: min(94dvh, 860px);
		}

		.gallery-modal-thumbs-desktop {
			width: 80px;
		}

		.gallery-modal-thumb {
			width: 66px;
			height: 66px;
		}
	}

	@media (max-width: 768px) {
		.gallery-overlay {
			--gallery-overlay-pad: 10px;
			padding-top: max(10px, env(safe-area-inset-top));
			padding-right: 10px;
			padding-bottom: max(10px, env(safe-area-inset-bottom));
			padding-left: 10px;
		}

		.gallery-modal {
			width: min(100%, 560px);
			height: min(92dvh, 820px);
			max-height: 100%;
			border-radius: 16px;
			border: 1px solid rgba(255, 255, 255, 0.14);
		}

		.gallery-modal-topbar {
			padding: 10px 12px;
		}

		.gallery-modal-toolbar {
			gap: 6px;
		}

		.gallery-toolbar-btn {
			height: 34px;
			min-width: 38px;
			padding: 0 10px;
			font-size: 0.86rem;
		}

		.gallery-modal-body {
			padding: 10px 0 0;
		}

		.gallery-modal-thumbs-desktop {
			display: none;
		}

		.gallery-modal-thumbs-mobile {
			display: flex;
			gap: 8px;
			overflow-x: auto;
			padding: 10px 12px calc(12px + env(safe-area-inset-bottom));
			background: rgba(13, 18, 24, 0.86);
			border-top: 1px solid rgba(255, 255, 255, 0.08);
			-webkit-overflow-scrolling: touch;
			scrollbar-width: none;
		}

		.gallery-modal-thumbs-mobile::-webkit-scrollbar {
			display: none;
		}

		.gallery-modal-thumbs-mobile .gallery-modal-thumb {
			flex: 0 0 auto;
			width: 58px;
			height: 58px;
			padding: 3px;
		}

		.gallery-nav-btn {
			width: 40px;
			height: 40px;
			font-size: 1.5rem;
		}

		.gallery-nav-prev {
			left: 10px;
		}

		.gallery-nav-next {
			right: 10px;
		}
	}

	.thumbnail-gallery {
		--thumb-accent: #0dcaf0;
		margin-top: 16px;
		display: block;
		width: 100%;
		max-width: 500px;
		position: relative;
		margin-left: auto;
		margin-right: auto;
		padding: 10px 42px;
		box-sizing: border-box;
		overflow: hidden;
		border-radius: 16px;
		border: 1px solid rgba(15, 20, 24, 0.08);
		background: linear-gradient(180deg, #ffffff, #f7fafc);
	}

	.thumbnail-gallery .swiper-wrapper {
		display: flex;
		gap: 10px;
		align-items: center;
		padding: 2px 0;
		overflow-x: auto;
		overflow-y: hidden;
		scroll-behavior: smooth;
		scrollbar-width: none;
		-webkit-overflow-scrolling: touch;
		scroll-snap-type: x proximity;
	}

	.thumbnail-gallery .swiper-wrapper::-webkit-scrollbar {
		display: none;
	}

	.thumbnail-gallery .swiper-slide {
		flex: 0 0 auto;
		scroll-snap-align: start;
	}

	.thumbnail-image {
		width: 68px;
		height: auto;
		aspect-ratio: 1 / 1;
		padding: 4px;
		border: 1px solid rgba(15, 20, 24, 0.08);
		border-radius: 14px;
		overflow: hidden;
		background: linear-gradient(180deg, rgba(255, 255, 255, 1), rgba(246, 249, 252, 1)), #fff;
		cursor: pointer;
		box-sizing: border-box;
		position: relative;
		display: grid;
		place-items: center;
		line-height: 0;
		outline: none;
		transition:
			border-color 0.2s ease,
			box-shadow 0.2s ease,
			transform 0.2s ease,
			background-color 0.2s ease;
	}

	.thumbnail-image::after {
		content: '';
		position: absolute;
		inset: 3px;
		border: 2px solid transparent;
		border-radius: 10px;
		pointer-events: none;
		transition:
			border-color 0.2s ease,
			box-shadow 0.2s ease;
	}

	.thumbnail-image::before {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(180deg, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0));
		pointer-events: none;
		opacity: 0.8;
	}

	.thumbnail-image:hover::after,
	.thumbnail-image:focus-visible::after {
		border-color: rgba(13, 202, 240, 0.7);
	}

	.thumbnail-image.is-active {
		border-color: rgba(13, 202, 240, 0.26);
		background: linear-gradient(180deg, rgba(13, 202, 240, 0.1), rgba(13, 202, 240, 0.02)), #ffffff;
		box-shadow: none;
	}

	.thumbnail-image.is-active::after {
		border-color: var(--thumb-accent);
		box-shadow: inset 0 0 0 1px rgba(13, 202, 240, 0.15);
	}

	.thumbnail-image:hover,
	.thumbnail-image:focus-visible {
		transform: translateY(-1px);
		border-color: rgba(13, 202, 240, 0.18);
		box-shadow: none;
	}

	.thumbnail-image img {
		width: 100%;
		height: 100%;
		object-fit: contain;
		border-radius: 10px;
		background: rgba(255, 255, 255, 0.95);
		display: block;
		opacity: 0.94;
		transition:
			opacity 0.2s ease,
			transform 0.2s ease;
	}

	.thumbnail-image:hover img,
	.thumbnail-image:focus-visible img,
	.thumbnail-image.is-active img {
		opacity: 1;
		transform: scale(0.985);
	}

	.thumb-swiper-nav {
		position: absolute;
		top: 50%;
		transform: translateY(-50%);
		width: 36px;
		height: 36px;
		padding: 0;
		border-radius: 50%;
		border: 1px solid rgba(15, 20, 24, 0.12);
		background: rgba(255, 255, 255, 0.92);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		color: #232323;
		display: grid;
		place-items: center;
		cursor: pointer;
		z-index: 3;
		transition:
			border-color 0.2s ease,
			color 0.2s ease,
			transform 0.2s ease,
			background-color 0.2s ease;
	}

	.thumb-swiper-nav:hover:not(:disabled),
	.thumb-swiper-nav:focus-visible:not(:disabled) {
		border-color: var(--thumb-accent);
		color: var(--thumb-accent);
		background: rgba(255, 255, 255, 0.98);
		transform: translateY(-50%) scale(1.04);
	}

	.thumb-swiper-prev {
		left: 2px;
	}

	.thumb-swiper-next {
		right: 2px;
	}

	.thumb-swiper-nav:disabled {
		opacity: 0.42;
		cursor: not-allowed;
	}

	@media (max-width: 768px) {
		.thumbnail-image {
			width: 60px;
			padding: 3px;
		}

		.gallery-container {
			max-width: 100%;
		}

		.thumbnail-gallery {
			max-width: 400px;
			padding: 8px 32px;
			border-radius: 14px;
		}

		.thumb-swiper-prev {
			left: 0;
		}

		.thumb-swiper-next {
			right: 0;
		}
	}

	.product-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		gap: 18px;
		align-items: start;
		margin-top: 24px;
	}

	.product-info {
		display: flex;
		flex-direction: column;
		padding: 1rem;
		gap: 6px;
	}

	.product-header {
		margin-bottom: 2px;
	}

	.product-title {
		margin-bottom: 0.25rem;
		line-height: 1.3;
	}

	.product-meta-row {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		align-items: center;
		font-size: 0.9rem;
	}

	.rating-summary {
		appearance: none;
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.45rem;
		max-width: 100%;
		padding: 0;
		border: 0;
		background: transparent;
		box-shadow: none;
		font: inherit;
		color: inherit;
		text-align: left;
		cursor: pointer;
		transition: color 0.18s ease;
	}

	.rating-summary:hover,
	.rating-summary:focus-visible {
		color: #1d4e63;
	}

	.rating-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.42rem 0.78rem;
		border: 1px solid rgba(29, 78, 99, 0.14);
		border-radius: 999px;
		background: rgba(231, 244, 248, 0.82);
		line-height: 1;
	}

	.rating-badge--empty {
		background: rgba(245, 247, 250, 0.98);
		border-color: rgba(123, 135, 148, 0.18);
	}

	.rating-summary-meta {
		font-size: 0.84rem;
		color: #7b8794;
		white-space: nowrap;
	}

	.rating-stars {
		display: flex;
		align-items: center;
		gap: 1px;
	}

	.rating-stars--summary {
		gap: 4px;
	}

	.rating-stars--compact .rating-star {
		width: 15px;
		height: 15px;
	}

	.rating-star {
		width: 15px;
		height: 15px;
	}

	.rating-star--filled,
	.rating-star--half {
		color: #f4b400;
	}

	.rating-star--empty {
		color: #d8dee5;
	}

	.rating-text {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 2px;
		color: #52606d;
		line-height: 1;
	}

	.rating-text--summary {
		font-size: 0.84rem;
	}

	.rating-text strong {
		color: #102a43;
		font-weight: 700;
	}

	.price-section {
		display: flex;
		align-items: baseline;
		gap: 4px;
		flex-wrap: wrap;
		margin: 0.4rem 0;
		padding: 0.4rem 0;
	}

	.options-section {
		margin: 0.4rem 0;
		padding-bottom: 2px;
	}

	.option-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.option-group {
		min-width: 120px;
	}

	.option-label {
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		margin-bottom: 4px;
		color: #5a5a5a;
	}

	.option-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}

	.option-btn {
		border-radius: 999px;
		padding: 4px 10px;
		border: 1px solid rgba(0, 0, 0, 0.12);
		background: #fff;
		font-size: 0.82rem;
	}

	.option-btn.active {
		background: #1f1a14;
		color: #fff;
		border-color: #1f1a14;
	}

	.variant-warning {
		margin: 8px 0 0;
		color: #b42318;
		font-weight: 600;
		font-size: 0.9rem;
	}

	.quantity-row {
		margin-top: 10px;
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.quantity-row.is-locked {
		opacity: 0.62;
	}

	.quantity-label {
		font-size: 0.9rem;
		font-weight: 600;
		color: #1f1a14;
	}

	.qty-control {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}

	.qty-input {
		width: 72px;
		text-align: center;
	}

	.qty-btn {
		width: 32px;
		height: 32px;
		border-radius: 999px;
		border: 1px solid rgba(31, 26, 20, 0.2);
		background: #fff;
		display: grid;
		place-items: center;
		font-weight: 700;
	}

	.action-buttons {
		display: flex;
		flex-direction: column;
		gap: 10px;
		width: 100%;
	}
	.action-buttons-mobile {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		display: flex !important;
		flex-direction: column;
		padding: 12px 14px calc(12px + env(safe-area-inset-bottom));
		background: #ffffff;
		border-top: 1px solid rgba(15, 20, 24, 0.08);
		box-shadow: 0 -12px 24px rgba(15, 20, 24, 0.14);
		z-index: 12000;
		opacity: 1 !important;
		visibility: visible !important;
		pointer-events: auto !important;
		transform: translateZ(0);
	}

	.action-buy-now,
	.action-secondary-row {
		display: flex;
		width: 100%;
	}

	.action-buy-now .action-form,
	.action-secondary-row .action-form {
		width: 100%;
	}

	.action-secondary-row {
		gap: 12px;
		align-items: stretch;
	}

	.product-action-spacer {
		display: none;
	}
	.product-action-spacer--on {
		display: block;
		height: calc(124px + env(safe-area-inset-bottom));
	}

	.product-meta {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: 8px;
		font-size: 0.9rem;
		color: #4c4c4c;
	}

	.product-meta .meta-item {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.product-meta .meta-label {
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.product-meta .meta-value {
		font-weight: 700;
	}

	.tab-button-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.5rem;
		height: 1.5rem;
		padding: 0 0.4rem;
		margin-left: 0.5rem;
		border-radius: 999px;
		background: rgba(29, 78, 99, 0.12);
		color: #1d4e63;
		font-size: 0.75rem;
		font-weight: 700;
	}

	.tab-content--reviews {
		scroll-margin-top: calc(var(--site-header-height, 88px) + 16px);
	}

	.product-faq-list {
		display: grid;
		gap: 0.75rem;
		margin-top: 2rem;
	}

	.product-faq-list h3 {
		margin: 0 0 0.25rem;
		color: #333333;
	}

	.product-faq-list details {
		border: 1px solid rgba(15, 23, 42, 0.12);
		border-radius: 12px;
		background: #ffffff;
		padding: 0.9rem 1rem;
	}

	.product-faq-list summary {
		cursor: pointer;
		color: #111827;
		font-weight: 800;
	}

	.product-faq-list p {
		margin: 0.65rem 0 0;
		color: #475569;
		line-height: 1.65;
	}

	.reviews-layout {
		display: grid;
		grid-template-columns: minmax(260px, 320px) minmax(0, 1fr);
		gap: 1.5rem;
		align-items: start;
	}

	.reviews-summary-card {
		position: sticky;
		top: calc(var(--site-header-height, 88px) + 20px);
		display: grid;
		gap: 1rem;
		padding: 1.35rem;
		border-radius: 22px;
		background: linear-gradient(180deg, rgba(29, 78, 99, 0.05) 0%, rgba(255, 255, 255, 0.98) 100%);
		border: 1px solid rgba(29, 78, 99, 0.12);
		box-shadow: 0 18px 40px rgba(15, 23, 42, 0.06);
	}

	.reviews-summary-score {
		display: grid;
		gap: 0.5rem;
	}

	.reviews-score-row {
		display: flex;
		align-items: baseline;
		gap: 0.35rem;
	}

	.reviews-score-value {
		font-size: clamp(2.4rem, 4vw, 3.2rem);
		font-weight: 800;
		line-height: 1;
		color: #102a43;
	}

	.reviews-score-scale {
		font-size: 1rem;
		font-weight: 700;
		color: #52606d;
	}

	.reviews-score-caption {
		margin: 0;
		font-size: 0.94rem;
		color: #52606d;
	}

	.reviews-progress-card {
		display: grid;
		gap: 0.5rem;
		padding: 0.9rem 1rem;
		border-radius: 16px;
		background: rgba(255, 255, 255, 0.9);
		border: 1px solid rgba(15, 23, 42, 0.08);
	}

	.reviews-progress-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		font-size: 0.9rem;
		color: #52606d;
	}

	.reviews-progress-header strong {
		color: #102a43;
		font-size: 1rem;
	}

	.reviews-progress-track {
		height: 10px;
		border-radius: 999px;
		background: rgba(15, 23, 42, 0.08);
		overflow: hidden;
	}

	.reviews-progress-track span {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: linear-gradient(90deg, #f4b400 0%, #ffcf5d 100%);
	}

	.reviews-metric-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.75rem;
	}

	.reviews-metric-card {
		display: grid;
		gap: 0.35rem;
		padding: 0.85rem 0.9rem;
		border-radius: 16px;
		background: #fff;
		border: 1px solid rgba(15, 23, 42, 0.08);
	}

	.reviews-metric-card span {
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #7b8794;
	}

	.reviews-metric-card strong {
		font-size: 1.25rem;
		color: #102a43;
	}

	.reviews-stream {
		display: grid;
		gap: 1rem;
	}

	.reviews-heading {
		display: grid;
		gap: 0.35rem;
	}

	.reviews-heading h3 {
		margin: 0;
		font-size: 1.3rem;
		color: #102a43;
	}

	.reviews-heading p {
		margin: 0;
		color: #52606d;
		line-height: 1.7;
	}

	.review-compose-card,
	.review-login-card,
	.review-locked-card {
		display: grid;
		gap: 0.9rem;
		padding: 1.2rem 1.25rem;
		border-radius: 20px;
		background: linear-gradient(180deg, rgba(255, 255, 255, 0.99) 0%, rgba(246, 249, 251, 1) 100%);
		border: 1px solid rgba(15, 23, 42, 0.08);
		box-shadow: 0 14px 32px rgba(15, 23, 42, 0.05);
	}

	.review-compose-head {
		display: grid;
		gap: 0.35rem;
	}

	.review-compose-head h4,
	.review-login-card strong,
	.review-locked-card strong {
		margin: 0;
		font-size: 1.02rem;
		color: #102a43;
	}

	.review-compose-head p,
	.review-login-card p,
	.review-locked-card p {
		margin: 0;
		color: #52606d;
		line-height: 1.65;
	}

	.review-form {
		display: grid;
		gap: 0.95rem;
	}

	.review-form-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.85rem;
	}

	.review-field {
		display: grid;
		gap: 0.45rem;
	}

	.review-field label {
		font-size: 0.82rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: #52606d;
	}

	.review-field-caption {
		font-size: 0.82rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: #52606d;
	}

	.review-input,
	.review-textarea,
	.review-file-input {
		width: 100%;
		border-radius: 14px;
		border: 1px solid rgba(15, 23, 42, 0.12);
		background: #fff;
		color: #102a43;
		padding: 0.78rem 0.9rem;
		font: inherit;
		transition:
			border-color 0.18s ease,
			box-shadow 0.18s ease;
	}

	.review-input[readonly] {
		background: rgba(242, 246, 249, 0.95);
		color: #52606d;
	}

	.review-input:focus,
	.review-textarea:focus,
	.review-file-input:focus {
		outline: none;
		border-color: rgba(29, 78, 99, 0.45);
		box-shadow: 0 0 0 3px rgba(29, 78, 99, 0.12);
	}

	.review-file-input {
		padding: 0.7rem 0.8rem;
	}

	.review-textarea {
		min-height: 148px;
		resize: vertical;
		line-height: 1.65;
	}

	.review-rating-group {
		display: flex;
		flex-wrap: wrap;
		gap: 0.65rem;
	}

	.review-rating-option {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.62rem 0.8rem;
		border-radius: 999px;
		border: 1px solid rgba(15, 23, 42, 0.12);
		background: #fff;
		cursor: pointer;
		transition:
			border-color 0.18s ease,
			background-color 0.18s ease,
			transform 0.18s ease;
	}

	.review-rating-option:hover,
	.review-rating-option.active {
		border-color: rgba(29, 78, 99, 0.32);
		background: rgba(231, 244, 248, 0.86);
		transform: translateY(-1px);
	}

	.review-rating-option input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}

	.rating-stars--selector {
		gap: 0;
	}

	.review-rating-value {
		font-size: 0.82rem;
		font-weight: 700;
		color: #102a43;
	}

	.review-inline-note {
		margin: 0;
		font-size: 0.88rem;
		color: #6b7a88;
		line-height: 1.6;
	}

	.review-form-notice {
		padding: 0.78rem 0.9rem;
		border-radius: 14px;
		font-weight: 600;
		line-height: 1.5;
	}

	.review-form-notice.success {
		background: rgba(17, 120, 100, 0.12);
		color: #117864;
		border: 1px solid rgba(17, 120, 100, 0.18);
	}

	.review-form-notice.error {
		background: rgba(180, 35, 24, 0.08);
		color: #b42318;
		border: 1px solid rgba(180, 35, 24, 0.12);
	}

	.review-image-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
		gap: 0.75rem;
	}

	.review-image-chip {
		position: relative;
		display: grid;
		gap: 0.45rem;
		padding: 0.5rem;
		border-radius: 16px;
		background: rgba(255, 255, 255, 0.95);
		border: 1px solid rgba(15, 23, 42, 0.1);
	}

	.review-image-chip img {
		width: 100%;
		aspect-ratio: 1;
		object-fit: cover;
		border-radius: 12px;
		background: rgba(226, 232, 240, 0.6);
	}

	.review-image-remove {
		border: none;
		border-radius: 999px;
		padding: 0.45rem 0.65rem;
		background: rgba(180, 35, 24, 0.08);
		color: #b42318;
		font-size: 0.8rem;
		font-weight: 700;
		cursor: pointer;
	}

	.review-image-remove:hover,
	.review-image-remove:focus-visible {
		background: rgba(180, 35, 24, 0.14);
	}

	.review-submit-button,
	.review-login-link {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		padding: 0.82rem 1.15rem;
		border-radius: 999px;
		border: none;
		background: #1d4e63;
		color: #fff;
		font-weight: 700;
		text-decoration: none;
		cursor: pointer;
		transition:
			transform 0.18s ease,
			box-shadow 0.18s ease,
			opacity 0.18s ease;
	}

	.review-submit-button:hover,
	.review-login-link:hover,
	.review-submit-button:focus-visible,
	.review-login-link:focus-visible {
		transform: translateY(-1px);
		box-shadow: 0 14px 28px rgba(29, 78, 99, 0.22);
	}

	.review-submit-button:disabled {
		opacity: 0.7;
		cursor: wait;
	}

	.review-list {
		display: grid;
		gap: 1rem;
	}

	.review-card,
	.reviews-empty-state {
		padding: 1.2rem 1.25rem;
		border-radius: 18px;
		background: linear-gradient(180deg, rgba(255, 255, 255, 0.98) 0%, rgba(248, 250, 252, 1) 100%);
		border: 1px solid rgba(15, 23, 42, 0.08);
		box-shadow: 0 12px 28px rgba(15, 23, 42, 0.04);
	}

	.review-card {
		display: grid;
		gap: 0.65rem;
	}

	.review-card-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}

	.review-author,
	.review-title,
	.reviews-empty-state h4 {
		margin: 0;
	}

	.review-author {
		font-size: 1rem;
		font-weight: 700;
		color: #102a43;
	}

	.review-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 0.75rem;
		margin-top: 0.25rem;
		font-size: 0.84rem;
		color: #7b8794;
	}

	.review-verified {
		display: inline-flex;
		align-items: center;
		padding: 0.18rem 0.55rem;
		border-radius: 999px;
		background: rgba(17, 120, 100, 0.1);
		color: #117864;
		font-weight: 700;
	}

	.review-title {
		font-size: 1.02rem;
		font-weight: 700;
		color: #1f2933;
	}

	.review-body,
	.reviews-empty-state p {
		margin: 0;
		color: #52606d;
		line-height: 1.75;
	}

	.review-gallery {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
		gap: 0.7rem;
		margin-top: 0.2rem;
	}

	.review-gallery-item {
		display: block;
		border-radius: 14px;
		overflow: hidden;
		border: 1px solid rgba(15, 23, 42, 0.08);
		background: rgba(255, 255, 255, 0.96);
	}

	.review-gallery-item img {
		display: block;
		width: 100%;
		aspect-ratio: 1;
		object-fit: cover;
	}

	.reviews-empty-state {
		display: grid;
		gap: 0.45rem;
	}

	.related-section .product-card-link {
		display: flex;
		flex-direction: column;
		height: 100%;
		gap: 0.2rem;
	}

	@media (min-width: 992px) {
		.related-section .product-swiper .swiper-wrapper {
			width: 100%;
		}

		.related-section .product-swiper .swiper-slide {
			width: 20% !important;
			flex: 0 0 20% !important;
		}
	}

	@media (max-width: 991.98px) {
		.related-section .product-swiper .swiper-slide {
			width: 248px !important;
		}
	}

	.related-section .product-card {
		height: 400px;
		max-height: 400px;
		display: flex;
		flex-direction: column;
		background: var(--product-card-bg, #ffffff);
		border: 1px solid var(--product-card-border, rgba(15, 23, 42, 0.12)) !important;
		border-radius: var(--product-card-radius, 0.75rem) !important;
		overflow: hidden;
		padding-top: 1rem !important;
		padding-bottom: 0.9rem !important;
	}

	.related-section .product-thumb {
		height: 150px;
		flex: 0 0 150px;
	}

	.related-section .card-concern {
		bottom: 120px;
	}

	@media (hover: hover) and (pointer: fine) {
		.related-section .card:hover .card-concern {
			bottom: 132px;
		}
	}

	.related-section .product-card-link h6 {
		font-size: 0.95rem;
		line-height: 1.3;
		color: var(--product-card-title-color, #111827);
		margin-top: 0.45rem !important;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		word-break: break-word;
		overflow-wrap: anywhere;
		min-height: calc(1.3em * 2);
	}

	.related-section .price-block {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 0.32rem;
		margin-top: 0.18rem !important;
	}

	.related-section .price-block .old-price {
		color: var(--product-card-old-price-color, #5b6470) !important;
		font-size: 0.86rem;
		line-height: 1.2;
		text-decoration: line-through;
	}

	.related-section .price-block .price {
		color: var(--product-card-price-color, var(--bs-primary));
		font-size: 1.08rem;
		line-height: 1.2;
	}

	.related-section .product-rating-row {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		color: #f59e0b;
		font-size: 0.78rem;
		font-weight: 800;
		line-height: 1.2;
	}

	.related-section .product-rating-row strong,
	.related-section .product-rating-row small {
		color: #334155;
		font-size: 0.76rem;
	}

	.related-section .product-desc-box {
		width: 100%;
		max-width: 100%;
		min-width: 0;
		flex: 1 1 auto;
		margin-top: 0.2rem;
		padding: 0.4rem 0.55rem;
		background: var(--product-card-desc-bg, #f3f4f6);
		border-radius: var(--product-card-desc-radius, 8px);
		overflow: hidden;
		box-sizing: border-box;
	}

	.related-section .product-desc {
		margin: 0;
		color: var(--product-card-desc-color, #334155);
		display: -webkit-box;
		-webkit-line-clamp: 6;
		-webkit-box-orient: vertical;
		overflow: hidden;
		font-size: 0.84rem;
		line-height: 1.35;
		word-break: break-word;
		overflow-wrap: anywhere;
		hyphens: auto;
	}

	@media (max-width: 768px) {
		.product-grid {
			grid-template-columns: 1fr;
			margin-bottom: 0px;
		}

		.product-meta-row {
			gap: 0.75rem;
		}

		.rating-summary {
			width: auto;
		}

		.price-section {
			flex-direction: column;
			align-items: flex-start;
		}

		.reviews-layout {
			grid-template-columns: 1fr;
		}

		.reviews-summary-card {
			position: static;
		}

		.review-form-grid {
			grid-template-columns: 1fr;
		}

		.review-rating-group {
			gap: 0.5rem;
		}

		.review-rating-option {
			width: 100%;
			justify-content: space-between;
		}

		.reviews-metric-grid {
			grid-template-columns: 1fr;
		}

		.review-card-head {
			flex-direction: column;
			gap: 0.65rem;
		}

		.related-section .product-card-link {
			gap: 0.18rem;
		}

		.related-section .product-swiper .swiper-slide {
			width: 182px !important;
		}

		.related-section .product-card {
			height: 350px;
			max-height: 350px;
			padding-top: 0.9rem !important;
			padding-bottom: 0.8rem !important;
		}

		.related-section .product-thumb {
			height: 116px;
			flex: 0 0 116px;
		}

		.related-section .card-concern {
			bottom: 92px;
		}

		.related-section .product-card-link h6 {
			font-size: 0.9rem;
			line-height: 1.28;
			min-height: calc(1.28em * 2);
			margin-top: 0.35rem !important;
		}

		.related-section .product-desc-box {
			margin-top: 0.16rem;
			padding: 6px 8px;
		}

		.related-section .price-block {
			display: block;
		}

		.related-section .product-desc {
			-webkit-line-clamp: 5;
			font-size: 0.8rem;
			line-height: 1.34;
		}

		.related-section .price-block .old-price {
			font-size: 0.79rem;
		}

		.related-section .price-block .price {
			font-size: 0.98rem;
		}

		.product-meta {
			grid-template-columns: 1fr;
		}

		.action-buttons {
			position: fixed;
			left: 0;
			right: 0;
			bottom: 0;
			display: flex !important;
			flex-direction: column;
			padding: 12px 14px calc(12px + env(safe-area-inset-bottom));
			background: #ffffff;
			border-top: 1px solid rgba(15, 20, 24, 0.08);
			box-shadow: 0 -12px 24px rgba(15, 20, 24, 0.14);
			z-index: 12000;
			opacity: 1 !important;
			visibility: visible !important;
			pointer-events: auto !important;
			transform: translateZ(0);
		}

		.action-buy-now,
		.action-secondary-row {
			width: 100%;
			gap: 8px;
		}

		.action-secondary-row {
			align-items: center;
		}

		.action-buttons :global(.btn-primary-action),
		.action-buttons :global(.btn-secondary-action) {
			min-width: 0;
			width: 100%;
			padding: 0.65rem 0.8rem;
			font-size: 0.85rem;
		}

		.product-action-spacer {
			display: block;
			height: calc(124px + env(safe-area-inset-bottom));
		}
	}

	@media (max-width: 480px) {
		.related-section .product-swiper .swiper-slide {
			width: 168px !important;
		}

		.related-section .product-card {
			height: 320px;
			max-height: 320px;
		}

		.related-section .product-thumb {
			height: 108px;
			flex: 0 0 108px;
		}

		.related-section .card-concern {
			bottom: 84px;
		}
	}
</style>
