'use strict'

const os = require('node:os');
const { BlogAutomationScheduleService, isCronEnabled, isSeoAgentEnabled } = require('./blogAutomationSchedule.service');
const { BlogAutomationWorkerHeartbeat } = require('../models/blogAutomationExecution.model');
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
const WORKER_HEARTBEAT_ID = '0000000000000000000000b1';

let timer = null;
let heartbeatTimer = null;
let running = false;
let stopping = false;
let stopPromise = null;
let registrationPromise = null;
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

const getShutdownWaitMs = (value = process.env.OPENCLAW_WORKER_DRAIN_TIMEOUT_MS) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) return 15_000;
    return Math.min(60_000, Math.max(1000, parsed));
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

const buildEnabledWorkloads = () => {
    const contentOperationsConfig = getContentOperationsConfig();
    return {
        blogCron: isCronEnabled(),
        queuedExecutionRecovery: isSeoAgentEnabled(),
        googleIntelligence: isGoogleIntelligenceEnabled(),
        contentOperationsCron: isContentOperationsScheduleEnabled(),
        performanceMonitoring:
            contentOperationsConfig.enabled
            && contentOperationsConfig.performanceMonitoring.enabled
    };
};

const persistWorkerHeartbeat = async ({
    state = 'running',
    active = running,
    acceptingClaims = Boolean(timer) && !stopping,
    upsert = false,
    now = new Date()
} = {}) => {
    if (!workerId) return false;
    const enabledWorkloads = buildEnabledWorkloads();
    const update = await BlogAutomationWorkerHeartbeat.updateOne(
        {
            _id: WORKER_HEARTBEAT_ID,
            ...(upsert ? {} : { workerId })
        },
        {
            $set: {
                heartbeatKey: 'openclaw-blog-scheduler',
                workerId,
                processRole: process.env.OPENCLAW_PROCESS_ROLE === 'worker'
                    ? 'dedicated_worker'
                    : 'embedded_worker',
                state,
                acceptingClaims,
                workerActive: Boolean(active),
                schedulerActive: Object.values(enabledWorkloads).some(Boolean),
                pollIntervalMs: getPollMs(),
                registeredAt,
                lastHeartbeatAt: now,
                lastSuccessfulRunAt: lastSuccessfulTickAt,
                stoppedAt: state === 'stopped' ? now : null,
                lastErrorCode,
                enabledWorkloads
            }
        },
        { upsert }
    );
    return Number(update?.matchedCount ?? update?.modifiedCount ?? update?.upsertedCount ?? 0) > 0;
};

const tick = async () => {
    const startedAt = new Date();
    lastHeartbeatAt = startedAt;
    if (running || stopping) return null;
    lastTickStartedAt = startedAt;
    tickCount += 1;
    const tickErrors = [];
    if (registrationPromise) await registrationPromise.catch(() => false);
    if (stopping) return null;
    // Runtime control toggles only mutate process.env in the process that served the
    // admin request, so this scheduler re-reads the persisted state before every tick;
    // otherwise a toggle stays invisible in the worker process until it restarts.
    // Required lazily to break the cycle back through openclawCapabilityHealth.service.
    const { openClawRuntimeControlService } = require('./openclawRuntimeControl.service');
    await openClawRuntimeControlService.hydrate({ waitForConnection: false })
        .catch((error) => {
            const errorCode = safeErrorCode(error);
            tickErrors.push(errorCode);
            console.error('OpenClaw runtime control refresh failed:', errorCode);
            return null;
        });
    if (!isSeoAgentEnabled() && !isCronEnabled() && !isGoogleIntelligenceEnabled() && !isContentOperationsScheduleEnabled() && !isPerformanceMonitoringEnabled()) {
        lastTickCompletedAt = new Date();
        lastSuccessfulTickAt = lastTickCompletedAt;
        lastErrorCode = '';
        await persistWorkerHeartbeat({
            state: 'running',
            active: false,
            now: lastTickCompletedAt
        }).catch(() => false);
        return;
    }
    running = true;
    await persistWorkerHeartbeat({ state: 'running', active: true, now: startedAt })
        .catch(() => false);
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
        lastTickCompletedAt = new Date();
        lastHeartbeatAt = lastTickCompletedAt;
        lastErrorCode = tickErrors[0] || '';
        if (!tickErrors.length) lastSuccessfulTickAt = lastTickCompletedAt;
        await persistWorkerHeartbeat({
            state: stopping ? 'stopping' : 'running',
            active: false,
            acceptingClaims: Boolean(timer) && !stopping,
            now: lastTickCompletedAt
        }).catch(() => false);
        running = false;
    }
};

