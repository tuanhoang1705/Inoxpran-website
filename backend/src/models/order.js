'use strict'
const { Schema, model } = require('mongoose'); // Erase if already required

const DOCUMENT_NAME = 'ORDER'
const COLLECTION_NAME = 'Order'

const orderSchema = new Schema({
    order_userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    order_source: {
        type: String,
        enum: ['account_checkout', 'guest_checkout', 'admin_manual'],
        default: 'account_checkout',
        index: true
    },
    order_guest: { type: Object, default: null },
    order_marketing: { type: Object, default: {} },
    order_cartId: { type: Schema.Types.ObjectId, ref: 'Cart' },
    order_checkout: { type: Object, default: {} },
    /**
     order_checkout ={
     totalPrice,
     totalApplyDiscount,
     freeShip
     }
     */
    order_shipping: { type: Object, default: {} },
    /*
        street,
        city,
        state,
        country
    */
    order_payment: { type: Object, default: {} },
    order_products: { type: Array, required: true },
    order_trackingNumber: { type: String, default: '#' },
    order_payment_method: { type: String, enum: ['COD'], default: 'COD' },
    order_payment_status: { type: String, enum: ['pending', 'paid', 'failed', 'refunded'], default: 'pending' },
    order_cod_status: { type: String, enum: ['pending', 'collected', 'failed', 'returned'], default: 'pending' },
    order_shipping_status: {
        type: String,
        enum: ['pending', 'label_created', 'picked_up', 'in_transit', 'delivered', 'failed', 'returned', 'cancelled'],
        default: 'pending'
    },
    order_shipping_provider: { type: String, default: 'GHTK' },
    order_shipments: [{ type: Schema.Types.ObjectId, ref: 'Shipment' }],
    order_status: {
        type: String,
        enum: ['pending', 'confirmed', 'shipped', 'cancel_requested', 'cancelled', 'delivered', 'returned'],
        default: 'pending'
    },
    order_cancel_request: {
        status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
        reason: { type: String, default: null },
        requestedBy: { type: Schema.Types.Mixed, default: null },
        requestedAt: { type: Date, default: null },
        reviewedBy: { type: Schema.Types.Mixed, default: null },
        reviewedAt: { type: Date, default: null },
        reviewerType: { type: String, default: null }
    }
},
    {
        collection: COLLECTION_NAME,
        timestamps: {
            createdAt: 'createdOn',
            updatedAt: 'modifiedOn'
        }
}
)


module.exports = {
    order: model(DOCUMENT_NAME, orderSchema),
  
}
