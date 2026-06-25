'use strict'

const crypto = require('node:crypto');
const siteSettingModel = require('../models/siteSetting.model');
const { BadRequestError } = require('../core/error.response');
const { convertToObjectIdMongodb } = require('../utils');
const { deleteImageFromStorage, deleteImageVariantsFromStorage } = require('./storage.service');

const SETTING_KEY_FEATURES = 'features';
const SETTING_KEY_HOME_SLIDES = 'homeSlides';
const SETTING_KEY_CHAT_CONSOLE = 'chatConsole';
const SETTING_KEY_AGENT_KNOWLEDGE = 'agentKnowledge';
const SETTING_KEY_MARKETING_CAMPAIGN = 'marketingCampaign';
const SETTING_KEY_MARKETPLACE_LINKS = 'marketplaceLinks';
const MAX_HOME_SLIDES = 5;
const MAX_KNOWLEDGE_DOCUMENTS = 40;
const MAX_KNOWLEDGE_CONTENT_LENGTH = 120000;
const KNOWLEDGE_CATEGORIES = Object.freeze([
	'product_info',
	'manual',
	'warranty_policy',
	'shipping_policy',
	'general_policy'
]);
const FEATURE_FLAG_DEFINITIONS = Object.freeze({
	showDiscountBadge: Object.freeze({
		defaultValue: false
	})
});
const FEATURE_FLAG_KEYS = Object.freeze(Object.keys(FEATURE_FLAG_DEFINITIONS));
const DEFAULT_FEATURES = Object.freeze(
	FEATURE_FLAG_KEYS.reduce((result, key) => {
		result[key] = FEATURE_FLAG_DEFINITIONS[key].defaultValue;
		return result;
	}, {})
);
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
const MARKETPLACE_DEFINITIONS = Object.freeze([
	Object.freeze({ id: 'shopee', label: 'Shopee' }),
	Object.freeze({ id: 'lazada', label: 'Lazada' }),
	Object.freeze({ id: 'tiktok', label: 'TikTok Shop' }),
	Object.freeze({ id: 'zalo', label: 'Zalo OA' })
]);
const DEFAULT_MARKETPLACE_LINKS = Object.freeze(
	MARKETPLACE_DEFINITIONS.map((item) => Object.freeze({
		...item,
		url: '',
		enabled: false
	}))
);
const DEFAULT_CANNED_REPLIES = Object.freeze([
	'Chào anh/chị, em là CSKH Inoxpran. Em đang tiếp nhận yêu cầu và hỗ trợ mình ngay trong khung chat này.',
	'Anh/chị cho em xin thêm nhu cầu sản phẩm, số lượng và khu vực giao hàng để em tư vấn nhanh hơn ạ.',
	'Anh/chị cho em xin mã đơn hàng hoặc số điện thoại đặt hàng để em kiểm tra và hỗ trợ chính xác hơn ạ.',
	'Em đã tiếp nhận thông tin. Anh/chị chờ em kiểm tra trong ít phút, em sẽ phản hồi ngay tại khung chat này ạ.',
	'Em đã xử lý xong yêu cầu hiện tại. Nếu anh/chị cần hỗ trợ thêm, cứ nhắn ngay trong khung chat này giúp em.'
]);

const buildFeatureDefinitions = () =>
	FEATURE_FLAG_KEYS.map((key) => ({
		key,
		type: 'boolean',
		defaultValue: DEFAULT_FEATURES[key]
	}));

const ensureString = (value, { maxLength = 500, defaultValue = '' } = {}) => {
	if (value === undefined || value === null) return defaultValue;
	const text = String(value).trim();
	if (!text) return defaultValue;
	return text.slice(0, maxLength);
};

const ensureNullableString = (value, { maxLength = 500 } = {}) => {
	const text = ensureString(value, { maxLength, defaultValue: '' });
	return text || null;
};

const ensureBoolean = (value, defaultValue = false) =>
	typeof value === 'boolean' ? value : Boolean(defaultValue);

const ensureNumber = (value, { min = 0, max = Number.MAX_SAFE_INTEGER, defaultValue = 0 } = {}) => {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return defaultValue;
	return Math.min(max, Math.max(min, Math.floor(numeric)));
};

