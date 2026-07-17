'use strict'

const crypto = require('node:crypto');
const sanitizeHtml = require('sanitize-html');
const { product } = require('../models/product.model');
const { inventory } = require('../models/inventory.model');
const { ProductCatalogSnapshot } = require('../models/productCatalogSnapshot.model');
const { buildEnvProductSeedingConfig } = require('../config/productSeeding.config');

const PRODUCT_SELECT = [
    '_id', 'product_name', 'product_slug', 'product_description', 'product_thumb',
    'product_price', 'product_quantity', 'product_type', 'product_attributes',
    'product_variations', 'isDraft', 'isPublished', 'updatedAt'
].join(' ');

const CATEGORY_NAMES = Object.freeze({
    CastIrons: 'Gang',
    Electronics: 'Gia dụng điện',
    Inoxs: 'Inox'
});

const sha256 = (value) => crypto.createHash('sha256').update(String(value || '')).digest('hex');
const text = (value, max = 300) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const textList = (value, maxItems = 30) => {
    const source = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,;|\n]/) : [];
    return Array.from(new Set(source.map((item) => text(item, 160)).filter(Boolean))).slice(0, maxItems);
};
const stripDescription = (value) => text(sanitizeHtml(String(value || ''), { allowedTags: [], allowedAttributes: {} }), 600);

const attributeEntries = (attributes) => {
    if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) return [];
    return Object.entries(attributes)
        .filter(([key, value]) => text(key) && value !== null && value !== undefined && typeof value !== 'object')
        .map(([key, value]) => ({ key: text(key, 80), value: text(value, 180), source: 'product_attributes' }))
        .filter((entry) => entry.value)
        .slice(0, 50);
};

const pickAttributeValues = (entries, pattern) => entries
    .filter((entry) => pattern.test(entry.key))
    .flatMap((entry) => textList(entry.value, 10));

const resolveAvailability = ({ inventoryStock, productQuantity }) => {
    const stock = Number.isFinite(Number(inventoryStock)) ? Number(inventoryStock) : Number(productQuantity);
    if (!Number.isFinite(stock)) return 'unknown';
    if (stock <= 0) return 'out_of_stock';
    if (stock <= 5) return 'low_stock';
    return 'in_stock';
};

