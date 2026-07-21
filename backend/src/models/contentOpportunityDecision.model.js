"use strict";

const { Schema, model } = require("mongoose");
const { ACTIONS } = require("../config/contentOperations.config");

const ACTION_VALUES = Object.freeze(Object.values(ACTIONS));

const contentOpportunityDecisionSchema = new Schema(
  {
    contentOperationsSnapshotId: {
      type: Schema.Types.ObjectId,
      ref: "ContentOperationsDailySnapshot",
      required: true,
      index: true,
    },
    contentInventorySnapshotId: {
      type: Schema.Types.ObjectId,
      ref: "ContentInventorySnapshot",
      default: null,
      index: true,
    },
    planningRunId: {
      type: Schema.Types.ObjectId,
      ref: "ContentOperationsRun",
      default: null,
      index: true,
    },
    candidateId: { type: String, required: true, trim: true, maxlength: 160 },
    decisionType: {
      type: String,
      enum: ACTION_VALUES,
      required: true,
      index: true,
    },
    topic: { type: String, default: "", trim: true, maxlength: 300 },
    targetBlogIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "BlogPost" }],
      default: [],
    },
    primaryTargetBlogId: {
      type: Schema.Types.ObjectId,
      ref: "BlogPost",
      default: null,
      index: true,
    },
    totalScore: { type: Number, required: true, min: 0, max: 1 },
    scoreBreakdown: { type: Schema.Types.Mixed, default: () => ({}) },
    positiveEvidence: { type: [Schema.Types.Mixed], default: [] },
    penalties: { type: [Schema.Types.Mixed], default: [] },
    requiredData: { type: [String], default: [] },
    missingData: { type: [String], default: [] },
    risks: { type: [String], default: [] },
    recommendedAction: { type: String, enum: ACTION_VALUES, required: true },
    rejectedAlternatives: { type: [Schema.Types.Mixed], default: [] },
    decisionReason: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
    status: {
      type: String,
      enum: ["candidate", "selected", "accepted", "dismissed", "converted"],
      default: "candidate",
      index: true,
    },
    selectedAt: { type: Date, default: null },
    contentHash: {
      type: String,
      default: "",
      trim: true,
      maxlength: 128,
      index: true,
    },
    metadata: { type: Schema.Types.Mixed, default: () => ({}) },
  },
  { collection: "ContentOpportunityDecisions", timestamps: true },
);

contentOpportunityDecisionSchema.index(
  { contentOperationsSnapshotId: 1, candidateId: 1 },
  { unique: true },
);
contentOpportunityDecisionSchema.index({
  contentOperationsSnapshotId: 1,
  totalScore: -1,
  candidateId: 1,
});

module.exports = {
  ACTION_VALUES,
  ContentOpportunityDecision: model(
    "ContentOpportunityDecision",
    contentOpportunityDecisionSchema,
  ),
};
