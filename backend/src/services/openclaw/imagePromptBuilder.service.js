'use strict'

const crypto = require('node:crypto');
const { normalizeString } = require('../../utils/seoBlogSanitizer');

// A small rotation of believable editorial photography looks so cover and inline
// images stop sharing one identical aesthetic ("một màu"). Each is still natural,
// realistic and free of brand marks; the safety clause is appended separately and
// never varies. The look is chosen deterministically from the article + section so
// a given image stays stable across retries while different articles differ.
const AESTHETIC_STYLES = Object.freeze([
    'Natural editorial photography, restrained neutral color palette.',
    'Bright airy editorial photography, soft daylight, gentle warm tones.',
    'Cozy documentary kitchen photography, warm ambient light, lived-in feel.',
    'Clean modern lifestyle photography, crisp light, calm muted colors.',
    'Rustic homestyle photography, natural textures, soft window light.',
    'Fresh minimal editorial photography, light background, subtle shadows.'
]);

const pickAesthetic = (seed) => {
    const hash = crypto.createHash('sha256').update(String(seed || 'default')).digest();
    return AESTHETIC_STYLES[hash[0] % AESTHETIC_STYLES.length];
};

const NEGATIVE_PROMPT = [
    '3D render',
    'CGI',
    'glossy luxury',
    'fantasy lighting',
    'neon glow',
    'plastic-looking stainless steel',
    'over-polished surfaces',
    'fake logo',
    'fake certification',
    'fake badge',
    'unreadable text',
    'invented product label',
    'watermark',
    'technical claims printed in image'
].join(', ');

const buildImagePrompt = (planItem = {}) => {
    const subject = normalizeString(planItem.afterHeading || planItem.articleTitle);
    // The article title carries a model code, which means nothing to an image
    // model, while the generic fallbacks below name cookware outright. An article
    // about a dish dryer was illustrated with pots because that is literally what
    // the prompt asked for, so the real product type leads when it is known.
    const productSubject = normalizeString(planItem.productSubject);
    const purposeDirection = planItem.purpose === 'cover'
        ? 'Editorial cover photograph with a clear focal point, useful negative space, strong but natural composition for blog click-through.'
        : `Documentary editorial photograph that directly illustrates the section "${subject}".`;
    const careDirection = planItem.articleType === 'product_care' || planItem.articleType === 'how_to'
        ? productSubject
            ? `Show realistic everyday upkeep of ${productSubject} only; use props that genuinely belong to that appliance and keep the scene practical and safe.`
            : 'When relevant show mild yellow stains, white mineral deposits, light burn marks, a soft cloth, lemon, vinegar, baking soda, or warm water; keep the scene practical and safe.'
        : '';

    return {
        positivePrompt: [
            purposeDirection,
            productSubject
                ? `The pictured appliance must be ${productSubject}. Do not substitute pots, pans, kettles or any other cookware.`
                : '',
            `Topic: ${normalizeString(planItem.articleTitle)}.`,
            `Visual rule: ${normalizeString(planItem.visualRule)}.`,
            planItem.imageSearchQuery
                ? `Scene guidance: ${normalizeString(planItem.imageSearchQuery)}. Realistic Vietnamese home setting, natural window light, believable proportions and materials.`
                : productSubject
                    ? 'Realistic Vietnamese home kitchen, natural window light, real countertops, believable proportions and materials.'
                    : 'Realistic Vietnamese home kitchen, natural window light, real countertops, practical stainless steel cookware, believable proportions and materials.',
            careDirection,
            // Varied look + fixed safety clause (no brand marks / no in-image text).
            `${pickAesthetic(`${normalizeString(planItem.articleTitle)}|${subject}|${planItem.purpose || ''}`)} No visible brand marks, no text inside the image.`
        ].filter(Boolean).join(' '),
        negativePrompt: NEGATIVE_PROMPT,
        aspectRatio: planItem.purpose === 'cover' ? '16:9' : `${planItem.width || 1200}:${planItem.height || 800}`
    };
};

module.exports = {
    AESTHETIC_STYLES,
    NEGATIVE_PROMPT,
    buildImagePrompt,
    pickAesthetic
};
