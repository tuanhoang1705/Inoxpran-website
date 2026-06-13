'use strict'

const {
    product,
    electronic,
    castIron,
    inox,
    PRODUCT_REVIEW_STATUSES
} = require('../models/product.model');
const { BadRequestError, ForbiddenError, NotFoundError } = require('../core/error.response');
const sanitizeHtml = require('sanitize-html');
const { findAllDraftsForShop,
    publishProductByShop,
    findAllPublishForShop,
    unPublishProductByShop,
    searchProductsByUser,
    findAllProducts,
    findAllProductsForAdmin,
    findProduct,
    updateProductById,
    findBestSellingProducts,
    updateBestSellingOrder,
    findProductByNormalizedName
} = require('../models/repositories/product.repo');
const { findById: findUserById } = require('../models/repositories/user.repo');
const { order } = require('../models/order');
const { update, remove } = require('lodash');
const { removeUndefinedObject, updateNestedObject, convertToObjectIdMongodb } = require('../utils');
const {
    insertInventory,
    findInventoryByProductIds,
    setInventoryStock
} = require('../models/repositories/inventory.repo');
const {
    collectHtmlImageStorageKeys,
    deleteHtmlImagesFromStorage,
    deleteImageFromStorage,
    deleteImageVariantsFromStorage,
    deleteRemovedHtmlImagesFromStorage,
    toStorageArtifactKey
} = require('./storage.service');
// define Factory class to create product

const parseJsonField = (value, fieldName) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    try {
        return JSON.parse(trimmed);
    } catch (error) {
        throw new BadRequestError(`${fieldName} must be valid JSON`);
    }
};

const normalizeCropState = (value) => {
    if (value === undefined || value === null || value === '') return undefined;
    let parsed = value;
    if (typeof value === 'string') {
        try {
            parsed = JSON.parse(value);
        } catch {
            return undefined;
        }
    }
    if (!parsed || typeof parsed !== 'object') return undefined;
    const zoom = Number(parsed.zoom);
    const offsetX = Number(parsed.offsetX);
    const offsetY = Number(parsed.offsetY);
    const hasZoom = Number.isFinite(zoom);
    const hasOffsetX = Number.isFinite(offsetX);
    const hasOffsetY = Number.isFinite(offsetY);
    if (!hasZoom && !hasOffsetX && !hasOffsetY) return undefined;
    return {
        ...(hasZoom ? { zoom } : {}),
        ...(hasOffsetX ? { offsetX } : {}),
        ...(hasOffsetY ? { offsetY } : {})
    };
};

const normalizeImageVariants = (value) => {
    if (value === undefined || value === null || value === '') return undefined;
    let parsed = value;
    if (typeof value === 'string') {
        try {
            parsed = JSON.parse(value);
        } catch {
            return undefined;
        }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    try {
        return JSON.parse(JSON.stringify(parsed));
    } catch {
        return undefined;
    }
};

const normalizeProductAttributes = (value) => {
    const parsed = parseJsonField(value, 'product_attributes');
    if (parsed === undefined) return undefined;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    throw new BadRequestError('product_attributes must be an object');
};

const normalizeProductVariations = (value) => {
    const parsed = parseJsonField(value, 'product_variations');
    if (parsed === undefined) return undefined;
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') return [parsed];
    throw new BadRequestError('product_variations must be an array');
};

const normalizeProductRatingsAverage = (value) => {
    if (value === undefined || value === null || value === '') return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 5) {
        throw new BadRequestError('product_ratingsAverage must be a number between 0 and 5');
    }
    return Math.round(parsed * 10) / 10;
};

const normalizeProductRatingsCount = (value) => {
    if (value === undefined || value === null || value === '') return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        throw new BadRequestError('product_ratingsCount must be a non-negative number');
    }
    return Math.floor(parsed);
};

const MAX_REVIEW_TITLE_LENGTH = 160;
const MAX_REVIEW_CONTENT_LENGTH = 2000;
const MAX_REVIEW_IMAGE_COUNT = 4;
const MAX_ADMIN_REVIEW_LIMIT = 100;

const normalizeString = (value) => {
    if (typeof value !== 'string') return '';
    return value.trim();
};

const normalizeBoolean = (value, fallback = false) => {
    if (typeof value === 'boolean') return value;
    if (value === undefined || value === null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const parsePositiveInteger = (value, fallback) => {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(1, Math.floor(parsed));
};

const normalizeOptionalDate = (value, fieldName = 'submittedAt') => {
    if (value === undefined || value === null || value === '') return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestError(`${fieldName} must be a valid date`);
    }
    return parsed;
};

const sanitizePlainText = (value) =>
    sanitizeHtml(value || '', { allowedTags: [], allowedAttributes: {} })
        .replace(/\s+/g, ' ')
        .trim();

const normalizeReviewAuthorName = (value) => {
    const sanitized = sanitizePlainText(normalizeString(value));
    if (!sanitized) throw new BadRequestError('authorName is required');
    return sanitized.slice(0, 150);
};

const normalizeReviewAuthorEmail = (value) => {
    const sanitized = normalizeString(value).toLowerCase();
    if (!sanitized) return null;
    const normalized = sanitizePlainText(sanitized).slice(0, 180);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
        throw new BadRequestError('authorEmail must be a valid email');
    }
    return normalized;
};

const normalizeReviewRating = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 5 || !Number.isInteger(parsed)) {
        throw new BadRequestError('rating must be an integer between 1 and 5');
    }
    return parsed;
};

const normalizeReviewTitle = (value) => {
    const sanitized = sanitizePlainText(normalizeString(value));
    if (!sanitized) return '';
    return sanitized.slice(0, MAX_REVIEW_TITLE_LENGTH);
};

const normalizeReviewContent = (value) => {
    const sanitized = sanitizePlainText(normalizeString(value));
    if (!sanitized) throw new BadRequestError('content is required');
    return sanitized.slice(0, MAX_REVIEW_CONTENT_LENGTH);
};

const normalizeReviewImageItem = (item) => {
    if (typeof item === 'string') {
        const url = normalizeString(item);
        if (!url) return null;
        return { url };
    }
    if (!item || typeof item !== 'object') return null;

    const url = normalizeString(item.url);
    if (!url) return null;
    const path = normalizeString(item.path);
    const variants = normalizeImageVariants(item.variants ?? item.imageVariants);
    return {
        url,
        ...(path ? { path } : {}),
        ...(variants ? { variants } : {})
    };
};

const normalizeReviewImages = (value) => {
    if (value === undefined || value === null || value === '') return [];
    const parsed = parseJsonField(value, 'review_images');
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list
        .map((item) => normalizeReviewImageItem(item))
        .filter(Boolean)
        .slice(0, MAX_REVIEW_IMAGE_COUNT);
};

const normalizeReviewPayload = (payload = {}) => ({
    rating: normalizeReviewRating(payload?.rating),
    title: normalizeReviewTitle(payload?.title),
    content: normalizeReviewContent(payload?.content ?? payload?.comment ?? payload?.review),
    images: normalizeReviewImages(payload?.review_images ?? payload?.images ?? payload?.reviewImages)
});

