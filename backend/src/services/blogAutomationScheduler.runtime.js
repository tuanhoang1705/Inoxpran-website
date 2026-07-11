'use strict'

const os = require('node:os');
const { BlogAutomationScheduleService, isCronEnabled } = require('./blogAutomationSchedule.service');
const { GoogleIntelligenceService } = require('./googleIntelligence.service');

const DEFAULT_POLL_MS = 30_000;
const MIN_POLL_MS = 5_000;

let timer = null;
let running = false;
let workerId = '';

const getPollMs = () =>
    Math.max(MIN_POLL_MS, Number(process.env.OPENCLAW_BLOG_CRON_POLL_MS || DEFAULT_POLL_MS));

const buildWorkerId = () =>
    `openclaw-blog-cron:${os.hostname()}:${process.pid}:${Date.now().toString(36)}`;

const tick = async () => {
    if (running) return;
    if (!isCronEnabled() && process.env.GOOGLE_INTELLIGENCE_ENABLED !== 'true') return;
    running = true;
    try {
        await GoogleIntelligenceService.runDueOnce({ workerId }).catch((error) => {
            console.error('Google Intelligence scheduler tick failed:', error?.message || error);
            return null;
        });
        for (let i = 0; i < 3; i += 1) {
            const result = await BlogAutomationScheduleService.runDueOnce({ workerId });
            if (!result) break;
        }
    } catch (error) {
        console.error('OpenClaw blog scheduler tick failed:', error?.message || error);
    } finally {
        running = false;
    }
};

const startBlogAutomationScheduler = () => {
    if (timer) return { started: false, workerId };
    workerId = buildWorkerId();
    timer = setInterval(tick, getPollMs());
    timer.unref?.();
    tick();
    return { started: true, workerId };
};

const stopBlogAutomationScheduler = () => {
    if (!timer) return { stopped: false };
    clearInterval(timer);
    timer = null;
    running = false;
    return { stopped: true };
};

module.exports = {
    startBlogAutomationScheduler,
    stopBlogAutomationScheduler,
    tick
};
