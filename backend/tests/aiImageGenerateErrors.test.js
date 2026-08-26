import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { generateImage } = require('../src/services/openclaw/aiImageGenerate.service');

const ORIGINAL_ENV = { ...process.env };
const prompt = {
  positivePrompt: 'A natural editorial photograph of stainless steel cookware',
  negativePrompt: 'text, logo',
};

const failedResponse = ({ status, type = '', code = '', message = '', requestId = 'req_test' }) => ({
  ok: false,
  status,
  headers: { get: (name) => name.toLowerCase() === 'x-request-id' ? requestId : '' },
  json: async () => ({ error: { type, code, message } }),
});

beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    AI_IMAGE_PROVIDER: 'openai',
    AI_IMAGE_API_KEY: 'test-image-key',
    AI_IMAGE_MODEL: 'gpt-image-2',
  };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

describe('OpenAI image provider failures', () => {
  it('classifies exhausted credit separately from transient rate limiting', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => failedResponse({
      status: 429,
      type: 'insufficient_quota',
      code: 'credit_balance_exhausted',
      message: 'You have no credits remaining. secret-provider-detail',
      requestId: 'req_credit_test',
    })));

    await expect(generateImage({ prompt })).rejects.toMatchObject({
      name: 'AIImageProviderError',
      code: 'AI_IMAGE_CREDIT_EXHAUSTED',
      publicCode: 'AI_IMAGE_CREDIT_EXHAUSTED',
      status: 503,
      providerStatus: 429,
      providerErrorCode: 'credit_balance_exhausted',
      providerRequestId: 'req_credit_test',
    });
    await expect(generateImage({ prompt })).rejects.not.toThrow('secret-provider-detail');
  });

  it.each([
    [401, 'invalid_request_error', 'invalid_api_key', 'AI_IMAGE_AUTH_FAILED', 503],
    [403, 'permission_error', 'permission_denied', 'AI_IMAGE_ACCESS_DENIED', 503],
    [429, 'rate_limit_error', 'rate_limit_exceeded', 'AI_IMAGE_RATE_LIMITED', 429],
    [400, 'invalid_request_error', 'content_policy_violation', 'AI_IMAGE_POLICY_REJECTED', 422],
    [400, 'invalid_request_error', 'invalid_value', 'AI_IMAGE_REQUEST_REJECTED', 422],
    [500, 'server_error', 'internal_error', 'AI_IMAGE_PROVIDER_UNAVAILABLE', 502],
  ])('maps upstream %i/%s to %s', async (providerStatus, type, code, expectedCode, status) => {
    vi.stubGlobal('fetch', vi.fn(async () => failedResponse({ providerStatus, status: providerStatus, type, code })));

    await expect(generateImage({ prompt })).rejects.toMatchObject({
      code: expectedCode,
      publicCode: expectedCode,
      status,
      providerStatus,
    });
  });

  it('returns a safe timeout classification without retaining transport details', async () => {
    const timeout = Object.assign(new Error('socket secret detail'), { name: 'TimeoutError' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw timeout; }));

    let caught;
    try {
      await generateImage({ prompt });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      code: 'AI_IMAGE_TIMEOUT',
      publicCode: 'AI_IMAGE_TIMEOUT',
      status: 504,
    });
    expect(caught.message).not.toContain('secret');
  });

  it('routes image generation through the private 9router Images API', async () => {
    process.env.AI_IMAGE_PROVIDER = '9router';
    process.env.AI_IMAGE_API_KEY = 'must-not-be-used-for-9router';
    process.env.NINE_ROUTER_API_KEY = 'test-nine-router-key';
    process.env.AI_IMAGE_MODEL = 'cx/gpt-5.5-image';
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => '' },
      json: async () => ({ data: [{ b64_json: Buffer.from('image-bytes').toString('base64') }] }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateImage({ prompt });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('http://nine-router:20128/v1/images/generations');
    expect(options.headers.Authorization).toBe('Bearer test-nine-router-key');
    expect(JSON.parse(options.body)).toMatchObject({
      model: 'cx/gpt-5.5-image',
      response_format: 'b64_json',
    });
    expect(result).toMatchObject({
      status: 'complete',
      provider: '9router',
      model: 'cx/gpt-5.5-image',
      mimeType: 'image/png',
    });
    expect(result.buffer.toString()).toBe('image-bytes');
  });

  it('attributes compatible upstream failures to 9router', async () => {
    process.env.AI_IMAGE_PROVIDER = '9router';
    process.env.AI_IMAGE_API_KEY = '';
    process.env.NINE_ROUTER_API_KEY = 'test-nine-router-key';
    process.env.AI_IMAGE_MODEL = 'cx/gpt-5.5-image';
    vi.stubGlobal('fetch', vi.fn(async () => failedResponse({
      status: 429,
      type: 'rate_limit_error',
      code: 'rate_limit_exceeded',
    })));

    await expect(generateImage({ prompt })).rejects.toMatchObject({
      provider: '9router',
      code: 'AI_IMAGE_RATE_LIMITED',
      status: 429,
    });
  });
});
