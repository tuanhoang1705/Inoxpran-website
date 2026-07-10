'use strict'

const { isAllowedImage, normalizeString, stripHtml } = require('./seoBlogSanitizer');

const escapeHtmlAttribute = (value) =>
    String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

const normalizeText = (value, maxLength = 180) =>
    stripHtml(normalizeString(value))
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength)
        .trim();

const countOccurrences = (text, phrase) => {
    const normalizedText = normalizeText(text).toLocaleLowerCase('vi');
    const normalizedPhrase = normalizeText(phrase).toLocaleLowerCase('vi');
    if (!normalizedPhrase) return 0;
    return normalizedText.split(normalizedPhrase).length - 1;
};

const isKeywordStuffed = (alt, keyword) => {
    const normalizedAlt = normalizeText(alt);
    if (!normalizedAlt) return false;
    if (normalizedAlt.length > 160) return true;
    if (countOccurrences(normalizedAlt, keyword) > 1) return true;

    const words = normalizedAlt.toLocaleLowerCase('vi').split(/\s+/).filter(Boolean);
    if (words.length < 4) return false;
    const frequency = new Map();
    words.forEach((word) => frequency.set(word, (frequency.get(word) || 0) + 1));
    return Math.max(...frequency.values()) / words.length > 0.35;
};

const buildImageSeoMetadata = ({
    articleTitle,
    heading,
    primaryKeyword,
    purpose = 'inline'
} = {}) => {
    const subject = normalizeText(heading || articleTitle, 110);
    const fallback = purpose === 'cover'
        ? `Minh họa ${normalizeText(articleTitle, 120)} trong gian bếp gia đình Việt`
        : `Minh họa ${subject} với dụng cụ inox trong bếp gia đình Việt`;
    let alt = fallback;
    if (isKeywordStuffed(alt, primaryKeyword)) {
        alt = purpose === 'cover'
            ? 'Dụng cụ inox trong gian bếp gia đình Việt với ánh sáng tự nhiên'
            : `Hình ảnh thực tế minh họa ${subject}`;
    }

    return {
        alt: normalizeText(alt, 160),
        title: normalizeText(subject || articleTitle, 120),
        caption: purpose === 'cover'
            ? normalizeText(`Hình ảnh minh họa cho bài viết ${articleTitle}.`, 180)
            : normalizeText(`Minh họa thực tế: ${subject}.`, 180)
    };
};

const buildSafeFigureHtml = ({
    imageId,
    url,
    alt,
    title,
    caption,
    width,
    height
} = {}) => {
    if (!isAllowedImage(url)) return '';
    const safeWidth = Math.max(1, Math.round(Number(width) || 1200));
    const safeHeight = Math.max(1, Math.round(Number(height) || 675));
    const safeCaption = normalizeText(caption, 220);
    return [
        `<figure${imageId ? ` data-image-id="${escapeHtmlAttribute(imageId)}"` : ''}>`,
        `<img src="${escapeHtmlAttribute(url)}" alt="${escapeHtmlAttribute(normalizeText(alt, 160))}" title="${escapeHtmlAttribute(normalizeText(title, 120))}" width="${safeWidth}" height="${safeHeight}" loading="lazy" decoding="async"${imageId ? ` data-image-id="${escapeHtmlAttribute(imageId)}"` : ''}>`,
        safeCaption ? `<figcaption>${escapeHtmlAttribute(safeCaption)}</figcaption>` : '',
        '</figure>'
    ].join('');
};

const insertInlineImages = (contentHtml, images = []) => {
    let output = String(contentHtml || '');
    const headings = [...output.matchAll(/<h([23])\b[^>]*>[\s\S]*?<\/h\1>/gi)];
    const insertions = [];

    images.forEach((image) => {
        if (!image?.url || output.includes(image.url)) return;
        const headingIndex = Number(image.headingIndex);
        const heading = headings[headingIndex];
        if (!heading) return;
        const figure = buildSafeFigureHtml(image);
        if (!figure) return;
        insertions.push({
            index: Number(heading.index) + heading[0].length,
            html: figure
        });
    });

    insertions
        .sort((a, b) => b.index - a.index)
        .forEach(({ index, html }) => {
            output = `${output.slice(0, index)}${html}${output.slice(index)}`;
        });

    return output;
};

module.exports = {
    buildImageSeoMetadata,
    buildSafeFigureHtml,
    insertInlineImages,
    isKeywordStuffed
};
