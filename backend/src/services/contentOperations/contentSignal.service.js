'use strict'

const { isValidObjectId } = require('mongoose');
const { ContentSignal } = require('../../models/contentSignal.model');
const { getContentOperationsConfig } = require('../../config/contentOperations.config');

const CREATE_FIELDS = new Set([
    'sourceType', 'priority', 'confidence', 'title', 'question', 'painPoint', 'objection', 'summary',
    'productIds', 'categoryIds', 'evidence', 'validFrom', 'expiresAt'
]);
const UPDATE_FIELDS = new Set([
    'priority', 'confidence', 'title', 'question', 'painPoint', 'objection', 'summary',
    'productIds', 'categoryIds', 'evidence', 'validFrom', 'expiresAt'
]);
const EVIDENCE_FIELDS = new Set(['sourceType', 'referenceId', 'url', 'summary', 'checkedAt']);
const SOURCE_TYPES = new Set(['sales', 'customer_support', 'product', 'inventory', 'campaign', 'manual', 'internal_search']);
const PRIORITIES = new Set(['low', 'medium', 'high', 'critical']);
const CONFIDENCE_LEVELS = new Set(['low', 'medium', 'high']);

const SOURCE_ALIASES = Object.freeze({
    admin: 'manual',
    customer_service: 'customer_support',
    product_team: 'product',
    content_review: 'manual',
    other: 'manual'
});
const PRIORITY_ALIASES = Object.freeze({ urgent: 'critical' });

const STATUS_TRANSITIONS = Object.freeze({
    new: new Set(['reviewed', 'dismissed', 'expired']),
    reviewed: new Set(['used', 'dismissed', 'expired']),
    used: new Set(['expired']),
    dismissed: new Set(['expired']),
    expired: new Set()
});

