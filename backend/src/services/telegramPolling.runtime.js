'use strict'

const { TelegramApprovalService } = require('./telegramApproval.service');

let timer = null;
let running = false;
let offset = 0;

const tick = async () => {
    if (running || !TelegramApprovalService.isEnabled() || TelegramApprovalService.mode() !== 'polling') return;
    running = true;
    try {
        const result = await TelegramApprovalService.pollOnce({ offset });
        offset = Number(result.offset || offset);
    } catch (error) {
        console.error('Telegram polling failed:', error?.message || error);
    } finally {
        running = false;
    }
};

const startTelegramPolling = () => {
    if (timer || !TelegramApprovalService.isEnabled() || TelegramApprovalService.mode() !== 'polling') {
        return { started: false, mode: TelegramApprovalService.mode() };
    }
    timer = setInterval(tick, Math.max(1000, Number(process.env.TELEGRAM_POLL_INTERVAL_MS || 1500)));
    timer.unref?.();
    tick();
    return { started: true, mode: 'polling' };
};

const stopTelegramPolling = () => {
    if (!timer) return { stopped: false };
    clearInterval(timer);
    timer = null;
    running = false;
    return { stopped: true };
};

module.exports = { startTelegramPolling, stopTelegramPolling, tick };
