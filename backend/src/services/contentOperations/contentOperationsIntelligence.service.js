'use strict'

const crypto = require('node:crypto');
const { ContentOperationsDailySnapshot } = require('../../models/contentOperationsDailySnapshot.model');
const { GoogleIntelligenceService } = require('../googleIntelligence.service');
const { ProductCatalogIntelligenceService } = require('../productCatalogIntelligence.service');
const { dateInTimezone } = require('../../utils/googleIntelligence.util');
const { getContentOperationsConfig } = require('../../config/contentOperations.config');
const { ContentInventoryService, productEvidenceHash } = require('./contentInventory.service');
const { ContentSignalService } = require('./contentSignal.service');
const { SearchConsoleAdapter } = require('./searchConsole.adapter');
const { AggregateAnalyticsAdapter } = require('./aggregateAnalytics.adapter');
const { TrendsAdapter } = require('./trends.adapter');
const { createGoogleTrendsRssProvider } = require('./googleTrendsRss.provider');
const {
    normalizeTrustedQaProvenance,
    qaProvenanceDocument,
    qaScopeFilter
} = require('../../utils/qaProvenance.util');

const createConfiguredTrendsProvider = (config = {}) => {
    if (String(config.provider || '').trim().toLowerCase() !== 'google_trends_rss') return null;
    return createGoogleTrendsRssProvider({
        geo: config.geo,
        maxSignals: config.maxSignals,
        maxResponseBytes: config.maxResponseBytes
    });
};

const sha256 = (value) => crypto.createHash('sha256').update(String(value ?? '')).digest('hex');
const text = (value, max = 1000) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const validDate = (value) => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};

const stableObject = (value) => {
    if (Array.isArray(value)) return value.map(stableObject);
    if (!value || typeof value !== 'object' || value instanceof Date) return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableObject(value[key])]));
};

const contentHashFor = (value) => sha256(JSON.stringify(stableObject(value)));

const withoutVolatileFields = (value) => {
    if (Array.isArray(value)) return value.map(withoutVolatileFields);
    if (!value || typeof value !== 'object' || value instanceof Date) return value;
    return Object.fromEntries(Object.entries(value)
        .filter(([key]) => !['checkedAt', 'createdAt', 'updatedAt', 'generatedAt'].includes(key))
        .map(([key, child]) => [key, withoutVolatileFields(child)]));
};

const executeQuery = async (query, { select, sort } = {}) => {
    let current = query;
    if (select && typeof current?.select === 'function') current = current.select(select);
    if (sort && typeof current?.sort === 'function') current = current.sort(sort);
    if (typeof current?.lean === 'function') current = current.lean();
    return current;
};

const isFreshSnapshot = ({ snapshot, now, maxAgeHours }) => {
    const checkedAt = validDate(snapshot?.checkedAt);
    return Boolean(
        snapshot &&
        ['complete', 'partial'].includes(snapshot.status) &&
        checkedAt &&
        now.getTime() - checkedAt.getTime() <= maxAgeHours * 3_600_000
    );
};

const productStateFromCatalog = (products = []) => products
    .filter((product) => text(product?.productId, 100))
    .map((product) => ({
        productId: text(product.productId, 100),
        slug: text(product.slug, 200),
        canonicalUrl: text(product.canonicalUrl, 1000),
        status: text(product.status, 40),
        availability: text(product.availability, 40),
        evidenceHash: productEvidenceHash(product)
    }))
    .sort((left, right) => left.productId.localeCompare(right.productId));

const inventoryStateFromItems = (items = []) => items
    .filter((item) => item?.blogId)
    .map((item) => ({
        blogId: String(item.blogId),
        slug: text(item.slug, 200),
        status: text(item.status, 40),
        reviewStatus: text(item.reviewStatus, 40),
        contentHash: text(item.contentHash, 128),
        structuralFingerprint: text(item.structuralFingerprint, 128),
        warnings: [...new Set((item.warnings || []).map((warning) => text(warning, 120)).filter(Boolean))].sort()
    }))
    .sort((left, right) => left.blogId.localeCompare(right.blogId));

