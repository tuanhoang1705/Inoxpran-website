'use strict'

const { Schema, model } = require('mongoose');

const REVISION_ACTIONS = Object.freeze([
    'update', 'expand', 'merge', 'metadata_refresh', 'internal_link_maintenance', 'content_maintenance'
]);

const blogRevisionSchema = new Schema(
    {
        blogId: { type: Schema.Types.ObjectId, ref: 'BlogPost', required: true, index: true },
        contentWorkOrderId: { type: Schema.Types.ObjectId, ref: 'ContentWorkOrder', required: true },
        unifiedContentBriefId: { type: Schema.Types.ObjectId, ref: 'UnifiedContentBrief', required: true, index: true },
        action: { type: String, enum: REVISION_ACTIONS, required: true, index: true },
        revisionNumber: { type: Number, required: true, min: 1 },
        status: { type: String, enum: ['staged', 'approved', 'applied', 'rejected', 'superseded'], default: 'staged', index: true },
        canonicalUrl: { type: String, required: true, trim: true, maxlength: 2000 },
        baseContentHash: { type: String, required: true, trim: true, maxlength: 128 },
        proposedContentHash: { type: String, required: true, trim: true, maxlength: 128 },
        sectionChanges: { type: [Schema.Types.Mixed], default: [] },
        metadataChanges: { type: Schema.Types.Mixed, default: () => ({}) },
        internalLinkChanges: { type: [Schema.Types.Mixed], default: [] },
        factChanges: { type: [Schema.Types.Mixed], default: [] },
        mergePlan: { type: Schema.Types.Mixed, default: null },
        preservedSectionKeys: { type: [String], default: [] },
        sourceBlogIds: { type: [{ type: Schema.Types.ObjectId, ref: 'BlogPost' }], default: [] },
        redirectRecommendations: { type: [Schema.Types.Mixed], default: [] },
        autoApply: { type: Boolean, default: false, immutable: true },
        approvedBy: { type: Schema.Types.ObjectId, ref: 'Admin', default: null },
        approvedAt: { type: Date, default: null },
        appliedAt: { type: Date, default: null },
        warnings: { type: [String], default: [] },
        auditMetadata: { type: Schema.Types.Mixed, default: () => ({}) }
    },
    { collection: 'BlogRevisions', timestamps: true }
);

blogRevisionSchema.index({ blogId: 1, revisionNumber: 1 }, { unique: true });
blogRevisionSchema.index({ contentWorkOrderId: 1 }, { unique: true });
blogRevisionSchema.index({ status: 1, createdAt: -1 });

module.exports = { REVISION_ACTIONS, BlogRevision: model('BlogRevision', blogRevisionSchema) };
