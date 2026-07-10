'use strict'

const { normalizeString } = require('../../utils/seoBlogSanitizer');

const SUPPORTED_PROVIDERS = new Set(['disabled', 'bing', 'serpapi', 'unsplash', 'pexels']);
const SAFE_LICENSE_PATTERN = /(pexels|unsplash|creative commons|public domain|commercial use|share commercially)/i;

const getConfig = () => {
    const provider = normalizeString(process.env.IMAGE_SEARCH_PROVIDER || 'disabled').toLowerCase();
    return {
        provider: SUPPORTED_PROVIDERS.has(provider) ? provider : 'disabled',
        apiKey: normalizeString(process.env.IMAGE_SEARCH_API_KEY)
    };
};

const fetchJson = async (url, options = {}) => {
    const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(Number(process.env.IMAGE_PROVIDER_TIMEOUT_MS || 15000))
    });
    if (!response.ok) throw new Error(`image_search_http_${response.status}`);
    return response.json();
};

const mapPexelsPhoto = (item) => ({
    provider: 'pexels',
    providerAssetId: String(item.id || ''),
    sourceType: 'licensed_search',
    sourceUrl: item.url,
    previewUrl: item.src?.medium || item.src?.landscape || item.src?.large,
    downloadUrl: item.src?.original || item.src?.large2x || item.src?.landscape,
    license: 'Pexels License',
    author: item.photographer || '',
    width: Number(item.width) || 0,
    height: Number(item.height) || 0,
    description: item.alt || ''
});

const searchPexels = async ({ query, limit, page = 1, apiKey }) => {
    const url = new URL('https://api.pexels.com/v1/search');
    url.searchParams.set('query', query);
    url.searchParams.set('orientation', 'landscape');
    url.searchParams.set('size', 'large');
    url.searchParams.set('locale', 'vi-VN');
    url.searchParams.set('per_page', String(limit));
    url.searchParams.set('page', String(page));
    const payload = await fetchJson(url, { headers: { Authorization: apiKey } });
    return {
        candidates: (payload?.photos || []).map(mapPexelsPhoto),
        page: Number(payload?.page) || page,
        perPage: Number(payload?.per_page) || limit,
        totalResults: Number(payload?.total_results) || 0,
        hasMore: Boolean(payload?.next_page)
    };
};

const getPexelsPhoto = async ({ assetId, apiKey }) => {
    if (!/^\d+$/.test(String(assetId || ''))) throw new Error('invalid_pexels_asset_id');
    const payload = await fetchJson(`https://api.pexels.com/v1/photos/${assetId}`, {
        headers: { Authorization: apiKey }
    });
    return mapPexelsPhoto(payload);
};

const searchUnsplash = async ({ query, limit, apiKey }) => {
    const url = new URL('https://api.unsplash.com/search/photos');
    url.searchParams.set('query', query);
    url.searchParams.set('orientation', 'landscape');
    url.searchParams.set('content_filter', 'high');
    url.searchParams.set('per_page', String(limit));
    const payload = await fetchJson(url, {
        headers: {
            Authorization: `Client-ID ${apiKey}`,
            'Accept-Version': 'v1'
        }
    });
    return (payload?.results || []).map((item) => ({
        provider: 'unsplash',
        sourceType: 'licensed_search',
        sourceUrl: item.links?.html,
        downloadUrl: item.urls?.full || item.urls?.raw,
        downloadTrackingUrl: item.links?.download_location,
        license: 'Unsplash License',
        author: item.user?.name || '',
        width: Number(item.width) || 0,
        height: Number(item.height) || 0,
        description: item.alt_description || item.description || ''
    }));
};

const searchBing = async ({ query, limit, apiKey }) => {
    const endpoint = normalizeString(process.env.BING_IMAGE_SEARCH_ENDPOINT || 'https://api.bing.microsoft.com/v7.0/images/search');
    const url = new URL(endpoint);
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(limit));
    url.searchParams.set('safeSearch', 'Strict');
    url.searchParams.set('imageType', 'Photo');
    url.searchParams.set('license', 'ShareCommercially');
    const payload = await fetchJson(url, {
        headers: { 'Ocp-Apim-Subscription-Key': apiKey }
    });
    return (payload?.value || []).map((item) => ({
        provider: 'bing',
        sourceType: 'licensed_search',
        sourceUrl: item.hostPageUrl,
        downloadUrl: item.contentUrl,
        license: item.license || 'ShareCommercially filter',
        author: item.hostPageDisplayUrl || '',
        width: Number(item.width) || 0,
        height: Number(item.height) || 0,
        description: item.name || ''
    }));
};

const searchSerpApi = async ({ query, limit, apiKey }) => {
    const url = new URL('https://serpapi.com/search.json');
    url.searchParams.set('engine', 'bing_images');
    url.searchParams.set('q', query);
    url.searchParams.set('safe_search', 'strict');
    url.searchParams.set('api_key', apiKey);
    const payload = await fetchJson(url);
    return (payload?.images_results || []).slice(0, limit).map((item) => ({
        provider: 'serpapi',
        sourceType: 'licensed_search',
        sourceUrl: item.link,
        downloadUrl: item.original,
        license: item.license || '',
        author: item.source || '',
        width: Number(item.original_width) || 0,
        height: Number(item.original_height) || 0,
        description: item.title || ''
    }));
};

