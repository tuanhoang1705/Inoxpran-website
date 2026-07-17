'use strict'

const PRODUCT_SEEDING_MODES = ['off', 'auto', 'required'];
const PRODUCT_SEEDING_INTENSITIES = ['light', 'balanced', 'commercial'];
const PRODUCT_SEEDING_PERMISSIONS = Object.freeze([
    'product_seeding.view',
    'product_seeding.preview',
    'product_seeding.manage',
    'product_seeding.override',
    'product_catalog_snapshot.view',
    'product_catalog_snapshot.rebuild'
]);

const DEFAULT_SCORING_WEIGHTS = Object.freeze({
    topicIntent: 0.3,
    userProblem: 0.2,
    categoryFeature: 0.15,
    useCase: 0.1,
    availability: 0.1,
    dataCompleteness: 0.05,
    seasonality: 0.05,
    linkOpportunity: 0.05
});

const DEFAULT_SCORING_PENALTIES = Object.freeze({
    outOfStock: 0.25,
    inactive: 1,
    insufficientData: 0.15,
    weakSemanticRelevance: 0.2,
    recentExposure: 0.12,
    repeatedExposure: 0.08,
    categoryMismatch: 0.12,
    invalidCanonicalUrl: 1,
    excluded: 1,
    highClaimRisk: 0.2
});

const parseBoolean = (value, fallback) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    if (typeof value !== 'string') return fallback;
    if (['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase())) return true;
    if (['false', '0', 'no', 'off'].includes(value.trim().toLowerCase())) return false;
    return fallback;
};

const clampNumber = (value, fallback, min, max) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(parsed, min), max);
};

const clampInteger = (value, fallback, min, max) =>
    Math.round(clampNumber(value, fallback, min, max));

const normalizeEnum = (value, allowed, fallback) => {
    const normalized = String(value || '').trim().toLowerCase();
    return allowed.includes(normalized) ? normalized : fallback;
};

const normalizeIds = (value, maxItems = 100) => {
    const source = Array.isArray(value) ? value : String(value || '').split(',');
    return Array.from(new Set(source.map((item) => String(item || '').trim()).filter(Boolean))).slice(0, maxItems);
};

const buildEnvProductSeedingConfig = (env = process.env) => {
    const enabled = parseBoolean(env.PRODUCT_SEEDING_ENABLED, true);
    return {
        enabled,
        defaultMode: enabled
            ? normalizeEnum(env.PRODUCT_SEEDING_DEFAULT_MODE, PRODUCT_SEEDING_MODES, 'auto')
            : 'off',
        defaultIntensity: normalizeEnum(env.PRODUCT_SEEDING_DEFAULT_INTENSITY, PRODUCT_SEEDING_INTENSITIES, 'light'),
        minRelevanceScore: clampNumber(env.PRODUCT_SEED_MIN_RELEVANCE_SCORE, 0.72, 0, 1),
        maxPrimaryProducts: clampInteger(env.PRODUCT_SEED_MAX_PRIMARY_PRODUCTS, 1, 0, 5),
        maxSupportingProducts: clampInteger(env.PRODUCT_SEED_MAX_SUPPORTING_PRODUCTS, 2, 0, 10),
        lookbackDays: clampInteger(env.PRODUCT_SEED_LOOKBACK_DAYS, 30, 1, 365),
        productCooldownDays: clampInteger(env.PRODUCT_SEED_PRODUCT_COOLDOWN_DAYS, 7, 0, 365),
        allowOutOfStock: parseBoolean(env.PRODUCT_SEED_ALLOW_OUT_OF_STOCK, false),
        requireActiveProduct: parseBoolean(env.PRODUCT_SEED_REQUIRE_ACTIVE_PRODUCT, true),
        requireCanonicalUrl: parseBoolean(env.PRODUCT_SEED_REQUIRE_CANONICAL_URL, true),
        maxMentionsLight: clampInteger(env.PRODUCT_SEED_MAX_MENTIONS_LIGHT, 2, 0, 20),
        maxMentionsBalanced: clampInteger(env.PRODUCT_SEED_MAX_MENTIONS_BALANCED, 4, 0, 30),
        maxMentionsCommercial: clampInteger(env.PRODUCT_SEED_MAX_MENTIONS_COMMERCIAL, 6, 0, 40),
        maxProductLinks: clampInteger(env.PRODUCT_SEED_MAX_PRODUCT_LINKS, 2, 0, 10),
        maxCtaCount: clampInteger(env.PRODUCT_SEED_MAX_CTA_COUNT, 1, 0, 5),
        catalogSnapshotTtlMinutes: clampInteger(env.PRODUCT_CATALOG_SNAPSHOT_TTL_MINUTES, 30, 1, 1440),
        catalogMinDataCompleteness: clampNumber(env.PRODUCT_CATALOG_MIN_DATA_COMPLETENESS, 0.6, 0, 1),
        scoringWeights: { ...DEFAULT_SCORING_WEIGHTS },
        scoringPenalties: { ...DEFAULT_SCORING_PENALTIES }
    };
};

