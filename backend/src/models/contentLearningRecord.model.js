"use strict";

const { Schema, model } = require("mongoose");

const LEARNING_RECOMMENDATIONS = Object.freeze([
  "keep",
  "expand",
  "update",
  "metadata_refresh",
  "improve_internal_links",
  "replace_outdated_product_reference",
  "merge",
  "monitor_longer",
  "no_action",
]);

const contentLearningRecordSchema = new Schema(
  {
    blogId: {
      type: Schema.Types.ObjectId,
      ref: "BlogPost",
      required: true,
      index: true,
    },
    contentWorkOrderId: {
      type: Schema.Types.ObjectId,
      ref: "ContentWorkOrder",
      required: true,
      index: true,
    },
    performanceSnapshotIds: {
      type: [
        { type: Schema.Types.ObjectId, ref: "ContentPerformanceSnapshot" },
      ],
      default: [],
    },
    recommendation: {
      type: String,
      enum: LEARNING_RECOMMENDATIONS,
      required: true,
      index: true,
    },
    confidence: { type: Number, required: true, min: 0, max: 1 },
    reasons: { type: [String], default: [] },
    evidence: { type: [Schema.Types.Mixed], default: [] },
    minimumThresholdsMet: { type: Boolean, default: false },
    requiresNewWorkOrder: { type: Boolean, default: false },
    generatedWorkOrderId: {
      type: Schema.Types.ObjectId,
      ref: "ContentWorkOrder",
      default: null,
      index: true,
    },
    autoApplied: { type: Boolean, default: false, immutable: true },
    status: {
      type: String,
      enum: ["proposed", "accepted", "dismissed", "converted"],
      default: "proposed",
      index: true,
    },
    overrideReason: {
      type: String,
      default: null,
      trim: true,
      maxlength: 2000,
    },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "Admin", default: null },
    reviewedAt: { type: Date, default: null },
    leaseUntil: { type: Date, default: null, index: true },
    lockedBy: { type: String, default: "", trim: true, maxlength: 200 },
    contentHash: {
      type: String,
      required: true,
      trim: true,
      maxlength: 128,
      index: true,
    },
  },
  { collection: "ContentLearningRecords", timestamps: true },
);

contentLearningRecordSchema.index(
  { blogId: 1, contentHash: 1 },
  { unique: true },
);
contentLearningRecordSchema.index({
  status: 1,
  requiresNewWorkOrder: 1,
  leaseUntil: 1,
});

module.exports = {
  LEARNING_RECOMMENDATIONS,
  ContentLearningRecord: model(
    "ContentLearningRecord",
    contentLearningRecordSchema,
  ),
};