const isLicenseSafe = (candidate) =>
    Boolean(
        candidate?.sourceUrl &&
        candidate?.downloadUrl &&
        candidate?.license &&
        SAFE_LICENSE_PATTERN.test(candidate.license)
    );

const searchImages = async ({ query, limit = 5 } = {}) => {
    const config = getConfig();
    if (config.provider === 'disabled') {
        return { status: 'skipped', reason: 'image_search_disabled', provider: config.provider, candidates: [] };
    }
    if (!config.apiKey) {
        return { status: 'skipped', reason: 'image_search_api_key_missing', provider: config.provider, candidates: [] };
    }

    const input = {
        query: normalizeString(query),
        limit: Math.max(1, Math.min(10, Number(limit) || 5)),
        apiKey: config.apiKey
    };
    const handlers = {
        pexels: searchPexels,
        unsplash: searchUnsplash,
        bing: searchBing,
        serpapi: searchSerpApi
    };
    const result = await handlers[config.provider](input);
    const candidates = (Array.isArray(result) ? result : result.candidates || []).filter(isLicenseSafe);
    return {
        status: candidates.length ? 'complete' : 'skipped',
        reason: candidates.length ? '' : 'no_license_safe_candidates',
        provider: config.provider,
        candidates
    };
};

const searchPexelsImages = async ({ query, page = 1, perPage = 10 } = {}) => {
    const config = getConfig();
    if (config.provider !== 'pexels') {
        return {
            status: 'skipped',
            reason: 'pexels_provider_not_configured',
            provider: config.provider,
            candidates: [],
            page: 1,
            perPage: 10,
            totalResults: 0,
            hasMore: false
        };
    }
    if (!config.apiKey) {
        return {
            status: 'skipped',
            reason: 'image_search_api_key_missing',
            provider: config.provider,
            candidates: [],
            page: 1,
            perPage: 10,
            totalResults: 0,
            hasMore: false
        };
    }
    const normalizedPage = Math.max(1, Number(page) || 1);
    const normalizedPerPage = Math.max(1, Math.min(10, Number(perPage) || 10));
    const result = await searchPexels({
        query: normalizeString(query),
        page: normalizedPage,
        limit: normalizedPerPage,
        apiKey: config.apiKey
    });
    const candidates = result.candidates.filter(isLicenseSafe);
    return {
        status: candidates.length ? 'complete' : 'skipped',
        reason: candidates.length ? '' : 'no_license_safe_candidates',
        provider: 'pexels',
        ...result,
        candidates
    };
};

const resolvePexelsImage = async (assetId) => {
    const config = getConfig();
    if (config.provider !== 'pexels' || !config.apiKey) {
        throw new Error('pexels_provider_not_configured');
    }
    const candidate = await getPexelsPhoto({ assetId, apiKey: config.apiKey });
    if (!isLicenseSafe(candidate)) throw new Error('unsafe_pexels_candidate');
    return candidate;
};

const isPrivateHostname = (hostname) => {
    const value = String(hostname || '').toLowerCase();
    return value === 'localhost' ||
        value === '127.0.0.1' ||
        value === '::1' ||
        /^10\./.test(value) ||
        /^192\.168\./.test(value) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(value);
};

const downloadRemoteImage = async (url) => {
    let parsed = new URL(url);
    let response;
    for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
        if (parsed.protocol !== 'https:' || isPrivateHostname(parsed.hostname)) {
            throw new Error('untrusted_image_download_url');
        }
        response = await fetch(parsed, {
            redirect: 'manual',
            signal: AbortSignal.timeout(Number(process.env.IMAGE_PROVIDER_TIMEOUT_MS || 15000))
        });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const location = response.headers.get('location');
        if (!location || redirectCount === 3) throw new Error('unsafe_image_redirect');
        parsed = new URL(location, parsed);
    }
    if (!response.ok) throw new Error(`image_download_http_${response.status}`);
    const mimeType = normalizeString(response.headers.get('content-type')).split(';')[0].toLowerCase();
    if (!mimeType.startsWith('image/') || mimeType === 'image/svg+xml') {
        throw new Error('unsupported_downloaded_image_type');
    }
    const maxBytes = Number(process.env.IMAGE_MAX_SOURCE_FILE_SIZE_KB || 10240) * 1024;
    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength > maxBytes) throw new Error('downloaded_image_too_large');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > maxBytes) throw new Error('downloaded_image_too_large');
    return { buffer, mimeType };
};

module.exports = {
    downloadRemoteImage,
    getConfig,
    isLicenseSafe,
    resolvePexelsImage,
    searchPexelsImages,
    searchImages
};
