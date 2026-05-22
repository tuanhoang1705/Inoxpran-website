const REVIEW_TEMPLATES = {
	vi: [
		{
			author: 'Minh Anh',
			title: 'Cầm rất chắc tay',
			content:
				'Sản phẩm hoàn thiện đẹp, đáy dày và dùng bếp từ ổn định. Mình mua để nấu hằng ngày, cảm giác chắc chắn hơn các bộ nồi phổ thông.'
		},
		{
			author: 'Hoàng Phúc',
			title: 'Đúng chất inox cao cấp',
			content:
				'Bề mặt sáng, dễ vệ sinh sau khi nấu. Đóng gói kỹ, nhận hàng không bị móp méo và có tư vấn sử dụng khá rõ.'
		},
		{
			author: 'Lan Hương',
			title: 'Gia đình rất hài lòng',
			content:
				'Nấu canh và kho thịt đều ổn, tay cầm chắc, kiểu dáng hợp căn bếp hiện đại. Mình thích nhất là cảm giác sạch và bền.'
		},
		{
			author: 'Quốc Bảo',
			title: 'Giao nhanh, tư vấn kỹ',
			content:
				'Đặt hàng buổi tối hôm trước, nhân viên xác nhận nhanh. Sản phẩm đúng mô tả, mức giá sau ưu đãi khá tốt.'
		},
		{
			author: 'Thảo Vy',
			title: 'Phù hợp làm quà tặng',
			content:
				'Hộp và sản phẩm nhìn sang, mình mua tặng ba mẹ. Phần bảo hành và hướng dẫn bảo quản làm mình yên tâm hơn.'
		}
	],
	en: [
		{
			author: 'Anna Nguyen',
			title: 'Solid daily cookware',
			content:
				'The finish feels premium, the base heats evenly, and the set looks clean in a modern kitchen. Good value after the welcome offer.'
		},
		{
			author: 'David Tran',
			title: 'Well packed and practical',
			content:
				'The product arrived safely packed. It works well on an induction cooktop and is easy to clean after everyday cooking.'
		},
		{
			author: 'Linh Pham',
			title: 'Premium feel',
			content:
				'The handle feels stable and the stainless surface is bright. Customer support also explained how to care for it clearly.'
		},
		{
			author: 'Bao Le',
			title: 'Fast confirmation',
			content:
				'Order confirmation was quick and the product matched the photos. The build feels much sturdier than my previous cookware.'
		},
		{
			author: 'Vy Hoang',
			title: 'Great for gifting',
			content:
				'Clean packaging, elegant design, and useful warranty information. It made a polished gift for my family.'
		}
	]
};

const REVIEW_DATES = ['2026-04-28', '2026-04-21', '2026-04-12', '2026-03-30', '2026-03-18'];

const clampRating = (value) => {
	const numeric = Number(value);
	if (!Number.isFinite(numeric) || numeric <= 0) return 0;
	return Math.min(5, Math.round(numeric * 10) / 10);
};

const hasPositiveRating = (product) => {
	const average = clampRating(product?.product_ratingsAverage);
	const count = Number(product?.product_ratingsCount);
	return average > 0 && Number.isFinite(count) && count > 0;
};

const resolveLocale = (localeValue) => (localeValue === 'en' ? 'en' : 'vi');

const getProductSeed = (product) => {
	const raw = String(product?.product_slug || product?._id || product?.product_name || 'inoxpran');
	return Array.from(raw).reduce((sum, char) => sum + char.charCodeAt(0), 0);
};

const rotate = (items, offset) => {
	if (!items.length) return [];
	const safeOffset = ((offset % items.length) + items.length) % items.length;
	return [...items.slice(safeOffset), ...items.slice(0, safeOffset)];
};

export const buildStaticReviewsForProduct = (product, localeValue = 'vi', count = 5) => {
	if (!product || hasPositiveRating(product)) return [];
	const locale = resolveLocale(localeValue);
	const templates = rotate(REVIEW_TEMPLATES[locale], getProductSeed(product));
	const safeCount = Math.max(1, Math.min(Number(count) || 5, templates.length));
	return templates.slice(0, safeCount).map((template, index) => ({
		id: `static-marketing-${String(product?._id || product?.product_slug || 'product')}-${index + 1}`,
		rating: 5,
		title: template.title,
		content: template.content,
		author: template.author,
		verifiedPurchase: true,
		createdAt: REVIEW_DATES[index] || REVIEW_DATES[REVIEW_DATES.length - 1]
	}));
};

export const getMarketingRatingSummary = (product, localeValue = 'vi') => {
	const locale = resolveLocale(localeValue);
	const realAverage = clampRating(product?.product_ratingsAverage);
	const realCount = Number(product?.product_ratingsCount);
	const hasRealRating = realAverage > 0 && Number.isFinite(realCount) && realCount > 0;
	const average = hasRealRating ? realAverage : 5;
	const count = hasRealRating ? Math.floor(realCount) : 5;
	const formattedAverage = new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'vi-VN', {
		minimumFractionDigits: average % 1 ? 1 : 0,
		maximumFractionDigits: 1
	}).format(average);
	return {
		average,
		count,
		formattedAverage,
		isFallback: !hasRealRating,
		label:
			locale === 'en'
				? `${formattedAverage} out of 5 from ${count} reviews`
				: `${formattedAverage} trên 5 từ ${count} đánh giá`
	};
};
