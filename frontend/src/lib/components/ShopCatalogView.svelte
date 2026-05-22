<script>
	import { onMount, tick } from 'svelte';
	import { page } from '$app/stores';
	import { beforeNavigate, goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import { env } from '$env/dynamic/public';
	import { isRecentNavigationType } from '$lib/client/navigationState.js';
	import { loadShopViewState, saveShopViewState } from '$lib/client/shopViewState.js';
	import { locale, t } from '$lib/i18n/index.js';
	import { flyToCart } from '$lib/client/flyToCart.js';
	import { addGuestCartItem } from '$lib/client/guestCart.js';
	import { syncCartCountFromActionResult } from '$lib/client/cartCountSync.js';
	import { cartToast } from '$lib/stores/cartToast.js';
	import { getMarketingRatingSummary } from '$lib/data/staticReviews.js';
	import { resolveCategorySlug } from '$lib/utils/category.js';
	import {
		SHOP_CATEGORY_VALUES,
		SHOP_TAG_VALUES,
		SHOP_PRICE_FILTER_RANGES,
		priceFilterKey
	} from '$lib/shop/catalogFilters.js';
	import { localizeInternalHref } from '$lib/utils/localePath.js';
	let { pageData } = $props();

	const DEFAULT_SITE_URL = 'https://inoxpran.com';
	const normalizeSiteUrl = (value) => {
		const raw = String(value || '').trim();
		if (!raw) return DEFAULT_SITE_URL;
		return raw.replace(/\/+$/, '');
	};
	const siteUrl = $derived(normalizeSiteUrl(env.PUBLIC_SITE_URL));
	const ogImageUrl = $derived(`${siteUrl}/og-image.png`);
	const basePath = $derived(pageData?.basePath || '/shop');
	const shopPath = $derived(pageData?.shopPath || '/shop');
	const categoryRouteEnabled = $derived(Boolean(pageData?.categoryRouteEnabled));
	const MOBILE_FILTER_BREAKPOINT = '(max-width: 992px)';
	const SHOP_SCROLL_RESTORE_RECENT_WINDOW_MS = 2500;
	const truncateMeta = (value, limit = 160) => {
		const text = String(value || '').trim();
		if (!text) return '';
		if (text.length <= limit) return text;
		return `${text.slice(0, limit - 3).trim()}...`;
	};
	const getCurrentShopViewKey = () => {
		if (typeof window === 'undefined') return '';
		return `${window.location.pathname || '/'}${window.location.search || ''}`;
	};
	const readCurrentShopViewState = () => {
		if (typeof window === 'undefined') return null;
		const key = getCurrentShopViewKey();
		if (!key) return null;
		return loadShopViewState(key);
	};
	const persistCurrentShopViewState = () => {
		if (typeof window === 'undefined') return;
		const key = getCurrentShopViewKey();
		if (!key) return;
		saveShopViewState({
			key,
			scrollY: window.scrollY || window.pageYOffset || 0,
			isFilterPanelExpanded
		});
	};

	// ✅ Toast auto hide + animation state
	let toastUnlockId = $state(null);
	let isShopCardMobileViewport = $state(
		typeof window !== 'undefined' ? window.matchMedia('(max-width: 768px)').matches : false
	);

	// ✅ Per-product button feedback (shake + check)
	let addingId = $state(null); // đang add
	let addedId = $state(null); // add xong (hiện check 1 lúc)
	let lockedAddIds = $state(new Set());

	// ✅ Fly-to-cart
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

	const FLY_TO_CART_Y_OFFSET = -60;
	const FLY_TO_CART_X_OFFSET = -50;

	const isAuthenticated = $derived(Boolean(pageData?.user));

	const categories = $derived([
		{ label: $t('shop.categoryInox'), value: SHOP_CATEGORY_VALUES[0] },
		{ label: $t('shop.categoryCastIron'), value: SHOP_CATEGORY_VALUES[1] },
		{ label: $t('shop.categoryElectronics'), value: SHOP_CATEGORY_VALUES[2] }
	]);

	const tags = $derived([
		{ label: $t('shop.tagInduction'), value: SHOP_TAG_VALUES[0] },
		{ label: $t('shop.tagNonstick'), value: SHOP_TAG_VALUES[1] },
		{ label: $t('shop.tagHeatRetention'), value: SHOP_TAG_VALUES[2] },
		{ label: $t('shop.tagMulti'), value: SHOP_TAG_VALUES[3] },
		{ label: $t('shop.tagConvenient'), value: SHOP_TAG_VALUES[4] }
	]);

	const priceFilters = $derived([
		{ label: $t('shop.priceRange1'), ...SHOP_PRICE_FILTER_RANGES[0] },
		{ label: $t('shop.priceRange2'), ...SHOP_PRICE_FILTER_RANGES[1] },
		{ label: $t('shop.priceRange3'), ...SHOP_PRICE_FILTER_RANGES[2] },
		{ label: $t('shop.priceRange4'), ...SHOP_PRICE_FILTER_RANGES[3] }
	]);
	let isFilterPanelExpanded = $state(true);
	let hasShopViewStateHydrated = $state(false);

	const sortOptions = $derived([
		{ label: $t('shop.sortDefault'), value: '' },
		{ label: $t('shop.sortPriceAsc'), value: 'price_asc' },
		{ label: $t('shop.sortPriceDesc'), value: 'price_desc' },
		{ label: $t('shop.sortNameAsc'), value: 'name_asc' },
		{ label: $t('shop.sortNameDesc'), value: 'name_desc' }
	]);

	const formatPrice = (value) => {
		if (typeof value !== 'number') return '';
		const localeValue = $locale === 'en' ? 'en-US' : 'vi-VN';
		return `${new Intl.NumberFormat(localeValue).format(value)}${$t('common.currency')}`;
	};

	const products = $derived(pageData?.products ?? []);
	const filters = $derived(pageData?.filters || {});
	const facetCounts = $derived(
		pageData?.facets?.counts ?? {
			category: {},
			tag: {},
			price: {}
		}
	);
	const categoryCountMap = $derived.by(() => {
		const next = {};
		categories.forEach((category) => {
			next[category.value] = Number(facetCounts?.category?.[category.value] ?? 0);
		});
		return next;
	});
	const tagCountMap = $derived.by(() => {
		const next = {};
		tags.forEach((tag) => {
			const value = String(tag.value || '');
			next[value] = Number(facetCounts?.tag?.[value] ?? 0);
		});
		return next;
	});
	const priceCountMap = $derived.by(() => {
		const next = {};
		priceFilters.forEach((price) => {
			const key = priceFilterKey(price);
			next[key] = Number(facetCounts?.price?.[key] ?? 0);
		});
		return next;
	});
	const categoryOptionCount = $derived.by(
		() => Object.values(categoryCountMap).filter((count) => count > 0).length
	);
	const tagOptionCount = $derived.by(
		() => Object.values(tagCountMap).filter((count) => count > 0).length
	);
	const priceOptionCount = $derived.by(
		() => Object.values(priceCountMap).filter((count) => count > 0).length
	);
	const hasFilters = $derived(
		Boolean(
			filters.q ||
			filters.tag ||
			filters.category ||
			Number.isFinite(filters.minPrice) ||
			Number.isFinite(filters.maxPrice)
		)
	);
	const isLoadingProducts = $derived(Boolean(pageData?.pending));

	const stripHtml = (value) => {
		if (!value) return '';
		return String(value)
			.replace(/<[^>]*>/g, '')
			.trim();
	};

	const getCatalogCardDescription = (value) => {
		const plain = stripHtml(value);
		if (!plain) return '';
		const limit = isShopCardMobileViewport ? 520 : 900;
		if (plain.length <= limit) return plain;
		const sliced = plain.slice(0, limit);
		const wordBoundary = sliced.lastIndexOf(' ');
		const safeSlice =
			wordBoundary > Math.floor(limit * 0.6) ? sliced.slice(0, wordBoundary) : sliced;
		return `${safeSlice.trim()}...`;
	};

	const getProductHref = (product) => {
		const slug = product?.product_slug || product?.slug || product?._id;
		return slug
			? localizeInternalHref(`/product/${slug}`, $locale)
			: localizeInternalHref(shopPath, $locale);
	};

	const toGuestCartProduct = (product) => ({
		productId: product?._id,
		name: product?.product_name,
		price: Number(product?.product_price) || 0,
		originalPrice: Number(product?.product_original_price) || 0,
		image: normalizeProductThumb(product?.product_thumb),
		href: getProductHref(product),
		weight: Number(product?.product_weight) || 1000,
		shopId: product?.product_shop || product?.shopId || ''
	});

	const productCardImageSizes = '(max-width: 576px) 50vw, (max-width: 992px) 33vw, 25vw';
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
			return `product-item${normalizeAssetIndex(itemMatch[1], 6, 1)}`;
		}
		const thumbnailMatch = decoded.match(/product-thumbnail-(\d+)(?:-\d+)?\.(?:png|webp|avif)/i);
		if (thumbnailMatch) {
			return `product-item${normalizeAssetIndex(thumbnailMatch[1], 6, 1)}`;
		}
		return '';
	};

	const normalizeProductThumb = (imageValue) => {
		const raw = String(imageValue || '').trim();
		if (!raw) return '/images/optimized/product-item1-640.webp';
		const key = getProductItemKey(raw);
		if (!key) return raw;
		return `/images/optimized/${key}-640.webp`;
	};

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

	const getFirstSrcFromSrcSet = (srcsetValue) => {
		const firstEntry = String(srcsetValue || '')
			.split(',')
			.map((part) => part.trim())
			.filter(Boolean)[0];
		if (!firstEntry) return '';
		return firstEntry.split(' ')[0] || '';
	};

	const getDiscountBadge = (product) => {
		const original = Number(product?.product_original_price);
		const current = Number(product?.product_price);
		if (!Number.isFinite(original) || !Number.isFinite(current)) return null;
		if (original <= current) return null;
		const percent = Math.round(((original - current) / original) * 100);
		return percent > 0 ? `${percent}%` : null;
	};

	const normalizeFilterQueryParams = (params) => {
		const next = new URLSearchParams(params);
		if (next.get('page') === '1') {
			next.delete('page');
		}
		const ordered = new URLSearchParams();
		Array.from(next.entries())
			.sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
			.forEach(([key, value]) => {
				ordered.append(key, value);
			});
		return ordered.toString();
	};

	const buildHref = (updates) => {
		const params = new URLSearchParams($page.url.searchParams);
		const hasCategoryUpdate = Object.prototype.hasOwnProperty.call(updates, 'category');
		const nextCategory = hasCategoryUpdate ? updates.category : undefined;
		const filterResetKeys = ['q', 'tag', 'category', 'minPrice', 'maxPrice', 'sort'];
		const shouldResetLoadMoreLimit =
			!Object.prototype.hasOwnProperty.call(updates, 'limit') &&
			filterResetKeys.some((key) => Object.prototype.hasOwnProperty.call(updates, key));

		Object.entries(updates).forEach(([key, value]) => {
			if (value === null || value === undefined || value === '') {
				params.delete(key);
			} else {
				params.set(key, String(value));
			}
		});

		if (hasCategoryUpdate) {
			params.delete('category');
		}
		if (shouldResetLoadMoreLimit) {
			params.delete('limit');
		}

		const query = normalizeFilterQueryParams(params);
		const useCleanCategory =
			categoryRouteEnabled && hasCategoryUpdate && nextCategory !== null && nextCategory !== '';
		const targetBase = useCleanCategory
			? localizeInternalHref(
					`/category/${encodeURIComponent(resolveCategorySlug(nextCategory))}`,
					$locale
				)
			: hasCategoryUpdate && !nextCategory
				? localizeInternalHref(shopPath, $locale)
				: localizeInternalHref(basePath, $locale);

		return query ? `${targetBase}?${query}` : targetBase;
	};

	const scrollToTop = async () => {
		if (typeof window === 'undefined') return;
		await tick();
		window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
	};

	const isActivePrice = (filter, activeMin, activeMax) => {
		const minMatch = Number.isFinite(activeMin) ? activeMin === filter.min : false;
		const maxMatch = Number.isFinite(activeMax)
			? activeMax === filter.max
			: filter.max === undefined && !Number.isFinite(activeMax);
		return minMatch && maxMatch;
	};

	const handleSortChange = async (event) => {
		const value = event.currentTarget.value;
		await goto(buildHref({ sort: value || null, page: 1 }), { noScroll: true });
		await scrollToTop();
	};

	const pagination = $derived(pageData?.pagination ?? {});
	const showDiscountBadge = $derived(Boolean(pageData?.siteFeatures?.showDiscountBadge));
	const lcpProductThumb = $derived.by(() => {
		const firstProduct = products[0];
		if (!firstProduct) return '';
		return normalizeProductThumb(firstProduct.product_thumb);
	});
	const lcpProductAvifSrcSet = $derived(getProductCardAvifSrcSet(lcpProductThumb));
	const lcpProductWebpSrcSet = $derived(getProductCardWebpSrcSet(lcpProductThumb));
	const lcpProductAvifHref = $derived(getFirstSrcFromSrcSet(lcpProductAvifSrcSet));
	const lcpProductWebpHref = $derived(getFirstSrcFromSrcSet(lcpProductWebpSrcSet));
	const SHOP_LOAD_MORE_STEP = 15;
	const visibleLimit = $derived(
		Math.max(Number(filters.limit) || SHOP_LOAD_MORE_STEP, SHOP_LOAD_MORE_STEP)
	);
	const hasNextPage = $derived(
		typeof pagination?.hasNextPage === 'boolean'
			? pagination.hasNextPage
			: products.length >= visibleLimit
	);
	const showingCount = $derived(products.length);
	const loadMoreButtonText = $derived(
		$locale === 'en'
			? `Show ${SHOP_LOAD_MORE_STEP} more products`
			: `Xem thêm ${SHOP_LOAD_MORE_STEP} sản phẩm`
	);
	const loadMoreHint = $derived(
		$locale === 'en'
			? `Currently showing ${showingCount} products`
			: `Đang hiển thị ${showingCount} sản phẩm`
	);
	const loadMoreDoneText = $derived(
		$locale === 'en' ? 'All matching products are displayed.' : 'Đã hiển thị hết sản phẩm phù hợp.'
	);
	const activeCategory = $derived(filters.category || '');
	const activeTag = $derived(filters.tag || '');
	const activeMinPrice = $derived(Number.isFinite(filters.minPrice) ? filters.minPrice : undefined);
	const activeMaxPrice = $derived(Number.isFinite(filters.maxPrice) ? filters.maxPrice : undefined);
	const activeSort = $derived(filters.sort || '');
	const activeSortLabel = $derived(
		sortOptions.find((option) => option.value === activeSort)?.label || ''
	);
	const activeSearch = $derived(filters.q || filters.tag || '');
	const activeSearchLabel = $derived(
		tags.find((tag) => tag.value === activeSearch)?.label ?? activeSearch
	);
	const activePriceLabel = $derived.by(() => {
		if (!Number.isFinite(activeMinPrice) && !Number.isFinite(activeMaxPrice)) return '';
		const matched = priceFilters.find((price) =>
			isActivePrice(price, activeMinPrice, activeMaxPrice)
		);
		if (matched) return matched.label;
		const minLabel = Number.isFinite(activeMinPrice) ? formatPrice(activeMinPrice) : '';
		const maxLabel = Number.isFinite(activeMaxPrice) ? formatPrice(activeMaxPrice) : '';
		if (minLabel && maxLabel) return `${minLabel} - ${maxLabel}`;
		if (minLabel) return `>= ${minLabel}`;
		if (maxLabel) return `<= ${maxLabel}`;
		return '';
	});
	const hasActiveFilterPills = $derived(
		Boolean(
			activeCategory ||
			activeTag ||
			activeSearch ||
			Number.isFinite(activeMinPrice) ||
			Number.isFinite(activeMaxPrice) ||
			activeSort
		)
	);
	const activeFilterCount = $derived.by(() => {
		let total = 0;
		if (activeCategory) total += 1;
		if (activeTag) total += 1;
		if (filters.q) total += 1;
		if (Number.isFinite(activeMinPrice) || Number.isFinite(activeMaxPrice)) total += 1;
		if (activeSort) total += 1;
		return total;
	});
	const activeFilterCountLabel = $derived(
		$locale === 'en'
			? `${activeFilterCount} active filters`
			: `${activeFilterCount} bộ lọc đang áp dụng`
	);
	const filterPanelToggleLabel = $derived(
		$locale === 'en'
			? isFilterPanelExpanded
				? 'Collapse filter panel'
				: 'Expand filter panel'
			: isFilterPanelExpanded
				? 'Thu gọn bộ lọc'
				: 'Mở rộng bộ lọc'
	);
	const filterPanelToggleText = $derived(
		$locale === 'en'
			? isFilterPanelExpanded
				? 'Collapse filters'
				: 'Expand filters'
			: isFilterPanelExpanded
				? 'Thu gọn bộ lọc'
				: 'Mở rộng bộ lọc'
	);
	const activeCategoryLabel = $derived(
		categories.find((category) => category.value === activeCategory)?.label ?? activeCategory
	);
	const activeCategorySlug = $derived(activeCategory ? resolveCategorySlug(activeCategory) : '');
	const pageTitle = $derived(
		activeCategoryLabel ? `${activeCategoryLabel} | Inoxpran` : `${$t('shop.title')} | Inoxpran`
	);
	const seoDescription = $derived.by(() => {
		const baseDescription = $t('shop.lede');
		if (activeCategoryLabel) {
			return truncateMeta(`${activeCategoryLabel}. ${baseDescription}`);
		}
		return truncateMeta(baseDescription);
	});
	const ogUrl = $derived.by(() => {
		const rawCanonical = String(pageData?.canonicalUrl || '').trim();
		if (rawCanonical) return rawCanonical;
		const pathname = $page.url?.pathname || basePath;
		const search = $page.url?.search || '';
		return `${siteUrl}${pathname}${search}`;
	});
	const shopBreadcrumbId = $derived(`${ogUrl}#breadcrumb`);
	const shopBreadcrumbJsonLd = $derived.by(() => {
		const homePath = localizeInternalHref('/', $locale);
		const productsPath = localizeInternalHref('/shop', $locale);
		const itemListElement = [
			{
				'@type': 'ListItem',
				position: 1,
				name: $t('common.home'),
				item: `${siteUrl}${homePath}`
			},
			{
				'@type': 'ListItem',
				position: 2,
				name: $t('nav.products'),
				item: `${siteUrl}${productsPath}`
			}
		];

		if (activeCategory) {
			const localizedCategoryPath = localizeInternalHref(
				`/category/${encodeURIComponent(activeCategorySlug || activeCategory)}`,
				$locale
			);
			itemListElement.push({
				'@type': 'ListItem',
				position: 3,
				name: activeCategoryLabel,
				item: `${siteUrl}${localizedCategoryPath}`
			});
		}

		return JSON.stringify({
			'@context': 'https://schema.org',
			'@type': 'BreadcrumbList',
			'@id': shopBreadcrumbId,
			itemListElement
		});
	});
	const collectionPageJsonLd = $derived.by(() => {
		const itemListElement = products
			.slice(0, 12)
			.map((product, index) => {
				const productHref = `${siteUrl}${getProductHref(product)}`;
				const productName = String(product?.product_name || '').trim();
				if (!productHref || !productName) return null;
				return {
					'@type': 'ListItem',
					position: index + 1,
					url: productHref,
					name: productName
				};
			})
			.filter(Boolean);

		const schema = {
			'@context': 'https://schema.org',
			'@type': 'CollectionPage',
			'@id': `${ogUrl}#collection-page`,
			url: ogUrl,
			name: pageTitle,
			description: seoDescription,
			inLanguage: $locale === 'en' ? 'en-US' : 'vi-VN',
			isPartOf: {
				'@id': `${siteUrl}/#website`
			},
			about: {
				'@id': `${siteUrl}/#organization`
			},
			breadcrumb: {
				'@id': shopBreadcrumbId
			}
		};

		if (itemListElement.length) {
			schema.mainEntity = {
				'@type': 'ItemList',
				itemListOrder: 'https://schema.org/ItemListOrderAscending',
				numberOfItems: products.length,
				itemListElement
			};
		}

		return JSON.stringify(schema);
	});

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
					cartToast.show(result.data?.error ?? $t('cart.errors.addFailed'), 'danger');
					return;
				}

				cartToast.show($t('cart.errors.addFailed'), 'danger');
			};
		};
	};

	const loadMoreProducts = async () => {
		if (!hasNextPage) return;
		await goto(buildHref({ limit: visibleLimit + SHOP_LOAD_MORE_STEP, page: 1 }), {
			noScroll: true,
			keepFocus: true
		});
	};

	beforeNavigate(() => {
		persistCurrentShopViewState();
	});

	$effect(() => {
		const currentPanelState = isFilterPanelExpanded;
		if (!hasShopViewStateHydrated || typeof window === 'undefined') return;
		persistCurrentShopViewState();
		void currentPanelState;
	});

	onMount(() => {
		const savedViewState = readCurrentShopViewState();
		const isMobileViewport =
			typeof window !== 'undefined' && window.matchMedia(MOBILE_FILTER_BREAKPOINT).matches;
		if (savedViewState && typeof savedViewState.isFilterPanelExpanded === 'boolean') {
			isFilterPanelExpanded = savedViewState.isFilterPanelExpanded;
		} else if (isMobileViewport) {
			isFilterPanelExpanded = false;
		}

		const requestClientUiRefresh = () => {
			if (typeof window === 'undefined') return;
			window.dispatchEvent(new CustomEvent('inoxpran:client-ui-refresh'));
		};

		void tick().then(() => {
			requestClientUiRefresh();
		});

		if (typeof window === 'undefined') {
			hasShopViewStateHydrated = true;
			return;
		}

		const cardViewportMq = window.matchMedia('(max-width: 768px)');
		const syncCardViewport = () => {
			isShopCardMobileViewport = cardViewportMq.matches;
		};
		syncCardViewport();
		if (cardViewportMq.addEventListener) {
			cardViewportMq.addEventListener('change', syncCardViewport);
		} else {
			cardViewportMq.addListener(syncCardViewport);
		}

		const shouldRestoreScroll = isRecentNavigationType(
			'popstate',
			SHOP_SCROLL_RESTORE_RECENT_WINDOW_MS
		);

		let restoreRafA = null;
		let restoreRafB = null;
		let restoreTimerA = null;
		let restoreTimerB = null;
		let scrollPersistRaf = null;

		if (shouldRestoreScroll && savedViewState && Number.isFinite(savedViewState.scrollY)) {
			const restoreTop = Math.max(0, Math.round(savedViewState.scrollY));
			const applyScrollRestore = () => {
				window.scrollTo({ top: restoreTop, left: 0, behavior: 'auto' });
			};

			applyScrollRestore();
			restoreRafA = requestAnimationFrame(() => {
				applyScrollRestore();
				restoreRafB = requestAnimationFrame(applyScrollRestore);
			});
			restoreTimerA = window.setTimeout(applyScrollRestore, 120);
			restoreTimerB = window.setTimeout(applyScrollRestore, 320);
		}

		const queuePersistOnScroll = () => {
			if (scrollPersistRaf !== null) return;
			scrollPersistRaf = requestAnimationFrame(() => {
				scrollPersistRaf = null;
				persistCurrentShopViewState();
			});
		};

		const persistBeforeUnload = () => {
			persistCurrentShopViewState();
		};

		window.addEventListener('scroll', queuePersistOnScroll, { passive: true });
		window.addEventListener('pagehide', persistBeforeUnload);
		window.addEventListener('beforeunload', persistBeforeUnload);

		hasShopViewStateHydrated = true;
		persistCurrentShopViewState();

		return () => {
			persistCurrentShopViewState();
			window.removeEventListener('scroll', queuePersistOnScroll);
			window.removeEventListener('pagehide', persistBeforeUnload);
			window.removeEventListener('beforeunload', persistBeforeUnload);
			if (scrollPersistRaf !== null) {
				cancelAnimationFrame(scrollPersistRaf);
			}
			if (restoreRafA !== null) {
				cancelAnimationFrame(restoreRafA);
			}
			if (restoreRafB !== null) {
				cancelAnimationFrame(restoreRafB);
			}
			if (restoreTimerA !== null) {
				clearTimeout(restoreTimerA);
			}
			if (restoreTimerB !== null) {
				clearTimeout(restoreTimerB);
			}
			if (cardViewportMq.removeEventListener) {
				cardViewportMq.removeEventListener('change', syncCardViewport);
			} else {
				cardViewportMq.removeListener(syncCardViewport);
			}
		};
	});
