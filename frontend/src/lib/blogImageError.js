const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

const ERROR_TRANSLATION_KEYS = Object.freeze({
	ADMIN_SESSION_REQUIRED: 'sessionRequired',
	AI_IMAGE_ACCESS_DENIED: 'providerAccess',
	AI_IMAGE_AUTH_FAILED: 'providerAuth',
	AI_IMAGE_CREDIT_EXHAUSTED: 'creditExhausted',
	AI_IMAGE_EMPTY_RESULT: 'emptyResult',
	AI_IMAGE_INVALID_RESPONSE: 'providerUnavailable',
	AI_IMAGE_POLICY_REJECTED: 'policyRejected',
	AI_IMAGE_PROVIDER_UNAVAILABLE: 'providerUnavailable',
	AI_IMAGE_RATE_LIMITED: 'rateLimited',
	AI_IMAGE_REQUEST_REJECTED: 'requestRejected',
	AI_IMAGE_TIMEOUT: 'timeout',
	IMAGE_BACKEND_UNAVAILABLE: 'backendUnavailable',
	IMAGE_OPERATION_FAILED: 'process',
	IMAGE_OPERATION_NOT_FOUND: 'process'
});

export const safeBlogImageErrorCode = (value) => {
	const code = String(value || '').trim();
	return Object.hasOwn(ERROR_TRANSLATION_KEYS, code) ? code : '';
};

export const safeBlogImageRequestId = (value) => {
	const requestId = String(value || '').trim();
	return REQUEST_ID.test(requestId) ? requestId : '';
};

const headerValue = (headers, name) => {
	if (!headers) return '';
	if (typeof headers.get === 'function') return headers.get(name) || '';
	return headers[name] || headers[name.toLowerCase()] || '';
};

export const normalizeBlogImageError = (value, headers) => {
	const source = value && typeof value === 'object' ? value : {};
	return {
		errorCode:
			safeBlogImageErrorCode(source.errorCode) ||
			safeBlogImageErrorCode(source.code) ||
			'IMAGE_OPERATION_FAILED',
		requestId: safeBlogImageRequestId(source.requestId || headerValue(headers, 'x-request-id'))
	};
};

export const blogImageErrorText = (value, { t, headers } = {}) => {
	const normalized = normalizeBlogImageError(value, headers);
	const translationKey = ERROR_TRANSLATION_KEYS[normalized.errorCode] || 'process';
	const message =
		typeof t === 'function'
			? t(`admin.blogImageReview.errors.${translationKey}`)
			: 'Unable to process the image.';
	if (!normalized.requestId || typeof t !== 'function') return message;
	return `${message} · ${t('admin.blogImageReview.errors.reference')}: ${normalized.requestId}`;
};
