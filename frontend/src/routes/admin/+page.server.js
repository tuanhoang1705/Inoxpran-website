import { fail, redirect } from '@sveltejs/kit';
import { API_BASE } from '$lib/server/api.js';
import { getTranslator } from '$lib/i18n/admin/server.js';
import { buildAdminHeaders, getAdminSession } from '$lib/server/adminAuth.js';
import { setAdminToast } from '$lib/server/adminToast.js';

const DEFAULT_SITE_FEATURE_DEFINITIONS = Object.freeze([
	{
		key: 'showDiscountBadge',
		type: 'boolean',
		defaultValue: false
	}
]);
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

const safeJson = async (response) => {
	try {
		return await response.json();
	} catch {
		return null;
	}
};

const normalizeSiteFeatureDefinitions = (payload) => {
	const rawDefinitions = payload?.metadata?.definitions;
	if (!Array.isArray(rawDefinitions) || rawDefinitions.length === 0) {
		return [...DEFAULT_SITE_FEATURE_DEFINITIONS];
	}

	const uniqueKeys = new Set();
	const normalized = [];
	for (const definition of rawDefinitions) {
		const key = String(definition?.key || '').trim();
		if (!key || uniqueKeys.has(key)) continue;
		uniqueKeys.add(key);
		normalized.push({
			key,
			type: 'boolean',
			defaultValue: Boolean(definition?.defaultValue)
		});
	}

	return normalized.length ? normalized : [...DEFAULT_SITE_FEATURE_DEFINITIONS];
};

const normalizeSiteFeatures = (payload, definitions) => {
	const rawFeatures = payload?.metadata?.features;
	const source = rawFeatures && typeof rawFeatures === 'object' ? rawFeatures : {};
	return definitions.reduce((result, definition) => {
		const key = definition.key;
		result[key] =
			typeof source[key] === 'boolean' ? source[key] : Boolean(definition.defaultValue);
		return result;
	}, {});
};

