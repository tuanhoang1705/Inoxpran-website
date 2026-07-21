"use strict";

const { Schema, model } = require("mongoose");

const MONITORING_WINDOWS = Object.freeze([
  "immediate",
  "1d",
  "7d",
  "14d",
  "30d",
  "90d",
]);

const contentMonitoringTaskSchema = new Schema(
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
    window: {
      type: String,
      enum: MONITORING_WINDOWS,
      required: true,
      index: true,
    },
    dueAt: { type: Date, required: true, index: true },
    status: {
      type: String,
      enum: ["pending", "running", "complete", "failed", "cancelled"],
      default: "pending",
      index: true,
    },
    leaseUntil: { type: Date, default: null, index: true },
    lockedBy: { type: String, default: "", trim: true, maxlength: 200 },
    claimGeneration: { type: Number, default: 0, min: 0 },
    completedAt: { type: Date, default: null },
    attemptCount: { type: Number, default: 0, min: 0, max: 10 },
    performanceSnapshotId: {
      type: Schema.Types.ObjectId,
      ref: "ContentPerformanceSnapshot",
      default: null,
    },
    lastError: { type: String, default: "", trim: true, maxlength: 1000 },
  },
  { collection: "ContentMonitoringTasks", timestamps: true },
);

contentMonitoringTaskSchema.index(
  { blogId: 1, contentWorkOrderId: 1, window: 1 },
  { unique: true },
);
contentMonitoringTaskSchema.index({ status: 1, dueAt: 1, leaseUntil: 1 });

module.exports = {
  MONITORING_WINDOWS,
  ContentMonitoringTask: model(
    "ContentMonitoringTask",
    contentMonitoringTaskSchema,
  ),
};
