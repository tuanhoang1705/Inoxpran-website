import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ACTIONS } = require('../src/config/contentOperations.config');
const { evaluatePublishReadiness } = require('../src/services/contentOperations/publishReadiness.service');
const { runPostPublishVerification } = require('../src/services/contentOperations/postPublishVerification.service');

const objectId = (suffix) => `507f1f77bcf86cd7994391${suffix}`;
const passingInput = () => ({
    workOrder: { _id: objectId('01'), decision: ACTIONS.NEW },
    brief: {
        _id: objectId('02'),
        workingTitle: 'Cách chọn nồi inox',
        primarySearchIntent: 'informational',
        productIntegration: { mode: 'off' },
        structuredDataCandidate: 'Article'
    },
    evidenceMap: {
        _id: objectId('08'),
        status: 'usable',
        entries: [{ evidenceKey: 'verified-guidance', classification: 'verified', status: 'usable', claim: 'Verified selection guidance.' }]
    },
    draft: {
        mode: 'publish',
        title: 'Cách chọn nồi inox phù hợp cho gia đình',
        slug: 'cach-chon-noi-inox-phu-hop',
        seoDescription: 'Hướng dẫn thực tế giúp gia đình đánh giá kích thước, vật liệu và nhu cầu trước khi chọn nồi inox phù hợp.',
        canonicalUrl: 'https://inoxpran.com/blog/cach-chon-noi-inox-phu-hop',
        contentHtml: '<article><h2>Tiêu chí lựa chọn</h2><p>Nội dung hướng dẫn đủ dài để renderer hiển thị ổn định trên trang công khai.</p></article>',
        indexable: true,
        preserveCanonical: true,
        coverImage: { url: 'https://cdn.example.com/cover.webp', status: 'approved' },
        inlineImages: [],
        internalLinks: [{ url: '/shop', resolved: true }],
        externalEvidenceLinks: [{ url: 'https://developers.google.com/search', resolved: true }],
        structuredDataType: 'Article',
        structuredDataValid: true,
        mobileSafeMarkup: true,
        materialClaims: [],
        materialClaimsManifestProvided: true
    },
    expectedCanonical: 'https://inoxpran.com/blog/cach-chon-noi-inox-phu-hop',
    existingQualityGates: { fact: { pass: true }, image: { pass: true } }
});

describe('Publish readiness', () => {
    it('allows automatic publish only when every final gate passes', () => {
        const report = evaluatePublishReadiness(passingInput());
        expect(report.pass).toBe(true);
        expect(report.riskLevel).toBe('low');
        expect(report.publishRecommendation).toBe('publish');
        expect(report.autoPublishAllowed).toBe(true);
    });

    it('blocks unsafe HTML, bad headings, canonical mismatch, and failed gates', () => {
        const input = passingInput();
        input.draft.contentHtml = '<h1>Duplicate H1</h1><script>alert(1)</script><h4>Jump</h4><p onclick="bad()">Body</p>';
        input.draft.canonicalUrl = 'https://inoxpran.com/blog/wrong';
        input.existingQualityGates.fact = { pass: false };
        const report = evaluatePublishReadiness(input);
        expect(report.pass).toBe(false);
        expect(report.riskLevel).toBe('critical');
        expect(report.autoPublishAllowed).toBe(false);
        expect(report.requiredFixes.map((fix) => fix.code)).toContain('unsafe_active_content');
        expect(report.requiredFixes.map((fix) => fix.code)).toContain('canonical_mismatch');
        expect(report.requiredFixes.map((fix) => fix.code)).toContain('existing_gate_failed:fact');
    });

    it('enforces target/action correctness and prevents metadata full rewrites', () => {
        const update = passingInput();
        update.workOrder.decision = ACTIONS.UPDATE;
        expect(evaluatePublishReadiness(update).requiredFixes.map((fix) => fix.code)).toContain('target_blog_id_required');

        const metadata = passingInput();
        metadata.workOrder = { ...metadata.workOrder, decision: ACTIONS.METADATA_REFRESH, targetBlogId: objectId('09') };
        metadata.draft.fullContentRewrite = true;
        const report = evaluatePublishReadiness(metadata);
        expect(report.requiredFixes.map((fix) => fix.code)).toContain('metadata_refresh_full_rewrite_forbidden');
        expect(report.publishRecommendation).toBe('maintenance');
    });

    it('does not let unrelated evidence authorize a material factual claim', () => {
        const input = passingInput();
        input.draft.contentHtml = '<article><h2>Verified fact</h2><p>The package weighs 2 kg according to the specification.</p></article>';
        input.draft.materialClaims = [{
            evidenceKey: 'verified-guidance',
            contentExcerpt: 'The package weighs 2 kg according to the specification.',
            qualificationApplied: false
        }];
        const report = evaluatePublishReadiness(input);
        expect(report.pass).toBe(false);
        expect(report.requiredFixes.map((fix) => fix.code)).toContain('material_claim_evidence_mismatch');
    });

    it('blocks detected material claims that are omitted from the manifest', () => {
        const input = passingInput();
        input.draft.contentHtml = '<article><h2>Specification</h2><p>The package weighs 2 kg according to the specification.</p></article>';
        const report = evaluatePublishReadiness(input);
        expect(report.pass).toBe(false);
        expect(report.requiredFixes.map((fix) => fix.code)).toContain('material_claim_unmapped');
    });

    it('requires qualification for restricted inferred evidence', () => {
        const input = passingInput();
        input.evidenceMap = {
            _id: objectId('08'),
            status: 'restricted',
            entries: [{
                evidenceKey: 'inferred-weight', classification: 'inferred', status: 'restricted',
                claim: 'The package may weigh 2 kg according to the available sample.'
            }]
        };
        input.draft.contentHtml = '<article><h2>Qualified estimate</h2><p>The package may weigh 2 kg according to the available sample.</p></article>';
        input.draft.materialClaims = [{
            evidenceKey: 'inferred-weight',
            contentExcerpt: 'The package may weigh 2 kg according to the available sample.',
            qualificationApplied: false
        }];
        expect(evaluatePublishReadiness(input).requiredFixes.map((fix) => fix.code)).toContain('material_claim_qualification_missing');
        input.draft.materialClaims[0].qualificationApplied = true;
        expect(evaluatePublishReadiness(input).pass).toBe(true);
    });

    it('fails closed when the writer omits the material claim manifest', () => {
        const input = passingInput();
        input.draft.materialClaimsManifestProvided = false;
        const report = evaluatePublishReadiness(input);
        expect(report.pass).toBe(false);
        expect(report.requiredFixes.map((fix) => fix.code)).toContain('material_claim_manifest_missing');
    });
});

