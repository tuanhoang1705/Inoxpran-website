'use strict'

const { Schema, model } = require('mongoose');

const DOCUMENT_NAME = 'Notification';
const COLLECTION_NAME = 'Notifications';

const notificationSchema = new Schema({
    noti_type: { type: String, required: true },
    noti_sender_id: { type: Schema.Types.Mixed, required: true },
    noti_sender_type: { type: String, required: true },
    noti_receiver_id: { type: Schema.Types.Mixed, default: null },
    noti_receiver_type: { type: String, required: true },
    noti_title: { type: String, required: true },
    noti_message: { type: String, required: true },
    noti_payload: { type: Object, default: {} },
    noti_status: { type: String, enum: ['unread', 'read'], default: 'unread' }
}, {
    timestamps: true,
    collection: COLLECTION_NAME
});

notificationSchema.index({ noti_receiver_type: 1, noti_receiver_id: 1, noti_status: 1, createdAt: -1 });

module.exports = model(DOCUMENT_NAME, notificationSchema);


