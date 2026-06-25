import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const crypto = require('node:crypto');
const { Module } = require('node:module');

const { automationAuth } = require('../src/middleware/automationAuth');
const { sanitizeSeoBlogHtml } = require('../src/utils/seoBlogSanitizer');

const ORIGINAL_ENV = { ...process.env };

const blogMock = {
    findOne: vi.fn(),
    create: vi.fn()
};

const installMock = (modulePath, exports) => {
    const resolvedPath = require.resolve(modulePath);
    const mockModule = new Module(resolvedPath);
    mockModule.exports = exports;
    require.cache[resolvedPath] = mockModule;
};

const loadAutomationService = () => {
    installMock('../src/models/blog.model', {
        blog: blogMock,
        BLOG_CATEGORY_KEYS: ['guide', 'care', 'knowledge', 'trend', 'product', 'design']
    });

    [
        '../src/utils/seoBlogValidation',
        '../src/services/automationSeoBlog.service'
    ].forEach((modulePath) => {
        const resolved = require.resolve(modulePath);
        delete require.cache[resolved];
    });

    return require('../src/services/automationSeoBlog.service');
};

const buildResponse = () => {
    const res = {};
    res.status = vi.fn((code) => {
        res.statusCode = code;
        return res;
    });
    res.json = vi.fn((body) => {
        res.body = body;
        return res;
    });
    return res;
};

const signBody = ({ body, secret = 'hmac-secret' }) =>
    crypto.createHmac('sha256', secret).update(body).digest('hex');

const buildRequest = ({ body = Buffer.from('{}'), headers = {} } = {}) => ({
    headers: {
        'x-seo-agent-key': 'agent-key',
        'x-openclaw-timestamp': String(Date.now()),
        'x-openclaw-signature': signBody({ body }),
        ...headers
    },
    rawBody: body,
    socket: {
        remoteAddress: '127.0.0.1'
    }
});

const buildPayload = (overrides = {}) => ({
    mode: 'publish',
    source: 'openclaw-daily-seo',
    primaryKeyword: 'noi inox 304',
    secondaryKeywords: ['noi inox dung bep tu'],
    title: 'Cach chon noi inox 304 cho gia dinh Viet',
    slug: 'cach-chon-noi-inox-304-gia-dinh-viet',
    excerpt: 'Huong dan chon noi inox 304 theo nhu cau nau an hang ngay.',
    contentHtml: `<section><p>${'noi inox 304 '.repeat(40)}</p><h2>Tieu chi chon mua</h2><p>${'bao tri dung cach '.repeat(30)}</p></section>`,
    seoTitle: 'Cach chon noi inox 304',
    seoDescription: 'Huong dan chon noi inox 304 phu hop cho gia dinh Viet.',
    categoryKey: 'guide',
    tags: ['inox 304', 'noi inox', 'Inoxpran'],
    authorName: 'Inoxpran Editorial Team',
    imageUrl: '/images/og-image.png',
    review: {
        seoScore: 90,
        brandSafety: 'pass',
        duplicateRisk: 'low',
        claimRisk: 'low'
    },
    metadata: {
        agentRunId: 'test-run'
    },
    ...overrides
});

beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
        ...ORIGINAL_ENV,
        SEO_AGENT_ENABLED: 'true',
        SEO_AGENT_AUTO_PUBLISH: 'false',
        SEO_AGENT_API_KEY: 'agent-key',
        SEO_AGENT_HMAC_SECRET: 'hmac-secret',
        SEO_AGENT_MIN_SEO_SCORE: '85',
        SEO_AGENT_MIN_WORDS: '1',
        SEO_AGENT_MAX_WORDS: '1000',
        PUBLIC_SITE_URL: 'https://inoxpran.com'
    };

    blogMock.findOne.mockReturnValue({
        select: () => ({
            lean: () => Promise.resolve(null)
        })
    });
    blogMock.create.mockImplementation((doc) => Promise.resolve({
        ...doc,
        _id: '507f1f77bcf86cd799439011',
        toObject() {
            return { ...doc, _id: this._id };
        }
    }));
});

