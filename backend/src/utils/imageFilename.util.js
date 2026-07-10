'use strict'

const { normalizeSlug, normalizeString } = require('./seoBlogSanitizer');

const normalizeExtension = (value = 'webp') => {
    const extension = normalizeString(value).toLowerCase().replace(/[^a-z0-9]/g, '');
    return extension || 'webp';
};

const buildImageFilename = ({
    slug,
    purpose = 'inline',
    heading = '',
    index = 0,
    extension = 'webp'
} = {}) => {
    const articleSlug = normalizeSlug(slug) || 'inoxpran-blog';
    const purposeSlug = purpose === 'cover'
        ? 'cover'
        : normalizeSlug(heading || purpose) || `inline-${Number(index) + 1}`;
    return `${articleSlug}-${purposeSlug}.${normalizeExtension(extension)}`;
};

module.exports = {
    buildImageFilename,
    normalizeExtension
};