const normalizeAdminReviewPayload = (payload = {}) => {
    const normalizedStatus = normalizeString(payload?.status).toLowerCase();
    if (normalizedStatus && !PRODUCT_REVIEW_STATUSES.includes(normalizedStatus)) {
        throw new BadRequestError('status must be pending, approved, or rejected');
    }

    return {
        ...normalizeReviewPayload(payload),
        authorName: normalizeReviewAuthorName(payload?.authorName ?? payload?.name),
        authorEmail: normalizeReviewAuthorEmail(payload?.authorEmail ?? payload?.email),
        verifiedPurchase: normalizeBoolean(payload?.verifiedPurchase, false),
        status: normalizedStatus || 'approved',
        source: ['admin', 'seed'].includes(normalizeString(payload?.source).toLowerCase())
            ? normalizeString(payload?.source).toLowerCase()
            : 'admin',
        submittedAt: normalizeOptionalDate(
            payload?.submittedAt ?? payload?.createdAt ?? payload?.date,
            'submittedAt'
        )
    };
};

const normalizeReviewImageListForPublic = (value) => {
    if (!Array.isArray(value)) return [];
    return value.map((item) => normalizeReviewImageItem(item)).filter(Boolean);
};

const normalizeReviewStatus = (value, fallback = 'approved') => {
    const normalized = normalizeString(value).toLowerCase();
    if (PRODUCT_REVIEW_STATUSES.includes(normalized)) return normalized;
    return fallback;
};

const resolveReviewDate = (item) => item?.updatedAt || item?.createdAt || null;

const mapPublicProductReview = (item) => {
    if (!item) return null;
    return {
        id: String(item?._id || item?.id || ''),
        rating: Number(item?.rating) || 0,
        title: normalizeString(item?.title),
        content: normalizeString(item?.content),
        author: normalizeString(item?.authorName || item?.author || item?.name),
        images: normalizeReviewImageListForPublic(item?.images ?? item?.review_images),
        verifiedPurchase: Boolean(item?.verifiedPurchase),
        status: normalizeReviewStatus(item?.status),
        createdAt: item?.createdAt || null,
        updatedAt: item?.updatedAt || null
    };
};

const normalizeStoredProductReviews = (value, { statuses = ['approved'] } = {}) => {
    if (!Array.isArray(value)) return [];
    const allowedStatuses =
        Array.isArray(statuses) && statuses.length
            ? new Set(statuses.map((status) => normalizeReviewStatus(status)))
            : null;
    return value
        .map((item) => mapPublicProductReview(item))
        .filter((item) => {
            if (!item) return false;
            if (!allowedStatuses) return true;
            return allowedStatuses.has(normalizeReviewStatus(item.status));
        })
        .filter(Boolean)
        .sort((left, right) => {
            const leftTime = resolveReviewDate(left) ? new Date(resolveReviewDate(left)).getTime() : 0;
            const rightTime = resolveReviewDate(right) ? new Date(resolveReviewDate(right)).getTime() : 0;
            return rightTime - leftTime;
        });
};

const findUserReviewIndex = (reviews = [], userId) => {
    const normalizedUserId = String(userId || '').trim();
    if (!normalizedUserId) return -1;
    return reviews.findIndex((item) => String(item?.userId || '') === normalizedUserId);
};

const findDeliveredOrderForReview = async ({ userId, productId }) => {
    const userObjectId = convertToObjectIdMongodb(userId);
    const normalizedProductId = String(productId || '').trim();
    if (!userObjectId || !normalizedProductId) return null;

    return await order.findOne({
        order_userId: userObjectId,
        order_status: 'delivered',
        'order_products.item_products.productId': normalizedProductId
    })
        .sort({ createdOn: -1, _id: -1 })
        .select('_id order_status createdOn')
        .lean();
};

const computeAggregateRatingUpdate = ({
    currentAverage = 0,
    currentCount = 0,
    previousRating = 0,
    nextRating,
    isNewReview = false
}) => {
    let count = normalizeStoredProductRatingsCount(currentCount);
    let average = normalizeStoredProductRatingsAverage(currentAverage, count);
    let totalScore = average * count;

    if (isNewReview) {
        totalScore += nextRating;
        count += 1;
    } else {
        if (count <= 0) {
            count = 1;
            totalScore = Number(previousRating) || 0;
        }
        totalScore = Math.max(0, totalScore - (Number(previousRating) || 0) + nextRating);
    }

    return {
        count,
        average: count > 0 ? Math.round((totalScore / count) * 10) / 10 : 0
    };
};

const computeAggregateRatingRemoval = ({
    currentAverage = 0,
    currentCount = 0,
    rating = 0
}) => {
    const count = normalizeStoredProductRatingsCount(currentCount);
    const average = normalizeStoredProductRatingsAverage(currentAverage, count);
    if (count <= 0) {
        return { count: 0, average: 0 };
    }

    const nextCount = Math.max(0, count - 1);
    const nextTotalScore = Math.max(0, average * count - (Number(rating) || 0));
    return {
        count: nextCount,
        average: nextCount > 0 ? Math.round((nextTotalScore / nextCount) * 10) / 10 : 0
    };
};

const computeAggregateForReviewStatusTransition = ({
    currentAverage = 0,
    currentCount = 0,
    rating = 0,
    previousStatus,
    nextStatus
}) => {
    const prev = normalizeReviewStatus(previousStatus);
    const next = normalizeReviewStatus(nextStatus);

    if (prev !== 'approved' && next === 'approved') {
        return computeAggregateRatingUpdate({
            currentAverage,
            currentCount,
            nextRating: rating,
            isNewReview: true
        });
    }

    if (prev === 'approved' && next !== 'approved') {
        return computeAggregateRatingRemoval({
            currentAverage,
            currentCount,
            rating
        });
    }

    return {
        count: normalizeStoredProductRatingsCount(currentCount),
        average: normalizeStoredProductRatingsAverage(currentAverage, currentCount)
    };
};

const buildReviewMeta = ({ productDoc, userId, eligibleOrder = null }) => {
    const reviews = Array.isArray(productDoc?.product_reviews) ? productDoc.product_reviews : [];
    const reviewIndex = findUserReviewIndex(reviews, userId);
    const existingReview = reviewIndex >= 0 ? reviews[reviewIndex] : null;
    const canReview = Boolean(existingReview || eligibleOrder);

    return {
        canReview,
        hasReviewed: Boolean(existingReview),
        reason: canReview ? null : 'purchase_required',
        review: mapPublicProductReview(existingReview)
    };
};

const mapAdminProductReview = (item) => {
    if (!item) return null;
    return {
        id: String(item?.reviewId || item?._id || ''),
        productId: String(item?.productId || ''),
        productName: normalizeString(item?.productName || item?.product_name),
        productSlug: normalizeString(item?.productSlug || item?.product_slug),
        productThumb: normalizeString(item?.productThumb || item?.product_thumb),
        userId: item?.userId ? String(item.userId) : null,
        authorName: normalizeString(item?.authorName),
        authorEmail: normalizeString(item?.authorEmail),
        rating: Number(item?.rating) || 0,
        title: normalizeString(item?.title),
        content: normalizeString(item?.content),
        images: normalizeReviewImageListForPublic(item?.images),
        verifiedPurchase: Boolean(item?.verifiedPurchase),
        status: normalizeReviewStatus(item?.status),
        source: normalizeString(item?.source || 'customer') || 'customer',
        reviewedAt: item?.reviewedAt || null,
        createdAt: item?.createdAt || null,
        updatedAt: item?.updatedAt || null
    };
};

