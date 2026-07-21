"use strict";

const { Schema, model } = require("mongoose");

const nullableNumber = { type: Number, default: null };

const contentPerformanceSnapshotSchema = new Schema(
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
    monitoringTaskId: {
      type: Schema.Types.ObjectId,
      ref: "ContentMonitoringTask",
      required: true,
      unique: true,
      index: true,
    },
    monitoringClaimToken: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
      select: false,
    },
    monitoringClaimGeneration: {
      type: Number,
      required: true,
      min: 1,
      index: true,
    },
    measuredAt: { type: Date, required: true, index: true },
    window: {
      type: String,
      enum: ["immediate", "1d", "7d", "14d", "30d", "90d"],
      required: true,
      index: true,
    },
    searchConsole: {
      clicks: nullableNumber,
      impressions: nullableNumber,
      ctr: nullableNumber,
      averagePosition: nullableNumber,
      queries: { type: [Schema.Types.Mixed], default: [] },
      configured: { type: Boolean, default: false },
      status: {
        type: String,
        enum: ["available", "unavailable", "partial"],
        default: "unavailable",
      },
    },
    analytics: {
      views: nullableNumber,
      engagedSessions: nullableNumber,
      engagementTime: nullableNumber,
      productLinkClicks: nullableNumber,
      conversionAssist: nullableNumber,
      configured: { type: Boolean, default: false },
      status: {
        type: String,
        enum: ["available", "unavailable", "partial"],
        default: "unavailable",
      },
    },
    technical: { type: Schema.Types.Mixed, default: () => ({}) },
    contentState: { type: Schema.Types.Mixed, default: () => ({}) },
    productState: { type: Schema.Types.Mixed, default: () => ({}) },
    warnings: { type: [String], default: [] },
    contentHash: { type: String, required: true, trim: true, maxlength: 128 },
  },
  { collection: "ContentPerformanceSnapshots", timestamps: true },
);

contentPerformanceSnapshotSchema.index({ blogId: 1, measuredAt: -1 });

module.exports = {
  ContentPerformanceSnapshot: model(
    "ContentPerformanceSnapshot",
    contentPerformanceSnapshotSchema,
  ),
};
