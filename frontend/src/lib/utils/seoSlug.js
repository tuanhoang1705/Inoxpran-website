const DEFAULT_MAX_SLUG_LENGTH = 80;

const normalizeVietnamese = (value) =>
	String(value || '')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[\u0111\u0110]/g, (char) => (char === '\u0111' ? 'd' : 'D'));

export const toSeoSlug = (value, { maxLength = DEFAULT_MAX_SLUG_LENGTH } = {}) => {
	const normalized = normalizeVietnamese(value)
		.toLowerCase()
		.replace(/&/g, ' va ')
		.replace(/['"`\u2019]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-+|-+$/g, '');

	if (!normalized) return '';
	if (!Number.isFinite(maxLength) || maxLength <= 0) return normalized;

	return normalized.slice(0, maxLength).replace(/-+$/g, '');
};

export { DEFAULT_MAX_SLUG_LENGTH };
