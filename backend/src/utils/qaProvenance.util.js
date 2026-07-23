'use strict'

const QA_ENVIRONMENTS = new Set(['local', 'staging']);
const QA_EXECUTION_MODES = new Set(['run_now', 'schedule_run_now', 'actual_schedule']);
const QA_PROVENANCE_FIELDS = Object.freeze([
    'qaBatchId',
    'qaCaseId',
    'environment',
    'executionMode',
    'originalTopicSeed',
    'normalizedTopicKey'
]);

const invalidQaProvenance = () => {
    const error = new Error('Trusted QA provenance is incomplete or unsafe');
    error.code = 'TRUSTED_QA_PROVENANCE_INVALID';
    error.status = 400;
    return error;
};

/**
 * Normalize provenance that has already crossed an internal trust boundary.
 * Public request payloads must never be passed to this helper. Controllers keep
 * QA keys out of their allowlists and the automation publisher rejects them.
 */
const normalizeTrustedQaProvenance = (value) => {
    if (value === null || value === undefined) return null;
    const originalTopicSeed = String(value.originalTopicSeed || '').trim();
    const normalizedTopicKey = String(value.normalizedTopicKey || '').trim();
    if (
        value.isQaTest !== true ||
        !value.qaBatchId ||
        !value.qaCaseId ||
        !QA_ENVIRONMENTS.has(value.environment) ||
        !QA_EXECUTION_MODES.has(value.executionMode) ||
        !originalTopicSeed ||
        originalTopicSeed.length > 300 ||
        !normalizedTopicKey ||
        normalizedTopicKey.length > 320
    ) {
        throw invalidQaProvenance();
    }
    return Object.freeze({
        isQaTest: true,
        qaBatchId: value.qaBatchId,
        qaCaseId: value.qaCaseId,
        environment: value.environment,
        executionMode: value.executionMode,
        originalTopicSeed,
        normalizedTopicKey
    });
};

const hasQaProvenanceMarkers = (value) => Boolean(
    value && typeof value === 'object' && (
        value.isQaTest === true ||
        QA_PROVENANCE_FIELDS.some((field) => (
            value[field] !== undefined &&
            value[field] !== null &&
            String(value[field]).trim() !== ''
        ))
    )
);

const qaProvenanceMatches = (left, right) => Boolean(
    left && right &&
    left.isQaTest === true &&
    right.isQaTest === true &&
    QA_PROVENANCE_FIELDS.every((field) => String(left[field] || '') === String(right[field] || ''))
);

/**
 * Inherit provenance only from a persisted/trusted upstream artifact. Candidate
 * payloads may confirm that scope, but can never introduce a QA scope on their
 * own. Partial or mismatched candidates fail closed.
 */
const inheritTrustedQaProvenance = ({ anchor, candidates = [] } = {}) => {
    const anchorHasMarkers = hasQaProvenanceMarkers(anchor);
    const inherited = anchorHasMarkers ? normalizeTrustedQaProvenance(anchor) : null;
    for (const candidate of Array.isArray(candidates) ? candidates : [candidates]) {
        if (!hasQaProvenanceMarkers(candidate)) continue;
        const normalizedCandidate = normalizeTrustedQaProvenance(candidate);
        if (!inherited || !qaProvenanceMatches(inherited, normalizedCandidate)) {
            throw invalidQaProvenance();
        }
    }
    return inherited;
};

const qaProvenanceDocument = (trustedQaContext) => {
    const normalized = normalizeTrustedQaProvenance(trustedQaContext);
    return normalized ? { ...normalized } : {};
};

const qaScopeFilter = (trustedQaContext) => {
    const normalized = normalizeTrustedQaProvenance(trustedQaContext);
    return normalized
        ? {
            isQaTest: true,
            qaBatchId: normalized.qaBatchId,
            qaCaseId: normalized.qaCaseId
        }
        : { isQaTest: { $ne: true } };
};

const qaExecutionScopeKey = (trustedQaContext) => {
    const normalized = normalizeTrustedQaProvenance(trustedQaContext);
    if (!normalized) return '';
    const clean = (value) => String(value || '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
    return `qa:${clean(normalized.environment)}:${clean(normalized.qaBatchId)}:${clean(normalized.qaCaseId)}`;
};

module.exports = {
    QA_ENVIRONMENTS,
    QA_EXECUTION_MODES,
    QA_PROVENANCE_FIELDS,
    hasQaProvenanceMarkers,
    inheritTrustedQaProvenance,
    normalizeTrustedQaProvenance,
    qaProvenanceMatches,
    qaExecutionScopeKey,
    qaProvenanceDocument,
    qaScopeFilter
};