describe('Post-publish technical verification', () => {
    const makeModels = () => {
        const verification = { _id: objectId('11') };
        const alert = { _id: objectId('12') };
        return {
            VerificationModel: {
                findOneAndUpdate: vi.fn(async () => verification),
                updateOne: vi.fn(async () => ({ modifiedCount: 1 }))
            },
            AlertModel: { findOneAndUpdate: vi.fn(async () => alert) },
            verification,
            alert
        };
    };

    it('uses exactly one injected fetch and creates no alert when the page matches', async () => {
        const models = makeModels();
        const revisionHash = 'abc123';
        const fetchImpl = vi.fn(async () => ({
            status: 200,
            text: async () => `<html><head><title>Article</title><meta name="description" content="Description"><meta name="content-revision-hash" content="${revisionHash}"><link rel="canonical" href="https://inoxpran.com/blog/article"></head><body><main><article>${'Useful content '.repeat(20)}</article></main></body></html>`
        }));
        const result = await runPostPublishVerification({
            blogId: objectId('01'),
            contentWorkOrderId: objectId('02'),
            publishReadinessReportId: objectId('03'),
            expectedUrl: 'https://inoxpran.com/blog/article',
            expectedRevisionHash: revisionHash,
            fetchImpl,
            VerificationModel: models.VerificationModel,
            AlertModel: models.AlertModel
        });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(result.fetchCount).toBe(1);
        expect(result.maintenanceAlert).toBeNull();
        expect(result.publicationPreserved).toBe(true);
        expect(result.indexingRequested).toBe(false);
    });

    it('preserves publication and creates an idempotent maintenance alert on failure', async () => {
        const models = makeModels();
        const fetchImpl = vi.fn(async () => ({ status: 500, text: async () => '<html><title>Error</title></html>' }));
        const result = await runPostPublishVerification({
            blogId: objectId('01'),
            contentWorkOrderId: objectId('02'),
            publishReadinessReportId: objectId('03'),
            expectedUrl: 'https://inoxpran.com/blog/article',
            expectedRevisionHash: 'rev-fail',
            fetchImpl,
            VerificationModel: models.VerificationModel,
            AlertModel: models.AlertModel
        });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(models.AlertModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
        expect(result.maintenanceAlert).toBe(models.alert);
        expect(result.publicationPreserved).toBe(true);
    });

    it('fetches signed image URLs but strips credentials and raw errors from persisted issues', async () => {
        const models = makeModels();
        const signedImage = 'https://storage.googleapis.com/public-bucket/cover.webp?alt=media&X-Goog-Credential=service%40example.com&X-Goog-Signature=top-secret&token=lone-secret#fragment';
        const revisionHash = 'rev-signed-image';
        const fetchImpl = vi.fn(async (url) => {
            if (String(url) === 'https://inoxpran.com/blog/article') {
                return {
                    status: 200,
                    text: async () => `<html><head><title>Article</title><meta name="description" content="Description"><meta name="content-revision-hash" content="${revisionHash}"><link rel="canonical" href="https://inoxpran.com/blog/article"></head><body><main><article>${'Useful content '.repeat(20)}<img src="${signedImage}"></article></main></body></html>`
                };
            }
            throw new Error('upstream failed token=must-not-persist');
        });

        await runPostPublishVerification({
            blogId: objectId('01'),
            contentWorkOrderId: objectId('02'),
            publishReadinessReportId: objectId('03'),
            expectedUrl: 'https://inoxpran.com/blog/article',
            expectedRevisionHash: revisionHash,
            fetchImpl,
            VerificationModel: models.VerificationModel,
            AlertModel: models.AlertModel
        });

        expect(fetchImpl).toHaveBeenNthCalledWith(2, expect.stringContaining('X-Goog-Signature=top-secret'), expect.any(Object));
        const persisted = JSON.stringify({
            verification: models.VerificationModel.findOneAndUpdate.mock.calls,
            alert: models.AlertModel.findOneAndUpdate.mock.calls
        });
        expect(persisted).toContain('https://storage.googleapis.com/public-bucket/cover.webp?alt=media');
        expect(persisted).not.toContain('X-Goog-Credential');
        expect(persisted).not.toContain('X-Goog-Signature');
        expect(persisted).not.toContain('lone-secret');
        expect(persisted).not.toContain('must-not-persist');
    });
});
