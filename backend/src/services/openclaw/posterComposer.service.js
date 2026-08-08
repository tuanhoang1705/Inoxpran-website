'use strict'

const path = require('node:path');
const fs = require('node:fs/promises');
const sharp = require('sharp');

const BACKEND_ROOT_DIR = path.resolve(__dirname, '../../..');
const DEFAULT_LOGO_PATH = path.join(BACKEND_ROOT_DIR, 'assets', 'logo-inoxpran.png');

const parseBoolean = (value, fallback = false) => {
    if (typeof value === 'boolean') return value;
    if (typeof value !== 'string') return fallback;
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const readNumber = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const isPosterEnabled = (env = process.env) =>
    parseBoolean(env.OPENCLAW_POSTER_COVER_ENABLED, false);

// A cover that always looks the same reads as a template. Each article picks one
// of these deterministically from its slug, so a given article keeps a stable look
// across regenerations while the blog as a whole stays visually varied.
const DESIGNS = Object.freeze([
    { id: 'right-panel', side: 'right', scrim: '#0b1f2a', panel: '#ffffff', panelOpacity: 0.92, productScale: 0.34, corner: 0.05 },
    { id: 'left-panel', side: 'left', scrim: '#12303d', panel: '#ffffff', panelOpacity: 0.9, productScale: 0.34, corner: 0.05 },
    { id: 'right-warm', side: 'right', scrim: '#3b2415', panel: '#fdf6ec', panelOpacity: 0.94, productScale: 0.32, corner: 0.09 },
    { id: 'left-slate', side: 'left', scrim: '#1f2937', panel: '#f3f4f6', panelOpacity: 0.93, productScale: 0.36, corner: 0.02 },
    { id: 'right-teal', side: 'right', scrim: '#0f766e', panel: '#ecfdf5', panelOpacity: 0.9, productScale: 0.3, corner: 0.12 },
    { id: 'left-plum', side: 'left', scrim: '#3b1d3d', panel: '#fdf2f8', panelOpacity: 0.92, productScale: 0.35, corner: 0.07 }
]);

const pickDesign = (seed) => {
    const text = String(seed || '');
    let hash = 0;
    for (let index = 0; index < text.length; index += 1) {
        hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
    }
    return DESIGNS[hash % DESIGNS.length];
};

/**
 * Proportions are expressed as fractions of the canvas so a layout holds at any
 * cover size the pipeline is configured for.
 */
const layout = (width, height, design = DESIGNS[0]) => {
    const margin = Math.round(width * 0.035);
    const logoWidth = Math.round(width * 0.16);
    const productWidth = Math.round(width * design.productScale);
    const productHeight = Math.round(height * 0.62);
    const onRight = design.side === 'right';
    return {
        margin,
        logoWidth,
        productWidth,
        productHeight,
        side: design.side,
        // The brand mark sits opposite the product so the two never collide.
        logoLeft: onRight ? margin : width - logoWidth - margin,
        productLeft: onRight ? width - productWidth - margin : margin,
        productTop: Math.round((height - productHeight) / 2)
    };
};

// A scrim keeps the product shot readable over a busy photograph without hiding
// the photograph itself, which is what makes the frame still read as editorial.
const buildScrim = ({ width, height, box, design }) => {
    const onRight = design.side === 'right';
    const fadeX = onRight ? Math.round(width * 0.42) : 0;
    return Buffer.from(
        `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="fade" x1="${onRight ? 0 : 1}" x2="${onRight ? 1 : 0}" y1="0" y2="0">
          <stop offset="0" stop-color="${design.scrim}" stop-opacity="0"/>
          <stop offset="1" stop-color="${design.scrim}" stop-opacity="0.55"/>
        </linearGradient>
      </defs>
      <rect x="${fadeX}" y="0" width="${Math.round(width * 0.58)}" height="${height}" fill="url(#fade)"/>
      <rect x="${box.left - Math.round(box.width * 0.06)}" y="${box.top - Math.round(box.height * 0.05)}"
            width="${Math.round(box.width * 1.12)}" height="${Math.round(box.height * 1.1)}"
            rx="${Math.round(box.width * design.corner)}"
            fill="${design.panel}" fill-opacity="${design.panelOpacity}"/>
    </svg>`
    );
};

const resizeContain = (buffer, width, height) =>
    sharp(buffer)
        .resize(width, height, {
            fit: 'contain',
            background: { r: 255, g: 255, b: 255, alpha: 0 }
        })
        .png()
        .toBuffer();

const loadLogo = async (logoPath, width) => {
    const resolved = logoPath || DEFAULT_LOGO_PATH;
    const file = await fs.readFile(resolved);
    return sharp(file).resize({ width, fit: 'inside' }).png().toBuffer();
};

/**
 * Builds the social-facing cover: the editorial photograph as the frame, the real
 * product shot on one side, and the brand mark opposite it. The side, palette and
 * proportions come from the design the seed selects. Each overlay is optional — a
 * missing product image or logo yields the plain photograph rather than a failure,
 * because losing the cover entirely is worse than losing an overlay.
 */
const composePoster = async ({
    baseBuffer,
    productImageBuffer = null,
    logoPath = '',
    width = 1200,
    height = 675,
    designSeed = ''
} = {}) => {
    if (!baseBuffer?.length) throw new Error('poster_base_image_missing');
    const applied = [];
    const design = pickDesign(designSeed);
    const box = layout(width, height, design);
    const overlays = [];

    if (productImageBuffer?.length) {
        try {
            const product = await resizeContain(productImageBuffer, box.productWidth, box.productHeight);
            overlays.push({
                input: buildScrim({
                    width,
                    height,
                    design,
                    box: {
                        left: box.productLeft,
                        top: box.productTop,
                        width: box.productWidth,
                        height: box.productHeight
                    }
                }),
                top: 0,
                left: 0
            });
            overlays.push({ input: product, top: box.productTop, left: box.productLeft });
            applied.push('product');
        } catch {
            // Overlay is decorative; the photograph alone is still a usable cover.
        }
    }

    try {
        const logo = await loadLogo(logoPath, box.logoWidth);
        const logoMeta = await sharp(logo).metadata();
        overlays.push({
            input: logo,
            top: box.margin,
            left: box.side === 'right'
                ? box.margin
                : width - (logoMeta.width || box.logoWidth) - box.margin
        });
        applied.push('logo');
    } catch {
        // Ship the cover without the brand mark rather than no cover at all.
    }

    const buffer = await sharp(baseBuffer)
        .resize(width, height, { fit: 'cover', position: 'attention' })
        .composite(overlays)
        .webp({ quality: 82 })
        .toBuffer();

    return { buffer, mimeType: 'image/webp', width, height, applied, design: design.id };
};

module.exports = {
    DEFAULT_LOGO_PATH,
    DESIGNS,
    pickDesign,
    composePoster,
    isPosterEnabled,
    layout,
    readNumber
};
