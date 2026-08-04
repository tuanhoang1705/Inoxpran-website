import {
	sanitizeOpenClawClientPayload,
	sanitizeOpenClawErrorMessage
} from './openclawClientPayload.js';

export const ROADMAP_ENQUEUE_TIMEOUT_MS = 10_000;
export const ROADMAP_READ_TIMEOUT_MS = 15_000;
export const OPENCLAW_PROXY_READ_TIMEOUT_MS = ROADMAP_READ_TIMEOUT_MS;
export const ROADMAP_REASON_MAX_LENGTH = 160;

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,128}$/;
const REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;
const SAFE_ERROR_FIELD = /^[A-Za-z][A-Za-z0-9_.-]{0,119}$/;
const BODY_KEYS = new Set(['reason']);
const CREDENTIAL_URL = /https?:\/\/[^\s<>"']+/gi;
const SECRET_ASSIGNMENT =
	/\b(?:authorization|token|secret|password|credential|api[_-]?key)\b\s*[:=]\s*[^\s,;]+/gi;
const SAFE_ROADMAP_CODES = new Set([
	'BLOG_SCHEDULE_ACTIVE_ROADMAP_CLAIM',
	'GOOGLE_INTELLIGENCE_SNAPSHOT_UNAVAILABLE',
	'OPENCLAW_AGENT_FETCH_UNAVAILABLE',
	'OPENCLAW_AGENT_GATEWAY_INVALID_JSON',
	'OPENCLAW_AGENT_GATEWAY_UNREACHABLE',
	'OPENCLAW_AGENT_INVALID_JSON',
	'OPENCLAW_AGENT_NON_JSON_RESPONSE',
	'OPENCLAW_AGENT_NOT_ALLOWED',
	'OPENCLAW_AGENT_REQUEST_TOO_LARGE',
	'OPENCLAW_AGENT_RESOLVED_MODEL_MISSING',
	'OPENCLAW_AGENT_RESOLVED_MODEL_NOT_ALLOWED',
	'OPENCLAW_AGENT_TIMEOUT',
	'OPENCLAW_GATEWAY_AUTH_REJECTED',
	'OPENCLAW_GATEWAY_PATH_INVALID',
	'OPENCLAW_GATEWAY_TOKEN_MISSING',
	'OPENCLAW_GATEWAY_URL_INVALID',
	'OPENCLAW_GATEWAY_URL_MISSING',
	'OPENCLAW_GATEWAY_URL_UNSAFE',
	'OPENCLAW_PROVIDER_AUTH_EXPIRED',
	'OPENCLAW_PROVIDER_AUTH_FAILED',
	'OPENCLAW_TOPIC_AGENT_BUDGET_EXHAUSTED',
	'ROADMAP_IDEATION_FAILED',
	'ROADMAP_INTELLIGENCE_UNAVAILABLE',
	'ROADMAP_NO_ACCEPTABLE_TOPIC',
	'ROADMAP_NO_READY_TOPIC',
	'ROADMAP_NO_SAFE_TOPIC',
	'ROADMAP_REGENERATION_ATTEMPTS_EXHAUSTED',
	'ROADMAP_REGENERATION_FAILED',
	'ROADMAP_REGENERATION_LEASE_LOST',
	'ROADMAP_REGENERATION_SUPERSEDED',
	'ROADMAP_REQUIRED_EVIDENCE_UNAVAILABLE',
	'ROADMAP_SCORE_UNREACHABLE',
	'ROADMAP_REPLACEMENT_COMMITTED',
	'TOPIC_ROADMAP_DISABLED'
]);

const SAFE_PROXY_CODES = new Set([
	...SAFE_ROADMAP_CODES,
	'OPENCLAW_BACKEND_ERROR',
	'OPENCLAW_BACKEND_INVALID_RESPONSE',
	'OPENCLAW_BACKEND_TIMEOUT',
	'OPENCLAW_BACKEND_UNAVAILABLE',
	'OPENCLAW_INVALID_REQUEST'
]);

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const responseJson = (payload, status) =>
	new Response(JSON.stringify(payload), {
		status,
		headers: { 'content-type': 'application/json; charset=utf-8' }
	});

const redactCredentialUrls = (value) =>
	String(value || '').replace(CREDENTIAL_URL, (rawUrl) => {
		const trailing = rawUrl.match(/[),.;!?]+$/)?.[0] || '';
		const candidate = trailing ? rawUrl.slice(0, -trailing.length) : rawUrl;
		try {
			const url = new URL(candidate);
			return url.username || url.password ? `[redacted-url]${trailing}` : rawUrl;
		} catch {
			return '[redacted-url]';
		}
	});

export const sanitizeRoadmapProxyMessage = (value, fallback) =>
	redactCredentialUrls(sanitizeOpenClawErrorMessage(value, fallback))
		.replace(SECRET_ASSIGNMENT, '[redacted]')
		.slice(0, 500) || fallback;