const normalizeUrl = (value) => {
	const raw = ensureString(value, { maxLength: 2000, defaultValue: '' });
	if (!raw) return '';
	try {
		const parsed = new URL(raw);
		if (!['http:', 'https:'].includes(parsed.protocol)) return '';
		return parsed.toString();
	} catch {
		return '';
	}
};

const normalizeImageVariants = (value) => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	try {
		return JSON.parse(JSON.stringify(value));
	} catch {
		return null;
	}
};

const buildAutoHomeSlideAlt = (index = 0, locale = 'vi') => {
	const slideNumber = Number.isFinite(Number(index)) ? Number(index) + 1 : 1;
	if (String(locale).toLowerCase() === 'en') {
		return `Inoxpran homepage promotional slide ${slideNumber}`;
	}
	return `Slide quảng cáo trang chủ Inoxpran ${slideNumber}`;
};

const normalizeHomeSlide = (value = {}, index = 0) => {
	const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
	const imageUrl = ensureString(source.imageUrl, { maxLength: 2000, defaultValue: '' });
	if (!imageUrl) {
		throw new BadRequestError(`Slide ${index + 1} is missing imageUrl`);
	}

	return {
		id: ensureString(source.id, { maxLength: 120, defaultValue: crypto.randomUUID() }),
		imageUrl,
		imagePath: ensureNullableString(source.imagePath, { maxLength: 800 }),
		imageVariants: normalizeImageVariants(source.imageVariants ?? source.variants),
		isHeroBackground: source.isHeroBackground === true,
		altVi: buildAutoHomeSlideAlt(index, 'vi'),
		altEn: buildAutoHomeSlideAlt(index, 'en'),
		updatedAt: new Date().toISOString()
	};
};

const normalizeHomeSlides = (value) => {
	const slides = Array.isArray(value) ? value : [];
	if (slides.length > MAX_HOME_SLIDES) {
		throw new BadRequestError(`Home slides cannot exceed ${MAX_HOME_SLIDES} items`);
	}

	const normalized = [];
	const seenIds = new Set();
	for (const [index, slide] of slides.entries()) {
		const nextSlide = normalizeHomeSlide(slide, index);
		if (seenIds.has(nextSlide.id)) {
			nextSlide.id = crypto.randomUUID();
		}
		seenIds.add(nextSlide.id);
		normalized.push(nextSlide);
	}

	let hasHeroBackground = false;
	for (const slide of normalized) {
		if (!slide.isHeroBackground || hasHeroBackground) {
			slide.isHeroBackground = false;
			continue;
		}
		hasHeroBackground = true;
	}

	return normalized;
};

const safeNormalizeHomeSlides = (value) => {
	try {
		return normalizeHomeSlides(value);
	} catch {
		return [];
	}
};

const toPublicHomeSlides = (slides) =>
	(Array.isArray(slides) ? slides : []).map((slide) => ({
		id: slide.id,
		imageUrl: slide.imageUrl,
		imageVariants: slide.imageVariants || null,
		isHeroBackground: slide.isHeroBackground === true,
		altVi: slide.altVi || null,
		altEn: slide.altEn || null
	}));

const toAdminHomeSlides = (slides) =>
	(Array.isArray(slides) ? slides : []).map((slide) => ({
		id: slide.id,
		imageUrl: slide.imageUrl,
		imagePath: slide.imagePath || null,
		imageVariants: slide.imageVariants || null,
		isHeroBackground: slide.isHeroBackground === true,
		altVi: slide.altVi || null,
		altEn: slide.altEn || null
	}));

const normalizeFeatureObject = (value) => {
	const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
	const normalized = { ...DEFAULT_FEATURES };
	for (const key of FEATURE_FLAG_KEYS) {
		if (Object.prototype.hasOwnProperty.call(source, key)) {
			normalized[key] = typeof source[key] === 'boolean' ? source[key] : DEFAULT_FEATURES[key];
		}
	}
	return normalized;
};

