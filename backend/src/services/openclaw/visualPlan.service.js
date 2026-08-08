'use strict'

const { countWords, normalizeString, stripHtml } = require('../../utils/seoBlogSanitizer');

const ARTICLE_TYPES = new Set([
    'how_to',
    'listicle',
    'buying_guide',
    'comparison',
    'product_care'
]);

const TYPE_RULES = Object.freeze({
    how_to: 'Show the problem, a practical cleaning step, and a credible final result.',
    listicle: 'Use an editorial lifestyle group composition without invented product models.',
    buying_guide: 'Show a realistic product group or comparison in a lived-in Vietnamese kitchen.',
    comparison: 'Use a neutral side-by-side comparison without labels, badges, or technical claims.',
    product_care: 'Use realistic close-ups connected to maintenance, stains, tools, and safe handling.'
});

const detectArticleType = ({ title, category, articleType } = {}) => {
    const explicit = normalizeString(articleType).toLowerCase();
    if (ARTICLE_TYPES.has(explicit)) return explicit;

    const source = `${normalizeString(title)} ${normalizeString(category)}`.toLocaleLowerCase('vi');
    if (/\b(top|danh sach|danh sách|\d+\s+(cach|cách|meo|mẹo|thiet bi|thiết bị))\b/.test(source)) {
        return 'listicle';
    }
    if (/(so sanh|so sánh|khac nhau|khác nhau|\bvs\b)/.test(source)) return 'comparison';
    if (/(chon mua|chọn mua|huong dan chon|hướng dẫn chọn|kinh nghiem mua|kinh nghiệm mua)/.test(source)) {
        return 'buying_guide';
    }
    if (/(ve sinh|vệ sinh|bao quan|bảo quản|bao tri|bảo trì|chay|cháy|o vang|ố vàng|can trang|cặn trắng|bi dinh|bị dính)/.test(source)) {
        return 'product_care';
    }
    if (/(cach |cách |huong dan|hướng dẫn|lam sao|làm sao)/.test(source)) return 'how_to';
    return 'how_to';
};

const extractHeadings = (contentHtml, outline = []) => {
    const fromContent = [...String(contentHtml || '').matchAll(/<h([23])\b[^>]*>([\s\S]*?)<\/h\1>/gi)]
        .map((match, index) => ({
            level: Number(match[1]),
            text: stripHtml(match[2]),
            headingIndex: index
        }))
        .filter((item) => item.text);
    if (fromContent.length) return fromContent;

    return (Array.isArray(outline) ? outline : [])
        .map((item) => typeof item === 'string' ? item : item?.title || item?.heading)
        .map((item) => normalizeString(item))
        .filter(Boolean)
        .map((text, index) => ({ level: 2, text, headingIndex: index }));
};

const selectHeadings = (headings, count) => {
    const meaningful = headings.filter(
        (item) => !/(ket luan|kết luận|cau hoi|câu hỏi|faq|tom tat|tóm tắt)/i.test(item.text)
    );
    const pool = meaningful.length ? meaningful : headings;
    if (pool.length <= count) return pool;

    const selected = [];
    for (let index = 0; index < count; index += 1) {
        const poolIndex = Math.round((index * (pool.length - 1)) / Math.max(1, count - 1));
        if (!selected.includes(pool[poolIndex])) selected.push(pool[poolIndex]);
    }
    return selected;
};

const buildVisualPlan = ({
    title,
    slug,
    category,
    summary,
    outline,
    contentHtml,
    targetKeyword,
    articleType,
    editorialProductPlacement = null,
    productSubject = ''
} = {}) => {
    const resolvedType = detectArticleType({ title, category, articleType });
    const headings = extractHeadings(contentHtml, outline);
    const wordCount = countWords(contentHtml);
    const maxInline = Math.max(0, Math.min(4, Number(process.env.IMAGE_MAX_INLINE_COUNT || 4)));
    const desiredInline = wordCount >= 1500 ? 4 : wordCount >= 1000 ? 3 : 2;
    const selectedHeadings = selectHeadings(headings, Math.min(maxInline, desiredInline, headings.length));
    const common = {
        articleTitle: normalizeString(title),
        articleSlug: normalizeString(slug),
        articleType: resolvedType,
        category: normalizeString(category),
        summary: normalizeString(summary),
        targetKeyword: normalizeString(targetKeyword),
        productSubject: normalizeString(productSubject),
        visualRule: TYPE_RULES[resolvedType]
    };

    return {
        version: 1,
        articleType: resolvedType,
        wordCount,
        editorialProductPlacement: editorialProductPlacement ? {
            placementStyle: editorialProductPlacement.placementStyle || 'no-product',
            firstImageMustBeEditorial: editorialProductPlacement.visualPlacement?.firstImageMustBeEditorial !== false,
            productImagePlacement: editorialProductPlacement.visualPlacement?.productImagePlacement || 'auto',
            consecutiveProductImagesAllowed: Boolean(editorialProductPlacement.visualPlacement?.consecutiveProductImagesAllowed),
            anchors: editorialProductPlacement.visualPlacement?.anchors || []
        } : null,
        cover: {
            ...common,
            id: 'cover',
            purpose: 'cover',
            imageRole: 'editorial',
            masterWidth: 1600,
            masterHeight: 900,
            width: Number(process.env.IMAGE_COVER_WIDTH || 1200),
            height: Number(process.env.IMAGE_COVER_HEIGHT || 675),
            sourcePreference: 'licensed_search_then_generation'
        },
        inline: selectedHeadings.map((heading, index) => ({
            ...common,
            id: `inline-${index + 1}`,
            purpose: 'inline',
            afterHeading: heading.text,
            headingIndex: heading.headingIndex,
            width: 1200,
            height: resolvedType === 'product_care' || resolvedType === 'how_to' ? 800 : 675,
            sourcePreference: 'licensed_search_then_generation'
        }))
    };
};

module.exports = {
    ARTICLE_TYPES,
    buildVisualPlan,
    detectArticleType,
    extractHeadings
};