export const safeRoadmapCode = (value) => {
	const code = String(value || '').trim();
	if (SAFE_PROXY_CODES.has(code)) return code;
	if (/^OPENCLAW_AGENT_HTTP_(?:400|401|403|404|408|409|422|429|500|502|503|504)$/.test(code)) {
		return code;
	}
	return '';
};

export const safeRoadmapReasonBody = (body) => {
	if (!isRecord(body) || Object.keys(body).some((key) => !BODY_KEYS.has(key))) return null;
	if (body.reason === undefined) return {};
	if (typeof body.reason !== 'string') return null;
	const reason = body.reason.trim();
	if (reason.length > ROADMAP_REASON_MAX_LENGTH) return null;
	return reason ? { reason } : {};
};

export const safeRoadmapIdempotencyKey = (value) => {
	const key = String(value || '').trim();
	return IDEMPOTENCY_KEY.test(key) ? key : '';
};

export const safeOpenClawRequestId = (value) => {
	const requestId = String(value || '').trim();
	return REQUEST_ID.test(requestId) ? requestId : '';
};

export const createOpenClawRequestId = () => {
	const uuid = globalThis.crypto?.randomUUID?.();
	return (
		safeOpenClawRequestId(uuid) || `oc-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
	);
};

export const readRoadmapActionBody = async (request) => {
	let raw;
	try {
		raw = await request.text();
	} catch {
		return null;
	}
	if (!raw.trim()) return {};
	try {
		return safeRoadmapReasonBody(JSON.parse(raw));
	} catch {
		return null;
	}
};

export const isRoadmapPayload = (payload) =>
	isRecord(payload) &&
	Object.prototype.hasOwnProperty.call(payload, 'roadmap') &&
	(payload.roadmap === null || isRecord(payload.roadmap)) &&
	Array.isArray(payload.items) &&
	(payload.regeneration === null ||
		payload.regeneration === undefined ||
		isRecord(payload.regeneration));

export const isRoadmapEnqueuePayload = (payload) =>
	isRecord(payload) &&
	typeof payload.queued === 'boolean' &&
	typeof payload.duplicate === 'boolean' &&
	typeof payload.coalesced === 'boolean' &&
	isRecord(payload.regeneration) &&
	typeof payload.regeneration.id === 'string' &&
	typeof payload.regeneration.status === 'string';

export const isOpenClawOperationPayload = (payload) => isRecord(payload);
export const isOpenClawObjectPayload = isOpenClawOperationPayload;

export const isExecutionListPayload = (payload) =>
	isRecord(payload) && Array.isArray(payload.executions);

export const isExecutionSummariesPayload = (payload) =>
	isRecord(payload) &&
	typeof payload.checkedAt === 'string' &&
	Array.isArray(payload.summaries) &&
	payload.summaries.every(
		(summary) =>
			isRecord(summary) &&
			typeof summary.scheduleId === 'string' &&
			Array.isArray(summary.executions)
	);

const backendPayload = (payload) => {
	if (!isRecord(payload)) return null;
	if (Object.prototype.hasOwnProperty.call(payload, 'metadata')) {
		return isRecord(payload.metadata) ? payload.metadata : null;
	}
	return payload;
};

const proxyFailure = (status, error, errorCode, requestId, extra = {}) =>
	responseJson({ error, errorCode, requestId, ...extra }, status);

export const openClawProxyClientError = ({
	status = 400,
	error,
	errorCode = 'OPENCLAW_INVALID_REQUEST',
	requestId,
	field,
	code
} = {}) => {
	const safeStatus = Number.isInteger(status) && status >= 400 && status < 500 ? status : 400;
	const safeRequestId = safeOpenClawRequestId(requestId) || createOpenClawRequestId();
	const safeErrorCode = safeRoadmapCode(errorCode) || 'OPENCLAW_INVALID_REQUEST';
	const extra = {};
	if (SAFE_ERROR_FIELD.test(String(field || ''))) extra.field = String(field);
	if (Number.isInteger(code) && code >= 400 && code < 500) extra.code = code;
	return proxyFailure(
		safeStatus,
		sanitizeRoadmapProxyMessage(error, 'Invalid OpenClaw request'),
		safeErrorCode,
		safeRequestId,
		extra
	);
};

const sanitizeRoadmapPayload = (value) => {
	const sanitized = sanitizeOpenClawClientPayload(value);
	if (Array.isArray(sanitized)) return sanitized.map(sanitizeRoadmapPayload);
	if (!sanitized || typeof sanitized !== 'object') {
		return typeof sanitized === 'string' ? redactCredentialUrls(sanitized) : sanitized;
	}
	return Object.fromEntries(
		Object.entries(sanitized).map(([key, child]) => [key, sanitizeRoadmapPayload(child)])
	);
};

export const proxyOpenClawRequest = async ({
	cookies,
	fetch,
	path,
	options = {},
	timeoutMs = ROADMAP_READ_TIMEOUT_MS,
	validatePayload = isOpenClawOperationPayload,
	fallbackError = 'Unable to process OpenClaw request',
	requestId: suppliedRequestId,
	adminFetch
} = {}) => {
	if (typeof adminFetch !== 'function') {
		throw new TypeError('proxyOpenClawRequest requires adminFetch');
	}
	const localRequestId = safeOpenClawRequestId(suppliedRequestId) || createOpenClawRequestId();
	const controller = new AbortController();
	let timedOut = false;
	let timer;
	const timeoutPromise = new Promise((_, reject) => {
		timer = setTimeout(
			() => {
				timedOut = true;
				controller.abort();
				reject(Object.assign(new Error('OpenClaw backend timeout'), { name: 'AbortError' }));
			},
			Math.max(1, Number(timeoutMs) || ROADMAP_READ_TIMEOUT_MS)
		);
	});

	let response;
	try {
		response = await Promise.race([
			adminFetch({
				cookies,
				fetch,
				path,
				options: {
					...options,
					headers: { ...(options.headers || {}), 'x-request-id': localRequestId },
					signal: controller.signal
				}
			}),
			timeoutPromise
		]);
	} catch (error) {
		clearTimeout(timer);
		const aborted =
			timedOut ||
			controller.signal.aborted ||
			error?.name === 'AbortError' ||
			String(error?.message || '')
				.toLowerCase()
				.includes('aborted');
		return aborted
			? proxyFailure(
					504,
					'OpenClaw backend did not confirm the request in time',
					'OPENCLAW_BACKEND_TIMEOUT',
					localRequestId
				)
			: proxyFailure(
					502,
					'OpenClaw backend is temporarily unavailable',
					'OPENCLAW_BACKEND_UNAVAILABLE',
					localRequestId
				);
	}

	if (
		!response ||
		typeof response.status !== 'number' ||
		typeof response.ok !== 'boolean' ||
		typeof response.json !== 'function'
	) {
		clearTimeout(timer);
		return proxyFailure(
			502,
			'OpenClaw backend returned an invalid response',
			'OPENCLAW_BACKEND_INVALID_RESPONSE',
			localRequestId
		);
	}

	let rawPayload;
	try {
		rawPayload = await Promise.race([response.json(), timeoutPromise]);
	} catch (error) {
		clearTimeout(timer);
		const aborted =
			timedOut ||
			controller.signal.aborted ||
			error?.name === 'AbortError' ||
			String(error?.message || '')
				.toLowerCase()
				.includes('aborted');
		return aborted
			? proxyFailure(
					504,
					'OpenClaw backend did not confirm the request in time',
					'OPENCLAW_BACKEND_TIMEOUT',
					localRequestId
				)
			: proxyFailure(
					502,
					'OpenClaw backend returned an invalid response',
					'OPENCLAW_BACKEND_INVALID_RESPONSE',
					localRequestId
				);
	}
	clearTimeout(timer);
	const responseRequestId =
		safeOpenClawRequestId(rawPayload?.requestId) ||
		safeOpenClawRequestId(response.headers?.get?.('x-request-id')) ||
		localRequestId;
	if (!response.ok) {
		if (response.status >= 500) {
			return proxyFailure(
				502,
				'OpenClaw backend request failed',
				'OPENCLAW_BACKEND_ERROR',
				responseRequestId
			);
		}
		const payload = isRecord(rawPayload) ? rawPayload : {};
		const errorCode = safeRoadmapCode(payload.errorCode);
		const outcomeCode = safeRoadmapCode(payload.outcomeCode);
		const field = SAFE_ERROR_FIELD.test(String(payload.field || '')) ? String(payload.field) : '';
		const code =
			Number.isInteger(payload.code) && payload.code >= 400 && payload.code < 500
				? payload.code
				: null;
		return responseJson(
			{
				error: sanitizeRoadmapProxyMessage(payload.message || payload.error, fallbackError),
				...(errorCode ? { errorCode } : {}),
				...(outcomeCode ? { outcomeCode } : {}),
				...(field ? { field } : {}),
				...(code ? { code } : {}),
				requestId: responseRequestId
			},
			response.status
		);
	}

	const payload = backendPayload(rawPayload);
	if (!payload || !validatePayload(payload)) {
		return proxyFailure(
			502,
			'OpenClaw backend returned an invalid response',
			'OPENCLAW_BACKEND_INVALID_RESPONSE',
			responseRequestId
		);
	}
	return responseJson(
		{ ...sanitizeRoadmapPayload(payload), requestId: responseRequestId },
		response.status
	);
};

export const proxyOpenClawRoadmapRequest = proxyOpenClawRequest;