const buildSafeProduct = ({ document = {}, inventoryStock, config = buildEnvProductSeedingConfig() }) => {
    const productId = text(document._id, 80);
    const name = text(document.product_name, 240);
    const slug = text(document.product_slug, 180);
    const categoryKey = text(document.product_type, 80);
    const attributes = attributeEntries(document.product_attributes);
    const verifiedSpecifications = attributes.map((item) => ({ ...item }));
    const verifiedFeatures = [
        ...pickAttributeValues(attributes, /feature|tính năng|chức năng/i),
        ...textList(document.product_variations, 10)
    ].slice(0, 30);
    const materials = pickAttributeValues(attributes, /material|chất liệu|vật liệu|inox|thép|gang/i);
    const supportedUseCases = pickAttributeValues(attributes, /use|công dụng|nhu cầu|phù hợp|ứng dụng/i);
    const problemSolutions = pickAttributeValues(attributes, /solution|giải pháp|vấn đề/i);
    const compatibility = pickAttributeValues(attributes, /compat|tương thích|loại bếp|điện áp/i);
    const targetCustomers = pickAttributeValues(attributes, /customer|đối tượng|người dùng/i);
    const seasonality = pickAttributeValues(attributes, /season|mùa|thời tiết/i);
    const shortDescription = stripDescription(document.product_description);
    const canonicalUrl = slug ? `/product/${encodeURIComponent(slug)}` : '';
    const active = Boolean(document.isPublished) && !Boolean(document.isDraft);
    const status = active ? 'active' : 'inactive';
    const availability = resolveAvailability({ inventoryStock, productQuantity: document.product_quantity });
    const completenessSignals = [
        Boolean(name), Boolean(slug), Boolean(categoryKey), Boolean(shortDescription),
        verifiedSpecifications.length > 0 || verifiedFeatures.length > 0,
        Boolean(document.product_thumb), availability !== 'unknown'
    ];
    const dataCompleteness = Number((completenessSignals.filter(Boolean).length / completenessSignals.length).toFixed(4));
    const rejectionReasons = [];
    if (config.requireActiveProduct && !active) rejectionReasons.push('product_not_active_and_published');
    if (!name) rejectionReasons.push('product_name_missing');
    if (config.requireCanonicalUrl && !canonicalUrl) rejectionReasons.push('canonical_url_missing');
    if (!CATEGORY_NAMES[categoryKey]) rejectionReasons.push('category_invalid');
    if (
        dataCompleteness < config.catalogMinDataCompleteness ||
        (verifiedSpecifications.length === 0 && verifiedFeatures.length === 0)
    ) rejectionReasons.push('insufficient_verified_data');
    if (availability === 'out_of_stock' && !config.allowOutOfStock) rejectionReasons.push('out_of_stock');
    const updatedAt = document.updatedAt ? new Date(document.updatedAt) : null;
    const safe = {
        productId,
        sku: text(document.product_attributes?.sku || document.product_attributes?.SKU, 100),
        name,
        slug,
        canonicalUrl,
        status,
        availability,
        category: { id: categoryKey, name: CATEGORY_NAMES[categoryKey] || categoryKey },
        brand: { id: 'inoxpran', name: 'INOXPRAN' },
        shortDescription,
        verifiedFeatures,
        verifiedSpecifications,
        materials,
        supportedUseCases,
        problemSolutions,
        compatibility,
        targetCustomers,
        seasonality,
        priceContext: {
            available: Number(document.product_price) > 0,
            value: Number(document.product_price) > 0 ? Number(document.product_price) : null,
            currency: 'VND',
            checkedAt: updatedAt ? updatedAt.toISOString() : null
        },
        primaryImage: text(document.product_thumb, 500),
        seoTitle: name,
        seoDescription: shortDescription.slice(0, 160),
        dataCompleteness,
        updatedAt: updatedAt ? updatedAt.toISOString() : null,
        eligible: rejectionReasons.length === 0,
        rejectionReasons
    };
    return safe;
};

const stableProductEvidence = (safeProduct) => ({
    productId: safeProduct.productId,
    name: safeProduct.name,
    slug: safeProduct.slug,
    status: safeProduct.status,
    availability: safeProduct.availability,
    category: safeProduct.category,
    verifiedFeatures: safeProduct.verifiedFeatures,
    verifiedSpecifications: safeProduct.verifiedSpecifications,
    materials: safeProduct.materials,
    supportedUseCases: safeProduct.supportedUseCases,
    problemSolutions: safeProduct.problemSolutions,
    compatibility: safeProduct.compatibility,
    dataCompleteness: safeProduct.dataCompleteness,
    updatedAt: safeProduct.updatedAt
});

const hashSafeCatalog = (safeProducts) => sha256(JSON.stringify(
    [...safeProducts]
        .map(stableProductEvidence)
        .sort((left, right) => left.productId.localeCompare(right.productId))
));

class ProductCatalogIntelligenceService {
    static async readSafeCatalog({ config = buildEnvProductSeedingConfig() } = {}) {
        const documents = await product.find({}).select(PRODUCT_SELECT).lean();
        const ids = documents.map((item) => item._id);
        const inventoryRows = ids.length
            ? await inventory.aggregate([
                { $match: { inven_productId: { $in: ids } } },
                { $group: { _id: '$inven_productId', stock: { $sum: '$inven_stock' } } }
            ])
            : [];
        const stockByProduct = new Map(inventoryRows.map((row) => [String(row._id), Number(row.stock)]));
        return documents.map((document) => buildSafeProduct({
            document,
            inventoryStock: stockByProduct.get(String(document._id)),
            config
        }));
    }

