'use strict';

const DEFAULT_OPENAI_BLOG_MODEL = '';
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;

const configured = (value) => String(value || '').trim();
const validModel = (value) => {
    const model = configured(value);
    return MODEL_ID.test(model) ? model : '';
};

const resolveBlogWriterModel = (env = process.env) =>
    validModel(env.OPENAI_WRITER_MODEL);

const resolveBlogIdeationModel = (env = process.env) =>
    validModel(env.OPENAI_IDEATION_MODEL);

const modelConfigurationError = (code) => Object.assign(
    new Error('An explicit supported OpenAI blog model is required'),
    { code, status: 503 }
);

const requireBlogWriterModel = (env = process.env) => {
    const model = resolveBlogWriterModel(env);
    if (!model) throw modelConfigurationError('OPENAI_WRITER_MODEL_REQUIRED');
    return model;
};

const requireBlogIdeationModel = (env = process.env) => {
    const model = resolveBlogIdeationModel(env);
    if (!model) throw modelConfigurationError('OPENAI_IDEATION_MODEL_REQUIRED');
    return model;
};

const getOpenAiBlogModelReadiness = (env = process.env) => {
    const writerModel = resolveBlogWriterModel(env);
    const ideationModel = resolveBlogIdeationModel(env);
    return Object.freeze({
        ready: Boolean(writerModel && ideationModel),
        writerModel,
        ideationModel,
        missing: [
            ...(!writerModel ? ['OPENAI_WRITER_MODEL'] : []),
            ...(!ideationModel ? ['OPENAI_IDEATION_MODEL'] : [])
        ]
    });
};

module.exports = {
    DEFAULT_OPENAI_BLOG_MODEL,
    MODEL_ID,
    getOpenAiBlogModelReadiness,
    requireBlogIdeationModel,
    requireBlogWriterModel,
    resolveBlogIdeationModel,
    resolveBlogWriterModel,
    validModel
};
