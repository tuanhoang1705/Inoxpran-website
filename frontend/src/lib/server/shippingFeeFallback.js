const DEFAULT_FEE_AMOUNT = 70000;
const DEFAULT_FEE_WEIGHT_GRAM = 3000;

const normalizePositiveInteger = (value, fallback = DEFAULT_FEE_WEIGHT_GRAM) => {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return fallback;
	const rounded = Math.floor(numeric);
	return rounded > 0 ? rounded : fallback;
};

export const calculateFallbackShippingFee = (weightGram) => {
	const safeWeight = normalizePositiveInteger(weightGram, DEFAULT_FEE_WEIGHT_GRAM);
	const blocks = Math.max(1, Math.ceil(safeWeight / DEFAULT_FEE_WEIGHT_GRAM));
	return blocks * DEFAULT_FEE_AMOUNT;
};

export const buildFallbackShippingQuote = ({ weight, reason = 'fallback_rate', request } = {}) => {
	const totalFee = calculateFallbackShippingFee(weight);
	return {
		provider: 'GHTK',
		fallback: true,
		reason,
		fee: {
			name: 'fallback_weight_rate',
			fee: totalFee,
			insurance_fee: 0,
			extra_fee: 0,
			total_fee: totalFee,
			delivery: true,
			delivery_type: 'fallback',
			ext_fees: []
		},
		request: request || undefined,
		rate: {
			amount: DEFAULT_FEE_AMOUNT,
			weight_gram: DEFAULT_FEE_WEIGHT_GRAM
		}
	};
};
