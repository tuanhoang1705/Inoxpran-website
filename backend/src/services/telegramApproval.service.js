'use strict'

const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { TelegramBlogApproval } = require('../models/telegramBlogApproval.model');
const { TelegramUpdate } = require('../models/telegramUpdate.model');
const { blog: Blog } = require('../models/blog.model');
const BlogService = require('./blog.service');
const { BadRequestError, ForbiddenError } = require('../core/error.response');
const { normalizeString } = require('../utils/seoBlogSanitizer');
const { validateTelegramImageUrl } = require('./telegramImageSafety.service');

const DEFAULT_APPROVAL_TTL_HOURS = 72;
const TELEGRAM_API_BASE = String(process.env.TELEGRAM_API_BASE || '').trim().replace(/\/+$/, '') || 'https://api.telegram.org';
const DEFAULT_ADMIN_BASE_URL = 'http://localhost:5173';

const parseBoolean = (value, fallback = false) => {
    if (typeof value === 'boolean') return value;
    if (typeof value !== 'string') return fallback;
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const parseList = (value) => String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
const getTelegramMode = () => normalizeString(process.env.TELEGRAM_MODE || 'webhook').toLowerCase() === 'polling' ? 'polling' : 'webhook';
const isHttpsAdminBaseUrl = (value = process.env.ADMIN_BASE_URL) => {
    try {
        const parsed = new URL(normalizeString(value));
        return parsed.protocol === 'https:' && Boolean(parsed.hostname) && !parsed.username && !parsed.password;
    } catch {
        return false;
    }
};
const getNotifyChatIds = () => {
    const explicit = parseList(process.env.TELEGRAM_NOTIFY_CHAT_IDS);
    return explicit.length ? explicit : parseList(process.env.TELEGRAM_ALLOWED_CHAT_IDS);
};
const isTelegramEnabled = () => {
    if (!parseBoolean(process.env.TELEGRAM_BOT_ENABLED, false)) return false;
    if (!normalizeString(process.env.TELEGRAM_BOT_TOKEN) || !isHttpsAdminBaseUrl()) return false;
    if (!parseList(process.env.TELEGRAM_ALLOWED_CHAT_IDS).length && !parseList(process.env.TELEGRAM_ALLOWED_USER_IDS).length) return false;
    if (!getNotifyChatIds().length) return false;
    return getTelegramMode() !== 'webhook' || Boolean(normalizeString(process.env.TELEGRAM_WEBHOOK_SECRET));
};

const isAuthorizedTelegramActor = ({ chatId, userId }) => {
    const chatAllowlist = new Set(parseList(process.env.TELEGRAM_ALLOWED_CHAT_IDS));
    const userAllowlist = new Set(parseList(process.env.TELEGRAM_ALLOWED_USER_IDS));
    if (!chatAllowlist.size && !userAllowlist.size) return false;
    return chatAllowlist.has(String(chatId || '')) || userAllowlist.has(String(userId || ''));
};

const timingSafeStringEqual = (left, right) => {
    const leftHash = crypto.createHash('sha256').update(String(left || '')).digest();
    const rightHash = crypto.createHash('sha256').update(String(right || '')).digest();
    return crypto.timingSafeEqual(leftHash, rightHash);
};

const validateWebhookSecretHeader = (headers = {}) => {
    const expected = normalizeString(process.env.TELEGRAM_WEBHOOK_SECRET);
    if (!expected) throw new ForbiddenError('Telegram webhook secret is not configured');
    const provided = normalizeString(headers['x-telegram-bot-api-secret-token'] || headers['X-Telegram-Bot-Api-Secret-Token']);
    if (!provided || !timingSafeStringEqual(provided, expected)) throw new ForbiddenError('Invalid Telegram webhook secret');
};

const assertBlogId = (blogId) => {
    const value = normalizeString(blogId);
    if (!value || !mongoose.isValidObjectId(value)) throw new BadRequestError('A valid blogId is required for Telegram approval');
    return value;
};

const buildAdminEditUrl = (blogId, baseUrl = process.env.ADMIN_BASE_URL || DEFAULT_ADMIN_BASE_URL) => {
    const validBlogId = assertBlogId(blogId);
    const normalizedBase = normalizeString(baseUrl).replace(/\/+$/g, '');
    if (!/^https?:\/\//i.test(normalizedBase)) throw new BadRequestError('ADMIN_BASE_URL must be an absolute HTTP(S) URL');
    return `${normalizedBase}/admin/blogs/${validBlogId}`;
};

const resolveCoverImageUrl = (value) => {
    const image = normalizeString(value);
    if (!image) return '';
    if (/^https:\/\//i.test(image)) return image;
    if (/^http:\/\//i.test(image)) return image;
    if (!image.startsWith('/')) return '';
    const base = normalizeString(process.env.PUBLIC_SITE_URL || process.env.APP_BASE_URL || 'https://inoxpran.com').replace(/\/+$/g, '');
    return `${base}${image}`;
};

const generateApprovalCode = () => crypto.randomBytes(4).toString('hex').toUpperCase();
const parseTelegramCommand = (text = '') => {
    const normalized = normalizeString(text);
    if (!normalized.startsWith('/')) return { command: '', code: '' };
    const [rawCommand, code = ''] = normalized.split(/\s+/, 2);
    return { command: rawCommand.replace(/^\/+/, '').split('@')[0].toLowerCase(), code: normalizeString(code).toUpperCase() };
};

const buildHelpMessage = () => [
    'INOXPRAN blog approval commands',
    '/whoami — show your Telegram user/chat IDs',
    '/pending — list pending draft approvals',
    '/approve CODE — publish an approved saved draft',
    '/reject CODE — reject a draft approval',
    '/help — show this help',
    '',
    'Telegram commands never run AI or regenerate content.'
].join('\n');

const buildCommandResponse = ({ command, chatId, userId, username }) => {
    if (command === 'start') return `INOXPRAN approval bot is ready.\n\n${buildHelpMessage()}`;
    if (command === 'help') return buildHelpMessage();
    if (command === 'whoami') return [
        'Your Telegram identifiers:',
        `User ID: ${userId || '(not provided)'}`,
        `Chat ID: ${chatId || '(not provided)'}`,
        `Username: ${username ? `@${username}` : '(not provided)'}`
    ].join('\n');
    return '';
};

const buildDraftLines = ({ approval, compact = false }) => {
    const metadata = approval.reviewMetadata || {};
    const lines = [
        'INOXPRAN — Draft ready for admin review',
        '',
        `Title: ${approval.blogTitle}`,
        `Blog ID: ${approval.blogId}`,
        `Admin editor: ${approval.adminEditUrl}`,
        metadata.snapshotStatus ? `Google Intelligence: ${metadata.snapshotStatus}` : '',
        metadata.styleFamily ? `Editorial style: ${metadata.styleFamily}` : '',
        metadata.reviewStatus ? `Quality gates: ${metadata.reviewStatus}` : '',
        '',
        `Approve: /approve ${approval.approvalCode}`,
        `Reject: /reject ${approval.approvalCode}`,
        compact ? '' : 'Pending: /pending'
    ];
    return lines.filter((line) => line !== '').join('\n');
};

const buildDraftMessage = ({ approval }) => buildDraftLines({ approval, compact: false });
const buildDraftCaption = ({ approval }) => buildDraftLines({ approval, compact: true }).slice(0, 1024);

const TRANSIENT_TELEGRAM_ERROR = /timeout|fetch failed|econnres|etimedout|econnrefused|socket|network|und_err|eai_again/i;

const postTelegram = async ({ token, method, body, fetchImpl = global.fetch, timeoutMs = 12_000, attempts = 3 }) => {
    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetchImpl(`${TELEGRAM_API_BASE}/bot${token}/${method}`, {
                method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || payload?.ok === false) throw new Error(payload?.description || `telegram_${method}_failed`);
            return payload.result || payload;
        } catch (error) {
            const causeCode = error?.cause?.code ? ` (${error.cause.code})` : '';
            lastError = error?.name === 'AbortError'
                ? new Error(`telegram_${method}_timeout`)
                : new Error(`${error?.message || `telegram_${method}_failed`}${causeCode}`);
            const retryable = error?.name === 'AbortError' || TRANSIENT_TELEGRAM_ERROR.test(`${error?.message || ''} ${error?.cause?.code || ''}`);
            if (!retryable || attempt === attempts) throw lastError;
            await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
        } finally {
            clearTimeout(timeout);
        }
    }
    throw lastError;
};

const sendMessage = async ({ chatId, text, token = normalizeString(process.env.TELEGRAM_BOT_TOKEN), postTelegramImpl = postTelegram }) => {
    if (!isTelegramEnabled()) return { sent: false, reason: 'telegram_disabled' };
    const result = await postTelegramImpl({
        token, method: 'sendMessage',
        body: { chat_id: chatId, text, disable_web_page_preview: true }
    });
    return { sent: true, messageId: result?.message_id ? String(result.message_id) : '' };
};

const sendMessageWithRetry = async (args) => {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try { return await sendMessage(args); } catch (error) { lastError = error; }
    }
    throw lastError;
};

// Storage download URLs carry a read token, so the image is uploaded as bytes
// rather than handed to Telegram as a link. Passing the link would leak a working
// credential to a third party, which the URL guard refuses outright.
const uploadPhoto = async ({ chatId, bytes, mimeType, caption, adminEditUrl, token, fetchImpl = global.fetch, timeoutMs = 20_000 }) => {
    const form = new FormData();
    form.set('chat_id', String(chatId));
    if (caption) form.set('caption', caption);
    form.set('reply_markup', JSON.stringify({
        inline_keyboard: adminEditUrl ? [[{ text: 'Open admin editor', url: adminEditUrl }]] : []
    }));
    form.set('photo', new Blob([bytes], { type: mimeType || 'image/jpeg' }), 'cover.webp');

    const response = await fetchImpl(`${TELEGRAM_API_BASE}/bot${token}/sendPhoto`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(timeoutMs)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.description || `telegram_sendPhoto_failed_${response.status}`);
    }
    return payload.result || payload;
};

const sendPhoto = async ({
    chatId,
    photo,
    photoBytes = null,
    photoMimeType = '',
    caption,
    adminEditUrl,
    token = normalizeString(process.env.TELEGRAM_BOT_TOKEN),
    postTelegramImpl = postTelegram,
    uploadPhotoImpl = uploadPhoto
}) => {
    if (photoBytes?.byteLength) {
        const uploaded = await uploadPhotoImpl({
            chatId, bytes: photoBytes, mimeType: photoMimeType, caption, adminEditUrl, token
        });
        return { sent: true, messageId: uploaded?.message_id ? String(uploaded.message_id) : '' };
    }
    const result = await postTelegramImpl({
        token, method: 'sendPhoto',
        body: {
            chat_id: chatId, photo, caption,
            reply_markup: { inline_keyboard: adminEditUrl ? [[{ text: 'Open admin editor', url: adminEditUrl }]] : [] }
        }
    });
    return { sent: true, messageId: result?.message_id ? String(result.message_id) : '' };
};

const sendApprovalNotification = async ({
    chatId,
    approval,
    validateImageImpl = validateTelegramImageUrl,
    sendPhotoImpl = sendPhoto,
    sendMessageImpl = sendMessageWithRetry
}) => {
    let photoError = '';
    if (approval.coverImageUrl) {
        try {
            const validated = await validateImageImpl({ url: approval.coverImageUrl });
            const result = await sendPhotoImpl({
                chatId,
                photo: validated.canonicalUrl,
                photoBytes: validated.bytes,
                photoMimeType: validated.mimeType,
                caption: buildDraftCaption({ approval }),
                adminEditUrl: approval.adminEditUrl
            });
            return { ...result, notificationType: 'photo', notificationStatus: 'sent', notificationError: '' };
        } catch (error) {
            photoError = normalizeString(error?.message || 'telegram_photo_failed').slice(0, 500);
        }
    }
    const result = await sendMessageImpl({ chatId, text: buildDraftMessage({ approval }) });
    return {
        ...result,
        notificationType: approval.coverImageUrl ? 'text_fallback' : 'text',
        notificationStatus: approval.coverImageUrl ? 'photo_failed_text_sent' : 'sent',
        notificationError: photoError
    };
};

class TelegramApprovalService {
    static isEnabled() { return isTelegramEnabled(); }
    static mode() { return getTelegramMode(); }
    static status() {
        return {
            enabled: isTelegramEnabled(), mode: getTelegramMode(),
            tokenConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
            allowlistConfigured: Boolean(process.env.TELEGRAM_ALLOWED_CHAT_IDS || process.env.TELEGRAM_ALLOWED_USER_IDS),
            webhookSecretConfigured: Boolean(process.env.TELEGRAM_WEBHOOK_SECRET),
            adminBaseUrlConfigured: Boolean(process.env.ADMIN_BASE_URL),
            adminBaseUrlHttps: isHttpsAdminBaseUrl()
        };
    }
    static validateWebhookSecret({ headers }) { validateWebhookSecretHeader(headers); }
    static parseCommand(text) { return parseTelegramCommand(text); }

    // Operator-facing alert that carries no approval code: it reports a condition
    // someone has to act on, rather than asking for a publish decision.
    static async notifyOperators({ text, sendMessageImpl = sendMessageWithRetry }) {
        if (!isTelegramEnabled()) return { sent: false, reason: 'telegram_disabled' };
        const chatIds = getNotifyChatIds();
        if (!chatIds.length) return { sent: false, reason: 'telegram_no_notify_chat' };
        const failures = [];
        for (const chatId of chatIds) {
            try {
                await sendMessageImpl({ chatId, text });
            } catch (error) {
                failures.push(error?.message || 'telegram_notify_failed');
            }
        }
        if (failures.length === chatIds.length) {
            return { sent: false, reason: failures[0] };
        }
        return { sent: true, reason: failures[0] || '' };
    }

    static async createDraftApprovalAndNotify({
        blogId, blogTitle, blogSlug, scheduleId, executionId,
        coverImageUrl = '', snapshotStatus = '', styleFamily = '', reviewStatus = ''
    }) {
        const validBlogId = assertBlogId(blogId);
        const savedBlog = await Blog.findById(validBlogId).select('blog_title blog_slug blog_image coverImage isDraft isPublished isQaTest qaBatchId qaCaseId').lean();
        if (!savedBlog) throw new BadRequestError('Blog draft not found for Telegram approval');
        if (savedBlog.isQaTest === true) {
            return {
                approvalId: '',
                approvalCode: '',
                status: 'not_sent',
                reason: 'qa_telegram_forbidden'
            };
        }
        const idempotencyKey = `blog-approval:${validBlogId}:${String(executionId || scheduleId || 'manual')}`;
        const ttlHours = Math.max(1, Number(process.env.TELEGRAM_APPROVAL_TTL_HOURS || DEFAULT_APPROVAL_TTL_HOURS));
        let approval = await TelegramBlogApproval.findOne({ idempotencyKey });
        if (!approval) {
            try {
                approval = await TelegramBlogApproval.create({
                    blogId: validBlogId,
                    blogTitle: normalizeString(blogTitle || savedBlog.blog_title),
                    blogSlug: normalizeString(blogSlug || savedBlog.blog_slug),
                    blogUrl: '',
                    adminEditUrl: buildAdminEditUrl(validBlogId),
                    coverImageUrl: resolveCoverImageUrl(coverImageUrl || savedBlog.coverImage?.url || savedBlog.blog_image),
                    scheduleId: scheduleId || null,
                    executionId: executionId || null,
                    idempotencyKey,
                    approvalCode: generateApprovalCode(),
                    expiresAt: new Date(Date.now() + ttlHours * 60 * 60 * 1000)
                });
            } catch (error) {
                if (error?.code !== 11000) throw error;
                approval = await TelegramBlogApproval.findOne({ idempotencyKey });
            }
        }
        if (!approval) throw new BadRequestError('Unable to create Telegram approval');
        approval.reviewMetadata = { snapshotStatus, styleFamily, reviewStatus };
        if (approval.notificationStatus && approval.notifiedAt) {
            return { approvalId: String(approval._id), approvalCode: approval.approvalCode, status: approval.notificationStatus, duplicate: true };
        }
        if (!isTelegramEnabled()) {
            approval.notificationType = 'disabled';
            approval.notificationStatus = 'not_sent';
            approval.notificationError = 'telegram_disabled';
            await approval.save();
            return { approvalId: String(approval._id), approvalCode: approval.approvalCode, status: 'not_sent', reason: 'telegram_disabled' };
        }
        const chatIds = getNotifyChatIds();
        if (!chatIds.length) {
            approval.notificationType = 'disabled';
            approval.notificationStatus = 'not_sent';
            approval.notificationError = 'no_notify_chat_ids';
            await approval.save();
            return { approvalId: String(approval._id), approvalCode: approval.approvalCode, status: 'not_sent', reason: 'no_notify_chat_ids' };
        }

        const sent = [];
        const failed = [];
        for (const chatId of chatIds) {
            try {
                const result = await sendApprovalNotification({ chatId, approval });
                sent.push({ chatId, ...result });
            } catch (error) {
                failed.push({ chatId, error: normalizeString(error?.message || 'telegram_send_failed').slice(0, 500) });
            }
        }
        const primary = sent[0];
        approval.notificationType = primary?.notificationType || (approval.coverImageUrl ? 'text_fallback' : 'text');
        approval.notificationStatus = sent.length ? primary.notificationStatus : 'failed';
        approval.notificationError = [primary?.notificationError, ...failed.map((item) => item.error)].filter(Boolean).join('; ').slice(0, 500);
        approval.notifiedAt = sent.length ? new Date() : null;
        if (primary) {
            approval.telegramChatId = primary.chatId;
            approval.telegramMessageId = primary.messageId || '';
        }
        await approval.save();
        return {
            approvalId: String(approval._id), approvalCode: approval.approvalCode,
            status: sent.length ? 'sent' : 'failed', notificationType: approval.notificationType,
            notificationStatus: approval.notificationStatus, sent, failed,
            // A photo that failed while the text went through is still a fault the
            // operator has to see, so the reason is reported on partial success too.
            reason: failed[0]?.error
                || approval.notificationError
                || (sent.length ? '' : 'telegram_send_failed')
        };
    }

    static async approveCode({ code, userId, username, updateId = null }) {
        const approvalCode = normalizeString(code).toUpperCase();
        if (!approvalCode) throw new BadRequestError('approval code is required');
        const now = new Date();
        const approval = await TelegramBlogApproval.findOneAndUpdate(
            { approvalCode, status: 'pending', $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] },
            { $set: { status: 'processing', processedUpdateId: updateId } },
            { new: true }
        ).lean();
        if (!approval) {
            const current = await TelegramBlogApproval.findOne({ approvalCode }).lean();
            if (!current) throw new BadRequestError('approval code not found');
            if (current.status === 'pending' && current.expiresAt && new Date(current.expiresAt) <= now) {
                await TelegramBlogApproval.updateOne({ _id: current._id, status: 'pending' }, { $set: { status: 'expired', processedUpdateId: updateId } });
                return { status: 'expired', message: 'Approval code has expired' };
            }
            return { status: current.status, message: `Approval is already ${current.status}` };
        }
        try {
            const published = await BlogService.publishBlog({ blogId: String(approval.blogId), sendNewsletter: false });
            await TelegramBlogApproval.updateOne({ _id: approval._id, status: 'processing' }, {
                $set: {
                    status: 'approved', approvedAt: new Date(), processedUpdateId: updateId,
                    approvedByTelegramUserId: String(userId || ''), approvedByTelegramUsername: normalizeString(username)
                }
            });
            // The article is live at this point, so verification is a safeguard
            // and never a condition of the approval: a failure here is recorded
            // and must not revert a publication that already succeeded. Required
            // lazily because automationSeoBlog requires this module for operator
            // alerts, and a top-level import would close that cycle.
            let verification = { verified: false, reason: 'not_attempted' };
            try {
                const AutomationSeoBlogService = require('./automationSeoBlog.service');
                const outcome = await AutomationSeoBlogService.verifyApprovedPublication({
                    blogId: String(approval.blogId),
                    executionId: approval.executionId ? String(approval.executionId) : null
                });
                verification = {
                    verified: Boolean(outcome?.verified),
                    reason: normalizeString(outcome?.reason),
                    verificationId: outcome?.verification?._id ? String(outcome.verification._id) : '',
                    checkedAt: new Date()
                };
            } catch (verificationError) {
                verification = {
                    verified: false,
                    reason: normalizeString(verificationError?.code || verificationError?.message).slice(0, 300),
                    verificationId: '',
                    checkedAt: new Date()
                };
            }
            await TelegramBlogApproval.updateOne(
                { _id: approval._id },
                { $set: { 'reviewMetadata.postPublishVerification': verification } }
            ).catch(() => null);
            const publishedTitle = published?.title || approval.blogTitle;
            return {
                status: 'approved',
                message: verification.verified
                    ? `Published: ${publishedTitle}`
                    : `Published: ${publishedTitle} (chưa xác minh được: ${verification.reason || 'unknown'})`,
                blog: published,
                verification
            };
        } catch (error) {
            await TelegramBlogApproval.updateOne({ _id: approval._id, status: 'processing' }, { $set: { status: 'pending' } });
            throw error;
        }
    }

    static async rejectCode({ code, userId, username, updateId = null }) {
        const approvalCode = normalizeString(code).toUpperCase();
        if (!approvalCode) throw new BadRequestError('approval code is required');
        const approval = await TelegramBlogApproval.findOneAndUpdate(
            { approvalCode, status: 'pending', $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] },
            { $set: { status: 'rejected', rejectedAt: new Date(), processedUpdateId: updateId, rejectedByTelegramUserId: String(userId || ''), rejectedByTelegramUsername: normalizeString(username) } },
            { new: true }
        ).lean();
        if (!approval) return { status: 'not_found', message: 'No pending approval found for that code' };
        return { status: 'rejected', message: `Rejected: ${approval.blogTitle || approvalCode}` };
    }

    static async listPending({ limit = 10 } = {}) {
        const approvals = await TelegramBlogApproval.find({ status: 'pending', $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] })
            .sort({ createdAt: -1 }).limit(Math.min(Math.max(Number(limit) || 10, 1), 20)).lean();
        return approvals.map((approval) => ({
            code: approval.approvalCode, title: approval.blogTitle, blogId: String(approval.blogId),
            adminEditUrl: approval.adminEditUrl || buildAdminEditUrl(String(approval.blogId)), expiresAt: approval.expiresAt
        }));
    }

    static async handleUpdate({ body }) {
        const updateId = Number(body?.update_id);
        if (!Number.isInteger(updateId)) return { ok: true, ignored: true, reason: 'missing_update_id' };
        const message = body?.message || body?.edited_message || body?.channel_post || null;
        const text = normalizeString(message?.text);
        const chatId = String(message?.chat?.id || '');
        const userId = String(message?.from?.id || '');
        const username = normalizeString(message?.from?.username || message?.from?.first_name || '');
        const parsed = parseTelegramCommand(text);
        try {
            await TelegramUpdate.create({ updateId, chatId, userId, command: parsed.command || '' });
        } catch (error) {
            if (error?.code === 11000) return { ok: true, duplicate: true };
            throw error;
        }
        if (!message || !text || !parsed.command) return { ok: true, ignored: true, reason: 'not_a_command' };

        const safeResponse = buildCommandResponse({ command: parsed.command, chatId, userId, username });
        if (safeResponse) {
            await sendMessageWithRetry({ chatId, text: safeResponse });
            return { ok: true, command: parsed.command };
        }

        if (!isAuthorizedTelegramActor({ chatId, userId })) {
            if (chatId) await sendMessageWithRetry({ chatId, text: 'Unauthorized Telegram account. Use /whoami to view the IDs an administrator must allowlist.' }).catch(() => null);
            return { ok: true, unauthorized: true };
        }
        if (parsed.command === 'pending') {
            const approvals = await TelegramApprovalService.listPending();
            const reply = approvals.length
                ? approvals.map((item) => `/approve ${item.code} — ${item.title}\n${item.adminEditUrl}`).join('\n\n')
                : 'No pending blog approvals.';
            await sendMessageWithRetry({ chatId, text: reply });
            return { ok: true, command: 'pending', count: approvals.length };
        }
        if (parsed.command === 'approve') {
            let result;
            try { result = await TelegramApprovalService.approveCode({ code: parsed.code, userId, username, updateId }); }
            catch (error) { result = { status: 'failed', message: error?.message || 'Approve failed' }; }
            await sendMessageWithRetry({ chatId, text: result.message || result.status });
            return { ok: true, command: 'approve', status: result.status };
        }
        if (parsed.command === 'reject') {
            const result = await TelegramApprovalService.rejectCode({ code: parsed.code, userId, username, updateId });
            await sendMessageWithRetry({ chatId, text: result.message || result.status });
            return { ok: true, command: 'reject', status: result.status };
        }
        await sendMessageWithRetry({ chatId, text: buildHelpMessage() });
        return { ok: true, ignored: true, reason: 'unsupported_command' };
    }

    static async handleWebhook({ headers, body }) {
        validateWebhookSecretHeader(headers);
        if (!isTelegramEnabled()) return { ok: true, ignored: true, reason: 'telegram_disabled' };
        return TelegramApprovalService.handleUpdate({ body });
    }

    static async pollOnce({ offset = 0, postTelegramImpl = postTelegram } = {}) {
        if (!isTelegramEnabled() || getTelegramMode() !== 'polling') return { offset, ignored: true };
        const updates = await postTelegramImpl({
            token: normalizeString(process.env.TELEGRAM_BOT_TOKEN), method: 'getUpdates', timeoutMs: 35_000,
            body: { offset, timeout: 25, allowed_updates: ['message', 'edited_message', 'channel_post'] }
        });
        let nextOffset = offset;
        for (const update of Array.isArray(updates) ? updates : []) {
            await TelegramApprovalService.handleUpdate({ body: update });
            nextOffset = Math.max(nextOffset, Number(update.update_id) + 1);
        }
        return { offset: nextOffset, count: Array.isArray(updates) ? updates.length : 0 };
    }
}

module.exports = {
    TelegramApprovalService,
    buildAdminEditUrl,
    buildCommandResponse,
    buildDraftCaption,
    buildDraftMessage,
    buildHelpMessage,
    getTelegramMode,
    isHttpsAdminBaseUrl,
    isAuthorizedTelegramActor,
    parseTelegramCommand,
    postTelegram,
    resolveCoverImageUrl,
    sendApprovalNotification,
    timingSafeStringEqual
};
