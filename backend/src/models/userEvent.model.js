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
        // These four carried their own single-field index, each a strict prefix of a
        // compound index declared below. A prefix index can only repeat work the
        // compound one already does, but it still costs a write on every insert -
        // and this is the busiest collection in the database.
        sessionId: { type: String, required: true, trim: true },
        user: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        type: { type: String, required: true, trim: true },
        occurredAt: { type: Date, default: Date.now },
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

// Telemetry had no retention at all and was the largest collection in the database -
// 45k documents and 38% of its bytes, growing by about 5k a month with nothing ever
// removing a row. The longest window anything queries is 90 days (SEARCH_WINDOWS and
// MONITORING_WINDOWS both top out there), so 180 days leaves double that headroom and
// still puts a ceiling on a collection that otherwise grows forever.
// Production runs with autoIndex off - create it with scripts/ensure-query-indexes.js.
const USER_EVENT_RETENTION_DAYS = Number(process.env.USER_EVENT_RETENTION_DAYS || 180);
userEventSchema.index(
    { createdAt: 1 },
    {
        name: 'userevents_ttl',
        expireAfterSeconds: Math.max(1, USER_EVENT_RETENTION_DAYS) * 24 * 60 * 60
    }
);

module.exports = model(DOCUMENT_NAME, userEventSchema);
