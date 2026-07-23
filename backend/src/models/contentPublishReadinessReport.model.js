'use strict'

const { Schema, model } = require('mongoose');
const { ACTIONS } = require('../config/contentOperations.config');

const contentPublishReadinessReportSchema = new Schema(
    {
        isQaTest: { type: Boolean, default: false, index: true },
        qaBatchId: { type: Schema.Types.ObjectId, ref: 'AgenticBlogQaBatch', default: null, index: true },
        qaCaseId: { type: Schema.Types.ObjectId, ref: 'AgenticBlogQaCase', default: null, index: true },
        environment: { type: String, enum: ['', 'local', 'staging'], default: '' },
        executionMode: { type: String, enum: ['', 'run_now', 'schedule_run_now', 'actual_schedule'], default: '' },
        originalTopicSeed: { type: String, default: '', maxlength: 300 },
        normalizedTopicKey: { type: String, default: '', maxlength: 320 },
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
contentPublishReadinessReportSchema.index({ qaBatchId: 1, qaCaseId: 1 }, { name: 'qa_publish_readiness_report' });

module.exports = {
    ContentPublishReadinessReport: model('ContentPublishReadinessReport', contentPublishReadinessReportSchema)
};
