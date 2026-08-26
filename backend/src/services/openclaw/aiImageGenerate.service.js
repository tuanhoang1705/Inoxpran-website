'use strict'

const { normalizeString } = require('../../utils/seoBlogSanitizer');

const SUPPORTED_PROVIDERS = new Set(['disabled', 'openai', '9router', 'stability', 'replicate']);

const createAiImageProviderError = ({
    code,
    status,
    message,
    providerStatus = 0,
    providerRequestId = '',
    providerErrorCode = '',
    providerErrorType = '',
    provider = 'openai',
    blockUngroundedFallback = true
}) => {
    const error = new Error(message);
    error.name = 'AIImageProviderError';
    error.code = code;
    error.publicCode = code;
    error.status = status;
    error.provider = provider;
    error.providerStatus = providerStatus;
    error.providerRequestId = String(providerRequestId || '').slice(0, 128);
    error.providerErrorCode = String(providerErrorCode || '').slice(0, 80);
    error.providerErrorType = String(providerErrorType || '').slice(0, 80);
    error.blockUngroundedFallback = blockUngroundedFallback;
    return error;
};

const normalizeProviderToken = (value) => String(value || '').trim().toLowerCase().slice(0, 80);

const classifyOpenAiError = ({ response, payload, provider = 'openai' }) => {
    const providerStatus = Number(response?.status) || 0;
    const providerRequestId = response?.headers?.get?.('x-request-id') || '';
    const providerErrorCode = normalizeProviderToken(payload?.error?.code);
    const providerErrorType = normalizeProviderToken(payload?.error?.type);
    const providerMessage = String(payload?.error?.message || '').toLowerCase();
    const common = {
        providerStatus,
        providerRequestId,
        providerErrorCode,
        providerErrorType,
        provider
    };

    if (
        providerErrorType === 'insufficient_quota' ||
        providerErrorCode === 'credit_balance_exhausted' ||
        providerErrorCode === 'insufficient_quota' ||
        providerMessage.includes('no credits remaining') ||
        providerMessage.includes('current quota')
    ) {
        return createAiImageProviderError({
            ...common,
            code: 'AI_IMAGE_CREDIT_EXHAUSTED',
            status: 503,
            message: 'AI image generation credit is exhausted'
        });
    }
    if (providerStatus === 401 || providerErrorCode === 'invalid_api_key') {
        return createAiImageProviderError({
            ...common,
            code: 'AI_IMAGE_AUTH_FAILED',
            status: 503,
            message: 'AI image provider authentication failed'
        });
    }
    if (
        providerStatus === 403 ||
        providerErrorCode === 'model_not_found' ||
        providerErrorCode === 'permission_denied'
    ) {
        return createAiImageProviderError({
            ...common,
            code: 'AI_IMAGE_ACCESS_DENIED',
            status: 503,
            message: 'AI image provider access is not available'
        });
    }
    if (
        providerErrorCode.includes('content_policy') ||
        providerErrorType.includes('policy') ||
        providerMessage.includes('safety system')
    ) {
        return createAiImageProviderError({
            ...common,
            code: 'AI_IMAGE_POLICY_REJECTED',
            status: 422,
            message: 'The image prompt was rejected by the provider policy'
        });
    }
    if (providerStatus === 429) {
        return createAiImageProviderError({
            ...common,
            code: 'AI_IMAGE_RATE_LIMITED',
            status: 429,
            message: 'AI image generation is temporarily rate limited'
        });
    }
    if (providerStatus === 400 || providerStatus === 422) {
        return createAiImageProviderError({
            ...common,
            code: 'AI_IMAGE_REQUEST_REJECTED',
            status: 422,
            message: 'The AI image provider rejected the image request',
            blockUngroundedFallback: false
        });
    }
    return createAiImageProviderError({
        ...common,
        code: 'AI_IMAGE_PROVIDER_UNAVAILABLE',
        status: 502,
        message: 'AI image provider is temporarily unavailable',
        blockUngroundedFallback: false
    });
};

const requestOpenAi = async ({ url, options, provider = 'openai' }) => {
    let response;
    try {
        response = await fetch(url, options);
    } catch (cause) {
        const timedOut = cause?.name === 'AbortError' || cause?.name === 'TimeoutError';
        throw createAiImageProviderError({
            code: timedOut ? 'AI_IMAGE_TIMEOUT' : 'AI_IMAGE_PROVIDER_UNAVAILABLE',
            status: timedOut ? 504 : 502,
            message: timedOut
                ? 'AI image provider timed out'
                : 'AI image provider could not be reached',
            provider,
            blockUngroundedFallback: false
        });
    }

    let payload = null;
    try {
        payload = await response.json();
    } catch {
        if (!response.ok) throw classifyOpenAiError({ response, payload: null, provider });
        throw createAiImageProviderError({
            code: 'AI_IMAGE_INVALID_RESPONSE',
            status: 502,
            message: 'AI image provider returned an invalid response',
            providerStatus: Number(response.status) || 0,
            providerRequestId: response.headers?.get?.('x-request-id') || '',
            provider,
            blockUngroundedFallback: false
        });
    }
    if (!response.ok) throw classifyOpenAiError({ response, payload, provider });
    return {
        payload,
        providerRequestId: response.headers?.get?.('x-request-id') || ''
    };
};

