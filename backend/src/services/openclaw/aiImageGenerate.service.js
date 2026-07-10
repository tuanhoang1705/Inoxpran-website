'use strict'

const { normalizeString } = require('../../utils/seoBlogSanitizer');

const SUPPORTED_PROVIDERS = new Set(['disabled', 'openai', 'stability', 'replicate']);

const getConfig = () => {
    const provider = normalizeString(process.env.AI_IMAGE_PROVIDER || 'disabled').toLowerCase();
    return {
        provider: SUPPORTED_PROVIDERS.has(provider) ? provider : 'disabled',
        apiKey: normalizeString(process.env.AI_IMAGE_API_KEY)
    };
};

const generateOpenAi = async ({ prompt, apiKey }) => {
    const model = normalizeString(process.env.AI_IMAGE_MODEL || 'gpt-image-2');
    const response = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model,
            prompt: prompt.positivePrompt,
            size: '1536x1024',
            quality: normalizeString(process.env.AI_IMAGE_QUALITY || 'medium'),
            output_format: 'png'
        }),
        signal: AbortSignal.timeout(Number(process.env.IMAGE_GENERATION_TIMEOUT_MS || 120000))
    });
    if (!response.ok) throw new Error(`ai_image_openai_http_${response.status}`);
    const payload = await response.json();
    const item = payload?.data?.[0];
    if (item?.b64_json) {
        return { buffer: Buffer.from(item.b64_json, 'base64'), mimeType: 'image/png', model };
    }
    if (item?.url) return { downloadUrl: item.url, model };
    throw new Error('ai_image_openai_empty_result');
};

const generateStability = async ({ prompt, apiKey }) => {
    const model = normalizeString(process.env.AI_IMAGE_MODEL || 'stable-image-core');
    const form = new FormData();
    form.set('prompt', prompt.positivePrompt);
    form.set('negative_prompt', prompt.negativePrompt);
    form.set('aspect_ratio', '16:9');
    form.set('output_format', 'png');
    const response = await fetch('https://api.stability.ai/v2beta/stable-image/generate/core', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: 'image/*'
        },
        body: form,
        signal: AbortSignal.timeout(Number(process.env.IMAGE_GENERATION_TIMEOUT_MS || 120000))
    });
    if (!response.ok) throw new Error(`ai_image_stability_http_${response.status}`);
    return {
        buffer: Buffer.from(await response.arrayBuffer()),
        mimeType: normalizeString(response.headers.get('content-type')) || 'image/png',
        model
    };
};

const generateReplicate = async ({ prompt, apiKey }) => {
    const model = normalizeString(process.env.AI_IMAGE_REPLICATE_MODEL);
    if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(model)) {
        return { status: 'skipped', reason: 'replicate_model_missing' };
    }
    const response = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            Prefer: 'wait=60'
        },
        body: JSON.stringify({
            input: {
                prompt: prompt.positivePrompt,
                negative_prompt: prompt.negativePrompt,
                aspect_ratio: '16:9',
                output_format: 'png'
            }
        }),
        signal: AbortSignal.timeout(Number(process.env.IMAGE_GENERATION_TIMEOUT_MS || 120000))
    });
    if (!response.ok) throw new Error(`ai_image_replicate_http_${response.status}`);
    const payload = await response.json();
    if (payload.status !== 'succeeded') {
        return { status: 'pending_generation', reason: `replicate_${payload.status || 'pending'}`, model };
    }
    const output = Array.isArray(payload.output) ? payload.output[0] : payload.output;
    if (typeof output !== 'string') throw new Error('ai_image_replicate_empty_result');
    return { downloadUrl: output, model };
};

const generateImage = async ({ prompt } = {}) => {
    const config = getConfig();
    if (config.provider === 'disabled') {
        return { status: 'skipped', reason: 'ai_image_generation_disabled', provider: config.provider };
    }
    if (!config.apiKey) {
        return { status: 'skipped', reason: 'ai_image_api_key_missing', provider: config.provider };
    }

    const handlers = {
        openai: generateOpenAi,
        stability: generateStability,
        replicate: generateReplicate
    };
    const result = await handlers[config.provider]({ prompt, apiKey: config.apiKey });
    return {
        status: result.status || 'complete',
        provider: config.provider,
        ...result
    };
};

module.exports = {
    generateImage,
    getConfig
};
