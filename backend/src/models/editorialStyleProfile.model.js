'use strict'

const { Schema, model } = require('mongoose');

const styleProfileSchema = new Schema(
    {
        isQaTest: { type: Boolean, default: false, index: true },
        qaBatchId: { type: Schema.Types.ObjectId, ref: 'AgenticBlogQaBatch', default: null, index: true },
        qaCaseId: { type: Schema.Types.ObjectId, ref: 'AgenticBlogQaCase', default: null, index: true },
        environment: { type: String, enum: ['', 'local', 'staging'], default: '' },
        executionMode: { type: String, enum: ['', 'run_now', 'schedule_run_now', 'actual_schedule'], default: '' },
        originalTopicSeed: { type: String, default: '', maxlength: 300 },
        normalizedTopicKey: { type: String, default: '', maxlength: 320 },
        date: { type: String, required: true, unique: true, index: true },
        styleFamily: { type: String, required: true, index: true },
        openingMode: { type: String, required: true },
        headingMode: { type: String, required: true },
        paragraphRhythm: { type: String, required: true },
        sentenceLengthDistribution: { type: String, required: true },
        evidenceMode: { type: String, required: true },
        exampleMode: { type: String, required: true },
        ctaMode: { type: String, required: true },
        visualPlanMode: { type: String, required: true },
        answerBlockMode: { type: String, required: true },
        forbiddenRecentPatterns: { type: [String], default: [] },
        brandVoiceConstraints: { type: [String], default: [] },
        structuralFingerprintTarget: { type: Schema.Types.Mixed, default: () => ({}) },
        usageCount: { type: Number, default: 0, min: 0 },
        articleVariants: { type: [Schema.Types.Mixed], default: [] }
    },
    { collection: 'EditorialStyleProfiles', timestamps: true }
);

styleProfileSchema.index({ qaBatchId: 1, qaCaseId: 1 }, { name: 'qa_editorial_style_profile' });

module.exports = { EditorialStyleProfile: model('EditorialStyleProfile', styleProfileSchema) };
