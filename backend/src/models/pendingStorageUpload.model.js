'use strict'

const { Schema, model } = require('mongoose');

const pendingStorageUploadSchema = new Schema(
    {
        ownerId: { type: String, required: true, index: true },
        sessionId: { type: String, required: true, index: true },
        entityType: {
            type: String,
            enum: ['product', 'blog'],
            default: 'product',
            index: true
        },
        url: { type: String, required: true },
        path: { type: String },
        variants: { type: Schema.Types.Mixed, default: null },
        expiresAt: { type: Date, required: true, index: true }
    },
    {
        collection: 'PendingStorageUploads',
        timestamps: true
    }
);

pendingStorageUploadSchema.index({ ownerId: 1, sessionId: 1 });

module.exports = {
    pendingStorageUpload: model('PendingStorageUpload', pendingStorageUploadSchema)
};
