'use strict'

const {model, Schema, Types} = require('mongoose'); // Erase if already required

const DOCUMENT_NAME = 'Inventory';
const COLLECTION_NAME = 'Inventory';
// Declare the Schema of the Mongo model
var apiKeySchema = new Schema({
    inven_productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    inven_location: { type: String, default: 'unknown' },
    inven_stock: { type: Number, required: true },
    inven_shopId: { type: Schema.Types.ObjectId, ref: 'Shop', required: true },
    inven_reservations: { type: Array, default: [] },

}, {
    timestamps: true,
    collection: COLLECTION_NAME
});

//Export the model
module.exports = {
    inventory: model(DOCUMENT_NAME, apiKeySchema),
};