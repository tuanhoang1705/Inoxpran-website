<script>
	import { onMount, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import { env } from '$env/dynamic/public';
	import { locale, t } from '$lib/i18n/index.js';
	import { flyToCart } from '$lib/client/flyToCart.js';
	import { addGuestCartItem } from '$lib/client/guestCart.js';
	import { syncCartCountFromActionResult } from '$lib/client/cartCountSync.js';
	import { cartToast } from '$lib/stores/cartToast.js';
	import { getMarketingRatingSummary } from '$lib/data/staticReviews.js';
	import { localizeInternalHref } from '$lib/utils/localePath.js';
	let { data } = $props();
	const heroCompositeVersion = '20260626';
	const heroCompositeUrl = `/images/optimized/hero-fan-1920.jpg?v=${heroCompositeVersion}`;
	const heroCompositeJpgSrcSet = `/images/optimized/hero-fan-960.jpg?v=${heroCompositeVersion} 960w, /images/optimized/hero-fan-1440.jpg?v=${heroCompositeVersion} 1440w, /images/optimized/hero-fan-1920.jpg?v=${heroCompositeVersion} 1920w`;
	const heroCompositeSizes = '100vw';
	const cookwareHeroVersion = '20260626';
	const cookwareHeroUrl = `/images/optimized/hero-cookware-1875.jpg?v=${cookwareHeroVersion}`;
	const cookwareHeroJpgSrcSet = `/images/optimized/hero-cookware-960.jpg?v=${cookwareHeroVersion} 960w, /images/optimized/hero-cookware-1440.jpg?v=${cookwareHeroVersion} 1440w, /images/optimized/hero-cookware-1875.jpg?v=${cookwareHeroVersion} 1875w`;
	const cookwareHeroSizes = '100vw';
	const inoxSlideImageSizes = '(max-width: 900px) 100vw, (max-width: 1280px) 680px, 760px';
	const BLANK_IMAGE_DATA_URL =
		'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
	const homeProductCardImageSizes = '(max-width: 576px) 50vw, (max-width: 992px) 33vw, 25vw';
	const categoryImageSizes = '(max-width: 768px) 33vw, 33vw';
	const latestPostImageSizes = '(max-width: 768px) 50vw, 25vw';
	const CLIENT_HOME_FEED_TIMEOUT_MS = 1_500;
	const DEFAULT_SITE_URL = 'https://inoxpran.com';
	const normalizeSiteUrl = (value) => {
		const raw = String(value || '').trim();
		if (!raw) return DEFAULT_SITE_URL;
		return raw.replace(/\/+$/, '');
	};
	const truncateMeta = (value, limit = 160) => {
		const text = String(value || '').trim();
		if (!text) return '';
		if (text.length <= limit) return text;
		return `${text.slice(0, limit - 3).trim()}...`;
	};
	const escapeJsonLd = (value) =>
		String(value || '')
			.replace(/</g, '\\u003c')
			.replace(/>/g, '\\u003e')
			.replace(/&/g, '\\u0026')
			.replace(/\u2028/g, '\\u2028')
			.replace(/\u2029/g, '\\u2029');
	const handleLatestPostClick = (event, href) => {
		if (event?.target?.closest?.('a')) return;
		goto(href);
	};
	const handleLatestPostKeydown = (event, href) => {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		goto(href);
	};
	const normalizeAssetIndex = (value, max, fallback = 1) => {
		const parsed = Number.parseInt(String(value || ''), 10);
		if (!Number.isFinite(parsed) || parsed < 1) return fallback;
		return ((parsed - 1) % max) + 1;
	};
	const categoryMedia = {
		inox: {
			fallback: '/images/category1.jpg',
			avifSrcSet:
				'/images/optimized/category1-360.avif 360w, /images/optimized/category1-720.avif 720w',
			webpSrcSet:
				'/images/optimized/category1-360.webp 360w, /images/optimized/category1-720.webp 720w'
		},
		castIron: {
			fallback: '/images/category2.jpg',
			avifSrcSet:
				'/images/optimized/category2-360.avif 360w, /images/optimized/category2-720.avif 720w',
			webpSrcSet:
				'/images/optimized/category2-360.webp 360w, /images/optimized/category2-720.webp 720w'
		},
		electronics: {
			fallback: '/images/category3.jpg',
			avifSrcSet:
				'/images/optimized/category3-360.avif 360w, /images/optimized/category3-720.avif 720w',
			webpSrcSet:
				'/images/optimized/category3-360.webp 360w, /images/optimized/category3-720.webp 720w'
		}
	};

	const fallbackThumbs = [
		'/images/optimized/product-item1-640.webp',
		'/images/optimized/product-item2-640.webp',
		'/images/optimized/product-item3-640.webp',
		'/images/optimized/product-item4-640.webp',
		'/images/optimized/product-item5-640.webp',
		'/images/optimized/product-item6-640.webp'
	];
	const blogFallbackImages = [
		'/images/post-item1.jpg',
		'/images/post-item2.jpg',
		'/images/post-item3.jpg',
		'/images/post-item4.jpg'
	];
	const defaultInoxAdSlides = [
		{
			id: 'default-1',
			imageUrl: '/images/optimized/structure6-960.png',
			linkUrl: '/shop',
			altVi: 'Bộ nồi inox Inoxpran cho căn bếp hiện đại',
			altEn: 'Inoxpran stainless cookware for modern kitchens'
		},
		{
			id: 'default-2',
			imageUrl: '/images/category1.jpg',
			linkUrl: '/category/noi-inox',
			altVi: 'Khám phá dòng nồi inox Inoxpran',
			altEn: 'Explore Inoxpran stainless cookware collection'
		},
		{
			id: 'default-3',
			imageUrl: '/images/category3.jpg',
			linkUrl: '/shop',
			altVi: 'Gia dụng bếp tiện lợi cho gia đình',
			altEn: 'Kitchen appliances for everyday family cooking'
		}
	];
	// ✅ Toast state
	let toastUnlockId = $state(null);

	// ✅ per-product button feedback
	let addingId = $state(null);
	let addedId = $state(null);
	let lockedAddIds = $state(new Set());

	let bestSelling = $state(Array.isArray(data?.bestSelling) ? data.bestSelling : []);
	let latestPosts = $state(Array.isArray(data?.latestPosts) ? data.latestPosts.slice(0, 4) : []);
	let apiError = $state(String(data?.apiError || ''));
	let isHomeFeedLoading = $state(!Boolean(data?.homeFeedLoaded));
	let heroSceneEl = null;
	let kineticSphereEl = null;
	let heroMotionReduced = $state(false);
	let isHomeCardMobileViewport = $state(
		typeof window !== 'undefined' ? window.matchMedia('(max-width: 768px)').matches : false
	);
	const isAuthenticated = $derived(Boolean(data?.user));
	const showDiscountBadge = $derived(Boolean(data?.siteFeatures?.showDiscountBadge));
	const siteUrl = $derived(normalizeSiteUrl(env.PUBLIC_SITE_URL));
	const seoTitle = $derived($t('home.title'));
	const seoDescription = $derived(truncateMeta($t('site.description')));
	const ogUrl = $derived.by(
		() => `${siteUrl}${page.url?.pathname || '/'}${page.url?.search || ''}`
	);
	const ogImageUrl = $derived(`${siteUrl}/og-image.png`);
	const homePageJsonLd = $derived.by(() =>
		JSON.stringify({
			'@context': 'https://schema.org',
			'@type': 'WebPage',
			'@id': `${siteUrl}/#home-page`,
			name: seoTitle,
			url: `${siteUrl}${page.url?.pathname || '/'}`,
			description: seoDescription,
			inLanguage: $locale === 'en' ? 'en-US' : 'vi-VN',
			isPartOf: {
				'@id': `${siteUrl}/#website`
			},
			about: {
				'@id': `${siteUrl}/#organization`
			},
			primaryImageOfPage: {
				'@type': 'ImageObject',
				url: ogImageUrl
			}
		})
	);
	const homeInoxSlides = $derived.by(() => {
		const configuredSlides = Array.isArray(data?.siteHomeSlides) ? data.siteHomeSlides : [];
		const normalized = configuredSlides
			.map((slide, index) => ({
				id: String(slide?.id || `slide-${index + 1}`),
				imageUrl: String(slide?.imageUrl || '').trim(),
				linkUrl: String(slide?.linkUrl || '').trim() || '',
				isHeroBackground: slide?.isHeroBackground === true,
				alt:
					($locale === 'en'
						? String(slide?.altEn || '').trim()
						: String(slide?.altVi || '').trim()) ||
					String(slide?.altVi || slide?.altEn || '').trim()
			}))
			.filter((slide) => slide.imageUrl);

		const source = normalized.length ? normalized : defaultInoxAdSlides;
		return source.map((slide, index) => ({
			id: String(slide.id || `fallback-${index + 1}`),
			imageUrl: String(slide.imageUrl || '').trim(),
			linkUrl: String(slide.linkUrl || '').trim() || '',
			isHeroBackground: slide.isHeroBackground === true,
			alt:
				String(slide.alt || '').trim() ||
				($locale === 'en'
					? `Inoxpran home promotion slide ${index + 1}`
					: `Slide quảng cáo Inoxpran ${index + 1}`)
		}));
	});
	const heroBackgroundSlide = $derived.by(
		() => homeInoxSlides.find((slide) => slide.isHeroBackground) || null
	);
	const heroBackgroundUrl = $derived(heroBackgroundSlide?.imageUrl || heroCompositeUrl);
	const heroBackgroundAlt = $derived(
		heroBackgroundSlide?.alt ||
			($locale === 'en'
				? 'Inoxpran premium cookware for modern kitchens'
				: 'Gia dụng Inoxpran cao cấp cho căn bếp hiện đại')
	);
	const heroIntroCopy = $derived.by(() =>
		$locale === 'en'
			? {
					eyebrow: 'THE INOXPRAN STANDARD',
					lead: 'Inoxpran stainless homeware.',
					emphasis: 'Built for lasting everyday family cooking.',
					cta: 'Shop the collection',
					storyCta: 'Our Italian story'
				}
			: {
					eyebrow: 'TINH TH\u1ea6N INOXPRAN',
					lead: 'Gia d\u1ee5ng inox Inoxpran.',
					emphasis: 'B\u1ec1n b\u1ec9 cho c\u0103n b\u1ebfp gia \u0111\u00ecnh Vi\u1ec7t.',
					cta: 'Kh\u00e1m ph\u00e1 b\u1ed9 s\u01b0u t\u1eadp',
					storyCta: 'C\u00e2u chuy\u1ec7n Italy'
				}
	);
	const cookwareIntroCopy = $derived.by(() =>
		$locale === 'en'
			? {
					eyebrow: 'INOXPRAN HOMEWARE',
					lead: 'Official Inoxpran homeware for Vietnam.',
					emphasis: 'European stainless elegance, made for daily family cooking.',
					cta: 'Learn about Inoxpran',
					storyCta: 'Shop homeware'
				}
			: {
					eyebrow: 'TH\u01af\u01a0NG HI\u1ec6U INOXPRAN',
					lead: 'Website ch\u00ednh th\u1ee9c c\u1ee7a gia d\u1ee5ng Inoxpran t\u1ea1i Vi\u1ec7t Nam.',
					emphasis:
						'Inox s\u00e1ng g\u01b0\u01a1ng, t\u1ed1i gi\u1ea3n v\u00e0 b\u1ec1n b\u1ec9 cho gian b\u1ebfp gia \u0111\u00ecnh.',
					cta: 'T\u00ecm hi\u1ec3u v\u1ec1 Inoxpran',
					storyCta: 'Mua gia d\u1ee5ng Inoxpran'
				}
	);
	const kineticBandPhrase = $derived($locale === 'en' ? 'For Every Family' : 'Dành Cho Gia Đình');
	const kineticBandRepeats = [0, 1, 2, 3];
	const inoxProof = $derived(
		$locale === 'en'
			? {
					eyebrow: 'Material & Technology',
					heading: 'For Every Family',
					subhead: 'Built to last in every Vietnamese kitchen',
					paragraph:
						'INOXPRAN focuses on safe materials, effective performance with real energy savings, and easy-to-use design for the rhythm of modern family life.'
				}
			: {
					eyebrow: 'Chất liệu & Công nghệ',
					heading: 'Dành cho gia đình',
					subhead: 'Bền bỉ trong từng căn bếp Việt',
					paragraph:
						'INOXPRAN tập trung vào vật liệu an toàn, sử dụng hiệu năng và tiết kiệm năng lượng hiệu quả, thiết kế dễ sử dụng cho nhịp sống gia đình hiện đại.'
				}
	);
	const inoxStats = $derived(
		$locale === 'en'
			? [
					{ id: 'stat-layers', target: '5', suffix: '', star: true, label: 'Energy saving' },
					{
						id: 'stat-grade',
						target: '20',
						suffix: ' yrs',
						star: false,
						label: 'Average lifespan'
					},
					{
						id: 'stat-warranty',
						target: '03',
						suffix: 'x',
						star: false,
						label: 'Superior material vs others'
					}
				]
			: [
					{ id: 'stat-layers', target: '5', suffix: '', star: true, label: 'Tiết kiệm năng lượng' },
					{
						id: 'stat-grade',
						target: '20',
						suffix: ' năm',
						star: false,
						label: 'Tuổi thọ trung bình'
					},
					{
						id: 'stat-warranty',
						target: '03',
						suffix: ' lần',
						star: false,
						label: 'Chất liệu vượt trội so với sản phẩm khác'
					}
				]
	);
	const inoxOrbitItems = $derived(
		$locale === 'en'
			? ['Safe material', 'Durable daily', 'Easy to clean', 'Many stoves']
			: ['An toàn vật liệu', 'Bền bỉ mỗi ngày', 'Dễ vệ sinh', 'Phù hợp nhiều bếp']
	);
	let activeInoxSlideIndex = $state(0);
	let isInoxSliderPaused = $state(false);
	let isInoxSliderNearViewport = $state(false);
	let loadedInoxSlideImageIds = $state([]);
	let inoxSliderViewportEl = null;

	const normalizeLoopIndex = (index, total) => ((Number(index) % total) + total) % total;
	const inoxSlidePanelId = (slideId) => `inox-slide-panel-${String(slideId || '')}`;
	const inoxSlideTabId = (slideId) => `inox-slide-tab-${String(slideId || '')}`;

	const rememberInoxSlideImage = (index) => {
		const total = homeInoxSlides.length;
		if (!total) return;
		const normalized = normalizeLoopIndex(index, total);
		const id = String(homeInoxSlides[normalized]?.id || '').trim();
		if (!id || loadedInoxSlideImageIds.includes(id)) return;
		loadedInoxSlideImageIds = [...loadedInoxSlideImageIds, id];
	};

	const shouldLoadInoxSlideImage = (slide, slideIndex) => {
		if (!isInoxSliderNearViewport) return false;
		const slideId = String(slide?.id || '').trim();
		if (slideId && loadedInoxSlideImageIds.includes(slideId)) return true;
		const total = homeInoxSlides.length;
		if (!total) return false;
		const active = normalizeLoopIndex(activeInoxSlideIndex, total);
		const next = normalizeLoopIndex(active + 1, total);
		return slideIndex === active || slideIndex === next;
	};

	const goToInoxSlide = (nextIndex) => {
		const total = homeInoxSlides.length;
		if (!total) return;
		const normalized = ((Number(nextIndex) % total) + total) % total;
		activeInoxSlideIndex = normalized;
	};

	const showPrevInoxSlide = () => {
		goToInoxSlide(activeInoxSlideIndex - 1);
	};

	const showNextInoxSlide = () => {
		goToInoxSlide(activeInoxSlideIndex + 1);
	};

	const handleInoxSlideImageClick = () => {
		if (homeInoxSlides.length <= 1) return;
		showNextInoxSlide();
	};

	$effect(() => {
		if (!homeInoxSlides.length) {
			activeInoxSlideIndex = 0;
			return;
		}
		if (activeInoxSlideIndex >= homeInoxSlides.length) {
			activeInoxSlideIndex = 0;
		}
	});

	$effect(() => {
		if (!loadedInoxSlideImageIds.length) return;
		const validIds = new Set(
			homeInoxSlides.map((slide) => String(slide?.id || '').trim()).filter(Boolean)
		);
		const filtered = loadedInoxSlideImageIds.filter((id) => validIds.has(id));
		if (filtered.length !== loadedInoxSlideImageIds.length) {
			loadedInoxSlideImageIds = filtered;
		}
	});

	$effect(() => {
		if (!isInoxSliderNearViewport) return;
		if (!homeInoxSlides.length) return;
		rememberInoxSlideImage(activeInoxSlideIndex);
		rememberInoxSlideImage(activeInoxSlideIndex + 1);
	});

	$effect(() => {
		if (!$cartToast.visible && toastUnlockId) {
			unlockAddId(toastUnlockId);
			toastUnlockId = null;
		}
	});

	const pulseAdded = (productId) => {
		addedId = productId;
		setTimeout(() => {
			if (addedId === productId) addedId = null;
		}, 900);
	};

	const isAddLocked = (id) => {
		if (!id) return false;
		return lockedAddIds.has(String(id));
	};

	const lockAddId = (id) => {
		if (!id) return;
		const next = new Set(lockedAddIds);
		next.add(String(id));
		lockedAddIds = next;
	};

	const unlockAddId = (id) => {
		if (!id) return;
		const next = new Set(lockedAddIds);
		next.delete(String(id));
		lockedAddIds = next;
	};

	const FLY_TO_CART_Y_OFFSET = -60;
	const FLY_TO_CART_X_OFFSET = -50;

	const formatPrice = (value) => {
		if (value === null || value === undefined || value === '') return '';
		const numeric = Number(value);
		if (Number.isNaN(numeric)) return '';
		const localeValue = $locale === 'en' ? 'en-US' : 'vi-VN';
		return `${new Intl.NumberFormat(localeValue).format(numeric)}${$t('common.currency')}`;
	};

	const getDiscountPercent = (product) => {
		if (
			product?.product_original_price === null ||
			product?.product_original_price === undefined ||
			product?.product_original_price === '' ||
			product?.product_price === null ||
			product?.product_price === undefined ||
			product?.product_price === ''
		) {
			return '';
		}
		const originalPrice = Number(product?.product_original_price);
		const salePrice = Number(product?.product_price);
		if (!Number.isFinite(originalPrice) || !Number.isFinite(salePrice)) return '';
		if (originalPrice <= 0 || salePrice <= 0 || salePrice >= originalPrice) return '';
		return Math.round(((originalPrice - salePrice) / originalPrice) * 100);
	};

	const getOriginalPrice = (product) => {
		if (product?.product_original_price === null || product?.product_original_price === undefined) {
			return '';
		}
		const originalPrice = Number(product?.product_original_price);
		const salePrice = Number(product?.product_price);
		if (!Number.isFinite(originalPrice) || originalPrice <= 0) return '';
		if (Number.isFinite(salePrice) && salePrice >= originalPrice) return '';
		return formatPrice(originalPrice);
	};

	const truncate = (text, limit = 260) => {
		if (!text) return '';
		if (text.length <= limit) return text;
		return `${text.slice(0, limit).trim()}...`;
	};

	const truncateAtWordBoundary = (text, limit = 260) => {
		if (!text) return '';
		if (text.length <= limit) return text;
		const sliced = text.slice(0, limit);
		const wordBoundary = sliced.lastIndexOf(' ');
		const safeSlice =
			wordBoundary > Math.floor(limit * 0.6) ? sliced.slice(0, wordBoundary) : sliced;
		return `${safeSlice.trim()}...`;
	};

	const truncateWords = (value, limit) => {
		const text = stripHtml(value).replace(/\s+/g, ' ').trim();
		if (!text) return '';
		const words = text.split(' ').filter(Boolean);
		if (words.length <= limit) return text;
		return `${words.slice(0, limit).join(' ')}...`;
	};

	const stripHtml = (value) => {
		if (!value) return '';
		return value
			.replace(/<[^>]*>/g, ' ')
			.replace(/&nbsp;/gi, ' ')
			.replace(/\s+/g, ' ')
			.trim();
	};

	const normalizeLegacyProductImage = (value) => {
		const raw = String(value || '').trim();
		if (!raw) return '';
		let decoded = raw;
		try {
			decoded = decodeURIComponent(raw);
		} catch {
			decoded = raw;
		}
		const productItemMatch = decoded.match(/product-item(\d+)(?:-\d+)?\.(?:png|webp|avif)/i);
		if (productItemMatch) {
			const normalizedIndex = normalizeAssetIndex(productItemMatch[1], fallbackThumbs.length, 1);
			return `/images/optimized/product-item${normalizedIndex}-640.webp`;
		}
		const productLargeMatch = decoded.match(/product-large-(\d+)(?:-\d+)?\.(?:png|webp|avif)/i);
		if (productLargeMatch) {
			const normalizedIndex = normalizeAssetIndex(productLargeMatch[1], 3, 1);
			return `/images/optimized/product-large-${normalizedIndex}-1200.webp`;
		}
		const productThumbnailMatch = decoded.match(
			/product-thumbnail-(\d+)(?:-\d+)?\.(?:png|webp|avif)/i
		);
		if (productThumbnailMatch) {
			const normalizedIndex = normalizeAssetIndex(
				productThumbnailMatch[1],
				fallbackThumbs.length,
				1
			);
			return `/images/optimized/product-item${normalizedIndex}-640.webp`;
		}
		return raw;
	};

	const resolveThumb = (thumb, index) => {
		if (typeof thumb === 'string' && thumb.trim()) return normalizeLegacyProductImage(thumb);
		return fallbackThumbs[index % fallbackThumbs.length];
	};

	const getProductName = (product, index) =>
		product?.product_name || $t('common.sampleProduct', { index: index + 1 });

	const getProductDescription = (product) => {
		const description = stripHtml(product?.product_description || '');
		if (description) {
			const limit = isHomeCardMobileViewport ? 520 : 900;
			return truncateAtWordBoundary(description, limit);
		}
		return $t('common.stainlessPremium');
	};

	const getProductHref = (product) => {
		const slug = product?.product_slug || product?.slug || product?._id;
		return slug
			? localizeInternalHref(`/product/${slug}`, $locale)
			: localizeInternalHref('/shop', $locale);
	};

	const toGuestCartProduct = (product, index = 0) => ({
		productId: product?._id,
		name: getProductName(product, index),
		price: Number(product?.product_price) || 0,
		originalPrice: Number(product?.product_original_price) || 0,
		image: resolveThumb(product?.product_thumb, index),
		href: getProductHref(product),
		weight: Number(product?.product_weight) || 1000,
		shopId: product?.product_shop || product?.shopId || ''
	});

	const getBlogHref = (post) => {
		const slug = String(post?.slug || '').trim();
		return slug
			? localizeInternalHref(`/blog/${slug}`, $locale)
			: localizeInternalHref('/blog', $locale);
	};

	const getBlogImage = (post, index) => {
		const image = String(post?.image || '').trim();
		if (!image) return blogFallbackImages[index % blogFallbackImages.length];
		let decoded = image;
		try {
			decoded = decodeURIComponent(image);
		} catch {
			decoded = image;
		}
		const match = decoded.match(/post-item(\d+)\.jpg/i);
		if (!match) return image;
		const normalizedIndex = normalizeAssetIndex(match[1], blogFallbackImages.length, 1);
		return `/images/post-item${normalizedIndex}.jpg`;
	};

	const getPostItemWebpSrcSet = (imageValue) => {
		const raw = String(imageValue || '').trim();
		if (!raw) return '';
		let decoded = raw;
		try {
			decoded = decodeURIComponent(raw);
		} catch {
			decoded = raw;
		}
		const match = decoded.match(/post-item(\d+)\.jpg/i);
		if (!match) return '';
		const key = `post-item${normalizeAssetIndex(match[1], blogFallbackImages.length, 1)}`;
		return `/images/optimized/${key}-360.webp 360w, /images/optimized/${key}-720.webp 720w`;
	};

	const getPostItemAvifSrcSet = (imageValue) => {
		const raw = String(imageValue || '').trim();
		if (!raw) return '';
		let decoded = raw;
		try {
			decoded = decodeURIComponent(raw);
		} catch {
			decoded = raw;
		}
		const match = decoded.match(/post-item(\d+)\.jpg/i);
		if (!match) return '';
		const key = `post-item${normalizeAssetIndex(match[1], blogFallbackImages.length, 1)}`;
		return `/images/optimized/${key}-360.avif 360w, /images/optimized/${key}-720.avif 720w`;
	};

	const getProductCardWebpSrcSet = (imageValue) => {
		const raw = String(imageValue || '').trim();
		if (!raw) return '';
		let decoded = raw;
		try {
			decoded = decodeURIComponent(raw);
		} catch {
			decoded = raw;
		}
		const match = decoded.match(/product-item(\d+)(?:-\d+)?\.(?:png|webp|avif)/i);
		if (!match) return '';
		const key = `product-item${normalizeAssetIndex(match[1], fallbackThumbs.length, 1)}`;
		return `/images/optimized/${key}-320.webp 320w, /images/optimized/${key}-640.webp 640w`;
	};

	const getProductCardAvifSrcSet = (imageValue) => {
		const raw = String(imageValue || '').trim();
		if (!raw) return '';
		let decoded = raw;
		try {
			decoded = decodeURIComponent(raw);
		} catch {
			decoded = raw;
		}
		const match = decoded.match(/product-item(\d+)(?:-\d+)?\.(?:png|webp|avif)/i);
		if (!match) return '';
		const key = `product-item${normalizeAssetIndex(match[1], fallbackThumbs.length, 1)}`;
		return `/images/optimized/${key}-320.avif 320w, /images/optimized/${key}-640.avif 640w`;
	};

	const getBlogCategory = (post) => {
		const key = String(post?.categoryKey || '').trim();
		const labels = {
			guide: $t('blog.categoryGuide'),
			care: $t('blog.categoryCare'),
			knowledge: $t('blog.categoryKnowledge'),
			trend: $t('blog.categoryTrend'),
			product: $t('blog.categoryProduct'),
			design: $t('blog.categoryDesign')
		};
		return labels[key] || $t('blog.categoryAll');
	};

	const getBlogCategoryHref = (post) => {
		const key = String(post?.categoryKey || '').trim();
		if (!key) return '/blog';
		const query = new URLSearchParams({ category: key }).toString();
		return `/blog?${query}`;
	};

	const getBlogCategoryLinkLabel = (post) => {
		const categoryLabel = getBlogCategory(post);
		if ($locale === 'en') return `Blog category: ${categoryLabel}`;
		return `Chuyên mục blog: ${categoryLabel}`;
	};

	const getBlogExcerpt = (post) => truncate(stripHtml(post?.excerpt || ''), 140);

	const noLatestPostsText = $derived(
		apiError || ($locale === 'en' ? 'No latest posts yet.' : 'Hiện chưa có bài đăng mới nhất nào')
	);
	const noBestSellingText = $derived(
		apiError || ($locale === 'en' ? 'No featured products yet.' : 'Hiện chưa có sản phẩm nổi bật')
	);

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

	const loadHomeFeed = async () => {
		if (typeof window === 'undefined') return;
		const controller = new AbortController();
		let timeoutId = null;
		isHomeFeedLoading = true;
		try {
			timeoutId = window.setTimeout(() => controller.abort(), CLIENT_HOME_FEED_TIMEOUT_MS);
			const response = await fetch('/api/home-feed', {
				method: 'GET',
				headers: { accept: 'application/json' },
				signal: controller.signal
			});
			if (!response.ok) {
				throw new Error(`home-feed failed with status ${response.status}`);
			}
			const payload = await response.json();
			if (!payload?.success) {
				throw new Error('home-feed returned unsuccessful payload');
			}
			bestSelling = Array.isArray(payload?.bestSelling) ? payload.bestSelling : [];
			latestPosts = Array.isArray(payload?.latestPosts) ? payload.latestPosts.slice(0, 4) : [];
			apiError = '';
		} catch {
			bestSelling = [];
			latestPosts = [];
			apiError = $t('common.errors.productRequestFailed');
		} finally {
			if (timeoutId) window.clearTimeout(timeoutId);
			isHomeFeedLoading = false;
		}
	};

	const createAddToCartEnhance = (product) => {
		return ({ form, submitter, cancel }) => {
			cartToast.hide();

			const productId = product?._id;
			if (!productId) {
				cancel();
				return;
			}

			if (!isAuthenticated) {
				cancel();
				addGuestCartItem(toGuestCartProduct(product), 1);
				lockAddId(productId);
				setTimeout(() => pulseAdded(productId), 120);
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

			if (addingId || isAddLocked(productId)) {
				cancel();
				return;
			}

			addingId = productId;
			const card = form?.closest('.product-card') || form?.closest('.card');
			const img = card?.querySelector('img');

			return async ({ result }) => {
				addingId = null;

				if (result?.type === 'success') {
					lockAddId(productId);
					setTimeout(() => pulseAdded(productId), 120);
					if (toastUnlockId && toastUnlockId !== productId) {
						unlockAddId(toastUnlockId);
					}
					toastUnlockId = productId;
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

	// Hero parallax driven by GSAP + ScrollTrigger (scrub-linked to scroll, no pinning).
	// All motion is transform/opacity only and is wrapped in gsap.matchMedia() so it adapts
	// per breakpoint and is fully disabled under prefers-reduced-motion.
	onMount(() => {
		if (typeof window === 'undefined') return;

		const heroEl = heroSceneEl;
		const reduceMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

		let cancelled = false;
		let mm = null;
		let scrollTrigger = null;
		let refreshTimer = 0;
		let onLenisReady = null;
		let lenisScrollHandler = null;

		const handleRefresh = () => {
			scrollTrigger?.refresh();
		};

		const applyReducedState = () => {
			const reduced = reduceMotionQuery.matches;
			heroMotionReduced = reduced;
			// Pre-hide the incoming scene-two copy only while motion is enabled, so there is no
			// flash of fully-opaque text before GSAP takes over. Reduced motion keeps it visible.
			if (heroEl) heroEl.classList.toggle('hero-gsap-ready', !reduced);
		};

		applyReducedState();

		const setupGsap = async () => {
			if (!heroEl) return;
			let gsapMod;
			let scrollTriggerMod;
			try {
				[gsapMod, scrollTriggerMod] = await Promise.all([
					import('gsap'),
					import('gsap/ScrollTrigger')
				]);
			} catch {
				if (heroEl) heroEl.classList.remove('hero-gsap-ready');
				return;
			}
			if (cancelled) {
				if (heroEl) heroEl.classList.remove('hero-gsap-ready');
				return;
			}

			const gsap = gsapMod.gsap ?? gsapMod.default;
			const ScrollTrigger = scrollTriggerMod.ScrollTrigger ?? scrollTriggerMod.default;
			gsap.registerPlugin(ScrollTrigger);
			scrollTrigger = ScrollTrigger;

			// Keep ScrollTrigger perfectly in sync with Lenis' smoothed scroll position.
			lenisScrollHandler = () => ScrollTrigger.update();
			const connectLenis = () => {
				const lenis = window.__lenis;
				if (!lenis?.on) return false;
				lenis.on('scroll', lenisScrollHandler);
				ScrollTrigger.refresh();
				return true;
			};
			if (!connectLenis()) {
				onLenisReady = () => connectLenis();
				window.addEventListener('inoxpran:lenis-ready', onLenisReady, { once: true });
			}

			const sectionOne = heroEl.querySelector('.hero-flow-section--one');
			const sectionTwo = heroEl.querySelector('.hero-flow-section--two');
			if (!sectionOne || !sectionTwo) return;
			const viewportH = () => window.innerHeight || 800;

			mm = gsap.matchMedia(heroEl);

			mm.add(
				{
					isDesktop: '(min-width: 901px) and (prefers-reduced-motion: no-preference)',
					isMobile: '(max-width: 900px) and (prefers-reduced-motion: no-preference)'
				},
				(context) => {
					const { isDesktop } = context.conditions;
					// Amplitudes — tune here. Mobile uses a gentler version of the same motion.
					const eyebrowTravel = isDesktop ? 520 : 240; // px the eyebrow runs sideways
					const copyTravel = isDesktop ? 84 : 56; // px the headline lifts / rises
					const bgTravel = isDesktop ? 0.16 : 0.1; // background parallax, fraction of viewport

					// GSAP now owns these transforms: centre the absolutely-positioned copy and
					// give each background a cover-scale so the parallax translate never reveals an edge.
					gsap.set(
						[sectionOne, sectionTwo].map((s) => s.querySelector('.hero-copy')),
						{
							xPercent: -50,
							yPercent: -50
						}
					);
					gsap.set('.hero-flow-media--one, .hero-flow-media--two', {
						scale: 1.08,
						transformOrigin: '50% 50%'
					});

					// ── SCENE 1 ── slow background, headline lifts + fades, eyebrow runs RIGHT.
					gsap.fromTo(
						'.hero-flow-media--one',
						{ y: () => -bgTravel * 0.3 * viewportH() },
						{
							y: () => bgTravel * viewportH(),
							ease: 'none',
							scrollTrigger: {
								trigger: sectionOne,
								start: 'top top',
								end: 'bottom top',
								scrub: true,
								invalidateOnRefresh: true
							}
						}
					);
					gsap.to('.hero-copy--one', {
						autoAlpha: 0,
						y: -copyTravel,
						ease: 'none',
						scrollTrigger: { trigger: sectionOne, start: 'top top', end: '58% top', scrub: true }
					});
					gsap.to('.hero-eyebrow--one', {
						x: eyebrowTravel,
						ease: 'none',
						scrollTrigger: { trigger: sectionOne, start: 'top top', end: 'bottom top', scrub: true }
					});

					// ── SCENE 2 ── background parallax, headline rises + fades IN,
					// eyebrow enters from the LEFT and settles centred.
					gsap.fromTo(
						'.hero-flow-media--two',
						{ y: () => -bgTravel * viewportH() },
						{
							y: () => bgTravel * 0.3 * viewportH(),
							ease: 'none',
							scrollTrigger: {
								trigger: sectionTwo,
								start: 'top bottom',
								end: 'bottom top',
								scrub: true,
								invalidateOnRefresh: true
							}
						}
					);
					gsap.fromTo(
						'.hero-copy--two',
						{ autoAlpha: 0, y: copyTravel },
						{
							autoAlpha: 1,
							y: 0,
							ease: 'none',
							scrollTrigger: { trigger: sectionTwo, start: 'top 80%', end: 'top 32%', scrub: true }
						}
					);
					gsap.fromTo(
						'.hero-eyebrow--two',
						{ x: -eyebrowTravel },
						{
							x: 0,
							ease: 'none',
							// Later range so most of the leftward travel plays out while scene 2 is
							// actually on screen — otherwise it finishes centring before it's visible.
							scrollTrigger: { trigger: sectionTwo, start: 'top 70%', end: 'top top', scrub: true }
						}
					);

					// ── SEAM ── soft shadow swells as the two scenes cross, then eases back.
					gsap
						.timeline({
							scrollTrigger: {
								trigger: sectionTwo,
								start: 'top bottom',
								end: 'top top',
								scrub: true
							}
						})
						.fromTo(
							'.hero-boundary-shadow',
							{ autoAlpha: 0.16 },
							{ autoAlpha: 0.82, ease: 'none', duration: 0.62 }
						)
						.to('.hero-boundary-shadow', { autoAlpha: 0.42, ease: 'none', duration: 0.38 });
				}
			);

			// ── INOX proof section: staggered reveals + soft parallax (clearly perceptible).
			// Uses element refs (not selector strings) because matchMedia is scoped to the hero.
			mm.add('(prefers-reduced-motion: no-preference)', () => {
				const inox = document.querySelector('#inox');
				if (!inox) return;
				const marquee = inox.querySelector('.inox-marquee');
				const intro = inox.querySelectorAll('.inox-head, .inox-subhead, .inox-lead');
				const benefits = inox.querySelectorAll('.inox-benefit');
				const cta = inox.querySelector('.inox-cta');
				const chips = inox.querySelectorAll('.inox-orbit__chip');
				const stage = inox.querySelector('.inox-stage');
				const body = inox.querySelector('.inox-body');
				const bgwords = inox.querySelector('.inox-bgwords');
				const isCompactInox = window.matchMedia('(max-width: 900px)').matches;
				const reverseParallax = (target, fromY, toY, end = 'top -24%') => {
					if (!target) return;
					gsap.fromTo(
						target,
						{ y: fromY },
						{
							y: toY,
							ease: 'none',
							scrollTrigger: {
								trigger: inox,
								start: 'top 96%',
								end,
								scrub: 0.18,
								invalidateOnRefresh: true
							}
						}
					);
				};

				if (marquee) {
					gsap.from(marquee, {
						autoAlpha: 0,
						duration: 0.9,
						ease: 'power2.out',
						scrollTrigger: { trigger: inox, start: 'top 82%' }
					});
				}
				if (intro.length) {
					gsap.from(intro, {
						autoAlpha: 0,
						y: 42,
						duration: 0.7,
						ease: 'power2.out',
						stagger: 0.12,
						scrollTrigger: { trigger: inox, start: 'top 72%' }
					});
				}
				if (benefits.length) {
					gsap.from(benefits, {
						autoAlpha: 0,
						y: 30,
						duration: 0.6,
						ease: 'power2.out',
						stagger: 0.1,
						scrollTrigger: { trigger: inox, start: 'top 60%' }
					});
				}
				if (cta) {
					gsap.from(cta, {
						autoAlpha: 0,
						y: 26,
						duration: 0.6,
						ease: 'power2.out',
						scrollTrigger: { trigger: inox, start: 'top 56%' }
					});
				}
				// Opacity-only (transform is owned by the CSS float animation on the chips).
				if (chips.length) {
					gsap.from(chips, {
						autoAlpha: 0,
						duration: 0.6,
						ease: 'power2.out',
						stagger: 0.12,
						scrollTrigger: { trigger: stage || inox, start: 'top 80%' }
					});
				}
				gsap.fromTo(
					inox,
					{ y: 0 },
					{
						y: () => {
							const cssLift = Number.parseFloat(
								getComputedStyle(inox).getPropertyValue('--inox-scroll-lift')
							);
							return -(Number.isFinite(cssLift) && cssLift > 0
								? cssLift
								: isCompactInox
									? 136
									: 280);
						},
						ease: 'none',
						scrollTrigger: {
							trigger: inox,
							start: 'top 108%',
							end: 'top 12%',
							scrub: 0.12,
							invalidateOnRefresh: true
						}
					}
				);
				reverseParallax(marquee, isCompactInox ? 16 : 36, isCompactInox ? -18 : -40);
				reverseParallax(body, isCompactInox ? 12 : 24, isCompactInox ? -16 : -30);
				reverseParallax(stage, isCompactInox ? 10 : 18, isCompactInox ? -18 : -36, 'top -12%');
				if (bgwords) {
					gsap.fromTo(
						bgwords,
						{ yPercent: 8 },
						{
							yPercent: -8,
							ease: 'none',
							scrollTrigger: { trigger: inox, start: 'top bottom', end: 'bottom top', scrub: true }
						}
					);
				}
			});

			handleRefresh();
			if (document.readyState !== 'complete') {
				window.addEventListener('load', handleRefresh, { once: true });
			}
			// Layout below the hero (lazy product/blog feed) settles slightly later — recompute then.
			refreshTimer = window.setTimeout(handleRefresh, 450);
			window.addEventListener('inoxpran:client-ui-refresh', handleRefresh);
		};

		void setupGsap();

		if (reduceMotionQuery.addEventListener) {
			reduceMotionQuery.addEventListener('change', applyReducedState);
		} else {
			reduceMotionQuery.addListener(applyReducedState);
		}

		return () => {
			cancelled = true;
			if (refreshTimer) window.clearTimeout(refreshTimer);
			window.removeEventListener('load', handleRefresh);
			window.removeEventListener('inoxpran:client-ui-refresh', handleRefresh);
			if (reduceMotionQuery.removeEventListener) {
				reduceMotionQuery.removeEventListener('change', applyReducedState);
			} else {
				reduceMotionQuery.removeListener(applyReducedState);
			}
			if (onLenisReady) window.removeEventListener('inoxpran:lenis-ready', onLenisReady);
			if (lenisScrollHandler && window.__lenis?.off) {
				window.__lenis.off('scroll', lenisScrollHandler);
			}
			mm?.revert();
			scrollTrigger?.getAll().forEach((trigger) => trigger.kill());
		};
	});

	// Rotating wireframe swirl-sphere behind the marquee (original Three.js scene).
	onMount(() => {
		if (typeof window === 'undefined') return;
		let cleanup = null;
		let cancelled = false;
		(async () => {
			try {
				const mod = await import('$lib/client/kineticSphere.js');
				if (cancelled || !kineticSphereEl) return;
				cleanup = await mod.initKineticSphere(kineticSphereEl);
				if (cancelled && cleanup) cleanup();
			} catch {
				/* three failed to load — the CSS rings remain as a graceful fallback */
			}
		})();
		return () => {
			cancelled = true;
			cleanup?.();
		};
	});

	onMount(() => {
		if (typeof window === 'undefined') return;
		const mediaQuery = window.matchMedia('(max-width: 768px)');
		const syncViewport = () => {
			isHomeCardMobileViewport = mediaQuery.matches;
		};
		syncViewport();
		if (mediaQuery.addEventListener) {
			mediaQuery.addEventListener('change', syncViewport);
		} else {
			mediaQuery.addListener(syncViewport);
		}
		return () => {
			if (mediaQuery.removeEventListener) {
				mediaQuery.removeEventListener('change', syncViewport);
			} else {
				mediaQuery.removeListener(syncViewport);
			}
		};
	});

	onMount(() => {
		let cancelled = false;
		let idleId = null;
		let timeoutId = null;
		const requestClientUiRefresh = () => {
			if (typeof window === 'undefined') return;
			window.dispatchEvent(new CustomEvent('inoxpran:client-ui-refresh'));
		};

		const loadHomeFeedAndRefreshAnimations = async () => {
			if (data?.homeFeedLoaded) return;
			await loadHomeFeed();
			if (cancelled) return;
			await tick();
			if (cancelled) return;
			requestClientUiRefresh();
		};

		const schedule = () => {
			if (typeof window === 'undefined') return;
			const run = () => {
				idleId = null;
				timeoutId = null;
				if (cancelled) return;
				void loadHomeFeedAndRefreshAnimations();
			};
			if (typeof window.requestIdleCallback === 'function') {
				idleId = window.requestIdleCallback(run, { timeout: 1200 });
				return;
			}
			timeoutId = window.setTimeout(run, 250);
		};

		schedule();

		return () => {
			cancelled = true;
			if (typeof window !== 'undefined') {
				if (idleId !== null && typeof window.cancelIdleCallback === 'function') {
					window.cancelIdleCallback(idleId);
				}
				if (timeoutId !== null) {
					window.clearTimeout(timeoutId);
				}
			}
		};
	});

	onMount(() => {
		if (typeof window === 'undefined') return;
		if (!('IntersectionObserver' in window)) {
			isInoxSliderNearViewport = true;
			return;
		}

		let rafId = null;
		let observer = null;
		const observeWhenReady = () => {
			if (!inoxSliderViewportEl) {
				rafId = window.requestAnimationFrame(observeWhenReady);
				return;
			}

			observer = new IntersectionObserver(
				(entries) => {
					const isVisible = entries.some(
						(entry) => entry.isIntersecting || entry.intersectionRatio > 0
					);
					if (!isVisible) return;
					isInoxSliderNearViewport = true;
					observer?.disconnect();
					observer = null;
				},
				{ rootMargin: '320px 0px' }
			);

			observer.observe(inoxSliderViewportEl);
		};

		observeWhenReady();

		return () => {
			if (rafId !== null) window.cancelAnimationFrame(rafId);
			observer?.disconnect();
		};
	});

	onMount(() => {
		if (typeof window === 'undefined') return;
		let timerId = null;
		const schedule = () => {
			if (timerId) window.clearInterval(timerId);
			timerId = window.setInterval(() => {
				if (isInoxSliderPaused) return;
				if (!isInoxSliderNearViewport) return;
				if (homeInoxSlides.length <= 1) return;
				activeInoxSlideIndex = (activeInoxSlideIndex + 1) % homeInoxSlides.length;
			}, 4800);
		};
		schedule();

		return () => {
			if (timerId) window.clearInterval(timerId);
		};
	});
</script>

<svelte:head>
	<title>{seoTitle}</title>
	<meta name="description" content={seoDescription} />
	<meta property="og:type" content="website" />
	<meta property="og:url" content={ogUrl} />
	<meta property="og:title" content={seoTitle} />
	<meta property="og:description" content={seoDescription} />
	<meta property="og:image" content={ogImageUrl} />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={seoTitle} />
	<meta name="twitter:description" content={seoDescription} />
	<meta name="twitter:image" content={ogImageUrl} />
	{@html `<script type="application/ld+json">${escapeJsonLd(homePageJsonLd)}</script>`}
	<link
		rel="preload"
		as="image"
		href={heroBackgroundSlide
			? heroBackgroundUrl
			: `/images/optimized/hero-fan-960.jpg?v=${heroCompositeVersion}`}
		type={heroBackgroundSlide ? undefined : 'image/jpeg'}
		imagesrcset={heroBackgroundSlide ? undefined : heroCompositeJpgSrcSet}
		imagesizes={heroCompositeSizes}
		fetchpriority="high"
		media="(max-width: 1024px)"
	/>
	<link
		rel="preload"
		as="image"
		href={heroBackgroundSlide
			? heroBackgroundUrl
			: `/images/optimized/hero-fan-1920.jpg?v=${heroCompositeVersion}`}
		type={heroBackgroundSlide ? undefined : 'image/jpeg'}
		imagesrcset={heroBackgroundSlide ? undefined : heroCompositeJpgSrcSet}
		imagesizes={heroCompositeSizes}
		fetchpriority="high"
		media="(min-width: 1025px)"
	/>
</svelte:head>

<div class="search-popup">
	<div class="search-popup-container">
		<form role="search" method="get" class="search-form" action="">
			<input
				type="search"
				id="search-form"
				class="search-field"
				placeholder={$t('home.searchPlaceholder')}
				value=""
				name="s"
			/>
			<button
				type="submit"
				class="search-submit"
				aria-label={$locale === 'en' ? 'Search' : 'Tìm kiếm'}
			>
				<svg class="search">
					<use xlink:href="#search"></use>
				</svg>
			</button>
		</form>

		<h5 class="cat-list-title">{$t('home.searchBrowse')}</h5>

		<ul class="cat-list">
			<li class="cat-list-item">
				<a
					href={localizeInternalHref('/category/noi-inox', $locale)}
					title={$t('home.searchCategoryInox')}>{$t('home.searchCategoryInox')}</a
				>
			</li>
			<li class="cat-list-item">
				<a
					href={localizeInternalHref('/category/noi-gang', $locale)}
					title={$t('home.searchCategoryCastIron')}>{$t('home.searchCategoryCastIron')}</a
				>
			</li>
			<li class="cat-list-item">
				<a
					href={localizeInternalHref('/category/gia-dung-dien', $locale)}
					title={$t('home.searchCategoryElectronics')}>{$t('home.searchCategoryElectronics')}</a
				>
			</li>
		</ul>
	</div>
</div>

<main class="main-page">
	<section
		id="hero"
		class="panel hero-panel hero-flow-scene"
		class:hero-motion-reduced={heroMotionReduced}
		bind:this={heroSceneEl}
	>
		<section
			class="hero-flow-section hero-flow-section--one"
			aria-labelledby="hero-scene-one-title"
		>
			<div class="hero-flow-media hero-flow-media--one" aria-hidden="true">
				<picture>
					<img
						src={heroBackgroundUrl}
						srcset={heroBackgroundSlide ? undefined : heroCompositeJpgSrcSet}
						alt=""
						class="hero-flow-image hero-flow-image--one"
						width="1920"
						height="1072"
						decoding="async"
						loading="eager"
						fetchpriority="high"
						sizes={heroCompositeSizes}
					/>
				</picture>
			</div>
			<div class="hero-flow-vignette" aria-hidden="true"></div>

			<div class="panel-inner hero-inner hero-copy hero-copy--one">
				<p class="hero-eyebrow hero-eyebrow--one">
					<span aria-hidden="true"></span>
					{heroIntroCopy.eyebrow}
				</p>
				<h1 id="hero-scene-one-title" class="panel-title hero-title" lang={$locale}>
					<span>{heroIntroCopy.lead}</span>
					<strong>{heroIntroCopy.emphasis}</strong>
				</h1>

				<div class="hero-actions">
					<a class="cta btn-s1" href={localizeInternalHref('/shop', $locale)}>
						{heroIntroCopy.cta}
					</a>
					<a class="hero-story-link" href={localizeInternalHref('/about', $locale)}>
						{heroIntroCopy.storyCta}
					</a>
				</div>
			</div>
		</section>

		<div class="hero-boundary-shadow" aria-hidden="true"></div>

		<section
			class="hero-flow-section hero-flow-section--two"
			aria-labelledby="hero-scene-two-title"
		>
			<div class="hero-flow-media hero-flow-media--two" aria-hidden="true">
				<picture>
					<img
						src={cookwareHeroUrl}
						srcset={cookwareHeroJpgSrcSet}
						alt=""
						class="hero-flow-image hero-flow-image--two"
						width="1875"
						height="688"
						decoding="async"
						loading="eager"
						sizes={cookwareHeroSizes}
					/>
				</picture>
			</div>
			<div class="hero-flow-vignette" aria-hidden="true"></div>

			<div class="panel-inner hero-inner hero-copy hero-copy--two">
				<p class="hero-eyebrow hero-eyebrow--two">
					<span aria-hidden="true"></span>
					{heroIntroCopy.eyebrow}
				</p>
				<h2 id="hero-scene-two-title" class="panel-title hero-title" lang={$locale}>
					<span>{cookwareIntroCopy.lead}</span>
					<strong>{cookwareIntroCopy.emphasis}</strong>
				</h2>
			</div>
		</section>
	</section>

	<section id="inox" class="panel parallax-scene inox-scene">
		<div class="inox-motion-plane">
			<div class="panel-bg parallax-bg"></div>
			<div class="inox-grain" aria-hidden="true"></div>
			<div class="inox-bgwords" aria-hidden="true">
				<span class="inox-bgword inox-bgword--a">INOXPRAN</span>
				<span class="inox-bgword inox-bgword--b">BẾP VIỆT</span>
				<span class="inox-bgword inox-bgword--c">FAMILY</span>
			</div>

			<div class="inox-head inox-reveal">
				<p class="inox-eyebrow">
					{inoxProof.eyebrow}
					<span class="inox-flag" aria-label="Italy" role="img">
						<svg viewBox="0 0 3 2" width="21" height="14" focusable="false" aria-hidden="true">
							<rect width="1" height="2" x="0" fill="#009246" />
							<rect width="1" height="2" x="1" fill="#f4f5f0" />
							<rect width="1" height="2" x="2" fill="#ce2b37" />
						</svg>
					</span>
				</p>
			</div>

			<div class="inox-marquee" aria-hidden="true">
				<div class="kinetic-marquee">
					{#each [0, 1] as group (group)}
						<div class="kinetic-marquee__group">
							{#each kineticBandRepeats as repeat (repeat)}
								<span class="kinetic-word">{kineticBandPhrase}</span>
							{/each}
						</div>
					{/each}
				</div>
			</div>
			<h2 id="inox-heading" class="visually-hidden">
				{inoxProof.heading} — {$t('home.inoxTitle')}
			</h2>

			<div class="inox-body">
				<div class="inox-copy">
					<p class="inox-subhead inox-reveal">{inoxProof.subhead}</p>
					<p class="inox-lead inox-reveal">{inoxProof.paragraph}</p>

					<div class="stats-row inox-statrail">
						{#each inoxStats as stat (stat.id)}
							<div class="stat-card inox-reveal">
								<div class="inox-stat-value">
									<span
										class="stat-number"
										id={stat.id}
										data-counter-target={stat.target}
										data-suffix={stat.suffix}
										>{stat.target}<span class="stat-suffix">{stat.suffix}</span></span
									>
									{#if stat.star}<span class="inox-star" aria-hidden="true">★</span>{/if}
								</div>
								<div class="stat-label">{stat.label}</div>
							</div>
						{/each}
					</div>
				</div>

				<div class="inox-stage">
					<canvas class="kinetic-band__sphere" bind:this={kineticSphereEl} width="640" height="640"
					></canvas>
					<div class="inox-orbit" aria-hidden="true">
						<span class="inox-orbit__ring inox-orbit__ring--1"></span>
						<span class="inox-orbit__ring inox-orbit__ring--2"></span>
						{#each inoxOrbitItems as item, i (item)}
							<span class={`inox-orbit__chip inox-orbit__chip--${i + 1}`}>
								<span class="inox-orbit__chip-dot"></span>
								<span class="inox-orbit__chip-text">{item}</span>
							</span>
						{/each}
					</div>
					<div
						class="inox-card"
						role="region"
						aria-label={$locale === 'en' ? 'Homepage promotions' : 'Khuyến mãi trang chủ'}
						onmouseenter={() => {
							isInoxSliderNearViewport = true;
							isInoxSliderPaused = true;
						}}
						onmouseleave={() => (isInoxSliderPaused = false)}
						onfocusin={() => {
							isInoxSliderNearViewport = true;
							isInoxSliderPaused = true;
						}}
						onfocusout={() => (isInoxSliderPaused = false)}
					>
						<div
							class="inox-ad-slider"
							aria-label={$locale === 'en' ? 'Homepage promotions' : 'Khuyến mãi trang chủ'}
						>
							<div class="inox-ad-slider__viewport" bind:this={inoxSliderViewportEl}>
								{#each homeInoxSlides as slide, slideIndex (slide.id)}
									<div
										class={`inox-ad-slide ${slideIndex === activeInoxSlideIndex ? 'is-active' : ''}`}
										id={inoxSlidePanelId(slide.id)}
										role="tabpanel"
										aria-labelledby={inoxSlideTabId(slide.id)}
										tabindex={slideIndex === activeInoxSlideIndex ? 0 : -1}
										aria-hidden={slideIndex === activeInoxSlideIndex ? 'false' : 'true'}
									>
										<button
											type="button"
											class={`inox-ad-slide__surface ${homeInoxSlides.length <= 1 ? 'is-static' : ''}`}
											aria-label={homeInoxSlides.length > 1
												? $locale === 'en'
													? 'Show next slide'
													: 'Xem slide tiếp theo'
												: slide.alt}
											onclick={handleInoxSlideImageClick}
										>
											<img
												src={shouldLoadInoxSlideImage(slide, slideIndex)
													? slide.imageUrl
													: BLANK_IMAGE_DATA_URL}
												alt={slide.alt}
												class="inox-ad-slide__image"
												width="940"
												height="788"
												loading="lazy"
												fetchpriority="low"
												decoding="async"
												sizes={inoxSlideImageSizes}
											/>
										</button>
									</div>
								{/each}

								{#if homeInoxSlides.length > 1}
									<div class="inox-ad-slider__controls">
										<button
											type="button"
											class="inox-ad-slider__nav"
											aria-label={$locale === 'en' ? 'Previous slide' : 'Slide trước'}
											onclick={showPrevInoxSlide}
										>
											‹
										</button>
										<button
											type="button"
											class="inox-ad-slider__nav"
											aria-label={$locale === 'en' ? 'Next slide' : 'Slide tiếp theo'}
											onclick={showNextInoxSlide}
										>
											›
										</button>
									</div>
									<div
										class="inox-ad-slider__dots"
										role="tablist"
										aria-label={$locale === 'en' ? 'Slide pagination' : 'Điều hướng slide'}
									>
										{#each homeInoxSlides as slide, dotIndex (slide.id)}
											<button
												type="button"
												id={inoxSlideTabId(slide.id)}
												role="tab"
												aria-controls={inoxSlidePanelId(slide.id)}
												class={`inox-ad-slider__dot ${dotIndex === activeInoxSlideIndex ? 'is-active' : ''}`}
												aria-label={`${$locale === 'en' ? 'Go to slide' : 'Đến slide'} ${dotIndex + 1}`}
												aria-selected={dotIndex === activeInoxSlideIndex ? 'true' : 'false'}
												tabindex={dotIndex === activeInoxSlideIndex ? 0 : -1}
												onclick={() => goToInoxSlide(dotIndex)}
											></button>
										{/each}
									</div>
								{/if}
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	</section>

	<section id="company-services" class="padding-large pb-0">
		<div class="container">
			<div class="row">
				<div class="col-lg-3 col-md-6 pb-3 pb-lg-0">
					<div class="icon-box d-flex">
						<div class="icon-box-icon pe-3 pb-3">
							<svg class="cart-outline">
								<use xlink:href="#cart-outline" />
							</svg>
						</div>
						<div class="icon-box-content">
							<h4 class="card-title mb-1 text-capitalize text-dark">
								{$t('home.serviceShippingTitle')}
							</h4>
							<p>{$t('home.serviceShippingDesc')}</p>
						</div>
					</div>
				</div>
				<div class="col-lg-3 col-md-6 pb-3 pb-lg-0">
					<div class="icon-box d-flex">
						<div class="icon-box-icon pe-3 pb-3">
							<svg class="quality">
								<use xlink:href="#quality" />
							</svg>
						</div>
						<div class="icon-box-content">
							<h4 class="card-title mb-1 text-capitalize text-dark">
								{$t('home.serviceQualityTitle')}
							</h4>
							<p>{$t('home.serviceQualityDesc')}</p>
						</div>
					</div>
				</div>
				<div class="col-lg-3 col-md-6 pb-3 pb-lg-0">
					<div class="icon-box d-flex">
						<div class="icon-box-icon pe-3 pb-3">
							<svg class="price-tag">
								<use xlink:href="#price-tag" />
							</svg>
						</div>
						<div class="icon-box-content">
							<h4 class="card-title mb-1 text-capitalize text-dark">
								{$t('home.serviceDealsTitle')}
							</h4>
							<p>{$t('home.serviceDealsDesc')}</p>
						</div>
					</div>
				</div>
				<div class="col-lg-3 col-md-6 pb-3 pb-lg-0">
					<div class="icon-box d-flex">
						<div class="icon-box-icon pe-3 pb-3">
							<svg class="shield-plus">
								<use xlink:href="#shield-plus" />
							</svg>
						</div>
						<div class="icon-box-content">
							<h4 class="card-title mb-1 text-capitalize text-dark">
								{$t('home.servicePaymentTitle')}
							</h4>
							<p>{$t('home.servicePaymentDesc')}</p>
						</div>
					</div>
				</div>
			</div>
		</div>
	</section>

	<section id="best-selling-items" class="position-relative padding-large">
		<div class="container">
			<div class="section-title home-section-title mb-3">
				<h3 class="d-flex align-items-center">{$t('home.bestSellingTitle')}</h3>
				<a href={localizeInternalHref('/shop', $locale)} class="btn">{$t('common.viewAll')}</a>
			</div>
			<div
				class="position-absolute top-50 end-0 pe-0 pe-xxl-5 me-0 me-xxl-5 swiper-next product-slider-button-next"
				aria-label={$locale === 'en' ? 'Next featured products' : 'Sản phẩm nổi bật tiếp theo'}
				title={$locale === 'en' ? 'Next featured products' : 'Sản phẩm nổi bật tiếp theo'}
			>
				<svg
					class="chevron-forward-circle d-flex justify-content-center align-items-center p-2"
					width="80"
					height="80"
					aria-hidden="true"
				>
					<use xlink:href="#alt-arrow-right-outline"></use>
				</svg>
			</div>
			<div
				class="position-absolute top-50 start-0 ps-0 ps-xxl-5 ms-0 ms-xxl-5 swiper-prev product-slider-button-prev"
				aria-label={$locale === 'en' ? 'Previous featured products' : 'Sản phẩm nổi bật trước đó'}
				title={$locale === 'en' ? 'Previous featured products' : 'Sản phẩm nổi bật trước đó'}
			>
				<svg
					class="chevron-back-circle d-flex justify-content-center align-items-center p-2"
					width="80"
					height="80"
					aria-hidden="true"
				>
					<use xlink:href="#alt-arrow-left-outline"></use>
				</svg>
			</div>
			<div class="swiper product-swiper" data-native-slider="home-best-selling">
				<div class="swiper-wrapper">
					{#if bestSelling.length}
						{#each bestSelling as product, index (product._id || index)}
							{@const discountPercent = getDiscountPercent(product)}
							{@const originalPrice = getOriginalPrice(product)}
							{@const productThumb = resolveThumb(product.product_thumb, index)}
							{@const productThumbAvifSrcSet = getProductCardAvifSrcSet(productThumb)}
							{@const productThumbWebpSrcSet = getProductCardWebpSrcSet(productThumb)}
							{@const ratingSummary = getMarketingRatingSummary(product, $locale)}
							<div class="swiper-slide">
								<div class="card product-card position-relative p-4 border rounded-3">
									{#if showDiscountBadge && discountPercent}
										<div class="position-absolute">
											<p class="bg-primary py-1 px-3 fs-6 text-white rounded-2">
												-{discountPercent}%
											</p>
										</div>
									{/if}
									<a
										class="product-card-link"
										href={getProductHref(product)}
										aria-label={getProductName(product, index)}
									>
										<div class="product-thumb">
											<picture>
												{#if productThumbAvifSrcSet}
													<source
														type="image/avif"
														srcset={productThumbAvifSrcSet}
														sizes={homeProductCardImageSizes}
													/>
												{/if}
												{#if productThumbWebpSrcSet}
													<source
														type="image/webp"
														srcset={productThumbWebpSrcSet}
														sizes={homeProductCardImageSizes}
													/>
												{/if}
												<img
													src={productThumb}
													class="img-fluid shadow-sm"
													alt={getProductName(product, index)}
													width="640"
													height="640"
													loading="lazy"
													fetchpriority="low"
													decoding="async"
													sizes={homeProductCardImageSizes}
												/>
											</picture>
										</div>
										<h4 class="home-product-title mt-3 mb-0 fw-bold">
											{getProductName(product, index)}
										</h4>
										<div class="price-block mt-2">
											<span class="price text-primary fw-bold fs-6"
												>{formatPrice(product.product_price)}</span
											>
											<span class="old-price fw-bold">{originalPrice}</span>
										</div>
										<div class="product-rating-row" aria-label={ratingSummary.label}>
											<span aria-hidden="true">&#9733;&#9733;&#9733;&#9733;&#9733;</span>
											<strong>{ratingSummary.formattedAverage}</strong>
											<small>({ratingSummary.count})</small>
										</div>
										<div class="product-desc-box">
											<p class="product-desc mb-0">
												{getProductDescription(product)}
											</p>
										</div>
									</a>
									<div class="card-concern position-absolute start-0 end-0 d-flex gap-2">
										<form
											method="POST"
											action="?/addToCart"
											class="d-inline-flex m-0"
											use:enhance={createAddToCartEnhance(product)}
										>
											<input type="hidden" name="productId" value={product?._id} />
											<button
												type="submit"
												class="btn btn-dark home-addcart-btn"
												class:is-adding={addingId === product?._id}
												class:is-added={addedId === product?._id}
												disabled={addingId || isAddLocked(product?._id)}
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
					{:else if isHomeFeedLoading}
						{#each Array(4) as _, idx}
							<div class="swiper-slide">
								<div class="card product-card position-relative p-4 border rounded-3">
									<div class="product-thumb skeleton skeleton-thumb"></div>
									<div class="skeleton-line lg skeleton"></div>
									<div class="skeleton-line md skeleton"></div>
									<div class="skeleton-line sm skeleton"></div>
									<div class="skeleton-line lg skeleton" style="margin-top:14px;"></div>
									<div class="card-concern position-absolute start-0 end-0 d-flex gap-2">
										<div
											class="btn btn-dark home-addcart-btn skeleton"
											style="width:46px; height:46px;"
										></div>
									</div>
								</div>
							</div>
						{/each}
					{:else}
						<div class="swiper-slide">
							<p class="mb-0 text-black-50">{noBestSellingText}</p>
						</div>
					{/if}
				</div>
			</div>
		</div>
	</section>

	<section id="categories" class="padding-large pt-0">
		<div class="container">
			<div class="section-title overflow-hidden mb-4">
				<h3 class="d-flex align-items-center">{$t('home.categoriesTitle')}</h3>
			</div>
			<div class="row">
				<div class="col-md-4">
					<div class="card mb-4 border-0 rounded-3 align-items-center position-relative">
						<a href={localizeInternalHref('/category/noi-inox', $locale)}>
							<picture>
								<source
									type="image/avif"
									srcset={categoryMedia.inox.avifSrcSet}
									sizes={categoryImageSizes}
								/>
								<source
									type="image/webp"
									srcset={categoryMedia.inox.webpSrcSet}
									sizes={categoryImageSizes}
								/>
								<img
									src={categoryMedia.inox.fallback}
									class="img-fluid rounded-3"
									alt={$t('home.categoryInox')}
									width="720"
									height="720"
									loading="lazy"
									fetchpriority="low"
									decoding="async"
									sizes={categoryImageSizes}
								/>
							</picture>
							<span
								class="home-category-badge text-white position-absolute text-center bottom-0 m-4 py-2 px-3 rounded-3"
							>
								{$t('home.categoryInox')}
							</span>
						</a>
					</div>
				</div>
				<div class="col-md-4">
					<div class="card text-center mb-4 border-0 rounded-3 align-items-center">
						<a href={localizeInternalHref('/category/noi-gang', $locale)}>
							<picture>
								<source
									type="image/avif"
									srcset={categoryMedia.castIron.avifSrcSet}
									sizes={categoryImageSizes}
								/>
								<source
									type="image/webp"
									srcset={categoryMedia.castIron.webpSrcSet}
									sizes={categoryImageSizes}
								/>
								<img
									src={categoryMedia.castIron.fallback}
									class="img-fluid rounded-3"
									alt={$t('home.categoryCastIron')}
									width="720"
									height="720"
									loading="lazy"
									fetchpriority="low"
									decoding="async"
									sizes={categoryImageSizes}
								/>
							</picture>
							<span
								class="home-category-badge text-white position-absolute text-center bottom-0 m-4 py-2 px-3 rounded-3"
							>
								{$t('home.categoryCastIron')}
							</span>
						</a>
					</div>
				</div>
				<div class="col-md-4">
					<div class="card text-center mb-4 border-0 rounded-3 align-items-center">
						<a href={localizeInternalHref('/category/gia-dung-dien', $locale)}>
							<picture>
								<source
									type="image/avif"
									srcset={categoryMedia.electronics.avifSrcSet}
									sizes={categoryImageSizes}
								/>
								<source
									type="image/webp"
									srcset={categoryMedia.electronics.webpSrcSet}
									sizes={categoryImageSizes}
								/>
								<img
									src={categoryMedia.electronics.fallback}
									class="img-fluid rounded-3"
									alt={$t('home.categoryElectronics')}
									width="720"
									height="720"
									loading="lazy"
									fetchpriority="low"
									decoding="async"
									sizes={categoryImageSizes}
								/>
							</picture>
							<span
								class="home-category-badge text-white position-absolute text-center bottom-0 m-4 py-2 px-3 rounded-3"
							>
								{$t('home.categoryElectronics')}
							</span>
						</a>
					</div>
				</div>
			</div>
		</div>
	</section>

	<section id="latest-posts" class="padding-large">
		<div class="container">
			<div class="section-title home-section-title mb-4">
				<h3 class="d-flex align-items-center">{$t('home.latestPostsTitle')}</h3>
				<a href={localizeInternalHref('/blog', $locale)} class="btn">{$t('common.viewAll')}</a>
			</div>
			<div class="row">
				{#if latestPosts.length}
					{#each latestPosts as post, index (post.id || post._id || post.slug || index)}
						{@const postImage = getBlogImage(post, index)}
						{@const postAvifSrcSet = getPostItemAvifSrcSet(postImage)}
						{@const postWebpSrcSet = getPostItemWebpSrcSet(postImage)}
						{@const postCategoryHref = getBlogCategoryHref(post)}
						<div
							class="col-6 col-md-3 posts mb-4"
							role="link"
							tabindex="0"
							onclick={(event) => handleLatestPostClick(event, getBlogHref(post))}
							onkeydown={(event) => handleLatestPostKeydown(event, getBlogHref(post))}
						>
							<div class="home-post-media">
								<picture>
									{#if postAvifSrcSet}
										<source
											type="image/avif"
											srcset={postAvifSrcSet}
											sizes={latestPostImageSizes}
										/>
									{/if}
									{#if postWebpSrcSet}
										<source
											type="image/webp"
											srcset={postWebpSrcSet}
											sizes={latestPostImageSizes}
										/>
									{/if}
									<img
										src={postImage}
										alt={post.title || $t('home.latestPostsTitle')}
										class="img-fluid rounded-3"
										width="480"
										height="480"
										loading="lazy"
										fetchpriority="low"
										decoding="async"
										sizes={latestPostImageSizes}
									/>
								</picture>
								<a
									href={postCategoryHref}
									class="home-post-category-link"
									aria-label={getBlogCategoryLinkLabel(post)}
								>
									{getBlogCategory(post)}
								</a>
							</div>
							<h4 class="card-title mb-2 text-capitalize text-dark">
								<a class="home-post-title-link" href={getBlogHref(post)}>
									{truncateWords(post.title, 15)}
								</a>
							</h4>
							<p class="mb-2">
								{getBlogExcerpt(post)}
								<span>
									<a
										class="home-post-readmore text-decoration-underline text-black-50"
										href={getBlogHref(post)}
									>
										{$t('common.readMore')}
									</a>
								</span>
							</p>
						</div>
					{/each}
				{:else if isHomeFeedLoading}
					{#each Array(4) as _, idx (idx)}
						<div class="col-6 col-md-3 posts mb-4" aria-hidden="true">
							<div class="img-fluid rounded-3 skeleton skeleton-thumb"></div>
							<div class="skeleton-line lg skeleton"></div>
							<div class="skeleton-line md skeleton"></div>
							<div class="skeleton-line sm skeleton"></div>
						</div>
					{/each}
				{:else}
					<div class="col-12">
						<p class="mb-0 text-black-50">{noLatestPostsText}</p>
					</div>
				{/if}
			</div>
		</div>
	</section>
</main>

<style>
	.tag-link {
		display: inline-flex;
		align-items: center;
		color: inherit;
		text-decoration: none;
	}

	/* Icon Box Styling - Center icons */
	.icon-box {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.icon-box-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 48px;
		height: 48px;
		padding: 0 !important;
		margin: 0 !important;
	}

	.icon-box-icon svg {
		width: 28px;
		height: 28px;
		display: block;
	}

	.icon-box-content {
		flex: 1;
	}

	#hero {
		--hero-section-overlap: clamp(56px, 10svh, 96px);
		isolation: isolate;
		min-height: 0;
		display: block;
		position: relative;
		overflow: hidden;
		padding: 0;
		background: #050708;
		color: #f8fafc;
	}

	#hero.hero-panel::before {
		display: none;
	}

	#hero.hero-panel::after {
		display: none;
	}

	.hero-flow-section {
		position: relative;
		display: grid;
		place-items: center;
		height: 100svh;
		min-height: 620px;
		overflow: hidden;
		background: #050708;
		z-index: 1;
	}

	.hero-flow-section--one {
		z-index: 1;
	}

	.hero-flow-section--two {
		z-index: 2;
		height: clamp(760px, 116svh, 1040px);
		min-height: clamp(720px, 108svh, 980px);
		margin-top: calc(var(--hero-section-overlap) * -1);
		-webkit-mask-image: linear-gradient(
			180deg,
			rgba(0, 0, 0, 0) 0,
			rgba(0, 0, 0, 0.72) calc(var(--hero-section-overlap) * 0.62),
			#000 calc(var(--hero-section-overlap) * 1.22)
		);
		mask-image: linear-gradient(
			180deg,
			rgba(0, 0, 0, 0) 0,
			rgba(0, 0, 0, 0.72) calc(var(--hero-section-overlap) * 0.62),
			#000 calc(var(--hero-section-overlap) * 1.22)
		);
		-webkit-mask-size: 100% 100%;
		mask-size: 100% 100%;
	}

	.hero-flow-section--one::after,
	.hero-flow-section--two::before {
		position: absolute;
		left: 0;
		right: 0;
		z-index: 3;
		height: clamp(180px, 28svh, 320px);
		content: '';
		pointer-events: none;
	}

	.hero-flow-section--one::after {
		bottom: -1px;
		background: linear-gradient(
			180deg,
			rgba(5, 7, 8, 0) 0%,
			rgba(5, 7, 8, 0.24) 46%,
			rgba(5, 7, 8, 0.58) 100%
		);
	}

	.hero-flow-section--two::before {
		top: -1px;
		background: linear-gradient(
			180deg,
			rgba(5, 7, 8, 0.58) 0%,
			rgba(5, 7, 8, 0.24) 48%,
			rgba(5, 7, 8, 0) 100%
		);
	}

	.hero-flow-media {
		position: absolute;
		/* Generous vertical headroom so GSAP's parallax translate never reveals an edge. */
		inset: -20svh 0;
		z-index: 0;
		overflow: hidden;
		pointer-events: none;
		will-change: transform;
	}

	.hero-flow-media picture {
		display: block;
		width: 100%;
		height: 100%;
	}

	/* Base cover-scale; GSAP overrides transform with scale + parallax y on top of this. */
	.hero-flow-media--one,
	.hero-flow-media--two {
		transform: scale(1.08);
	}

	#hero .hero-flow-image {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		pointer-events: none;
		will-change: transform, opacity;
	}

	#hero .hero-flow-image--one {
		object-position: center;
		filter: brightness(0.82) saturate(0.98) contrast(1.04);
	}

	#hero .hero-flow-image--two {
		object-position: center;
		filter: brightness(0.8) saturate(0.94) contrast(1.05);
	}

	.hero-flow-vignette {
		position: absolute;
		inset: 0;
		z-index: 1;
		background:
			linear-gradient(
				90deg,
				rgba(0, 0, 0, 0.22) 0%,
				transparent 28%,
				transparent 70%,
				rgba(0, 0, 0, 0.18) 100%
			),
			linear-gradient(180deg, rgba(0, 0, 0, 0.1) 0%, transparent 38%, rgba(0, 0, 0, 0.34) 100%),
			radial-gradient(
				circle at 50% 52%,
				transparent 0%,
				rgba(0, 0, 0, 0.16) 68%,
				rgba(0, 0, 0, 0.36) 100%
			);
		pointer-events: none;
	}

	.hero-boundary-shadow {
		position: absolute;
		top: calc(100svh - var(--hero-section-overlap) - clamp(115px, 16svh, 190px));
		left: 0;
		right: 0;
		z-index: 20;
		height: clamp(230px, 32svh, 380px);
		opacity: 0.55;
		pointer-events: none;
		/* Boundary shadow strength: tune these alpha values for a softer/deeper join. */
		background: linear-gradient(
			180deg,
			rgba(5, 7, 8, 0) 0%,
			rgba(5, 7, 8, 0.26) 24%,
			rgba(5, 7, 8, 0.72) 50%,
			rgba(5, 7, 8, 0.26) 76%,
			rgba(5, 7, 8, 0) 100%
		);
		filter: blur(16px);
		will-change: opacity;
	}

	#hero .hero-inner {
		position: absolute;
		top: 50%;
		left: 50%;
		z-index: 2;
		width: min(820px, calc(100vw - 4rem));
		max-width: 820px;
		margin: 0;
		padding: 0 !important;
		border-radius: 0;
		background: transparent;
		box-shadow: none;
		color: #f8fafc;
		text-align: center;
		overflow: visible;
		-webkit-backdrop-filter: none;
		backdrop-filter: none;
		pointer-events: auto;
		/* Base centring (used for reduced-motion / no-JS). GSAP overrides this inline with
		   xPercent/yPercent + an animated y, so no !important here or GSAP could not take over. */
		transform: translate(-50%, -50%);
		will-change: opacity, transform;
	}

	/* Avoid a flash of the incoming scene-two copy before GSAP hides it (motion only). */
	.hero-gsap-ready .hero-copy--two {
		opacity: 0;
	}

	.hero-eyebrow {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.7rem;
		margin: 0 0 0.9rem;
		color: #b9e5ed;
		font-family: 'Manrope', 'Segoe UI', sans-serif;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0;
		line-height: 1.2;
		text-transform: uppercase;
		text-shadow: 0 8px 24px rgba(0, 0, 0, 0.38);
		will-change: opacity, transform;
	}

	.hero-eyebrow span {
		position: relative;
		display: inline-block;
		width: 28px;
		height: 1px;
		background: #70c9da;
	}

	.hero-eyebrow span::after {
		position: absolute;
		top: 50%;
		right: 0;
		width: 5px;
		height: 5px;
		background: #70c9da;
		content: '';
		transform: translateY(-50%) rotate(45deg);
	}

	/* Eyebrow horizontal travel (scene 1 → right, scene 2 → in from left) is set inline by GSAP.
	   will-change kept on the base .hero-eyebrow rule; opacity follows the parent copy fade. */

	#hero .hero-title {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.2rem;
		margin: 0;
		color: #ffffff;
		font-family: 'Manrope', 'Segoe UI', sans-serif;
		font-size: clamp(1.35rem, 1.85vw, 1.78rem);
		font-weight: 400;
		letter-spacing: 0;
		line-height: 1.3;
		max-width: 100%;
		width: 100%;
		overflow-wrap: break-word;
		text-wrap: balance;
		white-space: normal;
		text-shadow: 0 18px 42px rgba(0, 0, 0, 0.34);
		text-transform: none;
	}

	#hero .hero-title:lang(vi) {
		font-family: 'Manrope', 'Segoe UI', sans-serif;
		font-weight: 400;
		line-height: 1.32;
	}

	#hero .hero-title strong {
		display: block;
		max-width: min(820px, 100%);
		font-size: clamp(1.65rem, 2.55vw, 2.28rem);
		font-weight: 700;
		line-height: 1.2;
		white-space: normal;
	}

	.hero-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		margin-top: 1.45rem;
	}

	#hero .cta {
		margin-top: 0;
		min-height: 52px;
		padding: 0.9rem 1.45rem;
		border: 1px solid #f8fafc;
		border-radius: 0;
		background: #f8fafc;
		box-shadow: none;
		color: #0f172a;
		font-family: 'Manrope', 'Segoe UI', sans-serif;
		font-weight: 800;
		letter-spacing: 0;
	}

	#hero .cta:hover {
		background: transparent;
		color: #ffffff;
	}

	.hero-story-link {
		display: inline-flex;
		align-items: center;
		min-height: 52px;
		border-bottom: 1px solid rgba(248, 250, 252, 0.82);
		color: #ffffff;
		font-family: 'Manrope', 'Segoe UI', sans-serif;
		font-weight: 700;
		text-decoration: none;
	}

	.hero-story-link:hover {
		color: #ffffff;
		border-bottom-color: #ffffff;
	}

	.tag-link:hover {
		background: rgba(241, 245, 249, 0.96);
	}

	.tag-link:focus-visible {
		outline: 2px solid #0f5f77;
		outline-offset: 2px;
	}

	.home-section-title {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.75rem;
	}

	.home-section-title h3 {
		margin-bottom: 0;
	}

	.home-section-title .btn {
		justify-self: end;
		white-space: nowrap;
	}

	.home-section-title .btn,
	#latest-posts .btn {
		color: #0f172a;
		background: #ffffff;
		border: 1px solid rgba(15, 23, 42, 0.18);
		font-weight: 600;
	}

	.home-section-title .btn:hover,
	#latest-posts .btn:hover {
		color: #ffffff;
		background: #0f5f77;
		border-color: #0f5f77;
	}

	.home-section-title .btn:focus-visible,
	#latest-posts .btn:focus-visible {
		outline: 2px solid #0f5f77;
		outline-offset: 2px;
	}

	/* Below-the-fold sections: keep initial render lighter on mobile/slow CPUs. */
	#company-services,
	#best-selling-items,
	#categories,
	#latest-posts {
		content-visibility: auto;
	}

	#company-services {
		contain-intrinsic-size: 220px;
	}

	#best-selling-items {
		contain-intrinsic-size: 640px;
	}

	#categories {
		contain-intrinsic-size: 420px;
	}

	#latest-posts {
		contain-intrinsic-size: 620px;
	}

	/* ===== Add to cart button ===== */
	.home-addcart-btn.is-adding {
		transform: translateY(-1px);
		box-shadow: 0 12px 18px rgba(0, 0, 0, 0.12);
	}

	.home-addcart-btn.is-added {
		animation: home-addcart-pop 0.3s cubic-bezier(0.16, 1, 0.3, 1);
	}

	@keyframes home-addcart-pop {
		0% {
			transform: scale(1);
		}
		50% {
			transform: scale(1.08);
		}
		100% {
			transform: scale(1);
		}
	}

	#latest-posts .posts img {
		width: 100%;
		height: 220px;
		object-fit: cover;
	}

	#latest-posts .posts {
		cursor: pointer;
	}

	#latest-posts .home-post-media {
		position: relative;
		margin-bottom: 0.5rem;
	}

	#latest-posts .home-post-media picture {
		display: block;
	}

	@media (max-width: 1200px) {
		#hero .hero-inner {
			width: min(740px, calc(100vw - 3rem));
		}
	}

	@media (max-height: 820px) and (min-width: 901px) {
		.hero-actions {
			margin-top: 1.15rem;
		}

		#hero .cta,
		.hero-story-link {
			min-height: 46px;
		}
	}

	@media (max-width: 900px) {
		.hero-flow-section {
			min-height: 100svh;
		}

		.hero-flow-section--two {
			height: clamp(720px, 110svh, 940px);
			min-height: clamp(680px, 104svh, 880px);
		}

		.hero-flow-media {
			inset: -4svh 0 -4svh 0;
		}

		.hero-boundary-shadow {
			top: calc(100svh - var(--hero-section-overlap) - 95px);
			height: 190px;
			filter: blur(12px);
		}

		#hero .hero-flow-image--one {
			object-position: 66% center;
		}

		#hero .hero-flow-image--two {
			object-position: 54% center;
		}

		#hero .hero-inner {
			width: 100%;
			max-width: 640px;
		}

		#hero .hero-title {
			font-size: clamp(1.12rem, 5vw, 1.45rem);
			line-height: 1.35;
		}

		#hero .hero-title strong {
			font-size: clamp(1.35rem, 6.5vw, 1.85rem);
		}
	}

	#best-selling-items .product-swiper[data-native-slider] {
		overflow-x: auto;
		overflow-y: visible;
		padding: 6px 2px 28px;
		scroll-snap-type: x mandatory;
		scrollbar-width: none;
		touch-action: pan-x pan-y;
		overscroll-behavior-x: contain;
	}

	#best-selling-items .product-swiper[data-native-slider]::-webkit-scrollbar {
		display: none;
	}

	#best-selling-items .product-swiper[data-native-slider] .swiper-wrapper {
		display: grid !important;
		grid-auto-flow: column;
		grid-auto-columns: 240px;
		gap: 12px;
		align-items: stretch;
		width: max-content !important;
		min-width: 0 !important;
	}

	#best-selling-items .product-swiper[data-native-slider] .swiper-slide {
		display: flex !important;
		width: 240px !important;
		max-width: 240px !important;
		flex: 0 0 240px !important;
		padding: 0 !important;
		box-sizing: border-box;
		scroll-snap-align: start;
	}

	#best-selling-items .product-swiper .swiper-slide .card {
		width: 100% !important;
		min-width: 0;
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

	#best-selling-items .product-thumb {
		width: 100%;
		height: 150px;
		overflow: hidden;
		display: flex;
		align-items: center;
		justify-content: center;
		flex: 0 0 150px;
	}

	#best-selling-items .product-thumb img.img-fluid {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}

	#best-selling-items .price-block {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 0.32rem;
		margin-top: 0.18rem !important;
	}

	#best-selling-items .price-block .old-price {
		color: var(--product-card-old-price-color, #5b6470) !important;
		font-size: 0.86rem;
		line-height: 1.2;
		text-decoration: line-through;
	}

	#best-selling-items .price-block .price {
		color: var(--product-card-price-color, var(--bs-primary));
		font-size: 1.08rem;
		line-height: 1.2;
	}

	#best-selling-items .product-rating-row {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		color: #f59e0b;
		font-size: 0.78rem;
		font-weight: 800;
		line-height: 1.2;
	}

	#best-selling-items .product-rating-row strong,
	#best-selling-items .product-rating-row small {
		color: #334155;
		font-size: 0.76rem;
	}

	#best-selling-items .home-product-title {
		font-size: 0.95rem;
		line-height: 1.3;
		color: var(--product-card-title-color, #111827);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		min-height: calc(1.3em * 2);
		word-break: break-word;
		overflow-wrap: anywhere;
		margin-top: 0px !important;
	}

	#best-selling-items .product-card-link {
		display: flex;
		flex-direction: column;
		min-height: 0;
		height: 100%;
		gap: 0.2rem;
	}

	#best-selling-items .product-desc-box {
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

	#best-selling-items .product-desc {
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

	.home-category-badge {
		background: #0f5f77;
		font-weight: 700;
		letter-spacing: 0.02em;
		box-shadow: 0 10px 18px rgba(15, 95, 119, 0.2);
		font-size: 0.9rem !important;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		display: inline-block;
		max-width: 85%;
		line-height: 1.2;
		padding: 0.55rem 1rem;
	}

	#categories a {
		position: relative;
		display: flex;
		align-items: flex-end;
		justify-content: flex-end;
		padding-right: 0.5rem;
	}

	@media (max-width: 768px) {
		#categories a {
			justify-content: center;
			padding-right: 0;
		}

		.home-category-badge {
			font-size: 0.65rem !important;
			padding: 0.35rem 0.6rem;
		}
	}

	#latest-posts .home-post-category-link {
		position: absolute;
		top: 0.6rem;
		left: 0.6rem;
		z-index: 2;
		display: inline-flex;
		align-items: center;
		max-width: calc(100% - 1.2rem);
		padding: 0.38rem 0.7rem;
		border-radius: 999px;
		background: rgba(15, 95, 119, 0.92);
		color: #ffffff !important;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		line-height: 1.2;
		text-decoration: none;
		box-shadow: 0 8px 18px rgba(15, 23, 42, 0.24);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	#latest-posts .home-post-category-link:hover {
		color: #ffffff !important;
		background: #0f5f77;
	}

	#latest-posts .home-post-title-link {
		display: inline-block;
		min-height: 2.75rem;
		padding: 0.2rem 0;
		line-height: 1.35;
		color: #111827;
	}

	#latest-posts .home-post-readmore {
		display: inline-flex;
		align-items: center;
		padding: 0.2rem 0;
		color: #4b5563 !important;
		font-weight: 500;
	}

	#latest-posts .home-post-category-link:focus-visible,
	#latest-posts .home-post-title-link:focus-visible,
	#latest-posts .home-post-readmore:focus-visible,
	#best-selling-items .product-slider-button-next:focus-visible,
	#best-selling-items .product-slider-button-prev:focus-visible,
	#inox .inox-ad-slider__nav:focus-visible,
	#inox .inox-ad-slider__dot:focus-visible {
		outline: 2px solid #0f5f77;
		outline-offset: 3px;
		border-radius: 999px;
	}

	#latest-posts .home-post-title-link:focus-visible {
		border-radius: 6px;
	}

	@media (max-width: 768px) {
		#best-selling-items .product-swiper[data-native-slider] .swiper-wrapper {
			grid-auto-columns: 220px;
			gap: 14px;
		}

		#best-selling-items .product-swiper[data-native-slider] .swiper-slide {
			width: 220px !important;
			max-width: 220px !important;
			flex-basis: 220px !important;
		}

		#best-selling-items .product-swiper .swiper-slide .card {
			height: 350px !important;
			max-height: 350px !important;
			min-height: 350px;
			padding-top: 0.9rem !important;
			padding-bottom: 0.8rem !important;
		}

		#best-selling-items .product-thumb {
			height: 116px;
			flex: 0 0 116px;
		}

		#best-selling-items .product-card-link {
			gap: 0.18rem;
		}

		#best-selling-items .home-product-title {
			font-size: 0.9rem;
			line-height: 1.28;
			min-height: calc(1.28em * 2);
		}

		#best-selling-items .product-desc {
			-webkit-line-clamp: 5;
			font-size: 0.8rem;
			line-height: 1.34;
		}

		#best-selling-items .product-desc-box {
			margin-top: 0.16rem;
			padding: 6px 8px;
		}

		#best-selling-items .price-block {
			display: block;
		}

		#best-selling-items .price-block .old-price {
			font-size: 0.79rem;
		}

		#best-selling-items .price-block .price {
			font-size: 0.98rem;
		}

		#latest-posts .posts img {
			height: 160px;
		}

		#latest-posts .home-post-category-link {
			top: 0.45rem;
			left: 0.45rem;
			max-width: calc(100% - 0.9rem);
			padding: 0.3rem 0.55rem;
			font-size: 0.62rem;
		}
	}

	@media (max-width: 480px) {
		#best-selling-items .product-swiper[data-native-slider] .swiper-wrapper {
			grid-auto-columns: clamp(156px, calc((100vw - 38px) / 2), 190px);
			gap: 12px;
		}

		#best-selling-items .product-swiper[data-native-slider] .swiper-slide {
			width: clamp(156px, calc((100vw - 38px) / 2), 190px) !important;
			max-width: clamp(156px, calc((100vw - 38px) / 2), 190px) !important;
			flex-basis: clamp(156px, calc((100vw - 38px) / 2), 190px) !important;
		}

		#hero .hero-inner {
			width: min(100%, calc(100vw - 2rem));
		}

		#hero .hero-flow-image--one {
			object-position: 68% center;
		}

		#hero .hero-flow-image--two {
			object-position: 50% center;
		}

		#hero .hero-title {
			font-size: 1.05rem;
		}

		#hero .hero-title strong {
			font-size: 1.32rem;
		}

		.hero-eyebrow {
			margin-bottom: 0.7rem;
			font-size: 0.66rem;
		}

		.hero-actions {
			display: grid;
			align-items: stretch;
		}

		#hero .cta,
		.hero-story-link {
			width: 100%;
			justify-content: center;
		}

		#best-selling-items .product-swiper .swiper-slide .card {
			height: 372px !important;
			max-height: 372px !important;
			min-height: 372px;
			padding-left: 10px !important;
			padding-right: 10px !important;
		}

		#best-selling-items .product-thumb {
			height: 132px;
			flex: 0 0 132px;
		}

		#best-selling-items .product-desc {
			-webkit-line-clamp: 5;
			max-height: calc(1.34em * 5);
		}
	}

	@media (max-width: 992px) {
		.parallax-layer,
		.parallax-bg {
			animation: none !important;
			transform: none !important;
			will-change: auto;
		}
	}

	:global(html.home-motion-enabled) .home-motion-item {
		opacity: 0;
		translate: var(--home-motion-x, 0px) var(--home-motion-y, 18px);
		transition:
			opacity var(--home-motion-duration, 0.8s) cubic-bezier(0.16, 1, 0.3, 1),
			translate var(--home-motion-duration, 0.8s) cubic-bezier(0.16, 1, 0.3, 1);
		transition-delay: var(--home-motion-delay, 0ms);
		will-change: opacity, translate;
	}

	:global(html.home-motion-enabled) .home-motion-item.home-motion-line {
		scale: 0.001 1;
		transition:
			opacity var(--home-motion-duration, 0.8s) cubic-bezier(0.16, 1, 0.3, 1),
			translate var(--home-motion-duration, 0.8s) cubic-bezier(0.16, 1, 0.3, 1),
			scale 0.6s cubic-bezier(0.16, 1, 0.3, 1);
	}

	:global(html.home-motion-enabled) .home-motion-item.is-visible {
		opacity: 1;
		translate: 0 0;
	}

	:global(html.home-motion-enabled) .home-motion-item.home-motion-line.is-visible {
		scale: 1 1;
	}

	:global(html.home-motion-enabled.home-motion-legacy-transform) .home-motion-item {
		translate: 0 0;
		transform: translate3d(var(--home-motion-x, 0px), var(--home-motion-y, 18px), 0);
		transition:
			opacity var(--home-motion-duration, 0.8s) cubic-bezier(0.16, 1, 0.3, 1),
			transform var(--home-motion-duration, 0.8s) cubic-bezier(0.16, 1, 0.3, 1);
		will-change: opacity, transform;
	}

	:global(html.home-motion-enabled.home-motion-legacy-transform)
		.home-motion-item.home-motion-line {
		scale: 1 1;
		transform: translate3d(var(--home-motion-x, 0px), var(--home-motion-y, 18px), 0) scaleX(0.001);
		transition:
			opacity var(--home-motion-duration, 0.8s) cubic-bezier(0.16, 1, 0.3, 1),
			transform var(--home-motion-duration, 0.8s) cubic-bezier(0.16, 1, 0.3, 1);
		transform-origin: left center;
	}

	:global(html.home-motion-enabled.home-motion-legacy-transform) .home-motion-item.is-visible {
		transform: translate3d(0, 0, 0);
	}

	:global(html.home-motion-enabled.home-motion-legacy-transform)
		.home-motion-item.home-motion-line.is-visible {
		transform: translate3d(0, 0, 0) scaleX(1);
	}

	@media (prefers-reduced-motion: no-preference) {
		@supports (animation-timeline: view()) {
			.parallax-scene {
				overflow: clip;
			}

			.parallax-layer {
				--parallax-distance: 18px;
				--parallax-scale: 1;
				will-change: transform;
				animation-name: home-parallax-layer;
				animation-duration: 1s;
				animation-timing-function: linear;
				animation-fill-mode: both;
				animation-timeline: view();
				animation-range: entry -10% exit 110%;
			}

			.parallax-bg {
				--parallax-bg-distance: 28px;
				background-position: 50% 50%;
				background-repeat: no-repeat;
				background-size: cover;
				will-change: background-position;
				animation-name: home-parallax-bg;
				animation-duration: 1s;
				animation-timing-function: linear;
				animation-fill-mode: both;
				animation-timeline: view();
				animation-range: entry -5% exit 105%;
			}

			.parallax-layer-soft {
				--parallax-distance: 14px;
			}

			.parallax-layer-deep {
				--parallax-distance: 24px;
				--parallax-scale: 1.02;
			}

			#inox .parallax-bg {
				--parallax-bg-distance: 20px;
			}

			#inox .inox-layout.parallax-layer {
				--parallax-distance: 16px;
			}

			#inox .inox-card-parallax.parallax-layer {
				--parallax-distance: 22px;
				--parallax-scale: 1.015;
			}

			@keyframes home-parallax-layer {
				from {
					transform: translate3d(0, calc(var(--parallax-distance) * -1), 0)
						scale(var(--parallax-scale));
				}
				to {
					transform: translate3d(0, var(--parallax-distance), 0) scale(var(--parallax-scale));
				}
			}

			@keyframes home-parallax-bg {
				from {
					background-position: 50% calc(50% - var(--parallax-bg-distance));
				}
				to {
					background-position: 50% calc(50% + var(--parallax-bg-distance));
				}
			}
		}
	}

	@media (prefers-reduced-motion: reduce) {
		:global(html.home-motion-enabled) .home-motion-item {
			opacity: 1;
			translate: 0 0;
			transition: none;
		}

		:global(html.home-motion-enabled) .home-motion-item.home-motion-line {
			scale: 1 1;
			transition: none;
		}

		#hero {
			min-height: auto;
		}

		.hero-flow-media,
		#hero .hero-flow-image,
		.hero-boundary-shadow,
		#hero .hero-inner,
		.hero-eyebrow {
			transform: none !important;
			transition: none;
			will-change: auto;
		}

		#hero .hero-inner.hero-copy--one,
		#hero .hero-inner.hero-copy--two {
			opacity: 1;
			transform: translate3d(-50%, -50%, 0) !important;
		}

		.hero-eyebrow--one,
		.hero-eyebrow--two {
			opacity: 1;
		}
	}

	/* Enhanced Animations from About Page */
	@keyframes slideInUp {
		from {
			opacity: 0;
			transform: translateY(20px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@keyframes bounceInLeft {
		0% {
			opacity: 0;
			transform: translateX(60px);
		}
		60% {
			opacity: 1;
			transform: translateX(-8px);
		}
		80% {
			transform: translateX(4px);
		}
		100% {
			opacity: 1;
			transform: translateX(0);
		}
	}

	@keyframes bounceInLeftLine {
		0% {
			opacity: 0;
			transform: scaleX(0.001) translateX(60px);
		}
		60% {
			opacity: 1;
			transform: scaleX(0.98) translateX(-8px);
		}
		80% {
			transform: scaleX(1) translateX(4px);
		}
		100% {
			opacity: 1;
			transform: scaleX(1) translateX(0);
		}
	}

	@keyframes fadeInUp {
		from {
			opacity: 0;
			transform: translateY(30px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@keyframes float {
		0%,
		100% {
			transform: translate(0, 0);
		}
		50% {
			transform: translate(30px, -30px);
		}
	}

	@keyframes pulse {
		0%,
		100% {
			box-shadow:
				0 0 0 2px #0dcaf0,
				0 0 0 6px rgba(13, 202, 240, 0.2);
		}
		50% {
			box-shadow:
				0 0 0 2px #0dcaf0,
				0 0 0 12px rgba(13, 202, 240, 0.1);
		}
	}

	@keyframes shimmer {
		0% {
			opacity: 0;
		}
		50% {
			opacity: 1;
		}
		100% {
			opacity: 0;
		}
	}

	@keyframes glow {
		0%,
		100% {
			box-shadow: 0 0 0 0 rgba(13, 202, 240, 0.7);
		}
		50% {
			box-shadow: 0 0 0 10px rgba(13, 202, 240, 0);
		}
	}

	#best-selling-items .product-swiper .swiper-slide .card {
		animation: fadeInUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
		opacity: 0;
	}

	#best-selling-items .product-swiper .swiper-slide .card:nth-child(1) {
		animation-delay: 0s;
	}

	#best-selling-items .product-swiper .swiper-slide .card:nth-child(2) {
		animation-delay: 0.1s;
	}

	#best-selling-items .product-swiper .swiper-slide .card:nth-child(3) {
		animation-delay: 0.2s;
	}

	#best-selling-items .product-swiper .swiper-slide .card:nth-child(4) {
		animation-delay: 0.3s;
	}

	#categories .card {
		animation: fadeInUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
		opacity: 0;
	}

	#categories .col-md-4:nth-child(1) .card {
		animation-delay: 0s;
	}

	#categories .col-md-4:nth-child(2) .card {
		animation-delay: 0.15s;
	}

	#categories .col-md-4:nth-child(3) .card {
		animation-delay: 0.3s;
	}

	.home-category-badge {
		transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
	}

	#latest-posts .posts {
		animation: fadeInUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
		opacity: 0;
	}

	#latest-posts .posts:nth-child(1) {
		animation-delay: 0s;
	}

	#latest-posts .posts:nth-child(2) {
		animation-delay: 0.1s;
	}

	#latest-posts .posts:nth-child(3) {
		animation-delay: 0.2s;
	}

	#latest-posts .posts:nth-child(4) {
		animation-delay: 0.3s;
	}

	#latest-posts .posts:nth-child(5) {
		animation-delay: 0.4s;
	}

	#latest-posts .posts:nth-child(6) {
		animation-delay: 0.5s;
	}

	#latest-posts .home-post-media {
		position: relative;
		overflow: hidden;
	}

	#latest-posts .home-post-media:hover img {
		transform: scale(1.05);
	}

	#latest-posts .home-post-media img {
		transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
	}

	.section-title h3 {
		animation: slideInUp 0.8s cubic-bezier(0.16, 1, 0.3, 1);
	}

	#inox .panel-title {
		animation: slideInUp 0.8s cubic-bezier(0.16, 1, 0.3, 1);
	}

	#inox .stat-card {
		animation: fadeInUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
		opacity: 0;
	}

	#inox .stat-card:nth-child(1) {
		animation-delay: 0s;
	}

	#inox .stat-card:nth-child(2) {
		animation-delay: 0.15s;
	}

	#inox .stat-card:nth-child(3) {
		animation-delay: 0.3s;
	}

	#company-services .icon-box {
		animation: fadeInUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
		opacity: 0;
	}

	#company-services .col-lg-3:nth-child(1) .icon-box {
		animation-delay: 0s;
	}

	#company-services .col-lg-3:nth-child(2) .icon-box {
		animation-delay: 0.1s;
	}

	#company-services .col-lg-3:nth-child(3) .icon-box {
		animation-delay: 0.2s;
	}

	#company-services .col-lg-3:nth-child(4) .icon-box {
		animation-delay: 0.3s;
	}

	/* Hover effects removed as requested */

	/* ── Kinetic wordmark band: oversized type drifting horizontally on scroll (oeg.vn feel) ── */
	#inox.panel {
		--inox-hero-overlap: clamp(128px, 24svh, 280px);
		--inox-scroll-lift: 280px;
		padding: 0;
		margin-top: calc(var(--inox-hero-overlap) * -1);
		min-height: clamp(920px, 108svh, 1100px);
		position: relative;
		z-index: 4;
		background: #05070a;
		overflow: hidden;
		isolation: isolate;
		will-change: transform;
	}

	#inox + #company-services {
		padding-top: clamp(0.9rem, 2vw, 1.75rem) !important;
	}

	@media (prefers-reduced-motion: no-preference) {
		#inox.panel {
			margin-bottom: calc(var(--inox-scroll-lift) * -1);
		}
	}

	.inox-motion-plane {
		position: relative;
		z-index: 0;
		display: flex;
		flex-direction: column;
		align-items: stretch;
		justify-content: center;
		gap: clamp(1.5rem, 3vw, 2.75rem);
		width: 100%;
		min-height: inherit;
		padding: clamp(4.5rem, 7vw, 7rem) clamp(1.25rem, 5vw, 5rem) clamp(4rem, 6vw, 6rem);
		box-sizing: border-box;
	}

	/* Full-width marquee row that merges into the #inox block; edges fade to the section's
	   own black (mask → transparent reveals the dark bg), so there are no white side strips. */
	.inox-marquee {
		position: relative;
		z-index: 2;
		display: flex;
		align-items: center;
		overflow: hidden;
		padding-block: clamp(0.5rem, 1.4vw, 1.15rem);
		margin-bottom: clamp(1.25rem, 3vw, 2.75rem);
		-webkit-mask-image: linear-gradient(90deg, transparent 0, #000 8%, #000 92%, transparent 100%);
		mask-image: linear-gradient(90deg, transparent 0, #000 8%, #000 92%, transparent 100%);
		will-change: transform, opacity;
	}

	/* Friendly Three.js particle orb — soft glowing backdrop centred behind the stage. */
	.kinetic-band__sphere {
		position: absolute;
		top: 50%;
		left: 50%;
		z-index: 1;
		display: block;
		/* Fit fully inside the stage so the sphere is never clipped at the section edge. */
		width: min(100%, 600px);
		aspect-ratio: 1 / 1;
		height: auto;
		transform: translate(-50%, -50%);
		pointer-events: none;
		opacity: 0.98;
	}

	/* Continuous auto-marquee (two identical groups → seamless -50% loop). */
	.kinetic-marquee {
		position: relative;
		z-index: 1;
		display: flex;
		flex: none;
		width: max-content;
		padding-inline: clamp(1rem, 4vw, 4rem);
		will-change: transform;
		animation: kinetic-marquee 34s linear infinite;
	}

	.kinetic-marquee__group {
		display: flex;
		align-items: center;
		gap: clamp(1.4rem, 3.5vw, 3.5rem);
		padding-right: clamp(1.4rem, 3.5vw, 3.5rem);
		white-space: nowrap;
	}

	@keyframes kinetic-marquee {
		from {
			transform: translateX(0);
		}
		to {
			transform: translateX(-50%);
		}
	}

	.kinetic-word {
		font-family: 'Be Vietnam Pro', 'Manrope', 'Segoe UI', sans-serif;
		font-weight: 700;
		font-size: clamp(3rem, 11vw, 11rem);
		line-height: 1.04;
		letter-spacing: -0.03em;
		text-transform: uppercase;
		background: linear-gradient(180deg, #ffffff 0%, #dfeef2 62%, #b9d7de 100%);
		-webkit-background-clip: text;
		background-clip: text;
		color: transparent;
	}

	/* Small Italian flag beside the eyebrow (INOXPRAN's European heritage). */
	.inox-flag {
		display: inline-flex;
		align-items: center;
		line-height: 0;
	}

	.inox-flag svg {
		display: block;
		border-radius: 3px;
		box-shadow:
			0 2px 6px rgba(0, 0, 0, 0.45),
			inset 0 0 0 1px rgba(255, 255, 255, 0.16);
	}

	@media (prefers-reduced-motion: reduce) {
		.kinetic-marquee {
			animation: none;
		}
	}

	/* ── Family Orbit proof section (part three of the cinematic sequence) ── */
	.inox-head {
		position: relative;
		z-index: 3;
		margin-bottom: clamp(0.35rem, 1vw, 0.75rem);
	}

	.inox-body {
		position: relative;
		z-index: 2;
		display: grid;
		grid-template-columns: minmax(0, 1.02fr) minmax(0, 0.98fr);
		gap: clamp(2rem, 4vw, 4.5rem);
		align-items: center;
		width: 100%;
		will-change: transform;
	}

	.inox-copy {
		min-width: 0;
		max-width: 720px;
	}

	.inox-subhead {
		margin: 0 0 clamp(1rem, 1.8vw, 1.5rem);
		font-family: 'Be Vietnam Pro', 'Manrope', 'Segoe UI', sans-serif;
		font-size: clamp(1.7rem, 3vw, 2.65rem);
		font-weight: 700;
		line-height: 1.15;
		letter-spacing: -0.015em;
		color: #f4fbfd;
	}

	.inox-lead {
		margin: 0 0 clamp(2rem, 3.4vw, 2.9rem);
		max-width: 58ch;
		font-size: clamp(1.05rem, 1.35vw, 1.24rem);
		line-height: 1.72;
		color: var(--inox-text-soft, rgba(228, 240, 244, 0.72));
	}

	.inox-statrail {
		margin: 0;
	}

	/* Stat value + star icon (e.g. "5 ★" for the energy-saving rating). */
	.inox-stat-value {
		display: inline-flex;
		align-items: baseline;
		gap: 0.45rem;
		min-width: max-content;
		white-space: nowrap;
	}

	#inox .stat-number {
		display: inline-flex;
		align-items: baseline;
		gap: 0.16em;
		white-space: nowrap;
	}

	.stat-suffix {
		font-size: 0.58em;
		font-weight: 700;
		letter-spacing: 0;
		line-height: 1;
	}

	.inox-star {
		font-size: clamp(1.8rem, 2.55vw, 2.4rem);
		line-height: 1;
		color: var(--inox-accent, #79d2e6);
		text-shadow: 0 0 14px rgba(121, 210, 230, 0.55);
	}

	.inox-benefits {
		list-style: none;
		margin: 0 0 clamp(1.9rem, 3.2vw, 2.75rem);
		padding: 0;
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: clamp(1.1rem, 2vw, 1.6rem) clamp(1.5rem, 3vw, 2.5rem);
	}

	.inox-benefit {
		display: grid;
		grid-template-columns: auto 1fr;
		grid-template-areas: 'dot title' '. desc';
		column-gap: 0.7rem;
		row-gap: 0.3rem;
	}

	.inox-benefit__dot {
		grid-area: dot;
		width: 8px;
		height: 8px;
		margin-top: 0.5rem;
		border-radius: 999px;
		background: var(--inox-accent, #79d2e6);
		box-shadow: 0 0 12px rgba(121, 210, 230, 0.6);
	}

	.inox-benefit__title {
		grid-area: title;
		font-size: 0.98rem;
		font-weight: 700;
		color: #f2fafc;
	}

	.inox-benefit__desc {
		grid-area: desc;
		font-size: 0.85rem;
		line-height: 1.5;
		color: var(--inox-text-soft, rgba(228, 240, 244, 0.72));
	}

	.inox-cta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.9rem;
	}

	.inox-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 50px;
		padding: 0.85rem 1.7rem;
		border-radius: 999px;
		font-family: 'Be Vietnam Pro', 'Manrope', 'Segoe UI', sans-serif;
		font-size: 0.92rem;
		font-weight: 700;
		letter-spacing: 0.01em;
		text-decoration: none;
		transition:
			transform 0.18s ease,
			box-shadow 0.2s ease,
			background-color 0.2s ease,
			border-color 0.2s ease;
	}

	.inox-btn--primary {
		color: #042028;
		background: linear-gradient(135deg, #c6edf5 0%, #79d2e6 55%, #57b6cd 100%);
		box-shadow: 0 14px 30px rgba(90, 190, 215, 0.26);
	}

	.inox-btn--primary:hover {
		transform: translateY(-2px);
		box-shadow: 0 20px 40px rgba(90, 190, 215, 0.4);
	}

	.inox-btn--ghost {
		color: #eaf6f9;
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.2);
	}

	.inox-btn--ghost:hover {
		transform: translateY(-2px);
		border-color: rgba(121, 210, 230, 0.55);
		background: rgba(121, 210, 230, 0.1);
	}

	.inox-btn:focus-visible {
		outline: 2px solid var(--inox-accent, #79d2e6);
		outline-offset: 3px;
	}

	.inox-stage {
		position: relative;
		min-width: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: clamp(440px, 54vh, 640px);
		will-change: transform;
	}

	.inox-orbit {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}

	.inox-orbit__ring {
		position: absolute;
		top: 50%;
		left: 50%;
		z-index: 0;
		aspect-ratio: 1 / 1;
		border: 0;
		border-radius: 50%;
		background: conic-gradient(
			from 132deg,
			transparent 0deg,
			rgba(121, 210, 230, 0.5) 24deg,
			rgba(232, 251, 255, 0.14) 64deg,
			transparent 112deg,
			rgba(121, 210, 230, 0.22) 182deg,
			transparent 248deg,
			rgba(232, 251, 255, 0.22) 306deg,
			transparent 360deg
		);
		-webkit-mask-image: radial-gradient(
			farthest-side,
			transparent calc(100% - 2px),
			#000 calc(100% - 1px)
		);
		mask-image: radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 1px));
		filter: drop-shadow(0 0 14px rgba(121, 210, 230, 0.28));
		transform: translate(-50%, -50%);
	}

	.inox-orbit__ring--1 {
		width: min(104%, 620px);
		animation: inox-orbit-spin 46s linear infinite;
	}

	.inox-orbit__ring--2 {
		width: min(78%, 460px);
		opacity: 0.62;
		animation: inox-orbit-spin 32s linear infinite reverse;
	}

	@keyframes inox-orbit-spin {
		to {
			transform: translate(-50%, -50%) rotate(360deg);
		}
	}

	.inox-orbit__chip {
		position: absolute;
		z-index: 4;
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.9rem;
		border-radius: 999px;
		background: rgba(9, 17, 21, 0.62);
		border: 1px solid rgba(255, 255, 255, 0.12);
		-webkit-backdrop-filter: blur(8px);
		backdrop-filter: blur(8px);
		box-shadow: 0 14px 28px rgba(0, 0, 0, 0.4);
		font-family: 'Be Vietnam Pro', 'Manrope', 'Segoe UI', sans-serif;
		font-size: 0.76rem;
		font-weight: 600;
		letter-spacing: 0.01em;
		color: #eaf6f9;
		white-space: nowrap;
		animation: inox-chip-float 6s ease-in-out infinite;
	}

	.inox-orbit__chip-dot {
		width: 6px;
		height: 6px;
		border-radius: 999px;
		background: var(--inox-accent, #79d2e6);
		box-shadow: 0 0 10px rgba(121, 210, 230, 0.75);
	}

	.inox-orbit__chip--1 {
		top: 4%;
		left: 2%;
		animation-delay: 0s;
	}
	.inox-orbit__chip--2 {
		top: 12%;
		right: -2%;
		animation-delay: -1.5s;
	}
	.inox-orbit__chip--3 {
		bottom: 14%;
		left: -2%;
		animation-delay: -3s;
	}
	.inox-orbit__chip--4 {
		bottom: 4%;
		right: 3%;
		animation-delay: -4.5s;
	}

	@keyframes inox-chip-float {
		0%,
		100% {
			transform: translateY(0);
		}
		50% {
			transform: translateY(-9px);
		}
	}

	.inox-bgwords {
		position: absolute;
		inset: 0;
		z-index: 0;
		overflow: hidden;
		pointer-events: none;
		user-select: none;
		will-change: transform;
	}

	.inox-bgword {
		position: absolute;
		font-family: 'Be Vietnam Pro', 'Manrope', 'Segoe UI', sans-serif;
		font-weight: 800;
		text-transform: uppercase;
		line-height: 0.8;
		letter-spacing: -0.04em;
		white-space: nowrap;
		color: rgba(255, 255, 255, 0.022);
	}

	.inox-bgword--a {
		top: -4%;
		left: -3%;
		font-size: clamp(9rem, 25vw, 28rem);
	}
	.inox-bgword--b {
		bottom: -8%;
		right: -5%;
		font-size: clamp(7rem, 18vw, 22rem);
		color: rgba(140, 205, 220, 0.026);
	}
	.inox-bgword--c {
		top: 46%;
		left: 34%;
		font-size: clamp(6rem, 15vw, 17rem);
		color: transparent;
		-webkit-text-stroke: 1px rgba(185, 229, 237, 0.03);
	}

	.inox-reveal {
		will-change: transform, opacity;
	}

	@media (max-width: 900px) {
		#inox.panel {
			--inox-hero-overlap: clamp(92px, 16svh, 160px);
			--inox-scroll-lift: 136px;
		}
		.inox-body {
			grid-template-columns: 1fr;
			gap: clamp(2rem, 6vw, 3rem);
		}
		.inox-copy {
			max-width: none;
			order: 1;
		}
		.inox-stage {
			order: 2;
			min-height: clamp(360px, 72vw, 520px);
		}
	}

	@media (max-width: 560px) {
		.inox-stat-value {
			gap: 0.28rem;
			min-width: 0;
		}
		#inox .stat-card {
			padding: 1rem clamp(0.32rem, 1.7vw, 0.55rem);
		}
		#inox .stat-number {
			gap: 0.12em;
			font-size: clamp(1.42rem, 6.8vw, 1.72rem);
		}
		.stat-suffix {
			font-size: 0.48em;
		}
		.inox-star {
			font-size: clamp(1.45rem, 6vw, 1.8rem);
		}
		.inox-benefits {
			grid-template-columns: 1fr;
		}
		.inox-cta {
			flex-direction: column;
			align-items: stretch;
		}
		.inox-btn {
			width: 100%;
		}
		.inox-orbit__chip {
			font-size: 0.68rem;
			padding: 0.4rem 0.7rem;
		}
		.inox-orbit__chip--2 {
			right: 0;
		}
		.inox-orbit__chip--3 {
			left: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.inox-orbit__ring,
		.inox-orbit__chip {
			animation: none !important;
		}
	}
</style>
