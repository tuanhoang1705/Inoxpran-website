import test from 'node:test';
import assert from 'node:assert/strict';

import { matchesSearchQuery, paginateCatalogProducts } from '../src/lib/shop/catalogFilters.js';
import {
	parseProductVariantConfiguration,
	reconcileVariantRows,
	serializeVariantRows
} from '../src/lib/admin/productVariants.js';

const products = [
	{
		_id: 'cast-iron-pan',
		product_name: 'Chảo Gang Tráng Men INP3202',
		product_slug: 'chao-gang-trang-men-inp3202',
		product_description: 'Chảo giữ nhiệt tốt'
	},
	{
		_id: 'stainless-pan',
		product_name: 'Chảo Inox Chống Dính INP3301',
		product_slug: 'chao-inox-chong-dinh-inp3301',
		product_description: 'So sánh với chảo gang khi sử dụng'
	},
	{
		_id: 'rice-cooker',
		product_name: 'Nồi Cơm Điện INP6005',
		product_slug: 'noi-com-dien-inp6005'
	}
];

test('catalog search requires every query token to match product identity', () => {
	assert.equal(matchesSearchQuery(products[0], 'chảo gang'), true);
	assert.equal(matchesSearchQuery(products[1], 'chảo gang'), false);
	assert.equal(matchesSearchQuery(products[2], 'chảo gang'), false);
});

test('catalog pagination only returns the relevant cast-iron pan', () => {
	const result = paginateCatalogProducts({ products, filters: { q: 'chao gang' }, limit: 15 });
	assert.equal(result.total, 1);
	assert.deepEqual(
		result.items.map((item) => item._id),
		['cast-iron-pan']
	);
	assert.equal(result.hasNextPage, false);
});

test('variant rows automatically cover every color and size with both prices', () => {
	const rows = reconcileVariantRows({
		colors: [{ name: 'Đỏ' }, { name: 'Đen' }],
		sizes: [{ name: '24 cm' }, { name: '28 cm' }],
		baseOriginalPrice: 1200000,
		baseSalePrice: 990000
	});

	assert.equal(rows.length, 4);
	assert.ok(rows.every((row) => row.originalPrice === 1200000 && row.price === 990000));
	const serialized = JSON.parse(serializeVariantRows(rows));
	assert.ok(
		serialized.every(
			(row) => row.original_price === 1200000 && row.price === 990000 && row.color && row.size
		)
	);
});

test('legacy variation prices are preserved when opening the redesigned editor', () => {
	const parsed = parseProductVariantConfiguration({
		product_original_price: 1000000,
		product_price: 800000,
		product_variations: [
			{ color: 'Đỏ', original_price: 1100000, price: 850000 },
			{ color: 'Đen', original_price: 1200000, price: 900000 }
		]
	});

	assert.equal(parsed.rows.length, 2);
	assert.deepEqual(
		parsed.rows.map((row) => [row.color, row.originalPrice, row.price]),
		[
			['Đỏ', 1100000, 850000],
			['Đen', 1200000, 900000]
		]
	);
});
