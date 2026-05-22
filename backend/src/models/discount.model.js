'use strict'

const {model, Schema, Types} = require('mongoose'); // Erase if already required

const DOCUMENT_NAME = 'Discount';
const COLLECTION_NAME = 'discounts';
// Declare the Schema of the Mongo model
var discountSchema = new Schema({
    discount_name: { type: String, required: true },
    discount_description: { type: String },
    discount_type: { type: String, required: true, default: 'fixed_amount',  }, // 'fixed_amount', 'percentage', 'free_shipping'
    discount_value: { type: Number, required: true },
    discount_max_value: { type: Number, required: true },
    discount_code: { type: String, required: true, unique: true },
    discount_startDate: { type:Date, required: true },
    discount_endDate: { type: Date, required: true },
    discount_max_uses: { type: Number, required: true, default: 1 },
    discount_uses_count: { type: Number,  required: true }, // số discount đã sử dụng
    discount_uses_used: { type: Array, default: [] }, // ai đã sử dụng
    discount_max_uses_per_user: { type: Number, required: true },
    discount_min_order_value: { type: Number, required: true },
    discount_shopId: { type: Schema.Types.ObjectId, ref: 'Shop', required: true },
    discount_is_active: { type: Boolean, default: true },
    discount_applies_to: { type: String, required: true, enum: ['all', 'specific'] }, // ['all_products', 'specific_products', 'specific_collections', 'specific_customers']
    discount_product_ids: { type: Array, default: [] }, // số sản phẩm được áp dụng
    discount_customer_applies_to: { type: String, default: 'all', enum: ['all', 'specific'] }, // all customers or specific customers
    discount_customer_ids: { type: Array, default: [] }, // danh sách khách hàng được áp dụng
},{
    collection: COLLECTION_NAME,
    timestamps: true
});



//Export the model
module.exports = model(DOCUMENT_NAME, discountSchema);