const startBlogAutomationScheduler = () => {
    if (timer) return { started: false, workerId };
    stopping = false;
    stopPromise = null;
    registrationPromise = null;
    workerId = buildWorkerId();
    registeredAt = new Date();
    lastHeartbeatAt = registeredAt;
    registrationPromise = persistWorkerHeartbeat({
        state: 'starting',
        active: false,
        acceptingClaims: true,
        upsert: true,
        now: registeredAt
    }).catch(() => false);
    timer = setInterval(tick, getPollMs());
    timer.unref?.();
    heartbeatTimer = setInterval(() => {
        const now = new Date();
        lastHeartbeatAt = now;
        void persistWorkerHeartbeat({
            state: stopping ? 'stopping' : 'running',
            active: running,
            acceptingClaims: Boolean(timer) && !stopping,
            now
        }).catch(() => false);
    }, Math.min(15_000, getPollMs()));
    heartbeatTimer.unref?.();
    void tick();
    return { started: true, workerId };
};

const stopBlogAutomationScheduler = async ({
    timeoutMs = getShutdownWaitMs()
} = {}) => {
    if (stopPromise) return stopPromise;
    const wasRegistered = Boolean(timer);
    stopping = true;
    if (timer) clearInterval(timer);
    timer = null;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    stopPromise = (async () => {
        const deadline = Date.now() + Math.min(60_000, Math.max(1000, Number(timeoutMs) || 15_000));
        while (running && Date.now() < deadline) {
            await new Promise((resolve) => {
                setTimeout(resolve, Math.min(100, Math.max(1, deadline - Date.now())));
            });
        }
        const drained = !running;
        if (registrationPromise) await registrationPromise.catch(() => false);
        await persistWorkerHeartbeat({
            state: drained ? 'stopped' : 'stopping',
            active: running,
            acceptingClaims: false,
            now: new Date()
        }).catch(() => false);
        return {
            stopped: wasRegistered,
            drained,
            workerId
        };
    })();
    return stopPromise;
};

const getBlogAutomationSchedulerRuntime = () => {
    const enabledWorkloads = buildEnabledWorkloads();
    const schedulerActive = Object.values(enabledWorkloads).some(Boolean);

    return {
        serviceRegistered: Boolean(timer),
        workerActive: running,
        acceptingClaims: Boolean(timer) && !stopping,
        stopping,
        workerId,
        schedulerActive: Boolean(timer) && schedulerActive,
        registeredAt: registeredAt?.toISOString?.() || null,
        lastHeartbeatAt: lastHeartbeatAt?.toISOString?.() || null,
        lastTickStartedAt: lastTickStartedAt?.toISOString?.() || null,
        lastTickCompletedAt: lastTickCompletedAt?.toISOString?.() || null,
        lastSuccessfulRunAt: lastSuccessfulTickAt?.toISOString?.() || null,
        lastErrorCode,
        tickCount,
        pollIntervalMs: getPollMs(),
        enabledWorkloads
    };
};

module.exports = {
    getPollMs,
    getShutdownWaitMs,
    persistWorkerHeartbeat,
    getBlogAutomationSchedulerRuntime,
    startBlogAutomationScheduler,
    stopBlogAutomationScheduler,
    tick
};
