'use strict'
const { Schema, model } = require('mongoose'); // Erase if already required

const DOCUMENT_NAME = 'Key'
const COLLECTION_NAME = 'Keys'

// Declare the Schema of the Mongo model

const keyPairSchema = new Schema(
    {
        keyId: { type: String, required: true },
        publicKey: { type: String, required: true },
        privateKey: { type: String, required: true },
        refreshToken: { type: String, required: true },
        refreshTokensUsed: { type: [String], default: [] }
    },
    { _id: false }
);

var keyTokenSchema = new Schema({
    user: {
        type: Schema.Types.ObjectId,
        required: true,
        refPath: 'userType'
    },
    userType: {
        type: String,
        enum: ['User', 'Admin'],
        default: 'User'
    },
    privateKey: {
        type: String
    },
    publicKey: {
        type: String
    },
    refreshTokensUsed: {
        type: Array,
        default: [] // những RT đã được sử dụng
    },
    refreshToken: {
        type: String
    },
    keys: {
        type: [keyPairSchema],
        default: []
    }
    
    
}, {

    collection: COLLECTION_NAME,
    timestamps: true
});

//Export the model

module.exports = model(DOCUMENT_NAME, keyTokenSchema);
