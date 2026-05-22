'use strict'

const {model, Schema, Types} = require('mongoose'); // Erase if already required

const DOCUMENT_NAME = 'ApiKey';
const COLLECTION_NAME = 'ApiKey';
const API_PERMISSIONS = ['PUBLIC', 'USER', 'ADMIN', 'ADMIN_SYSTEM'];
// Declare the Schema of the Mongo model
var apiKeySchema = new Schema({
    key:{
        type:String,
        required:true,
        unique:true,
    },
    status:{
        type:Boolean,
        default:true,
    },
    permissions:{
        type:[String],
        required:true,
        enum: API_PERMISSIONS
    },
    createdAt:{
        type:Date,
        default: Date.now,
    },
}, {
    timestamps: true,
    collection: COLLECTION_NAME
}

);

//Export the model
module.exports = model(DOCUMENT_NAME, apiKeySchema);