</script>

<svelte:head>
	<title>{pageTitle}</title>
	<meta name="description" content={seoDescription} />
	<meta property="og:type" content="website" />
	<meta property="og:url" content={ogUrl} />
	<meta property="og:title" content={pageTitle} />
	<meta property="og:description" content={seoDescription} />
	<meta property="og:image" content={ogImageUrl} />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={pageTitle} />
	<meta name="twitter:description" content={seoDescription} />
	<meta name="twitter:image" content={ogImageUrl} />
	{@html '<script type="application/ld+json">' + shopBreadcrumbJsonLd + '</script>'}
	{@html '<script type="application/ld+json">' + collectionPageJsonLd + '</script>'}
	{#if lcpProductAvifSrcSet && lcpProductAvifHref}
		<link
			rel="preload"
			as="image"
			href={lcpProductAvifHref}
			type="image/avif"
			imagesrcset={lcpProductAvifSrcSet}
			imagesizes={productCardImageSizes}
			fetchpriority="high"
		/>
	{:else if lcpProductWebpSrcSet && lcpProductWebpHref}
		<link
			rel="preload"
			as="image"
			href={lcpProductWebpHref}
			type="image/webp"
			imagesrcset={lcpProductWebpSrcSet}
			imagesizes={productCardImageSizes}
			fetchpriority="high"
		/>
	{/if}
</svelte:head>

<section class="shop-top">
	<div class="container">
		<p class="eyebrow">{$t('shop.eyebrow')}</p>
		<h1 class="shop-title">{$t('shop.heading')}</h1>
		<p class="shop-lede">{$t('shop.lede')}</p>
		{#if activeSearch}
			<p class="text-black-50">{$t('shop.filteringBy', { value: activeSearchLabel })}</p>
		{/if}
		{#if pageData?.apiError}
			<p class="text-danger">{pageData.apiError}</p>
		{/if}
	</div>
</section>

<section class="shopify-grid padding-large">
	<div class="container">
		<div class="row flex-row-reverse g-md-5">
			<main class="col-12">
				<div class="smart-filter-panel">
					<div class="smart-filter-top">
						<div class="showing-product smart-showing">
							<p>{$t('shop.showing', { count: showingCount })}</p>
							{#if activeFilterCount > 0}
								<span class="smart-active-count-badge">{activeFilterCountLabel}</span>
							{/if}
						</div>
						<form class="smart-search-form" method="GET">
							<input
								type="search"
								name="q"
								value={filters.q || ''}
								placeholder={$locale === 'en' ? 'Search products...' : 'Tìm sản phẩm...'}
								aria-label={$locale === 'en' ? 'Search products' : 'Tìm sản phẩm'}
							/>
							{#if Number.isFinite(activeMinPrice)}
								<input type="hidden" name="minPrice" value={activeMinPrice} />
							{/if}
							{#if Number.isFinite(activeMaxPrice)}
								<input type="hidden" name="maxPrice" value={activeMaxPrice} />
							{/if}
							{#if activeSort}
								<input type="hidden" name="sort" value={activeSort} />
							{/if}
							<button type="submit">{$locale === 'en' ? 'Search' : 'Tìm'}</button>
						</form>
						<div class="sort-by smart-sort">
							<select
								id="sorting"
								class="form-select"
								onchange={handleSortChange}
								value={activeSort}
							>
								{#each sortOptions as option}
									<option value={option.value}>{option.label}</option>
								{/each}
							</select>
						</div>
					</div>

					<div
						id="smart-filter-panel-body"
						class={`smart-filter-panel-body ${isFilterPanelExpanded ? 'is-open' : ''}`}
					>
						<div class="smart-filter-groups">
							<div class="smart-filter-group">
								<div class="smart-filter-head">
									<p class="smart-filter-label">
										<span class="smart-filter-title">{$t('shop.sidebarCategoriesTitle')}</span>
										<span class="smart-group-badge">{categoryOptionCount}</span>
									</p>
								</div>
								<div class="smart-chip-row">
									{#each categories as category, chipIndex}
										{@const categoryCount = categoryCountMap[category.value] ?? 0}
										<a
											href={buildHref({ category: category.value, page: 1 })}
											rel="nofollow"
											class={`smart-chip ${category.value === activeCategory ? 'is-active' : ''}`}
											style={`--chip-index:${chipIndex}`}
										>
											<span class="smart-chip-label">{category.label}</span>
											<span class="smart-chip-count">{categoryCount}</span>
										</a>
									{/each}
								</div>
							</div>

							<div class="smart-filter-group">
								<p class="smart-filter-label">
									<span class="smart-filter-title">{$t('shop.sidebarTagsTitle')}</span>
									<span class="smart-group-badge">{tagOptionCount}</span>
								</p>
								<div class="smart-chip-row">
									{#each tags as tag, chipIndex}
										{@const tagCount = tagCountMap[tag.value] ?? 0}
										<a
											href={buildHref({ tag: tag.value, q: null, page: 1 })}
											rel="nofollow"
											class={`smart-chip ${tag.value === activeTag ? 'is-active' : ''}`}
											style={`--chip-index:${chipIndex}`}
										>
											<span class="smart-chip-label">{tag.label}</span>
											<span class="smart-chip-count">{tagCount}</span>
										</a>
									{/each}
								</div>
							</div>

							<div class="smart-filter-group">
								<p class="smart-filter-label">
									<span class="smart-filter-title">{$t('shop.sidebarPriceTitle')}</span>
									<span class="smart-group-badge">{priceOptionCount}</span>
								</p>
								<div class="smart-chip-row">
									{#each priceFilters as price, chipIndex}
										{@const priceCount = priceCountMap[priceFilterKey(price)] ?? 0}
										<a
											href={buildHref({ minPrice: price.min, maxPrice: price.max, page: 1 })}
											rel="nofollow"
											class={`smart-chip ${isActivePrice(price, activeMinPrice, activeMaxPrice) ? 'is-active' : ''}`}
											style={`--chip-index:${chipIndex}`}
										>
											<span class="smart-chip-label">{price.label}</span>
											<span class="smart-chip-count">{priceCount}</span>
										</a>
									{/each}
								</div>
							</div>
						</div>

						{#if hasActiveFilterPills}
							<div class="smart-active-filters">
								{#if activeCategory}
									<a
										class="active-filter-chip"
										href={buildHref({ category: null, page: 1 })}
										rel="nofollow"
									>
										{activeCategoryLabel} ×
									</a>
								{/if}
								{#if activeTag}
									<a
										class="active-filter-chip"
										href={buildHref({ tag: null, q: null, page: 1 })}
										rel="nofollow"
									>
										{tags.find((tag) => tag.value === activeTag)?.label ?? activeTag} ×
									</a>
								{/if}
								{#if filters.q}
									<a
										class="active-filter-chip"
										href={buildHref({ q: null, page: 1 })}
										rel="nofollow"
									>
										"{filters.q}" ×
									</a>
								{/if}
								{#if activePriceLabel}
									<a
										class="active-filter-chip"
										href={buildHref({ minPrice: null, maxPrice: null, page: 1 })}
										rel="nofollow"
									>
										{activePriceLabel} ×
									</a>
								{/if}
								{#if activeSort}
									<a
										class="active-filter-chip"
										href={buildHref({ sort: null, page: 1 })}
										rel="nofollow"
									>
										{activeSortLabel} ×
									</a>
								{/if}
								<a
									class="active-filter-clear"
									href={buildHref({
										q: null,
										tag: null,
										category: null,
										minPrice: null,
										maxPrice: null,
										sort: null,
										page: 1
									})}
									rel="nofollow"
								>
									{$t('shop.clearFilters')}
								</a>
							</div>
						{/if}
					</div>

					<div class="smart-panel-collapse-row">
						<button
							type="button"
							class="smart-panel-collapse-btn"
							aria-expanded={isFilterPanelExpanded}
							aria-controls="smart-filter-panel-body"
							aria-label={filterPanelToggleLabel}
							onclick={() => {
								isFilterPanelExpanded = !isFilterPanelExpanded;
							}}
						>
							<span>{filterPanelToggleText}</span>
							<svg
								viewBox="0 0 24 24"
								fill="none"
								aria-hidden="true"
								class:is-open={isFilterPanelExpanded}
							>
								<path d="M6 9L12 15L18 9"></path>
							</svg>
						</button>
					</div>
				</div>

				{#if products.length === 0}
					{#if isLoadingProducts}
						<div class="row product-content product-store">
							{#each Array(8) as _, i}
								<div class="col-xxl-3 col-lg-3 col-md-6 mb-4">
									<div class="card product-card position-relative p-4 border rounded-3">
										<div class="product-thumb skeleton skeleton-thumb"></div>
										<div class="skeleton-line lg skeleton"></div>
										<div class="skeleton-line md skeleton"></div>
										<div class="skeleton-line sm skeleton"></div>
										<div class="skeleton-line lg skeleton" style="margin-top:14px;"></div>
										<div class="card-concern position-absolute start-0 end-0 d-flex gap-2">
											<div
												class="btn btn-dark addcart-btn skeleton"
												style="width:46px; height:46px;"
											></div>
										</div>
									</div>
								</div>
							{/each}
						</div>
					{:else}
						<div class="text-center py-5">
							<p class="mb-2">{$t('shop.noResults')}</p>
							<a
								class="btn btn-outline-dark"
								href={buildHref({
									q: null,
									tag: null,
									category: null,
									minPrice: null,
									maxPrice: null,
									page: 1
								})}
								rel="nofollow"
							>
								{$t('shop.clearFilters')}
							</a>
						</div>
					{/if}
				{:else}
					<div class="row product-content product-store">
						{#each products as product, index}
							{@const productThumb = normalizeProductThumb(product.product_thumb)}
							{@const productThumbAvifSrcSet = getProductCardAvifSrcSet(productThumb)}
							{@const productThumbWebpSrcSet = getProductCardWebpSrcSet(productThumb)}
							{@const ratingSummary = getMarketingRatingSummary(product, $locale)}
							<div class="col-xxl-3 col-lg-3 col-md-6 mb-4">
								<div class="card product-card position-relative p-4 border rounded-3">
									{#if showDiscountBadge && getDiscountBadge(product)}
										<div class="position-absolute">
											<p class="bg-primary py-1 px-3 fs-6 text-white rounded-2">
												{getDiscountBadge(product)}
											</p>
										</div>
									{/if}
									<a
										class="product-card-link"
										href={getProductHref(product)}
										aria-label={product.product_name}
										data-track="product_click"
										data-track-section="shop_catalog"
										data-product-id={product?._id}
										data-product-slug={product?.product_slug || product?.slug || ''}
										data-product-name={product?.product_name || ''}
									>
										<div class="product-thumb">
											<picture>
												{#if productThumbAvifSrcSet}
													<source
														type="image/avif"
														srcset={productThumbAvifSrcSet}
														sizes={productCardImageSizes}
													/>
												{/if}
												{#if productThumbWebpSrcSet}
													<source
														type="image/webp"
														srcset={productThumbWebpSrcSet}
														sizes={productCardImageSizes}
													/>
												{/if}
												<img
													src={productThumb}
													class="img-fluid shadow-sm"
													alt={product.product_name}
													width="640"
													height="640"
													loading={index === 0 ? 'eager' : 'lazy'}
													fetchpriority={index === 0 ? 'high' : 'low'}
													decoding="async"
													sizes={productCardImageSizes}
												/>
											</picture>
										</div>
										<h6 class="mt-3 mb-0 fw-bold">{product.product_name}</h6>
										<div class="price-block y align-items-center gap-2">
											<span class="price text-primary fw-bold mb-2 fs-5">
												{formatPrice(product.product_price)}
											</span>
											{#if product.product_original_price}
												<span class="old-price fw-bold text-decoration-line-through text-black-50">
													{formatPrice(product.product_original_price)}
												</span>
											{/if}
										</div>
										<div class="product-rating-row" aria-label={ratingSummary.label}>
											<span aria-hidden="true">★★★★★</span>
											<strong>{ratingSummary.formattedAverage}</strong>
											<small>({ratingSummary.count})</small>
										</div>
										<div class="product-desc-box">
											<p class="product-desc mb-0">
												{getCatalogCardDescription(product.product_description)}
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
												class="btn btn-dark addcart-btn"
												class:is-adding={addingId === product?._id}
												class:is-added={addedId === product?._id}
												disabled={addingId || isAddLocked(product?._id)}
												data-track="add_to_cart_click"
												data-track-section="shop_catalog"
												data-product-id={product?._id}
												data-product-slug={product?.product_slug || product?.slug || ''}
												data-product-name={product?.product_name || ''}
												data-bs-toggle="tooltip"
												data-bs-placement="top"
												data-bs-trigger="hover"
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
					</div>
				{/if}

				{#if products.length}
					<div class="shop-load-more" aria-live="polite">
						<p class="shop-load-more__hint">{loadMoreHint}</p>
						{#if hasNextPage}
							<button
								type="button"
								class="shop-load-more__btn"
								onclick={loadMoreProducts}
								aria-label={loadMoreButtonText}
							>
								{loadMoreButtonText}
							</button>
						{:else if showingCount > 0}
							<p class="shop-load-more__done">{loadMoreDoneText}</p>
						{/if}
					</div>
				{/if}
			</main>

			<aside class="col-md-3 shop-sidebar d-none">
				<div class="sidebar ps-lg-5">
					<div class="widget-product-categories pt-5">
						<div class="section-title overflow-hidden mb-2">
							<h3 class="d-flex flex-column mb-0">{$t('shop.sidebarCategoriesTitle')}</h3>
						</div>
						<ul class="product-categories mb-0 sidebar-list list-unstyled">
							{#each categories as category}
								<li class="cat-item">
									<a
										href={buildHref({ category: category.value, page: 1 })}
										rel="nofollow"
										class={category.value === activeCategory ? 'active' : ''}
									>
										{category.label}
									</a>
								</li>
							{/each}
						</ul>
					</div>

					<div class="widget-product-tags pt-5">
						<div class="section-title overflow-hidden mb-2">
							<h3 class="d-flex flex-column mb-0">{$t('shop.sidebarTagsTitle')}</h3>
						</div>
						<ul class="product-tags mb-0 sidebar-list list-unstyled">
							{#each tags as tag}
								<li class="tags-item">
									<a
										href={buildHref({ tag: tag.value, q: null, page: 1 })}
										rel="nofollow"
										class={tag.value === activeTag ? 'active' : ''}
									>
										{tag.label}
									</a>
								</li>
							{/each}
						</ul>
					</div>

					<div class="widget-price-filter pt-5">
						<div class="section-title overflow-hidden mb-2">
							<h3 class="d-flex flex-column mb-0">{$t('shop.sidebarPriceTitle')}</h3>
						</div>
						<ul class="product-tags mb-0 sidebar-list list-unstyled">
							{#each priceFilters as price}
								<li class="tags-item">
									<a
										href={buildHref({ minPrice: price.min, maxPrice: price.max, page: 1 })}
										rel="nofollow"
										class={isActivePrice(price, activeMinPrice, activeMaxPrice) ? 'active' : ''}
									>
										{price.label}
									</a>
								</li>
							{/each}
						</ul>
					</div>

					<div class="pt-4">
						<a
							class="btn btn-outline-dark w-100"
							href={buildHref({
								q: null,
								tag: null,
								category: null,
								minPrice: null,
								maxPrice: null,
								sort: null,
								page: 1
							})}
							rel="nofollow"
						>
							{$t('shop.clearFilters')}
						</a>
					</div>
				</div>
			</aside>
		</div>
	</div>
</section>

<style>
	.smart-filter-panel {
		--shop-accent: var(--primary-color, #0dcaf0);
		--shop-accent-rgb: 13, 202, 240;
		--shop-accent-strong: #0b89a8;
		--shop-border: rgba(22, 24, 35, 0.1);
		--shop-bg: #fff;
		position: relative;
		z-index: 24;
		padding: 16px;
		margin-bottom: 18px;
		border: 1px solid rgba(22, 24, 35, 0.12);
		border-radius: 14px;
		background: linear-gradient(180deg, rgba(255, 255, 255, 0.99), rgba(237, 250, 255, 0.97));
		backdrop-filter: blur(12px);
		box-shadow:
			0 14px 34px rgba(16, 24, 40, 0.1),
			0 2px 6px rgba(16, 24, 40, 0.06);
		overflow: clip;
	}

	.smart-filter-panel::after {
		content: '';
		position: absolute;
		inset: 0 0 auto 0;
		height: 2px;
		background: linear-gradient(
			90deg,
			rgba(var(--shop-accent-rgb), 0.68),
			rgba(var(--shop-accent-rgb), 0.08) 58%
		);
		pointer-events: none;
	}

	.smart-filter-top {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(280px, 2fr) minmax(180px, 1fr);
		gap: 12px;
		align-items: center;
	}

	.smart-showing {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		align-items: center;
	}

	.smart-showing p {
		margin: 0;
		font-weight: 700;
		color: #1f1a14;
	}

	.smart-active-count-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.15rem 0.6rem;
		border-radius: 999px;
		background: rgba(var(--shop-accent-rgb), 0.16);
		color: var(--shop-accent-strong);
		font-size: 0.74rem;
		font-weight: 700;
		line-height: 1.4;
	}

	.smart-search-form {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px;
		border: 1px solid rgba(31, 26, 20, 0.12);
		border-radius: 999px;
		background: #fff;
	}

	.smart-search-form input[type='search'] {
		flex: 1;
		min-width: 0;
		border: none;
		outline: none;
		background: transparent;
		padding: 0 10px;
		font-size: 0.92rem;
	}

	.smart-search-form button {
		border: none;
		padding: 0.48rem 1rem;
		border-radius: 999px;
		font-weight: 700;
		color: #fff;
		background: var(--shop-accent);
		transition:
			filter 0.2s ease,
			transform 0.12s ease,
			box-shadow 0.2s ease;
	}

	.smart-search-form button:hover {
		filter: brightness(0.95);
		box-shadow: 0 8px 18px rgba(var(--shop-accent-rgb), 0.3);
	}

	.smart-search-form button:active {
		transform: scale(0.96);
		box-shadow: none;
	}

	.smart-sort .form-select {
		border-radius: 999px;
		border-color: rgba(31, 26, 20, 0.2);
		font-weight: 600;
		transition:
			border-color 0.2s ease,
			box-shadow 0.2s ease;
	}

	.smart-sort .form-select:focus {
		border-color: rgba(var(--shop-accent-rgb), 0.54);
		box-shadow: 0 0 0 0.2rem rgba(var(--shop-accent-rgb), 0.16);
	}

	.smart-filter-panel-body {
		overflow: hidden;
		max-height: 760px;
		opacity: 1;
		transition:
			max-height 0.3s ease,
			opacity 0.2s ease,
			margin-top 0.2s ease;
	}

	.smart-filter-panel-body:not(.is-open) {
		max-height: 0;
		opacity: 0;
		pointer-events: none;
	}

	.smart-filter-groups {
		margin-top: 14px;
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 10px;
	}

	.smart-filter-group {
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
		align-content: start;
		align-items: start;
		gap: 10px;
		padding: 12px 12px 11px;
		min-height: 124px;
		border: 1px solid rgba(31, 26, 20, 0.08);
		border-radius: 12px;
		background: rgba(255, 255, 255, 0.9);
		transition:
			border-color 0.2s ease,
			box-shadow 0.2s ease,
			background-color 0.2s ease;
	}

	.smart-filter-group:hover {
		border-color: rgba(var(--shop-accent-rgb), 0.26);
		box-shadow: 0 8px 20px rgba(var(--shop-accent-rgb), 0.12);
	}

	.smart-filter-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}

	.smart-panel-collapse-row {
		margin-top: 10px;
		padding-top: 10px;
		display: flex;
		justify-content: center;
		border-top: 1px dashed rgba(var(--shop-accent-rgb), 0.24);
	}

	.smart-panel-collapse-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 0.38rem 0.82rem;
		border: 1px solid rgba(var(--shop-accent-rgb), 0.34);
		border-radius: 999px;
		background: #f4fbff;
		color: var(--shop-accent-strong);
		font-size: 0.78rem;
		font-weight: 700;
		line-height: 1;
		transition:
			transform 0.12s ease,
			box-shadow 0.2s ease,
			border-color 0.2s ease,
			background-color 0.2s ease;
	}

	.smart-panel-collapse-btn:hover {
		background: rgba(var(--shop-accent-rgb), 0.16);
		border-color: rgba(var(--shop-accent-rgb), 0.48);
		box-shadow: 0 7px 14px rgba(var(--shop-accent-rgb), 0.18);
	}

	.smart-panel-collapse-btn:active {
		transform: scale(0.97);
	}

	.smart-panel-collapse-btn:focus-visible {
		outline: none;
		border-color: rgba(var(--shop-accent-rgb), 0.52);
		box-shadow: 0 0 0 3px rgba(var(--shop-accent-rgb), 0.2);
	}

	.smart-panel-collapse-btn svg {
		width: 16px;
		height: 16px;
		stroke: currentColor;
		stroke-width: 2.2;
		stroke-linecap: round;
		stroke-linejoin: round;
		transition: transform 0.2s ease;
	}

	.smart-panel-collapse-btn svg.is-open {
		transform: rotate(180deg);
	}

	.smart-filter-label {
		margin: 0;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: rgba(31, 26, 20, 0.72);
	}

	.smart-filter-title {
		line-height: 1.1;
	}

	.smart-group-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 20px;
		height: 20px;
		padding: 0 6px;
		border-radius: 999px;
		background: rgba(var(--shop-accent-rgb), 0.16);
		color: var(--shop-accent-strong);
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: normal;
		text-transform: none;
	}

	.smart-chip-row {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		align-items: flex-start;
		align-content: flex-start;
	}

	@media (min-width: 993px) {
		.smart-filter-groups {
			align-items: stretch;
		}

		.smart-filter-group {
			min-height: 138px;
		}

		.smart-filter-head {
			min-height: 22px;
		}

		.smart-filter-label {
			min-height: 22px;
		}
	}

	.smart-chip {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 0.44rem 0.78rem;
		position: relative;
		overflow: hidden;
		border-radius: 8px;
		border: 1px solid rgba(31, 26, 20, 0.14);
		background: #fff;
		color: #2f2f2f;
		font-size: 0.84rem;
		font-weight: 600;
		will-change: transform;
		transition:
			border-color 0.2s ease,
			box-shadow 0.2s ease,
			color 0.2s ease,
			transform 0.12s ease;
		animation: chip-pop 0.24s ease both;
		animation-delay: calc(var(--chip-index, 0) * 24ms);
	}

	.smart-chip::before {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(120deg, rgba(var(--shop-accent-rgb), 0.14), rgba(255, 255, 255, 0));
		opacity: 0;
		transition: opacity 0.2s ease;
		pointer-events: none;
	}

	.smart-chip::after {
		content: '';
		position: absolute;
		inset: auto;
		width: 120%;
		aspect-ratio: 1;
		top: 50%;
		left: 50%;
		border-radius: 50%;
		background: radial-gradient(
			circle,
			rgba(var(--shop-accent-rgb), 0.22),
			rgba(var(--shop-accent-rgb), 0)
		);
		transform: translate(-50%, -50%) scale(0.1);
		opacity: 0;
		pointer-events: none;
		transition:
			transform 0.22s ease,
			opacity 0.22s ease;
	}

	.smart-chip-label {
		line-height: 1.2;
	}

	.smart-chip > span {
		position: relative;
		z-index: 1;
	}

	.smart-chip-count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 18px;
		height: 18px;
		padding: 0 5px;
		border-radius: 999px;
		background: #f3f4f6;
		color: #5f5f5f;
		font-size: 0.72rem;
		font-weight: 700;
		line-height: 1;
	}

	.smart-chip:hover {
		color: var(--shop-accent);
		border-color: rgba(var(--shop-accent-rgb), 0.5);
		box-shadow: 0 8px 18px rgba(var(--shop-accent-rgb), 0.2);
		transform: translateY(-2px);
	}

	.smart-chip:hover::before {
		opacity: 1;
	}

	.smart-chip:hover .smart-chip-count {
		background: rgba(var(--shop-accent-rgb), 0.2);
		color: var(--shop-accent-strong);
	}

	.smart-chip:active {
		transform: translateY(1px) scale(0.97);
		box-shadow: inset 0 0 0 1px rgba(var(--shop-accent-rgb), 0.24);
	}

	.smart-chip:active::after {
		opacity: 1;
		transform: translate(-50%, -50%) scale(1);
	}

	.smart-chip:focus-visible {
		outline: none;
		border-color: rgba(var(--shop-accent-rgb), 0.54);
		box-shadow: 0 0 0 3px rgba(var(--shop-accent-rgb), 0.18);
	}

	.smart-chip.is-active {
		color: var(--shop-accent);
		background: #edfaff;
		border-color: rgba(var(--shop-accent-rgb), 0.5);
		box-shadow: inset 0 0 0 1px rgba(var(--shop-accent-rgb), 0.24);
	}

	.smart-chip.is-active .smart-chip-count {
		background: rgba(var(--shop-accent-rgb), 0.24);
		color: var(--shop-accent-strong);
	}

	.smart-active-filters {
		margin-top: 14px;
		padding-top: 12px;
		border-top: 1px dashed rgba(31, 26, 20, 0.12);
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		align-items: center;
	}

	.active-filter-chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 0.38rem 0.7rem;
		border-radius: 999px;
		border: 1px solid rgba(var(--shop-accent-rgb), 0.34);
		background: #edfaff;
		color: var(--shop-accent-strong);
		font-size: 0.8rem;
		font-weight: 700;
		transition:
			transform 0.12s ease,
			box-shadow 0.2s ease;
	}

	.active-filter-chip:hover {
		transform: translateY(-1px);
		box-shadow: 0 8px 16px rgba(var(--shop-accent-rgb), 0.18);
	}

	.active-filter-clear {
		margin-left: auto;
		font-size: 0.8rem;
		font-weight: 700;
		color: #2d6170;
	}

	@media (max-width: 992px) {
		.smart-filter-panel {
			padding: 14px;
		}

		.smart-filter-top {
			grid-template-columns: 1fr;
		}

		.smart-filter-groups {
			grid-template-columns: 1fr;
		}

		.active-filter-clear {
			margin-left: 0;
		}
	}

	@media (max-width: 768px) {
		.smart-filter-panel {
			padding: 12px;
			margin-bottom: 14px;
		}

		.smart-showing p {
			font-size: 0.86rem;
		}

		.smart-active-count-badge {
			font-size: 0.68rem;
			padding: 0.1rem 0.5rem;
		}

		.smart-search-form {
			padding: 5px;
			gap: 6px;
		}

		.smart-search-form input[type='search'] {
			font-size: 0.84rem;
			padding: 0 8px;
		}

		.smart-search-form button {
			padding: 0.42rem 0.78rem;
			font-size: 0.76rem;
		}

		.smart-sort .form-select {
			font-size: 0.82rem;
			padding-top: 0.42rem;
			padding-bottom: 0.42rem;
		}

		.smart-filter-groups {
			margin-top: 10px;
			gap: 8px;
		}

		.smart-filter-group {
			gap: 6px;
			padding: 10px 9px;
			min-height: 112px;
		}

		.smart-filter-label {
			font-size: 0.68rem;
			gap: 6px;
		}

		.smart-group-badge {
			min-width: 18px;
			height: 18px;
			font-size: 0.64rem;
		}

		.smart-chip {
			font-size: 0.76rem;
			padding: 0.36rem 0.62rem;
			gap: 6px;
			border-radius: 7px;
		}

		.smart-chip-count {
			min-width: 16px;
			height: 16px;
			font-size: 0.64rem;
			padding: 0 4px;
		}

		.active-filter-chip,
		.active-filter-clear {
			font-size: 0.74rem;
		}
	}

	@media (max-width: 576px) {
		.smart-filter-panel {
			border-radius: 12px;
			padding: 10px;
		}

		.smart-filter-group {
			padding: 9px 8px;
			min-height: 60px;
		}

		.smart-chip-row {
			flex-wrap: nowrap;
			overflow-x: auto;
			padding-bottom: 2px;
			scrollbar-width: thin;
		}

		.smart-chip-row::-webkit-scrollbar {
			height: 5px;
		}

		.smart-chip-row::-webkit-scrollbar-thumb {
			background: rgba(31, 26, 20, 0.18);
			border-radius: 999px;
		}

		.smart-chip {
			flex: 0 0 auto;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.smart-chip,
		.smart-search-form button,
		.smart-filter-group,
		.smart-panel-collapse-btn,
		.smart-filter-panel-body {
			animation: none;
			transition: none;
		}
	}

	@keyframes chip-pop {
		from {
			opacity: 0;
			transform: translateY(4px);
		}

		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.product-store {
		--bs-gutter-x: 0.95rem;
		--bs-gutter-y: 0.8rem;
		row-gap: 0.45rem;
	}

	.product-store > [class*='col-'] {
		margin-bottom: 0.75rem !important;
	}

	@media (min-width: 992px) {
		.product-store > [class*='col-'] {
			flex: 0 0 20% !important;
			max-width: 20% !important;
		}
	}

	.product-store .product-card-link {
		display: flex;
		flex-direction: column;
		height: 100%;
		gap: 0.2rem;
	}

	.product-store .product-card {
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

	.product-store .product-thumb {
		width: 100%;
		height: 150px;
		overflow: hidden;
		display: flex;
		align-items: center;
		justify-content: center;
		flex: 0 0 150px;
	}

	.product-store .product-thumb img.img-fluid {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}

	.product-store .product-card-link h6 {
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

	.product-store .price-block {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 0.32rem;
		margin-top: 0.18rem !important;
	}

	.product-store .price-block .old-price {
		color: var(--product-card-old-price-color, #5b6470) !important;
		font-size: 0.86rem;
		line-height: 1.2;
		text-decoration: line-through;
	}

	.product-store .price-block .price {
		color: var(--product-card-price-color, var(--bs-primary));
		font-size: 1.08rem;
		line-height: 1.2;
		margin-bottom: 0 !important;
	}

	.product-store .product-rating-row {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		color: #f59e0b;
		font-size: 0.78rem;
		font-weight: 800;
		line-height: 1.2;
	}

	.product-store .product-rating-row strong,
	.product-store .product-rating-row small {
		color: #334155;
		font-size: 0.76rem;
	}

	.product-store .product-desc-box {
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

	.product-store .product-desc {
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
		.product-store {
			--bs-gutter-x: 0.7rem;
			--bs-gutter-y: 0.65rem;
			row-gap: 0.35rem;
		}

		.product-store > [class*='col-'] {
			margin-bottom: 0.6rem !important;
		}

		.product-store .product-card-link {
			gap: 0.18rem;
		}

		.product-store .product-card {
			height: 350px;
			max-height: 350px;
			padding-top: 0.9rem !important;
			padding-bottom: 0.8rem !important;
		}

		.product-store .product-thumb {
			height: 116px;
			flex: 0 0 116px;
		}

		.product-store .product-card-link h6 {
			font-size: 0.9rem;
			line-height: 1.28;
			min-height: calc(1.28em * 2);
			margin-top: 0.35rem !important;
		}

		.product-store .product-desc-box {
			margin-top: 0.16rem;
			padding: 6px 8px;
		}

		.product-store .product-desc {
			-webkit-line-clamp: 5;
			font-size: 0.8rem;
			line-height: 1.34;
		}

		.product-store .price-block {
			display: block;
		}

		.product-store .price-block .old-price {
			font-size: 0.79rem;
		}

		.product-store .price-block .price {
			font-size: 0.98rem;
		}
	}

	@media (max-width: 480px) {
		.product-store .product-card {
			height: 320px;
			max-height: 320px;
		}

		.product-store .product-thumb {
			height: 108px;
			flex: 0 0 108px;
		}
	}

	.shop-load-more {
		margin-top: 30px;
		padding-top: 18px;
		border-top: 1px solid rgba(31, 26, 20, 0.08);
		display: grid;
		justify-items: center;
		gap: 10px;
	}

	.shop-load-more__hint,
	.shop-load-more__done {
		margin: 0;
		font-size: 0.9rem;
		color: rgba(31, 26, 20, 0.68);
		text-align: center;
	}

	.shop-load-more__done {
		font-weight: 600;
		color: rgba(31, 26, 20, 0.78);
	}

	.shop-load-more__btn {
		border: 1px solid rgba(11, 135, 153, 0.28);
		background: linear-gradient(180deg, #ffffff, #edf8fb);
		color: #0b6f7e;
		font-weight: 700;
		border-radius: 999px;
		padding: 0.72rem 1.35rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		transition:
			transform 0.2s ease,
			box-shadow 0.2s ease,
			border-color 0.2s ease,
			background-color 0.2s ease;
		box-shadow: 0 8px 18px rgba(11, 135, 153, 0.1);
	}

	.shop-load-more__btn:hover {
		transform: translateY(-1px);
		border-color: rgba(11, 135, 153, 0.42);
		box-shadow: 0 12px 24px rgba(11, 135, 153, 0.16);
	}

	.shop-load-more__btn:active {
		transform: translateY(0);
	}

	.shop-load-more__btn:focus-visible {
		outline: none;
		box-shadow:
			0 0 0 3px rgba(11, 135, 153, 0.16),
			0 10px 20px rgba(11, 135, 153, 0.12);
	}

	@media (max-width: 576px) {
		.shop-load-more__btn {
			width: 100%;
		}
	}
</style>
