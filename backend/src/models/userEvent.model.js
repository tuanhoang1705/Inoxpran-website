'use strict';

const { Schema, model } = require('mongoose');

const DOCUMENT_NAME = 'UserEvent';
const COLLECTION_NAME = 'UserEvents';

const productEventSchema = new Schema(
    {
        productId: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
        slug: { type: String, default: null, trim: true },
        name: { type: String, default: null, trim: true }
    },
    { _id: false }
);

const clickEventSchema = new Schema(
    {
        label: { type: String, default: null, trim: true },
        href: { type: String, default: null, trim: true },
        element: { type: String, default: null, trim: true },
        trackName: { type: String, default: null, trim: true },
        trackSection: { type: String, default: null, trim: true },
        productId: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
        productSlug: { type: String, default: null, trim: true },
        productName: { type: String, default: null, trim: true },
        blogSlug: { type: String, default: null, trim: true }
    },
    { _id: false }
);

const userEventSchema = new Schema(
    {
        sessionId: { type: String, required: true, trim: true, index: true },
        user: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
        type: { type: String, required: true, trim: true, index: true },
        occurredAt: { type: Date, default: Date.now, index: true },
        path: { type: String, default: null, trim: true },
        url: { type: String, default: null, trim: true },
        title: { type: String, default: null, trim: true },
        referrer: { type: String, default: null, trim: true },
        locale: { type: String, default: null, trim: true },
        scrollDepthPercent: { type: Number, default: null, min: 0, max: 100 },
        durationMs: { type: Number, default: 0, min: 0 },
        product: { type: productEventSchema, default: null },
        click: { type: clickEventSchema, default: null },
        meta: { type: Schema.Types.Mixed, default: {} },
        ip: { type: String, default: null, trim: true },
        userAgent: { type: String, default: null, trim: true }
    },
    {
        timestamps: true,
        collection: COLLECTION_NAME
    }
);

userEventSchema.index({ user: 1, type: 1, createdAt: -1 });
userEventSchema.index({ user: 1, createdAt: -1 });
userEventSchema.index({ sessionId: 1, createdAt: -1 });
userEventSchema.index({ occurredAt: -1 });
userEventSchema.index({ type: 1, occurredAt: -1 });
userEventSchema.index({ path: 1, occurredAt: -1 });

module.exports = model(DOCUMENT_NAME, userEventSchema);