const getConfig = () => {
    const provider = normalizeString(process.env.AI_IMAGE_PROVIDER || 'disabled').toLowerCase();
    return {
        provider: SUPPORTED_PROVIDERS.has(provider) ? provider : 'disabled',
        // 9router has its own bearer credential. Other providers keep the
        // dedicated image key, with OPENAI_API_KEY only as the OpenAI fallback.
        apiKey: provider === '9router'
            ? normalizeString(process.env.NINE_ROUTER_API_KEY)
            : normalizeString(process.env.AI_IMAGE_API_KEY) ||
                (provider === 'openai' ? normalizeString(process.env.OPENAI_API_KEY) : '')
    };
};

// Grounding the frame on the real catalog photograph is the single biggest gain
// in how real the result looks, because the model no longer has to invent the
// appliance: it renders the one we handed it. Any failure falls back to plain
// generation rather than costing the article its image.
const editOpenAi = async ({ prompt, apiKey, referenceImage, model }) => {
    const form = new FormData();
    form.set('model', model);
    form.set('prompt', prompt.positivePrompt);
    form.set('size', '1536x1024');
    form.set('quality', normalizeString(process.env.AI_IMAGE_QUALITY || 'medium'));
    form.set('image', new Blob([referenceImage.buffer], {
        type: referenceImage.mimeType || 'image/png'
    }), 'reference.png');
    const { payload, providerRequestId } = await requestOpenAi({
        url: 'https://api.openai.com/v1/images/edits',
        options: {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}` },
            body: form,
            signal: AbortSignal.timeout(Number(process.env.IMAGE_GENERATION_TIMEOUT_MS || 120000))
        }
    });
    const item = payload?.data?.[0];
    if (item?.b64_json) {
        return { buffer: Buffer.from(item.b64_json, 'base64'), mimeType: 'image/png', model, grounded: true };
    }
    if (item?.url) return { downloadUrl: item.url, model, grounded: true };
    throw createAiImageProviderError({
        code: 'AI_IMAGE_EMPTY_RESULT',
        status: 502,
        message: 'AI image provider returned no image',
        providerStatus: 200,
        providerRequestId,
        blockUngroundedFallback: false
    });
};

const generateOpenAi = async ({ prompt, apiKey, referenceImage = null }) => {
    const model = normalizeString(process.env.AI_IMAGE_MODEL || 'gpt-image-2');
    if (referenceImage?.buffer?.length) {
        try {
            return await editOpenAi({ prompt, apiKey, referenceImage, model });
        } catch (error) {
            if (error?.blockUngroundedFallback !== false) throw error;
            // Fall through to an ungrounded generation: a less real-looking image
            // is still far better than an article with no image at all.
        }
    }
    const { payload, providerRequestId } = await requestOpenAi({
        url: 'https://api.openai.com/v1/images/generations',
        options: {
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
        }
    });
    const item = payload?.data?.[0];
    if (item?.b64_json) {
        return { buffer: Buffer.from(item.b64_json, 'base64'), mimeType: 'image/png', model };
    }
    if (item?.url) return { downloadUrl: item.url, model };
    throw createAiImageProviderError({
        code: 'AI_IMAGE_EMPTY_RESULT',
        status: 502,
        message: 'AI image provider returned no image',
        providerStatus: 200,
        providerRequestId
    });
};

const generateNineRouter = async ({ prompt, apiKey }) => {
    const model = normalizeString(process.env.AI_IMAGE_MODEL || 'cx/gpt-5.5-image');
    const { payload, providerRequestId } = await requestOpenAi({
        url: 'http://nine-router:20128/v1/images/generations',
        provider: '9router',
        options: {
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
                output_format: 'png',
                response_format: 'b64_json'
            }),
            signal: AbortSignal.timeout(Number(process.env.IMAGE_GENERATION_TIMEOUT_MS || 120000))
        }
    });
    const item = payload?.data?.[0];
    if (item?.b64_json) {
        return { buffer: Buffer.from(item.b64_json, 'base64'), mimeType: 'image/png', model };
    }
    if (item?.url) return { downloadUrl: item.url, model };
    throw createAiImageProviderError({
        code: 'AI_IMAGE_EMPTY_RESULT',
        status: 502,
        message: 'AI image provider returned no image',
        providerStatus: 200,
        providerRequestId,
        provider: '9router'
    });
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

const generateImage = async ({ prompt, referenceImage = null } = {}) => {
    const config = getConfig();
    if (config.provider === 'disabled') {
        return { status: 'skipped', reason: 'ai_image_generation_disabled', provider: config.provider };
    }
    if (!config.apiKey) {
        return { status: 'skipped', reason: 'ai_image_api_key_missing', provider: config.provider };
    }

    const handlers = {
        openai: generateOpenAi,
        '9router': generateNineRouter,
        stability: generateStability,
        replicate: generateReplicate
    };
    const result = await handlers[config.provider]({ prompt, apiKey: config.apiKey, referenceImage });
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