const normalizeMarketingCampaign = (value) => {
	const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
	const defaults = DEFAULT_MARKETING_CAMPAIGN;
	return {
		enabled: ensureBoolean(source.enabled, defaults.enabled),
		headerEnabled: ensureBoolean(source.headerEnabled, defaults.headerEnabled),
		popupEnabled: ensureBoolean(source.popupEnabled, defaults.popupEnabled),
		kickerVi: ensureString(source.kickerVi, { maxLength: 120, defaultValue: defaults.kickerVi }),
		kickerEn: ensureString(source.kickerEn, { maxLength: 120, defaultValue: defaults.kickerEn }),
		titleVi: ensureString(source.titleVi, { maxLength: 180, defaultValue: defaults.titleVi }),
		titleEn: ensureString(source.titleEn, { maxLength: 180, defaultValue: defaults.titleEn }),
		descriptionVi: ensureString(source.descriptionVi, {
			maxLength: 500,
			defaultValue: defaults.descriptionVi
		}),
		descriptionEn: ensureString(source.descriptionEn, {
			maxLength: 500,
			defaultValue: defaults.descriptionEn
		}),
		ctaVi: ensureString(source.ctaVi, { maxLength: 80, defaultValue: defaults.ctaVi }),
		ctaEn: ensureString(source.ctaEn, { maxLength: 80, defaultValue: defaults.ctaEn }),
		successVi: ensureString(source.successVi, { maxLength: 240, defaultValue: defaults.successVi }),
		successEn: ensureString(source.successEn, { maxLength: 240, defaultValue: defaults.successEn }),
		offerCode: ensureString(source.offerCode, { maxLength: 40, defaultValue: defaults.offerCode }),
		minOrderValue: ensureNumber(source.minOrderValue, { min: 0, defaultValue: defaults.minOrderValue }),
		endsAt: ensureNullableString(source.endsAt, { maxLength: 40 })
	};
};

const normalizeMarketplaceLinks = (value) => {
	const rawItems = Array.isArray(value) ? value : [];
	const byId = new Map(rawItems.map((item) => [String(item?.id || '').trim().toLowerCase(), item]));
	return MARKETPLACE_DEFINITIONS.map((definition) => {
		const source = byId.get(definition.id) || {};
		const url = normalizeUrl(source.url);
		return {
			id: definition.id,
			label: ensureString(source.label, { maxLength: 80, defaultValue: definition.label }),
			url,
			enabled: ensureBoolean(source.enabled, false) && Boolean(url)
		};
	});
};

const normalizeCannedReplies = (value) => {
	const items = Array.isArray(value)
		? value
		: String(value || '')
			.split(/\r?\n/)
			.map((item) => item.trim())
			.filter(Boolean);

	const normalized = [];
	const seen = new Set();
	for (const item of items) {
		const text = ensureString(item, { maxLength: 500, defaultValue: '' });
		if (!text) continue;
		const dedupeKey = text.toLowerCase();
		if (seen.has(dedupeKey)) continue;
		seen.add(dedupeKey);
		normalized.push(text);
		if (normalized.length >= 30) break;
	}

	return normalized.length ? normalized : [...DEFAULT_CANNED_REPLIES];
};

const normalizeKnowledgeCategory = (value) => {
	const text = ensureString(value, { maxLength: 40, defaultValue: 'general_policy' }).toLowerCase();
	return KNOWLEDGE_CATEGORIES.includes(text) ? text : 'general_policy';
};

const normalizeKnowledgeDocument = (value = {}, index = 0) => {
	const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
	const content = ensureString(source.content, {
		maxLength: MAX_KNOWLEDGE_CONTENT_LENGTH,
		defaultValue: ''
	});
	if (!content) {
		throw new BadRequestError(`Knowledge document ${index + 1} is missing content`);
	}

	return {
		id: ensureString(source.id, { maxLength: 120, defaultValue: crypto.randomUUID() }),
		title: ensureString(source.title, { maxLength: 160, defaultValue: `Tài liệu ${index + 1}` }),
		category: normalizeKnowledgeCategory(source.category),
		sourceType: ensureString(source.sourceType, { maxLength: 40, defaultValue: 'text' }).toLowerCase(),
		sourceName: ensureNullableString(source.sourceName, { maxLength: 200 }),
		content,
		updatedAt: new Date().toISOString()
	};
};

