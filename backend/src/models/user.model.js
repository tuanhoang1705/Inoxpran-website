'use strict'

const { model, Schema } = require('mongoose');

const DOCUMENT_NAME = 'User';
const COLLECTION_NAME = 'Users';

const userSchema = new Schema({
    name: {
        type: String,
        trim: true,
        maxLength: 150,
        required: true
    },
    email: {
        type: String,
        unique: true,
        trim: true,
        lowercase: true,
        required: true
    },
    password: {
        type: String,
        required: true,
        select: false
    },
    phone: {
        type: String,
        default: null
    },
    avatar: {
        type: String,
        default: null
    },
    preferredLocale: {
        type: String,
        enum: ['vi', 'en'],
        default: 'vi'
    },
    loginCount: {
        type: Number,
        default: 0,
        min: 0
    },
    firstLoginAt: {
        type: Date,
        default: null
    },
    lastLoginAt: {
        type: Date,
        default: null
    },
    lastLoginIp: {
        type: String,
        default: null
    },
    lastLoginUserAgent: {
        type: String,
        default: null
    },
    telemetryIdentity: {
        type: {
            lastMappedAt: { type: Date, default: null },
            firstMappedAt: { type: Date, default: null },
            lastMappedIp: { type: String, default: null },
            lastMappedSessionId: { type: String, default: null },
            lastMappedStrategy: { type: String, default: null },
            mappedSessionsCount: { type: Number, default: 0, min: 0 },
            mappedEventsCount: { type: Number, default: 0, min: 0 },
            sourceIps: { type: [String], default: [] },
            sourceSessionIds: { type: [String], default: [] }
        },
        default: () => ({})
    },

    status: {
        type: String,
        enum: ['active', 'inactive', 'blocked'],
        default: 'active'
    },
    verify: {
        type: Schema.Types.Boolean,
        default: false
    },
    roles: {
        type: [String],
        default: ['USER']
    },
    addresses: {
        type: Array,
        default: []
    }
}, {
    timestamps: true,
    collection: COLLECTION_NAME
});

module.exports = model(DOCUMENT_NAME, userSchema);