const mapAdminProductReviewFromDocument = ({ productDoc, reviewDoc }) =>
    mapAdminProductReview({
        reviewId: reviewDoc?._id,
        productId: productDoc?._id,
        productName: productDoc?.product_name,
        productSlug: productDoc?.product_slug,
        productThumb: productDoc?.product_thumb,
        userId: reviewDoc?.userId,
        authorName: reviewDoc?.authorName,
        authorEmail: reviewDoc?.authorEmail,
        rating: reviewDoc?.rating,
        title: reviewDoc?.title,
        content: reviewDoc?.content,
        images: reviewDoc?.images,
        verifiedPurchase: reviewDoc?.verifiedPurchase,
        status: reviewDoc?.status,
        source: reviewDoc?.source,
        reviewedAt: reviewDoc?.reviewedAt,
        createdAt: reviewDoc?.createdAt,
        updatedAt: reviewDoc?.updatedAt
    });

const getReviewImageStorageKey = (item) => normalizeString(item?.path || item?.url);

const collectRemovedReviewImages = (previousImages = [], nextImages = []) => {
    const nextKeys = new Set(
        nextImages
            .map((item) => getReviewImageStorageKey(item))
            .filter(Boolean)
    );
    return previousImages.filter((item) => {
        const key = getReviewImageStorageKey(item);
        if (!key) return false;
        return !nextKeys.has(key);
    });
};

const deleteReviewImagesFromStorage = async (images = []) => {
    if (!Array.isArray(images) || !images.length) return;

    await Promise.allSettled(
        images.flatMap((item) => [
            deleteImageFromStorage({
                path: normalizeString(item?.path) || undefined,
                url: normalizeString(item?.url) || undefined
            }),
            item?.variants ? deleteImageVariantsFromStorage(item.variants) : Promise.resolve(null)
        ])
    );
};

const collectProductMediaReferenceKeys = (productItem = {}) => {
    const keys = new Set();
    const addArtifact = (artifact) => {
        const key = toStorageArtifactKey(artifact);
        if (key) keys.add(key);
    };

    addArtifact({
        path: productItem?.product_thumb_path,
        url: productItem?.product_thumb
    });
    if (Array.isArray(productItem?.product_gallery)) {
        productItem.product_gallery.forEach((item) => addArtifact(item));
    }
    collectHtmlImageStorageKeys(productItem?.product_description).forEach((key) => keys.add(key));
    return keys;
};

const isProductMediaReferenced = (artifact, referenceKeys) => {
    const key = toStorageArtifactKey(artifact);
    return Boolean(key && referenceKeys?.has(key));
};

const normalizeProductGallery = (value) => {
    const parsed = parseJsonField(value, 'product_gallery');
    if (parsed === undefined) return undefined;
    if (!Array.isArray(parsed)) {
        throw new BadRequestError('product_gallery must be an array');
    }

    const normalized = parsed
        .map((item) => {
            if (typeof item === 'string') {
                const url = item.trim();
                if (!url) return null;
                return { url };
            }
            if (item && typeof item === 'object' && typeof item.url === 'string') {
                const url = item.url.trim();
                if (!url) return null;
                const path =
                    typeof item.path === 'string' && item.path.trim() ? item.path.trim() : undefined;
                const variants = normalizeImageVariants(item.variants ?? item.imageVariants);
                const cropState = normalizeCropState(item.crop_state ?? item.cropState);
                const base = variants ? { url, path, variants } : { url, path };
                return cropState ? { ...base, crop_state: cropState } : base;
            }
            return null;
        })
        .filter(Boolean);
    return normalized;
};

const sanitizeProductDescription = (value) => {
    if (typeof value !== 'string') return value;
    const textAlignRule = [/^(left|right|center|justify)$/];
    const colorRule = [
        /^#([0-9a-f]{3}){1,2}$/i,
        /^rgb\(\s?\d{1,3}\s?,\s?\d{1,3}\s?,\s?\d{1,3}\s?\)$/i,
        /^rgba\(\s?\d{1,3}\s?,\s?\d{1,3}\s?,\s?\d{1,3}\s?,\s?(0|0?\.\d+|1(\.0)?)\s?\)$/i
    ];

    return sanitizeHtml(value, {
        allowedTags: [
            'p',
            'br',
            'strong',
            'em',
            'u',
            's',
            'blockquote',
            'ul',
            'ol',
            'li',
            'a',
            'img',
            'h2',
            'h3',
            'h4',
            'h5',
            'h6',
            'span',
            'div'
        ],
        allowedAttributes: {
            a: ['href', 'target', 'rel'],
            img: ['src', 'alt', 'title'],
            span: ['style'],
            p: ['style'],
            h2: ['style'],
            h3: ['style'],
            h4: ['style'],
            h5: ['style'],
            h6: ['style'],
            div: ['style']
        },
        allowedStyles: {
            span: {
                color: colorRule
            },
            p: {
                'text-align': textAlignRule
            },
            h2: {
                'text-align': textAlignRule
            },
            h3: {
                'text-align': textAlignRule
            },
            h4: {
                'text-align': textAlignRule
            },
            h5: {
                'text-align': textAlignRule
            },
            h6: {
                'text-align': textAlignRule
            },
            div: {
                'text-align': textAlignRule
            }
        },
        allowedSchemes: ['http', 'https', 'mailto', 'tel'],
        allowedSchemesByTag: {
            img: ['http', 'https']
        },
        transformTags: {
            a: sanitizeHtml.simpleTransform('a', {
                target: '_blank',
                rel: 'noopener noreferrer nofollow'
            })
        }
    });
};

const normalizeProductPayload = (payload, { requireAttributes = false } = {}) => {
    if (!payload || typeof payload !== 'object') {
        throw new BadRequestError('Payload is required');
    }
    const normalized = { ...payload };
    if (Object.prototype.hasOwnProperty.call(normalized, 'product_description')) {
        normalized.product_description = sanitizeProductDescription(normalized.product_description);
    }
    if (Object.prototype.hasOwnProperty.call(normalized, 'product_attributes')) {
        normalized.product_attributes = normalizeProductAttributes(normalized.product_attributes);
    }
    if (Object.prototype.hasOwnProperty.call(normalized, 'product_variations')) {
        normalized.product_variations = normalizeProductVariations(normalized.product_variations);
    }
    if (Object.prototype.hasOwnProperty.call(normalized, 'product_gallery')) {
        normalized.product_gallery = normalizeProductGallery(normalized.product_gallery);
    }
    if (Object.prototype.hasOwnProperty.call(normalized, 'product_thumb_variants')) {
        normalized.product_thumb_variants = normalizeImageVariants(normalized.product_thumb_variants);
    }
    if (Object.prototype.hasOwnProperty.call(normalized, 'product_thumb_crop_state')) {
        normalized.product_thumb_crop_state = normalizeCropState(normalized.product_thumb_crop_state);
    }
    if (Object.prototype.hasOwnProperty.call(normalized, 'product_ratingsAverage')) {
        normalized.product_ratingsAverage = normalizeProductRatingsAverage(normalized.product_ratingsAverage);
    }
    if (Object.prototype.hasOwnProperty.call(normalized, 'product_ratingsCount')) {
        normalized.product_ratingsCount = normalizeProductRatingsCount(normalized.product_ratingsCount);
    }
    if (
        Object.prototype.hasOwnProperty.call(normalized, 'product_ratingsCount') &&
        normalized.product_ratingsCount !== undefined &&
        normalized.product_ratingsCount <= 0
    ) {
        normalized.product_ratingsCount = 0;
        normalized.product_ratingsAverage = 0;
    }
    if (requireAttributes && !normalized.product_attributes) {
        throw new BadRequestError('product_attributes is required');
    }
    return normalized;
};

