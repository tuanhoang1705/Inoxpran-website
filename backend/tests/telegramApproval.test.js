import { beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const {
    TelegramApprovalService,
    isAuthorizedTelegramActor,
    parseTelegramCommand,
    timingSafeStringEqual
} = require('../src/services/telegramApproval.service');

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
    process.env = {
        ...ORIGINAL_ENV,
        TELEGRAM_BOT_ENABLED: 'true',
        TELEGRAM_BOT_TOKEN: 'test-token',
        TELEGRAM_WEBHOOK_SECRET: 'webhook-secret',
        TELEGRAM_ALLOWED_CHAT_IDS: '100,200',
        TELEGRAM_ALLOWED_USER_IDS: '900'
    };
});

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
});
