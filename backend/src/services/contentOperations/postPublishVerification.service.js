'use strict'

const crypto = require('node:crypto');
const { ContentMaintenanceAlert } = require('../../models/contentMaintenanceAlert.model');
const { PostPublishVerification } = require('../../models/postPublishVerification.model');

const normalize = (value) => String(value || '').trim();
const extract = (html, pattern) => normalize(html.match(pattern)?.[1]);
const SENSITIVE_QUERY_KEY = /(?:^|[_-])(?:access[_-]?token|token|auth(?:orization)?|api[_-]?key|secret|signature|credential|password|passcode|session|email|phone|mobile|tel|user|customer|order|invoice|address|name)(?:$|[_-])/i;
const extractAttributeUrls = (html, tag, attribute) => [...String(html || '').matchAll(new RegExp(`<${tag}\\b[^>]*\\b${attribute}=["']([^"']+)["'][^>]*>`, 'gi'))]
    .map((match) => normalize(match[1]))
    .filter(Boolean);

const resolvePublicResource = (value, expectedUrl) => {
    try {
        const url = new URL(value, expectedUrl);
        if (url.protocol !== 'https:' || url.username || url.password) return null;
        const hostname = url.hostname.toLowerCase();
        if (hostname === 'localhost' || hostname.endsWith('.localhost') || /^(?:127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(hostname)) return null;
        return url;
    } catch {
        return null;
    }
};

const safeUrlForStorage = (value, baseUrl) => {
    const url = resolvePublicResource(value, baseUrl);
    if (!url) return '';
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
        if (SENSITIVE_QUERY_KEY.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
};

const safeErrorCode = (error, fallback) => String(error?.code || error?.name || fallback)
    .replace(/[^a-zA-Z0-9_.:-]/g, '_')
    .slice(0, 120) || fallback;

const verifyPublishedHtml = ({ html = '', responseStatus, expected = {} } = {}) => {
    const source = String(html || '');
    const rawCanonical = extract(source, /<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)/i)
        || extract(source, /<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["']/i);
    const canonical = safeUrlForStorage(rawCanonical, expected.url);
    const title = extract(source, /<title\b[^>]*>([\s\S]*?)<\/title>/i);
    const description = extract(source, /<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']+)/i)
        || extract(source, /<meta\b[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i);
    const revisionHash = extract(source, /<meta\b[^>]*name=["']content-revision-hash["'][^>]*content=["']([^"']+)/i)
        || extract(source, /<meta\b[^>]*content=["']([^"']+)["'][^>]*name=["']content-revision-hash["']/i);
    const issues = [];
    if (responseStatus < 200 || responseStatus >= 300) issues.push({ code: 'unexpected_http_status', expected: 200, actual: responseStatus });
    if (!rawCanonical || rawCanonical !== expected.url) issues.push({
        code: 'canonical_mismatch',
        expected: safeUrlForStorage(expected.url, expected.url),
        actual: canonical
    });
    if (!title) issues.push({ code: 'page_title_missing' });
    if (!description) issues.push({ code: 'meta_description_missing' });
    if (/<meta\b[^>]*(?:name=["']robots["'][^>]*content=["'][^"']*noindex|content=["'][^"']*noindex[^>]*name=["']robots)/i.test(source)) issues.push({ code: 'unexpected_noindex' });
    if (!/<(?:main|article)\b/i.test(source) || source.length < 200) issues.push({ code: 'content_not_rendered' });
    if (/\{\{[^}]+\}\}|\b(?:admin|blog|common)\.[a-z][\w.-]+\b/.test(source)) issues.push({ code: 'raw_i18n_key' });
    if (/\uFFFD|Ã.|Â./.test(source)) issues.push({ code: 'encoding_problem' });
    if (expected.revisionHash && expected.revisionMarkerRequired !== false && revisionHash !== expected.revisionHash) {
        issues.push({ code: 'approved_revision_hash_mismatch', expected: expected.revisionHash, actual: revisionHash });
    }
    if (expected.structuredDataRequired && !/<script\b[^>]*type=["']application\/ld\+json["']/i.test(source)) issues.push({ code: 'structured_data_missing' });
    if (expected.coverRequired && !/<img\b/i.test(source)) issues.push({ code: 'cover_or_inline_images_missing' });
    if (expected.mobileSafeRequired && /<(?:table|img)\b[^>]*style=["'][^"']*width\s*:\s*\d{3,}px/i.test(source)) issues.push({ code: 'mobile_markup_unsafe' });
    return { pass: issues.length === 0, canonical, revisionHash, titlePresent: Boolean(title), metaDescriptionPresent: Boolean(description), issues };
};

const runPostPublishVerification = async ({
    blogId,
    contentWorkOrderId,
    blogRevisionId = null,
    publishReadinessReportId,
    expectedUrl,
    expectedRevisionHash,
    expected = {},
    fetchImpl,
    VerificationModel = PostPublishVerification,
    AlertModel = ContentMaintenanceAlert,
    now = new Date()
} = {}) => {
    if (!blogId || !contentWorkOrderId || !publishReadinessReportId || !expectedUrl || !expectedRevisionHash) {
        throw new Error('Post-publish verification identifiers and expected URL/revision are required');
    }
    if (typeof fetchImpl !== 'function') throw new Error('A bounded injected fetch implementation is required');
    const safeExpectedUrl = safeUrlForStorage(expectedUrl, expectedUrl);
    if (!safeExpectedUrl) throw new Error('A public HTTPS expected URL is required');

    let responseStatus = 0;
    let html = '';
    let fetchErrorCode = '';
    try {
        const response = await fetchImpl(expectedUrl, { method: 'GET', redirect: 'error' });
        responseStatus = Number(response?.status || 0);
        html = typeof response?.text === 'function' ? await response.text() : '';
    } catch (error) {
        fetchErrorCode = safeErrorCode(error, 'public_fetch_failed');
    }
    const result = verifyPublishedHtml({
        html,
        responseStatus,
        expected: { ...expected, url: expectedUrl, revisionHash: expectedRevisionHash }
    });
    if (fetchErrorCode) result.issues.unshift({ code: 'public_fetch_failed', errorCode: fetchErrorCode });
    let fetchCount = 1;
    if (!fetchErrorCode && responseStatus >= 200 && responseStatus < 300) {
        const pageUrl = resolvePublicResource(expectedUrl, expectedUrl);
        const pageOrigin = pageUrl?.origin || '';
        const anchorUrls = [...new Set(extractAttributeUrls(html, 'a', 'href'))]
            .map((value) => resolvePublicResource(value, expectedUrl))
            .filter((url) => url && url.origin === pageOrigin)
            .slice(0, 30);
        const imageUrls = [...new Set(extractAttributeUrls(html, 'img', 'src'))]
            .map((value) => resolvePublicResource(value, expectedUrl))
            .filter(Boolean)
            .filter((url) => url.origin === pageOrigin || ['storage.googleapis.com', 'firebasestorage.googleapis.com'].includes(url.hostname.toLowerCase()))
            .slice(0, 20);
        const checks = [
            ...anchorUrls.map((url) => ({ kind: /\/(?:san-pham|products?)\//i.test(url.pathname) ? 'product_link' : 'internal_link', url })),
            ...imageUrls.map((url) => ({ kind: 'image', url }))
        ];
        for (const check of checks) {
            const storedUrl = safeUrlForStorage(check.url.toString(), expectedUrl);
            try {
                const response = await fetchImpl(check.url.toString(), { method: 'GET', redirect: 'error' });
                fetchCount += 1;
                if (!response?.ok) result.issues.push({ code: `broken_${check.kind}`, url: storedUrl, status: Number(response?.status || 0) });
                if (check.kind === 'image') {
                    const contentType = normalize(response?.headers?.get?.('content-type')).toLowerCase().slice(0, 120);
                    if (contentType && !contentType.startsWith('image/')) result.issues.push({ code: 'image_content_type_invalid', url: storedUrl, contentType });
                }
            } catch (error) {
                fetchCount += 1;
                result.issues.push({ code: `broken_${check.kind}`, url: storedUrl, errorCode: safeErrorCode(error, 'resource_fetch_failed') });
            }
        }
        result.resourceChecks = { internalAndProductLinks: anchorUrls.length, images: imageUrls.length };
    }
    result.pass = result.issues.length === 0;
    const document = {
        blogId,
        contentWorkOrderId,
        blogRevisionId,
        publishReadinessReportId,
        expectedUrl: safeExpectedUrl,
        expectedRevisionHash,
        pass: result.pass,
        status: result.pass ? 'passed' : 'failed',
        httpStatus: responseStatus || null,
        checks: result,
        issues: result.issues,
        indexingRequested: false,
        checkedAt: now,
        contentHash: crypto.createHash('sha256').update(JSON.stringify({ expectedUrl: safeExpectedUrl, expectedRevisionHash, result })).digest('hex')
    };
    const verification = await VerificationModel.findOneAndUpdate(
        { blogId, contentWorkOrderId, expectedRevisionHash },
        { $setOnInsert: document },
        { upsert: true, new: true, runValidators: true }
    );

    let maintenanceAlert = null;
    if (!result.pass) {
        const verificationId = verification?._id || verification?.id || null;
        maintenanceAlert = await AlertModel.findOneAndUpdate(
            { idempotencyKey: `post-publish:${blogId}:${expectedRevisionHash}` },
            {
                $setOnInsert: {
                    blogId,
                    contentWorkOrderId,
                    postPublishVerificationId: verificationId,
                    type: 'technical_verification',
                    severity: result.issues.some((issue) => ['unexpected_http_status', 'canonical_mismatch'].includes(issue.code)) ? 'critical' : 'high',
                    status: 'open',
                    summary: 'Post-publish technical verification failed; the publication was preserved for maintenance review.',
                    issues: result.issues,
                    detectedAt: now,
                    idempotencyKey: `post-publish:${blogId}:${expectedRevisionHash}`
                }
            },
            { upsert: true, new: true, runValidators: true }
        );
        if (verificationId && maintenanceAlert?._id) {
            await VerificationModel.updateOne({ _id: verificationId }, { $set: { maintenanceAlertId: maintenanceAlert._id } });
        }
    }
    return { verification, maintenanceAlert, fetchCount, publicationPreserved: true, indexingRequested: false };
};

class PostPublishVerificationService {
    static verifyHtml(input) { return verifyPublishedHtml(input); }
    static run(input) { return runPostPublishVerification(input); }
}

module.exports = { PostPublishVerificationService, runPostPublishVerification, verifyPublishedHtml };
