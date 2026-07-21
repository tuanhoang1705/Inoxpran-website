'use strict'

const crypto = require('node:crypto');
const { BlogRevision, REVISION_ACTIONS } = require('../../models/blogRevision.model');

const FORBIDDEN_KEYS = /^(?:delete|deleted|removeBlog|unpublish|autoPublish|autoApply|applyLive|redirectApplied|replaceLiveContent)$/i;
const FORBIDDEN_OPERATION = /(?:delete|remove|unpublish|apply[_-]?(?:live|redirect)|replace[_-]?live)/i;
const METADATA_FIELDS = new Set(['title', 'seoTitle', 'seoDescription', 'ogTitle', 'ogDescription', 'canonicalUrl']);
const MAX_REVISION_ALLOCATION_ATTEMPTS = 12;

const hasForbiddenDirective = (value) => {
    if (!value || typeof value !== 'object') return false;
    return Object.entries(value).some(([key, nested]) => FORBIDDEN_KEYS.test(key)
        || (key === 'operation' && FORBIDDEN_OPERATION.test(String(nested || '')))
        || hasForbiddenDirective(nested));
};

const isValidInternalUrl = (value) => /^\/(?!\/)[A-Za-z0-9%/_~.-]*(?:\?[A-Za-z0-9%&=+_.~-]*)?$/.test(String(value || ''));

const buildStagedRevision = ({ workOrder, brief, currentBlog, changes = {}, revisionNumber } = {}) => {
    const action = String(workOrder?.decision || '');
    if (!REVISION_ACTIONS.includes(action)) throw new Error('This action does not use an additive Blog Revision');
    const blogId = currentBlog?._id || currentBlog?.id || workOrder?.targetBlogId;
    const contentWorkOrderId = workOrder?._id || workOrder?.id;
    const unifiedContentBriefId = brief?._id || brief?.id;
    const canonicalUrl = String(currentBlog?.canonicalUrl || currentBlog?.canonical || changes.canonicalUrl || '').trim();
    if (!blogId || !contentWorkOrderId || !unifiedContentBriefId || !canonicalUrl) {
        throw new Error('Persisted blog, work order, brief, and canonical URL are required');
    }
    if (hasForbiddenDirective(changes)) throw new Error('Destructive or live-apply revision directives are forbidden');
    if (changes.canonicalUrl && changes.canonicalUrl !== canonicalUrl) throw new Error('Existing canonical URL must be preserved');

    const sectionChanges = Array.isArray(changes.sectionChanges) ? changes.sectionChanges : [];
    const metadataChanges = changes.metadataChanges || {};
    const internalLinkChanges = Array.isArray(changes.internalLinkChanges) ? changes.internalLinkChanges : [];
    if (Object.prototype.hasOwnProperty.call(metadataChanges, 'canonicalUrl')
        && String(metadataChanges.canonicalUrl || '').trim() !== canonicalUrl) {
        throw new Error('Existing canonical URL must be preserved');
    }
    if (action === 'metadata_refresh') {
        if (sectionChanges.length) throw new Error('metadata_refresh cannot rewrite article sections');
        const invalidField = Object.keys(metadataChanges).find((key) => !METADATA_FIELDS.has(key));
        if (invalidField) throw new Error(`metadata_refresh cannot change ${invalidField}`);
    }
    for (const change of internalLinkChanges) {
        if (change.url && !isValidInternalUrl(change.url)) throw new Error('Internal-link revisions require valid internal URLs');
        if (change.anchor && String(change.anchor).length > 200) throw new Error('Internal-link anchor is too long');
    }
    if (action === 'merge') {
        if (!(workOrder.mergeSourceBlogIds || []).length) throw new Error('Merge revision requires source blog IDs');
        if (!changes.mergePlan) throw new Error('Merge revision requires a non-destructive merge plan');
        if (changes.mergePlan.liveDeletionAllowed === true
            || changes.mergePlan.redirectsApplied === true
            || changes.mergePlan.sourceArticlesRemainLive === false) {
            throw new Error('Merge revisions cannot delete, unpublish, or redirect live source articles');
        }
    }
    if (sectionChanges.some((change) => change?.operation === 'replace_content_in_staged_revision')) {
        throw new Error('Generic whole-content replacement is forbidden for staged revisions');
    }
    if (['update', 'expand', 'merge'].includes(action) && !sectionChanges.length) {
        throw new Error(`${action} revisions require explicit staged section operations`);
    }
    if (action === 'update' && sectionChanges.some((change) => !['update_existing_section', 'add_reviewed_section'].includes(change?.operation))) {
        throw new Error('update revisions must describe changed or additive reviewed sections');
    }
    if (action === 'expand' && sectionChanges.some((change) => change?.operation !== 'add_missing_section')) {
        throw new Error('expand revisions may only add missing sections');
    }
    if (action === 'merge' && sectionChanges.some((change) => change?.operation !== 'consolidate_into_primary_section')) {
        throw new Error('merge revisions must describe consolidation into the primary article');
    }

    const baseContentHash = currentBlog.contentHash || crypto.createHash('sha256')
        .update(String(currentBlog.contentHtml || currentBlog.content || ''))
        .digest('hex');
    const proposedContentHash = crypto.createHash('sha256').update(JSON.stringify({
        baseContentHash,
        sectionChanges,
        metadataChanges,
        internalLinkChanges,
        factChanges: changes.factChanges || [],
        mergePlan: changes.mergePlan || null
    })).digest('hex');
    const normalizedRevisionNumber = Number(revisionNumber || currentBlog.nextRevisionNumber || 1);
    if (!Number.isInteger(normalizedRevisionNumber) || normalizedRevisionNumber < 1) {
        throw new Error('Blog Revision number must be a positive integer');
    }

    return {
        blogId,
        contentWorkOrderId,
        unifiedContentBriefId,
        action,
        revisionNumber: normalizedRevisionNumber,
        status: 'staged',
        canonicalUrl,
        baseContentHash,
        proposedContentHash,
        sectionChanges,
        metadataChanges,
        internalLinkChanges,
        factChanges: Array.isArray(changes.factChanges) ? changes.factChanges : [],
        mergePlan: changes.mergePlan || null,
        preservedSectionKeys: Array.isArray(changes.preservedSectionKeys) ? changes.preservedSectionKeys : [],
        sourceBlogIds: action === 'merge' ? workOrder.mergeSourceBlogIds : [],
        redirectRecommendations: action === 'merge' && Array.isArray(changes.redirectRecommendations) ? changes.redirectRecommendations : [],
        autoApply: false,
        warnings: Array.isArray(changes.warnings) ? changes.warnings : [],
        auditMetadata: {
            liveBlogMutated: false,
            destructiveActionTaken: false,
            idempotencyKey: `content-work-order:${String(contentWorkOrderId)}`
        }
    };
};

