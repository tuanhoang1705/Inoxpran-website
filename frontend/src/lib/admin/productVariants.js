export const normalizeVariantName = (value) => String(value || '').trim();

export const normalizeVariantPrice = (value) => {
	if (value === '' || value === null || value === undefined) return undefined;
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

const variantKey = (color, size) =>
	`${normalizeVariantName(color).toLocaleLowerCase('vi')}::${normalizeVariantName(size).toLocaleLowerCase('vi')}`;

const normalizeOptionList = (items) => {
	const result = [];
	const seen = new Set();
	(Array.isArray(items) ? items : []).forEach((item) => {
		const name = normalizeVariantName(typeof item === 'object' ? item?.name : item);
		const key = name.toLocaleLowerCase('vi');
		if (!name || seen.has(key)) return;
		seen.add(key);
		result.push({ name });
	});
	return result;
};

const toRow = (item) => ({
	color: normalizeVariantName(item?.color || item?.colour),
	size: normalizeVariantName(item?.size),
	originalPrice: normalizeVariantPrice(item?.originalPrice ?? item?.original_price),
	price: normalizeVariantPrice(item?.price)
});

const desiredCoordinates = (colors, sizes) => {
	const colorNames = normalizeOptionList(colors).map((item) => item.name);
	const sizeNames = normalizeOptionList(sizes).map((item) => item.name);
	if (colorNames.length && sizeNames.length) {
		return colorNames.flatMap((color) => sizeNames.map((size) => ({ color, size })));
	}
	if (colorNames.length) return colorNames.map((color) => ({ color, size: '' }));
	return sizeNames.map((size) => ({ color: '', size }));
};

export const reconcileVariantRows = ({
	colors = [],
	sizes = [],
	rows = [],
	baseOriginalPrice,
	baseSalePrice
} = {}) => {
	const normalizedRows = (Array.isArray(rows) ? rows : [])
		.map(toRow)
		.filter((item) => item.color || item.size);
	const exactRows = new Map(
		normalizedRows.map((item) => [variantKey(item.color, item.size), item])
	);
	const defaultOriginalPrice = normalizeVariantPrice(baseOriginalPrice);
	const defaultSalePrice = normalizeVariantPrice(baseSalePrice);

	return desiredCoordinates(colors, sizes).map(({ color, size }) => {
		const exact = exactRows.get(variantKey(color, size));
		const inherited =
			exact ||
			normalizedRows.find((item) => color && item.color === color && !item.size) ||
			normalizedRows.find((item) => size && item.size === size && !item.color) ||
			normalizedRows.find((item) => color && item.color === color) ||
			normalizedRows.find((item) => size && item.size === size);
		return {
			color,
			size,
			originalPrice: inherited?.originalPrice ?? defaultOriginalPrice,
			price: inherited?.price ?? defaultSalePrice
		};
	});
};

export const serializeVariantRows = (rows = []) =>
	JSON.stringify(
		(Array.isArray(rows) ? rows : []).map((item) => {
			const row = toRow(item);
			const payload = {};
			if (row.color) payload.color = row.color;
			if (row.size) payload.size = row.size;
			if (row.originalPrice !== undefined) payload.original_price = row.originalPrice;
			if (row.price !== undefined) payload.price = row.price;
			return payload;
		})
	);

export const parseProductVariantConfiguration = (product) => {
	const variations = Array.isArray(product?.product_variations) ? product.product_variations : [];
	const colorNames = [];
	const sizeNames = [];
	const rows = [];

	variations.forEach((item) => {
		if (typeof item === 'string' || typeof item === 'number') {
			const size = normalizeVariantName(item);
			if (size) {
				sizeNames.push(size);
				rows.push({ size });
			}
			return;
		}
		if (!item || typeof item !== 'object') return;
		const color = normalizeVariantName(item.color || item.colour);
		const size = normalizeVariantName(
			item.size ?? item.label ?? item.name ?? item.sku ?? item.value
		);
		if (color) colorNames.push(color);
		if (size) sizeNames.push(size);
		if (color || size) rows.push({ ...item, color, size });
	});

	const attributeColors = product?.product_attributes?.colors;
	if (Array.isArray(attributeColors)) colorNames.push(...attributeColors);
	const primaryColor = normalizeVariantName(product?.product_attributes?.color);
	if (primaryColor) colorNames.push(primaryColor);

	const colors = normalizeOptionList(colorNames);
	const sizes = normalizeOptionList(sizeNames);
	return {
		colors,
		sizes,
		rows: reconcileVariantRows({
			colors,
			sizes,
			rows,
			baseOriginalPrice: product?.product_original_price,
			baseSalePrice: product?.product_price
		})
	};
};

export const hasInvalidVariantPricing = (rows = []) =>
	(Array.isArray(rows) ? rows : []).some((item) => {
		const originalPrice = normalizeVariantPrice(item?.originalPrice);
		const salePrice = normalizeVariantPrice(item?.price);
		return (
			originalPrice === undefined ||
			salePrice === undefined ||
			originalPrice <= 0 ||
			salePrice <= 0 ||
			salePrice > originalPrice
		);
	});
