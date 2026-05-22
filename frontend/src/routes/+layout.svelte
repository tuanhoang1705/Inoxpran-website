<script>
	import '../app.css';
	import Header from '$lib/components/Header.svelte';
	import IconDefs from '$lib/components/IconDefs.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import CookieConsentBanner from '$lib/components/CookieConsentBanner.svelte';
	import FloatingChatBox from '$lib/components/FloatingChatBox.svelte';
	import RouteLoader from '$lib/components/RouteLoader.svelte';
	import CartToast from '$lib/components/CartToast.svelte';
	import LeadCaptureModal from '$lib/components/LeadCaptureModal.svelte';
	import { clearClientAccountState } from '$lib/client/accountState.js';
	import { getGuestCartCount } from '$lib/client/guestCart.js';
	import { initLocale, t, translate } from '$lib/i18n/index.js';
	import { page } from '$app/state';
	import { afterNavigate } from '$app/navigation';
	import { env } from '$env/dynamic/public';
	import { onMount } from 'svelte';
	import { setCartCount } from '$lib/stores/cartCount.js';
	import { cartToast } from '$lib/stores/cartToast.js';
	import { fetchCartCountFromServer } from '$lib/client/cartCountSync.js';
	import { initClient } from '$lib/client/initClient.js';
	import { markNavigationType } from '$lib/client/navigationState.js';
	import { getTelemetryTracker } from '$lib/client/telemetry.js';
	import {
		cookieConsent,
		canTrackTelemetry,
		initCookieConsent
	} from '$lib/stores/cookieConsent.js';
	import { SITE_CONTACT } from '$lib/config/siteContact.js';
	import {
		FREE_SHIPPING_THRESHOLD,
		buildShippingConditionsJsonLd
	} from '$lib/seo/shippingSchema.js';

	let { children } = $props(); // children = snippet default
	const DEFAULT_SITE_URL = 'https://inoxpran.com';
	const normalizeSiteUrl = (value) => {
		const raw = String(value || '').trim();
		if (!raw) return DEFAULT_SITE_URL;
		return raw.replace(/\/+$/, '');
	};

	const TRACKING_PARAM_PREFIXES = ['utm_'];
	const TRACKING_PARAMS = new Set(['gclid', 'fbclid', 'gbraid', 'wbraid', 'msclkid', 'igshid']);
	const MERCHANT_RETURN_DAYS = 7;
	const BRAND_NAME = 'Inoxpran';
	const BRAND_ALTERNATE_NAME = 'Inoxpran Vietnam';
	const BRAND_SAME_AS = Object.freeze(['https://www.facebook.com/inoxpranvietnam']);
	const BRAND_PHONE = String(SITE_CONTACT.phone || '0867 024 186').trim();
	const BRAND_EMAIL = String(SITE_CONTACT.email || 'support@inoxpran.vn').trim();
	// Query-driven listing variants should not be canonical/index targets.
	const INDEXABLE_QUERY_PARAMS_BY_PATH = new Map();
	const NOINDEX_PATH_PREFIXES = [
		'/cart',
		'/checkout',
		'/account',
		'/login',
		'/register',
		'/forgot-password',
		'/verify'
	];
	const LEAD_CAPTURE_STORAGE_KEY = 'inoxpran.lead_capture.last_auto_opened_at';
	const LEAD_CAPTURE_SESSION_VIEW_KEY = 'inoxpran.lead_capture.session_views';
	const LEAD_CAPTURE_SESSION_PATH_KEY = 'inoxpran.lead_capture.last_path';
	const LEAD_CAPTURE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
	const LEAD_CAPTURE_DWELL_MS = 20_000;
	const LEAD_CAPTURE_SECOND_PAGE_DELAY_MS = 1_500;
	const LEAD_CAPTURE_BLOCKED_PREFIXES = [
		'/cart',
		'/checkout',
		'/account',
		'/login',
		'/register',
		'/admin'
	];

	const normalizePathname = (value) => {
		const pathname = String(value || '') || '/';
		if (pathname === '/') return '/';
		return pathname.replace(/\/+$/, '');
	};

	const stripLocalePrefix = (pathname) =>
		normalizePathname(String(pathname || '').replace(/^\/en(?=\/|$)/, '') || '/');

	const isTrackingParam = (key) => {
		const normalized = String(key || '').toLowerCase();
		if (!normalized) return false;
		if (TRACKING_PARAMS.has(normalized)) return true;
		return TRACKING_PARAM_PREFIXES.some((prefix) => normalized.startsWith(prefix));
	};

	const buildCanonicalUrl = (url, baseUrl) => {
		const rawPath = normalizePathname(url?.pathname || '/');
		const pathKey = stripLocalePrefix(rawPath);
		const params = new URLSearchParams(url?.search || '');
		const filtered = new URLSearchParams();
		const allowedParams = INDEXABLE_QUERY_PARAMS_BY_PATH.get(pathKey);

		for (const [key, value] of params) {
			if (isTrackingParam(key)) continue;
			if (!value) continue;
			if (allowedParams && allowedParams.has(key)) {
				filtered.set(key, value);
			}
		}

		const query = filtered.toString();
		return `${baseUrl}${rawPath}${query ? `?${query}` : ''}`;
	};

	const shouldNoindex = (url) => {
		const rawPath = normalizePathname(url?.pathname || '/');
		const pathKey = stripLocalePrefix(rawPath);
		if (
			NOINDEX_PATH_PREFIXES.some((prefix) => pathKey === prefix || pathKey.startsWith(`${prefix}/`))
		) {
			return true;
		}

		const params = new URLSearchParams(url?.search || '');
		if (!params.size) return false;

		const allowedParams = INDEXABLE_QUERY_PARAMS_BY_PATH.get(pathKey);
		for (const [key, value] of params) {
			if (isTrackingParam(key)) continue;
			if (!value) return true;
			if (!allowedParams || !allowedParams.has(key)) return true;
		}

		return false;
	};

	const isAdminRoute = (path) => path.startsWith('/admin');
	const hideSiteChrome = $derived(isAdminRoute(page.url.pathname));
	const disableDefaultSeo = $derived(Boolean(page.data?.seo?.disableDefaults));
	const hasUserSession = $derived(Boolean(page.data?.user?.userId));
	const locale = $derived(page.data?.locale || 'vi');
	let syncedLocale = $state('');
	const layoutCartCount = $derived(page.data?.cartCount ?? 0);
	const siteUrl = $derived(normalizeSiteUrl(env.PUBLIC_SITE_URL));
	const canonicalUrl = $derived.by(() => {
		const routeCanonical = String(page.data?.canonicalUrl || '').trim();
		if (routeCanonical) return routeCanonical;
		return buildCanonicalUrl(page.url, siteUrl);
	});
	const siteTitle = $derived.by(() => translate(locale, 'site.title'));
	const siteDescription = $derived.by(() => translate(locale, 'site.description'));
	const scrollLabel = $derived.by(() => translate(locale, 'common.scroll'));
	const robotsContent = $derived.by(() => {
		if (hideSiteChrome) return 'noindex, nofollow, noarchive';
		const override = page.data?.robots;
		if (override?.content) return override.content;
		if (override?.index === false) {
			return 'noindex, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1';
		}
		if (override?.index === true) {
			return 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1';
		}
		return shouldNoindex(page.url)
			? 'noindex, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1'
			: 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1';
	});
	const buildLocalizedPath = (targetLocale) => {
		const currentPath = page.url.pathname || '/';
		const stripEn = currentPath.replace(/^\/en(?=\/|$)/, '') || '/';
		if (targetLocale === 'en') {
			return `/en${stripEn === '/' ? '' : stripEn}`;
		}
		return stripEn;
	};
	const hreflangConfig = $derived(page.data?.hreflang || null);
	const resolveAlternateHref = (value, fallback) => {
		if (value === null) return '';
		const explicit = String(value || '').trim();
		return explicit || fallback;
	};
	const hrefLangVi = $derived.by(() => {
		return resolveAlternateHref(hreflangConfig?.vi, `${siteUrl}${buildLocalizedPath('vi')}`);
	});
	const hrefLangEn = $derived.by(() => {
		return resolveAlternateHref(hreflangConfig?.en, `${siteUrl}${buildLocalizedPath('en')}`);
	});
	const hrefLangXDefault = $derived.by(() => {
		return resolveAlternateHref(hreflangConfig?.xDefault, hrefLangVi);
	});
	const merchantReturnPolicyUrl = $derived.by(
		() =>
			`${siteUrl}${locale === 'en' ? '/en/policies/returns-policy' : '/policies/returns-policy'}`
	);
	const websiteSearchUrlTemplate = $derived.by(
		() => `${siteUrl}${locale === 'en' ? '/en/shop' : '/shop'}?q={search_term_string}`
	);
	const escapeJsonLd = (value) =>
		String(value || '')
			.replace(/</g, '\\u003c')
			.replace(/>/g, '\\u003e')
			.replace(/&/g, '\\u0026')
			.replace(/\u2028/g, '\\u2028')
			.replace(/\u2029/g, '\\u2029');
	const ogLocale = $derived(locale === 'en' ? 'en_US' : 'vi_VN');
	const ogImageUrl = $derived(`${siteUrl}/og-image.png`);
	const ogImageAlt = $derived(
		locale === 'en'
			? 'Inoxpran cookware and kitchen appliance collection'
			: 'Bộ sưu tập đồ gia dụng và thiết bị nhà bếp Inoxpran'
	);
	const logoUrl = $derived(`${siteUrl}/images/logo-inoxpran.png`);
	const brandSameAs = $derived.by(() => {
		const marketplaceUrls = (
			Array.isArray(page.data?.siteMarketplaceLinks) ? page.data.siteMarketplaceLinks : []
		)
			.filter((link) => link?.enabled && link?.url)
			.map((link) => String(link.url));
		return Array.from(new Set([...BRAND_SAME_AS, ...marketplaceUrls]));
	});
	const CLIENT_UI_REFRESH_EVENT = 'inoxpran:client-ui-refresh';
	let clientInitCleanup = () => {};
	let hasClientInit = false;
	let telemetryTracker = null;
	let hasTelemetryConsent = false;
	let isTelemetryRunning = false;
	let leadCaptureTimer = null;
	let hasAutoLeadCaptureOpened = false;
	const organizationJsonLd = $derived.by(() =>
		JSON.stringify({
			'@context': 'https://schema.org',
			'@type': ['Organization', 'OnlineStore'],
			'@id': `${siteUrl}/#organization`,
			name: BRAND_NAME,
			alternateName: BRAND_ALTERNATE_NAME,
			url: siteUrl,
			logo: logoUrl,
			image: ogImageUrl,
			telephone: BRAND_PHONE,
			email: BRAND_EMAIL,
			description: siteDescription,
			sameAs: brandSameAs,
			contactPoint: [
				{
					'@type': 'ContactPoint',
					contactType: 'customer support',
					telephone: BRAND_PHONE,
					email: BRAND_EMAIL,
					areaServed: 'VN',
					availableLanguage: ['vi', 'en']
				}
			],
			areaServed: {
				'@type': 'Country',
				name: locale === 'en' ? 'Vietnam' : 'Việt Nam'
			},
			hasMerchantReturnPolicy: {
				'@type': 'MerchantReturnPolicy',
				'@id': `${siteUrl}/#merchant-return-policy`,
				url: merchantReturnPolicyUrl,
				applicableCountry: 'VN',
				returnPolicyCountry: 'VN',
				returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
				merchantReturnDays: MERCHANT_RETURN_DAYS,
				returnMethod: 'https://schema.org/ReturnByMail',
				returnFees: 'https://schema.org/ReturnFeesCustomerResponsibility',
				itemCondition: 'https://schema.org/NewCondition',
				description:
					locale === 'en'
						? 'Returns for manufacturer defects are supported within 7 days, with transit issue claims accepted within 48 hours.'
						: 'Hỗ trợ đổi trả lỗi do nhà sản xuất trong 7 ngày và tiếp nhận khiếu nại ngoại quan do vận chuyển trong 48 giờ.'
			},
			hasShippingService: {
				'@type': 'ShippingService',
				'@id': `${siteUrl}/#shipping-service`,
				name: locale === 'en' ? 'Standard nationwide shipping' : 'Giao hàng tiêu chuẩn toàn quốc',
				shippingConditions: [
					buildShippingConditionsJsonLd(),
					buildShippingConditionsJsonLd({
						minOrderValue: FREE_SHIPPING_THRESHOLD,
						shippingRateValue: 0
					})
				]
			}
		})
	);
	const localBusinessJsonLd = $derived.by(() =>
		JSON.stringify({
			'@context': 'https://schema.org',
			'@type': 'LocalBusiness',
			'@id': `${siteUrl}/#local-business`,
			name: BRAND_NAME,
			image: ogImageUrl,
			url: siteUrl,
			telephone: BRAND_PHONE,
			email: BRAND_EMAIL,
			priceRange: '$$',
			parentOrganization: {
				'@id': `${siteUrl}/#organization`
			},
			address: {
				'@type': 'PostalAddress',
				addressCountry: 'VN',
				addressRegion: locale === 'en' ? 'Vietnam' : 'Viá»‡t Nam'
			},
			areaServed: {
				'@type': 'Country',
				name: locale === 'en' ? 'Vietnam' : 'Viá»‡t Nam'
			},
			sameAs: brandSameAs
		})
	);
	const websiteJsonLd = $derived.by(() =>
		JSON.stringify({
			'@context': 'https://schema.org',
			'@type': 'WebSite',
			'@id': `${siteUrl}/#website`,
			name: BRAND_NAME,
			alternateName: BRAND_ALTERNATE_NAME,
			url: siteUrl,
			description: siteDescription,
			inLanguage: locale === 'en' ? 'en-US' : 'vi-VN',
			publisher: {
				'@id': `${siteUrl}/#organization`
			},
			potentialAction: {
				'@type': 'SearchAction',
				target: {
					'@type': 'EntryPoint',
					urlTemplate: websiteSearchUrlTemplate
				},
				'query-input': 'required name=search_term_string'
			}
		})
	);

	const syncI18nLocale = (value) => {
		const next = String(value || 'vi');
		if (next === syncedLocale) return;
		syncedLocale = next;
		initLocale(next);
	};

	// Ensure SSR markup is translated with the route locale before hydration.
	syncI18nLocale(locale);

	const runClientInit = () => {
		clientInitCleanup();
		clientInitCleanup = initClient();
		hasClientInit = true;
	};

	const trackTelemetryNavigation = () => {
		if (typeof window === 'undefined') return;
		if (!hasTelemetryConsent || !isTelemetryRunning) return;
		telemetryTracker?.trackNavigation({
			url: page.url,
			pageData: page.data,
			locale
		});
	};

	const syncTelemetryTrackerWithConsent = () => {
		if (typeof window === 'undefined') return;
		if (!telemetryTracker) return;

		if (hasTelemetryConsent) {
			telemetryTracker.start({ locale });
			isTelemetryRunning = true;
			trackTelemetryNavigation();
			return;
		}

		if (isTelemetryRunning) {
			telemetryTracker.destroy();
			isTelemetryRunning = false;
		}
	};

	const readLeadCaptureTimestamp = () => {
		if (typeof window === 'undefined') return 0;
		try {
			const value = Number(window.localStorage.getItem(LEAD_CAPTURE_STORAGE_KEY) || 0);
			return Number.isFinite(value) ? value : 0;
		} catch {
			return 0;
		}
	};

	const writeLeadCaptureTimestamp = () => {
		if (typeof window === 'undefined') return;
		try {
			window.localStorage.setItem(LEAD_CAPTURE_STORAGE_KEY, String(Date.now()));
		} catch {}
	};

	const getLeadCapturePathKey = () => stripLocalePrefix(page.url?.pathname || '/');

	const isLeadCaptureBlockedPath = () => {
		const pathKey = getLeadCapturePathKey();
		return LEAD_CAPTURE_BLOCKED_PREFIXES.some(
			(prefix) => pathKey === prefix || pathKey.startsWith(`${prefix}/`)
		);
	};

	const recordMarketingPageView = () => {
		if (typeof window === 'undefined') return 0;
		if (hideSiteChrome || isLeadCaptureBlockedPath()) return 0;
		const pathKey = getLeadCapturePathKey();
		try {
			const previousPath = window.sessionStorage.getItem(LEAD_CAPTURE_SESSION_PATH_KEY);
			const currentViews = Number(
				window.sessionStorage.getItem(LEAD_CAPTURE_SESSION_VIEW_KEY) || 0
			);
			if (previousPath === pathKey) return Number.isFinite(currentViews) ? currentViews : 0;
			const nextViews = (Number.isFinite(currentViews) ? currentViews : 0) + 1;
			window.sessionStorage.setItem(LEAD_CAPTURE_SESSION_PATH_KEY, pathKey);
			window.sessionStorage.setItem(LEAD_CAPTURE_SESSION_VIEW_KEY, String(nextViews));
			return nextViews;
		} catch {
			return 1;
		}
	};

	const shouldOpenBehaviorLeadCapture = () => {
		if (typeof window === 'undefined' || hideSiteChrome) return false;
		if (hasAutoLeadCaptureOpened) return false;
		if (page.data?.siteMarketingCampaign?.enabled === false) return false;
		if (isLeadCaptureBlockedPath()) return false;
		if (document.querySelector('.cookie-banner')) return false;
		const lastOpenedAt = readLeadCaptureTimestamp();
		if (lastOpenedAt && Date.now() - lastOpenedAt < LEAD_CAPTURE_COOLDOWN_MS) return false;
		return true;
	};

	const buildBehaviorLeadCampaign = () => {
		const configured = page.data?.siteMarketingCampaign || {};
		return {
			...configured,
			enabled: true,
			popupEnabled: true,
			kickerVi: configured.kickerVi || 'Tư vấn chọn đúng sản phẩm',
			kickerEn: configured.kickerEn || 'Product match advice',
			titleVi: configured.titleVi || 'Nhận gợi ý bộ nồi phù hợp với bếp nhà bạn',
			titleEn: configured.titleEn || 'Get the right Inoxpran recommendation for your kitchen',
			descriptionVi:
				configured.descriptionVi ||
				'Để lại email hoặc Zalo. Inoxpran sẽ tư vấn theo loại bếp, số người ăn, ngân sách và xác nhận ưu đãi hiện tại.',
			descriptionEn:
				configured.descriptionEn ||
				'Leave an email or Zalo number. Inoxpran will recommend by cooktop, household size, budget, and current offer.',
			ctaVi: configured.ctaVi || 'Nhận tư vấn',
			ctaEn: configured.ctaEn || 'Get advice',
			successVi:
				configured.successVi || 'Inoxpran đã nhận thông tin và sẽ phản hồi trong 2 giờ làm việc.',
			successEn:
				configured.successEn ||
				'Inoxpran received your request and will reply within 2 business hours.',
			offerCode: configured.offerCode || 'CONSULT',
			minOrderValue: configured.minOrderValue || 0
		};
	};

	const clearLeadCaptureTimer = () => {
		if (typeof window === 'undefined' || leadCaptureTimer === null) return;
		window.clearTimeout(leadCaptureTimer);
		leadCaptureTimer = null;
	};

	const openBehaviorLeadCapture = (reason) => {
		if (!shouldOpenBehaviorLeadCapture()) return;
		hasAutoLeadCaptureOpened = true;
		writeLeadCaptureTimestamp();
		window.dispatchEvent(
			new CustomEvent('inoxpran:open-lead-capture', {
				detail: {
					campaign: buildBehaviorLeadCampaign(),
					note:
						reason === 'second_page'
							? 'Auto lead capture: second page view'
							: 'Auto lead capture: 20s dwell'
				}
			})
		);
	};

	const scheduleBehaviorLeadCapture = (views) => {
		if (typeof window === 'undefined') return;
		clearLeadCaptureTimer();
		if (!shouldOpenBehaviorLeadCapture()) return;
		const isSecondPage = Number(views) >= 2;
		const delay = isSecondPage ? LEAD_CAPTURE_SECOND_PAGE_DELAY_MS : LEAD_CAPTURE_DWELL_MS;
		leadCaptureTimer = window.setTimeout(
			() => openBehaviorLeadCapture(isSecondPage ? 'second_page' : 'dwell'),
			delay
		);
	};

	$effect(() => {
		syncI18nLocale(locale);
	});

	$effect(() => {
		telemetryTracker?.setLocale(locale);
	});

	$effect(() => {
		if (!hasUserSession) {
			clearClientAccountState();
			return;
		}
		setCartCount(layoutCartCount);
	});

	afterNavigate(({ type }) => {
		if (typeof window === 'undefined') return;
		markNavigationType(type || 'unknown');
		if (type === 'link') {
			window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
		}
		if (hasClientInit) {
			runClientInit();
		}
		trackTelemetryNavigation();
		scheduleBehaviorLeadCapture(recordMarketingPageView());
	});

	onMount(() => {
		telemetryTracker = getTelemetryTracker();
		initCookieConsent();
		if (!hasUserSession) {
			setCartCount(getGuestCartCount());
		}
		const unsubscribeCookieConsent = cookieConsent.subscribe((consent) => {
			hasTelemetryConsent = canTrackTelemetry(consent);
			syncTelemetryTrackerWithConsent();
		});
		runClientInit();
		let isSyncingCartCount = false;

		const syncCartCount = async () => {
			if (isSyncingCartCount) return;
			isSyncingCartCount = true;
			try {
				const count = await fetchCartCountFromServer();
				if (count !== null) {
					setCartCount(count);
				}
			} finally {
				isSyncingCartCount = false;
			}
		};

		const handleCartChange = (event) => {
			const nextCount = Number(event?.detail?.count);
			if (Number.isFinite(nextCount)) {
				setCartCount(nextCount);
				return;
			}
			void syncCartCount();
		};

		const handleHistoryPopstate = () => {
			void syncCartCount();
		};

		const handlePageShow = (event) => {
			if (event?.persisted) {
				runClientInit();
			}
			void syncCartCount();
		};

		const handleClientUiRefresh = () => {
			runClientInit();
		};

		window.addEventListener('cart:change', handleCartChange);
		window.addEventListener('popstate', handleHistoryPopstate);
		window.addEventListener('pageshow', handlePageShow);
		window.addEventListener(CLIENT_UI_REFRESH_EVENT, handleClientUiRefresh);
		return () => {
			unsubscribeCookieConsent();
			if (isTelemetryRunning) {
				telemetryTracker?.destroy?.();
				isTelemetryRunning = false;
			}
			window.removeEventListener('cart:change', handleCartChange);
			window.removeEventListener('popstate', handleHistoryPopstate);
			window.removeEventListener('pageshow', handlePageShow);
			window.removeEventListener(CLIENT_UI_REFRESH_EVENT, handleClientUiRefresh);
			clearLeadCaptureTimer();
			clientInitCleanup();
		};
	});
