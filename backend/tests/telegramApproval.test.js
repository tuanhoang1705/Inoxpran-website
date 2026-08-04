import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const {
    TelegramApprovalService,
    buildAdminEditUrl,
    buildCommandResponse,
    buildDraftMessage,
    isHttpsAdminBaseUrl,
    isAuthorizedTelegramActor,
    parseTelegramCommand,
    sendApprovalNotification,
    timingSafeStringEqual
} = require('../src/services/telegramApproval.service');
const { validateTelegramImageUrl } = require('../src/services/telegramImageSafety.service');
const { TelegramUpdate } = require('../src/models/telegramUpdate.model');
const { TelegramBlogApproval } = require('../src/models/telegramBlogApproval.model');
const BlogService = require('../src/services/blog.service');

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    process.env = {
        ...ORIGINAL_ENV,
        TELEGRAM_BOT_ENABLED: 'true',
        TELEGRAM_BOT_TOKEN: 'test-token',
        TELEGRAM_WEBHOOK_SECRET: 'webhook-secret',
        TELEGRAM_ALLOWED_CHAT_IDS: '100,200',
        TELEGRAM_ALLOWED_USER_IDS: '900',
        ADMIN_BASE_URL: 'https://admin.example.com/'
    };
});

const stubTelegramFetch = () => vi.stubGlobal('fetch', vi.fn(async () => new Response(
    JSON.stringify({ ok: true, result: { message_id: 101 } }),
    { status: 200, headers: { 'content-type': 'application/json' } }
)));

