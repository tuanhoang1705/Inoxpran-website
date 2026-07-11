'use strict'

const { Schema, model } = require('mongoose');

const DOCUMENT_NAME = 'TelegramBlogApproval';
const COLLECTION_NAME = 'TelegramBlogApprovals';

const approvalSchema = new Schema(
    {
        blogId: { type: Schema.Types.ObjectId, ref: 'BlogPost', required: true, index: true },
        scheduleId: { type: Schema.Types.ObjectId, ref: 'BlogAutomationSchedule', default: null, index: true },
        executionId: { type: Schema.Types.ObjectId, ref: 'BlogAutomationExecution', default: null, index: true },
        approvalCode: { type: String, required: true, unique: true, index: true },
        status: {
            type: String,
            enum: ['pending', 'processing', 'approved', 'rejected', 'expired'],
            default: 'pending',
            index: true
        },
        blogTitle: { type: String, default: '' },
        blogSlug: { type: String, default: '' },
        blogUrl: { type: String, default: '' },
        adminEditUrl: { type: String, default: '' },
        coverImageUrl: { type: String, default: '' },
        idempotencyKey: { type: String, unique: true, sparse: true, index: true },
        telegramChatId: { type: String, default: '', index: true },
        telegramMessageId: { type: String, default: '' },
        notificationType: { type: String, enum: ['photo', 'text', 'text_fallback', 'disabled', ''], default: '' },
        notificationStatus: { type: String, default: '' },
        notificationError: { type: String, default: '' },
        notifiedAt: { type: Date, default: null },
        expiresAt: { type: Date, default: null, index: true },
        approvedAt: { type: Date, default: null },
        approvedByTelegramUserId: { type: String, default: '' },
        approvedByTelegramUsername: { type: String, default: '' },
        rejectedAt: { type: Date, default: null },
        rejectedByTelegramUserId: { type: String, default: '' },
        rejectedByTelegramUsername: { type: String, default: '' },
        processedUpdateId: { type: Number, default: null, index: true }
    },
    {
        collection: COLLECTION_NAME,
        timestamps: true
    }
);

approvalSchema.index({ status: 1, expiresAt: 1 });

module.exports = {
    TelegramBlogApproval: model(DOCUMENT_NAME, approvalSchema)
};
