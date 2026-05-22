'use strict'

const { Schema, model } = require('mongoose');

const DOCUMENT_NAME = 'Shipment';
const COLLECTION_NAME = 'Shipments';

const shipmentSchema = new Schema({
    shipment_order_id: { type: Schema.Types.ObjectId, ref: 'ORDER', required: true, index: true },
    shipment_shop_id: { type: String, required: true, index: true },
    shipment_user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    shipment_provider: { type: String, default: 'GHTK' },
    shipment_service: { type: String, default: null },
    shipment_status: {
        type: String,
        enum: ['pending', 'label_created', 'picked_up', 'in_transit', 'delivered', 'failed', 'returned', 'cancelled'],
        default: 'pending',
        index: true
    },
    shipment_tracking_number: { type: String, default: null },
    shipment_label_url: { type: String, default: null },
    shipment_cod_amount: { type: Number, default: 0 },
    shipment_fee: { type: Number, default: 0 },
    shipment_from: { type: Object, default: {} },
    shipment_to: { type: Object, default: {} },
    shipment_items: { type: Array, default: [] },
    shipment_external_id: { type: String, default: null },
    shipment_raw_request: { type: Object, default: {} },
    shipment_raw_response: { type: Object, default: {} },
    shipment_history: { type: Array, default: [] }
}, {
    collection: COLLECTION_NAME,
    timestamps: {
        createdAt: 'createdOn',
        updatedAt: 'modifiedOn'
    }
});

shipmentSchema.index({ shipment_order_id: 1, shipment_shop_id: 1 });

module.exports = {
    shipment: model(DOCUMENT_NAME, shipmentSchema)
};
