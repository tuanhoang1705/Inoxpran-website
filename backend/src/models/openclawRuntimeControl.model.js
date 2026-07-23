"use strict";

const { Schema, model } = require("mongoose");

const CONTROL_KEYS = Object.freeze([
  "blog_cron",
  "auto_publish",
  "telegram_approval",
  "image_pipeline",
]);

const schema = new Schema(
  {
    controlKey: {
      type: String,
      enum: CONTROL_KEYS,
      required: true,
      unique: true,
      index: true,
      immutable: true,
    },
    enabled: { type: Boolean, required: true, default: false },
    revision: { type: Number, required: true, default: 1, min: 1 },
    reason: {
      type: String,
      required: true,
      trim: true,
      minlength: 10,
      maxlength: 500,
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
      index: true,
    },
    lastIdempotencyKeyHash: {
      type: String,
      required: true,
      minlength: 64,
      maxlength: 64,
      select: false,
    },
  },
  {
    collection: "OpenClawRuntimeControls",
    timestamps: true,
  },
);

schema.index({ updatedAt: -1, _id: -1 });

module.exports = {
  CONTROL_KEYS,
  OpenClawRuntimeControl: model("OpenClawRuntimeControl", schema),
};
