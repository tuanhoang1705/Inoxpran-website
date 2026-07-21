'use strict'

const crypto = require('node:crypto');
const { ACTIONS } = require('../../config/contentOperations.config');
const { ContentPublishReadinessReport } = require('../../models/contentPublishReadinessReport.model');

const MAINTENANCE_ACTIONS = new Set([
    ACTIONS.METADATA_REFRESH,
    ACTIONS.INTERNAL_LINK_MAINTENANCE,
    ACTIONS.CONTENT_MAINTENANCE
]);
const TARGET_ACTIONS = new Set([
    ACTIONS.UPDATE,
    ACTIONS.EXPAND,
    ACTIONS.MERGE,
    ...MAINTENANCE_ACTIONS
]);
const ALLOWED_SCHEMA_TYPES = new Set(['Article', 'BlogPosting', 'HowTo', 'FAQPage']);

const normalize = (value) => String(value || '').trim();
const stripTags = (html) => normalize(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const NO_MATERIAL_CLAIM_ACTIONS = new Set([ACTIONS.METADATA_REFRESH, ACTIONS.INTERNAL_LINK_MAINTENANCE]);
const normalizeClaimText = (value) => stripTags(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const MATERIAL_FACT_PATTERN = /(?:\b\d+(?:[.,]\d+)?\s*(?:%|mm|cm|kg|g|ml|l|w|kw|v|vnd|dong|nam|thang|ngay|lop|lan)\b|\b(?:inox|grade)\s*(?:201|304|316|430)\b|\b(?:nghien cuu|thu nghiem|chung nhan|bao hanh|xep hang|ban chay|cong suat|dung tich|trong luong|do ben|chong gi)\b)/i;

const extractMaterialClaimExcerpts = (html) => {
    const sentences = stripTags(html)
        .split(/(?<=[.!?])\s+|[\r\n]+/u)
        .map((sentence) => sentence.trim())
        .filter((sentence) => sentence.length >= 12 && MATERIAL_FACT_PATTERN.test(normalizeClaimText(sentence)));
    return [...new Set(sentences)].slice(0, 100);
};

const claimOverlap = (left, right) => {
    const leftText = normalizeClaimText(left);
    const rightText = normalizeClaimText(right);
    if (!leftText || !rightText) return false;
    const leftTokens = new Set(leftText.split(' ').filter(Boolean));
    const rightTokens = new Set(rightText.split(' ').filter(Boolean));
    const shorter = Math.min(leftTokens.size, rightTokens.size);
    if (!shorter) return false;
    let shared = 0;
    for (const token of leftTokens) if (rightTokens.has(token)) shared += 1;
    return shared / shorter >= 0.7;
};

const inspectEvidenceCoverage = ({ action, html, evidenceMap, materialClaims, manifestProvided } = {}) => {
    const issues = [];
    const requiresManifest = !NO_MATERIAL_CLAIM_ACTIONS.has(action);
    const declared = Array.isArray(materialClaims) ? materialClaims.slice(0, 100) : [];
    const detected = extractMaterialClaimExcerpts(html);
    const contentText = normalizeClaimText(html);
    const entries = Array.isArray(evidenceMap?.entries) ? evidenceMap.entries : [];
    const entriesByKey = new Map(entries.map((entry) => [normalize(entry?.evidenceKey), entry]));

    if (requiresManifest && manifestProvided !== true) issues.push('material_claim_manifest_missing');
    const validDeclared = [];
    for (const claim of declared) {
        const evidenceKey = normalize(claim?.evidenceKey);
        const excerpt = normalize(claim?.contentExcerpt || claim?.excerpt).slice(0, 500);
        const evidence = entriesByKey.get(evidenceKey);
        if (!evidenceKey || !excerpt) {
            issues.push('material_claim_manifest_entry_invalid');
            continue;
        }
        if (!contentText.includes(normalizeClaimText(excerpt))) issues.push('material_claim_excerpt_not_in_content');
        if (!evidence) {
            issues.push('material_claim_evidence_unmapped');
            continue;
        }
        if (!claimOverlap(excerpt, evidence.claim)) {
            issues.push('material_claim_evidence_mismatch');
            continue;
        }
        const classification = normalize(evidence.classification).toLowerCase();
        const status = normalize(evidence.status).toLowerCase();
        if (status === 'blocked' || ['unknown', 'conflicting'].includes(classification)) {
            issues.push('material_claim_evidence_blocked');
            continue;
        }
        if (!['usable', 'restricted'].includes(status) || !['verified', 'inferred'].includes(classification)) {
            issues.push('material_claim_evidence_invalid');
            continue;
        }
        if ((status === 'restricted' || classification === 'inferred') && claim?.qualificationApplied !== true) {
            issues.push('material_claim_qualification_missing');
            continue;
        }
        validDeclared.push({ ...claim, contentExcerpt: excerpt });
    }
    for (const excerpt of detected) {
        if (!validDeclared.some((claim) => claimOverlap(excerpt, claim.contentExcerpt))) {
            issues.push('material_claim_unmapped');
        }
    }
    return {
        pass: issues.length === 0,
        manifestProvided: manifestProvided === true,
        requiresManifest,
        declaredCount: declared.length,
        detectedCount: detected.length,
        issues: [...new Set(issues)]
    };
};
const isSafeUrl = (value, { absolute = false } = {}) => {
    const url = normalize(value);
    if (!url || /[\u0000-\u001f\u007f]/.test(url) || /^(?:javascript|data|vbscript):/i.test(url)) return false;
    if (!absolute && /^\/(?!\/)/.test(url)) return true;
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
    } catch {
        return false;
    }
};

const inspectHeadings = (html) => {
    const levels = [...normalize(html).matchAll(/<h([1-6])\b[^>]*>/gi)].map((match) => Number(match[1]));
    const issues = [];
    if (levels.includes(1)) issues.push('body_must_not_contain_h1');
    const contentLevels = levels.filter((level) => level > 1);
    if (contentLevels.length && contentLevels[0] !== 2) issues.push('first_body_heading_must_be_h2');
    for (let index = 1; index < contentLevels.length; index += 1) {
        if (contentLevels[index] > contentLevels[index - 1] + 1) {
            issues.push(`heading_level_jump_h${contentLevels[index - 1]}_to_h${contentLevels[index]}`);
        }
    }
    return { pass: issues.length === 0, levels, issues };
};

const inspectLinks = (links, kind) => {
    const entries = Array.isArray(links) ? links : [];
    const issues = [];
    for (const entry of entries) {
        const url = typeof entry === 'string' ? entry : entry?.url || entry?.href;
        if (!isSafeUrl(url)) issues.push(`${kind}_unsafe_url`);
        if (entry && typeof entry === 'object' && (entry.resolved === false || entry.status === 'broken')) {
            issues.push(`${kind}_unresolved`);
        }
    }
    return { pass: issues.length === 0, checked: entries.length, issues: [...new Set(issues)] };
};

const extractLinksFromHtml = (html) => [...normalize(html).matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi)]
    .map((match) => match[1]);

