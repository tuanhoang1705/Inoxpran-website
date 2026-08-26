'use strict'

const crypto = require('node:crypto');
const { normalizeString } = require('../../utils/seoBlogSanitizer');

// A small rotation of believable editorial photography looks so cover and inline
// images stop sharing one identical aesthetic ("một màu"). Each is still natural,
// realistic and free of brand marks; the safety clause is appended separately and
// never varies. The look is chosen deterministically from the article + section so
// a given image stays stable across retries while different articles differ.
// Each look now names optics, not just a mood. An abstract art-direction phrase
// leaves the model free to answer from its illustration prior, which is what made
// the output read as rendered rather than photographed; a focal length, an
// aperture and a real light source push it onto the photographic prior instead.
const AESTHETIC_STYLES = Object.freeze([
    'Shot on a 35mm lens at f/2.8, restrained neutral palette, single soft window light from camera left, shallow but honest depth of field.',
    'Shot on a 50mm lens at f/2.0, bright overcast daylight through a nearby window, gentle warm tones, natural falloff into the corners.',
    'Handheld documentary frame on a 28mm lens at f/4, warm ambient kitchen light mixed with daylight, lived-in depth.',
    'Shot on an 85mm lens at f/2.8, crisp directional daylight, calm muted colors, background softly separated.',
    'Shot on a 35mm lens at f/5.6, low side window light raking across natural textures, visible grain of real materials.',
    'Shot on a 50mm lens at f/4, soft overhead daylight, light background, subtle grounded shadows with soft edges.'
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

// gpt-image-2 has no negative-prompt parameter, and the OpenAI request only ever
// carried the positive one — so on our default provider every guardrail above was
// silently unenforced. Stated affirmatively they reach any model, and the models
// that do accept a negative prompt simply get the same rule twice.
// A flawless frame is the single strongest tell that nobody held a camera. These
// ask for the ordinary imperfections a real kitchen photograph carries, which is
// what the eye reads as "real" long before it inspects any detail.
const REALISM_CONSTRAINTS = [
    'Everything in frame shows ordinary real-world wear: surfaces that have been used and cleaned rather than unboxed, faint fingerprints or water spots where they would naturally fall, a worktop that is tidy but not staged.',
    'Lighting is uneven the way a real room is uneven, with one dominant source, soft natural falloff and no second fill light cleaning up the shadows.',
    'Composition is slightly imperfect: not perfectly centred, not perfectly symmetrical, framed the way a person standing there would actually frame it.'
].join(' ');

const POSITIVE_CONSTRAINTS = [
    'Photographic realism throughout: a real photograph taken by a person, not a 3D render, not CGI, not an illustration.',
    'Materials behave like real metal and real surfaces, with no glossy luxury sheen, neon glow or fantasy lighting.',
    REALISM_CONSTRAINTS,
    'No logo, badge, certification mark, product label, watermark or any lettering anywhere in the frame.'
].join(' ');

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

    // The quality guardrail scans text as a proxy for the pixels. It must only
    // ever see text this system did not author: the fixed safety clauses below
    // legitimately contain the very phrases they forbid ("not a 3D render", "no
    // glossy luxury sheen"), so scanning the whole prompt made every generated
    // image read as a violation of its own instructions. Only the article-derived
    // parts are untrusted, and only those are offered for scanning.
    const subjectText = [
        normalizeString(planItem.articleTitle),
        subject,
        productSubject,
        normalizeString(planItem.visualRule),
        normalizeString(planItem.imageSearchQuery)
    ].filter(Boolean).join(' ');

    return {
        subjectText,
        positivePrompt: [
            purposeDirection,
            // Naming forbidden items backfires once the subject is one of them, so
            // the rule is stated against the named subject rather than a list.
            productSubject
                ? `The pictured appliance must be ${productSubject}, and no other kind of kitchen appliance or cookware may stand in for it.`
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
            `${pickAesthetic(`${normalizeString(planItem.articleTitle)}|${subject}|${planItem.purpose || ''}`)} No visible brand marks, no text inside the image.`,
            POSITIVE_CONSTRAINTS
        ].filter(Boolean).join(' '),
        negativePrompt: NEGATIVE_PROMPT,
        aspectRatio: planItem.purpose === 'cover' ? '16:9' : `${planItem.width || 1200}:${planItem.height || 800}`
    };
};

module.exports = {
    AESTHETIC_STYLES,
    REALISM_CONSTRAINTS,
    NEGATIVE_PROMPT,
    buildImagePrompt,
    pickAesthetic
};