const diffProductState = (current = [], previous = []) => {
    if (!previous.length) return [];
    const prior = new Map(previous.map((item) => [item.productId, item]));
    const currentIds = new Set(current.map((item) => item.productId));
    const changes = [];
    current.forEach((item) => {
        const before = prior.get(item.productId);
        if (!before) {
            changes.push({
                type: item.status === 'active' ? 'new_active_product' : 'product_added',
                productId: item.productId,
                slug: item.slug,
                status: item.status,
                availability: item.availability
            });
            return;
        }
        if (before.status !== item.status) changes.push({
            type: item.status === 'inactive' ? 'product_inactive' : item.status === 'active' ? 'product_activated' : 'product_status_changed',
            productId: item.productId,
            slug: item.slug,
            from: before.status,
            to: item.status
        });
        if (before.availability !== item.availability) changes.push({
            type: item.availability === 'out_of_stock'
                ? 'product_out_of_stock'
                : before.availability === 'out_of_stock' && ['in_stock', 'low_stock'].includes(item.availability)
                    ? 'product_restocked'
                    : 'product_availability_changed',
            productId: item.productId,
            slug: item.slug,
            from: before.availability,
            to: item.availability
        });
        if (before.slug !== item.slug || before.canonicalUrl !== item.canonicalUrl) changes.push({ type: 'product_url_changed', productId: item.productId, from: before.slug, to: item.slug });
        if (before.evidenceHash !== item.evidenceHash) changes.push({ type: 'product_specification_changed', productId: item.productId, slug: item.slug });
    });
    previous.filter((item) => !currentIds.has(item.productId)).forEach((item) => {
        changes.push({ type: 'product_removed', productId: item.productId, slug: item.slug });
    });
    return changes.slice(0, 500);
};

const diffInventoryState = (current = [], previous = []) => {
    if (!previous.length) return [];
    const prior = new Map(previous.map((item) => [item.blogId, item]));
    const currentIds = new Set(current.map((item) => item.blogId));
    const changes = [];
    current.forEach((item) => {
        const before = prior.get(item.blogId);
        if (!before) {
            changes.push({ type: 'content_added', blogId: item.blogId, slug: item.slug, status: item.status });
            return;
        }
        if (before.contentHash !== item.contentHash) changes.push({ type: 'content_changed', blogId: item.blogId, slug: item.slug });
        if (before.structuralFingerprint !== item.structuralFingerprint) changes.push({ type: 'content_structure_changed', blogId: item.blogId, slug: item.slug });
        if (before.reviewStatus !== item.reviewStatus) changes.push({ type: 'content_review_status_changed', blogId: item.blogId, slug: item.slug, from: before.reviewStatus, to: item.reviewStatus });
        const newWarnings = item.warnings.filter((warning) => !before.warnings.includes(warning));
        if (newWarnings.length) changes.push({ type: 'content_risk_detected', blogId: item.blogId, slug: item.slug, risks: newWarnings });
    });
    previous.filter((item) => !currentIds.has(item.blogId)).forEach((item) => {
        changes.push({ type: 'content_removed', blogId: item.blogId, slug: item.slug });
    });
    return changes.slice(0, 500);
};

const sourceHealthEntry = ({ source, result, enabled, configured, checkedAt, errorCode = '' }) => {
    const status = ['available', 'partial', 'unavailable', 'failed'].includes(result?.status)
        ? result.status
        : errorCode ? 'failed' : 'unavailable';
    const sourceCheckedAt = validDate(result?.checkedAt || checkedAt);
    return {
        source,
        enabled: enabled ?? (typeof result?.enabled === 'boolean' ? result.enabled : true),
        configured: configured ?? Boolean(result?.configured),
        status,
        checkedAt: sourceCheckedAt,
        freshness: sourceCheckedAt ? { checkedAt: sourceCheckedAt.toISOString() } : null,
        errorCode: text(errorCode || result?.warnings?.[0], 120)
    };
};