const normalizeMarketingCampaign = (payload) => {
	const source = payload?.metadata?.marketingCampaign;
	if (!source || typeof source !== 'object') return { ...DEFAULT_MARKETING_CAMPAIGN };
	return {
		...DEFAULT_MARKETING_CAMPAIGN,
		...source,
		enabled: typeof source.enabled === 'boolean' ? source.enabled : DEFAULT_MARKETING_CAMPAIGN.enabled,
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

const normalizeMarketplaceLinks = (payload) => {
	const rawLinks = Array.isArray(payload?.metadata?.marketplaceLinks)
		? payload.metadata.marketplaceLinks
		: [];
	const byId = new Map(rawLinks.map((item) => [String(item?.id || '').trim(), item]));
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

// Hidden with the admin AI knowledge shortcut by request.
// const normalizeAgentKnowledgeSettings = (payload) => ({
// 	documents: Array.isArray(payload?.metadata?.documents)
// 		? payload.metadata.documents
// 				.map((item) => ({
// 					id: String(item?.id || '').trim(),
// 					title: String(item?.title || '').trim(),
// 					category: String(item?.category || 'general_policy').trim(),
// 					sourceType: String(item?.sourceType || 'text').trim(),
// 					sourceName: String(item?.sourceName || '').trim() || null,
// 					content: String(item?.content || ''),
// 					updatedAt: item?.updatedAt || null
// 				}))
// 				.filter((item) => item.id && item.title && item.content)
// 		: [],
// 	updatedAt: payload?.metadata?.updatedAt || null
// });

const toTimestamp = (value) => {
	const date = value ? new Date(value) : null;
	const time = date instanceof Date ? date.getTime() : Number.NaN;
	return Number.isFinite(time) ? time : 0;
};

const normalizeRecentUsers = (payload) => {
	const rawItems = Array.isArray(payload?.metadata?.items)
		? payload.metadata.items
		: Array.isArray(payload?.metadata)
			? payload.metadata
			: [];

	return rawItems
		.filter((item) => item && typeof item === 'object')
		.sort((a, b) => {
			const byCreatedAt = toTimestamp(b?.createdAt) - toTimestamp(a?.createdAt);
			if (byCreatedAt !== 0) return byCreatedAt;
			return String(b?._id || '').localeCompare(String(a?._id || ''));
		})
		.slice(0, 5);
};

const normalizeRecentProducts = (payload) => {
	if (Array.isArray(payload?.metadata)) return payload.metadata.slice(0, 5);
	if (Array.isArray(payload?.metadata?.items)) return payload.metadata.items.slice(0, 5);
	return [];
};

export const load = async ({ cookies, fetch }) => {
	const session = getAdminSession(cookies);
	const headers = buildAdminHeaders(session);
	const publicHeaders = headers['x-api-key'] ? { 'x-api-key': headers['x-api-key'] } : {};

	const [usersResult, productsResult, siteSettingsResult, dashboardSummaryResult] =
		await Promise.allSettled([
			fetch(`${API_BASE}/admin/users?limit=5&page=1`, { headers }),
			fetch(`${API_BASE}/product?limit=5&page=1`, { headers: publicHeaders }),
			fetch(`${API_BASE}/site-settings`, { headers: publicHeaders }),
			fetch(`${API_BASE}/admin/dashboard-summary`, { headers })
			// Hidden with the admin AI knowledge shortcut by request.
			// fetch(`${API_BASE}/site-settings/agent-knowledge`, { headers: publicHeaders })
		]);

	const usersRes = usersResult.status === 'fulfilled' ? usersResult.value : null;
	const productsRes = productsResult.status === 'fulfilled' ? productsResult.value : null;
	const siteSettingsRes = siteSettingsResult.status === 'fulfilled' ? siteSettingsResult.value : null;
	const dashboardSummaryRes =
		dashboardSummaryResult.status === 'fulfilled' ? dashboardSummaryResult.value : null;
	// Hidden with the admin AI knowledge shortcut by request.
	// const agentKnowledgeRes =
	// 	agentKnowledgeResult.status === 'fulfilled' ? agentKnowledgeResult.value : null;

	const usersPayload = usersRes?.ok ? await safeJson(usersRes) : null;
	const productsPayload = productsRes?.ok ? await safeJson(productsRes) : null;
	const siteSettingsPayload = siteSettingsRes?.ok ? await safeJson(siteSettingsRes) : null;
	const dashboardSummaryPayload = dashboardSummaryRes?.ok ? await safeJson(dashboardSummaryRes) : null;
	// Hidden with the admin AI knowledge shortcut by request.
	// const agentKnowledgePayload = agentKnowledgeRes?.ok ? await safeJson(agentKnowledgeRes) : null;
	const siteFeatureDefinitions = normalizeSiteFeatureDefinitions(siteSettingsPayload);
	const siteFeatures = normalizeSiteFeatures(siteSettingsPayload, siteFeatureDefinitions);

	return {
		recentUsers: normalizeRecentUsers(usersPayload),
		recentProducts: normalizeRecentProducts(productsPayload),
		dashboardSummary: dashboardSummaryPayload?.metadata || null,
		siteFeatures,
		siteFeatureDefinitions,
		siteMarketingCampaign: normalizeMarketingCampaign(siteSettingsPayload),
		siteMarketplaceLinks: normalizeMarketplaceLinks(siteSettingsPayload)
		// Hidden with the admin AI knowledge shortcut by request.
		// agentKnowledgeSettings: normalizeAgentKnowledgeSettings(agentKnowledgePayload)
	};
};

export const actions = {
	updateFeatureFlags: async ({ request, cookies, fetch }) => {
		const session = getAdminSession(cookies);
		const headers = buildAdminHeaders(session);
		const t = getTranslator(cookies);
		const form = await request.formData();
		const featureKeys = Array.from(
			new Set(
				form
					.getAll('featureKeys')
					.map((value) => String(value || '').trim())
					.filter(Boolean)
			)
		);

		const features = {};
		for (const key of featureKeys) {
			features[key] = form.has(`feature__${key}`);
		}

		if (!Object.keys(features).length) {
			return fail(400, {
				error: t('admin.dashboard.siteSettings.errors.noValidFlags')
			});
		}

		const response = await fetch(`${API_BASE}/site-settings`, {
			method: 'PATCH',
			headers: {
				...headers,
				'content-type': 'application/json'
			},
			body: JSON.stringify({
				features
			})
		});

		if (!response.ok) {
			const payload = await safeJson(response);
			const message =
				payload?.message || payload?.metadata?.message || t('admin.dashboard.siteSettings.errors.update');
			return fail(response.status, { error: message });
		}

		setAdminToast(cookies, {
			tone: 'success',
			message: t('admin.dashboard.siteSettings.success.updated')
		});

		throw redirect(303, '/admin');
	},

	updateMarketingSettings: async ({ request, cookies, fetch }) => {
		const session = getAdminSession(cookies);
		const headers = buildAdminHeaders(session);
		const form = await request.formData();
		const marketplaceIds = Array.from(
			new Set(
				form
					.getAll('marketplaceIds')
					.map((value) => String(value || '').trim())
					.filter(Boolean)
			)
		);

		const marketingCampaign = {
			enabled: form.has('campaign_enabled'),
			headerEnabled: form.has('campaign_header_enabled'),
			popupEnabled: form.has('campaign_popup_enabled'),
			kickerVi: String(form.get('campaign_kicker_vi') || '').trim(),
			kickerEn: String(form.get('campaign_kicker_en') || '').trim(),
			titleVi: String(form.get('campaign_title_vi') || '').trim(),
			titleEn: String(form.get('campaign_title_en') || '').trim(),
			descriptionVi: String(form.get('campaign_description_vi') || '').trim(),
			descriptionEn: String(form.get('campaign_description_en') || '').trim(),
			ctaVi: String(form.get('campaign_cta_vi') || '').trim(),
			ctaEn: String(form.get('campaign_cta_en') || '').trim(),
			successVi: String(form.get('campaign_success_vi') || '').trim(),
			successEn: String(form.get('campaign_success_en') || '').trim(),
			offerCode: String(form.get('campaign_offer_code') || '').trim(),
			minOrderValue: Number(form.get('campaign_min_order_value') || 0),
			endsAt: String(form.get('campaign_ends_at') || '').trim() || null
		};
		const marketplaceLinks = marketplaceIds.map((id) => ({
			id,
			label: String(form.get(`marketplace_label__${id}`) || '').trim(),
			url: String(form.get(`marketplace_url__${id}`) || '').trim(),
			enabled: form.has(`marketplace_enabled__${id}`)
		}));

		const response = await fetch(`${API_BASE}/site-settings`, {
			method: 'PATCH',
			headers: {
				...headers,
				'content-type': 'application/json'
			},
			body: JSON.stringify({
				marketingCampaign,
				marketplaceLinks
			})
		});

		if (!response.ok) {
			const payload = await safeJson(response);
			const message = payload?.message || payload?.metadata?.message || 'Update marketing settings failed';
			return fail(response.status, { error: message });
		}

		setAdminToast(cookies, {
			tone: 'success',
			message: 'Marketing settings updated'
		});

		throw redirect(303, '/admin');
	}
};
