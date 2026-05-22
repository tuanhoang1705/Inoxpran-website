'use strict'

const crypto = require('node:crypto');
const path = require('node:path');
const { URL } = require('node:url');
const imageSize = require('image-size');
const sharp = require('sharp');
const { BadRequestError } = require('../core/error.response');
const { getBucket } = require('../config/firebase');

const MAX_UPLOAD_SIZE = Number(process.env.UPLOAD_MAX_SIZE || 1 * 1024 * 1024);
const REQUIRED_IMAGE_WIDTH = Number(process.env.IMAGE_REQUIRED_WIDTH || 300);
const REQUIRED_IMAGE_HEIGHT = Number(process.env.IMAGE_REQUIRED_HEIGHT || 300);
const WEBP_QUALITY = Number(process.env.IMAGE_WEBP_QUALITY || 80);
const AVIF_QUALITY = Number(process.env.IMAGE_AVIF_QUALITY || 55);
const AVIF_EFFORT = Number(process.env.IMAGE_AVIF_EFFORT || 6);
const WEBP_EFFORT = Number(process.env.IMAGE_WEBP_EFFORT || 4);

const IMAGE_OPTIMIZATION_PROFILES = Object.freeze({
    homeSlide: Object.freeze({
        widths: [480, 760, 940],
        formats: ['avif', 'webp'],
        canonicalFormat: 'webp',
        fit: 'inside',
        withoutEnlargement: true
    }),
    blog: Object.freeze({
        widths: [384, 640, 960, 1280],
        formats: ['avif', 'webp'],
        canonicalFormat: 'webp',
        fit: 'inside',
        withoutEnlargement: true
    }),
    productThumb: Object.freeze({
        widths: [200, 300, 480, 640],
        formats: ['avif', 'webp'],
        canonicalFormat: 'webp',
        fit: 'inside',
        withoutEnlargement: true
    }),
    productGallery: Object.freeze({
        widths: [480, 960, 1440],
        formats: ['avif', 'webp'],
        canonicalFormat: 'webp',
        fit: 'inside',
        withoutEnlargement: true
    })
});

const sanitizeFileName = (fileName) => {
    if (!fileName) return 'file';
    return fileName
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, '_');
};

const sanitizeFileStem = (fileName) => {
    const parsed = path.parse(String(fileName || 'file'));
    const stem = parsed.name || 'file';
    return stem
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, '_')
        .replace(/^_+|_+$/g, '') || 'file';
};

const buildStoragePath = ({ folder, fileName }) => {
    const safeFolder = folder ? folder.replace(/[^a-zA-Z0-9/_-]/g, '') : 'uploads';
    const safeName = sanitizeFileName(fileName);
    const uniquePart = `${Date.now()}_${crypto.randomUUID()}`;
    return `${safeFolder}/${uniquePart}_${safeName}`;
};

const buildStorageBasePath = ({ folder, fileName }) => {
    const safeFolder = folder ? folder.replace(/[^a-zA-Z0-9/_-]/g, '') : 'uploads';
    const safeStem = sanitizeFileStem(fileName);
    const uniquePart = `${Date.now()}_${crypto.randomUUID()}`;
    return `${safeFolder}/${uniquePart}_${safeStem}`;
};

const buildVariantStoragePath = ({ basePath, suffix, extension }) => {
    const safeExtension = String(extension || '').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin';
    const safeSuffix = String(suffix || '').replace(/[^a-z0-9._-]/gi, '').toLowerCase();
    return `${basePath}${safeSuffix ? `_${safeSuffix}` : ''}.${safeExtension}`;
};

const resolveValidation = (validation = {}) => {
    const maxSizeBytes = Number.isFinite(validation.maxSizeBytes)
        ? validation.maxSizeBytes
        : MAX_UPLOAD_SIZE;
    const requireDimensions =
        validation.requireDimensions !== undefined ? validation.requireDimensions : true;
    const requiredWidth = Number.isFinite(validation.requiredWidth)
        ? validation.requiredWidth
        : REQUIRED_IMAGE_WIDTH;
    const requiredHeight = Number.isFinite(validation.requiredHeight)
        ? validation.requiredHeight
        : REQUIRED_IMAGE_HEIGHT;

    return {
        maxSizeBytes,
        requireDimensions,
        requiredWidth,
        requiredHeight
    };
};

const formatSizeLimit = (bytes) => `${Math.ceil(bytes / (1024 * 1024))}MB`;

