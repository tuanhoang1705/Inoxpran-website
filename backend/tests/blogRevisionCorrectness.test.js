import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { BlogRevisionService, buildStagedRevision } = require('../src/services/contentOperations/blogRevision.service');
const AutomationSeoBlogService = require('../src/services/automationSeoBlog.service');
const { buildLlmDraftMessages, buildRevisionWritingContext } = require('../src/services/agenticBlogCore.service');

const ids = Object.freeze({
    blog: '507f1f77bcf86cd799439101',
    source: '507f1f77bcf86cd799439102',
    workOrder: '507f1f77bcf86cd799439103',
    otherWorkOrder: '507f1f77bcf86cd799439104',
    brief: '507f1f77bcf86cd799439105'
});

describe('Content Operations blog lifecycle metadata', () => {
    it('persists canonical intent, review dates and a non-legacy draft lifecycle', () => {
        const now = new Date('2026-07-20T12:00:00.000Z');
        const metadata = AutomationSeoBlogService.buildBlogLifecycleMetadata({
            brief: {
                topic: 'Cách chọn nồi inox an toàn',
                contentRole: 'customer_education',
                primarySearchIntent: 'informational',
                requiredEntities: ['Inox 304', 'bếp từ', 'Inox 304']
            },
            slug: 'cach-chon-noi-inox-an-toan',
            shouldPublish: false,
            readinessReviewed: true,
            readinessPassed: true,
            reviewDays: 90,
            now
        });

        expect(metadata).toMatchObject({
            contentRole: 'customer_education',
            primaryIntent: 'informational',
            topicSummary: 'Cách chọn nồi inox an toàn',
            entitySummary: ['Inox 304', 'bếp từ'],
            canonicalUrl: 'https://inoxpran.com/blog/cach-chon-noi-inox-an-toan',
            indexability: { index: false, follow: false, determinable: true },
            lifecycleStatus: 'ready',
            lastReviewedAt: now
        });
        expect(metadata.nextReviewAt.toISOString()).toBe('2026-10-18T12:00:00.000Z');
    });

    it('keeps legacy writes untouched when no unified brief is attached', () => {
        expect(AutomationSeoBlogService.buildBlogLifecycleMetadata({ slug: 'legacy' })).toEqual({});
    });
});

const baseInput = (overrides = {}) => ({
    workOrder: { _id: ids.workOrder, decision: 'update', targetBlogId: ids.blog },
    brief: { _id: ids.brief },
    currentBlog: {
        _id: ids.blog,
        canonicalUrl: 'https://inoxpran.com/blog/primary',
        contentHtml: '<article><p>Current article.</p></article>'
    },
    changes: {
        sectionChanges: [{
            operation: 'update_existing_section',
            sectionKey: 'article-introduction',
            proposedContentHtml: '<p>Proposed article.</p>'
        }]
    },
    ...overrides
});

const queryFor = (resolveValue) => {
    let sort = null;
    const query = {
        sort(value) { sort = value; return query; },
        select() { return query; },
        lean() { return Promise.resolve(resolveValue(sort)); }
    };
    return query;
};

class RacingRevisionModel {
    static documents = [];
    static collideOnce = true;
    static writes = 0;

    static reset() {
        this.documents = [];
        this.collideOnce = true;
        this.writes = 0;
    }

    static findOne(filter) {
        return queryFor((sort) => {
            const matches = this.documents.filter((document) => Object.entries(filter).every(([key, value]) => String(document[key]) === String(value)));
            if (sort?.revisionNumber === -1) return [...matches].sort((a, b) => b.revisionNumber - a.revisionNumber)[0] || null;
            return matches[0] || null;
        });
    }

    static async findOneAndUpdate(filter, update) {
        this.writes += 1;
        const existing = this.documents.find((document) => String(document.contentWorkOrderId) === String(filter.contentWorkOrderId));
        if (existing) return existing;
        const document = { _id: `revision-${this.writes}`, ...update.$setOnInsert };
        if (this.collideOnce) {
            this.collideOnce = false;
            this.documents.push({
                ...document,
                _id: 'other-revision',
                contentWorkOrderId: ids.otherWorkOrder
            });
            const error = new Error('duplicate blog/revision number');
            error.code = 11000;
            throw error;
        }
        this.documents.push(document);
        return document;
    }
}

