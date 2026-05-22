'use strict'

const { model, Schema } = require('mongoose');

const DOCUMENT_NAME = 'CartDeletion';
const COLLECTION_NAME = 'cart_deletions';

const cartDeletionSchema = new Schema({
    deletion_cart_id: { type: Schema.Types.ObjectId, ref: 'Cart' },
    deletion_user_id: { type: Schema.Types.ObjectId, required: true, index: true, ref: 'User' },
    deletion_product_id: { type: String, required: true, index: true },
    deletion_shop_id: { type: String },
    deletion_reason: { type: String },
    deletion_snapshot: { type: Object, default: {} }
}, {
    collection: COLLECTION_NAME,
    timestamps: true
});

cartDeletionSchema.index({ deletion_user_id: 1, deletion_product_id: 1 });

module.exports = model(DOCUMENT_NAME, cartDeletionSchema);
