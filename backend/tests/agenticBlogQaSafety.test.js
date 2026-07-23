import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    OpenClawSeniorBlogAuditorAdapter,
    SeniorBlogAuditorUnavailableError,
    assertQaAuditorEnabled,
    isPrivateGatewayHost,
    parseJsonOnly,
    readBoundedText,
    resolvePrivateGatewayUrl
} = require('../src/services/seniorBlogAuditorAdapter.service');
const {
    buildProductCatalogLineage,
    buildRetainedExecutionIterationFilter,
    buildHtmlMetrics,
    countUnsafeHtml,
    isProductCatalogRequired,
    isSafeCanonical,
    isSafeCanonicalForBlog
} = require('../src/services/agenticBlogQaEvidence.service');

const auditorEnv = (overrides = {}) => ({
    AGENTIC_BLOG_QA_ENABLED: 'true',
    AGENTIC_BLOG_QA_ENVIRONMENT: 'local',
    SENIOR_BLOG_AUDITOR_ENABLED: 'true',
    OPENCLAW_GATEWAY_HTTP_URL: 'http://127.0.0.1:18789',
    OPENCLAW_GATEWAY_TOKEN: 'operator-token-for-test',
    SENIOR_BLOG_AUDITOR_TIMEOUT_MS: '1000',
    ...overrides
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('QA persisted HTML and URL security gates', () => {
    it('treats product-off catalog lineage as not applicable while auto and required fail closed', () => {
        expect(isProductCatalogRequired('off')).toBe(false);
        expect(isProductCatalogRequired('auto')).toBe(true);
        expect(isProductCatalogRequired('required')).toBe(true);

        expect(buildProductCatalogLineage({
            productMode: 'off',
            execution: {},
            productSeedPlan: {},
            placementPlan: {},
            productCatalogSnapshot: null
        })).toEqual({
            required: false,
            requiredArtifactMissing: false,
            valid: true,
            linkedChecks: [],
            summary: { id: '', status: 'not_applicable', productCount: 0, eligibleProductCount: 0, catalogHash: '', provenanceClass: 'not_applicable' }
        });

        for (const productMode of ['auto', 'required']) {
            expect(buildProductCatalogLineage({ productMode, productCatalogSnapshot: null })).toMatchObject({
                required: true,
                requiredArtifactMissing: true,
                valid: false,
                summary: null
            });
        }
    });

    it('requires every product catalog link and a usable snapshot outside product-off mode', () => {
        const snapshot = { _id: 'catalog-1', status: 'complete', productCount: 4, eligibleProductCount: 2, catalogHash: 'hash' };
        const valid = buildProductCatalogLineage({
            productMode: 'auto',
            execution: { productCatalogSnapshotId: 'catalog-1' },
            productSeedPlan: { productCatalogSnapshotId: 'catalog-1' },
            placementPlan: { productCatalogSnapshotId: 'catalog-1' },
            productCatalogSnapshot: snapshot
        });
        expect(valid).toMatchObject({ required: true, requiredArtifactMissing: false, valid: true });
        expect(valid.linkedChecks.every(([, pass]) => pass)).toBe(true);

        expect(buildProductCatalogLineage({
            productMode: 'required',
            execution: { productCatalogSnapshotId: 'catalog-1' },
            productSeedPlan: { productCatalogSnapshotId: 'catalog-other' },
            placementPlan: { productCatalogSnapshotId: 'catalog-1' },
            productCatalogSnapshot: snapshot
        })).toMatchObject({ required: true, requiredArtifactMissing: false, valid: false });
    });

    it('checks both the retained execution slot and remediation slot during article re-review', () => {
        expect(buildRetainedExecutionIterationFilter({ executionIteration: 0, batchIteration: 0 })).toBe(0);
        expect(buildRetainedExecutionIterationFilter({ executionIteration: 0, batchIteration: 1 }))
            .toEqual({ $in: [0, 1] });
        expect(buildRetainedExecutionIterationFilter({ executionIteration: 2, batchIteration: 2 })).toBe(2);
    });

    it.each([
        ['script', '<script>alert(1)</script>'],
        ['iframe', '<iframe src="https://example.com"></iframe>'],
        ['object', '<object data="https://example.com/payload"></object>'],
        ['embed', '<embed src="https://example.com/payload">'],
        ['SVG document content', '<svg><circle cx="10" cy="10" r="5"></circle></svg>'],
        ['meta refresh', '<meta http-equiv="refresh" content="0;url=https://evil.example">'],
        ['inline event', '<img src="/safe.webp" onerror="alert(1)">'],
        ['javascript URL', '<a href="javascript:alert(1)">click</a>'],
        ['data URL', '<img src="data:text/html;base64,PHNjcmlwdD4=">'],
        ['protocol-relative URL', '<a href="//evil.example/path">click</a>'],
        ['IPv4 loopback', '<a href="http://127.0.0.1:3000/private">click</a>'],
        ['IPv6 loopback', '<a href="http://[::1]:3000/private">click</a>'],
        ['private DNS suffix', '<a href="https://secrets.internal/path">click</a>'],
        ['credential-like query', '<a href="https://example.com/?access_token=secret-value">click</a>']
    ])('marks %s as unsafe', (_name, html) => {
        expect(countUnsafeHtml(html)).toBeGreaterThan(0);
    });

    it('does not flag ordinary semantic article markup', () => {
        const html = '<article><h2>Safe heading</h2><p>Useful text.</p><a href="/blog/guide">Guide</a></article>';
        expect(countUnsafeHtml(html)).toBe(0);
        expect(buildHtmlMetrics({ blog: { blog_content: html }, qaCase: {} }).unsafeHtmlCount).toBe(0);
    });

    it('derives exact evidence coverage and unsupported-claim counts from retained evidence', () => {
        const blog = { blog_content: '<article><p>Inox 304 is described by retained evidence.</p></article>' };
        const usable = buildHtmlMetrics({
            blog,
            qaCase: {},
            evidenceMap: {
                entries: [{
                    evidenceKey: 'fact-1',
                    claim: 'Inox 304 is described by retained evidence.',
                    status: 'usable',
                    classification: 'verified',
                    internalReferenceId: 'research-1',
                    allowedUsage: 'May be stated directly.'
                }]
            }
        });
        expect(usable).toMatchObject({
            evidenceCoverageNumerator: 1,
            evidenceCoverageDenominator: 1,
            evidenceCoverageRatio: 1,
            unsupportedClaimCount: 0
        });

        const unsupported = buildHtmlMetrics({
            blog,
            qaCase: {},
            evidenceMap: {
                entries: [{
                    evidenceKey: 'fact-1',
                    claim: 'Inox 304 is described by retained evidence.',
                    status: 'blocked',
                    classification: 'unknown'
                }]
            }
        });
        expect(unsupported).toMatchObject({
            evidenceCoverageNumerator: 0,
            evidenceCoverageDenominator: 1,
            evidenceCoverageRatio: 0,
            unsupportedClaimCount: 1
        });
    });

    it.each([
        '',
        'http://inoxpran.com/blog/example',
        '//inoxpran.com/blog/example',
        'https://user:password@inoxpran.com/blog/example',
        'https://localhost/blog/example',
        'https://127.0.0.1/blog/example',
        'https://10.0.0.2/blog/example',
        'https://172.16.0.2/blog/example',
        'https://192.168.0.2/blog/example',
        'https://[::1]/blog/example',
        'https://cms.internal/blog/example'
    ])('rejects an unsafe canonical URL: %s', (url) => {
        expect(isSafeCanonical(url)).toBe(false);
    });

    it('accepts a public HTTPS canonical without credentials', () => {
        expect(isSafeCanonical('https://inoxpran.com/blog/safe-article')).toBe(true);
    });

    it('allows a blank QA canonical only with the exact noindex/nofollow draft policy', () => {
        const safeQaDraft = {
            isQaTest: true,
            canonicalUrl: '',
            indexability: { index: false, follow: false, determinable: true }
        };
        expect(isSafeCanonicalForBlog(safeQaDraft)).toBe(true);
        expect(isSafeCanonicalForBlog({ ...safeQaDraft, canonicalUrl: 'https://inoxpran.com/blog/qa' })).toBe(false);
        expect(isSafeCanonicalForBlog({
            ...safeQaDraft,
            indexability: { index: false, follow: true, determinable: true }
        })).toBe(false);
        expect(isSafeCanonicalForBlog({
            ...safeQaDraft,
            indexability: { index: false, follow: false, determinable: false }
        })).toBe(false);
    });
});

describe('Senior auditor gateway fail-closed adapter', () => {
    it.each([
        ['true', 'true'],
        ['1', 'yes'],
        ['yes', 'on'],
        ['on', '1']
    ])('accepts reviewed true boolean forms (%s/%s)', (qaEnabled, auditorEnabled) => {
        expect(assertQaAuditorEnabled(auditorEnv({
            AGENTIC_BLOG_QA_ENABLED: qaEnabled,
            SENIOR_BLOG_AUDITOR_ENABLED: auditorEnabled
        }))).toEqual({ environment: 'local' });
    });

    it.each([
        [{ AGENTIC_BLOG_QA_ENABLED: 'false' }, 'SENIOR_AUDITOR_QA_DISABLED'],
        [{ AGENTIC_BLOG_QA_ENVIRONMENT: 'production' }, 'SENIOR_AUDITOR_QA_ENVIRONMENT_UNSAFE'],
        [{ AGENTIC_BLOG_QA_ENVIRONMENT: '' }, 'SENIOR_AUDITOR_QA_ENVIRONMENT_UNSAFE'],
        [{ SENIOR_BLOG_AUDITOR_ENABLED: 'false' }, 'SENIOR_AUDITOR_DISABLED']
    ])('rejects unsafe auditor environment %#', (override, expectedCode) => {
        try {
            assertQaAuditorEnabled(auditorEnv(override));
            throw new Error('expected guard to throw');
        } catch (error) {
            expect(error).toBeInstanceOf(SeniorBlogAuditorUnavailableError);
            expect(error.code).toBe(expectedCode);
        }
    });

    it('allows only loopback, RFC1918, ULA, and reviewed container gateway hosts', () => {
        for (const host of ['localhost', '127.0.0.1', '10.2.3.4', '172.16.1.1', '172.31.255.1', '192.168.1.1', '::1', 'fd00::1', 'app_openclaw', 'openclaw']) {
            expect(isPrivateGatewayHost(host), host).toBe(true);
        }
        for (const host of ['8.8.8.8', '172.15.1.1', '172.32.1.1', 'example.com', 'gateway.inoxpran.com']) {
            expect(isPrivateGatewayHost(host), host).toBe(false);
        }
    });

    it('normalizes a private websocket gateway to the one responses endpoint', () => {
        expect(resolvePrivateGatewayUrl({ OPENCLAW_GATEWAY_URL: 'ws://app_openclaw:18789' }))
            .toBe('http://app_openclaw:18789/v1/responses');
        expect(() => resolvePrivateGatewayUrl({ OPENCLAW_GATEWAY_URL: 'https://example.com' }))
            .toThrow();
        expect(() => resolvePrivateGatewayUrl({ OPENCLAW_GATEWAY_URL: 'http://127.0.0.1:18789/admin' }))
            .toThrow();
        expect(() => resolvePrivateGatewayUrl({ OPENCLAW_GATEWAY_URL: 'http://127.0.0.1:18789?token=secret' }))
            .toThrow();
    });

    it('accepts exactly one JSON object and rejects markdown or trailing prose', () => {
        expect(parseJsonOnly('{"verdict":"passed"}')).toEqual({ verdict: 'passed' });
        expect(() => parseJsonOnly('```json\n{"verdict":"passed"}\n```')).toThrow();
        expect(() => parseJsonOnly('{"verdict":"passed"}\nextra')).toThrow();
        expect(() => parseJsonOnly('[{"verdict":"passed"}]')).toThrow();
    });

    it('caps response bodies before parsing', async () => {
        await expect(readBoundedText({ body: null, text: async () => 'x'.repeat(11) }, 10))
            .rejects.toMatchObject({ code: 'SENIOR_AUDITOR_RESPONSE_TOO_LARGE' });
    });

    it('sends a no-tools request only to the private responses endpoint and keeps the token out of the body', async () => {
        const fetchImpl = vi.fn(async () => ({
            ok: true,
            status: 200,
            body: null,
            text: async () => JSON.stringify({ output_text: '{"schemaVersion":"1.0"}' })
        }));
        const adapter = new OpenClawSeniorBlogAuditorAdapter({
            fetchImpl,
            envProvider: () => auditorEnv()
        });
        const result = await adapter.evaluate({
            blindInput: { title: 'Blind draft' },
            blindInputHash: 'blind-input-hash',
            artifactRefs: { qaCaseId: 'case-1' },
            rubric: [{ key: 'strategyAlignment', maximum: 10 }],
            rubricVersion: 'senior-blog-acceptance-v1'
        });

        expect(result).toEqual({ schemaVersion: '1.0' });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        const [url, options] = fetchImpl.mock.calls[0];
        expect(url).toBe('http://127.0.0.1:18789/v1/responses');
        expect(options).toMatchObject({ method: 'POST', redirect: 'error' });
        expect(options.headers).toMatchObject({
            authorization: 'Bearer operator-token-for-test',
            'x-openclaw-agent-id': 'senior-blog-acceptance-auditor'
        });
        const body = JSON.parse(options.body);
        expect(body).toMatchObject({
            model: 'openclaw/senior-blog-acceptance-auditor',
            stream: false,
            store: false,
            tool_choice: 'none'
        });
        expect(options.body).not.toContain('operator-token-for-test');
    });

    it('keeps the timeout active while reading the response body', async () => {
        vi.useFakeTimers();
        const fetchImpl = vi.fn(async (_url, options) => ({
            ok: true,
            status: 200,
            body: null,
            text: () => new Promise((_resolve, reject) => {
                options.signal.addEventListener('abort', () => {
                    const error = new Error('aborted');
                    error.name = 'AbortError';
                    reject(error);
                });
            })
        }));
        const adapter = new OpenClawSeniorBlogAuditorAdapter({
            fetchImpl,
            envProvider: () => auditorEnv()
        });
        const pending = adapter.evaluate({
            blindInput: {},
            blindInputHash: 'blind-input-hash',
            artifactRefs: { qaCaseId: 'case-1' },
            rubric: [],
            rubricVersion: 'senior-blog-acceptance-v1'
        });
        const assertion = expect(pending).rejects.toMatchObject({ code: 'SENIOR_AUDITOR_TIMEOUT' });
        await vi.advanceTimersByTimeAsync(1000);
        await assertion;
    });
});