describe('automationAuth', () => {
    it('rejects when x-seo-agent-key is missing', () => {
        const body = Buffer.from('{}');
        const req = buildRequest({
            body,
            headers: {
                'x-seo-agent-key': undefined
            }
        });
        delete req.headers['x-seo-agent-key'];
        const res = buildResponse();
        const next = vi.fn();

        automationAuth(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });

    it('rejects when HMAC is invalid', () => {
        const req = buildRequest({
            headers: {
                'x-openclaw-signature': 'bad-signature'
            }
        });
        const res = buildResponse();
        const next = vi.fn();

        automationAuth(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });

    it('rejects when timestamp is too old', () => {
        const body = Buffer.from('{}');
        const req = buildRequest({
            body,
            headers: {
                'x-openclaw-timestamp': String(Date.now() - 10 * 60 * 1000),
                'x-openclaw-signature': signBody({ body })
            }
        });
        const res = buildResponse();
        const next = vi.fn();

        automationAuth(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });
});

describe('seoBlogSanitizer', () => {
    it('removes script tags and event handlers', () => {
        const result = sanitizeSeoBlogHtml(
            '<section><p onclick="alert(1)">Safe</p><script>alert(1)</script></section>'
        );

        expect(result).not.toContain('<script>');
        expect(result).not.toContain('onclick');
        expect(result).toContain('Safe');
    });
});

describe('AutomationSeoBlogService.publishSeoBlog', () => {
    it('creates draft when SEO_AGENT_AUTO_PUBLISH=false', async () => {
        const AutomationSeoBlogService = loadAutomationService();

        const result = await AutomationSeoBlogService.publishSeoBlog({
            payload: buildPayload({ mode: 'publish' })
        });

        expect(result.published).toBe(false);
        expect(result.mode).toBe('draft');
        expect(result.reasons).toContain('auto_publish_disabled');
        expect(blogMock.create).toHaveBeenCalledWith(expect.objectContaining({
            isDraft: true,
            isPublished: false
        }));
    });

    it('does not publish when seoScore is below threshold', async () => {
        process.env.SEO_AGENT_AUTO_PUBLISH = 'true';
        const AutomationSeoBlogService = loadAutomationService();

        const result = await AutomationSeoBlogService.publishSeoBlog({
            payload: buildPayload({
                review: {
                    seoScore: 70,
                    brandSafety: 'pass',
                    duplicateRisk: 'low',
                    claimRisk: 'low'
                }
            })
        });

        expect(result.published).toBe(false);
        expect(result.reasons).toContain('seo_score_below_85');
    });

    it('does not publish when brandSafety is not pass', async () => {
        process.env.SEO_AGENT_AUTO_PUBLISH = 'true';
        const AutomationSeoBlogService = loadAutomationService();

        const result = await AutomationSeoBlogService.publishSeoBlog({
            payload: buildPayload({
                review: {
                    seoScore: 90,
                    brandSafety: 'fail',
                    duplicateRisk: 'low',
                    claimRisk: 'low'
                }
            })
        });

        expect(result.published).toBe(false);
        expect(result.reasons).toContain('brand_safety_not_pass');
    });

    it('rejects duplicate slug', async () => {
        const AutomationSeoBlogService = loadAutomationService();
        blogMock.findOne.mockReturnValue({
            select: () => ({
                lean: () => Promise.resolve({ _id: 'existing-id' })
            })
        });

        await expect(AutomationSeoBlogService.publishSeoBlog({
            payload: buildPayload()
        })).rejects.toThrow('blog_slug already exists');
    });

    it('publishes when env and review gates pass', async () => {
        process.env.SEO_AGENT_AUTO_PUBLISH = 'true';
        const AutomationSeoBlogService = loadAutomationService();

        const result = await AutomationSeoBlogService.publishSeoBlog({
            payload: buildPayload()
        });

        expect(result.published).toBe(true);
        expect(result.mode).toBe('publish');
        expect(result.reasons).toEqual([]);
        expect(blogMock.create).toHaveBeenCalledWith(expect.objectContaining({
            isDraft: false,
            isPublished: true,
            publishedAt: expect.any(Date)
        }));
    });
});