class BlogRevisionService {
    static buildStagedRevision(input) { return buildStagedRevision(input); }
    static async stage(input, { RevisionModel = BlogRevision } = {}) {
        const baseDocument = buildStagedRevision({ ...input, revisionNumber: input?.revisionNumber || 1 });
        const workOrderFilter = { contentWorkOrderId: baseDocument.contentWorkOrderId };
        const readLean = async (query) => {
            if (!query) return null;
            return typeof query.lean === 'function' ? query.lean() : query;
        };
        const assertSameRevisionIdentity = (revision) => {
            if (!revision) return revision;
            const fields = [
                'blogId',
                'contentWorkOrderId',
                'unifiedContentBriefId',
                'action',
                'canonicalUrl',
                'baseContentHash',
                'proposedContentHash'
            ];
            const mismatch = fields.find((field) => String(revision[field] || '') !== String(baseDocument[field] || ''));
            if (mismatch) {
                const error = new Error(`Work Order revision identity mismatch: ${mismatch}`);
                error.code = 'BLOG_REVISION_IDEMPOTENCY_MISMATCH';
                error.field = mismatch;
                throw error;
            }
            return revision;
        };
        const findByWorkOrder = async () => readLean(RevisionModel.findOne(workOrderFilter));
        const findLatestNumber = async () => {
            let query = RevisionModel.findOne({ blogId: baseDocument.blogId });
            if (typeof query?.sort === 'function') query = query.sort({ revisionNumber: -1 });
            if (typeof query?.select === 'function') query = query.select('revisionNumber');
            const latest = await readLean(query);
            const value = Number(latest?.revisionNumber || 0);
            return Number.isInteger(value) && value > 0 ? value : 0;
        };

        const existing = await findByWorkOrder();
        if (existing) return assertSameRevisionIdentity(existing);

        let revisionNumber = Math.max(
            Number(baseDocument.revisionNumber || 1),
            (await findLatestNumber()) + 1
        );
        for (let attempt = 0; attempt < MAX_REVISION_ALLOCATION_ATTEMPTS; attempt += 1) {
            const document = { ...baseDocument, revisionNumber };
            try {
                const staged = await RevisionModel.findOneAndUpdate(
                    workOrderFilter,
                    { $setOnInsert: document },
                    { upsert: true, new: true, runValidators: true }
                );
                return assertSameRevisionIdentity(staged);
            } catch (error) {
                if (error?.code !== 11000) throw error;
                const racedWorkOrderRevision = await findByWorkOrder();
                if (racedWorkOrderRevision) return assertSameRevisionIdentity(racedWorkOrderRevision);
                revisionNumber = Math.max(revisionNumber + 1, (await findLatestNumber()) + 1);
            }
        }
        throw new Error('Unable to allocate a unique Blog Revision number after concurrent writes');
    }
}

module.exports = { BlogRevisionService, buildStagedRevision, hasForbiddenDirective, isValidInternalUrl };