    static async ensureSnapshot({ force = false, now = new Date(), config = buildEnvProductSeedingConfig() } = {}) {
        if (!force) {
            const reusable = await ProductCatalogSnapshot.findOne({ status: { $in: ['complete', 'partial'] }, expiresAt: { $gt: now } })
                .sort({ generatedAt: -1 })
                .lean();
            if (reusable) {
                const products = await ProductCatalogIntelligenceService.readSafeCatalog({ config });
                if (hashSafeCatalog(products) === reusable.catalogHash) {
                    return { ...reusable, safeProducts: products };
                }
            }
        }
        try {
            const products = await ProductCatalogIntelligenceService.readSafeCatalog({ config });
            const generatedAt = new Date(now);
            const sourceDates = products.map((item) => item.updatedAt ? new Date(item.updatedAt).getTime() : 0).filter((item) => item > 0);
            const sourceUpdatedAt = sourceDates.length ? new Date(Math.max(...sourceDates)) : null;
            const status = products.some((item) => item.eligible) || products.length === 0 ? 'complete' : 'partial';
            const snapshot = await ProductCatalogSnapshot.create({
                catalogHash: hashSafeCatalog(products),
                productCount: products.length,
                eligibleProductCount: products.filter((item) => item.eligible).length,
                generatedAt,
                sourceUpdatedAt,
                expiresAt: new Date(generatedAt.getTime() + config.catalogSnapshotTtlMinutes * 60_000),
                filters: {
                    requireActiveProduct: config.requireActiveProduct,
                    requireCanonicalUrl: config.requireCanonicalUrl,
                    allowOutOfStock: config.allowOutOfStock,
                    minDataCompleteness: config.catalogMinDataCompleteness
                },
                status,
                productReferences: products.map((item) => ({
                    productId: item.productId,
                    evidenceHash: sha256(JSON.stringify(stableProductEvidence(item))),
                    dataCompleteness: item.dataCompleteness,
                    eligible: item.eligible,
                    rejectionReasons: item.rejectionReasons
                }))
            });
            return { ...(typeof snapshot.toObject === 'function' ? snapshot.toObject() : snapshot), safeProducts: products };
        } catch (error) {
            const failed = await ProductCatalogSnapshot.create({
                catalogHash: sha256(`failed:${now.toISOString()}`),
                productCount: 0,
                eligibleProductCount: 0,
                generatedAt: now,
                expiresAt: new Date(now.getTime() + config.catalogSnapshotTtlMinutes * 60_000),
                status: 'failed',
                error: text(error?.message || 'catalog_snapshot_failed', 500)
            });
            return typeof failed.toObject === 'function' ? failed.toObject() : failed;
        }
    }

    static async safeShortlist({ candidates = [], limit = 20 } = {}) {
        return candidates
            .filter((item) => item && item.productId)
            .slice(0, Math.min(Math.max(Number(limit) || 20, 1), 50))
            .map((item) => ({ ...item }));
    }

    static async getStatus() {
        const latest = await ProductCatalogSnapshot.findOne().sort({ generatedAt: -1 }).lean();
        return latest ? {
            id: String(latest._id), catalogHash: latest.catalogHash,
            productCount: latest.productCount, eligibleProductCount: latest.eligibleProductCount,
            generatedAt: latest.generatedAt, sourceUpdatedAt: latest.sourceUpdatedAt,
            expiresAt: latest.expiresAt, status: latest.status, error: latest.error || ''
        } : { status: 'missing', productCount: 0, eligibleProductCount: 0 };
    }
}

module.exports = {
    CATEGORY_NAMES,
    PRODUCT_SELECT,
    ProductCatalogIntelligenceService,
    buildSafeProduct,
    hashSafeCatalog,
    stableProductEvidence
};
