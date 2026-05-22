'use strict';

const { Schema, model } = require('mongoose');

const DOCUMENT_NAME = 'UserSession';
const COLLECTION_NAME = 'UserSessions';

const pathSummarySchema = new Schema(
    {
        path: { type: String, required: true, trim: true },
        count: { type: Number, default: 0, min: 0 },
        lastSeenAt: { type: Date, default: Date.now }
    },
    { _id: false }
);

const productSummarySchema = new Schema(
    {
        productId: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
        slug: { type: String, default: null, trim: true },
        name: { type: String, default: null, trim: true },
        count: { type: Number, default: 0, min: 0 },
        firstViewedAt: { type: Date, default: Date.now },
        lastViewedAt: { type: Date, default: Date.now }
    },
    { _id: false }
);

const clickSummarySchema = new Schema(
    {
        label: { type: String, default: null, trim: true },
        href: { type: String, default: null, trim: true },
        trackName: { type: String, default: null, trim: true },
        path: { type: String, default: null, trim: true },
        productId: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
        productSlug: { type: String, default: null, trim: true },
        productName: { type: String, default: null, trim: true },
        at: { type: Date, default: Date.now }
    },
    { _id: false }
);

const userSessionSchema = new Schema(
    {
        sessionId: { type: String, required: true, unique: true, index: true, trim: true },
        user: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
        startedAnonymous: { type: Boolean, default: true, index: true },
        mappedUserAt: { type: Date, default: null, index: true },
        mappedUserStrategy: {
            type: String,
            enum: ['session', 'ip', 'session+ip'],
            default: null
        },
        mappedByAuthEvent: {
            type: String,
            enum: ['signup', 'first_login'],
            default: null
        },
        mappedFromIp: { type: String, default: null },
        mappedFromSessionId: { type: String, default: null },
        mappingConfidence: {
            type: String,
            enum: ['high', 'medium'],
            default: null
        },
        status: { type: String, enum: ['active', 'ended'], default: 'active', index: true },
        firstSeenAt: { type: Date, default: Date.now },
        lastSeenAt: { type: Date, default: Date.now, index: true },
        endedAt: { type: Date, default: null },
        firstIp: { type: String, default: null },
        lastIp: { type: String, default: null },
        ipHistory: { type: [String], default: [] },
        userAgent: { type: String, default: null },
        locale: { type: String, default: null },
        timezoneOffsetMinutes: { type: Number, default: null },
        referrer: { type: String, default: null },
        lastPath: { type: String, default: null },
        lastEventType: { type: String, default: null },
        lastEventAt: { type: Date, default: null },
        eventCount: { type: Number, default: 0, min: 0 },
        pageViewCount: { type: Number, default: 0, min: 0 },
        productViewCount: { type: Number, default: 0, min: 0 },
        blogViewCount: { type: Number, default: 0, min: 0 },
        clickCount: { type: Number, default: 0, min: 0 },
        scrollEventCount: { type: Number, default: 0, min: 0 },
        totalActiveMs: { type: Number, default: 0, min: 0 },
        maxScrollDepthPercent: { type: Number, default: 0, min: 0, max: 100 },
        visitedPaths: { type: [pathSummarySchema], default: [] },
        viewedProducts: { type: [productSummarySchema], default: [] },
        recentClicks: { type: [clickSummarySchema], default: [] }
    },
    {
        timestamps: true,
        collection: COLLECTION_NAME
    }
);

userSessionSchema.index({ user: 1, lastSeenAt: -1 });
userSessionSchema.index({ status: 1, lastSeenAt: -1 });
userSessionSchema.index({ startedAnonymous: 1, lastSeenAt: -1 });
userSessionSchema.index({ lastIp: 1, lastSeenAt: -1 });
userSessionSchema.index({ mappedUserAt: -1, lastSeenAt: -1 });
userSessionSchema.index({ lastEventAt: -1 });
userSessionSchema.index({ startedAnonymous: 1, mappedUserAt: -1 });

module.exports = model(DOCUMENT_NAME, userSessionSchema);
