'use strict'

const { Schema, model } = require('mongoose');

const productReferenceSchema = new Schema({
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    evidenceHash: { type: String, required: true },
    dataCompleteness: { type: Number, min: 0, max: 1, default: 0 },
    eligible: { type: Boolean, default: false },
    rejectionReasons: { type: [String], default: [] }
}, { _id: false });

const schema = new Schema({
    catalogHash: { type: String, required: true, index: true },
    productCount: { type: Number, default: 0, min: 0 },
    eligibleProductCount: { type: Number, default: 0, min: 0 },
    generatedAt: { type: Date, required: true, index: true },
    sourceUpdatedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true, index: true },
    filters: { type: Schema.Types.Mixed, default: () => ({}) },
    status: { type: String, enum: ['complete', 'partial', 'failed'], required: true, index: true },
    error: { type: String, default: '', maxlength: 500 },
    productReferences: { type: [productReferenceSchema], default: [] }
}, { collection: 'ProductCatalogSnapshots', timestamps: true });

schema.index({ status: 1, expiresAt: -1 });

module.exports = { ProductCatalogSnapshot: model('ProductCatalogSnapshot', schema) };
