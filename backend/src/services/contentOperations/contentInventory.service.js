'use strict'

const crypto = require('node:crypto');
const sanitizeHtml = require('sanitize-html');
const { blog: Blog } = require('../../models/blog.model');
const { ContentInventorySnapshot } = require('../../models/contentInventorySnapshot.model');
const { ContentInventoryItem } = require('../../models/contentInventoryItem.model');
const { ProductCatalogIntelligenceService } = require('../productCatalogIntelligence.service');
const { dateInTimezone } = require('../../utils/googleIntelligence.util');
const { getContentOperationsConfig } = require('../../config/contentOperations.config');

const BLOG_SELECT = [
    '_id', 'blog_title', 'blog_slug', 'blog_excerpt', 'blog_content', 'blog_category_key', 'blog_tags',
    'sourceType', 'contentRole', 'primaryIntent', 'topicSummary', 'entitySummary', 'canonicalUrl', 'indexability',
    'lastReviewedAt', 'nextReviewAt', 'publishedAt', 'isDraft', 'isPublished', 'createdAt', 'updatedAt'
].join(' ');

const sha256 = (value) => crypto.createHash('sha256').update(String(value ?? '')).digest('hex');
const text = (value, max = 1000) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const unique = (values, max = 500) => Array.from(new Set(values.filter(Boolean))).slice(0, max);
const FINAL_SNAPSHOT_STATUSES = new Set(['complete', 'partial']);
const INVENTORY_BUILD_ERROR_CODE = 'content_inventory_build_failed';
const INVENTORY_BUILD_BUSY_CODE = 'content_inventory_build_busy';
const INVENTORY_BUILD_LEASE_LOST_CODE = 'content_inventory_build_lease_lost';

const plainText = (html) => text(sanitizeHtml(String(html || ''), {
    allowedTags: [],
    allowedAttributes: {}
}).replace(/&nbsp;/gi, ' '), 2_000_000);

const extractHeadings = (html) => {
    const headings = [];
    const pattern = /<h([2-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
    let match;
    while ((match = pattern.exec(String(html || ''))) && headings.length < 200) {
        const headingText = plainText(match[2]).slice(0, 300);
        if (headingText) headings.push({ level: Number(match[1]), text: headingText });
    }
    return headings;
};

const safeInternalPath = (href) => {
    const raw = String(href || '').trim().replace(/&amp;/gi, '&');
    if (!raw || raw.startsWith('#') || /^(?:javascript|data|vbscript|mailto|tel):/i.test(raw)) return '';
    try {
        const parsed = raw.startsWith('/') ? new URL(raw, 'https://inventory.invalid') : new URL(raw);
        if (parsed.hostname !== 'inventory.invalid' && !/(^|\.)inoxpran\.com$/i.test(parsed.hostname)) return '';
        const path = decodeURI(parsed.pathname).replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
        return /^\/(?:blog|product)\//.test(path) ? path : '';
    } catch (_error) {
        return '';
    }
};

const extractInternalLinks = (html) => {
    const links = [];
    const pattern = /<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>/gi;
    let match;
    while ((match = pattern.exec(String(html || ''))) && links.length < 1000) {
        const path = safeInternalPath(match[2]);
        if (path) links.push(path);
    }
    return unique(links);
};

const slugFromPath = (path, prefix) => {
    if (!path.startsWith(prefix)) return '';
    return text(path.slice(prefix.length).split('/')[0], 200);
};

const validDate = (value) => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};

const ageDays = (value, now) => {
    const date = validDate(value);
    return date ? Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86_400_000)) : null;
};

const reviewStatusFor = ({ blog, now, config }) => {
    const lastReviewedAt = validDate(blog.lastReviewedAt);
    const basis = lastReviewedAt || validDate(blog.updatedAt);
    const age = ageDays(basis, now);
    if (age === null) return 'unknown';
    if (age >= config.staleDays) return 'stale';
    const nextReviewAt = validDate(blog.nextReviewAt);
    if ((nextReviewAt && nextReviewAt <= now) || age >= config.reviewDays || !lastReviewedAt) return 'review_due';
    return 'current';
};