const parseNumber = (value, fallback) => {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const parseFilter = (value) => {
    if (!value) return {};
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
            return {};
        }
    }
    if (typeof value === 'object') return { ...value };
    return {};
};

const normalizeSearchTerm = (value) => {
    if (typeof value !== 'string') return '';
    return value.trim();
};

const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildSearchTokens = (value) => {
    const normalized = normalizeSearchTerm(value);
    if (!normalized) return [];

    const compact = normalized.replace(/[\s._/-]+/g, '');
    const numeric = normalized.replace(/\D+/g, '');

    return Array.from(new Set([normalized, compact, numeric]))
        .map((token) => token.trim())
        .filter((token) => token.length >= 2);
};

const buildFallbackSearchFilter = ({ baseFilter = {}, searchTerm }) => {
    const tokens = buildSearchTokens(searchTerm);
    if (!tokens.length) return { ...baseFilter };

    const clauses = tokens.flatMap((token) => {
        const escapedToken = escapeRegex(token);
        return [
            { product_name: { $regex: escapedToken, $options: 'i' } },
            { product_slug: { $regex: escapedToken, $options: 'i' } }
        ];
    });

    return {
        ...baseFilter,
        $and: [...(Array.isArray(baseFilter.$and) ? baseFilter.$and : []), { $or: clauses }]
    };
};

const normalizeInventoryStock = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeStoredProductRatingsAverage = (value, ratingsCount = 0) => {
    if (!Number.isFinite(ratingsCount) || ratingsCount <= 0) return 0;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return Math.round(Math.min(parsed, 5) * 10) / 10;
};

const normalizeStoredProductRatingsCount = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return Math.floor(parsed);
};

const attachInventoryStock = async (products) => {
    if (!products) return products;
    const toPlain = (item) =>
        item && typeof item.toObject === 'function' ? item.toObject() : item;
    const list = Array.isArray(products) ? products.map(toPlain) : [toPlain(products)];
    const productIds = list
        .map((item) => item?._id)
        .filter(Boolean);
    if (!productIds.length) return products;

    const inventoryItems = await findInventoryByProductIds({ productIds });
    const inventoryMap = new Map(
        inventoryItems.map((item) => [
            String(item.inven_productId),
            normalizeInventoryStock(item.inven_stock)
        ])
    );

    const mapped = list.map((item) => {
        const id = String(item?._id);
        const hasInventory = inventoryMap.has(id);
        const ratingsCount = normalizeStoredProductRatingsCount(item?.product_ratingsCount);
        const hasReviewField = Object.prototype.hasOwnProperty.call(item || {}, 'product_reviews');
        return {
            ...item,
            product_ratingsAverage: normalizeStoredProductRatingsAverage(
                item?.product_ratingsAverage,
                ratingsCount
            ),
            product_ratingsCount: ratingsCount,
            ...(hasReviewField
                ? { product_reviews: normalizeStoredProductReviews(item?.product_reviews) }
                : {}),
            inventory_stock: hasInventory ? inventoryMap.get(id) : null
        };
    });

    return Array.isArray(products) ? mapped : mapped[0];
};

class ProductFactory {

    /*
    type: 'Inoxs' | 'CastIrons' | 'Electronics',
    payload
    */

    static productRegistry = {};

    static registerProductType(type, classRef) {
        ProductFactory.productRegistry[type] = classRef;
    }

    static async createProduct(type, payload) {
       const productClass = ProductFactory.productRegistry[type];
       if (!productClass) {
        throw new BadRequestError(`Invalid product type: ${type}`);
       }
         const normalizedPayload = normalizeProductPayload(payload, { requireAttributes: true });
         const duplicate = await ProductFactory.findDuplicateProductName({
             name: normalizedPayload.product_name
         });
         if (duplicate) {
             throw new BadRequestError('Product name already exists');
         }
         const productInstance = new productClass(normalizedPayload);
         return await productInstance.createProduct();
    }

    static async updateProduct(type, productId, payload) {
       const productClass = ProductFactory.productRegistry[type];
       if (!productClass) {
        throw new BadRequestError(`Invalid product type: ${type}`);
       }
          const normalizedPayload = normalizeProductPayload(payload);
          if (normalizedPayload.product_name) {
              const duplicate = await ProductFactory.findDuplicateProductName({
                  name: normalizedPayload.product_name,
                  excludeId: productId
              });
              if (duplicate) {
                  throw new BadRequestError('Product name already exists');
              }
          }
          const hasNewThumb =
             Object.prototype.hasOwnProperty.call(normalizedPayload, 'product_thumb') ||
             Object.prototype.hasOwnProperty.call(normalizedPayload, 'product_thumb_path');
          const hasNewGallery = Object.prototype.hasOwnProperty.call(normalizedPayload, 'product_gallery');
          const hasDescriptionUpdate = Object.prototype.hasOwnProperty.call(
              normalizedPayload,
              'product_description'
          );
          const previousProduct =
             (hasNewThumb || hasNewGallery || hasDescriptionUpdate)
                 ? await product.findById(productId).lean()
                 : null;
          const productInstance = new productClass(normalizedPayload);
          const updated = await productInstance.updateProduct(productId);
          const updatedProduct = updated && typeof updated.toObject === 'function'
              ? updated.toObject()
              : updated;
          const updatedReferenceKeys = collectProductMediaReferenceKeys(updatedProduct);
          if (Object.prototype.hasOwnProperty.call(normalizedPayload, 'product_quantity')) {
              const nextStock = parseNumber(normalizedPayload.product_quantity, undefined);
              if (Number.isFinite(nextStock)) {
                  await setInventoryStock({ productId, stock: nextStock });
              }
          }

          const mediaCleanupTasks = [];
          if (hasNewThumb && previousProduct?.product_thumb) {
            const newThumbPath = normalizedPayload.product_thumb_path;
            const newThumbUrl = normalizedPayload.product_thumb;
            const oldThumbPath = previousProduct.product_thumb_path;
            const oldThumbUrl = previousProduct.product_thumb;
            const samePath = oldThumbPath && newThumbPath && oldThumbPath === newThumbPath;
            const sameUrl = oldThumbUrl && newThumbUrl && oldThumbUrl === newThumbUrl;

            if (
                !samePath &&
                !sameUrl &&
                !isProductMediaReferenced({ path: oldThumbPath, url: oldThumbUrl }, updatedReferenceKeys)
            ) {
                mediaCleanupTasks.push((async () => {
                    await deleteImageFromStorage({ path: oldThumbPath, url: oldThumbUrl });
                    await deleteImageVariantsFromStorage(previousProduct.product_thumb_variants);
                })().catch((error) => {
                    const errorMessage = error?.message || 'Failed to delete old image';
                    console.error('Failed to delete old product image', {
                        productId,
                        error: errorMessage
                    });
                }));
             }
          }
          if (hasNewGallery && previousProduct?.product_gallery?.length) {
           const incomingGallery = normalizedPayload.product_gallery || [];
           const keptPaths = new Set(
              incomingGallery
                 .map((item) => (item && typeof item.path === 'string' ? item.path : ''))
                 .filter(Boolean)
           );
           const keptUrls = new Set(
              incomingGallery
                 .map((item) => (item && typeof item.url === 'string' ? item.url : ''))
                 .filter(Boolean)
           );
           for (const image of previousProduct.product_gallery) {
              const samePath = image.path && keptPaths.has(image.path);
              const sameUrl = image.url && keptUrls.has(image.url);
              if (samePath || sameUrl) continue;
              if (isProductMediaReferenced(image, updatedReferenceKeys)) continue;
              mediaCleanupTasks.push((async () => {
                 await deleteImageFromStorage({ path: image.path, url: image.url });
                 await deleteImageVariantsFromStorage(image.variants);
              })().catch((error) => {
                 console.error('Failed to delete old gallery image', {
                    productId,
                    error: error?.message || 'Failed to delete gallery image'
                 });
              }));
           }
          }
          if (hasDescriptionUpdate && previousProduct?.product_description) {
            mediaCleanupTasks.push(deleteRemovedHtmlImagesFromStorage({
                previousHtml: previousProduct.product_description,
                nextHtml: updatedProduct?.product_description || normalizedPayload.product_description,
                protectedKeys: updatedReferenceKeys,
                context: {
                    entity: 'product',
                    productId
                }
            }));
          }
          await Promise.allSettled(mediaCleanupTasks);

           return await attachInventoryStock(updated);
      }

