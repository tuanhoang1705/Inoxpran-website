'use strict'

const dns = require('node:dns').promises;
const { assertSafeUrl } = require('./safeSourceFetch.service');

const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

const readLimitedImage = async (response, maxBytes) => {
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > maxBytes) throw new Error('telegram_image_too_large');
    if (!response.body?.getReader) {
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.byteLength > maxBytes) throw new Error('telegram_image_too_large');
        return buffer;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
            await reader.cancel().catch(() => null);
            throw new Error('telegram_image_too_large');
        }
        chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
};

const validateTelegramImageUrl = async ({
    url,
    timeoutMs = Number(process.env.TELEGRAM_IMAGE_TIMEOUT_MS || 8000),
    maxBytes = Number(process.env.TELEGRAM_IMAGE_MAX_BYTES || DEFAULT_MAX_BYTES),
    fetchImpl = global.fetch,
    resolveHostname = dns.lookup
}) => {
    const canonicalUrl = await assertSafeUrl(url, { resolveHostname });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 8000));
    try {
        const response = await fetchImpl(canonicalUrl, {
            method: 'GET',
            headers: { accept: 'image/jpeg,image/png,image/webp,image/gif' },
            redirect: 'error',
            signal: controller.signal
        });
        if (!response.ok) throw new Error(`telegram_image_http_${response.status}`);
        const mimeType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (!ALLOWED_IMAGE_MIME.has(mimeType)) throw new Error('telegram_image_mime_not_allowed');
        const body = await readLimitedImage(response, maxBytes);
        const sizeBytes = body.byteLength;
        if (!sizeBytes) throw new Error('telegram_image_empty');
        // The bytes are already in hand, and handing them to the caller lets it
        // upload the image instead of passing on a URL that carries a read token.
        return { safe: true, canonicalUrl, mimeType, sizeBytes, bytes: body };
    } catch (error) {
        if (error?.name === 'AbortError') throw new Error('telegram_image_timeout');
        throw error;
    } finally {
        clearTimeout(timeout);
    }
};

module.exports = { ALLOWED_IMAGE_MIME, DEFAULT_MAX_BYTES, readLimitedImage, validateTelegramImageUrl };