describe('Blog revision correctness', () => {
    it('preserves canonical identity even when a nested metadata change tries to override it', () => {
        expect(() => buildStagedRevision(baseInput({
            changes: { metadataChanges: { canonicalUrl: 'https://example.com/hijack' } }
        }))).toThrow(/canonical URL must be preserved/i);

        expect(() => buildStagedRevision(baseInput({
            changes: { autoApply: true }
        }))).toThrow(/forbidden/i);
        expect(() => buildStagedRevision(baseInput({
            changes: { sectionChanges: [{ operation: 'delete_section', sectionKey: 'care' }] }
        }))).toThrow(/forbidden/i);
    });

    it('allocates around a concurrent revision-number collision and is idempotent per WorkOrder', async () => {
        RacingRevisionModel.reset();
        const first = await BlogRevisionService.stage(baseInput(), { RevisionModel: RacingRevisionModel });
        expect(first.contentWorkOrderId).toBe(ids.workOrder);
        expect(first.revisionNumber).toBe(2);
        expect(RacingRevisionModel.documents.find((item) => item._id === 'other-revision')?.contentWorkOrderId).toBe(ids.otherWorkOrder);

        const replay = await BlogRevisionService.stage(baseInput(), { RevisionModel: RacingRevisionModel });
        expect(replay._id).toBe(first._id);
        expect(RacingRevisionModel.documents).toHaveLength(2);
    });

    it('rejects a WorkOrder replay when the proposal, base content, or canonical identity changed', async () => {
        RacingRevisionModel.reset();
        await BlogRevisionService.stage(baseInput(), { RevisionModel: RacingRevisionModel });

        await expect(BlogRevisionService.stage(baseInput({
            changes: {
                sectionChanges: [{
                    operation: 'update_existing_section',
                    sectionKey: 'article-introduction',
                    proposedContentHtml: '<p>Conflicting proposal.</p>'
                }]
            }
        }), { RevisionModel: RacingRevisionModel })).rejects.toMatchObject({
            code: 'BLOG_REVISION_IDEMPOTENCY_MISMATCH',
            field: 'proposedContentHash'
        });

        await expect(BlogRevisionService.stage(baseInput({
            currentBlog: {
                _id: ids.blog,
                canonicalUrl: 'https://inoxpran.com/blog/primary',
                contentHtml: '<article><p>Changed live base.</p></article>'
            }
        }), { RevisionModel: RacingRevisionModel })).rejects.toMatchObject({
            code: 'BLOG_REVISION_IDEMPOTENCY_MISMATCH',
            field: 'baseContentHash'
        });

        await expect(BlogRevisionService.stage(baseInput({
            currentBlog: {
                _id: ids.blog,
                canonicalUrl: 'https://inoxpran.com/blog/renamed-primary',
                contentHtml: '<article><p>Current article.</p></article>'
            }
        }), { RevisionModel: RacingRevisionModel })).rejects.toMatchObject({
            code: 'BLOG_REVISION_IDEMPOTENCY_MISMATCH',
            field: 'canonicalUrl'
        });

        expect(RacingRevisionModel.documents).toHaveLength(2);
    });

    it('records update diffs, additive expansion, and merge consolidation without a whole-live replacement', () => {
        const currentHtml = '<article><p>Stable intro.</p><h2>Keep</h2><p>Same.</p><h2>Change</h2><p>Old.</p></article>';
        const updateHtml = '<article><p>Stable intro.</p><h2>Keep</h2><p>Same.</p><h2>Change</h2><p>New.</p></article>';
        const update = AutomationSeoBlogService.buildRevisionSectionChanges({ action: 'update', currentHtml, proposedHtml: updateHtml });
        expect(update.sectionChanges).toHaveLength(1);
        expect(update.sectionChanges[0]).toMatchObject({ operation: 'update_existing_section', proposedContentHtml: '<h2>Change</h2><p>New.</p>' });

        const expandHtml = '<article><p>Reworded intro is ignored.</p><h2>Keep</h2><p>Reworded.</p><h2>Change</h2><p>Old.</p><h2>Missing topic</h2><p>Additive.</p></article>';
        const expand = AutomationSeoBlogService.buildRevisionSectionChanges({ action: 'expand', currentHtml, proposedHtml: expandHtml });
        expect(expand.sectionChanges).toEqual([
            expect.objectContaining({ operation: 'add_missing_section', proposedContentHtml: '<h2>Missing topic</h2><p>Additive.</p>' })
        ]);
        expect(expand.warnings).toContain('writer_changes_to_existing_sections_ignored_for_expand');

        const merge = AutomationSeoBlogService.buildRevisionSectionChanges({
            action: 'merge', currentHtml, proposedHtml: updateHtml, primaryBlogId: ids.blog, sourceBlogIds: [ids.source]
        });
        expect(merge.sectionChanges.length).toBeGreaterThan(1);
        expect(merge.sectionChanges.every((change) => change.operation === 'consolidate_into_primary_section')).toBe(true);
        expect(JSON.stringify(merge.sectionChanges)).not.toMatch(/replace_content_in_staged_revision/);
    });

    it('gives the writer bounded primary/source context with action-specific preservation rules', () => {
        const primary = { _id: ids.blog, blog_title: 'Primary', blog_slug: 'primary', blog_content: `<article>${'P'.repeat(12_000)}</article>` };
        const source = { _id: ids.source, blog_title: 'Source', blog_slug: 'source', blog_content: `<article>${'S'.repeat(12_000)}</article>` };
        const revisionContext = buildRevisionWritingContext({ action: 'merge', primaryArticle: primary, sourceArticles: [source] });
        expect(revisionContext.primaryArticle.contentHtml.length).toBeLessThanOrEqual(8_000);
        expect(revisionContext.sourceArticles[0].contentHtml.length).toBeLessThanOrEqual(8_000);
        expect(revisionContext.preservationInstructions.join(' ')).toMatch(/primary article is the only canonical destination/i);
        expect(revisionContext.preservationInstructions.join(' ')).toMatch(/source articles remain live/i);

        const messages = buildLlmDraftMessages({
            topic: 'Primary update', primaryKeyword: 'primary', secondaryKeywords: [], articleType: 'existing-article-update',
            style: {}, headingCount: 4, language: 'vi', tone: 'practical', revisionContext
        });
        const payload = JSON.parse(messages[1].content);
        expect(payload.revisionContext.primaryArticle.id).toBe(ids.blog);
        expect(messages[0].content).toMatch(/REVISION SAFETY/);
    });
});