const extractImagesFromHtml = (html) => [...normalize(html).matchAll(/<img\b([^>]*)>/gi)].map((match) => {
    const attributes = match[1] || '';
    const src = attributes.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1] || '';
    const alt = attributes.match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1] || '';
    return { src, alt, status: 'reviewed', reviewRequired: false };
});

const inspectImages = ({ coverImage, inlineImages = [], requireCover = true } = {}) => {
    const issues = [];
    const approvedStatuses = new Set(['complete', 'approved', 'passed', 'reviewed']);
    if (requireCover) {
        if (!coverImage?.url || !isSafeUrl(coverImage.url)) issues.push('cover_image_missing_or_unsafe');
        if (!approvedStatuses.has(normalize(coverImage?.status || coverImage?.reviewStatus).toLowerCase())) issues.push('cover_image_review_incomplete');
    }
    for (const image of Array.isArray(inlineImages) ? inlineImages : []) {
        if (!isSafeUrl(image?.url || image?.src)) issues.push('inline_image_missing_or_unsafe');
        if (image?.loaded === false || image?.broken === true) issues.push('inline_image_broken');
        const alt = normalize(image?.alt);
        if (!alt) issues.push('inline_image_alt_missing');
        if (alt.length > 180) issues.push('inline_image_alt_stuffed');
        if (image?.reviewRequired !== false && !approvedStatuses.has(normalize(image?.status || image?.reviewStatus).toLowerCase())) {
            issues.push('inline_image_review_incomplete');
        }
    }
    return { pass: issues.length === 0, inlineCount: inlineImages.length || 0, issues: [...new Set(issues)] };
};

const addFixes = (fixes, area, issues, severity) => {
    for (const code of issues || []) fixes.push({ area, code, severity });
};

