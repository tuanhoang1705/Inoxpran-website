'use strict'

const SAFE_ERROR_CODE = /^[A-Z0-9][A-Z0-9_.-]{0,79}$/i
const SAFE_STORED_ERROR_CODE = /^(?:[A-Z][A-Z0-9]*(?:[_.-][A-Z0-9]+)+|E[A-Z0-9]{2,30}|[0-9]{3,6})$/
const INTERNAL_OWNERSHIP_FIELDS = new Set([
    'activeClaimToken',
    'activeExecutionId',
    'buildToken',
    'claimToken',
    'contentWorkOrderClaimToken',
    'leaseOwner',
    'leaseToken',
    'lockedBy',
    'monitoringClaimToken',
    'ownerToken'
])

const boundedText = (value, fallback = '', maxLength = 500) => {
    const normalized = String(value ?? '')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    return (normalized || fallback).slice(0, maxLength)
}

const safeRequestPath = (req = {}) => {
    const raw = String(req.path || req.originalUrl || req.url || '/')
    return boundedText(raw.split(/[?#]/, 1)[0] || '/', '/', 500)
}

const safeErrorCode = (error) => {
    const candidate = String(error?.code || error?.name || 'INTERNAL_ERROR').trim()
    return SAFE_ERROR_CODE.test(candidate) ? candidate.slice(0, 80) : 'INTERNAL_ERROR'
}

const safePublicErrorCode = (error) => {
    const candidate = String(error?.publicCode || '').trim()
    return SAFE_ERROR_CODE.test(candidate) ? candidate.slice(0, 80) : ''
}

const safeStoredErrorCode = (value, fallback = 'INTERNAL_ERROR') => {
    const candidate = String(value || '').trim()
    if (!candidate) return ''
    return SAFE_STORED_ERROR_CODE.test(candidate)
        ? candidate.slice(0, 80)
        : safeErrorCode({ code: fallback })
}

const redactInternalOwnership = (value) => {
    if (Array.isArray(value)) return value.map(redactInternalOwnership)
    if (!value || typeof value !== 'object') return value
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return value
    return Object.entries(value).reduce((safe, [key, nested]) => {
        if (!INTERNAL_OWNERSHIP_FIELDS.has(key)) safe[key] = redactInternalOwnership(nested)
        return safe
    }, {})
}

const resolveStatusCode = (error, { isJwtError = false, isMulterError = false } = {}) => {
    if (isJwtError) return 401
    const candidate = Number(error?.statusCode || error?.status || (isMulterError ? 400 : 500))
    return Number.isInteger(candidate) && candidate >= 400 && candidate <= 599 ? candidate : 500
}

const safeClientMessage = ({ error, statusCode, isFileSizeError = false, isJwtError = false, uploadMaxFileSize = '', formatUploadSizeMb = () => '1MB' }) => {
    if (isFileSizeError) return `Image size must be ${formatUploadSizeMb(uploadMaxFileSize)} or smaller`
    if (isJwtError) return 'Session expired. Please login again.'
    if (statusCode >= 500) return 'Internal Server Error'
    return boundedText(error?.message, 'Request failed', 500)
}

const buildSafeErrorPayload = ({ error, statusCode, message, requestId = '', includeStack = false }) => {
    const candidateErrorCode = safeErrorCode(error)
    const errorCode = statusCode >= 500
        ? safePublicErrorCode(error) || 'INTERNAL_ERROR'
        : candidateErrorCode === 'Error'
            ? 'REQUEST_FAILED'
            : candidateErrorCode
    const normalizedRequestId = boundedText(requestId, '', 128)
    const payload = {
        status: 'error',
        code: statusCode,
        message: boundedText(message, statusCode >= 500 ? 'Internal Server Error' : 'Request failed', 500),
        errorCode,
        requestId: normalizedRequestId
    }
    const field = boundedText(error?.field, '', 120)
    if (statusCode < 500 && field) payload.field = field
    if (includeStack && error?.stack) payload.stack = boundedText(error.stack, '', 4000)
    return payload
}

const buildSafeServerLog = ({ error, req, statusCode }) => {
    const entry = {
        event: 'http_request_failed',
        statusCode,
        method: boundedText(req?.method, 'UNKNOWN', 16),
        path: safeRequestPath(req),
        errorCode: safeErrorCode(error),
        errorName: boundedText(error?.name, 'Error', 80)
    }
    const requestId = boundedText(req?.requestId, '', 128)
    if (requestId) entry.requestId = requestId
    const providerStatus = Number(error?.providerStatus)
    if (Number.isInteger(providerStatus) && providerStatus >= 400 && providerStatus <= 599) {
        entry.providerStatus = providerStatus
    }
    const providerErrorCode = boundedText(error?.providerErrorCode, '', 80)
    if (providerErrorCode && SAFE_ERROR_CODE.test(providerErrorCode)) {
        entry.providerErrorCode = providerErrorCode
    }
    const providerRequestId = boundedText(error?.providerRequestId, '', 128)
    if (/^[A-Za-z0-9._:-]{1,128}$/.test(providerRequestId)) {
        entry.providerRequestId = providerRequestId
    }
    return entry
}

const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

module.exports = {
    boundedText,
    buildSafeErrorPayload,
    buildSafeServerLog,
    escapeHtml,
    redactInternalOwnership,
    resolveStatusCode,
    safeClientMessage,
    safeErrorCode,
    safeStoredErrorCode,
    safeRequestPath
}
