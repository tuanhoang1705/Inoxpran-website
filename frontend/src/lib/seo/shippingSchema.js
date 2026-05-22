const DEFAULT_SHIPPING_RATE = 70_000;
const DEFAULT_SHIPPING_BLOCK_WEIGHT = 3_000;
const SHIPPING_HANDLING_MIN_DAYS = 0;
const SHIPPING_HANDLING_MAX_DAYS = 1;
const SHIPPING_TRANSIT_MIN_DAYS = 2;
const SHIPPING_TRANSIT_MAX_DAYS = 5;

export const FREE_SHIPPING_THRESHOLD = 1_000_000;

const normalizePositiveInteger = (value, fallback) => {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return fallback;
	const rounded = Math.floor(numeric);
	return rounded > 0 ? rounded : fallback;
};

const normalizeNonNegativeInteger = (value, fallback) => {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return fallback;
	const rounded = Math.floor(numeric);
	return rounded >= 0 ? rounded : fallback;
};

const buildSchemaId = (value, suffix) => {
	const base = String(value || '').trim();
	if (!base) return '';
	return base.includes('#') ? `${base}${suffix}` : `${base}#${suffix}`;
};

export const calculateStructuredShippingRate = (weightGram) => {
	const safeWeight = normalizePositiveInteger(weightGram, DEFAULT_SHIPPING_BLOCK_WEIGHT);
	const blocks = Math.max(1, Math.ceil(safeWeight / DEFAULT_SHIPPING_BLOCK_WEIGHT));
	return blocks * DEFAULT_SHIPPING_RATE;
};

export const buildShippingDestinationJsonLd = ({ addressCountry = 'VN' } = {}) => ({
	'@type': 'DefinedRegion',
	addressCountry
});

export const buildShippingRateJsonLd = ({
	weightGram,
	value,
	currency = 'VND'
} = {}) => ({
	'@type': 'MonetaryAmount',
	value: normalizeNonNegativeInteger(value, calculateStructuredShippingRate(weightGram)),
	currency
});

export const buildShippingDeliveryTimeJsonLd = ({
	handlingMinDays = SHIPPING_HANDLING_MIN_DAYS,
	handlingMaxDays = SHIPPING_HANDLING_MAX_DAYS,
	transitMinDays = SHIPPING_TRANSIT_MIN_DAYS,
	transitMaxDays = SHIPPING_TRANSIT_MAX_DAYS
} = {}) => ({
	'@type': 'ShippingDeliveryTime',
	handlingTime: {
		'@type': 'QuantitativeValue',
		minValue: handlingMinDays,
		maxValue: handlingMaxDays,
		unitCode: 'DAY'
	},
	transitTime: {
		'@type': 'QuantitativeValue',
		minValue: transitMinDays,
		maxValue: transitMaxDays,
		unitCode: 'DAY'
	}
});

export const buildOfferShippingDetailsJsonLd = ({
	offerId,
	weightGram,
	addressCountry = 'VN',
	currency = 'VND',
	shippingRateValue
} = {}) => {
	const shippingDetailsId = buildSchemaId(offerId, '-shipping-details');

	return {
		'@type': 'OfferShippingDetails',
		...(shippingDetailsId ? { '@id': shippingDetailsId } : {}),
		shippingDestination: buildShippingDestinationJsonLd({ addressCountry }),
		shippingRate: buildShippingRateJsonLd({
			weightGram,
			value: shippingRateValue,
			currency
		}),
		deliveryTime: buildShippingDeliveryTimeJsonLd()
	};
};

export const buildShippingConditionsJsonLd = ({
	addressCountry = 'VN',
	currency = 'VND',
	minOrderValue,
	shippingRateValue
} = {}) => {
	const normalizedMinOrderValue = Number(minOrderValue);

	return {
		'@type': 'ShippingConditions',
		shippingDestination: buildShippingDestinationJsonLd({ addressCountry }),
		...(Number.isFinite(normalizedMinOrderValue) && normalizedMinOrderValue > 0
			? {
					orderValue: {
						'@type': 'MonetaryAmount',
						currency,
						minValue: Math.floor(normalizedMinOrderValue)
					}
				}
			: {}),
		shippingRate: buildShippingRateJsonLd({
			value: shippingRateValue,
			currency
		}),
		deliveryTime: buildShippingDeliveryTimeJsonLd()
	};
};
