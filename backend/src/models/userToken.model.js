'use strict';

const { Schema, model } = require('mongoose');

const DOCUMENT_NAME = 'UserToken';
const COLLECTION_NAME = 'UserTokens';

const userTokenSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    token: {
      type: String,
      required: true,
      index: true
    },
    type: {
      type: String,
      enum: ['verify_email', 'reset_password'],
      required: true,
      index: true
    },
    expiresAt: {
      type: Date,
      required: true
    },
    usedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true,
    collection: COLLECTION_NAME
  }
);

userTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = model(DOCUMENT_NAME, userTokenSchema);
