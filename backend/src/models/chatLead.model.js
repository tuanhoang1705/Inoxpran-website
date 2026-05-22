'use strict';

const { Schema, model } = require('mongoose');

const DOCUMENT_NAME = 'ChatLead';
const COLLECTION_NAME = 'chat_leads';

const chatLeadSchema = new Schema(
	{
		sessionId: { type: String, required: true, index: true, trim: true },
		telemetrySessionId: { type: String, default: null, index: true },
		visitorId: { type: String, default: null, index: true },
		user: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
		phone: { type: String, required: true, index: true },
		name: { type: String, default: '' },
		need: { type: String, default: '' },
		sourcePath: { type: String, default: '/' },
		source: { type: String, default: 'chatbox' },
		status: {
			type: String,
			enum: ['new', 'contacted', 'won', 'lost'],
			default: 'new',
			index: true
		},
		internalNote: { type: String, default: '' },
		assignedTo: { type: Schema.Types.ObjectId, ref: 'Admin', default: null },
		assignedAt: { type: Date, default: null },
		lastContactedAt: { type: Date, default: null },
		productHints: {
			type: [
				{
					productId: { type: Schema.Types.ObjectId, default: null },
					slug: { type: String, default: null },
					name: { type: String, default: null },
					price: { type: Number, default: null }
				}
			],
			default: []
		},
		reminder: {
			firstReminderSentAt: { type: Date, default: null },
			firstReminderBy: { type: String, default: 'n8n' }
		},
		meta: { type: Schema.Types.Mixed, default: null }
	},
	{
		timestamps: true,
		collection: COLLECTION_NAME
	}
);

chatLeadSchema.index({ status: 1, createdAt: -1 });
chatLeadSchema.index({ phone: 1, createdAt: -1 });

module.exports = model(DOCUMENT_NAME, chatLeadSchema);
