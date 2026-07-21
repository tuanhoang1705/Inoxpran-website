'use strict'

const { Schema, model } = require('mongoose');
const { ACTIONS } = require('../config/contentOperations.config');

const contentPublishReadinessReportSchema = new Schema(
    {
        contentWorkOrderId: { type: Schema.Types.ObjectId, ref: 'ContentWorkOrder', required: true, index: true },
        unifiedContentBriefId: { type: Schema.Types.ObjectId, ref: 'UnifiedContentBrief', required: true, index: true },
        evidenceMapId: { type: Schema.Types.ObjectId, ref: 'EvidenceMap', default: null, index: true },
        blogId: { type: Schema.Types.ObjectId, ref: 'BlogPost', default: null, index: true },
        blogRevisionId: { type: Schema.Types.ObjectId, ref: 'BlogRevision', default: null, index: true },
        action: { type: String, enum: Object.values(ACTIONS), required: true, index: true },
        requestedMode: { type: String, enum: ['draft', 'publish'], default: 'draft' },
        pass: { type: Boolean, required: true, index: true },
        riskLevel: { type: String, enum: ['low', 'medium', 'high', 'critical'], required: true, index: true },
        technical: { type: Schema.Types.Mixed, default: () => ({}) },
        seo: { type: Schema.Types.Mixed, default: () => ({}) },
        content: { type: Schema.Types.Mixed, default: () => ({}) },
        images: { type: Schema.Types.Mixed, default: () => ({}) },
        links: { type: Schema.Types.Mixed, default: () => ({}) },
        structuredData: { type: Schema.Types.Mixed, default: () => ({}) },
        product: { type: Schema.Types.Mixed, default: () => ({}) },
        security: { type: Schema.Types.Mixed, default: () => ({}) },
        requiredFixes: { type: [Schema.Types.Mixed], default: [] },
        publishRecommendation: { type: String, enum: ['publish', 'draft', 'rewrite', 'maintenance'], required: true },
        autoPublishAllowed: { type: Boolean, default: false },
        checkedAt: { type: Date, required: true, index: true },
        contentHash: { type: String, required: true, trim: true, maxlength: 128, index: true }
    },
    { collection: 'ContentPublishReadinessReports', timestamps: true }
);

contentPublishReadinessReportSchema.index({ contentWorkOrderId: 1, checkedAt: -1 });

module.exports = {
    ContentPublishReadinessReport: model('ContentPublishReadinessReport', contentPublishReadinessReportSchema)
};
