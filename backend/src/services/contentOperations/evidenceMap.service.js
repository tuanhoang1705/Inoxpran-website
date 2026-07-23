'use strict'

const crypto = require('node:crypto');
const { EvidenceMap } = require('../../models/evidenceMap.model');

const CLASSIFICATIONS = new Set(['verified', 'inferred', 'unknown', 'conflicting']);
const SENSITIVE_QUERY_KEY = /(?:^|[_-])(?:access|auth|api|client|private|session|refresh)?[_-]?(?:token|key|secret|password|passwd|signature|credential|code)(?:$|[_-])/i;

const safeSourceUrl = (value) => {
    if (!value) return '';
    try {
        const parsed = new URL(String(value));
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('unsafe source URL');
        for (const key of [...parsed.searchParams.keys()]) {
            if (SENSITIVE_QUERY_KEY.test(key)) parsed.searchParams.delete(key);
        }
        parsed.hash = '';
        return parsed.toString();
    } catch {
        throw new Error('Evidence sourceUrl must be a credential-free HTTPS URL');
    }
};

const normalizeEvidenceEntry = (entry = {}, { now = new Date() } = {}) => {
    const classification = String(entry.classification || '').trim();
    if (!CLASSIFICATIONS.has(classification)) throw new Error('Evidence classification is invalid');
    const claim = String(entry.claim || '').trim();
    const evidenceKey = String(entry.evidenceKey || '').trim();
    if (!evidenceKey || !claim) throw new Error('evidenceKey and claim are required');

    const sourceUrl = safeSourceUrl(entry.sourceUrl);
    const isProductClaim = Boolean(entry.isProductClaim) || /product|specification|product_catalog/i.test(String(entry.sourceType || ''));
    const isRankingClaim = Boolean(entry.isRankingClaim) || /\b(?:best|bestseller|top|number\s*1|rank)/i.test(claim);
    let status = entry.status;
    let allowedUsage = String(entry.allowedUsage || '').trim();
    let requiredQualification = String(entry.requiredQualification || '').trim();

    if (classification === 'verified') {
        status = status || 'usable';
        allowedUsage = allowedUsage || 'May be stated within the verified source scope.';
    } else if (classification === 'inferred') {
        status = 'restricted';
        allowedUsage = allowedUsage || 'May only be presented as a cautious inference.';
        requiredQualification = requiredQualification || 'State that this is an inference and avoid certainty.';
    } else {
        status = 'blocked';
        allowedUsage = 'Must not be presented as fact.';
    }

    if (isProductClaim && !entry.productCatalogSnapshotId) {
        status = 'blocked';
        requiredQualification = 'Product claims require the matching Product Catalog Snapshot.';
    }
    if (isRankingClaim && (!sourceUrl || classification !== 'verified')) {
        status = 'blocked';
        requiredQualification = 'Ranking and bestseller claims require verified attributable evidence.';
    }

    return {
        evidenceKey,
        claim,
        classification,
        sourceType: String(entry.sourceType || '').trim(),
        sourceUrl,
        internalReferenceId: String(entry.internalReferenceId || '').trim(),
        productCatalogSnapshotId: entry.productCatalogSnapshotId || null,
        checkedAt: entry.checkedAt || now,
        confidence: Math.min(1, Math.max(0, Number(entry.confidence) || 0)),
        allowedUsage,
        requiredQualification,
        status
    };
};

const buildEvidenceMapDocument = ({ contentWorkOrderId, unifiedContentBriefId, researchBundleId = null, entries = [], version = 1, qaContext = null } = {}) => {
    if (!contentWorkOrderId || !unifiedContentBriefId) throw new Error('contentWorkOrderId and unifiedContentBriefId are required');
    const normalizedEntries = entries.map((entry) => normalizeEvidenceEntry(entry));
    const status = normalizedEntries.length === 0 || normalizedEntries.some((entry) => entry.status === 'blocked')
        ? 'blocked'
        : normalizedEntries.some((entry) => entry.status === 'restricted') ? 'restricted' : 'usable';
    const warnings = normalizedEntries
        .filter((entry) => entry.status !== 'usable')
        .map((entry) => `${entry.evidenceKey}:${entry.status}`);
    if (normalizedEntries.length === 0) warnings.push('no_evidence_entries');
    const document = {
        ...(qaContext?.isQaTest === true ? qaContext : {}),
        contentWorkOrderId,
        unifiedContentBriefId,
        researchBundleId,
        version,
        entries: normalizedEntries,
        status,
        warnings
    };
    document.contentHash = crypto.createHash('sha256').update(JSON.stringify(document)).digest('hex');
    return document;
};

class EvidenceMapService {
    static normalizeEntry(entry, options) { return normalizeEvidenceEntry(entry, options); }
    static buildDocument(input) { return buildEvidenceMapDocument(input); }
    static async create(input, { EvidenceMapModel = EvidenceMap } = {}) {
        const document = buildEvidenceMapDocument(input);
        return EvidenceMapModel.findOneAndUpdate(
            { contentWorkOrderId: document.contentWorkOrderId, version: document.version },
            { $setOnInsert: document },
            { upsert: true, new: true, runValidators: true }
        );
    }
}

module.exports = { EvidenceMapService, SENSITIVE_QUERY_KEY, buildEvidenceMapDocument, normalizeEvidenceEntry, safeSourceUrl };