const normalizeKnowledgeDocuments = (value) => {
	const items = Array.isArray(value) ? value : [];
	if (items.length > MAX_KNOWLEDGE_DOCUMENTS) {
		throw new BadRequestError(`Knowledge documents cannot exceed ${MAX_KNOWLEDGE_DOCUMENTS} items`);
	}

	const normalized = [];
	const seenIds = new Set();
	for (const [index, item] of items.entries()) {
		const nextItem = normalizeKnowledgeDocument(item, index);
		if (seenIds.has(nextItem.id)) {
			nextItem.id = crypto.randomUUID();
		}
		seenIds.add(nextItem.id);
		normalized.push(nextItem);
	}

	return normalized;
};

const safeNormalizeKnowledgeDocuments = (value) => {
	try {
		return normalizeKnowledgeDocuments(value);
	} catch {
		return [];
	}
};

const toAdminKnowledgeDocuments = (documents) =>
	(Array.isArray(documents) ? documents : []).map((document) => ({
		id: document.id,
		title: document.title,
		category: document.category,
		sourceType: document.sourceType || 'text',
		sourceName: document.sourceName || null,
		content: document.content,
		updatedAt: document.updatedAt || null
	}));

const extractChatConsolePatch = (payload) => {
	const source = payload?.chatConsole && typeof payload.chatConsole === 'object'
		? payload.chatConsole
		: payload;
	if (!source || typeof source !== 'object') return null;
	const patch = {};
	if (Object.prototype.hasOwnProperty.call(source, 'cannedReplies')) {
		patch.cannedReplies = normalizeCannedReplies(source.cannedReplies);
	}
	return Object.keys(patch).length ? patch : null;
};

const extractFeaturePatch = (payload) => {
	const isObjectPayload = payload && typeof payload === 'object' && !Array.isArray(payload);
	const rawFeatures = isObjectPayload ? payload.features : undefined;
	const rawInput =
		rawFeatures && typeof rawFeatures === 'object' && !Array.isArray(rawFeatures)
			? rawFeatures
			: isObjectPayload
				? payload
				: {};
	const patch = {};

	for (const key of FEATURE_FLAG_KEYS) {
		if (!Object.prototype.hasOwnProperty.call(rawInput, key)) continue;
		const nextValue = rawInput[key];
		if (typeof nextValue !== 'boolean') {
			throw new BadRequestError(`Feature flag "${key}" must be boolean`);
		}
		patch[key] = nextValue;
	}

	return patch;
};

const extractMarketingSettingsPatch = (payload) => {
	const source = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
	const patch = {};
	if (Object.prototype.hasOwnProperty.call(source, 'marketingCampaign')) {
		patch.marketingCampaign = normalizeMarketingCampaign(source.marketingCampaign);
	}
	if (Object.prototype.hasOwnProperty.call(source, 'marketplaceLinks')) {
		patch.marketplaceLinks = normalizeMarketplaceLinks(source.marketplaceLinks);
	}
	return Object.keys(patch).length ? patch : null;
};

const extractAgentKnowledgePatch = (payload) => {
	const source = payload?.agentKnowledge && typeof payload.agentKnowledge === 'object'
		? payload.agentKnowledge
		: payload;
	if (!source || typeof source !== 'object') return null;
	if (!Object.prototype.hasOwnProperty.call(source, 'documents')) return null;
	return {
		documents: normalizeKnowledgeDocuments(source.documents)
	};
};

const buildUpdateDoc = (value, adminId) => {
	const updateDoc = { value };
	if (adminId) {
		const updatedBy = convertToObjectIdMongodb(adminId);
		if (updatedBy) updateDoc.updatedBy = updatedBy;
	}
	return updateDoc;
};

