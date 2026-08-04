const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

const SAFE_ERROR_CODES = new Set([
	'GOOGLE_INTELLIGENCE_LOAD_FAILED',
	'OPENCLAW_BACKEND_ERROR',
	'OPENCLAW_BACKEND_INVALID_RESPONSE',
	'OPENCLAW_BACKEND_TIMEOUT',
	'OPENCLAW_BACKEND_UNAVAILABLE',
	'OPENCLAW_CAPABILITY_CHECK_FAILED',
	'OPENCLAW_CONSOLE_LOAD_FAILED',
	'OPENCLAW_CORE_LOAD_FAILED',
	'OPENCLAW_INVALID_REQUEST',
	'OPENCLAW_OPERATIONS_LOAD_FAILED',
	'OPENCLAW_QA_LOAD_FAILED',
	'OPENCLAW_REQUEST_FAILED',
	'OPENCLAW_RESPONSE_INTERRUPTED',
	'OPENCLAW_RUN_START_FAILED',
	'OPENCLAW_RUNTIME_CONTROL_FAILED'
]);

const COPY = Object.freeze({
	en: {
		GOOGLE_INTELLIGENCE_LOAD_FAILED:
			'Unable to load Google Intelligence. Please try again shortly.',
		OPENCLAW_BACKEND_TIMEOUT: 'The service took too long to respond. Please try again.',
		OPENCLAW_CAPABILITY_CHECK_FAILED:
			'The capability check could not be completed. Please try again.',
		OPENCLAW_CONSOLE_LOAD_FAILED: 'Unable to load the OpenClaw console. Please try again shortly.',
		OPENCLAW_CORE_LOAD_FAILED: 'Unable to load the Blog OpenClaw core. Please try again shortly.',
		OPENCLAW_INVALID_REQUEST: 'The request was rejected. Review the input and try again.',
		OPENCLAW_OPERATIONS_LOAD_FAILED:
			'Some Content Operations data could not be loaded. Please try again shortly.',
		OPENCLAW_QA_LOAD_FAILED: 'Unable to load Agentic Blog QA. Please try again shortly.',
		OPENCLAW_REQUEST_FAILED: 'The request failed. Please try again.',
		OPENCLAW_RESPONSE_INTERRUPTED:
			'The response was interrupted. Retry the same action to safely check the original request.',
		OPENCLAW_RUN_START_FAILED: 'The OpenClaw command could not be started. Please try again.',
		OPENCLAW_RUNTIME_CONTROL_FAILED: 'The runtime control could not be updated. Please try again.',
		backendUnavailable: 'The OpenClaw service is temporarily unavailable. Please try again.',
		reference: 'Reference'
	},
	vi: {
		GOOGLE_INTELLIGENCE_LOAD_FAILED: 'Không thể tải Google Intelligence. Vui lòng thử lại sau.',
		OPENCLAW_BACKEND_TIMEOUT: 'Dịch vụ phản hồi quá thời gian. Vui lòng thử lại.',
		OPENCLAW_CAPABILITY_CHECK_FAILED: 'Không thể hoàn tất kiểm tra năng lực. Vui lòng thử lại.',
		OPENCLAW_CONSOLE_LOAD_FAILED: 'Không thể tải console OpenClaw. Vui lòng thử lại sau.',
		OPENCLAW_CORE_LOAD_FAILED: 'Không thể tải lõi Blog OpenClaw. Vui lòng thử lại sau.',
		OPENCLAW_INVALID_REQUEST: 'Yêu cầu bị từ chối. Hãy kiểm tra dữ liệu và thử lại.',
		OPENCLAW_OPERATIONS_LOAD_FAILED:
			'Không thể tải đầy đủ dữ liệu Vận hành Nội dung. Vui lòng thử lại sau.',
		OPENCLAW_QA_LOAD_FAILED: 'Không thể tải Agentic Blog QA. Vui lòng thử lại sau.',
		OPENCLAW_REQUEST_FAILED: 'Yêu cầu không thành công. Vui lòng thử lại.',
		OPENCLAW_RESPONSE_INTERRUPTED:
			'Phản hồi bị gián đoạn. Hãy thử lại đúng hành động này để kiểm tra an toàn yêu cầu ban đầu.',
		OPENCLAW_RUN_START_FAILED: 'Không thể khởi chạy lệnh OpenClaw. Vui lòng thử lại.',
		OPENCLAW_RUNTIME_CONTROL_FAILED: 'Không thể cập nhật công tắc runtime. Vui lòng thử lại.',
		backendUnavailable: 'Dịch vụ OpenClaw đang tạm thời không khả dụng. Vui lòng thử lại.',
		reference: 'Mã tra cứu'
	}
});

const BACKEND_UNAVAILABLE_CODES = new Set([
	'OPENCLAW_BACKEND_ERROR',
	'OPENCLAW_BACKEND_INVALID_RESPONSE',
	'OPENCLAW_BACKEND_UNAVAILABLE'
]);

const headerValue = (headers, name) => {
	if (!headers) return '';
	if (typeof headers.get === 'function') return headers.get(name) || '';
	return headers[name] || headers[name.toLowerCase()] || '';
};

export const safeOpenClawUiRequestId = (value) => {
	const requestId = String(value || '').trim();
	return REQUEST_ID.test(requestId) ? requestId : '';
};

export const safeOpenClawUiErrorCode = (value) => {
	const errorCode = String(value || '').trim();
	return SAFE_ERROR_CODES.has(errorCode) ? errorCode : '';
};

export const normalizeOpenClawUiError = (
	value,
	fallbackCode = 'OPENCLAW_REQUEST_FAILED',
	headers
) => {
	const source = value && typeof value === 'object' ? value : {};
	const errorCode =
		safeOpenClawUiErrorCode(source.errorCode) ||
		safeOpenClawUiErrorCode(source.code) ||
		safeOpenClawUiErrorCode(typeof value === 'string' ? value : '') ||
		safeOpenClawUiErrorCode(fallbackCode) ||
		'OPENCLAW_REQUEST_FAILED';
	const requestId = safeOpenClawUiRequestId(
		source.requestId || headerValue(headers, 'x-request-id')
	);
	return { errorCode, requestId };
};

export const openClawUiErrorText = (
	value,
	{ isEn = false, fallbackCode = 'OPENCLAW_REQUEST_FAILED' } = {}
) => {
	const error = normalizeOpenClawUiError(value, fallbackCode);
	const copy = isEn ? COPY.en : COPY.vi;
	const message = BACKEND_UNAVAILABLE_CODES.has(error.errorCode)
		? copy.backendUnavailable
		: copy[error.errorCode] || copy.OPENCLAW_REQUEST_FAILED;
	return error.requestId ? `${message} · ${copy.reference}: ${error.requestId}` : message;
};
