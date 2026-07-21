'use strict'

const { Schema, model } = require('mongoose');

const contentOperationsAuditLogSchema = new Schema(
    {
        category: { type: String, default: 'content_operations', index: true },
        action: { type: String, required: true, trim: true, maxlength: 160, index: true },
        actorAdminId: { type: Schema.Types.ObjectId, ref: 'Admin', default: null, index: true },
        entityType: { type: String, required: true, trim: true, maxlength: 100, index: true },
        entityId: { type: Schema.Types.ObjectId, default: null, index: true },
        contentWorkOrderId: { type: Schema.Types.ObjectId, ref: 'ContentWorkOrder', default: null, index: true },
        reason: { type: String, required: true, trim: true, maxlength: 2000 },
        changes: { type: [Schema.Types.Mixed], default: [] },
        metadata: { type: Schema.Types.Mixed, default: () => ({}) },
        correlationId: { type: String, default: '', trim: true, maxlength: 160, index: true },
        ipHash: { type: String, default: '', trim: true, maxlength: 128 },
        occurredAt: { type: Date, default: Date.now, index: true }
    },
    { collection: 'ContentOperationsAuditLogs', timestamps: true }
);

contentOperationsAuditLogSchema.index({ entityType: 1, entityId: 1, occurredAt: -1 });

module.exports = { ContentOperationsAuditLog: model('ContentOperationsAuditLog', contentOperationsAuditLogSchema) };
