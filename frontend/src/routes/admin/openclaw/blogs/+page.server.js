import { adminApiFetch } from '$lib/server/adminApi.js';

const BLOG_SCHEDULES_LOAD_FAILED = 'BLOG_SCHEDULES_LOAD_FAILED';
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

const safeRequestId = (value) => {
	const candidate = String(value || '').trim();
	return REQUEST_ID_PATTERN.test(candidate) ? candidate : '';
};

const loadFailure = (response, payload) => ({
	schedules: null,
	loadErrorCode: BLOG_SCHEDULES_LOAD_FAILED,
	loadRequestId: safeRequestId(payload?.requestId || response?.headers?.get?.('x-request-id'))
});

export const load = async ({ cookies, fetch }) => {
	try {
		const response = await adminApiFetch({
			cookies,
			fetch,
			path: '/admin/openclaw/blog-schedules?limit=50&page=1'
		});
		const payload = await response.json().catch(() => null);
		if (!response.ok) {
			return loadFailure(response, payload);
		}
		return { schedules: payload?.metadata || null, loadErrorCode: '', loadRequestId: '' };
	} catch {
		return loadFailure();
	}
};
