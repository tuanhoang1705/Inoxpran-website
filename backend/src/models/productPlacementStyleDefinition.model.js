'use strict'

const { Schema, model } = require('mongoose');

const schema = new Schema({
    styleId: { type: String, required: true, unique: true },
    family: { type: String, required: true },
    ranking: { type: Boolean, default: false },
    presentation: { type: String, default: 'recommendation' },
    enabled: { type: Boolean, default: true, index: true },
    cooldownDays: { type: Number, default: 5, min: 0, max: 30 },
    lastUsedAt: { type: Date, default: null },
    useCount: { type: Number, default: 0, min: 0 },
    rules: { type: Schema.Types.Mixed, default: () => ({}) }
}, { collection: 'ProductPlacementStyleDefinitions', timestamps: true });

module.exports = { ProductPlacementStyleDefinition: model('ProductPlacementStyleDefinition', schema) };
