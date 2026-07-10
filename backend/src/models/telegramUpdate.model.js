'use strict'

const { Schema, model } = require('mongoose');

const DOCUMENT_NAME = 'TelegramUpdate';
const COLLECTION_NAME = 'TelegramUpdates';

const updateSchema = new Schema(
    {
        updateId: { type: Number, required: true, unique: true, index: true },
        chatId: { type: String, default: '', index: true },
        userId: { type: String, default: '', index: true },
        command: { type: String, default: '' },
        processedAt: { type: Date, default: Date.now },
        status: { type: String, default: 'processed' },
        error: { type: String, default: '' }
    },
    {
        collection: COLLECTION_NAME,
        timestamps: true
    }
);

module.exports = {
    TelegramUpdate: model(DOCUMENT_NAME, updateSchema)
};
