const CONTROL_KEY = /^(blog_cron|auto_publish|telegram_approval|image_pipeline)$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,128}$/;

export const safeRuntimeControlKey = (value) => {
	const controlKey = String(value || '').trim();
	return CONTROL_KEY.test(controlKey) ? controlKey : '';
};

export const safeRuntimeControlBody = (value) => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const keys = Object.keys(value).sort();
	const expected = ['acknowledgement', 'enabled', 'expectedRevision', 'reason'];
	if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
		return null;
	}
	const reason = String(value.reason || '').trim();
	const acknowledgement = String(value.acknowledgement || '');
	const expectedRevision = Number(value.expectedRevision);
	if (typeof value.enabled !== 'boolean') return null;
	if (!Number.isInteger(expectedRevision) || expectedRevision < 0) return null;
	if (reason.length < 10 || reason.length > 500) return null;
	if (acknowledgement.length < 10 || acknowledgement.length > 128) return null;
	return {
		enabled: value.enabled,
		expectedRevision,
		reason,
		acknowledgement
	};
};

export const safeRuntimeControlIdempotencyKey = (value) => {
	const key = String(value || '').trim();
	return IDEMPOTENCY_KEY.test(key) ? key : '';
};