const normalizeProductSeedingOptions = (value = {}, base = buildEnvProductSeedingConfig()) => {
    const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const enabled = base.enabled && parseBoolean(input.enabled, true);
    const requestedMode = normalizeEnum(input.mode || input.defaultMode, PRODUCT_SEEDING_MODES, base.defaultMode);
    return {
        enabled,
        mode: enabled ? requestedMode : 'off',
        intensity: normalizeEnum(input.intensity || input.defaultIntensity, PRODUCT_SEEDING_INTENSITIES, base.defaultIntensity),
        maxPrimaryProducts: clampInteger(input.maxPrimaryProducts, base.maxPrimaryProducts, 0, 5),
        maxSupportingProducts: clampInteger(input.maxSupportingProducts, base.maxSupportingProducts, 0, 10),
        preferredCategoryIds: normalizeIds(input.preferredCategoryIds || input.preferredCategories),
        preferredProductIds: normalizeIds(input.preferredProductIds || input.preferredProducts),
        excludedProductIds: normalizeIds(input.excludedProductIds || input.excludedProducts),
        allowOutOfStock: base.allowOutOfStock && parseBoolean(input.allowOutOfStock, false),
        relevanceThreshold: clampNumber(input.relevanceThreshold, base.minRelevanceScore, base.minRelevanceScore, 1),
        allowInformationalFallback: parseBoolean(input.allowInformationalFallback, true)
    };
};

const commercialDensityFor = (intensity, config = buildEnvProductSeedingConfig()) => ({
    maxProductMentions: intensity === 'commercial'
        ? config.maxMentionsCommercial
        : intensity === 'balanced' ? config.maxMentionsBalanced : config.maxMentionsLight,
    maxProductLinks: config.maxProductLinks,
    maxProductHeadings: intensity === 'commercial' ? 1 : 0,
    maxCtaCount: config.maxCtaCount
});

const applyProductSeedingConfigOverrides = (base, value = {}) => {
    const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const env = {
        PRODUCT_SEEDING_ENABLED: input.enabled ?? base.enabled,
        PRODUCT_SEEDING_DEFAULT_MODE: input.defaultMode ?? base.defaultMode,
        PRODUCT_SEEDING_DEFAULT_INTENSITY: input.defaultIntensity ?? base.defaultIntensity,
        PRODUCT_SEED_MIN_RELEVANCE_SCORE: input.minRelevanceScore ?? base.minRelevanceScore,
        PRODUCT_SEED_MAX_PRIMARY_PRODUCTS: input.maxPrimaryProducts ?? base.maxPrimaryProducts,
        PRODUCT_SEED_MAX_SUPPORTING_PRODUCTS: input.maxSupportingProducts ?? base.maxSupportingProducts,
        PRODUCT_SEED_LOOKBACK_DAYS: input.lookbackDays ?? base.lookbackDays,
        PRODUCT_SEED_PRODUCT_COOLDOWN_DAYS: input.productCooldownDays ?? base.productCooldownDays,
        PRODUCT_SEED_ALLOW_OUT_OF_STOCK: input.allowOutOfStock ?? base.allowOutOfStock,
        PRODUCT_SEED_REQUIRE_ACTIVE_PRODUCT: input.requireActiveProduct ?? base.requireActiveProduct,
        PRODUCT_SEED_REQUIRE_CANONICAL_URL: input.requireCanonicalUrl ?? base.requireCanonicalUrl,
        PRODUCT_SEED_MAX_MENTIONS_LIGHT: input.maxMentionsLight ?? base.maxMentionsLight,
        PRODUCT_SEED_MAX_MENTIONS_BALANCED: input.maxMentionsBalanced ?? base.maxMentionsBalanced,
        PRODUCT_SEED_MAX_MENTIONS_COMMERCIAL: input.maxMentionsCommercial ?? base.maxMentionsCommercial,
        PRODUCT_SEED_MAX_PRODUCT_LINKS: input.maxProductLinks ?? base.maxProductLinks,
        PRODUCT_SEED_MAX_CTA_COUNT: input.maxCtaCount ?? base.maxCtaCount,
        PRODUCT_CATALOG_SNAPSHOT_TTL_MINUTES: input.catalogSnapshotTtlMinutes ?? base.catalogSnapshotTtlMinutes,
        PRODUCT_CATALOG_MIN_DATA_COMPLETENESS: input.catalogMinDataCompleteness ?? base.catalogMinDataCompleteness
    };
    const normalized = buildEnvProductSeedingConfig(env);
    if (!base.enabled) normalized.enabled = false;
    if (!base.enabled) normalized.defaultMode = 'off';
    return normalized;
};

module.exports = {
    DEFAULT_SCORING_WEIGHTS,
    DEFAULT_SCORING_PENALTIES,
    PRODUCT_SEEDING_INTENSITIES,
    PRODUCT_SEEDING_MODES,
    PRODUCT_SEEDING_PERMISSIONS,
    buildEnvProductSeedingConfig,
    applyProductSeedingConfigOverrides,
    commercialDensityFor,
    normalizeProductSeedingOptions,
    parseBoolean
};
