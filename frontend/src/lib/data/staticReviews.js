const clampRating = (value) => {
	const numeric = Number(value);
	if (!Number.isFinite(numeric) || numeric <= 0) return 0;
	return Math.min(5, Math.round(numeric * 10) / 10);
};

const resolveLocale = (localeValue) => (localeValue === 'en' ? 'en' : 'vi');

export const buildStaticReviewsForProduct = () => [];

export const getMarketingRatingSummary = (product, localeValue = 'vi') => {
	const locale = resolveLocale(localeValue);
	const realAverage = clampRating(product?.product_ratingsAverage);
	const realCount = Number(product?.product_ratingsCount);
	const hasRealRating = realAverage > 0 && Number.isFinite(realCount) && realCount > 0;
	const average = hasRealRating ? realAverage : 0;
	const count = hasRealRating ? Math.floor(realCount) : 0;
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
				? hasRealRating
					? `${formattedAverage} out of 5 from ${count} reviews`
					: 'No verified reviews yet'
				: hasRealRating
					? `${formattedAverage} trên 5 từ ${count} đánh giá`
					: 'Chưa có đánh giá xác thực'
	};
};
