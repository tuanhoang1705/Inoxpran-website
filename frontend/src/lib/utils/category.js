const CATEGORY_SLUG_MAP = Object.freeze({
	Inoxs: 'noi-inox',
	CastIrons: 'noi-gang',
	Electronics: 'gia-dung-dien'
});

const SLUG_CATEGORY_MAP = Object.freeze(
	Object.entries(CATEGORY_SLUG_MAP).reduce((acc, [key, value]) => {
		acc[value] = key;
		return acc;
	}, {})
);

const normalizeText = (value) =>
	String(value || '')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/đ/g, 'd')
		.replace(/Đ/g, 'd');

const slugify = (value) =>
	normalizeText(value)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.replace(/-{2,}/g, '-');

const resolveCategorySlug = (value) => {
	const raw = String(value || '').trim();
	if (!raw) return '';
	return CATEGORY_SLUG_MAP[raw] || slugify(raw);
};

const resolveCategoryValue = (slug, candidates = []) => {
	const normalized = slugify(slug);
	if (!normalized) return '';
	if (SLUG_CATEGORY_MAP[normalized]) return SLUG_CATEGORY_MAP[normalized];
	for (const candidate of candidates) {
		if (!candidate) continue;
		if (resolveCategorySlug(candidate) === normalized) return candidate;
	}
	return '';
};

export { CATEGORY_SLUG_MAP, resolveCategorySlug, resolveCategoryValue, slugify };
