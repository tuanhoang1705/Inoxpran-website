'use strict'

const sharp = require('sharp');
const { normalizeSlug, normalizeString } = require('../../utils/seoBlogSanitizer');

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/avif']);
const FORBIDDEN_STYLE_PATTERN = /\b(3d render|cgi|glossy luxury|neon glow|fantasy lighting|plastic-looking|fake (badge|certification|logo|label))\b/i;
const FORBIDDEN_CLAIM_PATTERN = /\b(certified|chung nhan|chứng nhận|best|number one|so 1|số 1|guaranteed)\b/i;

const reviewImageQuality = async ({
    buffer,
    mimeType,
    planItem = {},
    // Only text this system did not author. The fixed safety clauses in the
    // generated prompt legitimately name what they forbid, so scanning the whole
    // prompt made every image fail its own instructions.
    subjectText = '',
    candidate = null,
    optimized = false
} = {}) => {
    const reasons = [];
    const normalizedMime = normalizeString(mimeType).toLowerCase();
    if (!buffer?.length) reasons.push('missing_image_buffer');
    if (!ALLOWED_MIME_TYPES.has(normalizedMime)) reasons.push('unsupported_mime_type');
    if (normalizedMime === 'image/svg+xml') reasons.push('untrusted_external_svg');

    const maxBytes = Number(
        optimized
            ? process.env.IMAGE_MAX_FILE_SIZE_KB || 350
            : process.env.IMAGE_MAX_SOURCE_FILE_SIZE_KB || 10240
    ) * 1024;
    if (buffer?.length > maxBytes) reasons.push('image_file_too_large');

    let metadata = {};
    if (buffer?.length) {
        try {
            metadata = await sharp(buffer, { failOn: 'error' }).metadata();
        } catch {
            reasons.push('invalid_image_data');
        }
    }

    const minWidth = planItem.purpose === 'cover' ? 1200 : 1000;
    const minHeight = planItem.purpose === 'cover' ? 630 : 600;
    if (metadata.width && metadata.width < minWidth) reasons.push('image_width_too_small');
    if (metadata.height && metadata.height < minHeight) reasons.push('image_height_too_small');

    const description = normalizeString(candidate?.description);
    const untrustedText = `${normalizeString(subjectText)} ${description}`.trim();
    if (FORBIDDEN_STYLE_PATTERN.test(untrustedText)) reasons.push('forbidden_visual_style');
    if (FORBIDDEN_CLAIM_PATTERN.test(untrustedText)) {
        reasons.push('fake_badge_or_claim_risk');
    }
    if (/placeholder|og-image|default-image/i.test(`${candidate?.sourceUrl || ''} ${candidate?.downloadUrl || ''}`)) {
        reasons.push('placeholder_image');
    }

    const translatedTerms = {
        inox: 'stainless',
        noi: 'pot',
        chao: 'pan',
        bep: 'kitchen',
        nau: 'cooking',
        rua: 'cleaning',
        sach: 'clean',
        khan: 'cloth'
    };
    const topicTerms = normalizeSlug(planItem.afterHeading || planItem.articleTitle)
        .split('-')
        .filter((term) => term.length >= 4);
    if (candidate && description && topicTerms.length) {
        const normalizedDescription = normalizeSlug(description).replace(/-/g, ' ');
        if (!topicTerms.some((term) =>
            normalizedDescription.includes(term) ||
            normalizedDescription.includes(translatedTerms[term] || '__no_translation__')
        )) {
            reasons.push('image_unrelated_to_visual_plan');
        }
    }

    return {
        passes: reasons.length === 0,
        reasons,
        width: Number(metadata.width) || 0,
        height: Number(metadata.height) || 0,
        mimeType: normalizedMime,
        sizeBytes: buffer?.length || 0
    };
};

module.exports = {
    ALLOWED_MIME_TYPES,
    FORBIDDEN_STYLE_PATTERN,
    reviewImageQuality
};
