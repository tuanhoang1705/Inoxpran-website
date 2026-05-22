import { getLocaleFromCookies, translate } from '$lib/i18n/server.js';
import { API_BASE, API_BASE_CANDIDATES, API_KEY_HEADER } from '$lib/server/api.js';
import { createAsyncTtlCache } from '$lib/server/asyncTtlCache.js';
import {
	buildUserHeaders,
	clearUserCookies,
	getUserSession,
	setUserProfileCookies
} from '$lib/server/userAuth.js';
import { fetchUserProfile } from '$lib/server/userProfile.js';

const shouldRedirectToLogin = (status) => [401, 403, 404].includes(status);
const DEFAULT_SITE_FEATURES = Object.freeze({
	showDiscountBadge: false
});
const DEFAULT_HOME_SLIDES = Object.freeze([]);
const DEFAULT_MARKETING_CAMPAIGN = Object.freeze({
	enabled: true,
	headerEnabled: true,
	popupEnabled: false,
	kickerVi: 'Quà chào mừng',
	kickerEn: 'Welcome gift',
	titleVi: 'Nhận ưu đãi đơn đầu tiên từ Inoxpran',
	titleEn: 'Get your first-order Inoxpran offer',
	descriptionVi: 'Để lại email hoặc Zalo để nhận ưu đãi COD và tư vấn dùng sản phẩm.',
	descriptionEn: 'Leave your email or Zalo to receive a COD offer and cookware advice.',
	ctaVi: 'Nhận ưu đãi',
	ctaEn: 'Get offer',
	successVi: 'Inoxpran đã nhận thông tin và sẽ liên hệ xác nhận ưu đãi.',
	successEn: 'Inoxpran received your details and will confirm the offer.',
	offerCode: 'WELCOME',
	minOrderValue: 1500000,
	endsAt: null
});
const DEFAULT_MARKETPLACE_LINKS = Object.freeze([
	Object.freeze({ id: 'shopee', label: 'Shopee', url: '', enabled: false }),
	Object.freeze({ id: 'lazada', label: 'Lazada', url: '', enabled: false }),
	Object.freeze({ id: 'tiktok', label: 'TikTok Shop', url: '', enabled: false }),
	Object.freeze({ id: 'zalo', label: 'Zalo OA', url: '', enabled: false })
]);
const SITE_FEATURES_FETCH_TIMEOUT_MS = 2_000;
const PROFILE_FETCH_TIMEOUT_MS = 900;
const CART_FETCH_TIMEOUT_MS = 700;
const isEnglishPath = (pathname) => pathname === '/en' || pathname.startsWith('/en/');
const isAdminPath = (pathname) => pathname === '/admin' || pathname.startsWith('/admin/');
const SITE_FEATURES_CACHE = createAsyncTtlCache({
	ttlMs: 60_000,
	maxEntries: 4
});
let lastKnownSiteSettings = null;
const toSafeQuantity = (value) => {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) return 0;
	return Math.floor(parsed);
};

const readJson = async (response) => {
	try {
		return await response.json();
	} catch {
		return null;
	}
};

const fetchWithTimeout = async ({ fetch, url, options, timeoutMs }) => {
	const useTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0;
	const controller = useTimeout ? new AbortController() : null;
	let didTimeout = false;
	let timer = null;

	if (controller) {
		timer = setTimeout(() => {
			didTimeout = true;
			controller.abort();
		}, timeoutMs);
		timer.unref?.();
	}

	try {
		return await fetch(url, {
			...(options || {}),
			...(controller ? { signal: controller.signal } : {})
		});
	} catch (error) {
		if (didTimeout && error?.name === 'AbortError') {
			return null;
		}
		throw error;
	} finally {
		if (timer) clearTimeout(timer);
	}
};

const extractSiteFeatures = (rawFeatures) => {
	const source = rawFeatures && typeof rawFeatures === 'object' ? rawFeatures : {};
	return {
		showDiscountBadge:
			typeof source.showDiscountBadge === 'boolean'
				? source.showDiscountBadge
				: DEFAULT_SITE_FEATURES.showDiscountBadge
	};
};

const extractHomeSlides = (rawSlides) => {
	if (!Array.isArray(rawSlides)) return [...DEFAULT_HOME_SLIDES];
	return rawSlides
		.map((slide) => ({
			id: String(slide?.id || '').trim(),
			imageUrl: String(slide?.imageUrl || '').trim(),
			linkUrl: String(slide?.linkUrl || '').trim() || null,
			altVi: String(slide?.altVi || '').trim() || null,
			altEn: String(slide?.altEn || '').trim() || null
		}))
		.filter((slide) => slide.id && slide.imageUrl)
		.slice(0, 5);
};

