'use strict'

const { product } = require('../../models/product.model');
const { countWords, normalizeString } = require('../../utils/seoBlogSanitizer');

// Inoxpran model codes as the writer emits them: INP6002, INP 6002, inp2111-30cm.
const PRODUCT_CODE_PATTERN = /\bINP\s?(\d{4})\b/gi;
const OBJECT_ID = /^[a-f0-9]{24}$/i;

const escapeHtml = (value) =>
    String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const readNumber = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const parseBoolean = (value, fallback = false) => {
    if (typeof value === 'boolean') return value;
    if (typeof value !== 'string') return fallback;
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

// Codes inside markup (attributes, existing blocks) are not prose mentions, so
// only the reader-visible text is searched.
const visibleText = (html) => String(html || '').replace(/<[^>]*>/g, ' ');

const findMentionedCodes = (html) => {
    const seen = [];
    for (const match of visibleText(html).matchAll(PRODUCT_CODE_PATTERN)) {
        const code = `INP${match[1]}`.toUpperCase();
        if (!seen.includes(code)) seen.push(code);
    }
    return seen;
};

const alreadyPlacedProductIds = (html) =>
    new Set(
        [...String(html || '').matchAll(/data-product-id="([a-f0-9]{24})"/gi)]
            .map((match) => match[1].toLowerCase())
    );

const resolveProductByCode = async (code, model = product) => {
    const pattern = new RegExp(code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const found = await model
        .findOne({ $or: [{ product_slug: pattern }, { product_name: pattern }] })
        .select('_id product_name product_slug product_thumb product_price')
        .lean();
    if (!found || !normalizeString(found.product_thumb)) return null;
    return found;
};

const formatPrice = (value) => {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) return '';
    // Non-breaking space keeps the amount from wrapping away from its currency mark.
    return `${amount.toLocaleString('vi-VN')} đ`;
};

// Mirrors the markup the planned placements already emit, so the existing review
// and metrics count this block instead of treating it as stray content.
const buildMentionBlock = ({ item, code, siteUrl, disclosureText }) => {
    const productId = String(item._id);
    const url = `${siteUrl}/product/${item.product_slug}`;
    const price = formatPrice(item.product_price);
    const disclosure = disclosureText
        ? `<aside data-disclosure-type="owned-product">${escapeHtml(disclosureText)}</aside>`
        : '';
    const attributes = [
        'data-block-type="product-recommendation"',
        `data-product-id="${productId}"`,
        `data-placement-id="mention-${code.toLowerCase()}"`,
        'data-section-key="product-mention"',
        'data-commercial-role="owned-product"',
        'data-rank-position="none"'
    ].join(' ');
    return [
        disclosure,
        `<section ${attributes}>`,
        `<h3>${escapeHtml(item.product_name)}</h3>`,
        `<figure data-image-role="product" data-product-id="${productId}">`,
        `<img src="${escapeHtml(item.product_thumb)}" alt="${escapeHtml(item.product_name)}"`,
        ' loading="lazy" decoding="async"',
        ` data-image-role="product" data-product-id="${productId}" />`,
        `<figcaption>${escapeHtml(item.product_name)}${price ? ` — ${price}` : ''}</figcaption>`,
        '</figure>',
        `<p>Bài viết có nhắc tới <strong>${escapeHtml(code)}</strong>. Đây là sản phẩm tương ứng đang bán tại INOXPRAN để bạn đối chiếu đúng mẫu; mức độ phù hợp tùy nhu cầu thực tế.</p>`,
        `<a href="${escapeHtml(url)}" data-link-type="product">Xem thông tin sản phẩm</a>`,
        '</section>'
    ].join('');
};

// Candidate insertion points are the h2 boundaries, so a block never lands inside
// a paragraph, and never before the article has earned its own value.
const insertionCandidates = (html) => {
    const source = String(html || '');
    const headings = [...source.matchAll(/<h2\b[^>]*>/gi)];
    const closeArticle = source.toLowerCase().lastIndexOf('</article>');
    const end = closeArticle >= 0 ? closeArticle : source.length;
    return [
        ...headings.slice(1).map((match, index) => ({ index: match.index, completedSections: index + 1 })),
        { index: end, completedSections: headings.length }
    ];
};

const resolveInsertionPoint = ({ html, requireEditorialImageBefore }) => {
    const source = String(html || '');
    const totalWords = Math.max(1, countWords(source));
    const minimumSections = readNumber(process.env.PRODUCT_PLACEMENT_MIN_SECTIONS_BEFORE_PRODUCT, 2);
    const minimumWords = readNumber(process.env.PRODUCT_PLACEMENT_MIN_WORDS_BEFORE_PRODUCT, 350);
    const minimumProgress = readNumber(process.env.PRODUCT_PLACEMENT_MIN_PROGRESS_PERCENT, 35);

    return insertionCandidates(source).find((candidate) => {
        const before = source.slice(0, candidate.index);
        const beforeWords = countWords(before);
        const progressPercent = Math.round((beforeWords / totalWords) * 100);
        if (candidate.completedSections < minimumSections) return false;
        if (beforeWords < minimumWords) return false;
        if (progressPercent < minimumProgress) return false;
        // House rule: a product shot must never be the first image a reader meets.
        if (requireEditorialImageBefore && !/<figure\b/i.test(before)) return false;
        return true;
    }) || null;
};

/**
 * Looks up the first Inoxpran model the article names in prose. Resolution is
 * separate from insertion because the cover poster needs the product image before
 * the image pipeline runs, while the block itself can only be placed afterwards.
 */
const resolveMentionedProduct = async ({ html, productModel = product } = {}) => {
    const source = String(html || '');
    if (!parseBoolean(process.env.PRODUCT_MENTION_IMAGE_ENABLED, true)) {
        return { found: false, reason: 'product_mention_image_disabled' };
    }

    const codes = findMentionedCodes(source);
    if (!codes.length) return { found: false, reason: 'no_product_mention' };

    for (const code of codes) {
        const item = await resolveProductByCode(code, productModel);
        if (!item || !OBJECT_ID.test(String(item._id))) continue;
        return {
            found: true,
            reason: '',
            code,
            item,
            productId: String(item._id),
            productName: item.product_name,
            productImageUrl: normalizeString(item.product_thumb)
        };
    }

    return { found: false, reason: 'mentioned_product_not_in_catalog', code: codes[0] };
};

/**
 * Places the resolved product where the reader can finally see what the article is
 * talking about. Runs after the image pipeline, because the rule that a product
 * shot must never be the first image can only be judged once the editorial images
 * are actually in the article.
 */
const enrichProductMentions = async ({
    html,
    resolved = null,
    disclosureText = '',
    siteUrl = normalizeString(process.env.PUBLIC_SITE_URL || 'https://inoxpran.com').replace(/\/+$/, ''),
    productModel = product
} = {}) => {
    const source = String(html || '');
    const mention = resolved || (await resolveMentionedProduct({ html: source, productModel }));
    if (!mention.found) {
        return { html: source, applied: false, reason: mention.reason, code: mention.code || '' };
    }

    // The planned placement already covers this product; a second block would read
    // as an advert rather than a reference.
    if (alreadyPlacedProductIds(source).has(mention.productId.toLowerCase())) {
        return { html: source, applied: false, reason: 'product_already_placed', code: mention.code };
    }

    const requireEditorialImageBefore = !parseBoolean(
        process.env.PRODUCT_PLACEMENT_ALLOW_PRODUCT_IMAGE_FIRST,
        false
    );
    const point = resolveInsertionPoint({ html: source, requireEditorialImageBefore });
    if (!point) {
        return { html: source, applied: false, reason: 'no_eligible_insertion_point', code: mention.code };
    }

    const block = buildMentionBlock({
        item: mention.item,
        code: mention.code,
        siteUrl,
        disclosureText
    });
    return {
        html: `${source.slice(0, point.index)}${block}${source.slice(point.index)}`,
        applied: true,
        reason: '',
        code: mention.code,
        productId: mention.productId,
        productName: mention.productName,
        productImageUrl: mention.productImageUrl
    };
};

module.exports = {
    buildMentionBlock,
    enrichProductMentions,
    findMentionedCodes,
    resolveInsertionPoint,
    resolveMentionedProduct
};
