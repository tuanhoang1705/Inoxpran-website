'use strict'

const { model, Schema } = require('mongoose');

const DOCUMENT_NAME = 'DiscountDeletion';
const COLLECTION_NAME = 'discount_deletions';

const discountDeletionSchema = new Schema({
    deletion_discount_id: { type: Schema.Types.ObjectId, ref: 'Discount', required: true, index: true },
    deletion_discount_code: { type: String, required: true, index: true },
    deletion_shop_id: { type: Schema.Types.ObjectId, ref: 'Shop', required: true, index: true },
    deletion_confirmed_by: { type: Schema.Types.ObjectId, ref: 'Shop', required: true },
    deletion_reason: { type: String },
    deletion_snapshot: { type: Object, default: {} }
}, {
    collection: COLLECTION_NAME,
    timestamps: true
});

module.exports = model(DOCUMENT_NAME, discountDeletionSchema);