    static async findDuplicateProductName({ name, excludeId } = {}) {
        return await findProductByNormalizedName({ name, excludeId });
    }

    static async deleteProduct({ product_id, product_shop }) {
        let foundProduct = await product.findOne({ _id: product_id, product_shop });
        if (!foundProduct) {
            foundProduct = await product.findById(product_id);
        }
        if (!foundProduct) {
            throw new BadRequestError('Product not found');
        }

        const imageDeleteAttempted = Boolean(
            foundProduct.product_thumb_path || foundProduct.product_thumb
        );
        let imageDeleted = false;
        let imageDeleteError = null;

        if (imageDeleteAttempted) {
            try {
                imageDeleted = await deleteImageFromStorage({
                    path: foundProduct.product_thumb_path,
                    url: foundProduct.product_thumb
                });
                await deleteImageVariantsFromStorage(foundProduct.product_thumb_variants);
                console.info('Deleted product image', { product_id, imageDeleted });
            } catch (error) {
                imageDeleteError = error?.message || 'Failed to delete image';
                console.error('Failed to delete product image', {
                    product_id,
                    error: imageDeleteError
                });
            }
        }
        if (Array.isArray(foundProduct.product_gallery)) {
            await Promise.allSettled(foundProduct.product_gallery.map(async (galleryImage) => {
                const galleryAttempt = Boolean(galleryImage?.path || galleryImage?.url);
                if (!galleryAttempt) return;
                try {
                    await deleteImageFromStorage({
                        path: galleryImage?.path,
                        url: galleryImage?.url
                    });
                    await deleteImageVariantsFromStorage(galleryImage?.variants);
                    console.info('Deleted gallery image', { product_id });
                } catch (error) {
                    console.error('Failed to delete gallery image', {
                        product_id,
                        error: error?.message || 'Failed to delete gallery image'
                    });
                }
            }));
        }
        await deleteHtmlImagesFromStorage(foundProduct.product_description, {
            context: {
                entity: 'product',
                productId: String(foundProduct._id || product_id)
            }
        });

        switch (foundProduct.product_type) {
            case 'CastIrons':
                await castIron.deleteOne({ _id: product_id });
                break;
            case 'Electronics':
                await electronic.deleteOne({ _id: product_id });
                break;
            case 'Inoxs':
                await inox.deleteOne({ _id: product_id });
                break;
            default:
                break;
        }

        const deleteResult = await product.deleteOne({ _id: foundProduct._id });
        return {
            ...deleteResult,
            imageDeleteAttempted,
            imageDeleted,
            imageDeleteError
        };
    }

    // PUT //
    static async publishProductByShop({ product_shop, product_id }) { 
        return await publishProductByShop({ product_shop, product_id });
    
    }
    static async unPublishProductByShop({ product_shop, product_id }) { 
        return await unPublishProductByShop({ product_shop, product_id });
    }

    // QUERY //
    static async findAllDraftsForShop({ product_shop, limit = 50, skip = 0 }) {
        const query = { isDraft: true };
        if (product_shop) {
            query.product_shop = product_shop;
        }
        const products = await findAllDraftsForShop({ query, limit, skip });
        return await attachInventoryStock(products);
    }
    
    static async findAllPublishForShop({ product_shop, limit = 50, skip = 0 }) {
        const query = { isPublished: true };
        if (product_shop) {
            query.product_shop = product_shop;
        }
        const products = await findAllPublishForShop({ query, limit, skip });
        return await attachInventoryStock(products);
    }

