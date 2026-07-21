'use strict'

const crypto = require('node:crypto')
const { ContentOperationsAuditLog } = require('../../models/contentOperationsAuditLog.model')

const safeText = (value, max = 2000) => String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/mongodb(?:\+srv)?:\/\/[^\s"']+/gi, '[redacted-database-uri]')
    .replace(/\bBearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [redacted]')
    .replace(/((?:api[_-]?key|access[_-]?token|token|authorization|client[_-]?secret|private[_-]?key|password|passwd|secret|signature|credential|session[_-]?id|cookie)\s*[:=]\s*)[^\s,;]+/gi, '$1[redacted]')
    .replace(/([?&#](?:access[_-]?token|token|auth(?:orization)?|api[_-]?key|secret|signature|credential|password|session|email|phone)=)[^&#\s"']+/gi, '$1[redacted]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
    .replace(/(?:^|\D)(?:\+?84|0)[\s().-]*(?:\d[\s().-]*){8,11}(?=\D|$)/g, (match) => `${match.match(/^\D/)?.[0] || ''}[redacted-phone]`)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)

const SENSITIVE_AUDIT_KEY = /(?:^|[_-])(?:access[_-]?token|token|auth(?:orization)?|api[_-]?key|secret|signature|credential|password|passcode|cookie|session|email|e[_-]?mail|phone|mobile|tel|customer[_-]?(?:name|address|message)|raw[_-]?(?:message|conversation))(?:$|[_-])/i

const safeAuditValue = (value, { depth = 0, maxString = 2000 } = {}) => {
    if (depth > 4 || value === undefined) return null
    if (value === null || typeof value === 'boolean') return value
    if (typeof value === 'number') return Number.isFinite(value) ? value : null
    if (typeof value === 'string') return safeText(value, maxString)
    if (value instanceof Date) return value.toISOString()
    if (value?._bsontype === 'ObjectId' || value?.constructor?.name === 'ObjectId') return safeText(String(value), 128)
    if (Array.isArray(value)) return value.slice(0, 100).map((item) => safeAuditValue(item, { depth: depth + 1, maxString }))
    if (typeof value !== 'object') return safeText(value, maxString)
    const source = typeof value.toObject === 'function' ? value.toObject() : value
    return Object.keys(source).slice(0, 100).reduce((result, rawKey) => {
        const key = safeText(rawKey, 80)
        if (!key) return result
        const compactKey = key.replace(/[^a-z0-9]/gi, '').toLowerCase()
        result[key] = SENSITIVE_AUDIT_KEY.test(key) || /^(?:apikey|accesstoken|authorization|clientsecret|password|passwd|secret|signature|credential|cookie|sessionid|email|phone|mobile|customeremail|customerphone|customername|customeraddress|customermessage|rawmessage|rawconversation)$/.test(compactKey)
            ? '[redacted]'
            : safeAuditValue(source[rawKey], { depth: depth + 1, maxString })
        return result
    }, {})
}

const hashIp = (ip, secret = process.env.CONTENT_OPERATIONS_AUDIT_HMAC_SECRET || process.env.JWT_SECRET) => {
    if (!ip || !secret) return ''
    return crypto.createHmac('sha256', secret).update(String(ip)).digest('hex')
}

const writeContentOperationsAudit = async ({
    action,
    actorAdminId = null,
    entityType,
    entityId = null,
    contentWorkOrderId = null,
    reason,
    changes = [],
    metadata = {},
    correlationId = '',
    ip = '',
    AuditModel = ContentOperationsAuditLog
} = {}) => {
    if (!action || !entityType || !reason) throw new Error('Content Operations audit action, entity type, and reason are required')
    return AuditModel.create({
        action: safeText(action, 160),
        actorAdminId,
        entityType: safeText(entityType, 100),
        entityId,
        contentWorkOrderId,
        reason: safeText(reason),
        changes: Array.isArray(changes) ? safeAuditValue(changes.slice(0, 100)) : [],
        metadata: safeAuditValue(metadata) || {},
        correlationId: safeText(correlationId, 160),
        ipHash: hashIp(ip),
        occurredAt: new Date()
    })
}

module.exports = { hashIp, safeAuditValue, safeText, writeContentOperationsAudit }
