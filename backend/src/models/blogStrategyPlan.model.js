'use strict'

const { Schema, model } = require('mongoose');

const strategyPlanSchema = new Schema(
    {
        googleIntelSnapshotId: { type: Schema.Types.ObjectId, ref: 'GoogleIntelligenceSnapshot', required: true, index: true },
        topic: { type: String, required: true, maxlength: 300 },
        decision: { type: String, enum: ['new', 'update', 'merge', 'skip'], required: true, index: true },
        decisionReason: { type: String, required: true, maxlength: 1000 },
        targetBlogIds: { type: [{ type: Schema.Types.ObjectId, ref: 'BlogPost' }], default: [] },
        targetAudience: { type: String, required: true },
        searchIntent: { type: Schema.Types.Mixed, required: true },
        userProblems: { type: [String], default: [] },
        contentGap: { type: String, default: '' },
        primaryQuestion: { type: String, required: true },
        supportingQuestions: { type: [String], default: [] },
        articleType: { type: String, required: true },
        editorialStyleProfileId: { type: Schema.Types.ObjectId, ref: 'EditorialStyleProfile', required: true, index: true },
        researchBundleId: { type: Schema.Types.ObjectId, ref: 'ResearchBundle', required: true, index: true },
        evidenceRequirements: { type: [String], default: [] },
        internalLinks: { type: [Schema.Types.Mixed], default: [] },
        imagePlan: { type: Schema.Types.Mixed, default: () => ({}) },
        structuredDataCandidate: { type: String, default: 'Article' },
        riskFlags: { type: [String], default: [] },
        successCriteria: { type: [String], default: [] },
        contentArchitecture: { type: Schema.Types.Mixed, default: () => ({}) },
        reviewerPlan: { type: Schema.Types.Mixed, default: () => ({}) }
    },
    { collection: 'BlogStrategyPlans', timestamps: true }
);

module.exports = { BlogStrategyPlan: model('BlogStrategyPlan', strategyPlanSchema) };
