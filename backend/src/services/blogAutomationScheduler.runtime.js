'use strict'

const os = require('node:os');
const { BlogAutomationScheduleService, isCronEnabled, isSeoAgentEnabled } = require('./blogAutomationSchedule.service');
const { GoogleIntelligenceService } = require('./googleIntelligence.service');
const {
    ContentOperationsScheduleService,
    isContentOperationsScheduleEnabled
} = require('./contentOperations/contentOperationsSchedule.service');
const { PerformanceLearningService } = require('./contentOperations/performanceLearning.service');
const { safeErrorCode } = require('../utils/httpError.util');
const { getContentOperationsConfig } = require('../config/contentOperations.config');
const { readBoolean: readStrictBoolean } = require('../config/agenticBlogQa.config');

const DEFAULT_POLL_MS = 30_000;
const MIN_POLL_MS = 5_000;
const MAX_POLL_MS = 5 * 60 * 1000;

let timer = null;
let running = false;
let workerId = '';
let registeredAt = null;
let lastHeartbeatAt = null;
let lastTickStartedAt = null;
let lastTickCompletedAt = null;
let lastSuccessfulTickAt = null;
let lastErrorCode = '';
let tickCount = 0;

const getPollMs = (value = process.env.OPENCLAW_BLOG_CRON_POLL_MS) => {
    if (value === undefined || value === null || String(value).trim() === '') return DEFAULT_POLL_MS;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < MIN_POLL_MS || parsed > MAX_POLL_MS) return DEFAULT_POLL_MS;
    return parsed;
};

const isGoogleIntelligenceEnabled = () => readStrictBoolean(
    process.env.GOOGLE_INTELLIGENCE_ENABLED,
    false,
    'GOOGLE_INTELLIGENCE_ENABLED'
);

const buildWorkerId = () =>
    `openclaw-blog-cron:${os.hostname()}:${process.pid}:${Date.now().toString(36)}`;

const isPerformanceMonitoringEnabled = () => {
    const config = getContentOperationsConfig();
    return config.enabled && config.performanceMonitoring.enabled;
};

const tick = async () => {
    const startedAt = new Date();
    lastHeartbeatAt = startedAt;
    if (running) return;
    lastTickStartedAt = startedAt;
    tickCount += 1;
    const tickErrors = [];
    if (!isSeoAgentEnabled() && !isCronEnabled() && !isGoogleIntelligenceEnabled() && !isContentOperationsScheduleEnabled() && !isPerformanceMonitoringEnabled()) {
        lastTickCompletedAt = new Date();
        lastSuccessfulTickAt = lastTickCompletedAt;
        lastErrorCode = '';
        return;
    }
    running = true;
    try {
        for (let i = 0; i < 3; i += 1) {
            const recovered = await BlogAutomationScheduleService.runQueuedOnce({ workerId }).catch((error) => {
                const errorCode = safeErrorCode(error);
                tickErrors.push(errorCode);
                console.error('Queued blog execution recovery failed:', errorCode);
                return null;
            });
            if (!recovered) break;
        }
        await GoogleIntelligenceService.runDueOnce({ workerId }).catch((error) => {
            const errorCode = safeErrorCode(error);
            tickErrors.push(errorCode);
            console.error('Google Intelligence scheduler tick failed:', errorCode);
            return null;
        });
        await ContentOperationsScheduleService.runDueOnce({ workerId }).catch((error) => {
            const errorCode = safeErrorCode(error);
            tickErrors.push(errorCode);
            console.error('Content Operations scheduler tick failed:', errorCode);
            return null;
        });
        for (let i = 0; i < 3; i += 1) {
            const result = await PerformanceLearningService.runDueOnce({ workerId }).catch((error) => {
                const errorCode = safeErrorCode(error);
                tickErrors.push(errorCode);
                console.error('Content performance monitoring tick failed:', errorCode);
                return null;
            });
            if (!result) break;
        }
        for (let i = 0; i < 3; i += 1) {
            const result = await BlogAutomationScheduleService.runDueOnce({ workerId });
            if (!result) break;
        }
    } catch (error) {
        const errorCode = safeErrorCode(error);
        tickErrors.push(errorCode);
        console.error('OpenClaw blog scheduler tick failed:', errorCode);
    } finally {
        running = false;
        lastTickCompletedAt = new Date();
        lastHeartbeatAt = lastTickCompletedAt;
        lastErrorCode = tickErrors[0] || '';
        if (!tickErrors.length) lastSuccessfulTickAt = lastTickCompletedAt;
    }
};

const startBlogAutomationScheduler = () => {
    if (timer) return { started: false, workerId };
    workerId = buildWorkerId();
    registeredAt = new Date();
    lastHeartbeatAt = registeredAt;
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

const getBlogAutomationSchedulerRuntime = () => {
    const contentOperationsConfig = getContentOperationsConfig();
    const schedulerActive = Boolean(
        isCronEnabled() ||
        isSeoAgentEnabled() ||
        isGoogleIntelligenceEnabled() ||
        isContentOperationsScheduleEnabled() ||
        isPerformanceMonitoringEnabled()
    );

    return {
        serviceRegistered: Boolean(timer),
        workerActive: running,
        schedulerActive: Boolean(timer) && schedulerActive,
        registeredAt: registeredAt?.toISOString?.() || null,
        lastHeartbeatAt: lastHeartbeatAt?.toISOString?.() || null,
        lastTickStartedAt: lastTickStartedAt?.toISOString?.() || null,
        lastTickCompletedAt: lastTickCompletedAt?.toISOString?.() || null,
        lastSuccessfulRunAt: lastSuccessfulTickAt?.toISOString?.() || null,
        lastErrorCode,
        tickCount,
        pollIntervalMs: getPollMs(),
        enabledWorkloads: {
            blogCron: isCronEnabled(),
            queuedExecutionRecovery: isSeoAgentEnabled(),
            googleIntelligence: isGoogleIntelligenceEnabled(),
            contentOperationsCron: isContentOperationsScheduleEnabled(),
            performanceMonitoring: contentOperationsConfig.enabled && contentOperationsConfig.performanceMonitoring.enabled
        }
    };
};

module.exports = {
    getPollMs,
    getBlogAutomationSchedulerRuntime,
    startBlogAutomationScheduler,
    stopBlogAutomationScheduler,
    tick
};
