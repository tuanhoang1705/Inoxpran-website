import { API_BASE_CANDIDATES } from '$lib/server/api.js';
import { createAsyncTtlCache } from '$lib/server/asyncTtlCache.js';

const catalogSnapshotCache = createAsyncTtlCache({
  ttlMs: 45_000,
  maxEntries: 4
});

const readJson = async (response) => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const toProducts = (payload) => (Array.isArray(payload?.metadata) ? payload.metadata : []);

const dedupeProductsById = (products) => {
  const result = [];
  const seen = new Set();

  for (const product of Array.isArray(products) ? products : []) {
    const id = String(product?._id || '');
    if (!id) {
      result.push(product);
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(product);
  }

  return result;
};

const buildCatalogPageUrl = ({ base, page, limit }) => {
  const apiUrl = new URL(`${base}/product`);
  apiUrl.searchParams.set('limit', String(limit));
  apiUrl.searchParams.set('page', String(page));
  return apiUrl;
};

export const fetchAllCatalogProducts = async ({
  fetch,
  headers = {},
  pageSize = 200,
  maxPages = 50
} = {}) =>
  catalogSnapshotCache.getOrLoad(`catalog:v2:${pageSize}:${maxPages}`, async () => {
  let hadNetworkFailure = false;
  let errorStatus = null;

  for (const base of API_BASE_CANDIDATES) {
    const collected = [];
    let baseWorked = false;
    let baseFailed = false;

    for (let page = 1; page <= maxPages; page += 1) {
      try {
        const response = await fetch(buildCatalogPageUrl({ base, page, limit: pageSize }), { headers });
        if (!response.ok) {
          if (errorStatus === null) errorStatus = response.status;
          baseFailed = true;
          break;
        }

        baseWorked = true;
        const payload = await readJson(response);
        const batch = toProducts(payload);
        collected.push(...batch);

        if (batch.length < pageSize) {
          return {
            products: dedupeProductsById(collected),
            hadNetworkFailure,
            errorStatus,
            truncated: false
          };
        }
      } catch {
        hadNetworkFailure = true;
        baseFailed = true;
        break;
      }
    }

    if (baseWorked && !baseFailed) {
      return {
        products: dedupeProductsById(collected),
        hadNetworkFailure,
        errorStatus,
        truncated: true
      };
    }
  }

  const failureResult = {
    products: [],
    hadNetworkFailure,
    errorStatus,
    truncated: false
  };

  // Avoid caching transient failures/empty snapshots; callers already have fallbacks.
  throw Object.assign(new Error('catalog snapshot unavailable'), {
    snapshot: failureResult
  });
});