const unsafePatterns = Object.freeze({
    html: /<\/?[a-z][^>]*>|<!--|&#?\w+;/i,
    url: /(?:https?:\/\/|www\.|(?:javascript|data|vbscript|file):)/i,
    promptInjection: /(?:ignore\s+(?:all\s+)?(?:previous|prior|above)|system\s+prompt|developer\s+message|jailbreak|prompt\s+injection|act\s+as\s+(?:an?|the)|reveal\s+(?:your|the)\s+(?:instructions|prompt))/i,
    email: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    phone: /(?:^|\D)(?:\+?84|0)?[\s().-]*(?:\d[\s().-]*){9,12}(?:\D|$)/,
    paymentCard: /(?:^|\D)(?:\d[ -]*?){13,19}(?:\D|$)/,
    ipAddress: /\b(?:\d{1,3}\.){3}\d{1,3}\b/,
    orderReference: /(?:^|[\s([{:;,-])(?:order|invoice|customer|đơn\s*hàng|hóa\s*đơn|khách\s*hàng)\s*(?:id|mã|#|:|-)?\s*[A-Z0-9][A-Z0-9-]{4,}(?=$|[\s)\]},.;:!?])/iu,
    customerName: /(?:^|[\s([{:;,-])(?:customer\s*name|full\s*name|họ\s*(?:và\s*)?tên|tên\s*khách(?:\s*hàng)?)\s*[:=-]\s*[\p{L}][\p{L}\p{M} .'’-]{1,80}(?=$|[;,.])/iu,
    postalAddress: /(?:^|[\s([{:;,-])(?:shipping\s*address|customer\s*address|address|địa\s*chỉ(?:\s*(?:giao\s*hàng|khách\s*hàng))?)\s*[:=-]\s*[^,;]{6,200}(?=$|[,;])/iu,
    privateConversation: /(?:^|\s)(?:customer|user|khách(?:\s*hàng)?)\s*:\s*[^\n]{2,500}(?:\n|\s{2,})(?:agent|support|nhân\s*viên|tư\s*vấn)\s*:/iu,
    personalHealth: /(?:^|[\s([{:;,-])(?:medical\s*condition|diagnosis|health\s*condition|tình\s*trạng\s*sức\s*khỏe|chẩn\s*đoán)\s*[:=-]\s*[^,;]{2,200}(?=$|[,;])/iu
});

const SENSITIVE_QUERY_KEY = /(?:^|[_-])(?:access[_-]?token|token|auth(?:orization)?|api[_-]?key|secret|signature|credential|password|passcode|session|email|e[_-]?mail|phone|mobile|tel|user|customer|order|invoice|address|name)(?:$|[_-])/i;
const PRIVATE_URL_VALUE_PATTERNS = [
    unsafePatterns.email,
    unsafePatterns.phone,
    unsafePatterns.paymentCard,
    unsafePatterns.orderReference,
    unsafePatterns.customerName,
    unsafePatterns.postalAddress,
    unsafePatterns.personalHealth
];

const containsPrivateUrlValue = (value) => PRIVATE_URL_VALUE_PATTERNS.some((pattern) => pattern.test(String(value || '')));

const validationError = (code, field) => {
    const error = new Error(code);
    error.code = code;
    error.field = field;
    error.status = 422;
    error.statusCode = 422;
    return error;
};

const assertAllowedKeys = (payload, allowlist, field = 'signal') => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw validationError('signal_payload_invalid', field);
    const unknown = Object.keys(payload).find((key) => !allowlist.has(key));
    if (unknown) throw validationError('signal_field_not_allowed', unknown);
};

const assertSafeText = (value, { field, required = false, maxLength = 2000 } = {}) => {
    if (value === undefined || value === null || value === '') {
        if (required) throw validationError('signal_text_required', field);
        return '';
    }
    if (typeof value !== 'string') throw validationError('signal_text_invalid', field);
    const normalized = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!normalized && required) throw validationError('signal_text_required', field);
    if (normalized.length > maxLength) throw validationError('signal_text_too_long', field);
    for (const [reason, pattern] of Object.entries(unsafePatterns)) {
        if (pattern.test(normalized)) throw validationError(`signal_${reason}_rejected`, field);
    }
    return normalized;
};

const safeEvidenceUrl = (value, field) => {
    if (!value) return '';
    if (typeof value !== 'string' || value.length > 1000) throw validationError('signal_evidence_url_invalid', field);
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password) throw validationError('signal_evidence_url_invalid', field);
        let decodedPath = url.pathname;
        try { decodedPath = decodeURIComponent(url.pathname); } catch (_error) { /* keep encoded path */ }
        if (containsPrivateUrlValue(decodedPath)) throw validationError('signal_evidence_url_private_data', field);
        url.hash = '';
        for (const [key, rawValue] of [...url.searchParams.entries()]) {
            let decodedValue = rawValue;
            try { decodedValue = decodeURIComponent(rawValue); } catch (_error) { /* keep encoded value */ }
            if (SENSITIVE_QUERY_KEY.test(key) || containsPrivateUrlValue(decodedValue)) url.searchParams.delete(key);
        }
        return url.toString();
    } catch (error) {
        if (error?.code) throw error;
        throw validationError('signal_evidence_url_invalid', field);
    }
};

const safeDate = (value, field, { required = false } = {}) => {
    if (!value) {
        if (required) throw validationError('signal_date_required', field);
        return null;
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw validationError('signal_date_invalid', field);
    return date;
};

const normalizeEvidence = (evidence, maxLength) => {
    if (evidence === undefined) return undefined;
    if (!Array.isArray(evidence) || evidence.length > 20) throw validationError('signal_evidence_invalid', 'evidence');
    return evidence.map((item, index) => {
        const prefix = `evidence.${index}`;
        assertAllowedKeys(item, EVIDENCE_FIELDS, prefix);
        return {
            sourceType: assertSafeText(item.sourceType, { field: `${prefix}.sourceType`, required: true, maxLength: 80 }),
            referenceId: assertSafeText(item.referenceId, { field: `${prefix}.referenceId`, maxLength: 200 }),
            url: safeEvidenceUrl(item.url, `${prefix}.url`),
            summary: assertSafeText(item.summary, { field: `${prefix}.summary`, maxLength: Math.min(maxLength, 1000) }),
            checkedAt: safeDate(item.checkedAt, `${prefix}.checkedAt`)
        };
    });
};

const normalizeObjectIds = (value, field) => {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.length > 100) throw validationError('signal_ids_invalid', field);
    const ids = Array.from(new Set(value.map(String)));
    if (ids.some((id) => !isValidObjectId(id))) throw validationError('signal_object_id_invalid', field);
    return ids;
};

const normalizeCategoryIds = (value) => {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.length > 100) throw validationError('signal_ids_invalid', 'categoryIds');
    const ids = Array.from(new Set(value.map((item) => String(item).trim()).filter(Boolean)));
    if (ids.some((id) => !/^[\p{L}\p{N}_-]{1,80}$/u.test(id))) throw validationError('signal_category_id_invalid', 'categoryIds');
    return ids;
};

const validateAndNormalizeSignalInput = (payload, {
    mode = 'create',
    now = new Date(),
    config = getContentOperationsConfig()
} = {}) => {
    const allowlist = mode === 'create' ? CREATE_FIELDS : UPDATE_FIELDS;
    assertAllowedKeys(payload, allowlist);
    const maxLength = config.contentSignals?.maxTextLength || 2000;
    const result = {};

    if (mode === 'create') {
        const sourceType = SOURCE_ALIASES[payload.sourceType] || payload.sourceType;
        if (!SOURCE_TYPES.has(sourceType)) throw validationError('signal_source_type_invalid', 'sourceType');
        result.sourceType = sourceType;
    }
    if (payload.priority !== undefined || mode === 'create') {
        const priority = PRIORITY_ALIASES[payload.priority] || payload.priority || 'medium';
        if (!PRIORITIES.has(priority)) throw validationError('signal_priority_invalid', 'priority');
        result.priority = priority;
    }
    if (payload.confidence !== undefined || mode === 'create') {
        const confidence = payload.confidence || 'medium';
        if (!CONFIDENCE_LEVELS.has(confidence)) throw validationError('signal_confidence_invalid', 'confidence');
        result.confidence = confidence;
    }

    const textFields = [
        ['title', 240, mode === 'create'],
        ['question', maxLength, false],
        ['painPoint', maxLength, false],
        ['objection', maxLength, false],
        ['summary', maxLength, mode === 'create']
    ];
    textFields.forEach(([field, limit, required]) => {
        if (payload[field] !== undefined || required) {
            result[field] = assertSafeText(payload[field], { field, required, maxLength: limit });
        }
    });

    const productIds = normalizeObjectIds(payload.productIds, 'productIds');
    if (productIds !== undefined) result.productIds = productIds;
    const categoryIds = normalizeCategoryIds(payload.categoryIds);
    if (categoryIds !== undefined) result.categoryIds = categoryIds;
    const evidence = normalizeEvidence(payload.evidence, maxLength);
    if (evidence !== undefined) result.evidence = evidence;

    const validFrom = safeDate(payload.validFrom, 'validFrom') || (mode === 'create' ? now : null);
    if (validFrom) result.validFrom = validFrom;
    const suppliedExpiry = safeDate(payload.expiresAt, 'expiresAt');
    const expiresAt = suppliedExpiry || (mode === 'create'
        ? new Date(now.getTime() + (config.contentSignals?.defaultTtlDays || 90) * 86_400_000)
        : null);
    if (expiresAt) {
        if (expiresAt <= now || (validFrom && expiresAt <= validFrom)) throw validationError('signal_expiry_invalid', 'expiresAt');
        result.expiresAt = expiresAt;
    }
    return result;
};

const safeSignalView = (signal) => {
    const source = typeof signal?.toObject === 'function' ? signal.toObject() : signal || {};
    return {
        id: String(source._id || source.id || ''),
        sourceType: source.sourceType,
        status: source.status,
        priority: source.priority,
        confidence: source.confidence,
        title: source.title,
        question: source.question || '',
        painPoint: source.painPoint || '',
        objection: source.objection || '',
        summary: source.summary,
        productIds: (source.productIds || []).map(String),
        categoryIds: source.categoryIds || [],
        evidence: (source.evidence || []).map((item) => ({
            sourceType: item.sourceType,
            referenceId: item.referenceId || '',
            url: item.url || '',
            summary: item.summary || '',
            checkedAt: item.checkedAt || null
        })),
        validFrom: source.validFrom || null,
        expiresAt: source.expiresAt || null,
        usedAt: source.usedAt || null,
        usedByWorkOrderIds: (source.usedByWorkOrderIds || []).map(String),
        createdAt: source.createdAt || null,
        updatedAt: source.updatedAt || null
    };
};

class ContentSignalService {
    constructor({ SignalModel = ContentSignal, config = getContentOperationsConfig(), now = () => new Date() } = {}) {
        this.SignalModel = SignalModel;
        this.config = config;
        this.now = now;
    }

    async createSignal({ payload, adminId }) {
        if (!isValidObjectId(adminId)) throw validationError('signal_admin_id_invalid', 'adminId');
        const normalized = validateAndNormalizeSignalInput(payload, { mode: 'create', now: this.now(), config: this.config });
        const signal = await this.SignalModel.create({ ...normalized, status: 'new', createdBy: adminId });
        return safeSignalView(signal);
    }

    async updateSignal({ signalId, payload }) {
        if (!isValidObjectId(signalId)) throw validationError('signal_id_invalid', 'signalId');
        const normalized = validateAndNormalizeSignalInput(payload, { mode: 'update', now: this.now(), config: this.config });
        const signal = await this.SignalModel.findOneAndUpdate(
            { _id: signalId, status: { $nin: ['used', 'expired'] } },
            { $set: normalized },
            { new: true, runValidators: true }
        );
        if (!signal) throw validationError('signal_not_editable', 'signalId');
        return safeSignalView(signal);
    }

    async updateSignalWithStatus({ signalId, payload = {}, status }) {
        if (!isValidObjectId(signalId)) throw validationError('signal_id_invalid', 'signalId');
        const normalized = validateAndNormalizeSignalInput(payload, { mode: 'update', now: this.now(), config: this.config });
        const currentQuery = this.SignalModel.findById(signalId);
        const current = await (typeof currentQuery?.lean === 'function' ? currentQuery.lean() : currentQuery);
        if (!current) throw validationError('signal_not_found', 'signalId');
        if (!Object.prototype.hasOwnProperty.call(STATUS_TRANSITIONS, status)) throw validationError('signal_status_invalid', 'status');
        if (!STATUS_TRANSITIONS[current.status]?.has(status)) throw validationError('signal_status_transition_invalid', 'status');
        const update = { ...normalized, status };
        if (status === 'used') update.usedAt = this.now();
        const signal = await this.SignalModel.findOneAndUpdate(
            { _id: signalId, status: current.status },
            { $set: update },
            { new: true, runValidators: true }
        );
        if (!signal) throw validationError('signal_status_conflict', 'status');
        return safeSignalView(signal);
    }

    async transitionStatus({ signalId, status }) {
        if (!isValidObjectId(signalId)) throw validationError('signal_id_invalid', 'signalId');
        if (!Object.prototype.hasOwnProperty.call(STATUS_TRANSITIONS, status)) throw validationError('signal_status_invalid', 'status');
        const currentQuery = this.SignalModel.findById(signalId);
        const current = await (typeof currentQuery?.lean === 'function' ? currentQuery.lean() : currentQuery);
        if (!current) throw validationError('signal_not_found', 'signalId');
        if (!STATUS_TRANSITIONS[current.status]?.has(status)) throw validationError('signal_status_transition_invalid', 'status');
        const update = { status };
        if (status === 'used') update.usedAt = this.now();
        const signal = await this.SignalModel.findOneAndUpdate(
            { _id: signalId, status: current.status },
            { $set: update },
            { new: true, runValidators: true }
        );
        if (!signal) throw validationError('signal_status_conflict', 'status');
        return safeSignalView(signal);
    }

    async markUsed({ signalId, workOrderId }) {
        if (!isValidObjectId(signalId) || !isValidObjectId(workOrderId)) throw validationError('signal_object_id_invalid', 'id');
        const signal = await this.SignalModel.findOneAndUpdate(
            { _id: signalId, status: { $in: ['new', 'reviewed'] }, expiresAt: { $gt: this.now() } },
            {
                $set: { status: 'used', usedAt: this.now() },
                $addToSet: { usedByWorkOrderIds: workOrderId }
            },
            { new: true, runValidators: true }
        );
        if (!signal) throw validationError('signal_not_usable', 'signalId');
        return safeSignalView(signal);
    }

    async expireDueSignals() {
        return this.SignalModel.updateMany(
            { status: { $in: ['new', 'reviewed', 'used', 'dismissed'] }, expiresAt: { $lte: this.now() } },
            { $set: { status: 'expired' } }
        );
    }

    async listSignals({ status, sourceType, limit = 100, mutateExpiry = true } = {}) {
        // Preview/snapshot callers must be able to inspect active signals without
        // turning a read into unrelated lifecycle housekeeping.
        if (mutateExpiry) await this.expireDueSignals();
        const filter = { expiresAt: { $gt: this.now() } };
        if (status === 'active') filter.status = { $in: ['new', 'reviewed'] };
        else if (status && Object.prototype.hasOwnProperty.call(STATUS_TRANSITIONS, status)) filter.status = status;
        if (sourceType && SOURCE_TYPES.has(sourceType)) filter.sourceType = sourceType;
        let query = this.SignalModel.find(filter);
        if (typeof query.sort === 'function') query = query.sort({ createdAt: -1 });
        if (typeof query.limit === 'function') query = query.limit(Math.min(Math.max(Number(limit) || 100, 1), 500));
        if (typeof query.lean === 'function') query = query.lean();
        const rows = await query;
        return (Array.isArray(rows) ? rows : []).map(safeSignalView);
    }
}

const createContentSignalService = (options) => new ContentSignalService(options);

module.exports = {
    ContentSignalService,
    CREATE_FIELDS,
    SOURCE_TYPES,
    STATUS_TRANSITIONS,
    UPDATE_FIELDS,
    assertSafeText,
    createContentSignalService,
    safeEvidenceUrl,
    safeSignalView,
    unsafePatterns,
    validateAndNormalizeSignalInput
};
