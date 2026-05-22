'use strict'

const { Schema, model } = require('mongoose');

const DOCUMENT_NAME = 'ContactRequest';
const COLLECTION_NAME = 'ContactRequests';

const contactSchema = new Schema(
	{
		fullName: {
			type: String,
			trim: true,
			required: true,
			maxLength: 200
		},
		phone: {
			type: String,
			trim: true,
			default: null
		},
		email: {
			type: String,
			trim: true,
			lowercase: true,
			default: null
		},
		company: {
			type: String,
			trim: true,
			default: null
		},
		address: {
			type: String,
			trim: true,
			default: null
		},
		city: {
			type: String,
			trim: true,
			default: null
		},
		productInterest: {
			type: String,
			trim: true,
			default: null
		},
		budgetRange: {
			type: String,
			trim: true,
			default: null
		},
		timeline: {
			type: String,
			trim: true,
			default: null
		},
		preferredContactMethod: {
			type: String,
			enum: ['phone', 'email', 'zalo', 'whatsapp', 'other', null],
			default: null
		},
		preferredContactTime: {
			type: String,
			enum: ['morning', 'afternoon', 'evening', 'anytime', null],
			default: null
		},
		message: {
			type: String,
			trim: true,
			required: true,
			maxLength: 2000
		},
		sourcePage: {
			type: String,
			trim: true,
			default: null
		},
		referrer: {
			type: String,
			trim: true,
			default: null
		},
		status: {
			type: String,
			enum: ['new', 'processing', 'contacted', 'closed'],
			default: 'new'
		},
		assignedTo: {
			type: Schema.Types.ObjectId,
			ref: 'Admin',
			default: null
		},
		assignedAt: {
			type: Date,
			default: null
		},
		internalNote: {
			type: String,
			trim: true,
			default: null
		},
		lastContactedAt: {
			type: Date,
			default: null
		},
		updatedBy: {
			type: Schema.Types.ObjectId,
			ref: 'Admin',
			default: null
		},
		meta: {
			userAgent: {
				type: String,
				default: null
			},
			ip: {
				type: String,
				default: null
			},
			locale: {
				type: String,
				default: null
			}
		}
	},
	{
		timestamps: true,
		collection: COLLECTION_NAME
	}
);

contactSchema.index({ status: 1, createdAt: -1 });
contactSchema.index({ fullName: 'text', phone: 'text', email: 'text', message: 'text' });

module.exports = model(DOCUMENT_NAME, contactSchema);