describe('Telegram approval helpers', () => {
    it('parses approve commands with or without bot username', () => {
        expect(parseTelegramCommand('/approve ABC123')).toEqual({
            command: 'approve',
            code: 'ABC123'
        });
        expect(parseTelegramCommand('/approve@inoxpran_bot abc123')).toEqual({
            command: 'approve',
            code: 'ABC123'
        });
    });

    it('allows only configured chat or user ids', () => {
        expect(isAuthorizedTelegramActor({ chatId: '100', userId: '1' })).toBe(true);
        expect(isAuthorizedTelegramActor({ chatId: '999', userId: '900' })).toBe(true);
        expect(isAuthorizedTelegramActor({ chatId: '999', userId: '901' })).toBe(false);
    });

    it('rejects all Telegram actors when allowlists are empty', () => {
        process.env.TELEGRAM_ALLOWED_CHAT_IDS = '';
        process.env.TELEGRAM_ALLOWED_USER_IDS = '';

        expect(isAuthorizedTelegramActor({ chatId: '100', userId: '900' })).toBe(false);
    });

    it('uses timing-safe comparison for webhook secrets', () => {
        expect(timingSafeStringEqual('abc', 'abc')).toBe(true);
        expect(timingSafeStringEqual('abc', 'abcd')).toBe(false);
    });

    it('validates Telegram webhook secret headers', () => {
        expect(() => TelegramApprovalService.validateWebhookSecret({
            headers: { 'x-telegram-bot-api-secret-token': 'webhook-secret' }
        })).not.toThrow();

        expect(() => TelegramApprovalService.validateWebhookSecret({
            headers: { 'x-telegram-bot-api-secret-token': 'bad' }
        })).toThrow('Invalid Telegram webhook secret');
    });

    it('builds the real admin edit route from blog ID and never from a slug', () => {
        const id = '507f1f77bcf86cd799439011';
        expect(buildAdminEditUrl(id)).toBe(`https://admin.example.com/admin/blogs/${id}`);
        expect(buildAdminEditUrl(id, 'https://admin.example.com')).not.toContain('/blog/cach-chon-noi');
        expect(() => buildAdminEditUrl('cach-chon-noi-inox')).toThrow('valid blogId');
    });

    it('keeps Telegram disabled until ADMIN_BASE_URL is HTTPS', () => {
        expect(isHttpsAdminBaseUrl()).toBe(true);
        process.env.ADMIN_BASE_URL = 'http://admin.example.com';

        expect(isHttpsAdminBaseUrl()).toBe(false);
        expect(TelegramApprovalService.isEnabled()).toBe(false);
    });

    it('includes admin URL and blog ID in the approval message', () => {
        const message = buildDraftMessage({
            approval: {
                blogTitle: 'Cách chọn nồi inox',
                blogId: '507f1f77bcf86cd799439011',
                adminEditUrl: 'https://admin.example.com/admin/blogs/507f1f77bcf86cd799439011',
                approvalCode: 'ABC123'
            }
        });
        expect(message).toContain('/admin/blogs/507f1f77bcf86cd799439011');
        expect(message).not.toContain('/blog/cach-chon-noi');
    });

    it('supports /start, /help and /whoami without AI-generated text', () => {
        expect(buildCommandResponse({ command: 'start' })).toContain('/help');
        expect(buildCommandResponse({ command: 'help' })).toContain('/approve CODE');
        expect(buildCommandResponse({ command: 'whoami', chatId: '100', userId: '900', username: 'admin' }))
            .toContain('User ID: 900');
    });

    it('sends a photo when a safe cover is available', async () => {
        const sendPhotoImpl = vi.fn(async () => ({ sent: true, messageId: '55' }));
        const sendMessageImpl = vi.fn();
        const result = await sendApprovalNotification({
            chatId: '100',
            approval: {
                blogTitle: 'Draft', blogId: '507f1f77bcf86cd799439011',
                adminEditUrl: 'https://admin.example.com/admin/blogs/507f1f77bcf86cd799439011',
                approvalCode: 'ABC', coverImageUrl: 'https://cdn.example.com/cover.jpg'
            },
            validateImageImpl: vi.fn(async () => ({ canonicalUrl: 'https://cdn.example.com/cover.jpg' })),
            sendPhotoImpl,
            sendMessageImpl
        });
        expect(result.notificationType).toBe('photo');
        expect(sendPhotoImpl).toHaveBeenCalledTimes(1);
        expect(sendMessageImpl).not.toHaveBeenCalled();
    });

    it('falls back to exactly one text notification when sendPhoto fails', async () => {
        const sendPhotoImpl = vi.fn(async () => { throw new Error('photo failed'); });
        const sendMessageImpl = vi.fn(async () => ({ sent: true, messageId: '56' }));
        const result = await sendApprovalNotification({
            chatId: '100',
            approval: {
                blogTitle: 'Draft', blogId: '507f1f77bcf86cd799439011',
                adminEditUrl: 'https://admin.example.com/admin/blogs/507f1f77bcf86cd799439011',
                approvalCode: 'ABC', coverImageUrl: 'https://cdn.example.com/cover.jpg'
            },
            validateImageImpl: vi.fn(async () => ({ canonicalUrl: 'https://cdn.example.com/cover.jpg' })),
            sendPhotoImpl,
            sendMessageImpl
        });
        expect(result.notificationType).toBe('text_fallback');
        expect(result.notificationStatus).toBe('photo_failed_text_sent');
        expect(sendPhotoImpl).toHaveBeenCalledTimes(1);
        expect(sendMessageImpl).toHaveBeenCalledTimes(1);
    });

    it('sends text directly when no cover exists', async () => {
        const sendPhotoImpl = vi.fn();
        const sendMessageImpl = vi.fn(async () => ({ sent: true, messageId: '57' }));
        const result = await sendApprovalNotification({
            chatId: '100',
            approval: { blogTitle: 'Draft', blogId: '507f1f77bcf86cd799439011', adminEditUrl: 'https://admin.example.com/admin/blogs/507f1f77bcf86cd799439011', approvalCode: 'ABC', coverImageUrl: '' },
            sendPhotoImpl,
            sendMessageImpl
        });
        expect(result.notificationType).toBe('text');
        expect(sendPhotoImpl).not.toHaveBeenCalled();
        expect(sendMessageImpl).toHaveBeenCalledTimes(1);
    });

    it('processes /start without invoking blog publishing', async () => {
        stubTelegramFetch();
        vi.spyOn(TelegramUpdate, 'create').mockResolvedValue({});
        const publish = vi.spyOn(BlogService, 'publishBlog').mockResolvedValue({});
        const result = await TelegramApprovalService.handleUpdate({
            body: { update_id: 1, message: { text: '/start', chat: { id: 100 }, from: { id: 900, username: 'admin' } } }
        });
        expect(result.command).toBe('start');
        expect(publish).not.toHaveBeenCalled();
    });

    it('ignores a duplicate update_id idempotently', async () => {
        vi.spyOn(TelegramUpdate, 'create').mockRejectedValue(Object.assign(new Error('duplicate'), { code: 11000 }));
        const result = await TelegramApprovalService.handleUpdate({
            body: { update_id: 2, message: { text: '/approve ABC', chat: { id: 100 }, from: { id: 900 } } }
        });
        expect(result).toEqual({ ok: true, duplicate: true });
    });

    it('blocks unauthorized approval commands', async () => {
        process.env.TELEGRAM_ALLOWED_CHAT_IDS = '';
        process.env.TELEGRAM_ALLOWED_USER_IDS = '';
        stubTelegramFetch();
        vi.spyOn(TelegramUpdate, 'create').mockResolvedValue({});
        const publish = vi.spyOn(BlogService, 'publishBlog').mockResolvedValue({});
        const result = await TelegramApprovalService.handleUpdate({
            body: { update_id: 3, message: { text: '/approve ABC', chat: { id: 999 }, from: { id: 901 } } }
        });
        expect(result.unauthorized).toBe(true);
        expect(publish).not.toHaveBeenCalled();
    });

    it('publishes an approved saved draft through BlogService without running agents', async () => {
        stubTelegramFetch();
        vi.spyOn(TelegramUpdate, 'create').mockResolvedValue({});
        vi.spyOn(TelegramBlogApproval, 'findOneAndUpdate').mockReturnValue({
            lean: async () => ({ _id: '507f1f77bcf86cd799439031', blogId: '507f1f77bcf86cd799439011', blogTitle: 'Draft', status: 'processing' })
        });
        vi.spyOn(TelegramBlogApproval, 'updateOne').mockResolvedValue({ modifiedCount: 1 });
        const publish = vi.spyOn(BlogService, 'publishBlog').mockResolvedValue({ title: 'Draft' });
        const result = await TelegramApprovalService.handleUpdate({
            body: { update_id: 4, message: { text: '/approve ABC', chat: { id: 100 }, from: { id: 900, username: 'admin' } } }
        });
        expect(result.status).toBe('approved');
        expect(publish).toHaveBeenCalledWith({ blogId: '507f1f77bcf86cd799439011', sendNewsletter: false });
    });

    it('blocks expired approvals', async () => {
        vi.spyOn(TelegramBlogApproval, 'findOneAndUpdate').mockReturnValue({ lean: async () => null });
        vi.spyOn(TelegramBlogApproval, 'findOne').mockReturnValue({
            lean: async () => ({ _id: '507f1f77bcf86cd799439031', status: 'pending', expiresAt: new Date(Date.now() - 1000) })
        });
        vi.spyOn(TelegramBlogApproval, 'updateOne').mockResolvedValue({ modifiedCount: 1 });
        const publish = vi.spyOn(BlogService, 'publishBlog').mockResolvedValue({});
        const result = await TelegramApprovalService.approveCode({ code: 'ABC', userId: '900', updateId: 5 });
        expect(result.status).toBe('expired');
        expect(publish).not.toHaveBeenCalled();
    });

    it('rejects a pending approval idempotently', async () => {
        vi.spyOn(TelegramBlogApproval, 'findOneAndUpdate').mockReturnValue({
            lean: async () => ({ blogTitle: 'Draft', status: 'rejected' })
        });
        const result = await TelegramApprovalService.rejectCode({ code: 'ABC', userId: '900', updateId: 6 });
        expect(result.status).toBe('rejected');
    });
});