const safeSnapshotView = (snapshot) => {
    const source = typeof snapshot?.toObject === 'function' ? snapshot.toObject() : snapshot || {};
    return {
        id: String(source._id || source.id || ''),
        isQaTest: source.isQaTest === true,
        qaBatchId: source.qaBatchId ? String(source.qaBatchId) : '',
        qaCaseId: source.qaCaseId ? String(source.qaCaseId) : '',
        environment: source.environment || '',
        executionMode: source.executionMode || '',
        originalTopicSeed: source.originalTopicSeed || '',
        normalizedTopicKey: source.normalizedTopicKey || '',
        snapshotDate: source.snapshotDate,
        timezone: source.timezone,
        status: source.status,
        googleIntelSnapshotId: source.googleIntelSnapshotId ? String(source.googleIntelSnapshotId) : '',
        contentInventorySnapshotId: source.contentInventorySnapshotId ? String(source.contentInventorySnapshotId) : '',
        sourceHealth: source.sourceHealth || [],
        websitePerformance: source.websitePerformance || {},
        contentInventorySummary: source.contentInventorySummary || {},
        businessSignals: source.businessSignals || {},
        opportunitySignals: source.opportunitySignals || [],
        risks: source.risks || [],
        warnings: source.warnings || [],
        sourceFreshness: source.sourceFreshness || {},
        checkedAt: source.checkedAt || null,
        contentHash: source.contentHash || '',
        createdAt: source.createdAt || null,
        updatedAt: source.updatedAt || null
    };
};

const unavailableAdapterResult = (source, checkedAt, warning) => ({
    source,
    enabled: false,
    configured: false,
    status: 'unavailable',
    checkedAt: checkedAt.toISOString(),
    warnings: [warning]
});

const readContentSignals = async (service, config, checkedAt) => {
    if (!config?.enabled) return unavailableAdapterResult('content_signals', checkedAt, 'content_signals_disabled');
    if (!service || typeof service.listSignals !== 'function') {
        return {
            source: 'content_signals', enabled: true, configured: false, status: 'unavailable',
            checkedAt: checkedAt.toISOString(), signals: [], warnings: ['content_signals_service_missing']
        };
    }
    try {
        const signals = await service.listSignals({ limit: 500, mutateExpiry: false });
        return {
            source: 'content_signals', enabled: true, configured: true, status: 'available',
            checkedAt: checkedAt.toISOString(), signals: Array.isArray(signals) ? signals : [], warnings: []
        };
    } catch (_error) {
        return {
            source: 'content_signals', enabled: true, configured: true, status: 'failed',
            checkedAt: checkedAt.toISOString(), signals: [], warnings: ['content_signals_read_failed']
        };
    }
};

const buildWebsitePerformance = ({ searchResult = {}, analyticsResult = {} } = {}) => {
    const windows = Array.isArray(searchResult.windows) ? searchResult.windows : [];
    const searchAvailable = ['available', 'partial'].includes(searchResult.status) && windows.some((window) => window.status === 'available');
    const collect = (key) => searchAvailable
        ? windows.flatMap((window) => (window.status === 'available' ? (window.signals?.[key] || []).map((item) => ({
            ...item,
            windowDays: window.days
        })) : [])).slice(0, 500)
        : null;
    return {
        periods: windows.length ? windows.map((window) => `${window.days}d`) : ['7d', '28d', '90d'],
        growingPages: collect('growingPages'),
        decliningPages: collect('decayingPages'),
        highImpressionLowCtrPages: collect('lowCtrPages'),
        nearPageOneOpportunities: collect('nearPageOneQueries'),
        contentDecayCandidates: collect('decayingPages'),
        cannibalizationCandidates: collect('cannibalization'),
        queryGaps: collect('queryGaps'),
        risingTopics: collect('risingTopics'),
        titleMetadataOpportunities: collect('titleMetadataOpportunities'),
        searchConsole: {
            status: searchResult.status || 'unavailable',
            windows: searchResult.windows || null
        },
        analytics: {
            status: analyticsResult.status || 'unavailable',
            periods: analyticsResult.periods || null
        }
    };
};

const adapterRead = async (adapter, source, checkedAt) => {
    if (!adapter || typeof adapter.read !== 'function') return unavailableAdapterResult(source, checkedAt, `${source}_adapter_missing`);
    try {
        return await adapter.read();
    } catch (_error) {
        return {
            source,
            enabled: true,
            configured: true,
            status: 'failed',
            checkedAt: checkedAt.toISOString(),
            warnings: [`${source}_read_failed`]
        };
    }
};

