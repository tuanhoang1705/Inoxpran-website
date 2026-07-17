'use strict'

const sanitizeHtml = require('sanitize-html');
const slugify = require('slugify');

const MAX_SLUG_LENGTH = Number(process.env.BLOG_SLUG_MAX_LENGTH || 80);

const TRUSTED_IMAGE_HOSTS = new Set([
    'inoxpran.com',
    'www.inoxpran.com',
    'res.cloudinary.com',
    'firebasestorage.googleapis.com',
    'storage.googleapis.com'
]);

const normalizeString = (value) => {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number') return String(value).trim();
    return '';
};

const escapeHtmlAttribute = (value) =>
    String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

const isInternalUrl = (value) => {
    const normalized = normalizeString(value);
    if (!normalized) return false;
    return normalized.startsWith('/') && !normalized.startsWith('//');
};

const isInoxpranUrl = (value) => {
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'https:' && ['inoxpran.com', 'www.inoxpran.com'].includes(parsed.hostname);
    } catch {
        return false;
    }
};

const isAllowedLink = (value) => isInternalUrl(value) || isInoxpranUrl(value);

const isAllowedImage = (value) => {
    const normalized = normalizeString(value);
    if (!normalized) return false;
    if (isInternalUrl(normalized)) return true;

    try {
        const parsed = new URL(normalized);
        if (parsed.protocol !== 'https:') return false;
        return TRUSTED_IMAGE_HOSTS.has(parsed.hostname);
    } catch {
        return false;
    }
};

const sanitizeSeoBlogHtml = (value) => {
    const input = typeof value === 'string' ? value : '';

    return sanitizeHtml(input, {
        allowedTags: [
            'p',
            'br',
            'h2',
            'h3',
            'h4',
            'h5',
            'h6',
            'ul',
            'ol',
            'li',
            'strong',
            'em',
            'u',
            's',
            'a',
            'blockquote',
            'pre',
            'code',
            'hr',
            'table',
            'thead',
            'tbody',
            'tr',
            'th',
            'td',
            'img',
            'figure',
            'figcaption',
            'section',
            'div'
        ],
        allowedAttributes: {
            a: ['href', 'title', 'data-link-type'],
            img: ['src', 'alt', 'title', 'width', 'height', 'loading', 'decoding', 'data-image-id', 'data-source-type', 'data-review-status'],
            figure: ['data-image-id', 'data-source-type', 'data-review-status'],
            figcaption: [],
            ul: ['data-type'],
            li: ['data-type', 'data-checked'],
            th: ['colspan', 'rowspan'],
            td: ['colspan', 'rowspan'],
            div: [],
            section: ['data-block-type', 'data-product-id']
        },
        allowedSchemes: ['http', 'https'],
        allowProtocolRelative: false,
        transformTags: {
            a: (tagName, attribs) => {
                const href = normalizeString(attribs.href);
                if (!isAllowedLink(href)) {
                    return { tagName: 'span', attribs: {} };
                }
                return {
                    tagName,
                    attribs: {
                        href,
                        ...(attribs.title ? { title: escapeHtmlAttribute(attribs.title) } : {}),
                        ...(attribs['data-link-type'] === 'product' ? { 'data-link-type': 'product' } : {})
                    }
                };
            },
            section: (tagName, attribs) => {
                const isProductBlock = attribs['data-block-type'] === 'product-recommendation';
                const productId = normalizeString(attribs['data-product-id']);
                if (!isProductBlock) return { tagName, attribs: {} };
                if (!/^[a-f0-9]{24}$/i.test(productId)) return { tagName, attribs: {} };
                return { tagName, attribs: { 'data-block-type': 'product-recommendation', 'data-product-id': productId } };
            },
            img: (tagName, attribs) => {
                const src = normalizeString(attribs.src);
                if (!isAllowedImage(src)) {
                    return { tagName: 'span', attribs: {} };
                }
                return {
                    tagName,
                    attribs: {
                        src,
                        ...(attribs.alt ? { alt: escapeHtmlAttribute(attribs.alt) } : {}),
                        ...(attribs.title ? { title: escapeHtmlAttribute(attribs.title) } : {}),
                        ...(/^\d{1,5}$/.test(attribs.width || '') ? { width: attribs.width } : {}),
                        ...(/^\d{1,5}$/.test(attribs.height || '') ? { height: attribs.height } : {}),
                        ...(attribs.loading === 'lazy' ? { loading: 'lazy' } : {}),
                        ...(attribs.decoding === 'async' ? { decoding: 'async' } : {}),
                        ...(/^[a-z0-9][a-z0-9_-]{0,80}$/i.test(attribs['data-image-id'] || '')
                            ? { 'data-image-id': attribs['data-image-id'] }
                            : {}),
                        ...(/^[a-z0-9_-]{1,40}$/i.test(attribs['data-source-type'] || '')
                            ? { 'data-source-type': attribs['data-source-type'] }
                            : {}),
                        ...(/^(pending_review|approved|rejected|replaced)$/.test(
                            attribs['data-review-status'] || ''
                        )
                            ? { 'data-review-status': attribs['data-review-status'] }
                            : {})
                    }
                };
            }
        }
    });
};

const stripHtml = (value) =>
    sanitizeHtml(value || '', {
        allowedTags: [],
        allowedAttributes: {}
    })
        .replace(/\s+/g, ' ')
        .trim();

const countWords = (value) => {
    const text = stripHtml(value);
    if (!text) return 0;
    return text.split(/\s+/).filter(Boolean).length;
};

const normalizeSlug = (value) => {
    const normalized = slugify(
        String(value || '').replace(/[\u0111\u0110]/g, (char) => (char === '\u0111' ? 'd' : 'D')),
        {
            lower: true,
            strict: true,
            locale: 'vi',
            trim: true
        }
    );

    return String(normalized || '')
        .slice(0, MAX_SLUG_LENGTH)
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');
};

const normalizeStringArray = (value, maxItems = 20) => {
    const source = Array.isArray(value)
        ? value
        : typeof value === 'string'
            ? value.split(',')
            : [];
    const seen = new Set();
    const result = [];

    source.forEach((item) => {
        const normalized = normalizeString(item);
        if (!normalized) return;
        const key = normalized.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        result.push(normalized);
    });

    return result.slice(0, maxItems);
};

module.exports = {
    countWords,
    isAllowedImage,
    isAllowedLink,
    normalizeSlug,
    normalizeString,
    normalizeStringArray,
    sanitizeSeoBlogHtml,
    stripHtml
};
