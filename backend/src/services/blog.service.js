'use strict'

const sanitizeHtml = require('sanitize-html');
const slugify = require('slugify');
const { blog, BLOG_CATEGORY_KEYS } = require('../models/blog.model');
const { BadRequestError, NotFoundError } = require('../core/error.response');
const { convertToObjectIdMongodb } = require('../utils');
const {
    collectHtmlImageStorageKeys,
    deleteHtmlImagesFromStorage,
    deleteImageFromStorage,
    deleteImageVariantsFromStorage,
    deleteRemovedHtmlImagesFromStorage,
    toStorageArtifactKey
} = require('./storage.service');
const NewsletterService = require('./newsletter.service');

const MAX_LIMIT = 100;
const WORDS_PER_MINUTE = 220;
const DEFAULT_RELATED_LIMIT = 3;
const MAX_SEO_SLUG_LENGTH = Number(process.env.BLOG_SLUG_MAX_LENGTH || 80);

const normalizeString = (value) => {
    if (typeof value !== 'string') return '';
    return value.trim();
};

const parseNumber = (value, fallback) => {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
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

const parseBoolean = (value, fallback = false) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    if (typeof value !== 'string') return fallback;
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'published'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'draft'].includes(normalized)) return false;
    return fallback;
};

const parseDate = (value) => {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
};

const parseStringArray = (value) => {
    if (Array.isArray(value)) {
        return value.map((item) => normalizeString(item)).filter(Boolean);
    }
    if (typeof value !== 'string') return [];

    const trimmed = value.trim();
    if (!trimmed) return [];

    if (trimmed.startsWith('[')) {
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
                return parsed.map((item) => normalizeString(item)).filter(Boolean);
            }
        } catch {
            return [];
        }
    }

    return trimmed
        .split(',')
        .map((item) => normalizeString(item))
        .filter(Boolean);
};

const dedupeStrings = (values = []) => {
    const seen = new Set();
    const result = [];
    values.forEach((value) => {
        const normalized = normalizeString(value);
        if (!normalized) return;
        const key = normalized.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        result.push(normalized);
    });
    return result;
};

const parseObjectIdArray = (value) => {
    const values = parseStringArray(value);
    const seen = new Set();
    const ids = [];

    values.forEach((item) => {
        const objectId = convertToObjectIdMongodb(item);
        if (!objectId) return;
        const key = String(objectId);
        if (seen.has(key)) return;
        seen.add(key);
        ids.push(objectId);
    });

    return ids;
};

const formatDate = (value) => {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().split('T')[0];
};

