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
    create: vi.fn(),
    findByIdAndUpdate: vi.fn()
};
const ensureGoogleSnapshotMock = vi.fn();

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
    installMock('../src/services/googleIntelligence.service', {
        GoogleIntelligenceService: {
            ensureGoogleIntelligenceSnapshotForDate: ensureGoogleSnapshotMock
        }
    });
    installMock('../src/services/agenticBlogCore.service', {
        AgenticBlogCoreService: { prepareContext: vi.fn() }
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
        claimRisk: 'low',
        imageSafety: 'pass',
        factuality: 'pass',
        originality: 'pass',
        peopleFirst: 'pass',
        spamRisk: 'low',
        seoAeoGeo: 'pass'
    },
    metadata: {
        agentRunId: 'test-run'
    },
    googleIntelSnapshotId: '507f1f77bcf86cd799439021',
    googleIntelSnapshotDate: '2026-07-11',
    googleIntelStatus: 'completed_no_change',
    researchBundleId: '507f1f77bcf86cd799439022',
    editorialStyleProfileId: '507f1f77bcf86cd799439023',
    strategyPlanId: '507f1f77bcf86cd799439024',
    agenticExecutionId: '507f1f77bcf86cd799439025',
    contentDecision: 'new',
    structuralFingerprint: { hash: 'fingerprint' },
    agenticReviews: {},
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
        OPENCLAW_IMAGE_PIPELINE_ENABLED: 'true',
        OPENCLAW_REQUIRE_COVER_IMAGE_FOR_PUBLISH: 'true',
        IMAGE_SEARCH_PROVIDER: 'disabled',
        AI_IMAGE_PROVIDER: 'disabled',
        PUBLIC_SITE_URL: 'https://inoxpran.com'
    };

    ensureGoogleSnapshotMock.mockResolvedValue({
        id: '507f1f77bcf86cd799439021',
        snapshotDate: '2026-07-11',
        status: 'completed_no_change'
    });

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
    blogMock.findByIdAndUpdate.mockImplementation((id, update) => Promise.resolve({
        ...update.$set,
        _id: id,
        toObject() { return { ...update.$set, _id: id }; }
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
                    claimRisk: 'low',
                    imageSafety: 'pass',
                    factuality: 'pass',
                    originality: 'pass',
                    peopleFirst: 'pass',
                    spamRisk: 'low',
                    seoAeoGeo: 'pass'
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
                    claimRisk: 'low',
                    imageSafety: 'pass',
                    factuality: 'pass',
                    originality: 'pass',
                    peopleFirst: 'pass',
                    spamRisk: 'low',
                    seoAeoGeo: 'pass'
                }
            })
        });

        expect(result.published).toBe(false);
        expect(result.reasons).toContain('brand_safety_not_pass');
    });

    it('does not publish when imageSafety is not pass', async () => {
        process.env.SEO_AGENT_AUTO_PUBLISH = 'true';
        const AutomationSeoBlogService = loadAutomationService();

        const result = await AutomationSeoBlogService.publishSeoBlog({
            payload: buildPayload({
                review: {
                    seoScore: 90,
                    brandSafety: 'pass',
                    duplicateRisk: 'low',
                    claimRisk: 'low',
                    imageSafety: 'fail',
                    factuality: 'pass',
                    originality: 'pass',
                    peopleFirst: 'pass',
                    spamRisk: 'low',
                    seoAeoGeo: 'pass'
                }
            })
        });

        expect(result.published).toBe(false);
        expect(result.reasons).toContain('image_safety_not_pass');
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

    it('rejects a writer payload without mandatory strategy context', async () => {
        const AutomationSeoBlogService = loadAutomationService();
        await expect(AutomationSeoBlogService.publishSeoBlog({
            payload: buildPayload({ strategyPlanId: '' })
        })).rejects.toThrow('Agentic writer context is missing');
        expect(ensureGoogleSnapshotMock).not.toHaveBeenCalled();
    });

    it('rejects a payload that references a different daily snapshot', async () => {
        const AutomationSeoBlogService = loadAutomationService();
        await expect(AutomationSeoBlogService.publishSeoBlog({
            payload: buildPayload({ googleIntelSnapshotId: '507f1f77bcf86cd799439099' })
        })).rejects.toThrow('does not match the current daily snapshot');
    });

    it('publishes when env and review gates pass', async () => {
        process.env.SEO_AGENT_AUTO_PUBLISH = 'true';
        process.env.OPENCLAW_IMAGE_PIPELINE_ENABLED = 'false';
        process.env.OPENCLAW_REQUIRE_COVER_IMAGE_FOR_PUBLISH = 'false';
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

    it('blocks publish when a reviewed cover is required but unavailable', async () => {
        process.env.SEO_AGENT_AUTO_PUBLISH = 'true';
        process.env.OPENCLAW_REQUIRE_COVER_IMAGE_FOR_PUBLISH = 'true';
        const AutomationSeoBlogService = loadAutomationService();

        const result = await AutomationSeoBlogService.publishSeoBlog({
            payload: buildPayload()
        });

        expect(result.published).toBe(false);
        expect(result.mode).toBe('draft');
        expect(result.reasons).toContain('cover_image_required_for_publish');
        expect(result.imagePipelineStatus).toBe('pending');
    });

    it('blocks publish while any planned image is still pending', async () => {
        process.env.SEO_AGENT_AUTO_PUBLISH = 'true';
        process.env.OPENCLAW_REQUIRE_COVER_IMAGE_FOR_PUBLISH = 'false';
        const AutomationSeoBlogService = loadAutomationService();

        const result = await AutomationSeoBlogService.publishSeoBlog({
            payload: buildPayload()
        });

        expect(result.published).toBe(false);
        expect(result.reasons).toContain('image_pipeline_not_ready_for_publish');
    });
});