const extractMarketingCampaign = (rawCampaign) => {
	const source = rawCampaign && typeof rawCampaign === 'object' ? rawCampaign : {};
	return {
		...DEFAULT_MARKETING_CAMPAIGN,
		...Object.fromEntries(
			Object.entries(source).filter(([, value]) => value !== undefined && value !== null)
		),
		enabled:
			typeof source.enabled === 'boolean' ? source.enabled : DEFAULT_MARKETING_CAMPAIGN.enabled,
		headerEnabled:
			typeof source.headerEnabled === 'boolean'
				? source.headerEnabled
				: DEFAULT_MARKETING_CAMPAIGN.headerEnabled,
		popupEnabled:
			typeof source.popupEnabled === 'boolean'
				? source.popupEnabled
				: DEFAULT_MARKETING_CAMPAIGN.popupEnabled
	};
};

const extractMarketplaceLinks = (rawLinks) => {
	const input = Array.isArray(rawLinks) ? rawLinks : [];
	const byId = new Map(input.map((item) => [String(item?.id || '').trim(), item]));
	return DEFAULT_MARKETPLACE_LINKS.map((fallback) => {
		const source = byId.get(fallback.id) || {};
		const url = String(source.url || '').trim();
		return {
			id: fallback.id,
			label: String(source.label || fallback.label).trim(),
			url,
			enabled: Boolean(source.enabled) && Boolean(url)
		};
	});
};

const getDefaultSiteSettings = () => ({
	siteFeatures: { ...DEFAULT_SITE_FEATURES },
	siteHomeSlides: [...DEFAULT_HOME_SLIDES],
	siteMarketingCampaign: { ...DEFAULT_MARKETING_CAMPAIGN },
	siteMarketplaceLinks: DEFAULT_MARKETPLACE_LINKS.map((item) => ({ ...item }))
});

const cloneSiteSettings = (settings) => ({
	siteFeatures: extractSiteFeatures(settings?.siteFeatures),
	siteHomeSlides: extractHomeSlides(settings?.siteHomeSlides),
	siteMarketingCampaign: extractMarketingCampaign(settings?.siteMarketingCampaign),
	siteMarketplaceLinks: extractMarketplaceLinks(settings?.siteMarketplaceLinks)
});

const fetchSiteSettingsFromBase = async ({ fetch, base }) => {
	const headers = {};
	if (API_KEY_HEADER) {
		headers['x-api-key'] = API_KEY_HEADER;
	}
	const response = await fetchWithTimeout({
		fetch,
		url: `${base}/site-settings`,
		options: { headers },
		timeoutMs: SITE_FEATURES_FETCH_TIMEOUT_MS
	});
	if (!response?.ok) {
		throw new Error(
			`site-settings request failed for ${base} with status ${response?.status ?? 'unknown'}`
		);
	}
	const payload = await readJson(response);
	const rawFeatures = payload?.metadata?.features ?? payload?.features ?? null;
	const rawHomeSlides = payload?.metadata?.homeSlides ?? payload?.homeSlides ?? null;
	const rawMarketingCampaign =
		payload?.metadata?.marketingCampaign ?? payload?.marketingCampaign ?? null;
	const rawMarketplaceLinks = payload?.metadata?.marketplaceLinks ?? payload?.marketplaceLinks ?? null;
	return {
		siteFeatures: extractSiteFeatures(rawFeatures),
		siteHomeSlides: extractHomeSlides(rawHomeSlides),
		siteMarketingCampaign: extractMarketingCampaign(rawMarketingCampaign),
		siteMarketplaceLinks: extractMarketplaceLinks(rawMarketplaceLinks)
	};
};

const getSiteSettingsPublic = async ({ fetch }) => {
	let lastError = null;

	for (const base of API_BASE_CANDIDATES) {
		try {
			const settings = await fetchSiteSettingsFromBase({ fetch, base });
			lastKnownSiteSettings = cloneSiteSettings(settings);
			return settings;
		} catch (error) {
			lastError = error;
		}
	}

	throw lastError || new Error(`site-settings request failed for ${API_BASE}`);
};

const getSiteSettingsCached = async ({ fetch }) => {
	try {
		return await SITE_FEATURES_CACHE.getOrLoad('site-settings:v3', () => getSiteSettingsPublic({ fetch }));
	} catch {
		return cloneSiteSettings(lastKnownSiteSettings || getDefaultSiteSettings());
	}
};