class ContentOperationsIntelligenceService {
    constructor({
        SnapshotModel = ContentOperationsDailySnapshot,
        googleIntelligenceService = GoogleIntelligenceService,
        productCatalogService = ProductCatalogIntelligenceService,
        inventoryService = null,
        contentSignalService = null,
        searchConsoleAdapter = null,
        aggregateAnalyticsAdapter = null,
        trendsAdapter = null,
        config = getContentOperationsConfig(),
        now = () => new Date(),
        sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
    } = {}) {
        this.SnapshotModel = SnapshotModel;
        this.googleIntelligenceService = googleIntelligenceService;
        this.productCatalogService = productCatalogService;
        this.config = config;
        this.now = now;
        this.sleep = sleep;
        this.inventoryService = inventoryService || new ContentInventoryService({ config, productCatalogService, now });
        this.contentSignalService = contentSignalService || new ContentSignalService({ config, now });
        this.searchConsoleAdapter = searchConsoleAdapter || new SearchConsoleAdapter({ config: config.searchConsole, now });
        this.aggregateAnalyticsAdapter = aggregateAnalyticsAdapter || new AggregateAnalyticsAdapter({ config: config.aggregateAnalytics, now });
        this.trendsAdapter = trendsAdapter || new TrendsAdapter({
            config: config.trends,
            provider: createConfiguredTrendsProvider(config.trends),
            now
        });
    }

    async readSnapshot(filter, { internal = false, sort } = {}) {
        return executeQuery(this.SnapshotModel.findOne(filter), {
            select: internal ? '+sourceState +leaseOwner +leaseToken +leaseUntil' : undefined,
            sort
        });
    }

    async resolveGoogleSnapshot({ googleIntelSnapshot, googleIntelSnapshotId, now, trustedQaContext = null }) {
        if (googleIntelSnapshot && (googleIntelSnapshot.id || googleIntelSnapshot._id)) return googleIntelSnapshot;
        if (googleIntelSnapshotId) return { id: googleIntelSnapshotId, checkedAt: now, status: 'provided_by_gate' };
        if (!this.googleIntelligenceService || typeof this.googleIntelligenceService.ensureGoogleIntelligenceSnapshotForDate !== 'function') {
            const error = new Error('google_intelligence_gate_unavailable');
            error.code = 'GOOGLE_INTELLIGENCE_GATE_UNAVAILABLE';
            throw error;
        }
        return this.googleIntelligenceService.ensureGoogleIntelligenceSnapshotForDate({
            now,
            ...(trustedQaContext ? { trustedQaContext } : {})
        });
    }

    async acquireLease({ snapshotDate, now, force, trustedQaContext = null }) {
        const qaContext = normalizeTrustedQaProvenance(trustedQaContext);
        const snapshotBase = { snapshotDate, timezone: this.config.timezone };
        const snapshotKey = { ...snapshotBase, ...qaScopeFilter(qaContext) };
        const snapshotDocument = { ...snapshotBase, ...qaProvenanceDocument(qaContext) };
        const existing = await this.readSnapshot(snapshotKey, { internal: true });
        if (!force && isFreshSnapshot({ snapshot: existing, now, maxAgeHours: this.config.snapshotMaxAgeHours })) {
            return { snapshot: existing, reused: true };
        }
        const leaseOwner = `content-operations-${process.pid}`;
        const leaseToken = crypto.randomUUID();
        const leaseUntil = new Date(now.getTime() + this.config.leaseMs);
        const filter = {
            ...snapshotKey,
            $or: [
                { leaseUntil: null },
                { leaseUntil: { $exists: false } },
                { leaseUntil: { $lte: now } }
            ]
        };
        const update = {
            $setOnInsert: {
                ...snapshotDocument,
                checkedAt: now,
                contentHash: sha256(`${snapshotDate}:building`)
            },
            $set: {
                status: 'building',
                leaseOwner,
                leaseToken,
                leaseUntil
            }
        };
        let claimed = null;
        try {
            claimed = await this.SnapshotModel.findOneAndUpdate(filter, update, {
                upsert: !existing,
                new: true,
                setDefaultsOnInsert: true
            });
        } catch (error) {
            if (error?.code !== 11000) throw error;
        }
        if (claimed) return { leaseOwner, leaseToken, leaseUntil, snapshotKey, reused: false };

        const deadline = Date.now() + this.config.leaseWaitMs;
        while (Date.now() < deadline) {
            await this.sleep(this.config.leasePollMs);
            const concurrent = await this.readSnapshot(snapshotKey, { internal: true });
            if (isFreshSnapshot({ snapshot: concurrent, now: this.now(), maxAgeHours: this.config.snapshotMaxAgeHours })) {
                return { snapshot: concurrent, reused: true };
            }
            if (!concurrent?.leaseUntil || new Date(concurrent.leaseUntil) <= this.now()) {
                return this.acquireLease({ snapshotDate, now: this.now(), force: true, trustedQaContext: qaContext });
            }
        }
        const error = new Error('content_operations_lease_busy');
        error.code = 'CONTENT_OPERATIONS_LEASE_BUSY';
        throw error;
    }

