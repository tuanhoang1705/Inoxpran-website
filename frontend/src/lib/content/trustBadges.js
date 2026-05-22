export const getItalianTrustBadges = (locale = 'vi') => {
	const isEnglish = locale === 'en';
	return [
		'Italia 1954',
		isEnglish ? '304 stainless promise' : 'Cam kết inox 304',
		isEnglish ? '12-month warranty' : 'Bảo hành 12 tháng',
		isEnglish ? 'Nationwide COD' : 'COD toàn quốc'
	];
};
