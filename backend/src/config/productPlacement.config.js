'use strict'

const PRODUCT_PLACEMENT_STYLES = Object.freeze([
    'auto',
    'ranked-list-owned-first',
    'ranked-list-owned-last',
    'criteria-first-recommendation',
    'problem-solution-late-reveal',
    'knowledge-soft-endcap',
    'comparison-matrix-contextual',
    'scenario-product-matching',
    'editorial-pick-disclosed',
    'inline-contextual-example',
    'product-led-editorial',
    'no-product'
]);

const RANKING_POSITION_MODES = Object.freeze(['auto', 'first', 'last']);

const STYLE_DEFINITIONS = Object.freeze({
    'ranked-list-owned-first': { family: 'ranking', ranking: true, presentation: 'recommendation', defaultPosition: 'first', minSections: 2, minProgressPercent: 35 },
    'ranked-list-owned-last': { family: 'ranking', ranking: true, presentation: 'recommendation', defaultPosition: 'last', minSections: 2, minProgressPercent: 35 },
    'criteria-first-recommendation': { family: 'buying-guide', ranking: false, presentation: 'recommendation', minSections: 2, minProgressPercent: 35 },
    'problem-solution-late-reveal': { family: 'problem-solution', ranking: false, presentation: 'recommendation', minSections: 2, minProgressPercent: 50 },
    'knowledge-soft-endcap': { family: 'knowledge', ranking: false, presentation: 'endcap', minSections: 3, minProgressPercent: 60 },
    'comparison-matrix-contextual': { family: 'comparison', ranking: false, presentation: 'comparison', minSections: 2, minProgressPercent: 45 },
    'scenario-product-matching': { family: 'scenario', ranking: false, presentation: 'scenario', minSections: 2, minProgressPercent: 40 },
    'editorial-pick-disclosed': { family: 'editorial', ranking: false, presentation: 'recommendation', minSections: 2, minProgressPercent: 45 },
    'inline-contextual-example': { family: 'informational', ranking: false, presentation: 'inline', minSections: 3, minProgressPercent: 60 },
    'product-led-editorial': { family: 'product', ranking: false, presentation: 'recommendation', minSections: 1, minProgressPercent: 10 },
    'no-product': { family: 'informational', ranking: false, presentation: 'none', minSections: 99, minProgressPercent: 100 }
});

const ARTICLE_TYPE_THRESHOLDS = Object.freeze({
    knowledge: { minSections: 3, minProgressPercent: 60 },
    trend: { minSections: 2, minProgressPercent: 45 },
    'buying-guide': { minSections: 2, minProgressPercent: 35 },
    troubleshooting: { minSections: 2, minProgressPercent: 50 },
    'product-led': { minSections: 1, minProgressPercent: 10 },
    'product-education': { minSections: 1, minProgressPercent: 10 }
});

const parseBoolean = (value, fallback) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    if (typeof value !== 'string') return fallback;
    if (['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase())) return true;
    if (['false', '0', 'no', 'off'].includes(value.trim().toLowerCase())) return false;
    return fallback;
};

const clampInteger = (value, fallback, min, max) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(Math.round(parsed), min), max);
};

const normalizeEnum = (value, allowed, fallback) => {
    const normalized = String(value || '').trim().toLowerCase();
    return allowed.includes(normalized) ? normalized : fallback;
};

