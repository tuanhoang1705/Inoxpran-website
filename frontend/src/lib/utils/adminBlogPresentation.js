const CATEGORY_KEYS = new Set([
	'guide',
	'care',
	'knowledge',
	'trend',
	'product',
	'design',
	'news',
	'tips',
	'comparison',
	'buyingGuide'
]);

const CATEGORY_ALIASES = {
	buying_guide: 'buyingGuide',
	'buying-guide': 'buyingGuide'
};

export const getAdminBlogCategoryTranslationKey = (category) => {
	const normalized = String(category || '').trim();
	const key = CATEGORY_ALIASES[normalized] || normalized;
	return `admin.blogs.categories.${CATEGORY_KEYS.has(key) ? key : 'other'}`;
};

export const getAdminBlogSourceTranslationKey = (item = {}) =>
	`admin.blogs.source.${item.sourceType === 'agentic' || item.isAgentic === true ? 'agentic' : 'manual'}`;

export const isAgenticBlog = (item = {}) =>
	item.sourceType === 'agentic' || item.isAgentic === true;
