'use strict'

const { Schema, model } = require('mongoose');

const evidenceEntrySchema = new Schema(
    {
        evidenceKey: { type: String, required: true, trim: true, maxlength: 160 },
        claim: { type: String, required: true, trim: true, maxlength: 3000 },
        classification: { type: String, enum: ['verified', 'inferred', 'unknown', 'conflicting'], required: true },
        sourceType: { type: String, default: '', trim: true, maxlength: 100 },
        sourceUrl: { type: String, default: '', trim: true, maxlength: 2000 },
        internalReferenceId: { type: String, default: '', trim: true, maxlength: 160 },
        productCatalogSnapshotId: { type: Schema.Types.ObjectId, ref: 'ProductCatalogSnapshot', default: null },
        checkedAt: { type: Date, required: true },
        confidence: { type: Number, default: 0, min: 0, max: 1 },
        allowedUsage: { type: String, default: '', trim: true, maxlength: 1000 },
        requiredQualification: { type: String, default: '', trim: true, maxlength: 1000 },
        status: { type: String, enum: ['usable', 'restricted', 'blocked'], required: true }
    },
    { _id: false }
);

const evidenceMapSchema = new Schema(
    {
        contentWorkOrderId: { type: Schema.Types.ObjectId, ref: 'ContentWorkOrder', required: true, index: true },
        unifiedContentBriefId: { type: Schema.Types.ObjectId, ref: 'UnifiedContentBrief', required: true, index: true },
        researchBundleId: { type: Schema.Types.ObjectId, ref: 'ResearchBundle', default: null, index: true },
        version: { type: Number, default: 1, min: 1 },
        entries: { type: [evidenceEntrySchema], default: [] },
        status: { type: String, enum: ['usable', 'restricted', 'blocked'], required: true, index: true },
        warnings: { type: [String], default: [] },
        contentHash: { type: String, required: true, trim: true, maxlength: 128, index: true }
    },
    { collection: 'EvidenceMaps', timestamps: true }
);

evidenceMapSchema.index({ contentWorkOrderId: 1, version: 1 }, { unique: true });

module.exports = {
    EvidenceEntrySchema: evidenceEntrySchema,
    EvidenceMap: model('EvidenceMap', evidenceMapSchema)
};