    async completeLease({ snapshotKey, leaseToken, payload }) {
        const updated = await this.SnapshotModel.findOneAndUpdate(
            { ...snapshotKey, leaseToken },
            {
                $set: payload,
                $unset: { leaseOwner: '', leaseToken: '', leaseUntil: '' }
            },
            { new: true, runValidators: true }
        );
        if (!updated) {
            const error = new Error('content_operations_lease_lost');
            error.code = 'CONTENT_OPERATIONS_LEASE_LOST';
            throw error;
        }
        return updated;
    }

    async failLease({ snapshotKey, leaseToken, now, errorCode }) {
        return this.SnapshotModel.findOneAndUpdate(
            { ...snapshotKey, leaseToken },
            {
                $set: {
                    status: 'failed',
                    checkedAt: now,
                    contentHash: contentHashFor({ snapshotDate, status: 'failed', errorCode }),
                    warnings: [text(errorCode, 120)]
                },
                $unset: { leaseOwner: '', leaseToken: '', leaseUntil: '' }
            },
            { new: true, runValidators: true }
        );
    }

    async ensureContentOperationsSnapshotForDate({
        now = this.now(),
        force = false,
        googleIntelSnapshot = null,
        googleIntelSnapshotId = null,
        trustedQaContext = null
    } = {}) {
        const qaContext = normalizeTrustedQaProvenance(trustedQaContext);
        const provenance = qaProvenanceDocument(qaContext);
        if (!this.config.enabled) {
            return {
                snapshot: {
                    id: '',
                    snapshotDate: dateInTimezone(now, this.config.timezone),
                    timezone: this.config.timezone,
                    status: 'unavailable',
                    sourceHealth: [],
                    websitePerformance: {},
                    contentInventorySummary: {},
                    businessSignals: {},
                    opportunitySignals: [],
                    risks: [],
                    warnings: ['content_operations_disabled'],
                    checkedAt: now,
                    contentHash: ''
                },
                reused: false,
                disabled: true
            };
        }

        const googleSnapshot = await this.resolveGoogleSnapshot({
            googleIntelSnapshot,
            googleIntelSnapshotId,
            now,
            trustedQaContext: qaContext
        });
        const resolvedGoogleId = googleSnapshot.id || googleSnapshot._id;
        if (!resolvedGoogleId) {
            const error = new Error('google_intelligence_snapshot_id_missing');
            error.code = 'GOOGLE_INTELLIGENCE_SNAPSHOT_ID_MISSING';
            throw error;
        }

        const snapshotDate = dateInTimezone(now, this.config.timezone);
        if (qaContext && !force) {
            const productionSnapshot = await this.readSnapshot({
                snapshotDate,
                timezone: this.config.timezone,
                isQaTest: { $ne: true }
            });
            if (
                isFreshSnapshot({ snapshot: productionSnapshot, now, maxAgeHours: this.config.snapshotMaxAgeHours }) &&
                String(productionSnapshot.googleIntelSnapshotId || '') === String(resolvedGoogleId)
            ) {
                return { snapshot: safeSnapshotView(productionSnapshot), reused: true };
            }
        }
        const lease = await this.acquireLease({
            snapshotDate,
            now,
            force,
            trustedQaContext: qaContext
        });
        if (lease.reused) return { snapshot: safeSnapshotView(lease.snapshot), reused: true };

        try {
            const previous = await this.readSnapshot(
                {
                    snapshotDate: { $lt: snapshotDate },
                    timezone: this.config.timezone,
                    isQaTest: { $ne: true },
                    status: { $in: ['complete', 'partial'] }
                },
                { internal: true, sort: { snapshotDate: -1 } }
            );
            const [inventorySettled, productsSettled, searchResult, analyticsResult, trendsResult, contentSignalsResult] = await Promise.all([
                this.inventoryService.ensureSnapshotForDate({
                    now,
                    force,
                    ...(qaContext ? { trustedQaContext: qaContext } : {})
                }),
                Promise.resolve().then(() => this.productCatalogService.readSafeCatalog()),
                adapterRead(this.searchConsoleAdapter, 'google_search_console', now),
                adapterRead(this.aggregateAnalyticsAdapter, 'first_party_aggregate_analytics', now),
                adapterRead(this.trendsAdapter, 'trends', now),
                readContentSignals(this.contentSignalService, this.config.contentSignals, now)
            ].map((promise, index) => index < 2 ? Promise.resolve(promise).then(
                (value) => ({ status: 'fulfilled', value }),
                (reason) => ({ status: 'rejected', reason })
            ) : promise));

            if (inventorySettled.status !== 'fulfilled' || !inventorySettled.value?.snapshot) {
                const error = new Error('content_inventory_unavailable');
                error.code = 'CONTENT_INVENTORY_UNAVAILABLE';
                throw error;
            }
            const inventoryResult = inventorySettled.value;
            const inventorySnapshot = inventoryResult.snapshot;
            const products = productsSettled.status === 'fulfilled' && Array.isArray(productsSettled.value)
                ? productsSettled.value
                : [];
            const currentProductState = productStateFromCatalog(products);
            const currentInventoryState = inventoryStateFromItems(inventoryResult.items);
            const productChanges = diffProductState(currentProductState, previous?.sourceState?.products || []);
            const inventoryChanges = diffInventoryState(currentInventoryState, previous?.sourceState?.inventory || []);
            const productStatus = productsSettled.status === 'fulfilled' ? 'available' : 'failed';
            const sourceHealth = [
                sourceHealthEntry({ source: 'google_intelligence', result: { status: 'available', enabled: true, configured: true, checkedAt: googleSnapshot.checkedAt || now }, checkedAt: now }),
                sourceHealthEntry({
                    source: 'content_inventory',
                    result: {
                        status: inventorySnapshot.status === 'partial' ? 'partial' : 'available',
                        enabled: true,
                        configured: true,
                        checkedAt: inventorySnapshot.checkedAt || now,
                        warnings: inventorySnapshot.warnings || []
                    },
                    checkedAt: now
                }),
                sourceHealthEntry({
                    source: 'product_catalog',
                    result: { status: productStatus, enabled: true, configured: true, checkedAt: now },
                    checkedAt: now,
                    errorCode: productStatus === 'failed' ? 'product_catalog_read_failed' : ''
                }),
                sourceHealthEntry({ source: 'google_search_console', result: searchResult, checkedAt: now }),
                sourceHealthEntry({ source: 'first_party_aggregate_analytics', result: analyticsResult, checkedAt: now }),
                sourceHealthEntry({ source: 'trends', result: trendsResult, checkedAt: now }),
                sourceHealthEntry({ source: 'content_signals', result: contentSignalsResult, checkedAt: now })
            ];
            const degradesSnapshot = sourceHealth.some((health) => (
                health.enabled !== false && (
                    health.status === 'partial' ||
                    health.status === 'failed' ||
                    health.configured === false ||
                    (health.configured && health.status === 'unavailable')
                )
            ));
            const activeWarnings = (result) => result?.enabled === false ? [] : (result?.warnings || []);
            const warnings = Array.from(new Set([
                ...(inventorySnapshot.warnings || []),
                ...activeWarnings(searchResult),
                ...activeWarnings(analyticsResult),
                ...activeWarnings(trendsResult),
                ...activeWarnings(contentSignalsResult),
                ...(productStatus === 'failed' ? ['product_catalog_read_failed'] : [])
            ].map((warning) => text(warning, 120)).filter(Boolean)));
            const opportunitySignals = [
                ...(searchResult.windows || []).flatMap((window) => Object.entries(window.signals || {}).flatMap(([type, signals]) =>
                    (signals || []).slice(0, 50).map((signal) => ({
                        source: 'google_search_console',
                        windowDays: window.days,
                        type,
                        classification: 'observed',
                        evidence: signal
                    }))
                )),
                ...(trendsResult.signals || []).map((signal) => ({
                    source: 'trends',
                    type: 'trend_signal',
                    classification: signal.classification || 'observed',
                    evidence: signal
                })),
                ...(contentSignalsResult.signals || []).map((signal) => ({
                    source: 'content_signal',
                    type: signal.sourceType,
                    classification: 'observed',
                    evidence: signal
                }))
            ].slice(0, 1000);
            const sourceState = { products: currentProductState, inventory: currentInventoryState };
            const websitePerformance = buildWebsitePerformance({ searchResult, analyticsResult });
            const safeSignals = contentSignalsResult.signals || [];
            const businessSignals = {
                productChanges,
                inventoryChanges,
                campaignPriorities: safeSignals.filter((signal) => signal.sourceType === 'campaign'),
                salesQuestions: safeSignals.filter((signal) => signal.sourceType === 'sales' && signal.question),
                customerSupportQuestions: safeSignals.filter((signal) => signal.sourceType === 'customer_support' && signal.question),
                customerObjections: safeSignals.filter((signal) => signal.sourceType === 'customer_support' && signal.objection),
                seasonalSignals: trendsResult.signals || [],
                productSummary: productsSettled.status === 'fulfilled' ? {
                    total: products.length,
                    active: products.filter((product) => product.status === 'active').length,
                    available: products.filter((product) => product.availability === 'in_stock').length,
                    outOfStock: products.filter((product) => product.availability === 'out_of_stock').length
                } : null
            };
            const sourceFreshness = Object.fromEntries(sourceHealth.map((health) => [health.source, health.freshness]));
            const risks = sourceHealth
                .filter((health) => health.enabled !== false && (
                    health.status === 'failed' ||
                    health.configured === false ||
                    (health.configured && health.status === 'unavailable')
                ))
                .map((health) => ({ type: 'source_unavailable', source: health.source, errorCode: health.errorCode }));
            const stableEvidence = {
                googleIntelSnapshotId: String(resolvedGoogleId),
                inventoryContentHash: inventorySnapshot.contentHash,
                sourceState,
                websitePerformance: withoutVolatileFields(websitePerformance),
                opportunitySignals: withoutVolatileFields(opportunitySignals),
                contentSignals: withoutVolatileFields(safeSignals)
            };
            const payload = {
                ...provenance,
                snapshotDate,
                timezone: this.config.timezone,
                status: degradesSnapshot ? 'partial' : 'complete',
                googleIntelSnapshotId: resolvedGoogleId,
                contentInventorySnapshotId: inventorySnapshot._id || inventorySnapshot.id,
                sourceHealth,
                websitePerformance,
                contentInventorySummary: inventorySnapshot.summary || {},
                businessSignals,
                opportunitySignals,
                risks,
                warnings,
                sourceFreshness,
                checkedAt: now,
                contentHash: contentHashFor(stableEvidence),
                sourceState
            };
            const snapshot = await this.completeLease({ snapshotKey: lease.snapshotKey, leaseToken: lease.leaseToken, payload });
            return { snapshot: safeSnapshotView(snapshot), reused: false };
        } catch (error) {
            const errorCode = text(error?.code || 'CONTENT_OPERATIONS_BUILD_FAILED', 120);
            await this.failLease({ snapshotKey: lease.snapshotKey, leaseToken: lease.leaseToken, now, errorCode });
            error.code = errorCode;
            throw error;
        }
    }

    async ensureDailySnapshot(options) {
        return this.ensureContentOperationsSnapshotForDate(options);
    }

    static async ensureContentOperationsSnapshotForDate(options) {
        return new ContentOperationsIntelligenceService().ensureContentOperationsSnapshotForDate(options);
    }

    static async ensureDailySnapshot(options) {
        return ContentOperationsIntelligenceService.ensureContentOperationsSnapshotForDate(options);
    }
}

const createContentOperationsIntelligenceService = (options) => new ContentOperationsIntelligenceService(options);

module.exports = {
    ContentOperationsIntelligenceService,
    contentHashFor,
    createContentOperationsIntelligenceService,
    createConfiguredTrendsProvider,
    diffInventoryState,
    diffProductState,
    inventoryStateFromItems,
    isFreshSnapshot,
    productStateFromCatalog,
    safeSnapshotView,
    sourceHealthEntry,
    buildWebsitePerformance,
    readContentSignals
};