class SiteSettingService {
	static getPublicSettings = async () => {
		const [featureDoc, homeSlidesDoc, chatConsoleDoc, marketingDoc, marketplaceDoc] = await Promise.all([
			siteSettingModel.findOne({ key: SETTING_KEY_FEATURES }).select('value updatedAt').lean(),
			siteSettingModel.findOne({ key: SETTING_KEY_HOME_SLIDES }).select('value updatedAt').lean(),
			siteSettingModel.findOne({ key: SETTING_KEY_CHAT_CONSOLE }).select('value updatedAt').lean(),
			siteSettingModel.findOne({ key: SETTING_KEY_MARKETING_CAMPAIGN }).select('value updatedAt').lean(),
			siteSettingModel.findOne({ key: SETTING_KEY_MARKETPLACE_LINKS }).select('value updatedAt').lean()
		]);

		return {
			features: normalizeFeatureObject(featureDoc?.value),
			homeSlides: toPublicHomeSlides(safeNormalizeHomeSlides(homeSlidesDoc?.value || [])),
			marketingCampaign: normalizeMarketingCampaign(marketingDoc?.value),
			marketplaceLinks: normalizeMarketplaceLinks(marketplaceDoc?.value || []),
			chatConsole: {
				cannedReplies: normalizeCannedReplies(chatConsoleDoc?.value?.cannedReplies)
			},
			definitions: buildFeatureDefinitions(),
			updatedAt: featureDoc?.updatedAt || null,
			homeSlidesUpdatedAt: homeSlidesDoc?.updatedAt || null,
			chatConsoleUpdatedAt: chatConsoleDoc?.updatedAt || null,
			marketingCampaignUpdatedAt: marketingDoc?.updatedAt || null,
			marketplaceLinksUpdatedAt: marketplaceDoc?.updatedAt || null
		};
	};

	static getHomeSlides = async () => {
		const doc = await siteSettingModel
			.findOne({ key: SETTING_KEY_HOME_SLIDES })
			.select('value updatedAt')
			.lean();
		const slides = normalizeHomeSlides(doc?.value || []);
		return {
			slides: toAdminHomeSlides(slides),
			updatedAt: doc?.updatedAt || null,
			maxItems: MAX_HOME_SLIDES
		};
	};

	static updateHomeSlides = async ({ slides = [], adminId } = {}) => {
		const normalizedSlides = normalizeHomeSlides(slides);
		const previousDoc = await siteSettingModel
			.findOne({ key: SETTING_KEY_HOME_SLIDES })
			.select('value')
			.lean();
		const previousSlides = normalizeHomeSlides(previousDoc?.value || []);

		const updated = await siteSettingModel
			.findOneAndUpdate(
				{ key: SETTING_KEY_HOME_SLIDES },
				{ $set: buildUpdateDoc(normalizedSlides, adminId) },
				{ new: true, upsert: true, setDefaultsOnInsert: true }
			)
			.select('value updatedAt')
			.lean();

		const nextSlides = normalizeHomeSlides(updated?.value || []);
		const nextPaths = new Set(nextSlides.map((slide) => slide.imagePath).filter(Boolean));
		const removedSlides = previousSlides.filter(
			(slide) => slide?.imageUrl && slide.imagePath && !nextPaths.has(slide.imagePath)
		);
		if (removedSlides.length) {
			await Promise.allSettled(
				removedSlides.flatMap((slide) => [
					deleteImageFromStorage({ path: slide.imagePath, url: slide.imageUrl }),
					deleteImageVariantsFromStorage(slide.imageVariants)
				])
			);
		}

		return {
			slides: toAdminHomeSlides(nextSlides),
			updatedAt: updated?.updatedAt || null,
			maxItems: MAX_HOME_SLIDES
		};
	};

	static updateFeatureFlags = async ({ payload = {}, adminId }) => {
		const patch = extractFeaturePatch(payload);
		if (!Object.keys(patch).length) {
			throw new BadRequestError('No valid feature flags provided');
		}

		const current = await SiteSettingService.getPublicSettings();
		const nextFeatures = {
			...current.features,
			...patch
		};

		const updated = await siteSettingModel
			.findOneAndUpdate(
				{ key: SETTING_KEY_FEATURES },
				{ $set: buildUpdateDoc(nextFeatures, adminId) },
				{ new: true, upsert: true, setDefaultsOnInsert: true }
			)
			.select('value updatedAt')
			.lean();

		return {
			features: normalizeFeatureObject(updated?.value),
			updatedAt: updated?.updatedAt || null
		};
	};

