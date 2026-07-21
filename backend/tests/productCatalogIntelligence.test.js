import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildEnvProductSeedingConfig, normalizeProductSeedingOptions } = require('../src/config/productSeeding.config');
const { ProductCatalogSnapshot } = require('../src/models/productCatalogSnapshot.model');
const { ProductCatalogIntelligenceService, buildSafeProduct, hashSafeCatalog } = require('../src/services/productCatalogIntelligence.service');

const document = (overrides = {}) => ({
    _id: '507f1f77bcf86cd799439011',
    product_name: 'Quạt tích điện mini',
    product_slug: 'quat-tich-dien-mini',
    product_description: '<p>Quạt dùng cho bàn học.</p><script>private()</script>',
    product_thumb: '/images/fan.jpg',
    product_price: 450000,
    product_quantity: 12,
    product_type: 'Electronics',
    product_attributes: { material: 'ABS', feature: 'Pin sạc', power: '12W', privateNote: { margin: 0.8 } },
    product_shop: 'private-shop',
    product_reviews: [{ authorEmail: 'customer@example.com' }],
    isDraft: false,
    isPublished: true,
    updatedAt: new Date('2026-07-17T00:00:00Z'),
    ...overrides
});

describe('Product Catalog Intelligence', () => {
    afterEach(() => vi.restoreAllMocks());

    it('returns only normalized public evidence and excludes private product fields', () => {
        const safe = buildSafeProduct({ document: document(), inventoryStock: 8 });
        expect(safe).toMatchObject({
            name: 'Quạt tích điện mini',
            canonicalUrl: '/product/quat-tich-dien-mini',
            status: 'active', availability: 'in_stock', eligible: true
        });
        expect(safe.shortDescription).not.toContain('script');
        expect(JSON.stringify(safe)).not.toContain('customer@example.com');
        expect(JSON.stringify(safe)).not.toContain('private-shop');
        expect(JSON.stringify(safe)).not.toContain('margin');
    });

    it('rejects inactive, incomplete and out-of-stock products by default', () => {
        const safe = buildSafeProduct({
            document: document({ isDraft: true, isPublished: false, product_quantity: 0, product_description: '', product_attributes: {} }),
            inventoryStock: 0
        });
        expect(safe.eligible).toBe(false);
        expect(safe.rejectionReasons).toContain('product_not_active_and_published');
        expect(safe.rejectionReasons).toContain('out_of_stock');
        expect(safe.rejectionReasons).toContain('insufficient_verified_data');
    });

    it('produces a stable order-independent hash and changes it when evidence changes', () => {
        const first = buildSafeProduct({ document: document(), inventoryStock: 8 });
        const second = buildSafeProduct({ document: document({ _id: '507f1f77bcf86cd799439012', product_name: 'Quạt đứng', product_slug: 'quat-dung' }), inventoryStock: 20 });
        expect(hashSafeCatalog([first, second])).toBe(hashSafeCatalog([second, first]));
        expect(hashSafeCatalog([first])).not.toBe(hashSafeCatalog([{ ...first, availability: 'low_stock' }]));
    });

    it('reuses an unexpired snapshot only while the live safe catalog hash still matches', async () => {
        const safe = buildSafeProduct({ document: document(), inventoryStock: 8 });
        vi.spyOn(ProductCatalogIntelligenceService, 'readSafeCatalog').mockResolvedValue([safe]);
        vi.spyOn(ProductCatalogSnapshot, 'findOne').mockReturnValue({
            sort: () => ({ lean: async () => ({ _id: '507f1f77bcf86cd799439099', catalogHash: hashSafeCatalog([safe]), status: 'complete' }) })
        });
        const create = vi.spyOn(ProductCatalogSnapshot, 'create');
        const snapshot = await ProductCatalogIntelligenceService.ensureSnapshot({ now: new Date('2026-07-17T00:00:00Z') });
        expect(snapshot.safeProducts).toEqual([safe]);
        expect(create).not.toHaveBeenCalled();
    });

    it('creates a new snapshot when product evidence changes inside the TTL window', async () => {
        const safe = buildSafeProduct({ document: document(), inventoryStock: 8 });
        vi.spyOn(ProductCatalogIntelligenceService, 'readSafeCatalog').mockResolvedValue([safe]);
        vi.spyOn(ProductCatalogSnapshot, 'findOne').mockReturnValue({
            sort: () => ({ lean: async () => ({ _id: '507f1f77bcf86cd799439099', catalogHash: 'stale-hash', status: 'complete' }) })
        });
        const create = vi.spyOn(ProductCatalogSnapshot, 'create').mockImplementation(async (value) => ({ ...value, _id: '507f1f77bcf86cd799439098' }));
        const snapshot = await ProductCatalogIntelligenceService.ensureSnapshot({ now: new Date('2026-07-17T00:00:00Z') });
        expect(snapshot.catalogHash).toBe(hashSafeCatalog([safe]));
        expect(create).toHaveBeenCalledTimes(1);
    });

    it('stores only a bounded code when catalog snapshot creation fails', async () => {
        vi.spyOn(ProductCatalogIntelligenceService, 'readSafeCatalog').mockRejectedValue(
            new Error('mongodb://user:private-password@catalog.invalid/db')
        );
        vi.spyOn(ProductCatalogSnapshot, 'findOne').mockReturnValue({
            sort: () => ({ lean: async () => null })
        });
        const create = vi.spyOn(ProductCatalogSnapshot, 'create').mockImplementation(async (value) => value);

        const snapshot = await ProductCatalogIntelligenceService.ensureSnapshot({
            now: new Date('2026-07-17T00:00:00Z')
        });

        expect(snapshot.error).toBe('PRODUCT_CATALOG_SNAPSHOT_FAILED');
        expect(JSON.stringify(create.mock.calls)).not.toContain('private-password');
    });

    it('centralizes validated env defaults and globally forces mode off', () => {
        const base = buildEnvProductSeedingConfig({ PRODUCT_SEEDING_ENABLED: 'false', PRODUCT_SEED_MIN_RELEVANCE_SCORE: '4' });
        expect(base.defaultMode).toBe('off');
        expect(base.minRelevanceScore).toBe(1);
        expect(normalizeProductSeedingOptions({ enabled: true, mode: 'required' }, base).mode).toBe('off');
    });
});