    static async searchProducts({ keySearch }) {
        const products = await searchProductsByUser ({ keySearch });
        return await attachInventoryStock(products);
    }
    static async findAllProducts({
        limit = 50,
        sort = 'ctime',
        page = 1,
        filter,
        q,
        search,
        keyword,
        minPrice,
        maxPrice,
        category,
        type
     }) {
        const normalizedLimit = Math.max(parseNumber(limit, 50), 1);
        const normalizedPage = Math.max(parseNumber(page, 1), 1);
        const baseFilter = parseFilter(filter);

        if (!Object.prototype.hasOwnProperty.call(baseFilter, 'isPublished')) {
            baseFilter.isPublished = true;
        }

        const selectedType = type || category;
        if (selectedType) {
            baseFilter.product_type = selectedType;
        }

        const lowerBound = parseNumber(minPrice);
        const upperBound = parseNumber(maxPrice);
        if (Number.isFinite(lowerBound) || Number.isFinite(upperBound)) {
            baseFilter.product_price = {};
            if (Number.isFinite(lowerBound)) baseFilter.product_price.$gte = lowerBound;
            if (Number.isFinite(upperBound)) baseFilter.product_price.$lte = upperBound;
        }

        const searchTerm = normalizeSearchTerm(q || search || keyword);
        const select = [
            'product_name',
            'product_thumb',
            'product_original_price',
            'product_price',
            'product_ratingsAverage',
            'product_ratingsCount',
            'product_description',
            'product_gallery',
            'product_type',
            'product_shop',
            'product_slug'
        ];

        if (searchTerm) {
            const textSearchProducts = await findAllProducts({
                limit: normalizedLimit,
                sort: { score: { $meta: 'textScore' } },
                page: normalizedPage,
                filter: {
                    ...baseFilter,
                    $text: { $search: searchTerm }
                },
                select
            });

            if (textSearchProducts.length) {
                return await attachInventoryStock(textSearchProducts);
            }

            const fallbackProducts = await findAllProducts({
                limit: normalizedLimit,
                sort,
                page: normalizedPage,
                filter: buildFallbackSearchFilter({ baseFilter, searchTerm }),
                select
            });
            return await attachInventoryStock(fallbackProducts);
        }

        const products = await findAllProducts({
            limit: normalizedLimit,
            sort,
            page: normalizedPage,
            filter: baseFilter,
            select
        });
        return await attachInventoryStock(products);
    }
     static async findAllProductsForAdmin({
        limit = 50,
        page = 1,
        sort = 'created',
        status
     }) {
        const normalizedLimit = Math.max(parseNumber(limit, 50), 1);
        const normalizedPage = Math.max(parseNumber(page, 1), 1);
        const filter = {};
        if (status === 'published') {
            filter.isPublished = true;
            filter.isDraft = false;
        } else if (status === 'draft') {
            filter.isDraft = true;
            filter.isPublished = false;

        } else if (status === 'unpublished') {
            
        }

        const products = await findAllProductsForAdmin({
            limit: normalizedLimit,
            page: normalizedPage,
            sort,
            filter,
            select: [
                'product_name',
                'product_type',
                'product_price',
                'product_ratingsAverage',
                'product_ratingsCount',
                'product_shop',
                'product_thumb',
                'product_best_selling_rank',
                'isPublished',
                'isDraft',
                'createdAt',
                'updatedAt'
            ]
        });
        return await attachInventoryStock(products);
     }
     static async getBestSellingProducts({ limit = 10 } = {}) {
        const normalizedLimit = Math.max(parseNumber(limit, 10), 1);
        const products = await findBestSellingProducts({
            limit: normalizedLimit,
            select: [
                'product_name',
                'product_thumb',
                'product_original_price',
                'product_price',
                'product_ratingsAverage',
                'product_ratingsCount',
                'product_description',
                'product_gallery',
                'product_type',
                'product_shop',
                'product_slug',
                'product_best_selling_rank'
            ]
        });
        return await attachInventoryStock(products);
     }
     static async updateBestSellingOrder({ productIds = [] } = {}) {
        const ids = Array.isArray(productIds) ? productIds : [];
        const normalizedIds = ids
            .map((id) => convertToObjectIdMongodb(id))
            .filter(Boolean);

        if (ids.length && !normalizedIds.length) {
            throw new BadRequestError('Invalid product ids');
        }

        if (!normalizedIds.length) {
            return await updateBestSellingOrder({ orderedIds: [] });
        }

        return await updateBestSellingOrder({ orderedIds: normalizedIds });
     }
    static async findProduct({ product_id, includeStatus = false }) {
        const productItem = await findProduct ({ product_id, unSelect: ['__v'], includeStatus });
        return await attachInventoryStock(productItem);
    }
    static async listAdminReviewTargets({
        q = '',
        limit = 24
    } = {}) {
        const safeLimit = Math.min(parsePositiveInteger(limit, 24), 100);
        const searchText = escapeRegex(normalizeString(q));
        const filter = {
            isPublished: true,
            isDraft: false
        };

        if (searchText) {
            filter.$or = [
                { product_name: { $regex: searchText, $options: 'i' } },
                { product_slug: { $regex: searchText, $options: 'i' } }
            ];
        }

        const items = await product.aggregate([
            { $match: filter },
            {
                $project: {
                    product_name: 1,
                    product_slug: 1,
                    product_thumb: 1,
                    product_type: 1,
                    product_price: 1,
                    product_ratingsAverage: 1,
                    product_ratingsCount: 1,
                    createdAt: 1,
                    updatedAt: 1,
                    approvedReviewCount: {
                        $size: {
                            $filter: {
                                input: { $ifNull: ['$product_reviews', []] },
                                as: 'review',
                                cond: {
                                    $eq: [{ $ifNull: ['$$review.status', 'approved'] }, 'approved']
                                }
                            }
                        }
                    }
                }
            },
            { $match: { approvedReviewCount: { $lt: 1 } } },
            {
                $sort: {
                    product_ratingsCount: -1,
                    product_ratingsAverage: -1,
                    updatedAt: -1,
                    createdAt: -1
                }
            },
            { $limit: safeLimit }
        ]).exec();

        return items.map((item) => ({
            id: String(item?._id || ''),
            lookup: normalizeString(item?.product_slug) || String(item?._id || ''),
            productName: normalizeString(item?.product_name),
            productSlug: normalizeString(item?.product_slug),
            productThumb: normalizeString(item?.product_thumb),
            productType: normalizeString(item?.product_type),
            productPrice: Number(item?.product_price) || 0,
            aggregateRating: normalizeStoredProductRatingsAverage(
                item?.product_ratingsAverage,
                item?.product_ratingsCount
            ),
            aggregateCount: normalizeStoredProductRatingsCount(item?.product_ratingsCount),
            approvedReviewCount: Number(item?.approvedReviewCount) || 0,
            createdAt: item?.createdAt || null,
            updatedAt: item?.updatedAt || null
        }));
    }
    static async listAdminProductReviews({
        status = 'all',
        q = '',
        page = 1,
        limit = 20
    } = {}) {
        const safePage = parsePositiveInteger(page, 1);
        const safeLimit = Math.min(parsePositiveInteger(limit, 20), MAX_ADMIN_REVIEW_LIMIT);
        const skip = (safePage - 1) * safeLimit;
        const normalizedStatus = normalizeString(status).toLowerCase();
        const searchText = escapeRegex(normalizeString(q));
        const pipeline = [
            {
                $unwind: {
                    path: '$product_reviews',
                    preserveNullAndEmptyArrays: false
                }
            },
            {
                $project: {
                    reviewId: '$product_reviews._id',
                    productId: '$_id',
                    productName: '$product_name',
                    productSlug: '$product_slug',
                    productThumb: '$product_thumb',
                    userId: '$product_reviews.userId',
                    authorName: '$product_reviews.authorName',
                    authorEmail: '$product_reviews.authorEmail',
                    rating: '$product_reviews.rating',
                    title: '$product_reviews.title',
                    content: '$product_reviews.content',
                    images: '$product_reviews.images',
                    verifiedPurchase: '$product_reviews.verifiedPurchase',
                    source: {
                        $ifNull: ['$product_reviews.source', 'customer']
                    },
                    status: {
                        $ifNull: ['$product_reviews.status', 'approved']
                    },
                    reviewedAt: '$product_reviews.reviewedAt',
                    createdAt: '$product_reviews.createdAt',
                    updatedAt: '$product_reviews.updatedAt'
                }
            }
        ];

        if (normalizedStatus && normalizedStatus !== 'all' && PRODUCT_REVIEW_STATUSES.includes(normalizedStatus)) {
            pipeline.push({ $match: { status: normalizedStatus } });
        }

        if (searchText) {
            pipeline.push({
                $match: {
                    $or: [
                        { productName: { $regex: searchText, $options: 'i' } },
                        { productSlug: { $regex: searchText, $options: 'i' } },
                        { authorName: { $regex: searchText, $options: 'i' } },
                        { authorEmail: { $regex: searchText, $options: 'i' } },
                        { title: { $regex: searchText, $options: 'i' } },
                        { content: { $regex: searchText, $options: 'i' } }
                    ]
                }
            });
        }

        pipeline.push(
            { $sort: { createdAt: -1, updatedAt: -1, reviewId: -1 } },
            {
                $facet: {
                    items: [{ $skip: skip }, { $limit: safeLimit }],
                    total: [{ $count: 'count' }]
                }
            }
        );

        const result = await product.aggregate(pipeline).exec();
        const metadata = result?.[0] || {};
        return {
            items: Array.isArray(metadata?.items)
                ? metadata.items.map((item) => mapAdminProductReview(item)).filter(Boolean)
                : [],
            total: Number(metadata?.total?.[0]?.count) || 0,
            page: safePage,
            limit: safeLimit
        };
    }
    static async createAdminProductReview({ product_id, reviewerId = null, payload = {} }) {
        const productItem = await findProduct({
            product_id,
            unSelect: ['__v'],
            includeStatus: true
        });
        if (!productItem) throw new NotFoundError('Product not found');

        const reviewPayload = normalizeAdminReviewPayload(payload);
        const reviewerObjectId = convertToObjectIdMongodb(reviewerId) || null;
        const productDoc = await product.findById(productItem._id);
        if (!productDoc) throw new NotFoundError('Product not found');
        if (!Array.isArray(productDoc.product_reviews)) {
            productDoc.product_reviews = [];
        }

        productDoc.product_reviews.push({
            userId: null,
            authorName: reviewPayload.authorName,
            authorEmail: reviewPayload.authorEmail,
            rating: reviewPayload.rating,
            title: reviewPayload.title,
            content: reviewPayload.content,
            images: reviewPayload.images,
            verifiedPurchase: reviewPayload.verifiedPurchase,
            orderId: null,
            status: reviewPayload.status,
            source: reviewPayload.source,
            reviewedBy: reviewPayload.status === 'pending' ? null : reviewerObjectId,
            reviewedAt:
                reviewPayload.status === 'pending'
                    ? null
                    : reviewPayload.submittedAt || new Date()
        });

        const createdReview = productDoc.product_reviews[productDoc.product_reviews.length - 1];
        if (reviewPayload.submittedAt) {
            createdReview.createdAt = reviewPayload.submittedAt;
            createdReview.updatedAt = reviewPayload.submittedAt;
            if (reviewPayload.status !== 'pending') {
                createdReview.reviewedAt = reviewPayload.submittedAt;
            }
        }

        if (reviewPayload.status === 'approved') {
            const nextAggregate = computeAggregateRatingUpdate({
                currentAverage: productDoc.product_ratingsAverage,
                currentCount: productDoc.product_ratingsCount,
                nextRating: reviewPayload.rating,
                isNewReview: true
            });
            productDoc.product_ratingsAverage = nextAggregate.average;
            productDoc.product_ratingsCount = nextAggregate.count;
        }

        await productDoc.save();
        return mapAdminProductReviewFromDocument({ productDoc, reviewDoc: createdReview });
    }
    static async getProductReviewMeta({ product_id, userId }) {
        const normalizedUserId = convertToObjectIdMongodb(userId);
        if (!normalizedUserId) throw new BadRequestError('Invalid user id');

        const productItem = await findProduct({
            product_id,
            unSelect: ['__v'],
            includeStatus: true
        });
        if (!productItem || productItem.isPublished === false) {
            throw new NotFoundError('Product not found');
        }

        const eligibleOrder = await findDeliveredOrderForReview({
            userId: normalizedUserId,
            productId: productItem._id
        });

        return buildReviewMeta({
            productDoc: productItem,
            userId: normalizedUserId,
            eligibleOrder
        });
    }
    static async submitProductReview({ product_id, userId, payload = {} }) {
        const normalizedUserId = convertToObjectIdMongodb(userId);
        if (!normalizedUserId) throw new BadRequestError('Invalid user id');

        const productItem = await findProduct({
            product_id,
            unSelect: ['__v'],
            includeStatus: true
        });
        if (!productItem || productItem.isPublished === false) {
            throw new NotFoundError('Product not found');
        }

        const reviewPayload = normalizeReviewPayload(payload);
        const [productDoc, userDoc] = await Promise.all([
            product.findById(productItem._id),
            findUserById({
                userId: normalizedUserId,
                select: { name: 1, email: 1, status: 1 }
            })
        ]);

        if (!productDoc) throw new NotFoundError('Product not found');
        if (!userDoc) throw new NotFoundError('User not found');
        if (userDoc.status && userDoc.status !== 'active') {
            throw new ForbiddenError('Your account cannot submit reviews');
        }

        if (!Array.isArray(productDoc.product_reviews)) {
            productDoc.product_reviews = [];
        }

        const reviewIndex = findUserReviewIndex(productDoc.product_reviews, normalizedUserId);
        const existingReview = reviewIndex >= 0 ? productDoc.product_reviews[reviewIndex] : null;
        const eligibleOrder = existingReview?.orderId
            ? { _id: existingReview.orderId }
            : await findDeliveredOrderForReview({
                userId: normalizedUserId,
                productId: productDoc._id
            });

        if (!eligibleOrder && !existingReview) {
            throw new ForbiddenError('You need a delivered order for this product before reviewing');
        }

        let updatedReview = existingReview;
        const previousRating = Number(existingReview?.rating) || 0;
        const isNewReview = !existingReview;
        const previousStatus = normalizeReviewStatus(existingReview?.status);
        const previousImages = normalizeReviewImageListForPublic(existingReview?.images);

        if (existingReview) {
            existingReview.authorName = userDoc.name || existingReview.authorName || 'Khách hàng';
            existingReview.authorEmail = userDoc.email || existingReview.authorEmail || null;
            existingReview.rating = reviewPayload.rating;
            existingReview.title = reviewPayload.title;
            existingReview.content = reviewPayload.content;
            existingReview.images = reviewPayload.images;
            existingReview.verifiedPurchase = true;
            existingReview.status = previousStatus === 'rejected' ? 'pending' : previousStatus;
            if (existingReview.status !== 'approved') {
                existingReview.reviewedAt = null;
                existingReview.reviewedBy = null;
            }
            if (!existingReview.orderId && eligibleOrder?._id) {
                existingReview.orderId = eligibleOrder._id;
            }
            updatedReview = existingReview;
        } else {
            productDoc.product_reviews.push({
                userId: normalizedUserId,
                authorName: userDoc.name || 'Khách hàng',
                authorEmail: userDoc.email || null,
                rating: reviewPayload.rating,
                title: reviewPayload.title,
                content: reviewPayload.content,
                images: reviewPayload.images,
                verifiedPurchase: true,
                orderId: eligibleOrder?._id || null,
                status: 'pending'
            });
            updatedReview = productDoc.product_reviews[productDoc.product_reviews.length - 1];
        }

        if (!isNewReview && previousStatus === 'approved') {
            const nextAggregate = computeAggregateRatingUpdate({
                currentAverage: productDoc.product_ratingsAverage,
                currentCount: productDoc.product_ratingsCount,
                previousRating,
                nextRating: reviewPayload.rating,
                isNewReview: false
            });
            productDoc.product_ratingsAverage = nextAggregate.average;
            productDoc.product_ratingsCount = nextAggregate.count;
        }

        await productDoc.save();
        if (!isNewReview) {
            const removedImages = collectRemovedReviewImages(previousImages, reviewPayload.images);
            await deleteReviewImagesFromStorage(removedImages);
        }

        const publicProduct = await attachInventoryStock(productDoc);
        const reviewMeta = buildReviewMeta({
            productDoc: productDoc.toObject(),
            userId: normalizedUserId,
            eligibleOrder: eligibleOrder || { _id: updatedReview?.orderId || null }
        });

        return {
            updated: !isNewReview,
            review: mapPublicProductReview(updatedReview),
            reviewMeta,
            product: publicProduct
        };
    }
    static async updateAdminProductReviewStatus({ reviewId, status, reviewerId }) {
        const reviewObjectId = convertToObjectIdMongodb(reviewId);
        if (!reviewObjectId) throw new BadRequestError('Invalid review id');

        const nextStatus = normalizeReviewStatus(status, '');
        if (!PRODUCT_REVIEW_STATUSES.includes(nextStatus)) {
            throw new BadRequestError('Invalid review status');
        }

        const productDoc = await product.findOne({ 'product_reviews._id': reviewObjectId });
        if (!productDoc) throw new NotFoundError('Review not found');

        const reviewDoc =
            typeof productDoc.product_reviews?.id === 'function'
                ? productDoc.product_reviews.id(reviewObjectId)
                : productDoc.product_reviews.find((item) => String(item?._id) === String(reviewObjectId));
        if (!reviewDoc) throw new NotFoundError('Review not found');

        const previousStatus = normalizeReviewStatus(reviewDoc.status);
        if (previousStatus === nextStatus) {
            return mapAdminProductReviewFromDocument({ productDoc, reviewDoc });
        }

        const nextAggregate = computeAggregateForReviewStatusTransition({
            currentAverage: productDoc.product_ratingsAverage,
            currentCount: productDoc.product_ratingsCount,
            rating: reviewDoc.rating,
            previousStatus,
            nextStatus
        });

        productDoc.product_ratingsAverage = nextAggregate.average;
        productDoc.product_ratingsCount = nextAggregate.count;
        reviewDoc.status = nextStatus;
        reviewDoc.reviewedAt = new Date();
        reviewDoc.reviewedBy = convertToObjectIdMongodb(reviewerId) || reviewDoc.reviewedBy || null;

        await productDoc.save();
        return mapAdminProductReviewFromDocument({ productDoc, reviewDoc });
    }
    static async deleteAdminProductReview({ reviewId }) {
        const reviewObjectId = convertToObjectIdMongodb(reviewId);
        if (!reviewObjectId) throw new BadRequestError('Invalid review id');

        const productDoc = await product.findOne({ 'product_reviews._id': reviewObjectId });
        if (!productDoc) throw new NotFoundError('Review not found');

        const reviewDoc =
            typeof productDoc.product_reviews?.id === 'function'
                ? productDoc.product_reviews.id(reviewObjectId)
                : productDoc.product_reviews.find((item) => String(item?._id) === String(reviewObjectId));
        if (!reviewDoc) throw new NotFoundError('Review not found');
        const reviewImages = normalizeReviewImageListForPublic(reviewDoc?.images);

        if (normalizeReviewStatus(reviewDoc.status) === 'approved') {
            const nextAggregate = computeAggregateRatingRemoval({
                currentAverage: productDoc.product_ratingsAverage,
                currentCount: productDoc.product_ratingsCount,
                rating: reviewDoc.rating
            });
            productDoc.product_ratingsAverage = nextAggregate.average;
            productDoc.product_ratingsCount = nextAggregate.count;
        }

        if (typeof reviewDoc.deleteOne === 'function') {
            reviewDoc.deleteOne();
        } else {
            productDoc.product_reviews = productDoc.product_reviews.filter(
                (item) => String(item?._id) !== String(reviewObjectId)
            );
        }

        await productDoc.save();
        await deleteReviewImagesFromStorage(reviewImages);
        return true;
    }
    
}