const buildEnvProductPlacementConfig = (env = process.env) => {
    const enabled = parseBoolean(env.PRODUCT_PLACEMENT_ENABLED, true);
    return {
        enabled,
        defaultStyle: enabled ? normalizeEnum(env.PRODUCT_PLACEMENT_DEFAULT_STYLE, PRODUCT_PLACEMENT_STYLES, 'auto') : 'no-product',
        minSectionsBeforeProduct: clampInteger(env.PRODUCT_PLACEMENT_MIN_SECTIONS_BEFORE_PRODUCT, 2, 0, 20),
        minWordsBeforeProduct: clampInteger(env.PRODUCT_PLACEMENT_MIN_WORDS_BEFORE_PRODUCT, 350, 0, 5000),
        minProgressPercent: clampInteger(env.PRODUCT_PLACEMENT_MIN_PROGRESS_PERCENT, 35, 0, 100),
        styleLookbackDays: clampInteger(env.PRODUCT_PLACEMENT_STYLE_LOOKBACK_DAYS, 14, 1, 90),
        styleCooldownDays: clampInteger(env.PRODUCT_PLACEMENT_STYLE_COOLDOWN_DAYS, 5, 0, 30),
        rankingPositionMode: normalizeEnum(env.PRODUCT_PLACEMENT_RANKING_POSITION_MODE, RANKING_POSITION_MODES, 'auto'),
        rankingPositionLookbackDays: clampInteger(env.PRODUCT_PLACEMENT_RANKING_POSITION_LOOKBACK_DAYS, 14, 1, 90),
        allowOwnedProductMiddle: parseBoolean(env.PRODUCT_PLACEMENT_ALLOW_OWNED_PRODUCT_MIDDLE, false),
        allowProductInIntro: parseBoolean(env.PRODUCT_PLACEMENT_ALLOW_PRODUCT_IN_INTRO, false),
        allowProductImageFirst: parseBoolean(env.PRODUCT_PLACEMENT_ALLOW_PRODUCT_IMAGE_FIRST, false),
        allowConsecutiveProductBlocks: parseBoolean(env.PRODUCT_PLACEMENT_ALLOW_CONSECUTIVE_PRODUCT_BLOCKS, false),
        allowConsecutiveProductImages: parseBoolean(env.PRODUCT_PLACEMENT_ALLOW_CONSECUTIVE_PRODUCT_IMAGES, false),
        requireDisclosure: parseBoolean(env.PRODUCT_PLACEMENT_REQUIRE_DISCLOSURE, true),
        requireRankingMethodology: parseBoolean(env.PRODUCT_PLACEMENT_REQUIRE_RANKING_METHODOLOGY, true),
        requireBestsellerEvidence: parseBoolean(env.PRODUCT_PLACEMENT_REQUIRE_BESTSELLER_EVIDENCE, true),
        maxBlocksLight: clampInteger(env.PRODUCT_PLACEMENT_MAX_BLOCKS_LIGHT, 1, 0, 10),
        maxBlocksBalanced: clampInteger(env.PRODUCT_PLACEMENT_MAX_BLOCKS_BALANCED, 2, 0, 10),
        maxCta: clampInteger(env.PRODUCT_PLACEMENT_MAX_CTA, 1, 0, 5)
    };
};

const normalizeProductPlacementOptions = (value = {}, base = buildEnvProductPlacementConfig()) => {
    const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const enabled = base.enabled && parseBoolean(input.enabled, true);
    const style = enabled
        ? normalizeEnum(input.style || input.mode, PRODUCT_PLACEMENT_STYLES, base.defaultStyle)
        : 'no-product';
    const rankingPositionMode = normalizeEnum(input.rankingPositionMode, RANKING_POSITION_MODES, base.rankingPositionMode);
    return {
        enabled,
        style,
        rankingPositionMode,
        minSectionsBeforeProduct: clampInteger(input.minSectionsBeforeProduct, base.minSectionsBeforeProduct, 0, 20),
        minWordsBeforeProduct: clampInteger(input.minWordsBeforeProduct, base.minWordsBeforeProduct, 0, 5000),
        minProgressPercent: clampInteger(input.minProgressPercent, base.minProgressPercent, 0, 100),
        productImagePlacement: normalizeEnum(input.productImagePlacement, ['auto', 'none', 'contextual', 'after-product'], 'auto'),
        disclosureMode: normalizeEnum(input.disclosureMode, ['auto', 'required', 'off'], base.requireDisclosure ? 'required' : 'auto')
    };
};

const placementDensityFor = (intensity = 'light', config = buildEnvProductPlacementConfig()) => ({
    maxBlocks: intensity === 'balanced' || intensity === 'commercial' ? config.maxBlocksBalanced : config.maxBlocksLight,
    maxCtaCount: config.maxCta,
    allowConsecutiveProductBlocks: config.allowConsecutiveProductBlocks,
    allowConsecutiveProductImages: config.allowConsecutiveProductImages
});

module.exports = {
    ARTICLE_TYPE_THRESHOLDS,
    PRODUCT_PLACEMENT_STYLES,
    RANKING_POSITION_MODES,
    STYLE_DEFINITIONS,
    buildEnvProductPlacementConfig,
    normalizeProductPlacementOptions,
    placementDensityFor
};
