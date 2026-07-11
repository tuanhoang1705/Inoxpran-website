'use strict'

const { Schema, model } = require('mongoose');

const styleProfileSchema = new Schema(
    {
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

module.exports = { EditorialStyleProfile: model('EditorialStyleProfile', styleProfileSchema) };
