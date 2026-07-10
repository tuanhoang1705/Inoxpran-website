'use strict'

const crypto = require('node:crypto');
const { TelegramBlogApproval } = require('../models/telegramBlogApproval.model');
const { TelegramUpdate } = require('../models/telegramUpdate.model');
const BlogService = require('./blog.service');
const { BadRequestError, ForbiddenError } = require('../core/error.response');
const { normalizeString } = require('../utils/seoBlogSanitizer');

const DEFAULT_APPROVAL_TTL_HOURS = 72;
const TELEGRAM_API_BASE = 'https://api.telegram.org';

const parseBoolean = (value, fallback = false) => {
    if (typeof value === 'boolean') return value;
    if (typeof value !== 'string') return fallback;
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const parseList = (value) =>
    String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

const isTelegramEnabled = () =>
    parseBoolean(process.env.TELEGRAM_BOT_ENABLED, false) &&
    Boolean(normalizeString(process.env.TELEGRAM_BOT_TOKEN));

const getNotifyChatIds = () => {
    const explicit = parseList(process.env.TELEGRAM_NOTIFY_CHAT_IDS);
    if (explicit.length) return explicit;
    return parseList(process.env.TELEGRAM_ALLOWED_CHAT_IDS);
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
    const provided = normalizeString(
        headers['x-telegram-bot-api-secret-token'] ||
        headers['X-Telegram-Bot-Api-Secret-Token']
    );
    if (!provided || !timingSafeStringEqual(provided, expected)) {
        throw new ForbiddenError('Invalid Telegram webhook secret');
    }
};

const generateApprovalCode = () => crypto.randomBytes(4).toString('hex').toUpperCase();

const parseTelegramCommand = (text = '') => {
    const normalized = normalizeString(text);
    if (!normalized.startsWith('/')) return { command: '', code: '' };
    const [rawCommand, code = ''] = normalized.split(/\s+/, 2);
    const command = rawCommand.replace(/^\/+/, '').split('@')[0].toLowerCase();
    return {
        command,
        code: normalizeString(code).toUpperCase()
    };
};

const buildDraftMessage = ({ approval }) => [
    'Inoxpran OpenClaw draft is ready for review.',
    '',
    `Title: ${approval.blogTitle}`,
    `Slug: ${approval.blogSlug}`,
    approval.blogUrl ? `URL: ${approval.blogUrl}` : '',
    '',
    `Approve: /approve ${approval.approvalCode}`,
    `Reject: /reject ${approval.approvalCode}`,
    'Pending: /pending'
].filter(Boolean).join('\n');

const postTelegram = async ({ token, method, body }) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
        const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/${method}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.ok === false) {
            throw new Error(payload?.description || `telegram_${method}_failed`);
        }
        return payload.result || payload;
    } finally {
        clearTimeout(timeout);
    }
};

const sendMessage = async ({ chatId, text }) => {
    if (!isTelegramEnabled()) {
        return { sent: false, reason: 'telegram_disabled' };
    }
    const token = normalizeString(process.env.TELEGRAM_BOT_TOKEN);
    const result = await postTelegram({
        token,
        method: 'sendMessage',
        body: {
            chat_id: chatId,
            text,
            disable_web_page_preview: true
        }
    });
    return {
        sent: true,
        messageId: result?.message_id ? String(result.message_id) : ''
    };
};

const sendMessageWithRetry = async ({ chatId, text }) => {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            return await sendMessage({ chatId, text });
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError;
};

class TelegramApprovalService {
    static isEnabled() {
        return isTelegramEnabled();
    }

    static validateWebhookSecret({ headers }) {
        validateWebhookSecretHeader(headers);
    }

    static parseCommand(text) {
        return parseTelegramCommand(text);
    }

    static async createDraftApprovalAndNotify({
        blogId,
        blogTitle,
        blogSlug,
        blogUrl,
        scheduleId,
        executionId
    }) {
        const ttlHours = Math.max(1, Number(process.env.TELEGRAM_APPROVAL_TTL_HOURS || DEFAULT_APPROVAL_TTL_HOURS));
        const approval = await TelegramBlogApproval.create({
            blogId,
            blogTitle: normalizeString(blogTitle),
            blogSlug: normalizeString(blogSlug),
            blogUrl: normalizeString(blogUrl),
            scheduleId: scheduleId || null,
            executionId: executionId || null,
            approvalCode: generateApprovalCode(),
            expiresAt: new Date(Date.now() + ttlHours * 60 * 60 * 1000)
        });

        if (!isTelegramEnabled()) {
            return {
                approvalId: String(approval._id),
                approvalCode: approval.approvalCode,
                status: 'not_sent',
                reason: 'telegram_disabled'
            };
        }

        const chatIds = getNotifyChatIds();
        if (!chatIds.length) {
            return {
                approvalId: String(approval._id),
                approvalCode: approval.approvalCode,
                status: 'not_sent',
                reason: 'no_notify_chat_ids'
            };
        }

        const messageText = buildDraftMessage({ approval });
        const sent = [];
        const failed = [];
        for (const chatId of chatIds) {
            try {
                const result = await sendMessageWithRetry({ chatId, text: messageText });
                sent.push({ chatId, messageId: result.messageId || '' });
            } catch (error) {
                failed.push({ chatId, error: error?.message || 'telegram_send_failed' });
            }
        }

        if (sent[0]) {
            approval.telegramChatId = sent[0].chatId;
            approval.telegramMessageId = sent[0].messageId;
            await approval.save();
        }

        return {
            approvalId: String(approval._id),
            approvalCode: approval.approvalCode,
            status: sent.length ? 'sent' : 'failed',
            sent,
            failed
        };
    }

