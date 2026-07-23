export const MAX_EMPTY_JSON_BODY_BYTES = 1024;

export const isExactEmptyJsonBody = ({
	rawBody,
	contentLength,
	maxBytes = MAX_EMPTY_JSON_BODY_BYTES
}) => {
	const declaredLength = Number(contentLength || 0);
	if (Number.isFinite(declaredLength) && declaredLength > maxBytes) return false;

	const bodyText = String(rawBody ?? '');
	if (Buffer.byteLength(bodyText, 'utf8') > maxBytes) return false;
	if (!bodyText.trim()) return true;

	try {
		const body = JSON.parse(bodyText);
		return Boolean(
			body && typeof body === 'object' && !Array.isArray(body) && !Object.keys(body).length
		);
	} catch {
		return false;
	}
};