// define base product class
class Product {
    constructor({
        product_name, product_thumb, product_thumb_path, product_thumb_variants, product_description, product_original_price, product_price,
        product_type, product_shop, product_attributes, product_quantity,
        product_variations, product_weight, product_gallery, product_thumb_crop_state,
        product_ratingsAverage, product_ratingsCount
    }){
        this.product_name = product_name;
        this.product_thumb = product_thumb;
        this.product_thumb_path = product_thumb_path;
        this.product_thumb_variants = product_thumb_variants;
        this.product_thumb_crop_state = product_thumb_crop_state;
        this.product_description = product_description;
        this.product_original_price = product_original_price;
        this.product_price = product_price;
        this.product_type = product_type;
        this.product_shop = product_shop;
        this.product_attributes = product_attributes;
        this.product_quantity = product_quantity;
        this.product_variations = product_variations;
        this.product_weight = product_weight;
        this.product_gallery = product_gallery;
        this.product_ratingsAverage = product_ratingsAverage;
        this.product_ratingsCount = product_ratingsCount;
    }

    // create new product

    async createProduct( product_id ) { 
        const newProduct = await product.create({ ...this, _id: product_id });
        if (newProduct) { 
           await insertInventory({
                productId: newProduct._id,
                shopId: newProduct.product_shop,
                stock: newProduct.product_quantity,
            });
        }
        return newProduct;
    }

