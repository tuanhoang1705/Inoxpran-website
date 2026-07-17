'use strict'

const { normalizeString } = require('../../utils/seoBlogSanitizer');

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
    const purposeDirection = planItem.purpose === 'cover'
        ? 'Editorial cover photograph with a clear focal point, useful negative space, strong but natural composition for blog click-through.'
        : `Documentary editorial photograph that directly illustrates the section "${subject}".`;
    const careDirection = planItem.articleType === 'product_care' || planItem.articleType === 'how_to'
        ? 'When relevant show mild yellow stains, white mineral deposits, light burn marks, a soft cloth, lemon, vinegar, baking soda, or warm water; keep the scene practical and safe.'
        : '';

    return {
        positivePrompt: [
            purposeDirection,
            `Topic: ${normalizeString(planItem.articleTitle)}.`,
            `Visual rule: ${normalizeString(planItem.visualRule)}.`,
            planItem.imageSearchQuery
                ? `Scene guidance: ${normalizeString(planItem.imageSearchQuery)}. Realistic Vietnamese home setting, natural window light, believable proportions and materials.`
                : 'Realistic Vietnamese home kitchen, natural window light, real countertops, practical stainless steel cookware, believable proportions and materials.',
            careDirection,
            'Natural editorial photography, restrained color, no visible brand marks, no text inside the image.'
        ].filter(Boolean).join(' '),
        negativePrompt: NEGATIVE_PROMPT,
        aspectRatio: planItem.purpose === 'cover' ? '16:9' : `${planItem.width || 1200}:${planItem.height || 800}`
    };
};

module.exports = {
    NEGATIVE_PROMPT,
    buildImagePrompt
};