</script>

<svelte:head>
	{#if !disableDefaultSeo}
		<title>{siteTitle}</title>
		<meta name="description" content={siteDescription} />
	{/if}
	{#if hideSiteChrome}
		<meta name="robots" content={robotsContent} />
	{:else}
		<link rel="canonical" href={canonicalUrl} />
		{#if hrefLangVi}
			<link rel="alternate" href={hrefLangVi} hreflang="vi-VN" />
		{/if}
		{#if hrefLangEn}
			<link rel="alternate" href={hrefLangEn} hreflang="en-US" />
		{/if}
		{#if hrefLangXDefault}
			<link rel="alternate" href={hrefLangXDefault} hreflang="x-default" />
		{/if}
		<meta name="robots" content={robotsContent} />
		<meta name="theme-color" content="#1d4e63" />
		<meta name="apple-mobile-web-app-title" content={BRAND_NAME} />
		<meta property="og:site_name" content={BRAND_NAME} />
		<meta property="og:locale" content={ogLocale} />
		{#if !disableDefaultSeo}
			<meta property="og:type" content="website" />
			<meta property="og:url" content={canonicalUrl} />
			<meta property="og:title" content={siteTitle} />
			<meta property="og:description" content={siteDescription} />
			<meta property="og:image" content={ogImageUrl} />
			<meta property="og:image:width" content="1200" />
			<meta property="og:image:height" content="630" />
			<meta property="og:image:alt" content={ogImageAlt} />
			<meta name="twitter:card" content="summary_large_image" />
			<meta name="twitter:title" content={siteTitle} />
			<meta name="twitter:description" content={siteDescription} />
			<meta name="twitter:image" content={ogImageUrl} />
			<meta name="twitter:image:alt" content={ogImageAlt} />
		{/if}
		{@html `<script type="application/ld+json">${escapeJsonLd(organizationJsonLd)}</script>`}
		{@html `<script type="application/ld+json">${escapeJsonLd(localBusinessJsonLd)}</script>`}
		{@html `<script type="application/ld+json">${escapeJsonLd(websiteJsonLd)}</script>`}
	{/if}
</svelte:head>

<div id="smooth-wrapper" class:has-site-header={!hideSiteChrome}>
	{#if !hideSiteChrome}
		<Header />
	{/if}
	<CartToast
		visible={$cartToast.visible}
		message={$cartToast.message}
		type={$cartToast.type}
		placement={$cartToast.placement}
		overlay={$cartToast.overlay}
		onClose={() => cartToast.hide()}
	/>
	{#if !hideSiteChrome}
		<LeadCaptureModal />
	{/if}
	<div id="smooth-content" class:has-site-header={!hideSiteChrome}>
		<IconDefs />
		<RouteLoader />
		{#if !hideSiteChrome}
			<div class="scroll-hint">
				<span>{scrollLabel}</span>
				<div class="scroll-hint-line"></div>
			</div>
		{/if}

		<main class="main-page">
			{@render children()}
		</main>

		{#if !hideSiteChrome}
			<CookieConsentBanner />
		{/if}

		{#if !hideSiteChrome}
			<FloatingChatBox />
		{/if}

		{#if !hideSiteChrome}
			<Footer />
		{/if}
	</div>
</div>