    // update product
    async updateProduct(productId, bodyUpdate) {
        return await updateProductById({ productId, bodyUpdate, model: product });
    }
}

// Define sub-class for different product types cast iron
class CastIron extends Product { 

    async createProduct() {
        const newCastIron = await castIron.create({
            ...this.product_attributes,
            product_shop: this.product_shop
        });
        if (!newCastIron) throw new BadRequestError('Create new CastIron error');
        const newProduct = await super.createProduct(newCastIron._id);
        if (!newProduct) throw new BadRequestError('Create new Product error');
        return newProduct;
    }
    async updateProduct(productId){
            /* 
                {
                    a: underfined,
                    b: null,
                }
            */
        // 1.remove attr has null  underfined
        const objectParams = removeUndefinedObject(this);

        // 2. check xem update cho nao
        if (objectParams.product_attributes) {
            // update child
            await updateProductById({productId, bodyUpdate: updateNestedObject(objectParams.product_attributes), model: castIron });
            // delete objectParams.product_attributes;
        }


        const updateProduct = await super.updateProduct(productId, updateNestedObject(objectParams));
        return updateProduct;

    }
}

// Define sub-class for different product types electronics
class Electronics extends Product { 

    async createProduct() {
        const newElectronic = await electronic.create({
            ...this.product_attributes,
            product_shop: this.product_shop
        });
        if (!newElectronic) throw new BadRequestError('Create new Electronic error');
        const newProduct = await super.createProduct(newElectronic._id);
        if (!newProduct) throw new BadRequestError('Create new Product error');
        
        return newProduct;
    }
      async updateProduct(productId){
            /* 
                {
                    a: underfined,
                    b: null,
                }
            */
        // 1.remove attr has null  underfined
        const objectParams = removeUndefinedObject(this);

        // 2. check xem update cho nao
        if (objectParams.product_attributes) {
            // update child
            await updateProductById({productId, bodyUpdate: updateNestedObject(objectParams.product_attributes), model: electronic });
            // delete objectParams.product_attributes;
        }
        const updateProduct = await super.updateProduct(productId, updateNestedObject(objectParams));
        return updateProduct;

    }
}

class Inox extends Product { 

    async createProduct() {
        const newInox = await inox.create({
            ...this.product_attributes,
            product_shop: this.product_shop
        });
        if (!newInox) throw new BadRequestError('Create new Inox error');
        const newProduct = await super.createProduct(newInox._id);
        if (!newProduct) throw new BadRequestError('Create new Product error');
        
        return newProduct;
    }
     async updateProduct(productId){
            /* 
                {
                    a: underfined,
                    b: null,
                }
            */
        // 1.remove attr has null  underfined
        const objectParams = removeUndefinedObject(this);

        // 2. check xem update cho nao
        if (objectParams.product_attributes) {
            // update child
            await updateProductById({productId, bodyUpdate: updateNestedObject(objectParams.product_attributes), model: inox });
            // delete objectParams.product_attributes;
        }
        const updateProduct = await super.updateProduct(productId, updateNestedObject(objectParams));
        return updateProduct;
        
         
        
    }
}

// register product types
ProductFactory.registerProductType('Electronics', Electronics);
ProductFactory.registerProductType('CastIrons', CastIron);
ProductFactory.registerProductType('Inoxs', Inox); 

module.exports = ProductFactory;
