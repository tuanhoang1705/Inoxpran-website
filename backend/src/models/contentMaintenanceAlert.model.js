'use strict'

const { Schema, model } = require('mongoose');

const contentMaintenanceAlertSchema = new Schema(
    {
        blogId: { type: Schema.Types.ObjectId, ref: 'BlogPost', required: true, index: true },
        contentWorkOrderId: { type: Schema.Types.ObjectId, ref: 'ContentWorkOrder', default: null, index: true },
        postPublishVerificationId: { type: Schema.Types.ObjectId, ref: 'PostPublishVerification', default: null, index: true },
        type: { type: String, enum: ['technical_verification', 'broken_link', 'broken_image', 'canonical', 'renderer', 'product_reference', 'structured_data', 'other'], required: true, index: true },
        severity: { type: String, enum: ['low', 'medium', 'high', 'critical'], required: true, index: true },
        status: { type: String, enum: ['open', 'acknowledged', 'resolved', 'dismissed'], default: 'open', index: true },
        summary: { type: String, required: true, trim: true, maxlength: 500 },
        issues: { type: [Schema.Types.Mixed], default: [] },
        detectedAt: { type: Date, required: true, index: true },
        resolvedAt: { type: Date, default: null },
        resolutionNote: { type: String, default: '', trim: true, maxlength: 2000 },
        idempotencyKey: { type: String, required: true, unique: true, maxlength: 256 }
    },
    { collection: 'ContentMaintenanceAlerts', timestamps: true }
);

contentMaintenanceAlertSchema.index({ status: 1, severity: -1, detectedAt: -1 });

module.exports = { ContentMaintenanceAlert: model('ContentMaintenanceAlert', contentMaintenanceAlertSchema) };