	static updateMarketingSettings = async ({ payload = {}, adminId } = {}) => {
		const patch = extractMarketingSettingsPatch(payload);
		if (!patch) {
			throw new BadRequestError('No valid marketing settings provided');
		}

		const result = {};
		if (patch.marketingCampaign) {
			const updated = await siteSettingModel.findOneAndUpdate(
				{ key: SETTING_KEY_MARKETING_CAMPAIGN },
				{ $set: buildUpdateDoc(patch.marketingCampaign, adminId) },
				{ new: true, upsert: true, setDefaultsOnInsert: true }
			).select('value updatedAt').lean();
			result.marketingCampaign = normalizeMarketingCampaign(updated?.value);
			result.marketingCampaignUpdatedAt = updated?.updatedAt || null;
		}
		if (patch.marketplaceLinks) {
			const updated = await siteSettingModel.findOneAndUpdate(
				{ key: SETTING_KEY_MARKETPLACE_LINKS },
				{ $set: buildUpdateDoc(patch.marketplaceLinks, adminId) },
				{ new: true, upsert: true, setDefaultsOnInsert: true }
			).select('value updatedAt').lean();
			result.marketplaceLinks = normalizeMarketplaceLinks(updated?.value || []);
			result.marketplaceLinksUpdatedAt = updated?.updatedAt || null;
		}
		return result;
	};

	static updateChatConsoleSettings = async ({ payload = {}, adminId } = {}) => {
		const patch = extractChatConsolePatch(payload);
		if (!patch) {
			throw new BadRequestError('No valid chat console settings provided');
		}

		const currentDoc = await siteSettingModel.findOne({ key: SETTING_KEY_CHAT_CONSOLE }).select('value').lean();
		const nextValue = {
			cannedReplies: Object.prototype.hasOwnProperty.call(patch, 'cannedReplies')
				? patch.cannedReplies
				: normalizeCannedReplies(currentDoc?.value?.cannedReplies)
		};

		const updated = await siteSettingModel.findOneAndUpdate(
			{ key: SETTING_KEY_CHAT_CONSOLE },
			{ $set: buildUpdateDoc(nextValue, adminId) },
			{ new: true, upsert: true, setDefaultsOnInsert: true }
		).select('value updatedAt').lean();

		return {
			cannedReplies: normalizeCannedReplies(updated?.value?.cannedReplies),
			updatedAt: updated?.updatedAt || null
		};
	};

	static getAgentKnowledgeSettings = async () => {
		const doc = await siteSettingModel
			.findOne({ key: SETTING_KEY_AGENT_KNOWLEDGE })
			.select('value updatedAt')
			.lean();
		return {
			documents: toAdminKnowledgeDocuments(safeNormalizeKnowledgeDocuments(doc?.value?.documents || [])),
			updatedAt: doc?.updatedAt || null,
			categories: [...KNOWLEDGE_CATEGORIES],
			maxItems: MAX_KNOWLEDGE_DOCUMENTS
		};
	};

	static updateAgentKnowledgeSettings = async ({ payload = {}, adminId } = {}) => {
		const patch = extractAgentKnowledgePatch(payload);
		if (!patch) {
			throw new BadRequestError('No valid agent knowledge settings provided');
		}

		const updated = await siteSettingModel.findOneAndUpdate(
			{ key: SETTING_KEY_AGENT_KNOWLEDGE },
			{ $set: buildUpdateDoc({ documents: patch.documents }, adminId) },
			{ new: true, upsert: true, setDefaultsOnInsert: true }
		).select('value updatedAt').lean();

		return {
			documents: toAdminKnowledgeDocuments(safeNormalizeKnowledgeDocuments(updated?.value?.documents || [])),
			updatedAt: updated?.updatedAt || null,
			categories: [...KNOWLEDGE_CATEGORIES],
			maxItems: MAX_KNOWLEDGE_DOCUMENTS
		};
	};
}

module.exports = SiteSettingService;
