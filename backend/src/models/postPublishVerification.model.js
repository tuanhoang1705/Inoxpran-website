'use strict'

const { Schema, model } = require('mongoose');

const postPublishVerificationSchema = new Schema(
    {
        blogId: { type: Schema.Types.ObjectId, ref: 'BlogPost', required: true, index: true },
        contentWorkOrderId: { type: Schema.Types.ObjectId, ref: 'ContentWorkOrder', required: true, index: true },
        blogRevisionId: { type: Schema.Types.ObjectId, ref: 'BlogRevision', default: null, index: true },
        publishReadinessReportId: { type: Schema.Types.ObjectId, ref: 'ContentPublishReadinessReport', required: true, index: true },
        expectedUrl: { type: String, required: true, trim: true, maxlength: 2000 },
        expectedRevisionHash: { type: String, required: true, trim: true, maxlength: 128 },
        pass: { type: Boolean, required: true, index: true },
        status: { type: String, enum: ['passed', 'failed'], required: true, index: true },
        httpStatus: { type: Number, default: null },
        checks: { type: Schema.Types.Mixed, default: () => ({}) },
        issues: { type: [Schema.Types.Mixed], default: [] },
        maintenanceAlertId: { type: Schema.Types.ObjectId, ref: 'ContentMaintenanceAlert', default: null },
        indexingRequested: { type: Boolean, default: false, immutable: true },
        checkedAt: { type: Date, required: true, index: true },
        contentHash: { type: String, required: true, trim: true, maxlength: 128 }
    },
    { collection: 'PostPublishVerifications', timestamps: true }
);

postPublishVerificationSchema.index(
    { blogId: 1, contentWorkOrderId: 1, expectedRevisionHash: 1 },
    { unique: true }
);

module.exports = { PostPublishVerification: model('PostPublishVerification', postPublishVerificationSchema) };