const productEvidenceHash = (product) => sha256(JSON.stringify({
    productId: text(product?.productId, 100),
    slug: text(product?.slug, 200),
    status: text(product?.status, 40),
    availability: text(product?.availability, 40),
    updatedAt: product?.updatedAt || null,
    verifiedFeatures: Array.isArray(product?.verifiedFeatures) ? product.verifiedFeatures : [],
    verifiedSpecifications: Array.isArray(product?.verifiedSpecifications) ? product.verifiedSpecifications : []
}));

const buildBaseItem = ({ blog, productBySlug, now, config }) => {
    const body = String(blog.blog_content || '');
    const cleanBody = plainText(body);
    const wordCount = cleanBody ? cleanBody.split(/\s+/u).filter(Boolean).length : 0;
    const headings = extractHeadings(body);
    const outboundLinks = extractInternalLinks(body);
    const outboundBlogSlugs = unique(outboundLinks.map((path) => slugFromPath(path, '/blog/')));
    const linkedProductSlugs = unique(outboundLinks.map((path) => slugFromPath(path, '/product/')));
    const linkedProducts = linkedProductSlugs.map((slug) => productBySlug.get(slug)).filter(Boolean);
    const missingProductSlugs = linkedProductSlugs.filter((slug) => !productBySlug.has(slug));
    const staleProductSlugs = linkedProducts
        .filter((product) => {
            const days = ageDays(product.updatedAt, now);
            return days === null || days >= config.reviewDays;
        })
        .map((product) => product.slug);
    const inactiveProductSlugs = linkedProducts
        .filter((product) => product.status !== 'active' || product.availability === 'out_of_stock')
        .map((product) => product.slug);
    const reviewStatus = reviewStatusFor({ blog, now, config });
    const slug = text(blog.blog_slug, 200);
    const canonicalUrl = text(blog.canonicalUrl, 1000) || (slug ? `/blog/${encodeURIComponent(slug)}` : '');
    const warnings = [];
    if (!blog.lastReviewedAt) warnings.push('review_date_missing');
    if (reviewStatus === 'review_due') warnings.push('review_due');
    if (reviewStatus === 'stale') warnings.push('content_stale');
    if (missingProductSlugs.length) warnings.push('broken_product_link');
    if (inactiveProductSlugs.length) warnings.push('inactive_product_link');
    if (staleProductSlugs.length) warnings.push('stale_product_evidence');
    if (!outboundBlogSlugs.length) warnings.push('no_outbound_blog_links');
    if (wordCount < config.thinWordThreshold) warnings.push('thin_content');
    const historicalYears = [...cleanBody.matchAll(/\b(20\d{2})\b/g)]
        .map((match) => Number(match[1]))
        .filter((year) => year < now.getUTCFullYear() - 2);
    if (historicalYears.length && reviewStatus !== 'current') warnings.push('outdated_statistic_candidate');

    const headingFingerprint = headings.map((heading) => `${heading.level}:${heading.text.toLocaleLowerCase('vi')}`);
    const structuralFingerprint = sha256(JSON.stringify({
        headings: headingFingerprint,
        wordCount,
        outboundBlogSlugs,
        linkedProductSlugs
    }));
    const contentHash = sha256(JSON.stringify({
        title: text(blog.blog_title, 300),
        slug,
        excerpt: text(blog.blog_excerpt, 1000),
        cleanBody,
        updatedAt: validDate(blog.updatedAt)?.toISOString() || null,
        productEvidence: linkedProducts.map(productEvidenceHash).sort()
    }));
    const productCheckedDates = linkedProducts.map((product) => validDate(product.updatedAt)).filter(Boolean);
    const oldestProductDate = productCheckedDates.length
        ? new Date(Math.min(...productCheckedDates.map((date) => date.getTime())))
        : null;

    return {
        blogId: blog._id,
        canonicalUrl,
        title: text(blog.blog_title, 300),
        slug,
        status: blog.isPublished && !blog.isDraft ? 'published' : blog.isDraft ? 'draft' : 'inactive',
        category: text(blog.blog_category_key, 120),
        articleType: text(blog.contentRole || blog.blog_category_key, 120),
        contentRole: text(blog.contentRole, 120),
        primaryIntent: text(blog.primaryIntent, 120),
        topicSummary: text(blog.topicSummary || [blog.blog_title, ...(blog.blog_tags || [])].join(' | '), 1000),
        entitySummary: unique([...(blog.entitySummary || []), ...(blog.blog_tags || [])].map((item) => text(item, 160)), 50),
        sourceType: text(blog.sourceType || 'manual', 40),
        articleCreatedAt: validDate(blog.createdAt),
        publishedAt: validDate(blog.publishedAt),
        articleUpdatedAt: validDate(blog.updatedAt),
        lastReviewedAt: validDate(blog.lastReviewedAt),
        nextReviewAt: validDate(blog.nextReviewAt),
        wordCount,
        headingSummary: headings,
        inboundLinkCount: 0,
        outboundLinks,
        outboundBlogSlugs,
        linkedProductIds: unique(linkedProducts.map((product) => text(product.productId, 100))),
        linkedProductSlugs,
        performanceSummary: null,
        productDataFreshness: linkedProductSlugs.length ? {
            status: missingProductSlugs.length ? 'unavailable' : staleProductSlugs.length ? 'stale' : 'current',
            oldestCheckedAt: oldestProductDate,
            missingProductSlugs,
            staleProductSlugs
        } : null,
        claimFreshness: linkedProductSlugs.length ? {
            status: missingProductSlugs.length || inactiveProductSlugs.length ? 'review_required' : 'current',
            inactiveProductSlugs
        } : null,
        indexability: blog.indexability && typeof blog.indexability === 'object'
            ? {
                index: blog.indexability.index !== false,
                follow: blog.indexability.follow !== false,
                determinable: Boolean(blog.indexability.determinable)
            }
            : { index: true, follow: true, determinable: false },
        reviewStatus,
        structuralFingerprint,
        contentHash,
        warnings
    };
};

