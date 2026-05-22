'use strict'

const { model, Schema } = require('mongoose');

const DOCUMENT_NAME = 'DiscountUsage';
const COLLECTION_NAME = 'Discount_Usage';

const discountUsageSchema = new Schema({
    usage_discount_id: { type: Schema.Types.ObjectId, ref: 'Discount', required: true, index: true },
    usage_user_id: { type: Schema.Types.ObjectId, required: true, index: true },
    usage_shop_id: { type: Schema.Types.ObjectId, ref: 'Shop', required: true, index: true },
    usage_count: { type: Number, default: 0 },
    usage_last_used_at: { type: Date }
}, {
    collection: COLLECTION_NAME,
    timestamps: true
});

discountUsageSchema.index({ usage_discount_id: 1, usage_user_id: 1 }, { unique: true });

module.exports = model(DOCUMENT_NAME, discountUsageSchema);
