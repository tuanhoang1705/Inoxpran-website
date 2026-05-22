'use strict'

const { model, Schema } = require('mongoose');

const DOCUMENT_NAME = 'AdminAuditLog';
const COLLECTION_NAME = 'AdminAuditLogs';

const adminSnapshotSchema = new Schema(
    {
        adminId: {
            type: String,
            default: null
        },
        name: {
            type: String,
            default: null
        },
        email: {
            type: String,
            default: null
        },
        status: {
            type: String,
            default: null
        },
        roles: {
            type: [String],
            default: []
        }
    },
    { _id: false }
);

const adminAuditLogSchema = new Schema(
    {
        category: {
            type: String,
            default: 'admin_account',
            index: true
        },
        action: {
            type: String,
            required: true,
            index: true
        },
        actorAdmin: {
            type: Schema.Types.ObjectId,
            ref: 'Admin',
            default: null,
            index: true
        },
        actorSnapshot: {
            type: adminSnapshotSchema,
            required: true
        },
        targetAdmin: {
            type: Schema.Types.ObjectId,
            ref: 'Admin',
            default: null,
            index: true
        },
        targetSnapshot: {
            type: adminSnapshotSchema,
            required: true
        },
        summary: {
            type: String,
            required: true,
            trim: true,
            maxlength: 500
        },
        metadata: {
            type: Schema.Types.Mixed,
            default: {}
        }
    },
    {
        timestamps: true,
        collection: COLLECTION_NAME
    }
);

adminAuditLogSchema.index({ createdAt: -1, _id: -1 });

module.exports = model(DOCUMENT_NAME, adminAuditLogSchema);
