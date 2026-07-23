import { sanitizeDashboardUrl } from '../openclaw/capabilityHealth.js';

const SECRET_FIELD = /(token|secret|password|credential|authorization|api[_-]?key)/i;
const SECRET_ASSIGNMENT =
	/\b([A-Za-z][A-Za-z0-9_.-]*(?:token|secret|password|credential|authorization|api[_-]?key)[A-Za-z0-9_.-]*)\b\s*[:=]\s*[^\s,;]+/gi;
const AUTHORIZATION_VALUE = /\b(authorization)\s*[:=]\s*(?:bearer|basic)\s+[^\s,;]+/gi;
const SECRET_URL_VALUE =
	/([?&#](?:token|access_token|auth|authorization|api[_-]?key|secret|password|credential)=)[^&#\s]+/gi;

const sanitizeString = (value) =>
	String(value)
		.replace(AUTHORIZATION_VALUE, '$1=[redacted]')
		.replace(SECRET_ASSIGNMENT, '$1=[redacted]')
		.replace(SECRET_URL_VALUE, '$1[redacted]');

export const sanitizeOpenClawErrorMessage = (value, fallback = 'Request failed') => {
	const candidate = typeof value === 'string' && value.trim() ? value : fallback;
	return sanitizeString(candidate).trim().slice(0, 500) || fallback;
};

export const sanitizeOpenClawClientPayload = (value, key = '') => {
	if (
		SECRET_FIELD.test(key) &&
		(typeof value === 'string' || (value !== null && typeof value === 'object'))
	) {
		return '[redacted]';
	}
	if (Array.isArray(value)) {
		return value.map((item) => sanitizeOpenClawClientPayload(item));
	}
	if (!value || typeof value !== 'object') {
		if (typeof value !== 'string') return value;
		if (SECRET_FIELD.test(key)) return '[redacted]';
		return sanitizeString(value);
	}

	const result = {};
	for (const [childKey, childValue] of Object.entries(value)) {
		if (childKey === 'dashboardUrl') {
			const safeUrl = sanitizeDashboardUrl(childValue);
			if (safeUrl) result[childKey] = safeUrl;
			continue;
		}
		if (
			SECRET_FIELD.test(childKey) &&
			(typeof childValue === 'string' || (childValue !== null && typeof childValue === 'object'))
		) {
			result[childKey] = '[redacted]';
			continue;
		}
		result[childKey] = sanitizeOpenClawClientPayload(childValue, childKey);
	}
	return result;
};
