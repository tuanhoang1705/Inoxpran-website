'use strict'

const { Schema, model } = require('mongoose');

const DOCUMENT_NAME = 'NewsletterSubscriber';
const COLLECTION_NAME = 'NewsletterSubscribers';

const newsletterSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, index: true },
    status: { type: String, enum: ['subscribed', 'unsubscribed'], default: 'subscribed' },
    subscribedAt: { type: Date, default: Date.now },
    unsubscribedAt: { type: Date },
    sourcePage: { type: String },
    meta: {
      userAgent: { type: String },
      ip: { type: String },
      locale: { type: String }
    }
  },
  {
    timestamps: true,
    collection: COLLECTION_NAME
  }
);

newsletterSchema.index({ email: 1 }, { unique: true });

module.exports = model(DOCUMENT_NAME, newsletterSchema);
