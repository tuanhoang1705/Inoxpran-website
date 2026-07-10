'use strict'

const crypto = require('node:crypto');
const sharp = require('sharp');

const optimizeImage = async ({ buffer, purpose = 'inline', width, height } = {}) => {
    const targetWidth = Math.max(1, Number(width) || 1200);
    const targetHeight = Math.max(1, Number(height) || (purpose === 'cover' ? 675 : 800));
    const maxBytes = Math.max(50, Number(process.env.IMAGE_MAX_FILE_SIZE_KB || 350)) * 1024;
    const qualities = [82, 74, 66, 58, 50];
    let output;

    for (const quality of qualities) {
        const pipeline = sharp(buffer, { failOn: 'error' }).rotate();
        if (purpose === 'cover') {
            pipeline.resize(targetWidth, targetHeight, {
                fit: 'cover',
                position: 'attention'
            });
        } else {
            pipeline.resize({
                width: targetWidth,
                height: targetHeight,
                fit: 'inside',
                withoutEnlargement: false
            });
        }
        output = await pipeline
            .webp({ quality, effort: 5 })
            .toBuffer({ resolveWithObject: true });
        if (output.data.length <= maxBytes) break;
    }

    return {
        buffer: output.data,
        mimeType: 'image/webp',
        width: Number(output.info.width) || targetWidth,
        height: Number(output.info.height) || targetHeight,
        sizeBytes: output.data.length,
        checksum: crypto.createHash('sha256').update(output.data).digest('hex')
    };
};

module.exports = {
    optimizeImage
};
