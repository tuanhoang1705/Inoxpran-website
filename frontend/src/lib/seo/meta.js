// src/lib/seo/meta.js

export function buildCategorySeo({ category, baseUrl }) {
  const url = `${baseUrl}/danh-muc/${category.slug}`;

  return {
    title: `${category.name} | Inoxpran`,
    description:
      category.seoDescription ||
      (category.description
        ? category.description.slice(0, 150)
        : `Khám phá ${category.name} chính hãng Inoxpran, bền đẹp, dễ vệ sinh và giao hàng toàn quốc.`),
    image: category.coverImage,
    url
  };
}

export function buildProductSeo({ product, baseUrl }) {
  const url = `${baseUrl}/san-pham/${product.slug}`;
  const image = product.images?.[0];

  return {
    title: `${product.name} | Inoxpran`,
    description:
      product.seoDescription ||
      (product.shortDescription
        ? product.shortDescription.slice(0, 160)
        : `Khám phá ${product.name} chính hãng Inoxpran với thông tin rõ ràng, tư vấn nhanh và giao hàng toàn quốc.`),
    image,
    url
  };
}
