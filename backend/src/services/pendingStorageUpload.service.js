'use strict'

const { pendingStorageUpload } = require('../models/pendingStorageUpload.model');
const { product } = require('../models/product.model');
const { blog } = require('../models/blog.model');
const {
    collectHtmlImageStorageKeys,
    deleteImageFromStorage,
    deleteImageVariantsFromStorage,
    toStorageArtifactKey
} = require('./storage.service');

const DEFAULT_PENDING_UPLOAD_TTL_MS = Number(
    process.env.PENDING_UPLOAD_TTL_MS || 24 * 60 * 60 * 1000
);
const CLEANUP_BATCH_SIZE = Number(process.env.PENDING_UPLOAD_CLEANUP_BATCH_SIZE || 25);

const normalizeSessionId = (value) =>
    String(value || '')
        .trim()
        .replace(/[^a-zA-Z0-9._:-]/g, '')
        .slice(0, 160);

const normalizeEntityType = (value) => (value === 'blog' ? 'blog' : 'product');
const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const deleteArtifact = async (artifact) => {
    await Promise.allSettled([
        deleteImageFromStorage({ path: artifact?.path, url: artifact?.url }),
        artifact?.variants
            ? deleteImageVariantsFromStorage(artifact.variants)
            : Promise.resolve(null)
    ]);
};

const isStorageArtifactReferenced = async (artifact) => {
    if (!toStorageArtifactKey(artifact)) return false;
    const url = String(artifact?.url || '').trim();
    const path = String(artifact?.path || '').trim();
    const urlPattern = url ? new RegExp(escapeRegex(url)) : null;
    const productConditions = [
        ...(url
            ? [
                  { product_thumb: url },
                  { 'product_gallery.url': url },
                  { 'product_reviews.images.url': url },
                  { product_description: urlPattern }
              ]
            : []),
        ...(path
            ? [
                  { product_thumb_path: path },
                  { 'product_gallery.path': path },
                  { 'product_reviews.images.path': path }
              ]
            : [])
    ];
    const blogConditions = [
        ...(url ? [{ blog_image: url }, { blog_content: urlPattern }] : []),
        ...(path ? [{ blog_image_path: path }] : [])
    ];
    const [productReference, blogReference] = await Promise.all([
        productConditions.length ? product.exists({ $or: productConditions }) : null,
        blogConditions.length ? blog.exists({ $or: blogConditions }) : null
    ]);
    return Boolean(productReference || blogReference);
};

const registerPendingStorageUpload = async ({
    ownerId,
    sessionId,
    entityType,
    url,
    path,
    variants
}) => {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!ownerId || !normalizedSessionId || !url) return null;

    return pendingStorageUpload.create({
        ownerId: String(ownerId),
        sessionId: normalizedSessionId,
        entityType: normalizeEntityType(entityType),
        url,
        path,
        variants: variants || null,
        expiresAt: new Date(Date.now() + DEFAULT_PENDING_UPLOAD_TTL_MS)
    });
};

const commitPendingStorageUploads = async ({ ownerId, sessionId, html, artifacts = [] }) => {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!ownerId || !normalizedSessionId) return { committed: 0 };

    const referencedKeys = collectHtmlImageStorageKeys(html);
    for (const artifact of Array.isArray(artifacts) ? artifacts : []) {
        const key = toStorageArtifactKey(artifact);
        if (key) referencedKeys.add(key);
    }
    if (!referencedKeys.size) return { committed: 0 };

    const pending = await pendingStorageUpload
        .find({ ownerId: String(ownerId), sessionId: normalizedSessionId })
        .lean();
    const referencedIds = pending
        .filter((item) => referencedKeys.has(toStorageArtifactKey(item)))
        .map((item) => item._id);

    if (!referencedIds.length) return { committed: 0 };
    const result = await pendingStorageUpload.deleteMany({ _id: { $in: referencedIds } });
    return { committed: result.deletedCount || 0 };
};

const cleanupPendingStorageSession = async ({ ownerId, sessionId }) => {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!ownerId || !normalizedSessionId) return { deleted: 0 };

    const pending = await pendingStorageUpload
        .find({ ownerId: String(ownerId), sessionId: normalizedSessionId })
        .lean();
    let deleted = 0;

    for (const artifact of pending) {
        if (!(await isStorageArtifactReferenced(artifact))) {
            await deleteArtifact(artifact);
            deleted += 1;
        }
        await pendingStorageUpload.deleteOne({ _id: artifact._id });
    }

    return { deleted };
};

const cleanupExpiredPendingStorageUploads = async () => {
    const expired = await pendingStorageUpload
        .find({ expiresAt: { $lte: new Date() } })
        .sort({ expiresAt: 1 })
        .limit(Math.max(1, CLEANUP_BATCH_SIZE))
        .lean();

    let deleted = 0;
    for (const artifact of expired) {
        if (!(await isStorageArtifactReferenced(artifact))) {
            await deleteArtifact(artifact);
            deleted += 1;
        }
        await pendingStorageUpload.deleteOne({ _id: artifact._id });
    }

    return { scanned: expired.length, deleted };
};

module.exports = {
    cleanupExpiredPendingStorageUploads,
    cleanupPendingStorageSession,
    commitPendingStorageUploads,
    isStorageArtifactReferenced,
    normalizeSessionId,
    registerPendingStorageUpload
};
