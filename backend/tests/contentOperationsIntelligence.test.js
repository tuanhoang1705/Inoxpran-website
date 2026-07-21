import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { getContentOperationsConfig } = require('../src/config/contentOperations.config');
const {
    ContentOperationsIntelligenceService,
    contentHashFor,
    diffInventoryState,
    diffProductState
} = require('../src/services/contentOperations/contentOperationsIntelligence.service');

const matches = (document, filter) => {
    if (!document) return false;
    if (filter.snapshotDate && typeof filter.snapshotDate === 'string' && document.snapshotDate !== filter.snapshotDate) return false;
    if (filter.snapshotDate?.$lt && !(document.snapshotDate < filter.snapshotDate.$lt)) return false;
    if (filter.timezone && document.timezone !== filter.timezone) return false;
    if (filter.leaseToken && document.leaseToken !== filter.leaseToken) return false;
    if (filter.status?.$in && !filter.status.$in.includes(document.status)) return false;
    if (filter.$or) {
        const allowed = filter.$or.some((condition) => {
            if (Object.prototype.hasOwnProperty.call(condition, 'leaseUntil') && condition.leaseUntil === null) return !document.leaseUntil;
            if (condition.leaseUntil?.$exists === false) return document.leaseUntil === undefined;
            if (condition.leaseUntil?.$lte) return !document.leaseUntil || new Date(document.leaseUntil) <= condition.leaseUntil.$lte;
            return false;
        });
        if (!allowed) return false;
    }
    return true;
};

const createSnapshotModel = (initial = []) => {
    const documents = initial.map((item) => ({ ...item }));
    let sequence = 500;
    const findOne = vi.fn((filter) => {
        let sort = null;
        const query = {
            select: () => query,
            sort: (value) => {
                sort = value;
                return query;
            },
            lean: async () => {
                let found = documents.filter((document) => matches(document, filter));
                if (sort?.snapshotDate) found = found.sort((left, right) => sort.snapshotDate * left.snapshotDate.localeCompare(right.snapshotDate));
                return found[0] ? { ...found[0] } : null;
            }
        };
        return query;
    });
    const findOneAndUpdate = vi.fn(async (filter, update, options = {}) => {
        let document = documents.find((item) => matches(item, filter));
        if (!document && options.upsert) {
            sequence += 1;
            document = {
                _id: `507f1f77bcf86cd79943${String(sequence).slice(-4)}`,
                ...(update.$setOnInsert || {})
            };
            documents.push(document);
        }
        if (!document) return null;
        Object.assign(document, update.$set || {});
        Object.keys(update.$unset || {}).forEach((key) => delete document[key]);
        return { ...document };
    });
    return { documents, findOne, findOneAndUpdate };
};

const now = new Date('2026-07-20T05:00:00.000Z');
const timezone = 'Asia/Ho_Chi_Minh';

const availableAnalytics = {
    source: 'first_party_aggregate_analytics',
    enabled: true,
    configured: true,
    status: 'available',
    checkedAt: now.toISOString(),
    periods: [{
        days: 7,
        status: 'available',
        current: { views: 20, sessions: 10, hasData: true },
        previous: { views: 10, sessions: 8, hasData: true },
        pages: [{ path: '/blog/a', views: 20 }]
    }],
    warnings: []
};