const sanitizeBlogContent = (value) => {
    const input = typeof value === 'string' ? value : '';
    const textAlignRule = [/^(left|right|center|justify)$/];
    const colorRule = [
        /^#([0-9a-f]{3}){1,2}$/i,
        /^rgb\(\s?\d{1,3}\s?,\s?\d{1,3}\s?,\s?\d{1,3}\s?\)$/i,
        /^rgba\(\s?\d{1,3}\s?,\s?\d{1,3}\s?,\s?\d{1,3}\s?,\s?(0|0?\.\d+|1(\.0)?)\s?\)$/i
    ];

    return sanitizeHtml(input, {
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
            'h1',
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
            h1: ['style'],
            h2: ['style'],
            h3: ['style'],
            h4: ['style'],
            h5: ['style'],
            h6: ['style'],
            div: ['style']
        },
        allowedStyles: {
            span: { color: colorRule },
            p: { 'text-align': textAlignRule },
            h1: { 'text-align': textAlignRule },
            h2: { 'text-align': textAlignRule },
            h3: { 'text-align': textAlignRule },
            h4: { 'text-align': textAlignRule },
            h5: { 'text-align': textAlignRule },
            h6: { 'text-align': textAlignRule },
            div: { 'text-align': textAlignRule }
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

const stripHtml = (value) =>
    sanitizeHtml(value || '', {
        allowedTags: [],
        allowedAttributes: {}
    });

const estimateReadTimeMinutes = (content) => {
    const plainText = stripHtml(content || '');
    const words = plainText
        .trim()
        .split(/\s+/)
        .filter(Boolean).length;
    if (!words) return 1;
    return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
};

const normalizeSlugSource = (value) =>
    String(value || '').replace(/[\u0111\u0110]/g, (char) => (char === '\u0111' ? 'd' : 'D'));

const trimSlugLength = (value, maxLength = MAX_SEO_SLUG_LENGTH) => {
    const normalized = String(value || '').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
    if (!normalized) return '';
    if (!Number.isFinite(maxLength) || maxLength <= 0) return normalized;
    return normalized.slice(0, maxLength).replace(/-+$/g, '');
};

const withSlugSuffix = (base, suffix, maxLength = MAX_SEO_SLUG_LENGTH) => {
    const normalizedSuffix = trimSlugLength(suffix, maxLength);
    if (!normalizedSuffix) return trimSlugLength(base, maxLength);

    const availableBaseLength = Math.max(maxLength - normalizedSuffix.length - 1, 1);
    const normalizedBase = trimSlugLength(base, availableBaseLength);
    return `${normalizedBase}-${normalizedSuffix}`;
};

const safeSendNewsletter = async ({ blogSummary, sendNewsletter }) => {
    if (!sendNewsletter || !blogSummary) return;
    try {
        await NewsletterService.sendBlogAnnouncement({ blog: blogSummary });
    } catch (error) {
        console.error('Failed to send blog newsletter', {
            blogId: blogSummary?._id || blogSummary?.id,
            error: error?.message || 'newsletter-failed'
        });
    }
};

const collectBlogMediaReferenceKeys = (blogItem = {}) => {
    const keys = new Set();
    const coverKey = toStorageArtifactKey({
        path: blogItem?.blog_image_path,
        url: blogItem?.blog_image
    });
    if (coverKey) keys.add(coverKey);
    collectHtmlImageStorageKeys(blogItem?.blog_content).forEach((key) => keys.add(key));
    return keys;
};

const isBlogMediaReferenced = (artifact, referenceKeys) => {
    const key = toStorageArtifactKey(artifact);
    return Boolean(key && referenceKeys?.has(key));
};

const buildSlug = (value) => {
    const normalized = slugify(normalizeSlugSource(value), {
        lower: true,
        strict: true,
        locale: 'vi',
        trim: true
    });
    const seoFriendlySlug = trimSlugLength(normalized, MAX_SEO_SLUG_LENGTH);
    return seoFriendlySlug || `blog-${Date.now()}`;
};

const buildAuthorAvatar = ({ authorName, authorAvatar }) => {
    const avatar = normalizeString(authorAvatar);
    if (avatar) return avatar.slice(0, 2).toUpperCase();
    const name = normalizeString(authorName);
    if (!name) return 'I';
    return name.charAt(0).toUpperCase();
};

const mapBlogSummary = (item) => {
    if (!item) return null;
    return {
        id: String(item._id),
        _id: String(item._id),
        slug: item.blog_slug,
        title: item.blog_title,
        excerpt: item.blog_excerpt,
        image: item.blog_image,
        imageVariants: item.blog_image_variants || null,
        categoryKey: item.blog_category_key,
        author: item.blog_author_name || 'Inoxpran',
        authorAvatar: item.blog_author_avatar || buildAuthorAvatar({ authorName: item.blog_author_name }),
        date: formatDate(item.publishedAt || item.createdAt),
        readTimeMinutes: Math.max(1, Number(item.blog_read_time_minutes) || 1),
        views: Math.max(0, Number(item.blog_views) || 0),
        comments: Math.max(0, Number(item.blog_comments_count) || 0),
        tags: Array.isArray(item.blog_tags) ? item.blog_tags : [],
        seoTitle: item.blog_seo_title || '',
        seoDescription: item.blog_seo_description || '',
        isPublished: Boolean(item.isPublished),
        isDraft: Boolean(item.isDraft),
        createdAt: item.createdAt,
        updatedAt: item.updatedAt
    };
};

const mapBlogDetail = (item, relatedPosts = []) => {
    const summary = mapBlogSummary(item);
    if (!summary) return null;
    return {
        ...summary,
        content: item.blog_content || '',
        relatedPosts: relatedPosts.map((post) => mapBlogSummary(post)).filter(Boolean)
    };
};

const resolveSortOption = (sort = 'published') => {
    switch (sort) {
        case 'created':
            return { createdAt: -1 };
        case 'updated':
            return { updatedAt: -1 };
        case 'views':
            return { blog_views: -1, publishedAt: -1 };
        case 'title':
            return { blog_title: 1 };
        case 'published':
        default:
            return { publishedAt: -1, createdAt: -1 };
    }
};

class BlogService {
    static ensureValidCategory(category) {
        if (!BLOG_CATEGORY_KEYS.includes(category)) {
            throw new BadRequestError('Invalid blog category');
        }
    }

    static async ensureUniqueSlug(rawSlug, { excludeId } = {}) {
        const base = buildSlug(rawSlug);
        let candidate = base;
        let index = 1;

        while (true) {
            const query = { blog_slug: candidate };
            if (excludeId) {
                query._id = { $ne: excludeId };
            }
            const existing = await blog.findOne(query).select('_id').lean();
            if (!existing) return candidate;
            index += 1;
            candidate = withSlugSuffix(base, String(index));
        }
    }

    static normalizePayload(payload = {}, { isUpdate = false } = {}) {
        const normalized = {};

        if (!isUpdate || Object.prototype.hasOwnProperty.call(payload, 'blog_title')) {
            normalized.blog_title = normalizeString(payload.blog_title);
        }
        if (!isUpdate || Object.prototype.hasOwnProperty.call(payload, 'blog_excerpt')) {
            normalized.blog_excerpt = normalizeString(payload.blog_excerpt);
        }
        if (!isUpdate || Object.prototype.hasOwnProperty.call(payload, 'blog_content')) {
            normalized.blog_content = sanitizeBlogContent(payload.blog_content);
        }
        if (!isUpdate || Object.prototype.hasOwnProperty.call(payload, 'blog_image')) {
            normalized.blog_image = normalizeString(payload.blog_image);
        }
        if (!isUpdate || Object.prototype.hasOwnProperty.call(payload, 'blog_image_path')) {
            normalized.blog_image_path = normalizeString(payload.blog_image_path);
        }
        if (!isUpdate || Object.prototype.hasOwnProperty.call(payload, 'blog_image_variants')) {
            normalized.blog_image_variants = normalizeImageVariants(payload.blog_image_variants);
        }
        if (!isUpdate || Object.prototype.hasOwnProperty.call(payload, 'blog_image_crop_state')) {
            normalized.blog_image_crop_state = normalizeCropState(payload.blog_image_crop_state);
        }
        if (!isUpdate || Object.prototype.hasOwnProperty.call(payload, 'blog_category_key')) {
            normalized.blog_category_key = normalizeString(payload.blog_category_key || 'guide');
        }
        if (!isUpdate || Object.prototype.hasOwnProperty.call(payload, 'blog_tags')) {
            normalized.blog_tags = dedupeStrings(parseStringArray(payload.blog_tags)).slice(0, 20);
        }
        if (!isUpdate || Object.prototype.hasOwnProperty.call(payload, 'blog_author_name')) {
            normalized.blog_author_name = normalizeString(payload.blog_author_name);
        }
        if (!isUpdate || Object.prototype.hasOwnProperty.call(payload, 'blog_author_avatar')) {
            normalized.blog_author_avatar = normalizeString(payload.blog_author_avatar);
        }
        if (!isUpdate || Object.prototype.hasOwnProperty.call(payload, 'blog_seo_title')) {
            normalized.blog_seo_title = normalizeString(payload.blog_seo_title);
        }
        if (!isUpdate || Object.prototype.hasOwnProperty.call(payload, 'blog_seo_description')) {
            normalized.blog_seo_description = normalizeString(payload.blog_seo_description);
        }

        if (!isUpdate || Object.prototype.hasOwnProperty.call(payload, 'blog_related_post_ids')) {
            normalized.blog_related_post_ids = parseObjectIdArray(payload.blog_related_post_ids);
        }

        if (!isUpdate || Object.prototype.hasOwnProperty.call(payload, 'blog_read_time_minutes')) {
            normalized.blog_read_time_minutes = parseNumber(payload.blog_read_time_minutes);
        }
        if (!isUpdate || Object.prototype.hasOwnProperty.call(payload, 'blog_views')) {
            normalized.blog_views = parseNumber(payload.blog_views);
        }
        if (!isUpdate || Object.prototype.hasOwnProperty.call(payload, 'blog_comments_count')) {
            normalized.blog_comments_count = parseNumber(payload.blog_comments_count);
        }

        if (!isUpdate || Object.prototype.hasOwnProperty.call(payload, 'blog_slug')) {
            normalized.blog_slug = normalizeString(payload.blog_slug);
        }

        const statusValue = normalizeString(payload.status).toLowerCase();
        if (statusValue) {
            normalized.isPublished = statusValue === 'published';
            normalized.isDraft = statusValue !== 'published';
        } else if (!isUpdate || Object.prototype.hasOwnProperty.call(payload, 'isPublished')) {
            const isPublished = parseBoolean(payload.isPublished, false);
            normalized.isPublished = isPublished;
            normalized.isDraft = !isPublished;
        }

        const publishedAt = parseDate(payload.publishedAt || payload.blog_date || payload.date);
        if (publishedAt) {
            normalized.publishedAt = publishedAt;
        }

        return normalized;
    }

    static validateCreatePayload(payload) {
        if (!payload.blog_title) throw new BadRequestError('blog_title is required');
        if (!payload.blog_excerpt) throw new BadRequestError('blog_excerpt is required');
        if (!payload.blog_content) throw new BadRequestError('blog_content is required');
        if (!payload.blog_image) throw new BadRequestError('blog_image is required');
        BlogService.ensureValidCategory(payload.blog_category_key || 'guide');
    }

    static async createBlog({ payload = {}, shopId, sendNewsletter = false }) {
        const normalized = BlogService.normalizePayload(payload);
        BlogService.validateCreatePayload(normalized);

        normalized.blog_slug = await BlogService.ensureUniqueSlug(
            normalized.blog_slug || normalized.blog_title
        );
        normalized.blog_author_name = normalized.blog_author_name || 'Inoxpran';
        normalized.blog_author_avatar = buildAuthorAvatar({
            authorName: normalized.blog_author_name,
            authorAvatar: normalized.blog_author_avatar
        });
        normalized.blog_shop = normalizeString(shopId);
        normalized.blog_views = Math.max(0, parseNumber(normalized.blog_views, 0));
        normalized.blog_comments_count = Math.max(0, parseNumber(normalized.blog_comments_count, 0));
        normalized.blog_read_time_minutes = Math.max(
            1,
            parseNumber(normalized.blog_read_time_minutes, estimateReadTimeMinutes(normalized.blog_content))
        );

        if (normalized.isPublished) {
            normalized.isDraft = false;
            if (!normalized.publishedAt) normalized.publishedAt = new Date();
        } else {
            normalized.isDraft = true;
            normalized.isPublished = false;
            normalized.publishedAt = null;
        }

        const created = await blog.create(normalized);
        const summary = mapBlogSummary(created);

        if (summary?.isPublished) {
            await safeSendNewsletter({ blogSummary: summary, sendNewsletter });
        }

        return mapBlogDetail(created.toObject(), []);
    }

    static async updateBlog({ blogId, payload = {}, sendNewsletter = false }) {
        const objectId = convertToObjectIdMongodb(blogId);
        if (!objectId) throw new BadRequestError('Invalid blog id');

        const current = await blog.findById(objectId).lean();
        if (!current) throw new NotFoundError('Blog not found');
        const wasPublished = Boolean(current.isPublished);

        const normalized = BlogService.normalizePayload(payload, { isUpdate: true });
        if (
            normalized.blog_category_key &&
            Object.prototype.hasOwnProperty.call(normalized, 'blog_category_key')
        ) {
            BlogService.ensureValidCategory(normalized.blog_category_key);
        }

        const updateDoc = {};
        Object.keys(normalized).forEach((key) => {
            if (normalized[key] !== undefined) {
                updateDoc[key] = normalized[key];
            }
        });

        if (
            Object.prototype.hasOwnProperty.call(updateDoc, 'blog_title') &&
            !updateDoc.blog_title
        ) {
            throw new BadRequestError('blog_title cannot be empty');
        }

        if (
            Object.prototype.hasOwnProperty.call(updateDoc, 'blog_excerpt') &&
            !updateDoc.blog_excerpt
        ) {
            throw new BadRequestError('blog_excerpt cannot be empty');
        }

        if (
            Object.prototype.hasOwnProperty.call(updateDoc, 'blog_content') &&
            !updateDoc.blog_content
        ) {
            throw new BadRequestError('blog_content cannot be empty');
        }

        if (
            Object.prototype.hasOwnProperty.call(updateDoc, 'blog_image') &&
            !updateDoc.blog_image
        ) {
            throw new BadRequestError('blog_image cannot be empty');
        }

        if (
            Object.prototype.hasOwnProperty.call(updateDoc, 'blog_slug') ||
            Object.prototype.hasOwnProperty.call(updateDoc, 'blog_title')
        ) {
            const slugSource = updateDoc.blog_slug || updateDoc.blog_title || current.blog_slug;
            updateDoc.blog_slug = await BlogService.ensureUniqueSlug(slugSource, { excludeId: objectId });
        }

        if (
            Object.prototype.hasOwnProperty.call(updateDoc, 'blog_content') &&
            !Object.prototype.hasOwnProperty.call(updateDoc, 'blog_read_time_minutes')
        ) {
            updateDoc.blog_read_time_minutes = estimateReadTimeMinutes(updateDoc.blog_content);
        }

        if (Object.prototype.hasOwnProperty.call(updateDoc, 'blog_read_time_minutes')) {
            updateDoc.blog_read_time_minutes = Math.max(
                1,
                parseNumber(updateDoc.blog_read_time_minutes, 1)
            );
        }

        if (Object.prototype.hasOwnProperty.call(updateDoc, 'blog_views')) {
            updateDoc.blog_views = Math.max(0, parseNumber(updateDoc.blog_views, 0));
        }

        if (Object.prototype.hasOwnProperty.call(updateDoc, 'blog_comments_count')) {
            updateDoc.blog_comments_count = Math.max(0, parseNumber(updateDoc.blog_comments_count, 0));
        }

        if (Array.isArray(updateDoc.blog_related_post_ids)) {
            updateDoc.blog_related_post_ids = updateDoc.blog_related_post_ids.filter(
                (id) => String(id) !== String(objectId)
            );
        }

        if (Object.prototype.hasOwnProperty.call(updateDoc, 'isPublished')) {
            if (updateDoc.isPublished) {
                updateDoc.isDraft = false;
                if (!updateDoc.publishedAt) {
                    updateDoc.publishedAt = current.publishedAt || new Date();
                }
            } else {
                updateDoc.isDraft = true;
                updateDoc.publishedAt = null;
            }
        }

        if (Object.prototype.hasOwnProperty.call(updateDoc, 'blog_author_name')) {
            const authorName = updateDoc.blog_author_name || current.blog_author_name;
            updateDoc.blog_author_avatar = buildAuthorAvatar({
                authorName,
                authorAvatar: updateDoc.blog_author_avatar || current.blog_author_avatar
            });
        } else if (Object.prototype.hasOwnProperty.call(updateDoc, 'blog_author_avatar')) {
            const authorName = current.blog_author_name;
            updateDoc.blog_author_avatar = buildAuthorAvatar({
                authorName,
                authorAvatar: updateDoc.blog_author_avatar
            });
        }

        const updated = await blog.findByIdAndUpdate(objectId, updateDoc, { new: true }).lean();
        if (!updated) throw new NotFoundError('Blog not found');

        if (sendNewsletter && !wasPublished && updated.isPublished) {
            const summary = mapBlogSummary(updated);
            await safeSendNewsletter({ blogSummary: summary, sendNewsletter });
        }

        const hasNewImage =
            Object.prototype.hasOwnProperty.call(updateDoc, 'blog_image') &&
            updateDoc.blog_image &&
            updateDoc.blog_image !== current.blog_image;
        const hasContentUpdate = Object.prototype.hasOwnProperty.call(updateDoc, 'blog_content');
        const updatedReferenceKeys = collectBlogMediaReferenceKeys(updated);

        if (
            hasNewImage &&
            !isBlogMediaReferenced(
                { path: current.blog_image_path, url: current.blog_image },
                updatedReferenceKeys
            )
        ) {
            try {
                await deleteImageFromStorage({
                    path: current.blog_image_path,
                    url: current.blog_image
                });
                await deleteImageVariantsFromStorage(current.blog_image_variants);
            } catch (error) {
                console.error('Failed to delete old blog image', {
                    blogId,
                    error: error?.message || 'delete-image-failed'
                });
            }
        }
        if (hasContentUpdate && current.blog_content) {
            await deleteRemovedHtmlImagesFromStorage({
                previousHtml: current.blog_content,
                nextHtml: updated.blog_content,
                protectedKeys: updatedReferenceKeys,
                context: {
                    entity: 'blog',
                    blogId
                }
            });
        }

        return mapBlogDetail(updated, []);
    }

    static async deleteBlog({ blogId }) {
        const objectId = convertToObjectIdMongodb(blogId);
        if (!objectId) throw new BadRequestError('Invalid blog id');

        const found = await blog.findById(objectId).lean();
        if (!found) throw new NotFoundError('Blog not found');

        await blog.updateMany(
            { blog_related_post_ids: objectId },
            { $pull: { blog_related_post_ids: objectId } }
        );
        await blog.deleteOne({ _id: objectId });

        try {
            await deleteImageFromStorage({
                path: found.blog_image_path,
                url: found.blog_image
            });
            await deleteImageVariantsFromStorage(found.blog_image_variants);
        } catch (error) {
            console.error('Failed to delete blog image', {
                blogId,
                error: error?.message || 'delete-image-failed'
            });
        }
        await deleteHtmlImagesFromStorage(found.blog_content, {
            context: {
                entity: 'blog',
                blogId
            }
        });

        return true;
    }

    static async publishBlog({ blogId, sendNewsletter = false }) {
        const objectId = convertToObjectIdMongodb(blogId);
        if (!objectId) throw new BadRequestError('Invalid blog id');

        const updated = await blog
            .findByIdAndUpdate(
                objectId,
                {
                    $set: {
                        isPublished: true,
                        isDraft: false,
                        publishedAt: new Date()
                    }
                },
                { new: true }
            )
            .lean();

        if (!updated) throw new NotFoundError('Blog not found');
        const summary = mapBlogSummary(updated);
        await safeSendNewsletter({ blogSummary: summary, sendNewsletter });
        return summary;
    }

    static async unPublishBlog({ blogId }) {
        const objectId = convertToObjectIdMongodb(blogId);
        if (!objectId) throw new BadRequestError('Invalid blog id');

        const updated = await blog
            .findByIdAndUpdate(
                objectId,
                {
                    $set: {
                        isPublished: false,
                        isDraft: true
                    },
                    $unset: {
                        publishedAt: 1
                    }
                },
                { new: true }
            )
            .lean();

        if (!updated) throw new NotFoundError('Blog not found');
        return mapBlogSummary(updated);
    }

    static async listBlogsForAdmin({
        limit = 20,
        page = 1,
        status = 'all',
        sort = 'updated',
        category,
        q
    } = {}) {
        const safeLimit = Math.min(Math.max(parseNumber(limit, 20), 1), MAX_LIMIT);
        const safePage = Math.max(parseNumber(page, 1), 1);
        const skip = (safePage - 1) * safeLimit;
        const filter = {};

        if (status === 'published') {
            filter.isPublished = true;
        } else if (status === 'draft') {
            filter.isDraft = true;
        }

        if (category && BLOG_CATEGORY_KEYS.includes(category)) {
            filter.blog_category_key = category;
        }

        const searchText = normalizeString(q);
        if (searchText) {
            filter.$or = [
                { blog_title: { $regex: searchText, $options: 'i' } },
                { blog_excerpt: { $regex: searchText, $options: 'i' } }
            ];
        }

        const [items, total] = await Promise.all([
            blog
                .find(filter)
                .sort(resolveSortOption(sort))
                .skip(skip)
                .limit(safeLimit)
                .lean(),
            blog.countDocuments(filter)
        ]);

        return {
            items: items.map((item) => mapBlogSummary(item)).filter(Boolean),
            total,
            page: safePage,
            limit: safeLimit
        };
    }

    static async getBlogForAdmin({ blogId }) {
        const objectId = convertToObjectIdMongodb(blogId);
        if (!objectId) throw new BadRequestError('Invalid blog id');

        const found = await blog.findById(objectId).lean();
        if (!found) throw new NotFoundError('Blog not found');

        const relatedIds = Array.isArray(found.blog_related_post_ids)
            ? found.blog_related_post_ids
            : [];
        const relatedPosts = relatedIds.length
            ? await blog
                .find({ _id: { $in: relatedIds } })
                .select(
                    'blog_slug blog_title blog_excerpt blog_image blog_category_key blog_author_name blog_author_avatar publishedAt createdAt blog_read_time_minutes blog_views blog_comments_count blog_tags isDraft isPublished'
                )
                .lean()
            : [];

        return {
            ...mapBlogDetail(found, relatedPosts),
            imagePath: found.blog_image_path || '',
            imageVariants: found.blog_image_variants || null,
            blog_image_crop_state: found.blog_image_crop_state || null,
            seoTitle: found.blog_seo_title || '',
            seoDescription: found.blog_seo_description || '',
            relatedPostIds: relatedIds.map((id) => String(id))
        };
    }

    static async listBlogsPublic({
        limit = 50,
        page = 1,
        category,
        tag,
        q,
        sort = 'published'
    } = {}) {
        const safeLimit = Math.min(Math.max(parseNumber(limit, 50), 1), MAX_LIMIT);
        const safePage = Math.max(parseNumber(page, 1), 1);
        const skip = (safePage - 1) * safeLimit;

        const filter = { isPublished: true };
        if (category && BLOG_CATEGORY_KEYS.includes(category)) {
            filter.blog_category_key = category;
        }
        if (tag) {
            filter.blog_tags = { $in: [normalizeString(tag)] };
        }
        const searchText = normalizeString(q);
        if (searchText) {
            filter.$or = [
                { blog_title: { $regex: searchText, $options: 'i' } },
                { blog_excerpt: { $regex: searchText, $options: 'i' } }
            ];
        }

        const [items, total] = await Promise.all([
            blog
                .find(filter)
                .sort(resolveSortOption(sort))
                .skip(skip)
                .limit(safeLimit)
                .lean(),
            blog.countDocuments(filter)
        ]);

        return {
            items: items.map((item) => mapBlogSummary(item)).filter(Boolean),
            total,
            page: safePage,
            limit: safeLimit,
            categories: BLOG_CATEGORY_KEYS
        };
    }

    static async getBlogBySlug({ slug }) {
        const normalizedSlug = normalizeString(slug);
        if (!normalizedSlug) throw new BadRequestError('blog slug is required');

        const objectId = convertToObjectIdMongodb(normalizedSlug);
        const filter = objectId
            ? {
                isPublished: true,
                $or: [{ _id: objectId }, { blog_slug: normalizedSlug }]
            }
            : {
                isPublished: true,
                blog_slug: normalizedSlug
            };

        const found = await blog.findOne(filter).lean();
        if (!found) throw new NotFoundError('Blog not found');

        const relatedIdSet = new Set(
            (found.blog_related_post_ids || []).map((id) => String(id)).filter(Boolean)
        );
        const relatedIds = Array.from(relatedIdSet)
            .map((id) => convertToObjectIdMongodb(id))
            .filter(Boolean);

        let relatedPosts = [];
        if (relatedIds.length) {
            const predefined = await blog
                .find({
                    _id: { $in: relatedIds },
                    isPublished: true
                })
                .lean();

            const byId = new Map(predefined.map((item) => [String(item._id), item]));
            relatedPosts = relatedIds
                .map((id) => byId.get(String(id)))
                .filter(Boolean);
        }

        if (relatedPosts.length < DEFAULT_RELATED_LIMIT) {
            const excludeIds = [found._id, ...relatedPosts.map((item) => item._id)];
            const fallback = await blog
                .find({
                    isPublished: true,
                    blog_category_key: found.blog_category_key,
                    _id: { $nin: excludeIds }
                })
                .sort({ publishedAt: -1, createdAt: -1 })
                .limit(DEFAULT_RELATED_LIMIT - relatedPosts.length)
                .lean();
            relatedPosts = [...relatedPosts, ...fallback];
        }

        blog
            .updateOne({ _id: found._id }, { $inc: { blog_views: 1 } })
            .catch(() => null);

        return mapBlogDetail(
            {
                ...found,
                blog_views: (found.blog_views || 0) + 1
            },
            relatedPosts.slice(0, DEFAULT_RELATED_LIMIT)
        );
    }
}

module.exports = BlogService;
