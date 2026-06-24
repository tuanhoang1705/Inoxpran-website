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
	const heroCompositeVersion = '20260324';
	const heroCompositeUrl = `/images/bg-new.png?v=${heroCompositeVersion}`;
	const heroCompositeJpgSrcSet = `/images/optimized/bg-new-960.jpg?v=${heroCompositeVersion} 960w, /images/optimized/bg-new-1440.jpg?v=${heroCompositeVersion} 1440w, /images/optimized/bg-new-1920.jpg?v=${heroCompositeVersion} 1920w, /images/bg-new.png?v=${heroCompositeVersion} 2000w`;
	const heroCompositeSizes = '100vw';
	const inoxSlideImageSizes = '(max-width: 900px) 100vw, (max-width: 1280px) 680px, 760px';
	const BLANK_IMAGE_DATA_URL =
		'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
	const homeProductCardImageSizes = '(max-width: 576px) 50vw, (max-width: 992px) 33vw, 25vw';
	const categoryImageSizes = '(max-width: 768px) 33vw, 33vw';
	const latestPostImageSizes = '(max-width: 768px) 50vw, 25vw';
	const CLIENT_HOME_FEED_TIMEOUT_MS = 1_500;
	const DEFAULT_SITE_URL = 'https://inoxpran.com';
	const HERO_TAG_SHOP_FILTER_HREF = $derived(localizeInternalHref('/shop?q=inox', $locale));
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
	let heroIntroVisible = $state(false);
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
	const inoxInfoCards = $derived.by(() =>
		$locale === 'en'
			? [
					{
						title: 'Built for daily cooking',
						description:
							'Designed for quick weekday meals and stable heat control in family kitchens.',
						points: ['Even heat base', 'Easy-to-clean interior', 'Durable stainless finish']
					},
					{
						title: 'Kitchen compatibility',
						description:
							'Use across common cooktops and modern home setups without changing your routine.',
						points: ['Gas stove', 'Induction cooktop', 'Electric / ceramic hob']
					}
				]
			: [
					{
						title: 'Phù hợp nấu ăn hằng ngày',
						description: 'Tối ưu cho bữa cơm gia đình, giữ nhiệt ổn định và thao tác nấu gọn hơn.',
						points: ['Truyền nhiệt đều', 'Dễ vệ sinh sau nấu', 'Bề mặt inox bền đẹp']
					},
					{
						title: 'Tương thích nhiều bếp',
						description:
							'Dùng tốt trong căn bếp hiện đại mà không cần thay đổi thói quen nấu nướng.',
						points: ['Bếp gas', 'Bếp từ', 'Bếp điện / hồng ngoại']
					}
				]
	);
	const homeInoxSlides = $derived.by(() => {
		const configuredSlides = Array.isArray(data?.siteHomeSlides) ? data.siteHomeSlides : [];
		const normalized = configuredSlides
			.map((slide, index) => ({
				id: String(slide?.id || `slide-${index + 1}`),
				imageUrl: String(slide?.imageUrl || '').trim(),
				linkUrl: String(slide?.linkUrl || '').trim() || '',
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
			alt:
				String(slide.alt || '').trim() ||
				($locale === 'en'
					? `Inoxpran home promotion slide ${index + 1}`
					: `Slide quảng cáo Inoxpran ${index + 1}`)
		}));
	});
	const heroFashionIntro = $derived.by(() =>
		$locale === 'en'
			? {
					origin: 'Kitchenware from Italy',
					eyebrow: 'Italia 1954',
					titleLines: ['Inoxpran', 'Italian', 'Kitchen', 'Atelier'],
					description:
						'Mirror-polished stainless steel, clean Italian lines, and durable cookware made for the rhythm of modern family cooking.',
					tags: ['Italian heritage', '304 stainless', '12-month warranty'],
					cta: 'Shop the collection',
					storyCta: 'Our Italian story',
					noteTitle: 'Italian homeware',
					noteMeta: 'Designed for Vietnamese kitchens'
				}
			: {
					origin: 'Gia dụng bếp từ Italy',
					eyebrow: 'Italia 1954',
					titleLines: ['Inoxpran', 'dấu ấn', 'Italy'],
					description:
						'Inox sáng gương, đường nét tối giản kiểu Ý và trải nghiệm nấu bền bỉ cho nhịp sống gia đình Việt.',
					tags: ['Chính hãng', 'Vừa sang', 'Vừa tầm'],
					cta: 'Khám phá bộ sưu tập',
					storyCta: 'Câu chuyện Italy',
					noteTitle: 'Italian homeware',
					noteMeta: 'Tinh chỉnh cho bếp Việt'
				}
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

	onMount(() => {
		if (typeof window === 'undefined') return;
		if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
			heroIntroVisible = true;
			return;
		}
		let rafA = 0;
		let rafB = 0;
		rafA = window.requestAnimationFrame(() => {
			rafB = window.requestAnimationFrame(() => {
				heroIntroVisible = true;
			});
		});
		return () => {
			if (rafA) window.cancelAnimationFrame(rafA);
			if (rafB) window.cancelAnimationFrame(rafB);
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
		href={`/images/optimized/bg-new-960.jpg?v=${heroCompositeVersion}`}
		type="image/jpeg"
		imagesrcset={heroCompositeJpgSrcSet}
		imagesizes={heroCompositeSizes}
		fetchpriority="high"
		media="(max-width: 1024px)"
	/>
	<link
		rel="preload"
		as="image"
		href={`/images/optimized/bg-new-1920.jpg?v=${heroCompositeVersion}`}
		type="image/jpeg"
		imagesrcset={heroCompositeJpgSrcSet}
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
	<section id="hero" class="panel hero-panel parallax-scene">
		<div class="hero-stage parallax-layer parallax-layer-deep" aria-hidden="true">
			<div class="hero-composite-layer">
				<picture>
					<img
						src={heroCompositeUrl}
						srcset={heroCompositeJpgSrcSet}
						alt={$locale === 'en'
							? 'Inoxpran premium cookware for modern kitchens'
							: 'Gia dụng Inoxpran cao cấp cho căn bếp hiện đại'}
						class="hero-composite-image"
						width="2000"
						height="1414"
						decoding="async"
						loading="eager"
						fetchpriority="high"
						sizes={heroCompositeSizes}
					/>
				</picture>
			</div>
		</div>

		<div
			class="panel-inner hero-inner panel-inner-s1 parallax-layer parallax-layer-soft hero-intro"
			class:hero-intro-visible={heroIntroVisible}
		>
			<p class="hero-origin-label hero-intro-item" style="--hero-intro-delay: 20ms">
				{heroFashionIntro.origin}
			</p>
			<h1
				class="panel-title hero-title hero-intro-item"
				lang={$locale}
				style="--hero-intro-delay: 40ms"
				data-full={heroFashionIntro.titleLines.join(' ')}
			>
				{#each heroFashionIntro.titleLines as line}
					<span>{line}</span>
				{/each}
			</h1>
			<div
				class="panel-line hero-intro-item hero-intro-line hero-italia-line"
				style="--hero-intro-delay: 130ms"
			></div>
			<p class="panel-subtitle hero-intro-item" style="--hero-intro-delay: 210ms">
				{heroFashionIntro.description}
			</p>
			<div class="tag-row tag-row-s1 hero-intro-item" style="--hero-intro-delay: 290ms">
				{#each heroFashionIntro.tags as tag}
					<a class="tag tag-link" href={HERO_TAG_SHOP_FILTER_HREF}>{tag}</a>
				{/each}
			</div>

			<div class="hero-actions hero-intro-item" style="--hero-intro-delay: 380ms">
				<a class="cta btn-s1" href={localizeInternalHref('/shop', $locale)}>
					{heroFashionIntro.cta}
				</a>
				<a class="hero-story-link" href={localizeInternalHref('/about', $locale)}>
					{heroFashionIntro.storyCta}
				</a>
			</div>
		</div>

		<aside class="hero-editorial-note hero-intro-item" style="--hero-intro-delay: 440ms">
			<span>{heroFashionIntro.eyebrow}</span>
			<strong>{heroFashionIntro.noteTitle}</strong>
			<small>{heroFashionIntro.noteMeta}</small>
		</aside>
	</section>

	<section class="home-brand-intro" aria-labelledby="home-brand-intro-title">
		<div class="container">
			<div class="home-brand-intro__shell">
				<p class="home-brand-intro__eyebrow">{$t('home.brandIntroEyebrow')}</p>
				<div class="home-brand-intro__content">
					<div class="home-brand-intro__copy">
						<h2 id="home-brand-intro-title" class="home-brand-intro__title">
							{$t('home.brandIntroTitle')}
						</h2>
						<p class="home-brand-intro__body">{$t('home.brandIntroBody')}</p>
					</div>
					<div class="home-brand-intro__actions">
						<a class="home-brand-intro__link" href={localizeInternalHref('/about', $locale)}>
							{$t('home.brandIntroAboutCta')}
						</a>
						<a
							class="home-brand-intro__link home-brand-intro__link--muted"
							href={localizeInternalHref('/shop', $locale)}
						>
							{$t('home.brandIntroShopCta')}
						</a>
					</div>
				</div>
			</div>
		</div>
	</section>

	<section id="inox" class="panel parallax-scene">
		<div class="panel-bg parallax-bg" style="background-color: #6EA6B9;"></div>
		<div class="inox-ribbon-layer" aria-hidden="true">
			<span class="inox-ribbon inox-ribbon--1"></span>
			<span class="inox-ribbon inox-ribbon--2"></span>
			<span class="inox-ribbon inox-ribbon--3"></span>
		</div>
		<div class="inox-layout parallax-layer parallax-layer-soft">
			<div class="panel-inner">
				<h2 class="panel-title" style="color: #FFFFFF">{$t('home.inoxTitle')}</h2>
				<p class="panel-subtitle">
					{$t('home.inoxSubtitle')}
				</p>
				<div class="stats-row">
					<div class="stat-card">
						<div class="stat-number" id="stat-layers" data-suffix={$t('home.inoxStat1Suffix')}>
							925{$t('home.inoxStat1Suffix')}
						</div>
						<div class="stat-label">{$t('home.inoxStat1')}</div>
					</div>
					<div class="stat-card">
						<div
							class="stat-number"
							id="stat-grade"
							data-counter-target="20"
							data-suffix={$t('home.inoxStat2Suffix')}
						>
							20
						</div>
						<div class="stat-label">{$t('home.inoxStat2')}</div>
					</div>
					<div class="stat-card">
						<div
							class="stat-number"
							id="stat-warranty"
							data-counter-target="03"
							data-suffix={$t('home.inoxStat3Suffix')}
						>
							03
						</div>
						<div class="stat-label">{$t('home.inoxStat3')}</div>
					</div>
				</div>

				<div class="inox-info-grid">
					{#each inoxInfoCards as card}
						<div class="inox-info-card">
							<h2 class="inox-info-title">{card.title}</h2>
							<p class="inox-info-desc">{card.description}</p>
							<ul class="inox-info-list">
								{#each card.points as point}
									<li>{point}</li>
								{/each}
							</ul>
						</div>
					{/each}
				</div>

				<div class="inox-panel-actions">
					<a class="inox-panel-link alt" href={localizeInternalHref('/shop', $locale)}
						>{$t('home.heroCta')}</a
					>
					<a class="inox-panel-link alt" href={localizeInternalHref('/blog', $locale)}
						>{$t('home.latestPostsTitle')}</a
					>
				</div>
			</div>
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
		isolation: isolate;
		min-height: calc(100svh - 120px);
		padding: 7rem 7rem 4rem;
		align-items: flex-end;
		background: #101417;
	}

	#hero.hero-panel::before {
		background:
			linear-gradient(
				90deg,
				rgba(8, 12, 14, 0.82) 0%,
				rgba(8, 12, 14, 0.62) 34%,
				rgba(8, 12, 14, 0.18) 68%,
				rgba(8, 12, 14, 0.06) 100%
			),
			linear-gradient(
				180deg,
				rgba(8, 12, 14, 0.34) 0%,
				rgba(8, 12, 14, 0.08) 46%,
				rgba(8, 12, 14, 0.48) 100%
			);
		mix-blend-mode: normal;
		z-index: 1;
	}

	#hero .hero-stage {
		z-index: 0;
	}

	#hero .hero-composite-image {
		object-position: 64% 50%;
		filter: brightness(0.92) saturate(0.96) contrast(1.05);
	}

	#hero .hero-inner {
		z-index: 2;
		width: min(720px, 58vw);
		max-width: 720px;
		margin: 0;
		padding: 0;
		border-radius: 0;
		background: transparent;
		box-shadow: none;
		color: #f8fafc;
		-webkit-backdrop-filter: none;
		backdrop-filter: none;
		transform: none;
	}

	#hero .hero-origin-label {
		display: inline-flex;
		align-items: center;
		gap: 0.75rem;
		margin: 0 0 1rem;
		color: rgba(248, 250, 252, 0.82);
		font-size: 0.82rem;
		font-weight: 700;
		letter-spacing: 0;
		text-transform: uppercase;
	}

	#hero .hero-origin-label::before {
		content: '';
		width: 54px;
		height: 1px;
		background: linear-gradient(90deg, #168a45 0%, #ffffff 50%, #d61f2c 100%);
	}

	#hero .hero-title {
		display: grid;
		gap: 0;
		margin: 0;
		color: #ffffff;
		font-family: Didot, 'Bodoni 72', 'Bodoni MT', 'Cormorant Garamond', Georgia, serif;
		font-size: 6.6rem;
		font-weight: 500;
		letter-spacing: 0;
		line-height: 0.86;
		max-width: max-content;
		text-transform: uppercase;
		text-shadow: 0 18px 42px rgba(0, 0, 0, 0.34);
	}

	#hero .hero-title:lang(vi) {
		font-family: 'Playfair Display', 'Cormorant Garamond', Georgia, serif;
		font-weight: 700;
		line-height: 1.02;
		row-gap: 0.16em;
	}

	#hero .hero-title:lang(vi) span + span {
		padding-top: 0.02em;
	}

	#hero .hero-title span {
		display: block;
		white-space: nowrap;
	}

	#hero .hero-title span:nth-child(2) {
		margin-left: 0.36em;
	}

	#hero .hero-title span:nth-child(3) {
		margin-left: 0.78em;
	}

	#hero .hero-title span:nth-child(4) {
		margin-left: 0.2em;
	}

	#hero .hero-italia-line {
		width: 156px;
		height: 2px;
		margin-top: 1.35rem;
		background: linear-gradient(90deg, #168a45 0%, #ffffff 50%, #d61f2c 100%);
		border-radius: 0;
	}

	#hero .panel-subtitle {
		max-width: 540px;
		min-height: 0;
		margin-top: 1.15rem;
		color: rgba(248, 250, 252, 0.88);
		font-size: 1.05rem;
		line-height: 1.75;
		text-shadow: 0 10px 30px rgba(0, 0, 0, 0.36);
	}

	#hero .tag-row {
		gap: 0.7rem;
		margin-top: 1.45rem;
		letter-spacing: 0;
	}

	#hero .tag {
		border: 1px solid rgba(248, 250, 252, 0.55);
		border-radius: 0;
		background: rgba(8, 12, 14, 0.16);
		color: #ffffff;
		-webkit-backdrop-filter: none;
		backdrop-filter: none;
	}

	#hero .tag-link:hover {
		background: #ffffff;
		color: #111827;
	}

	.hero-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 1rem;
		margin-top: 2rem;
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
		font-weight: 700;
		text-decoration: none;
	}

	.hero-story-link:hover {
		color: #ffffff;
		border-bottom-color: #ffffff;
	}

	.hero-editorial-note {
		position: absolute;
		right: 7rem;
		bottom: 5rem;
		z-index: 2;
		display: grid;
		gap: 0.25rem;
		max-width: 260px;
		padding-left: 1rem;
		border-left: 1px solid rgba(248, 250, 252, 0.55);
		color: #ffffff;
		text-align: left;
	}

	.hero-editorial-note span,
	.hero-editorial-note small {
		color: rgba(248, 250, 252, 0.72);
		font-size: 0.76rem;
		letter-spacing: 0;
		text-transform: uppercase;
	}

	.hero-editorial-note strong {
		font-family: Didot, 'Bodoni 72', 'Bodoni MT', Georgia, serif;
		font-size: 1.45rem;
		font-weight: 500;
		line-height: 1.1;
	}

	.home-brand-intro {
		padding: 2rem 0 1rem;
		background: linear-gradient(
			180deg,
			rgba(241, 245, 249, 0.92) 0%,
			rgba(255, 255, 255, 0.98) 100%
		);
	}

	.home-brand-intro__shell {
		border: 1px solid rgba(15, 23, 42, 0.08);
		border-radius: 28px;
		padding: 1.5rem;
		background: rgba(255, 255, 255, 0.92);
		box-shadow: 0 18px 40px rgba(15, 23, 42, 0.06);
	}

	.home-brand-intro__eyebrow {
		margin: 0 0 0.45rem;
		font-size: 0.82rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #0f5f77;
	}

	.home-brand-intro__content {
		display: grid;
		grid-template-columns: minmax(0, 1.7fr) minmax(240px, 0.9fr);
		gap: 1.25rem;
		align-items: start;
	}

	.home-brand-intro__title {
		margin: 0 0 0.65rem;
		font-size: clamp(1.35rem, 2.2vw, 2rem);
		line-height: 1.15;
		color: #0f172a;
	}

	.home-brand-intro__body {
		margin: 0;
		max-width: 62ch;
		color: #475569;
		font-size: 1rem;
		line-height: 1.65;
	}

	.home-brand-intro__actions {
		display: grid;
		gap: 0.75rem;
		align-content: start;
	}

	.home-brand-intro__link {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 48px;
		padding: 0.8rem 1.15rem;
		border-radius: 999px;
		background: #0f5f77;
		color: #ffffff;
		font-weight: 700;
		text-decoration: none;
		border: 1px solid #0f5f77;
		transition:
			background-color 0.2s ease,
			color 0.2s ease,
			border-color 0.2s ease,
			transform 0.2s ease;
	}

	.home-brand-intro__link:hover {
		transform: translateY(-1px);
		background: #0b4a5d;
		border-color: #0b4a5d;
		color: #ffffff;
	}

	.home-brand-intro__link--muted {
		background: transparent;
		color: #0f172a;
		border-color: rgba(15, 23, 42, 0.14);
	}

	.home-brand-intro__link--muted:hover {
		background: #0f172a;
		border-color: #0f172a;
		color: #ffffff;
	}

	.home-brand-intro__link:focus-visible {
		outline: 2px solid #0f5f77;
		outline-offset: 2px;
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
		#hero {
			padding: 8rem 4.5rem 4.5rem;
		}

		#hero .hero-inner {
			width: min(640px, 64vw);
		}

		#hero .hero-title {
			font-size: 5rem;
		}

		.hero-editorial-note {
			right: 4.5rem;
			bottom: 4.5rem;
		}
	}

	@media (max-height: 820px) and (min-width: 901px) {
		#hero {
			padding: 4.6rem 7rem 2.75rem;
		}

		#hero .hero-origin-label {
			margin-bottom: 0.7rem;
		}

		#hero .hero-title {
			font-size: 5.35rem;
		}

		#hero .hero-italia-line {
			margin-top: 0.9rem;
		}

		#hero .panel-subtitle {
			max-width: 500px;
			margin-top: 0.8rem;
			font-size: 0.98rem;
			line-height: 1.6;
		}

		#hero .tag-row {
			margin-top: 1rem;
		}

		.hero-actions {
			margin-top: 1.25rem;
		}

		#hero .cta,
		.hero-story-link {
			min-height: 46px;
		}

		.hero-editorial-note {
			right: 12rem;
			bottom: 3rem;
		}
	}

	@media (max-width: 900px) {
		#hero {
			min-height: 760px;
			padding: 7.5rem 1.5rem 3rem;
			align-items: flex-end;
		}

		#hero.hero-panel::before {
			background:
				linear-gradient(
					90deg,
					rgba(8, 12, 14, 0.84) 0%,
					rgba(8, 12, 14, 0.6) 50%,
					rgba(8, 12, 14, 0.18) 100%
				),
				linear-gradient(180deg, rgba(8, 12, 14, 0.16) 0%, rgba(8, 12, 14, 0.42) 100%);
		}

		#hero .hero-composite-image {
			object-position: 68% 50%;
		}

		#hero .hero-inner {
			width: 100%;
			max-width: 620px;
		}

		#hero .hero-title {
			font-size: 3.7rem;
			line-height: 0.92;
		}

		#hero .hero-title:lang(vi) {
			line-height: 1.04;
			row-gap: 0.14em;
		}

		#hero .hero-title span:nth-child(2),
		#hero .hero-title span:nth-child(3),
		#hero .hero-title span:nth-child(4) {
			margin-left: 0;
		}

		#hero .panel-subtitle {
			max-width: 36rem;
			font-size: 1rem;
		}

		.hero-editorial-note {
			display: none;
		}

		.home-brand-intro__content {
			grid-template-columns: 1fr;
		}

		.home-brand-intro__shell {
			padding: 1.25rem;
			border-radius: 24px;
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
		grid-auto-columns: 260px;
		gap: 18px;
		align-items: stretch;
		width: max-content !important;
		min-width: 0 !important;
	}

	#best-selling-items .product-swiper[data-native-slider] .swiper-slide {
		display: flex !important;
		width: 260px !important;
		max-width: 260px !important;
		flex: 0 0 260px !important;
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

		#hero {
			min-height: 720px;
			padding: 7rem 1rem 2.5rem;
		}

		#hero .hero-composite-image {
			object-position: 72% 50%;
		}

		#hero .hero-origin-label {
			font-size: 0.76rem;
		}

		#hero .hero-title {
			font-size: 2.85rem;
		}

		#hero .tag-row {
			gap: 0.5rem;
		}

		#hero .tag {
			padding: 0.35rem 0.72rem;
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
			height: 306px !important;
			max-height: 306px !important;
			min-height: 306px;
			padding-left: 10px !important;
			padding-right: 10px !important;
		}

		#best-selling-items .product-thumb {
			height: 100px;
			flex: 0 0 100px;
		}

		#best-selling-items .product-desc {
			-webkit-line-clamp: 4;
			max-height: calc(1.34em * 4);
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

			#hero .parallax-bg {
				--parallax-bg-distance: 40px;
			}

			#hero .hero-stage.parallax-layer {
				--parallax-distance: 30px;
				--parallax-scale: 1.025;
			}

			#hero .hero-inner.parallax-layer {
				--parallax-distance: 16px;
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
	}

	.hero-intro .hero-intro-item {
		opacity: 0;
		transform: translate3d(0, 18px, 0);
		animation: bounceInLeft 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
		animation-delay: var(--hero-intro-delay, 0ms);
		will-change: opacity, transform;
	}

	.hero-intro .hero-intro-line {
		transform-origin: left center;
		scale: 0.001 1;
		animation: bounceInLeftLine 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
		animation-delay: var(--hero-intro-delay, 0ms);
	}

	/* Media queries and responsive rules */
	@media (prefers-reduced-motion: reduce) {
		.hero-intro .hero-intro-item,
		.hero-intro .hero-intro-line {
			opacity: 1;
			transform: none;
			scale: 1 1;
			transition: none;
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

	/* Apply animations to elements */
	.home-brand-intro__shell {
		animation: fadeInUp 0.8s cubic-bezier(0.16, 1, 0.3, 1);
	}

	.home-brand-intro__eyebrow {
		animation: slideInUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.1s backwards;
	}

	.home-brand-intro__title {
		animation: slideInUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.2s backwards;
	}

	.home-brand-intro__body {
		animation: slideInUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.3s backwards;
	}

	.home-brand-intro__link {
		animation: slideInUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.4s backwards;
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
</style>