describe('Content Operations daily intelligence', () => {
    it('uses stable evidence hashing and does not emit baseline change floods', () => {
        expect(contentHashFor({ b: 2, a: 1 })).toBe(contentHashFor({ a: 1, b: 2 }));
        expect(diffProductState([{ productId: 'p1' }], [])).toEqual([]);
        expect(diffInventoryState([{ blogId: 'b1' }], [])).toEqual([]);
    });

    it('runs the Google gate first, records unavailable configured sources as partial, and reuses the daily lease result', async () => {
        const events = [];
        const previousProduct = {
            productId: '507f1f77bcf86cd799439099',
            slug: 'noi-24',
            canonicalUrl: '/product/noi-24',
            status: 'active',
            availability: 'low_stock',
            evidenceHash: 'old-product-hash'
        };
        const previousInventory = {
            blogId: '507f1f77bcf86cd799439011',
            slug: 'bao-quan-noi',
            status: 'published',
            reviewStatus: 'current',
            contentHash: 'old-content-hash',
            structuralFingerprint: 'same-structure',
            warnings: []
        };
        const SnapshotModel = createSnapshotModel([{
            _id: '507f1f77bcf86cd799439400',
            snapshotDate: '2026-07-19',
            timezone,
            status: 'complete',
            checkedAt: new Date('2026-07-19T05:00:00.000Z'),
            contentHash: 'previous',
            sourceState: { products: [previousProduct], inventory: [previousInventory] }
        }]);
        const googleIntelligenceService = {
            ensureGoogleIntelligenceSnapshotForDate: vi.fn(async () => {
                events.push('google');
                return {
                    id: '507f1f77bcf86cd799439401',
                    checkedAt: now,
                    status: 'completed_no_change'
                };
            })
        };
        const currentItem = {
            blogId: '507f1f77bcf86cd799439011',
            slug: 'bao-quan-noi',
            status: 'published',
            reviewStatus: 'current',
            contentHash: 'new-content-hash',
            structuralFingerprint: 'same-structure',
            warnings: ['orphan_content']
        };
        const inventoryService = {
            ensureSnapshotForDate: vi.fn(async () => {
                events.push('inventory');
                return {
                    snapshot: {
                        _id: '507f1f77bcf86cd799439402',
                        status: 'complete',
                        checkedAt: now,
                        contentHash: 'inventory-hash',
                        summary: { total: 1, orphaned: 1 },
                        warnings: []
                    },
                    items: [currentItem]
                };
            })
        };
        const productCatalogService = {
            readSafeCatalog: vi.fn(async () => [{
                productId: '507f1f77bcf86cd799439099',
                slug: 'noi-24',
                canonicalUrl: '/product/noi-24',
                status: 'active',
                availability: 'in_stock',
                updatedAt: '2026-07-20T00:00:00.000Z',
                verifiedFeatures: ['Đáy từ'],
                verifiedSpecifications: []
            }])
        };
        const searchConsoleAdapter = {
            read: vi.fn(async () => ({
                source: 'google_search_console', enabled: true, configured: true,
                status: 'unavailable', checkedAt: now.toISOString(), fallback: true,
                windows: [{ days: 7, status: 'unavailable', current: null, previous: null, signals: {} }],
                warnings: ['search_console_token_unavailable']
            }))
        };
        const trendsAdapter = {
            read: vi.fn(async () => ({
                source: 'trends', enabled: false, configured: false, status: 'unavailable',
                checkedAt: now.toISOString(), signals: [], warnings: ['trends_disabled']
            }))
        };
        const aggregateAnalyticsAdapter = { read: vi.fn(async () => availableAnalytics) };
        const config = {
            ...getContentOperationsConfig({ CONTENT_OPERATIONS_ENABLED: 'true' }),
            timezone,
            snapshotMaxAgeHours: 30,
            leaseMs: 60_000,
            leaseWaitMs: 0,
            leasePollMs: 1
        };
        const service = new ContentOperationsIntelligenceService({
            SnapshotModel,
            googleIntelligenceService,
            inventoryService,
            contentSignalService: { listSignals: vi.fn(async () => []) },
            productCatalogService,
            searchConsoleAdapter,
            aggregateAnalyticsAdapter,
            trendsAdapter,
            config,
            now: () => now,
            sleep: vi.fn(async () => {})
        });

        const first = await service.ensureContentOperationsSnapshotForDate({ now });
        expect(events.slice(0, 2)).toEqual(['google', 'inventory']);
        expect(first.reused).toBe(false);
        expect(first.snapshot.status).toBe('partial');
        expect(first.snapshot.websitePerformance.searchConsole.windows[0].current).toBeNull();
        expect(first.snapshot.sourceHealth).toEqual(expect.arrayContaining([
            expect.objectContaining({ source: 'google_search_console', configured: true, status: 'unavailable' }),
            expect.objectContaining({ source: 'trends', configured: false, status: 'unavailable' })
        ]));
        expect(first.snapshot.businessSignals.productChanges).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: 'product_availability_changed', from: 'low_stock', to: 'in_stock' })
        ]));
        expect(first.snapshot.businessSignals.inventoryChanges).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: 'content_changed' }),
            expect.objectContaining({ type: 'content_risk_detected', risks: ['orphan_content'] })
        ]));
        expect(first.snapshot).not.toHaveProperty('sourceState');
        expect(first.snapshot).not.toHaveProperty('leaseToken');
        expect(first.snapshot.contentHash).toHaveLength(64);

        const second = await service.ensureContentOperationsSnapshotForDate({ now });
        expect(second.reused).toBe(true);
        expect(second.snapshot.id).toBe(first.snapshot.id);
        expect(inventoryService.ensureSnapshotForDate).toHaveBeenCalledTimes(1);
        expect(googleIntelligenceService.ensureGoogleIntelligenceSnapshotForDate).toHaveBeenCalledTimes(2);
    });

    it('does not create a database snapshot when the feature flag is disabled', async () => {
        const SnapshotModel = createSnapshotModel();
        const service = new ContentOperationsIntelligenceService({
            SnapshotModel,
            config: getContentOperationsConfig({ CONTENT_OPERATIONS_ENABLED: 'false' }),
            now: () => now
        });
        const result = await service.ensureContentOperationsSnapshotForDate({ now });
        expect(result.disabled).toBe(true);
        expect(result.snapshot.status).toBe('unavailable');
        expect(SnapshotModel.findOne).not.toHaveBeenCalled();
        expect(SnapshotModel.findOneAndUpdate).not.toHaveBeenCalled();
    });
});
