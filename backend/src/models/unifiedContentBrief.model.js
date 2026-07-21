"use strict";

const { Schema, model } = require("mongoose");

const unifiedContentBriefSchema = new Schema(
  {
    contentWorkOrderId: {
      type: Schema.Types.ObjectId,
      ref: "ContentWorkOrder",
      required: true,
      index: true,
    },
    planningRunId: {
      type: Schema.Types.ObjectId,
      ref: "ContentOperationsRun",
      default: null,
      index: true,
    },
    version: { type: Number, default: 1, min: 1 },
    status: {
      type: String,
      enum: ["draft", "complete", "superseded"],
      default: "complete",
      index: true,
    },
    topic: { type: String, required: true, trim: true, maxlength: 300 },
    workingTitle: { type: String, required: true, trim: true, maxlength: 300 },
    language: { type: String, enum: ["vi", "en"], default: "vi" },
    primaryBusinessGoal: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    secondaryBusinessGoals: { type: [String], default: [] },
    targetAudience: { type: [String], required: true },
    funnelStage: { type: String, required: true, trim: true, maxlength: 100 },
    primarySearchIntent: {
      type: String,
      required: true,
      trim: true,
      maxlength: 300,
    },
    secondarySearchIntents: { type: [String], default: [] },
    primaryQuestion: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    supportingQuestions: { type: [String], default: [] },
    articleType: { type: String, required: true, trim: true, maxlength: 100 },
    contentRole: { type: String, required: true, trim: true, maxlength: 120 },
    editorialAngle: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },
    primaryTerms: { type: [String], default: [] },
    relatedTerms: { type: [String], default: [] },
    requiredEntities: { type: [String], default: [] },
    contentGap: { type: [String], default: [] },
    existingContentReferences: { type: [Schema.Types.Mixed], default: [] },
    targetBlogId: {
      type: Schema.Types.ObjectId,
      ref: "BlogPost",
      default: null,
      index: true,
    },
    internalLinkCandidates: { type: [Schema.Types.Mixed], default: [] },
    categoryLinkCandidates: { type: [Schema.Types.Mixed], default: [] },
    productIntegration: {
      type: Schema.Types.Mixed,
      default: () => ({ mode: "off" }),
    },
    requiredFacts: { type: [Schema.Types.Mixed], default: [] },
    forbiddenClaims: { type: [String], default: [] },
    evidenceRequirements: { type: [Schema.Types.Mixed], default: [] },
    editorialStyleConstraints: {
      type: Schema.Types.Mixed,
      default: () => ({}),
    },
    productPlacementConstraints: {
      type: Schema.Types.Mixed,
      default: () => ({}),
    },
    imagePlanRequirements: { type: [Schema.Types.Mixed], default: [] },
    ctaStrategy: { type: Schema.Types.Mixed, required: true },
    structuredDataCandidate: { type: String, default: null, maxlength: 100 },
    successMetrics: { type: [Schema.Types.Mixed], required: true },
    publishTarget: { type: Schema.Types.Mixed, required: true },
    reviewRequirements: { type: [String], required: true },
    contentHash: {
      type: String,
      required: true,
      trim: true,
      maxlength: 128,
      index: true,
    },
  },
  { collection: "UnifiedContentBriefs", timestamps: true },
);

unifiedContentBriefSchema.index(
  { contentWorkOrderId: 1, version: 1 },
  { unique: true },
);

module.exports = {
  UnifiedContentBrief: model("UnifiedContentBrief", unifiedContentBriefSchema),
};
