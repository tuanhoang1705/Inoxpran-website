const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/;

export const normalizeOpenClawProxyPath = (value) => {
	const raw = String(value || '');
	if (!raw) return '';
	const segments = raw.split('/');
	if (
		segments.some(
			(segment) =>
				!segment ||
				segment !== segment.trim() ||
				!SAFE_SEGMENT.test(segment) ||
				segment === '.' ||
				segment === '..'
		)
	) {
		return null;
	}
	return segments.join('/');
};

export const matchesOpenClawProxyPath = ({ method, path, contracts }) =>
	(contracts[method] || []).some((pattern) => pattern.test(path));