    static async approveCode({ code, userId, username }) {
        const approvalCode = normalizeString(code).toUpperCase();
        if (!approvalCode) throw new BadRequestError('approval code is required');

        const approval = await TelegramBlogApproval.findOne({ approvalCode }).lean();
        if (!approval) throw new BadRequestError('approval code not found');
        if (approval.status !== 'pending') {
            return { status: approval.status, message: `Approval is already ${approval.status}` };
        }
        if (approval.expiresAt && new Date(approval.expiresAt).getTime() < Date.now()) {
            await TelegramBlogApproval.updateOne(
                { _id: approval._id },
                { $set: { status: 'expired' } }
            );
            return { status: 'expired', message: 'Approval code has expired' };
        }

        const published = await BlogService.publishBlog({ blogId: String(approval.blogId), sendNewsletter: false });
        await TelegramBlogApproval.updateOne(
            { _id: approval._id },
            {
                $set: {
                    status: 'approved',
                    approvedAt: new Date(),
                    approvedByTelegramUserId: String(userId || ''),
                    approvedByTelegramUsername: normalizeString(username)
                }
            }
        );
        return {
            status: 'approved',
            message: `Published: ${published?.title || approval.blogTitle}`,
            blog: published
        };
    }

    static async rejectCode({ code, userId, username }) {
        const approvalCode = normalizeString(code).toUpperCase();
        if (!approvalCode) throw new BadRequestError('approval code is required');
        const approval = await TelegramBlogApproval.findOneAndUpdate(
            { approvalCode, status: 'pending' },
            {
                $set: {
                    status: 'rejected',
                    rejectedAt: new Date(),
                    rejectedByTelegramUserId: String(userId || ''),
                    rejectedByTelegramUsername: normalizeString(username)
                }
            },
            { new: true }
        ).lean();
        if (!approval) return { status: 'not_found', message: 'No pending approval found for that code' };
        return { status: 'rejected', message: `Rejected: ${approval.blogTitle || approvalCode}` };
    }

    static async listPending({ limit = 10 } = {}) {
        const approvals = await TelegramBlogApproval.find({
            status: 'pending',
            $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }]
        })
            .sort({ createdAt: -1 })
            .limit(Math.min(Math.max(Number(limit) || 10, 1), 20))
            .lean();
        return approvals.map((approval) => ({
            code: approval.approvalCode,
            title: approval.blogTitle,
            slug: approval.blogSlug,
            expiresAt: approval.expiresAt
        }));
    }

    static async handleWebhook({ headers, body }) {
        validateWebhookSecretHeader(headers);
        if (!isTelegramEnabled()) return { ok: true, ignored: true, reason: 'telegram_disabled' };

        const updateId = Number(body?.update_id);
        if (!Number.isInteger(updateId)) return { ok: true, ignored: true, reason: 'missing_update_id' };

        const message = body?.message || body?.edited_message || body?.channel_post || null;
        const text = normalizeString(message?.text);
        const chatId = String(message?.chat?.id || '');
        const userId = String(message?.from?.id || '');
        const username = normalizeString(message?.from?.username || message?.from?.first_name || '');
        const parsed = parseTelegramCommand(text);

        try {
            await TelegramUpdate.create({
                updateId,
                chatId,
                userId,
                command: parsed.command || ''
            });
        } catch (error) {
            if (error?.code === 11000) return { ok: true, duplicate: true };
            throw error;
        }

        if (!message || !text || !parsed.command) {
            return { ok: true, ignored: true, reason: 'not_a_command' };
        }

        if (!isAuthorizedTelegramActor({ chatId, userId })) {
            if (chatId) {
                await sendMessageWithRetry({ chatId, text: 'Unauthorized Telegram account.' }).catch(() => null);
            }
            return { ok: true, unauthorized: true };
        }

        if (parsed.command === 'pending') {
            const approvals = await TelegramApprovalService.listPending();
            const textReply = approvals.length
                ? approvals.map((item) => `/approve ${item.code} - ${item.title}`).join('\n')
                : 'No pending blog approvals.';
            await sendMessageWithRetry({ chatId, text: textReply });
            return { ok: true, command: 'pending', count: approvals.length };
        }

        if (parsed.command === 'approve') {
            let result;
            try {
                result = await TelegramApprovalService.approveCode({
                    code: parsed.code,
                    userId,
                    username
                });
            } catch (error) {
                result = {
                    status: 'failed',
                    message: error?.message || 'Approve failed'
                };
            }
            await sendMessageWithRetry({ chatId, text: result.message || result.status });
            return { ok: true, command: 'approve', status: result.status };
        }

        if (parsed.command === 'reject') {
            const result = await TelegramApprovalService.rejectCode({
                code: parsed.code,
                userId,
                username
            });
            await sendMessageWithRetry({ chatId, text: result.message || result.status });
            return { ok: true, command: 'reject', status: result.status };
        }

        await sendMessageWithRetry({
            chatId,
            text: 'Supported commands: /pending, /approve CODE, /reject CODE'
        });
        return { ok: true, ignored: true, reason: 'unsupported_command' };
    }
}

module.exports = {
    TelegramApprovalService,
    isAuthorizedTelegramActor,
    parseTelegramCommand,
    timingSafeStringEqual
};
