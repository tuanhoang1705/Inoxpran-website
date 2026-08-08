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

/**
 * Proportions are expressed as fractions of the canvas so the layout holds at any
 * cover size the pipeline is configured for.
 */
const layout = (width, height) => {
    const margin = Math.round(width * 0.035);
    const logoWidth = Math.round(width * 0.16);
    const productWidth = Math.round(width * 0.34);
    const productHeight = Math.round(height * 0.62);
    return {
        margin,
        logoWidth,
        productWidth,
        productHeight,
        productLeft: width - productWidth - margin,
        productTop: Math.round((height - productHeight) / 2)
    };
};

// A scrim keeps the product shot readable over a busy photograph without hiding
// the photograph itself, which is what makes the frame still read as editorial.
const buildScrim = ({ width, height, box }) => Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="fade" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stop-color="#0b1f2a" stop-opacity="0"/>
          <stop offset="1" stop-color="#0b1f2a" stop-opacity="0.55"/>
        </linearGradient>
      </defs>
      <rect x="${Math.round(width * 0.42)}" y="0" width="${Math.round(width * 0.58)}" height="${height}" fill="url(#fade)"/>
      <rect x="${box.left - Math.round(box.width * 0.06)}" y="${box.top - Math.round(box.height * 0.05)}"
            width="${Math.round(box.width * 1.12)}" height="${Math.round(box.height * 1.1)}"
            rx="${Math.round(box.width * 0.05)}" fill="#ffffff" fill-opacity="0.92"/>
    </svg>`
);

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
 * product shot beside it, and the brand mark top right. Each overlay is optional —
 * a missing product image or logo yields the plain photograph rather than a
 * failure, because losing the cover entirely is worse than losing an overlay.
 */
const composePoster = async ({
    baseBuffer,
    productImageBuffer = null,
    logoPath = '',
    width = 1200,
    height = 675
} = {}) => {
    if (!baseBuffer?.length) throw new Error('poster_base_image_missing');
    const applied = [];
    const box = layout(width, height);
    const overlays = [];

    if (productImageBuffer?.length) {
        try {
            const product = await resizeContain(productImageBuffer, box.productWidth, box.productHeight);
            overlays.push({
                input: buildScrim({
                    width,
                    height,
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
            left: width - (logoMeta.width || box.logoWidth) - box.margin
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

    return { buffer, mimeType: 'image/webp', width, height, applied };
};

module.exports = {
    DEFAULT_LOGO_PATH,
    composePoster,
    isPosterEnabled,
    layout,
    readNumber
};
