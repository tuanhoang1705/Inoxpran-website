'use strict'

const { Schema, model } = require('mongoose');

const DOCUMENT_NAME = 'BlogComment';
const COLLECTION_NAME = 'BlogComments';

const BLOG_COMMENT_STATUSES = ['pending', 'approved', 'rejected'];

const blogCommentSchema = new Schema(
	{
		blogId: {
			type: Schema.Types.ObjectId,
			ref: 'BlogPost',
			required: true,
			index: true
		},
		parentId: {
			type: Schema.Types.ObjectId,
			ref: DOCUMENT_NAME,
			default: null
		},
		rootId: {
			type: Schema.Types.ObjectId,
			ref: DOCUMENT_NAME,
			default: null,
			index: true
		},
		authorName: {
			type: String,
			trim: true,
			required: true,
			maxLength: 120
		},
		authorEmail: {
			type: String,
			trim: true,
			lowercase: true,
			required: true,
			maxLength: 200
		},
		content: {
			type: String,
			trim: true,
			required: true,
			maxLength: 2000
		},
		status: {
			type: String,
			enum: BLOG_COMMENT_STATUSES,
			default: 'pending',
			index: true
		},
		reviewedBy: {
			type: Schema.Types.ObjectId,
			ref: 'Admin',
			default: null
		},
		reviewedAt: {
			type: Date,
			default: null
		},
		meta: {
			ip: { type: String, default: null },
			userAgent: { type: String, default: null }
		}
	},
	{
		timestamps: true,
		collection: COLLECTION_NAME
	}
);

blogCommentSchema.index({ blogId: 1, status: 1, createdAt: -1 });
blogCommentSchema.index({ blogId: 1, rootId: 1, createdAt: 1 });

module.exports = {
	blogComment: model(DOCUMENT_NAME, blogCommentSchema),
	BLOG_COMMENT_STATUSES
};