const buildInventory = ({ blogs = [], safeProducts = [], now = new Date(), config = {} } = {}) => {
    const effectiveConfig = { staleDays: 180, reviewDays: 90, thinWordThreshold: 300, ...config };
    const productBySlug = new Map(
        safeProducts
            .filter((product) => text(product?.slug, 200))
            .map((product) => [text(product.slug, 200), product])
    );
    const slugSet = new Set(blogs.map((blog) => text(blog.blog_slug, 200)).filter(Boolean));
    const items = blogs.map((blog) => buildBaseItem({ blog, productBySlug, now, config: effectiveConfig }));
    const inboundCounts = new Map();
    items.forEach((item) => item.outboundBlogSlugs.forEach((slug) => {
        inboundCounts.set(slug, (inboundCounts.get(slug) || 0) + 1);
    }));
    items.forEach((item) => {
        item.inboundLinkCount = inboundCounts.get(item.slug) || 0;
        const brokenBlogLinks = item.outboundBlogSlugs.filter((slug) => !slugSet.has(slug));
        if (brokenBlogLinks.length) item.warnings.push('broken_blog_link');
        if (item.status === 'published' && item.inboundLinkCount === 0) item.warnings.push('orphan_content');
        item.warnings = unique(item.warnings, 50);
        delete item.outboundBlogSlugs;
    });
    const intentGroups = new Map();
    items.forEach((item) => {
        const intentKey = text(item.primaryIntent || item.topicSummary || item.title, 300).toLocaleLowerCase('vi');
        if (!intentKey) return;
        const group = intentGroups.get(intentKey) || [];
        group.push(item);
        intentGroups.set(intentKey, group);
    });
    intentGroups.forEach((group) => {
        if (group.length < 2) return;
        group.forEach((item) => {
            item.warnings = unique([...item.warnings, 'duplicate_intent_candidate'], 50);
        });
    });
    const summary = {
        total: items.length,
        totalPublished: items.filter((item) => item.status === 'published').length,
        totalDrafts: items.filter((item) => item.status === 'draft').length,
        staleArticles: items.filter((item) => item.reviewStatus === 'stale').length,
        reviewDueArticles: items.filter((item) => item.reviewStatus === 'review_due').length,
        missingReviewDate: items.filter((item) => item.warnings.includes('review_date_missing')).length,
        orphanArticles: items.filter((item) => item.warnings.includes('orphan_content')).length,
        weakInternalLinkArticles: items.filter((item) => item.warnings.includes('no_outbound_blog_links')).length,
        outdatedProductReferences: items.filter((item) => (
            item.warnings.includes('stale_product_evidence') ||
            item.warnings.includes('inactive_product_link') ||
            item.warnings.includes('broken_product_link')
        )).length,
        brokenLinks: items.filter((item) => item.warnings.includes('broken_blog_link') || item.warnings.includes('broken_product_link')).length,
        thinArticles: items.filter((item) => item.warnings.includes('thin_content')).length,
        duplicateIntentCandidates: items.filter((item) => item.warnings.includes('duplicate_intent_candidate')).length,
        outdatedStatisticCandidates: items.filter((item) => item.warnings.includes('outdated_statistic_candidate')).length
    };
    const contentHash = sha256(JSON.stringify(items
        .map((item) => ({
            blogId: String(item.blogId),
            contentHash: item.contentHash,
            structuralFingerprint: item.structuralFingerprint,
            inboundLinkCount: item.inboundLinkCount,
            warnings: item.warnings
        }))
        .sort((left, right) => left.blogId.localeCompare(right.blogId))));
    return { items, summary, contentHash };
};

