'use strict';

const { Schema, model } = require('mongoose');

const DOCUMENT_NAME = 'ChatMessage';
const COLLECTION_NAME = 'chat_messages';

const chatMessageSchema = new Schema(
	{
		sessionId: { type: String, required: true, index: true, trim: true },
		role: {
			type: String,
			enum: ['user', 'assistant', 'consultant', 'system', 'tool'],
			required: true,
			index: true
		},
		text: { type: String, required: true, trim: true },
		meta: { type: Schema.Types.Mixed, default: null }
	},
	{
		timestamps: true,
		collection: COLLECTION_NAME
	}
);

chatMessageSchema.index({ sessionId: 1, createdAt: -1 });

module.exports = model(DOCUMENT_NAME, chatMessageSchema);