const getCartCountForSession = async ({ fetch, session }) => {
	if (!session) return { count: 0, status: null };
	try {
		const response = await fetchWithTimeout({
			fetch,
			url: `${API_BASE}/cart`,
			options: {
				headers: buildUserHeaders(session)
			},
			timeoutMs: CART_FETCH_TIMEOUT_MS
		});
		if (!response?.ok) {
			return { count: 0, status: response?.status ?? null };
		}
		const payload = await readJson(response);
		const cart = payload?.metadata ?? payload?.data ?? payload ?? null;
		const products = Array.isArray(cart?.cart_products) ? cart.cart_products : [];
		const count = products.reduce((sum, item) => sum + toSafeQuantity(item?.quantity), 0);
		return { count, status: response.status };
	} catch {
		return { count: 0, status: null };
	}
};

export const load = async (event) => {
	const { cookies, fetch, locals } = event;
	const pathname = event.url.pathname;
	const locale = isAdminPath(pathname)
		? getLocaleFromCookies(cookies)
		: isEnglishPath(pathname)
			? 'en'
			: 'vi';
	const session = getUserSession(cookies);
	const siteSettingsPromise = getSiteSettingsCached({ fetch });
	locals.accountSessionInvalid = false;

	if (!session) {
		locals.accountProfile = null;
		locals.accountProfileError = null;
		const siteSettings = await siteSettingsPromise;
		return {
			locale,
			user: null,
			profile: null,
			profileError: null,
			cartCount: 0,
			siteFeatures: siteSettings.siteFeatures,
			siteHomeSlides: siteSettings.siteHomeSlides,
			siteMarketingCampaign: siteSettings.siteMarketingCampaign,
			siteMarketplaceLinks: siteSettings.siteMarketplaceLinks
		};
	}

	const t = (key, params) => translate(locale, key, params);
	const profilePromise = fetchUserProfile({
		fetch,
		session,
		timeoutMs: PROFILE_FETCH_TIMEOUT_MS
	}).catch(() => ({
		response: null,
		payload: null,
		profile: null,
		timedOut: false
	}));
	const cartPromise = getCartCountForSession({ fetch, session });
	const [{ response, profile, timedOut: profileTimedOut }, cartResult] = await Promise.all([
		profilePromise,
		cartPromise
	]);
	let profileError = null;
	let needsLogout = false;

	if (response) {
		if (shouldRedirectToLogin(response.status)) {
			clearUserCookies(cookies);
			needsLogout = true;
		} else if (!response.ok) {
			profileError = t('account.errors.profileLoadFailedWithStatus', { status: response.status });
		}
	} else {
		if (!profileTimedOut) {
			profileError = t('account.errors.profileLoadFailed');
		}
	}

	if (needsLogout) {
		locals.accountSessionInvalid = true;
		locals.accountProfile = null;
		locals.accountProfileError = profileError;
		const siteSettings = await siteSettingsPromise;
		return {
			locale,
			user: null,
			profile: null,
			profileError,
			cartCount: 0,
			siteFeatures: siteSettings.siteFeatures,
			siteHomeSlides: siteSettings.siteHomeSlides,
			siteMarketingCampaign: siteSettings.siteMarketingCampaign,
			siteMarketplaceLinks: siteSettings.siteMarketplaceLinks
		};
	}

	if (response?.ok && profile) {
		setUserProfileCookies(cookies, profile);
	}

	locals.accountProfile = profile;
	locals.accountProfileError = profileError;

	const userWithProfile = {
		...session,
		name: profile?.name || session.name || '',
		email: profile?.email || session.email || '',
		avatar: profile?.avatar || session.avatar || ''
	};

	if ([401, 403].includes(cartResult.status)) {
		clearUserCookies(cookies);
		locals.accountSessionInvalid = true;
		locals.accountProfile = null;
		locals.accountProfileError = null;
		const siteSettings = await siteSettingsPromise;
		return {
			locale,
			user: null,
			profile: null,
			profileError: null,
			cartCount: 0,
			siteFeatures: siteSettings.siteFeatures,
			siteHomeSlides: siteSettings.siteHomeSlides,
			siteMarketingCampaign: siteSettings.siteMarketingCampaign,
			siteMarketplaceLinks: siteSettings.siteMarketplaceLinks
		};
	}

	const siteSettings = await siteSettingsPromise;
	return {
		locale,
		user: userWithProfile,
		profile,
		profileError,
		cartCount: cartResult.count,
		siteFeatures: siteSettings.siteFeatures,
		siteHomeSlides: siteSettings.siteHomeSlides,
		siteMarketingCampaign: siteSettings.siteMarketingCampaign,
		siteMarketplaceLinks: siteSettings.siteMarketplaceLinks
	};
};