const leanQuery = async (query) => typeof query?.lean === 'function' ? query.lean() : query;

class ContentInventoryService {
    constructor({
        BlogModel = Blog,
        SnapshotModel = ContentInventorySnapshot,
        ItemModel = ContentInventoryItem,
        productCatalogService = ProductCatalogIntelligenceService,
        config = getContentOperationsConfig(),
        now = () => new Date()
    } = {}) {
        this.BlogModel = BlogModel;
        this.SnapshotModel = SnapshotModel;
        this.ItemModel = ItemModel;
        this.productCatalogService = productCatalogService;
        this.config = config;
        this.now = now;
    }

    async readSnapshot(filter, { internal = false } = {}) {
        let query = this.SnapshotModel.findOne(filter);
        if (internal && typeof query?.select === 'function') {
            query = query.select('+buildToken +buildGeneration +leaseUntil');
        }
        return leanQuery(query);
    }

    async acquireBuildLease({ snapshotKey, existing, now }) {
        const buildToken = crypto.randomUUID();
        const leaseMs = Number(this.config.leaseMs) || 10 * 60 * 1000;
        const leaseUntil = new Date(now.getTime() + leaseMs);
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
                ...snapshotKey,
                checkedAt: now,
                contentHash: sha256(`${snapshotKey.snapshotDate}:building`)
            },
            $set: {
                status: 'building',
                buildToken,
                leaseUntil,
                itemCount: 0,
                warnings: [],
                errorCodes: []
            },
            $inc: { buildGeneration: 1 }
        };
        let claimed = null;
        try {
            let query = this.SnapshotModel.findOneAndUpdate(filter, update, {
                upsert: !existing,
                new: true,
                setDefaultsOnInsert: true
            });
            if (typeof query?.select === 'function') {
                query = query.select('+buildToken +buildGeneration +leaseUntil');
            }
            claimed = await query;
        } catch (error) {
            if (error?.code !== 11000) throw error;
        }
        if (!claimed) {
            const error = new Error(INVENTORY_BUILD_BUSY_CODE);
            error.code = INVENTORY_BUILD_BUSY_CODE;
            throw error;
        }
        return {
            buildToken,
            buildGeneration: Number(claimed.buildGeneration || existing?.buildGeneration || 0) || 1,
            leaseUntil,
            snapshotId: claimed._id || existing?._id
        };
    }

    async renewBuildLease({ snapshotKey, lease, heartbeatAt = this.now() }) {
        const leaseMs = Number(this.config.leaseMs) || 10 * 60 * 1000;
        const leaseUntil = new Date(heartbeatAt.getTime() + leaseMs);
        let query = this.SnapshotModel.findOneAndUpdate(
            {
                ...snapshotKey,
                status: 'building',
                buildToken: lease.buildToken,
                buildGeneration: lease.buildGeneration
            },
            { $set: { leaseUntil } },
            { new: true }
        );
        if (typeof query?.select === 'function') query = query.select('+buildToken +buildGeneration +leaseUntil');
        const renewed = await query;
        if (!renewed) {
            const error = new Error(INVENTORY_BUILD_LEASE_LOST_CODE);
            error.code = INVENTORY_BUILD_LEASE_LOST_CODE;
            throw error;
        }
        lease.leaseUntil = leaseUntil;
        return renewed;
    }

    async assertBuildLease({ snapshotKey, lease }) {
        const current = await this.readSnapshot({
            ...snapshotKey,
            status: 'building',
            buildToken: lease.buildToken,
            buildGeneration: lease.buildGeneration,
            leaseUntil: { $gt: this.now() }
        }, { internal: true });
        if (!current) {
            const error = new Error(INVENTORY_BUILD_LEASE_LOST_CODE);
            error.code = INVENTORY_BUILD_LEASE_LOST_CODE;
            throw error;
        }
        return current;
    }

    async completeBuild({ snapshotKey, lease, payload }) {
        const snapshot = await this.SnapshotModel.findOneAndUpdate(
            {
                ...snapshotKey,
                status: 'building',
                buildToken: lease.buildToken,
                buildGeneration: lease.buildGeneration
            },
            {
                $set: payload,
                $unset: { buildToken: '', leaseUntil: '' }
            },
            { new: true, runValidators: true }
        );
        if (!snapshot) {
            const error = new Error(INVENTORY_BUILD_LEASE_LOST_CODE);
            error.code = INVENTORY_BUILD_LEASE_LOST_CODE;
            throw error;
        }
        return snapshot;
    }

    async failBuild({ snapshotKey, lease, now, errorCode }) {
        if (!lease) return null;
        return this.SnapshotModel.findOneAndUpdate(
            {
                ...snapshotKey,
                status: 'building',
                buildToken: lease.buildToken,
                buildGeneration: lease.buildGeneration
            },
            {
                $set: {
                    status: 'failed',
                    warnings: ['inventory_build_failed'],
                    errorCodes: [errorCode],
                    checkedAt: now
                },
                $unset: { buildToken: '', leaseUntil: '' }
            },
            { new: true, runValidators: true }
        );
    }

    async readBlogs() {
        let query = this.BlogModel.find({});
        if (typeof query.select === 'function') query = query.select(BLOG_SELECT);
        if (typeof query.limit === 'function') query = query.limit(this.config.inventory.maxItems);
        return leanQuery(query);
    }

    async ensureSnapshotForDate({ now = this.now(), force = false } = {}) {
        const snapshotDate = dateInTimezone(now, this.config.timezone);
        const snapshotKey = { snapshotDate, timezone: this.config.timezone };
        let lease = null;
        let heartbeatTimer = null;
        let heartbeatError = null;
        try {
            const existing = await this.readSnapshot(snapshotKey, { internal: true });
            lease = await this.acquireBuildLease({ snapshotKey, existing, now });
            const heartbeatMs = Math.max(1000, Math.floor((Number(this.config.leaseMs) || 10 * 60 * 1000) / 3));
            heartbeatTimer = setInterval(() => {
                this.renewBuildLease({ snapshotKey, lease }).catch((error) => {
                    heartbeatError = error;
                });
            }, heartbeatMs);
            heartbeatTimer.unref?.();

            const [blogs, safeProducts] = await Promise.all([
                this.readBlogs(),
                this.productCatalogService.readSafeCatalog()
            ]);
            if (heartbeatError) throw heartbeatError;
            await this.assertBuildLease({ snapshotKey, lease });

            const sourceBlogs = Array.isArray(blogs) ? blogs : [];
            const sourceProducts = Array.isArray(safeProducts) ? safeProducts : [];
            const inventory = buildInventory({
                blogs: sourceBlogs,
                safeProducts: sourceProducts,
                now,
                config: this.config.inventory
            });
            const truncated = sourceBlogs.length >= this.config.inventory.maxItems;
            const snapshotPayload = {
                snapshotDate,
                timezone: this.config.timezone,
                status: truncated ? 'partial' : 'complete',
                itemCount: inventory.items.length,
                summary: { ...inventory.summary, truncated },
                sourceFreshness: {
                    blogsCheckedAt: now,
                    productsCheckedAt: now
                },
                warnings: truncated ? ['inventory_limit_reached'] : [],
                errorCodes: [],
                checkedAt: now,
                contentHash: inventory.contentHash
            };
            const existingCheckedAt = validDate(existing?.checkedAt);
            const fresh = existingCheckedAt && now.getTime() - existingCheckedAt.getTime() <= this.config.inventory.maxAgeHours * 3_600_000;
            if (
                !force &&
                FINAL_SNAPSHOT_STATUSES.has(existing?.status) &&
                existing?.contentHash === inventory.contentHash &&
                fresh
            ) {
                const snapshot = await this.completeBuild({ snapshotKey, lease, payload: snapshotPayload });
                return {
                    snapshot: typeof snapshot?.toObject === 'function' ? snapshot.toObject() : snapshot,
                    items: inventory.items,
                    reused: true
                };
            }

            const snapshotId = lease.snapshotId || existing?._id;
            if (!snapshotId) throw new Error(INVENTORY_BUILD_ERROR_CODE);

            if (inventory.items.length) {
                await this.ItemModel.bulkWrite(inventory.items.map((item) => ({
                    updateOne: {
                        filter: {
                            snapshotId,
                            blogId: item.blogId,
                            $or: [
                                { buildGeneration: { $exists: false } },
                                { buildGeneration: { $lte: lease.buildGeneration } }
                            ]
                        },
                        update: { $set: { ...item, snapshotId, buildGeneration: lease.buildGeneration } },
                        upsert: true
                    }
                })), { ordered: false });
            }

            if (heartbeatError) throw heartbeatError;
            await this.assertBuildLease({ snapshotKey, lease });
            await this.ItemModel.deleteMany({
                snapshotId,
                $or: [
                    { buildGeneration: { $exists: false } },
                    { buildGeneration: { $lt: lease.buildGeneration } }
                ]
            });

            if (heartbeatError) throw heartbeatError;
            await this.assertBuildLease({ snapshotKey, lease });
            const snapshot = await this.completeBuild({ snapshotKey, lease, payload: snapshotPayload });

            return {
                snapshot: typeof snapshot?.toObject === 'function' ? snapshot.toObject() : snapshot,
                items: inventory.items,
                reused: false
            };
        } catch (cause) {
            const errorCode = [INVENTORY_BUILD_BUSY_CODE, INVENTORY_BUILD_LEASE_LOST_CODE].includes(cause?.code)
                ? cause.code
                : INVENTORY_BUILD_ERROR_CODE;
            try {
                if (errorCode !== INVENTORY_BUILD_BUSY_CODE) {
                    await this.failBuild({ snapshotKey, lease, now, errorCode });
                }
            } catch (_markFailedError) {
                // The caller receives a bounded error code; storage failures are never persisted verbatim.
            }
            const error = new Error(errorCode);
            error.code = errorCode;
            throw error;
        } finally {
            if (heartbeatTimer) clearInterval(heartbeatTimer);
        }
    }
}

const createContentInventoryService = (options) => new ContentInventoryService(options);

module.exports = {
    BLOG_SELECT,
    ContentInventoryService,
    buildInventory,
    createContentInventoryService,
    extractHeadings,
    extractInternalLinks,
    plainText,
    productEvidenceHash,
    reviewStatusFor,
    safeInternalPath
};