const validateImageBuffer = (buffer, validation) => {
    const { maxSizeBytes, requireDimensions, requiredWidth, requiredHeight } =
        resolveValidation(validation);
    if (!buffer || !buffer.length) {
        throw new BadRequestError('File buffer is required');
    }
    if (buffer.length > maxSizeBytes) {
        throw new BadRequestError(
            `Image size must be ${formatSizeLimit(maxSizeBytes)} or smaller`
        );
    }
    let dimensions;
    try {
        dimensions = imageSize(buffer);
    } catch {
        throw new BadRequestError('Invalid image data');
    }
    if (requireDimensions) {
        if (
            dimensions?.width !== requiredWidth ||
            dimensions?.height !== requiredHeight
        ) {
            throw new BadRequestError(
                `Image dimensions must be ${requiredWidth}x${requiredHeight}px`
            );
        }
    }
};

const buildPublicUrl = ({ bucketName, destination, token }) => {
    const encodedPath = encodeURIComponent(destination);
    return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedPath}?alt=media&token=${token}`;
};

const saveBufferToBucket = async ({ bucket, destination, buffer, mimetype }) => {
    const downloadToken = crypto.randomUUID();
    const fileRef = bucket.file(destination);
    await fileRef.save(buffer, {
        contentType: mimetype,
        metadata: {
            cacheControl: 'public, max-age=31536000',
            metadata: {
                firebaseStorageDownloadTokens: downloadToken
            }
        }
    });
    return {
        url: buildPublicUrl({ bucketName: bucket.name, destination, token: downloadToken }),
        path: destination,
        bytes: buffer.length
    };
};

const saveImageBuffer = async ({ buffer, mimetype, fileName, folder, validation }) => {
    validateImageBuffer(buffer, validation);
    const bucket = getBucket();
    const destination = buildStoragePath({ folder, fileName });
    return saveBufferToBucket({ bucket, destination, buffer, mimetype });
};

const isOptimizableMimeType = (mimeType) => {
    const normalized = String(mimeType || '').toLowerCase();
    return normalized === 'image/jpeg' ||
        normalized === 'image/jpg' ||
        normalized === 'image/png' ||
        normalized === 'image/webp';
};

const uniqueSortedNumbers = (values = []) =>
    [...new Set(values
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
        .map((value) => Math.round(value)))]
        .sort((a, b) => a - b);

const resolveOptimizationProfile = (optimization) => {
    if (!optimization) return null;
    if (optimization === true) return IMAGE_OPTIMIZATION_PROFILES.blog;
    if (typeof optimization === 'string') {
        return IMAGE_OPTIMIZATION_PROFILES[optimization] || null;
    }
    if (typeof optimization !== 'object') return null;

    const profileName = typeof optimization.profile === 'string' ? optimization.profile : '';
    const preset = profileName ? IMAGE_OPTIMIZATION_PROFILES[profileName] || {} : {};
    const merged = {
        ...preset,
        ...optimization
    };

    const widths = uniqueSortedNumbers(merged.widths || []);
    const formats = Array.isArray(merged.formats)
        ? merged.formats
            .map((format) => String(format || '').toLowerCase())
            .filter((format) => format === 'avif' || format === 'webp')
        : [];
    if (!widths.length || !formats.length) return null;

    return {
        widths,
        formats,
        canonicalFormat: formats.includes(String(merged.canonicalFormat || '').toLowerCase())
            ? String(merged.canonicalFormat).toLowerCase()
            : formats.includes('webp')
                ? 'webp'
                : formats[0],
        fit: merged.fit === 'cover' ? 'cover' : 'inside',
        withoutEnlargement: merged.withoutEnlargement !== false
    };
};

const getSharpFormatOptions = (format) => {
    if (format === 'avif') {
        return { quality: Math.max(1, Math.min(100, AVIF_QUALITY)), effort: Math.max(0, Math.min(9, AVIF_EFFORT)) };
    }
    return { quality: Math.max(1, Math.min(100, WEBP_QUALITY)), effort: Math.max(0, Math.min(6, WEBP_EFFORT)) };
};

const buildResponsiveWidths = ({ sourceWidth, requestedWidths = [], withoutEnlargement = true }) => {
    const widths = requestedWidths.filter((width) =>
        withoutEnlargement ? width <= sourceWidth : true
    );
    const list = uniqueSortedNumbers([...widths, sourceWidth]);
    if (!list.length && Number.isFinite(sourceWidth) && sourceWidth > 0) return [Math.round(sourceWidth)];
    return list;
};

const toAspectRatio = (width, height) => {
    const w = Number(width);
    const h = Number(height);
    if (!Number.isFinite(w) || !Number.isFinite(h) || h <= 0) return null;
    return Math.round((w / h) * 10000) / 10000;
};

const optimizeAndUploadImageBuffer = async ({
    buffer,
    mimetype,
    fileName,
    folder,
    validation,
    optimization
}) => {
    validateImageBuffer(buffer, validation);
    const profile = resolveOptimizationProfile(optimization);
    if (!profile || !isOptimizableMimeType(mimetype)) {
        return saveImageBuffer({ buffer, mimetype, fileName, folder, validation: { ...validation, requireDimensions: false } });
    }

    let metadata;
    try {
        metadata = await sharp(buffer, { failOn: 'none' }).metadata();
    } catch {
        return saveImageBuffer({ buffer, mimetype, fileName, folder, validation: { ...validation, requireDimensions: false } });
    }

    const sourceWidth = Number(metadata?.width);
    const sourceHeight = Number(metadata?.height);
    if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
        return saveImageBuffer({ buffer, mimetype, fileName, folder, validation: { ...validation, requireDimensions: false } });
    }

    const widths = buildResponsiveWidths({
        sourceWidth,
        requestedWidths: profile.widths,
        withoutEnlargement: profile.withoutEnlargement
    });
    if (!widths.length) {
        return saveImageBuffer({ buffer, mimetype, fileName, folder, validation: { ...validation, requireDimensions: false } });
    }

    const bucket = getBucket();
    const basePath = buildStorageBasePath({ folder, fileName });
    const variantsByFormat = {};

    for (const format of profile.formats) {
        const items = [];
        for (const width of widths) {
            const pipeline = sharp(buffer, { failOn: 'none' }).rotate().resize({
                width,
                fit: profile.fit,
                withoutEnlargement: profile.withoutEnlargement
            });
            if (format === 'avif') {
                pipeline.avif(getSharpFormatOptions('avif'));
            } else {
                pipeline.webp(getSharpFormatOptions('webp'));
            }
            const output = await pipeline.toBuffer({ resolveWithObject: true });
            const destination = buildVariantStoragePath({
                basePath,
                suffix: `${width}w`,
                extension: format
            });
            const saved = await saveBufferToBucket({
                bucket,
                destination,
                buffer: output.data,
                mimetype: format === 'avif' ? 'image/avif' : 'image/webp'
            });
            const outputWidth = Number(output.info?.width) || width;
            const outputHeight = Number(output.info?.height) || Math.round((sourceHeight / sourceWidth) * outputWidth);
            items.push({
                url: saved.url,
                path: saved.path,
                width: outputWidth,
                height: outputHeight,
                format,
                bytes: saved.bytes
            });
        }
        variantsByFormat[format] = items;
    }

    const canonicalList = variantsByFormat[profile.canonicalFormat] || [];
    const canonical = canonicalList[canonicalList.length - 1]
        || (variantsByFormat.webp && variantsByFormat.webp[variantsByFormat.webp.length - 1])
        || (variantsByFormat.avif && variantsByFormat.avif[variantsByFormat.avif.length - 1]);

    if (!canonical) {
        return saveImageBuffer({ buffer, mimetype, fileName, folder, validation: { ...validation, requireDimensions: false } });
    }

    return {
        url: canonical.url,
        path: canonical.path,
        width: canonical.width,
        height: canonical.height,
        format: canonical.format,
        variants: {
            source: {
                width: sourceWidth,
                height: sourceHeight,
                aspectRatio: toAspectRatio(sourceWidth, sourceHeight)
            },
            canonical: {
                url: canonical.url,
                path: canonical.path,
                width: canonical.width,
                height: canonical.height,
                format: canonical.format
            },
            avif: variantsByFormat.avif || [],
            webp: variantsByFormat.webp || []
        }
    };
};

const uploadImage = async ({ file, folder, validation, optimization }) => {
    if (!file || !file.buffer) {
        throw new BadRequestError('File buffer is required');
    }
    return await optimizeAndUploadImageBuffer({
        buffer: file.buffer,
        mimetype: file.mimetype,
        fileName: file.originalname,
        folder,
        validation,
        optimization
    });
};

const extensionFromMime = (mimeType) => {
    const normalized = String(mimeType || '').toLowerCase();
    if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'jpg';
    if (normalized === 'image/png') return 'png';
    if (normalized === 'image/webp') return 'webp';
    if (normalized === 'image/gif') return 'gif';
    if (normalized === 'image/svg+xml') return 'svg';
    const parts = normalized.split('/');
    return parts.length > 1 ? parts[1].replace('+xml', '') : 'bin';
};

const parseBase64Image = (dataUrl) => {
    if (typeof dataUrl !== 'string') {
        throw new BadRequestError('Image data must be a string');
    }
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
        throw new BadRequestError('Invalid base64 image data');
    }
    const mimetype = match[1];
    const base64Data = match[2];
    if (!mimetype.startsWith('image/')) {
        throw new BadRequestError('Only image files are allowed');
    }
    const buffer = Buffer.from(base64Data, 'base64');
    if (!buffer.length) {
        throw new BadRequestError('Invalid base64 image data');
    }
    return { buffer, mimetype };
};

const uploadBase64Image = async ({ dataUrl, folder, fileName, validation, optimization }) => {
    const { buffer, mimetype } = parseBase64Image(dataUrl);
    const safeName = fileName || `upload.${extensionFromMime(mimetype)}`;
    return await optimizeAndUploadImageBuffer({
        buffer,
        mimetype,
        fileName: safeName,
        folder,
        validation,
        optimization
    });
};

const extractStoragePathFromUrl = (url, bucketName) => {
    if (!url || typeof url !== 'string') return null;
    if (url.startsWith('data:')) return null;

    try {
        const parsed = new URL(url);
        const pathName = parsed.pathname || '';

        if (pathName.includes('/o/')) {
            const parts = pathName.split('/o/');
            if (parts.length < 2) return null;
            const bucketMatch = parts[0].split('/b/')[1];
            if (bucketName && bucketMatch && bucketMatch !== bucketName) return null;
            return decodeURIComponent(parts[1]);
        }

        if (parsed.hostname === 'storage.googleapis.com') {
            const segments = pathName.split('/').filter(Boolean);
            if (!segments.length) return null;
            const [bucket, ...rest] = segments;
            if (bucketName && bucket !== bucketName) return null;
            if (!rest.length) return null;
            return decodeURIComponent(rest.join('/'));
        }
    } catch {
        return null;
    }

    return null;
};

const deleteImageFromStorage = async ({ path, url }) => {
    const bucket = getBucket();
    const targetPath = path || extractStoragePathFromUrl(url, bucket.name);
    if (!targetPath) return false;

    try {
        await bucket.file(targetPath).delete();
        return true;
    } catch (error) {
        if (error?.code === 404) return false;
        throw error;
    }
};

const walkStorageArtifacts = (value, acc) => {
    if (!value) return acc;
    if (Array.isArray(value)) {
        value.forEach((item) => walkStorageArtifacts(item, acc));
        return acc;
    }
    if (typeof value !== 'object') return acc;

    if (typeof value.path === 'string' || typeof value.url === 'string') {
        acc.push({
            path: typeof value.path === 'string' ? value.path : null,
            url: typeof value.url === 'string' ? value.url : null
        });
    }

    Object.values(value).forEach((child) => walkStorageArtifacts(child, acc));
    return acc;
};

const deleteImageVariantsFromStorage = async (variants) => {
    const artifacts = walkStorageArtifacts(variants, []);
    if (!artifacts.length) return { deleted: 0, total: 0 };

    const seen = new Set();
    let deleted = 0;
    for (const artifact of artifacts) {
        const key = `${artifact.path || ''}|${artifact.url || ''}`;
        if (!key || key === '|') continue;
        if (seen.has(key)) continue;
        seen.add(key);
        try {
            const result = await deleteImageFromStorage({
                path: artifact.path || undefined,
                url: artifact.url || undefined
            });
            if (result) deleted += 1;
        } catch (error) {
            console.error('Failed to delete image variant', {
                path: artifact.path || null,
                url: artifact.url || null,
                error: error?.message || 'delete-variant-failed'
            });
        }
    }

    return {
        deleted,
        total: seen.size
    };
};

module.exports = {
    uploadImage,
    uploadBase64Image,
    deleteImageFromStorage,
    deleteImageVariantsFromStorage,
    IMAGE_OPTIMIZATION_PROFILES
};
