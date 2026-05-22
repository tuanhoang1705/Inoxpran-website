'use strict'

const { Schema, model } = require('mongoose');

const DOCUMENT_NAME = 'SiteSetting';
const COLLECTION_NAME = 'SiteSettings';

const siteSettingSchema = new Schema(
	{
		key: {
			type: String,
			required: true,
			trim: true,
			unique: true,
			index: true
		},
		value: {
			type: Schema.Types.Mixed,
			required: true
		},
		updatedBy: {
			type: Schema.Types.ObjectId,
			ref: 'Admin',
			default: null
		}
	},
	{
		timestamps: true,
		collection: COLLECTION_NAME
	}
);

module.exports = model(DOCUMENT_NAME, siteSettingSchema);
