export const SHOP_CATEGORY_VALUES = Object.freeze(['Inoxs', 'CastIrons', 'Electronics']);

export const SHOP_TAG_VALUES = Object.freeze(['stove', 'pan', 'pot', 'knife', 'tool']);

export const SHOP_PRICE_FILTER_RANGES = Object.freeze([
  Object.freeze({ min: 0, max: 300000 }),
  Object.freeze({ min: 300000, max: 500000 }),
  Object.freeze({ min: 500000, max: 1000000 }),
  Object.freeze({ min: 1000000, max: undefined })
]);

const SHOP_TAG_ALIASES = Object.freeze({
  stove: ['stove', 'bep', 'bep tu', 'induction', 'cooktop', 'hob', 'bep dien'],
  pan: ['pan', 'chao', 'wok', 'skillet', 'frying pan'],
  pot: ['pot', 'noi', 'xoong', 'stockpot', 'saucepan', 'casserole'],
  knife: ['knife', 'dao'],
  tool: ['tool', 'dung cu', 'phu kien', 'thot', 'khay', 'kep', 'muoi', 'va']
});

const FAMILY_KEYWORDS = Object.freeze({
  stove: ['bep', 'bep tu', 'bep dien', 'induction', 'cooktop', 'hob'],
  pan: ['chao', 'wok', 'skillet', 'frying pan'],
  pot: ['noi', 'xoong', 'stockpot', 'saucepan', 'casserole'],
  knife: ['dao', 'knife'],
  tool: ['dung cu', 'phu kien', 'thot', 'khay', 'kep', 'muoi', 'va']
});

const COOKWARE_KEYWORDS = Object.freeze([
  ...FAMILY_KEYWORDS.pan,
  ...FAMILY_KEYWORDS.pot,
  'noi chao',
  'chao noi'
]);

export const normalizeFilterText = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

export const stripHtmlText = (value) =>
  String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const includesAny = (haystack, needles = []) =>
  needles.some((needle) => haystack.includes(normalizeFilterText(needle)));

export const normalizeShopTagValue = (value) => {
  const normalized = normalizeFilterText(value);
  if (!normalized) return '';

  if (SHOP_TAG_VALUES.includes(normalized)) {
    return normalized;
  }

  for (const [canonical, aliases] of Object.entries(SHOP_TAG_ALIASES)) {
    if (aliases.some((alias) => normalizeFilterText(alias) === normalized)) {
      return canonical;
    }
  }

  return normalized;
};

export const getProductNameFilterText = (product) => {
  const name = String(product?.product_name || '');
  const slug = String(product?.product_slug || '');
  return normalizeFilterText(`${name} ${slug}`);
};

export const getProductFilterText = (product) => {
  const name = String(product?.product_name || '');
  const description = stripHtmlText(product?.product_description || '');
  const type = String(product?.product_type || '');
  return normalizeFilterText(`${name} ${description} ${type}`);
};

const matchesProductFamily = (product, rawTagValue) => {
  const tagValue = normalizeShopTagValue(rawTagValue);
  if (!tagValue) return true;

  const nameText = getProductNameFilterText(product);
  const typeText = normalizeFilterText(product?.product_type || '');

  if (tagValue === 'stove') {
    const hasStoveKeyword = includesAny(nameText, FAMILY_KEYWORDS.stove);
    if (hasStoveKeyword && !includesAny(nameText, COOKWARE_KEYWORDS)) return true;

    // Fallback for electronics items named as appliance without cookware terms.
    if (typeText === 'electronics' && includesAny(nameText, ['bep'])) {
      return !includesAny(nameText, COOKWARE_KEYWORDS);
    }
    return false;
  }

  const familyKeywords = FAMILY_KEYWORDS[tagValue] || [];
  if (!familyKeywords.length) return false;
  return includesAny(nameText, familyKeywords);
};

export const matchesSearchQuery = (product, query) => {
  const normalizedQuery = normalizeFilterText(query);
  if (!normalizedQuery) return true;
  return getProductFilterText(product).includes(normalizedQuery);
};

export const matchesTagFilter = (product, tagValue) => matchesProductFamily(product, tagValue);

export const priceFilterKey = (filter) => {
  const min = Number.isFinite(filter?.min) ? filter.min : 'min';
  const max = Number.isFinite(filter?.max) ? filter.max : 'max';
  return `${min}-${max}`;
};

const toFiniteNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const getProductPrice = (product) => {
  const parsed = Number(product?.product_price);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const matchesCategoryFilter = (product, categoryValue) => {
  const value = String(categoryValue || '').trim();
  if (!value) return true;
  return String(product?.product_type || '').trim() === value;
};

export const matchesPriceBounds = (product, minPrice, maxPrice) => {
  const price = getProductPrice(product);
  if (!Number.isFinite(price)) return false;
  const min = toFiniteNumber(minPrice);
  const max = toFiniteNumber(maxPrice);
  if (Number.isFinite(min) && price < min) return false;
  if (Number.isFinite(max) && price > max) return false;
  return true;
};

export const matchesPriceRange = (product, range) => {
  if (!range) return false;
  return matchesPriceBounds(product, range.min, range.max);
};

export const matchesCatalogFilters = (
  product,
  filters = {},
  {
    ignoreCategory = false,
    ignoreTag = false,
    ignorePrice = false,
    ignoreQ = false
  } = {}
) => {
  if (!product) return false;

  const rawQ = ignoreQ ? '' : String(filters?.q || '').trim();
  const rawTag = ignoreTag ? '' : String(filters?.tag || '').trim();
  const rawCategory = ignoreCategory ? '' : String(filters?.category || '').trim();

  if (rawQ) {
    if (!matchesSearchQuery(product, rawQ)) return false;
  } else if (rawTag) {
    if (!matchesTagFilter(product, rawTag)) return false;
  }

  if (rawCategory && !matchesCategoryFilter(product, rawCategory)) {
    return false;
  }

  if (!ignorePrice) {
    const minPrice = toFiniteNumber(filters?.minPrice);
    const maxPrice = toFiniteNumber(filters?.maxPrice);
    if (Number.isFinite(minPrice) || Number.isFinite(maxPrice)) {
      if (!matchesPriceBounds(product, minPrice, maxPrice)) return false;
    }
  }

  return true;
};

export const createEmptyFacetCounts = ({
  categoryValues = SHOP_CATEGORY_VALUES,
  tagValues = SHOP_TAG_VALUES,
  priceRanges = SHOP_PRICE_FILTER_RANGES
} = {}) => ({
  counts: {
    category: Object.fromEntries(categoryValues.map((value) => [value, 0])),
    tag: Object.fromEntries(tagValues.map((value) => [value, 0])),
    price: Object.fromEntries(priceRanges.map((range) => [priceFilterKey(range), 0]))
  },
  optionCounts: {
    category: 0,
    tag: 0,
    price: 0
  }
});

const compareText = (a, b) =>
  String(a || '').localeCompare(String(b || ''), 'vi', {
    sensitivity: 'base',
    numeric: true
  });

export const sortCatalogProducts = (products = [], sort = '') => {
  const items = Array.isArray(products) ? [...products] : [];
  switch (String(sort || '').trim()) {
    case 'price_asc':
      return items.sort((a, b) => (getProductPrice(a) || 0) - (getProductPrice(b) || 0));
    case 'price_desc':
      return items.sort((a, b) => (getProductPrice(b) || 0) - (getProductPrice(a) || 0));
    case 'name_asc':
      return items.sort((a, b) => compareText(a?.product_name, b?.product_name));
    case 'name_desc':
      return items.sort((a, b) => compareText(b?.product_name, a?.product_name));
    default:
      return items;
  }
};

export const paginateCatalogProducts = ({
  products = [],
  filters = {},
  sort = '',
  page = 1,
  limit = 12
} = {}) => {
  const normalizedPage = Math.max(Number(page) || 1, 1);
  const normalizedLimit = Math.max(Number(limit) || 12, 1);
  const filtered = (Array.isArray(products) ? products : []).filter((product) =>
    matchesCatalogFilters(product, filters)
  );
  const sorted = sortCatalogProducts(filtered, sort);
  const startIndex = (normalizedPage - 1) * normalizedLimit;
  const endIndex = startIndex + normalizedLimit;
  const items = sorted.slice(startIndex, endIndex);

  return {
    items,
    total: sorted.length,
    hasNextPage: endIndex < sorted.length,
    page: normalizedPage,
    limit: normalizedLimit
  };
};

export const computeCatalogFacetCounts = ({
  products = [],
  filters = {},
  categoryValues = SHOP_CATEGORY_VALUES,
  tagValues = SHOP_TAG_VALUES,
  priceRanges = SHOP_PRICE_FILTER_RANGES
} = {}) => {
  const facetCounts = createEmptyFacetCounts({ categoryValues, tagValues, priceRanges });
  const items = Array.isArray(products) ? products.filter(Boolean) : [];

  for (const product of items) {
    if (
      matchesCatalogFilters(product, filters, {
        ignoreCategory: true
      })
    ) {
      for (const categoryValue of categoryValues) {
        if (matchesCategoryFilter(product, categoryValue)) {
          facetCounts.counts.category[categoryValue] += 1;
        }
      }
    }

    if (
      matchesCatalogFilters(product, filters, {
        ignorePrice: true
      })
    ) {
      for (const range of priceRanges) {
        if (matchesPriceRange(product, range)) {
          facetCounts.counts.price[priceFilterKey(range)] += 1;
        }
      }
    }

    if (
      matchesCatalogFilters(product, filters, {
        ignoreTag: true,
        ignoreQ: true
      })
    ) {
      for (const tagValue of tagValues) {
        if (matchesTagFilter(product, tagValue)) {
          facetCounts.counts.tag[tagValue] += 1;
        }
      }
    }
  }

  facetCounts.optionCounts.category = Object.values(facetCounts.counts.category).filter(
    (count) => count > 0
  ).length;
  facetCounts.optionCounts.tag = Object.values(facetCounts.counts.tag).filter((count) => count > 0)
    .length;
  facetCounts.optionCounts.price = Object.values(facetCounts.counts.price).filter(
    (count) => count > 0
  ).length;

  return facetCounts;
};
