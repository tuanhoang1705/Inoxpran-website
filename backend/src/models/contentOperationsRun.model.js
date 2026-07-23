"use strict";

const { Schema, model } = require("mongoose");

const schema = new Schema(
  {
    isQaTest: { type: Boolean, default: false, index: true },
    qaBatchId: { type: Schema.Types.ObjectId, ref: 'AgenticBlogQaBatch', default: null, index: true },
    qaCaseId: { type: Schema.Types.ObjectId, ref: 'AgenticBlogQaCase', default: null, index: true },
    environment: { type: String, enum: ['', 'local', 'staging'], default: '' },
    executionMode: { type: String, enum: ['', 'run_now', 'schedule_run_now', 'actual_schedule'], default: '' },
    originalTopicSeed: { type: String, default: '', maxlength: 300 },
    normalizedTopicKey: { type: String, default: '', maxlength: 320 },
    executionKey: { type: String, required: true, unique: true, index: true },
    correlationId: { type: String, required: true, index: true },
    leaseOwner: {
      type: String,
      default: "",
      trim: true,
      maxlength: 200,
      index: true,
    },
    leaseUntil: { type: Date, default: null, index: true },
    lastCheckpoint: { type: String, default: "", trim: true, maxlength: 120 },
    trigger: {
      type: String,
      enum: ["preview", "manual", "scheduled", "pipeline"],
      default: "preview",
      index: true,
    },
    status: {
      type: String,
      enum: ["running", "completed", "partial", "skipped", "blocked", "failed"],
      default: "running",
      index: true,
    },
    googleIntelSnapshotId: {
      type: Schema.Types.ObjectId,
      ref: "GoogleIntelligenceSnapshot",
      default: null,
      index: true,
    },
    contentOperationsSnapshotId: {
      type: Schema.Types.ObjectId,
      ref: "ContentOperationsDailySnapshot",
      default: null,
      index: true,
    },
    contentInventorySnapshotId: {
      type: Schema.Types.ObjectId,
      ref: "ContentInventorySnapshot",
      default: null,
      index: true,
    },
    contentOpportunityDecisionId: {
      type: Schema.Types.ObjectId,
      ref: "ContentOpportunityDecision",
      default: null,
      index: true,
    },
    contentWorkOrderId: {
      type: Schema.Types.ObjectId,
      ref: "ContentWorkOrder",
      default: null,
      index: true,
    },
    unifiedContentBriefId: {
      type: Schema.Types.ObjectId,
      ref: "UnifiedContentBrief",
      default: null,
      index: true,
    },
    selectedDecision: { type: String, default: "", index: true },
    candidates: { type: [Schema.Types.Mixed], default: [] },
    rejectedDecisions: { type: [Schema.Types.Mixed], default: [] },
    sourceHealth: { type: Schema.Types.Mixed, default: () => ({}) },
    sourceFreshness: { type: Schema.Types.Mixed, default: () => ({}) },
    pipelineSteps: { type: [Schema.Types.Mixed], default: [] },
    warnings: { type: [Schema.Types.Mixed], default: [] },
    errorDetails: { type: [Schema.Types.Mixed], default: [] },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
    triggeredByAdminId: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
  },
  { collection: "ContentOperationsRuns", timestamps: true },
);

schema.index({ createdAt: -1, status: 1 });
schema.index({ qaBatchId: 1, qaCaseId: 1 }, { name: 'qa_content_operations_run' });

module.exports = {
  ContentOperationsRun: model("ContentOperationsRun", schema),
};
