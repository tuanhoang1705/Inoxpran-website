import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    ERROR_CODES,
    GOOGLE_TRENDS_RSS_ENDPOINT,
    GoogleTrendsRssProvider,
    buildGoogleTrendsRssUrl,
    parseGoogleTrendsRss
} = require('../src/services/contentOperations/googleTrendsRss.provider');

const NOW = new Date('2026-07-22T04:30:00.000Z');

const headers = (values = {}) => ({
    get(name) {
        const key = Object.keys(values).find((candidate) => candidate.toLowerCase() === String(name).toLowerCase());
        return key ? String(values[key]) : null;
    }
});

const responseWithText = (body, options = {}) => ({
    ok: options.ok ?? true,
    status: options.status ?? 200,
    headers: headers(options.headers),
    text: vi.fn(async () => body)
});

const rss = (items) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:ht="https://trends.google.com/trending/rss">
  <channel>
    <title>Daily Search Trends</title>
    ${items.join('\n')}
  </channel>
</rss>`;

const item = ({ title, traffic = '200+', extra = '' }) => `<item>
  <title>${title}</title>
  <ht:approx_traffic>${traffic}</ht:approx_traffic>
  ${extra}
</item>`;

describe('Google Trends RSS provider', () => {
    it('reads only bounded trend metadata and returns TrendsAdapter-compatible signals', async () => {
        const privateNewsBody = 'Private body alice@example.com access_token=never-store';
        const fetchImpl = vi.fn(async () => responseWithText(rss([
            item({
                title: 'N&#x1ED3;i &amp; &lt;b&gt;chảo inox&lt;/b&gt;',
                traffic: '20K+',
                extra: `<description>${privateNewsBody}</description>
                    <ht:news_item>
                      <ht:news_item_title>${privateNewsBody}</ht:news_item_title>
                      <ht:news_item_url>https://news.example/?token=never-store</ht:news_item_url>
                    </ht:news_item>`
            }),
            item({ title: 'Bếp gia đình', traffic: '1,000+' }),
            item({ title: 'alice@example.com access_token=never-store' })
        ])));
        const controller = new AbortController();
        const provider = new GoogleTrendsRssProvider({ fetchImpl, geo: 'vn', now: () => NOW });

        const result = await provider.readTrends({ signal: controller.signal });

        expect(fetchImpl).toHaveBeenCalledWith(
            'https://trends.google.com/trending/rss?geo=VN',
            expect.objectContaining({
                method: 'GET',
                redirect: 'error',
                signal: controller.signal
            })
        );
        expect(result.signals).toHaveLength(2);
        expect(result.signals[0]).toEqual({
            topic: 'Nồi & chảo inox',
            source: 'google-trends-rss',
            sourceUrl: 'https://trends.google.com/trending/rss?geo=VN',
            checkedAt: NOW.toISOString(),
            timeRange: 'trending-now',
            confidence: 'high',
            classification: 'observed',
            summary: 'Observed in Google Trends Trending Now with approximately 20K+ searches.'
        });
        expect(JSON.stringify(result)).not.toContain('alice@example.com');
        expect(JSON.stringify(result)).not.toContain('never-store');
        expect(JSON.stringify(result)).not.toContain('Private body');
        expect(JSON.stringify(result)).not.toContain('news.example');
    });

    it('uses only the fixed official endpoint, validates geo, and defaults to VN', () => {
        expect(GOOGLE_TRENDS_RSS_ENDPOINT).toBe('https://trends.google.com/trending/rss');
        expect(buildGoogleTrendsRssUrl()).toBe('https://trends.google.com/trending/rss?geo=VN');
        expect(buildGoogleTrendsRssUrl('us')).toBe('https://trends.google.com/trending/rss?geo=US');
        expect(() => buildGoogleTrendsRssUrl('VNM')).toThrow(expect.objectContaining({
            code: ERROR_CODES.INVALID_GEO
        }));
        expect(() => new GoogleTrendsRssProvider({ geo: 'VN&redirect=evil' })).toThrow(
            expect.objectContaining({ code: ERROR_CODES.INVALID_GEO })
        );
    });

    it('caps the number of signals before returning provider output', () => {
        const signals = parseGoogleTrendsRss(rss([
            item({ title: 'Trend one' }),
            item({ title: 'Trend two' }),
            item({ title: 'Trend three' })
        ]), { geo: 'VN', maxSignals: 2, checkedAt: NOW });

        expect(signals.map((signal) => signal.topic)).toEqual(['Trend one', 'Trend two']);
    });

    it('fails with stable codes for malformed RSS and non-OK responses', async () => {
        const malformedProvider = new GoogleTrendsRssProvider({
            fetchImpl: vi.fn(async () => responseWithText('<rss><channel><item><title>broken</title></channel></rss>'))
        });
        await expect(malformedProvider.readTrends()).rejects.toMatchObject({
            code: ERROR_CODES.RESPONSE_INVALID
        });

        const nonOkProvider = new GoogleTrendsRssProvider({
            fetchImpl: vi.fn(async () => responseWithText('do not parse this body', {
                ok: false,
                status: 503
            }))
        });
        await expect(nonOkProvider.readTrends()).rejects.toMatchObject({
            code: ERROR_CODES.HTTP_ERROR,
            status: 503
        });
    });

    it('rejects DTD/entity declarations instead of expanding arbitrary XML entities', () => {
        const malicious = `<?xml version="1.0"?>
            <!DOCTYPE rss [<!ENTITY private "never-store">]>
            <rss><channel><item><title>&private;</title></item></channel></rss>`;
        expect(() => parseGoogleTrendsRss(malicious)).toThrow(expect.objectContaining({
            code: ERROR_CODES.RESPONSE_INVALID
        }));
    });

    it('enforces the response size cap while streaming without Content-Length', async () => {
        const body = {
            async *[Symbol.asyncIterator]() {
                yield Buffer.alloc(700, 'a');
                yield Buffer.alloc(700, 'b');
            }
        };
        const provider = new GoogleTrendsRssProvider({
            maxResponseBytes: 1024,
            fetchImpl: vi.fn(async () => ({
                ok: true,
                status: 200,
                headers: headers(),
                body
            }))
        });

        await expect(provider.readTrends()).rejects.toMatchObject({
            code: ERROR_CODES.RESPONSE_TOO_LARGE
        });
    });

    it('passes AbortSignal to fetch and normalizes abort failures', async () => {
        const controller = new AbortController();
        const fetchImpl = vi.fn((_url, options) => new Promise((_resolve, reject) => {
            expect(options.signal).toBe(controller.signal);
            options.signal.addEventListener('abort', () => {
                const error = new Error('request aborted');
                error.name = 'AbortError';
                reject(error);
            }, { once: true });
        }));
        const provider = new GoogleTrendsRssProvider({ fetchImpl });

        const pending = provider.readTrends({ signal: controller.signal });
        controller.abort();

        await expect(pending).rejects.toMatchObject({ code: ERROR_CODES.ABORTED });
    });

    it('does not leak transport error details and uses a stable request-failure code', async () => {
        const provider = new GoogleTrendsRssProvider({
            fetchImpl: vi.fn(async () => {
                throw new Error('request failed with access_token=never-store');
            })
        });

        const error = await provider.readTrends().catch((caught) => caught);
        expect(error).toMatchObject({ code: ERROR_CODES.REQUEST_FAILED });
        expect(error.message).not.toContain('never-store');
    });
});
