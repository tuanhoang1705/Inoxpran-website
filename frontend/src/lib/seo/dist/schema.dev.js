"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.buildProductSchema = buildProductSchema;

// src/lib/seo/schema.js
function buildProductSchema(_ref) {
  var product = _ref.product,
      pageUrl = _ref.pageUrl;
  var schema = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    image: product.images || [],
    description: product.shortDescription || product.description,
    sku: product.sku,
    brand: {
      '@type': 'Brand',
      name: 'Inox Shop'
    },
    offers: {
      '@type': 'Offer',
      url: pageUrl,
      priceCurrency: 'đ',
      price: product.price,
      availability: product.inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock'
    }
  };

  if (product.rating && product.rating.count > 0) {
    schema.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: product.rating.average,
      reviewCount: product.rating.count
    };
  }

  return schema;
}