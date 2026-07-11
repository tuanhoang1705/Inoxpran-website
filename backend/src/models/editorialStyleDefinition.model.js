'use strict'

const { Schema, model } = require('mongoose');

const styleDefinitionSchema = new Schema(
    {
        styleFamily: { type: String, required: true, unique: true, index: true },
        enabled: { type: Boolean, default: true, index: true },
        cooldownDays: { type: Number, default: 7, min: 1, max: 30 },
        locked: { type: Boolean, default: false },
        description: { type: String, default: '', maxlength: 500 },
        lastUsedAt: { type: Date, default: null },
        useCount: { type: Number, default: 0, min: 0 }
    },
    { collection: 'EditorialStyleDefinitions', timestamps: true }
);

module.exports = { EditorialStyleDefinition: model('EditorialStyleDefinition', styleDefinitionSchema) };