const evaluatePublishReadiness = ({
    workOrder = {},
    brief = {},
    draft = {},
    evidenceMap = null,
    expectedCanonical = '',
    existingQualityGates = {},
    now = new Date()
} = {}) => {
    const action = normalize(workOrder.decision || draft.contentAction || draft.contentDecision);
    if (!Object.values(ACTIONS).includes(action) || action === ACTIONS.SKIP) throw new Error('A non-skip content action is required');
    const requestedMode = normalize(draft.mode || 'draft').toLowerCase();
    if (!['draft', 'publish'].includes(requestedMode)) throw new Error('mode must be draft or publish');

    const html = normalize(draft.contentHtml || draft.content || '');
    const title = normalize(draft.title || draft.blog_title);
    const slug = normalize(draft.slug || draft.blog_slug);
    const description = normalize(draft.seoDescription || draft.metaDescription || draft.blog_seo_description);
    const canonical = normalize(draft.canonicalUrl || draft.canonical || expectedCanonical);
    const fixes = [];

    const securityIssues = [];
    if (/<script\b|<iframe\b|<object\b|<embed\b/i.test(html)) securityIssues.push('unsafe_active_content');
    if (/\son[a-z]+\s*=|\sstyle\s*=/i.test(html)) securityIssues.push('unsafe_inline_handler_or_style');
    if (/(?:javascript|vbscript|data):/i.test(html)) securityIssues.push('unsafe_url_scheme');
    addFixes(fixes, 'security', securityIssues, 'critical');

    const headings = inspectHeadings(html);
    const contentIssues = [...headings.issues];
    if (!html || stripTags(html).length < 50) contentIssues.push('content_missing_or_not_renderable');
    if (draft.rendererProvidesH1 === false) contentIssues.push('renderer_h1_missing');
    if (draft.mobileSafeMarkup === false || /<(?:table|img)\b[^>]*style=["'][^"']*width\s*:\s*\d{3,}px/i.test(html)) {
        contentIssues.push('mobile_markup_unsafe');
    }
    addFixes(fixes, 'content', contentIssues, contentIssues.includes('content_missing_or_not_renderable') ? 'high' : 'medium');

    const seoIssues = [];
    if (!title) seoIssues.push('title_missing');
    if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 250) seoIssues.push('slug_invalid');
    if (!description || description.length < 50 || description.length > 320) seoIssues.push('meta_description_invalid');
    if (!isSafeUrl(canonical, { absolute: true })) seoIssues.push('canonical_invalid');
    if (expectedCanonical && canonical !== expectedCanonical) seoIssues.push('canonical_mismatch');
    if (draft.indexable === false && requestedMode === 'publish') seoIssues.push('publish_target_noindex');
    if (brief.primarySearchIntent && title && !normalize(brief.workingTitle || title)) seoIssues.push('title_intent_unverifiable');
    addFixes(fixes, 'seo', seoIssues, seoIssues.some((code) => code.startsWith('canonical_')) ? 'critical' : 'medium');

    const htmlLinks = extractLinksFromHtml(html);
    const htmlProductLinks = htmlLinks.filter((url) => /\/(?:san-pham|products?)\//i.test(url));
    const htmlInternalLinks = htmlLinks.filter((url) => /^\/(?!\/)/.test(url) && !htmlProductLinks.includes(url));
    const htmlEvidenceLinks = htmlLinks.filter((url) => /^https:\/\//i.test(url));
    const internalLinks = inspectLinks([...(draft.internalLinks || []), ...htmlInternalLinks], 'internal_link');
    const productLinks = inspectLinks([...(draft.productLinks || []), ...htmlProductLinks], 'product_link');
    const evidenceLinks = inspectLinks([...(draft.externalEvidenceLinks || []), ...htmlEvidenceLinks], 'external_evidence_link');
    const linkIssues = [...internalLinks.issues, ...productLinks.issues, ...evidenceLinks.issues];
    addFixes(fixes, 'links', linkIssues, 'high');

    const images = inspectImages({
        coverImage: draft.coverImage || (draft.imageUrl ? { url: draft.imageUrl, status: draft.coverImageStatus } : null),
        inlineImages: [...(draft.inlineImages || draft.contentImages || []), ...extractImagesFromHtml(html)],
        requireCover: draft.requireCoverImage !== false
    });
    addFixes(fixes, 'images', images.issues, 'high');

    const productIssues = [];
    if (existingQualityGates.productClaims?.pass === false || draft.productClaimReview?.pass === false) productIssues.push('product_claim_review_failed');
    if (existingQualityGates.productPlacement?.pass === false || draft.productPlacementReview?.pass === false) productIssues.push('product_placement_review_failed');
    if ((brief.productIntegration?.mode || 'off') !== 'off' && draft.productDisclosurePassed !== true) productIssues.push('product_disclosure_missing');
    addFixes(fixes, 'product', productIssues, 'critical');

    const schemaType = normalize(draft.structuredDataType || brief.structuredDataCandidate);
    const schemaIssues = [];
    if (schemaType && !ALLOWED_SCHEMA_TYPES.has(schemaType)) schemaIssues.push('structured_data_type_unsupported');
    if (schemaType && draft.structuredDataValid === false) schemaIssues.push('structured_data_invalid');
    addFixes(fixes, 'structuredData', schemaIssues, 'high');

    const actionIssues = [];
    const targetBlogId = workOrder.targetBlogId || draft.targetBlogId;
    if (TARGET_ACTIONS.has(action) && !targetBlogId) actionIssues.push('target_blog_id_required');
    if (action === ACTIONS.NEW && targetBlogId) actionIssues.push('new_action_must_not_target_existing_blog');
    if (action === ACTIONS.MERGE && !(workOrder.mergeSourceBlogIds || []).length) actionIssues.push('merge_source_blog_ids_required');
    if ([ACTIONS.UPDATE, ACTIONS.EXPAND, ...MAINTENANCE_ACTIONS].includes(action)
        && draft.preserveCanonical === false) actionIssues.push('existing_url_must_be_preserved');
    if (action === ACTIONS.METADATA_REFRESH && draft.fullContentRewrite === true) actionIssues.push('metadata_refresh_full_rewrite_forbidden');
    addFixes(fixes, 'technical', actionIssues, 'critical');

    const evidenceIssues = [];
    if (!evidenceMap || !(evidenceMap.entries || []).length) {
        evidenceIssues.push('evidence_map_missing_or_empty');
    } else if (evidenceMap.status === 'blocked' || evidenceMap.entries.some((entry) => entry.status === 'blocked')) {
        evidenceIssues.push('evidence_map_contains_blocked_claim');
    }
    const evidenceCoverage = inspectEvidenceCoverage({
        action,
        html,
        evidenceMap,
        materialClaims: draft.materialClaims,
        manifestProvided: draft.materialClaimsManifestProvided
    });
    evidenceIssues.push(...evidenceCoverage.issues);
    addFixes(fixes, 'content', [...new Set(evidenceIssues)], 'critical');
    for (const [gate, result] of Object.entries(existingQualityGates || {})) {
        if ((result?.pass === false || result?.passed === false) && !['productClaims', 'productPlacement'].includes(gate)) {
            addFixes(fixes, 'content', [`existing_gate_failed:${gate}`], 'critical');
        }
    }

    const severityRank = { low: 0, medium: 1, high: 2, critical: 3 };
    const riskLevel = fixes.reduce((highest, fix) => (
        severityRank[fix.severity] > severityRank[highest] ? fix.severity : highest
    ), 'low');
    const pass = fixes.length === 0;
    const publishRecommendation = MAINTENANCE_ACTIONS.has(action)
        ? 'maintenance'
        : pass
            ? (requestedMode === 'publish' ? 'publish' : 'draft')
            : ['high', 'critical'].includes(riskLevel) ? 'rewrite' : 'draft';
    const report = {
        contentWorkOrderId: workOrder._id || workOrder.id,
        unifiedContentBriefId: brief._id || brief.id,
        evidenceMapId: evidenceMap?._id || evidenceMap?.id || null,
        blogId: targetBlogId || null,
        blogRevisionId: draft.blogRevisionId || null,
        action,
        requestedMode,
        pass,
        riskLevel,
        technical: { pass: actionIssues.length === 0, actionIssues, mode: requestedMode },
        seo: { pass: seoIssues.length === 0, titlePresent: Boolean(title), canonical, issues: seoIssues },
        content: {
            pass: contentIssues.length === 0 && evidenceIssues.length === 0,
            headings,
            evidenceCoverage,
            issues: [...contentIssues, ...evidenceIssues]
        },
        images,
        links: { pass: linkIssues.length === 0, internalLinks, productLinks, evidenceLinks, issues: linkIssues },
        structuredData: { pass: schemaIssues.length === 0, type: schemaType || null, issues: schemaIssues },
        product: { pass: productIssues.length === 0, issues: productIssues },
        security: { pass: securityIssues.length === 0, issues: securityIssues },
        requiredFixes: fixes,
        publishRecommendation,
        autoPublishAllowed: pass && requestedMode === 'publish' && publishRecommendation === 'publish',
        checkedAt: now
    };
    report.contentHash = crypto.createHash('sha256').update(JSON.stringify({ ...report, checkedAt: undefined })).digest('hex');
    return report;
};

class ContentPublishReadinessService {
    static evaluate(input) { return evaluatePublishReadiness(input); }

    static async createReport(input, { ReportModel = ContentPublishReadinessReport } = {}) {
        const report = evaluatePublishReadiness(input);
        if (!report.contentWorkOrderId || !report.unifiedContentBriefId) {
            throw new Error('Persisted work order and unified brief are required for readiness');
        }
        return ReportModel.create(report);
    }
}

module.exports = {
    ContentPublishReadinessService,
    evaluatePublishReadiness,
    inspectHeadings,
    inspectEvidenceCoverage,
    inspectImages,
    inspectLinks,
    isSafeUrl,
    extractMaterialClaimExcerpts
};
