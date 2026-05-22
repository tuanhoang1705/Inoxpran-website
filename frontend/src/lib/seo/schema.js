// src/lib/seo/schema.js

const normalizeRating = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(5, Math.round(parsed * 10) / 10);
};

const normalizeReviewItems = (value) => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.data)) return value.data;
  return [];
};

const getReviewRating = (review) =>
  Number(review?.rating ?? review?.reviewRating?.ratingValue ?? review?.reviewRating?.value);

const resolveAggregateRating = (product) => {
  const explicitAverage = normalizeRating(product?.product_ratingsAverage ?? product?.rating?.average);
  const explicitCount = Math.max(
    0,
    Math.floor(Number(product?.product_ratingsCount ?? product?.rating?.count ?? product?.reviewCount) || 0)
  );

  if (explicitAverage > 0 && explicitCount > 0) {
    return { average: explicitAverage, count: explicitCount };
  }

  const reviewItems = normalizeReviewItems(
    product?.product_reviews ?? product?.reviews ?? product?.productReviews
  );
  const approvedRatings = reviewItems
    .map((review) => getReviewRating(review))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (!approvedRatings.length) {
    return { average: 0, count: 0 };
  }

  const average =
    approvedRatings.reduce((sum, value) => sum + value, 0) / approvedRatings.length;

  return {
    average: normalizeRating(average),
    count: approvedRatings.length
  };
};

export function buildProductSchema({ product, pageUrl }) {
  const { average: ratingAverage, count: ratingCount } = resolveAggregateRating(product);
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    image: product.images || [],
    description: product.shortDescription || product.description,
    sku: product.sku,
    brand: {
      '@type': 'Brand',
      name: 'Inoxpran'
    },
    offers: {
      '@type': 'Offer',
      url: pageUrl,
      priceCurrency: 'VND',
      price: product.price,
      availability: product.inStock
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock'
    }
  };

  if (Number.isFinite(ratingAverage) && ratingAverage > 0 && Number.isFinite(ratingCount) && ratingCount > 0) {
    schema.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: Math.round(ratingAverage * 10) / 10,
      reviewCount: Math.floor(ratingCount),
      ratingCount: Math.floor(ratingCount),
      bestRating: 5,
      worstRating: 1
    };
  }

  return schema;
}