describe('Telegram image safety', () => {
    const publicDns = async () => [{ address: '93.184.216.34', family: 4 }];

    it('blocks SSRF image URLs', async () => {
        await expect(validateTelegramImageUrl({ url: 'https://127.0.0.1/cover.jpg' })).rejects.toThrow();
    });

    it('falls back on invalid image MIME types', async () => {
        await expect(validateTelegramImageUrl({
            url: 'https://cdn.example.com/cover.jpg', resolveHostname: publicDns,
            fetchImpl: async () => new Response('not image', { status: 200, headers: { 'content-type': 'text/html' } })
        })).rejects.toThrow('mime_not_allowed');
    });

    it('rejects oversized images', async () => {
        await expect(validateTelegramImageUrl({
            url: 'https://cdn.example.com/cover.jpg', resolveHostname: publicDns, maxBytes: 4,
            fetchImpl: async () => new Response(new Uint8Array(10), { status: 200, headers: { 'content-type': 'image/jpeg', 'content-length': '10' } })
        })).rejects.toThrow('too_large');
    });

    it('handles image validation timeouts', async () => {
        const fetchImpl = (url, options) => new Promise((resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        });
        await expect(validateTelegramImageUrl({
            url: 'https://cdn.example.com/cover.jpg', resolveHostname: publicDns, timeoutMs: 10, fetchImpl
        })).rejects.toThrow('timeout');
    });

    it('contains no AI or image-generation dependency in Telegram command processing', () => {
        const source = require('node:fs').readFileSync(require.resolve('../src/services/telegramApproval.service'), 'utf8');
        expect(source).not.toMatch(/require\([^)]*(aiBlog|openclaw|imageGenerate|orchestrator)/i);
        expect(source).not.toContain('generateImage');
    });
});
