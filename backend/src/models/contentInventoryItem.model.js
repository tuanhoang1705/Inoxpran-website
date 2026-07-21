'use strict'

const { Schema, model } = require('mongoose');

const inventoryItemSchema = new Schema(
    {
        snapshotId: { type: Schema.Types.ObjectId, ref: 'ContentInventorySnapshot', required: true, index: true },
        blogId: { type: Schema.Types.ObjectId, ref: 'BlogPost', required: true, index: true },
        buildGeneration: { type: Number, default: 0, min: 0, select: false },
        canonicalUrl: { type: String, default: '', maxlength: 1000 },
        title: { type: String, required: true, maxlength: 300 },
        slug: { type: String, required: true, maxlength: 200 },
        status: { type: String, enum: ['draft', 'published', 'inactive'], default: 'draft', index: true },
        category: { type: String, default: '', maxlength: 120 },
        articleType: { type: String, default: '', maxlength: 120 },
        contentRole: { type: String, default: '', maxlength: 120 },
        primaryIntent: { type: String, default: '', maxlength: 120 },
        topicSummary: { type: String, default: '', maxlength: 1000 },
        entitySummary: { type: [String], default: [] },
        sourceType: { type: String, default: 'manual', maxlength: 40 },
        articleCreatedAt: { type: Date, default: null },
        publishedAt: { type: Date, default: null },
        articleUpdatedAt: { type: Date, default: null, index: true },
        lastReviewedAt: { type: Date, default: null },
        nextReviewAt: { type: Date, default: null },
        wordCount: { type: Number, default: 0, min: 0 },
        headingSummary: { type: [Schema.Types.Mixed], default: [] },
        inboundLinkCount: { type: Number, default: 0, min: 0 },
        outboundLinks: { type: [String], default: [] },
        linkedProductIds: { type: [String], default: [] },
        linkedProductSlugs: { type: [String], default: [] },
        performanceSummary: { type: Schema.Types.Mixed, default: null },
        productDataFreshness: { type: Schema.Types.Mixed, default: null },
        claimFreshness: { type: Schema.Types.Mixed, default: null },
        indexability: { type: Schema.Types.Mixed, default: () => ({ index: true, follow: true, determinable: false }) },
        reviewStatus: { type: String, enum: ['current', 'review_due', 'stale', 'unknown'], default: 'unknown', index: true },
        structuralFingerprint: { type: String, required: true, index: true },
        contentHash: { type: String, required: true, index: true },
        warnings: { type: [String], default: [] }
    },
    { collection: 'ContentInventoryItems', timestamps: true }
);

inventoryItemSchema.index({ snapshotId: 1, blogId: 1 }, { unique: true });
inventoryItemSchema.index({ snapshotId: 1, slug: 1 });
inventoryItemSchema.index({ snapshotId: 1, buildGeneration: 1 });

module.exports = {
    ContentInventoryItem: model('ContentInventoryItem', inventoryItemSchema)
};
