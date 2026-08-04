'use strict'

const os = require('node:os')
const { BlogAutomationScheduleService } = require('./blogAutomationSchedule.service')
const { getContentOperationsConfig } = require('../config/contentOperations.config')
const { safeErrorCode } = require('../utils/httpError.util')

const DEFAULT_POLL_MS = 5_000
const MIN_POLL_MS = 1_000
const MAX_POLL_MS = 60_000

const getPollMs = (value = process.env.OPENCLAW_TOPIC_ROADMAP_WORKER_POLL_MS) => {
    if (value === undefined || value === null || String(value).trim() === '') return DEFAULT_POLL_MS
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed < MIN_POLL_MS || parsed > MAX_POLL_MS) return DEFAULT_POLL_MS
    return parsed
}

const createTopicRoadmapRegenerationRuntime = ({
    ScheduleService = BlogAutomationScheduleService,
    enabled = () => getContentOperationsConfig().topicRoadmap.enabled !== false,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    now = () => new Date(),
    hostname = () => os.hostname(),
    processId = process.pid
} = {}) => {
    let timer = null
    let running = false
    let workerId = ''
    let registeredAt = null
    let lastHeartbeatAt = null
    let lastRunAt = null
    let lastSuccessfulRunAt = null
    let lastErrorCode = ''
    let tickCount = 0

    const tick = async () => {
        lastHeartbeatAt = now()
        if (running || !enabled()) return null
        running = true
        tickCount += 1
        try {
            const result = await ScheduleService.runQueuedTopicRoadmapRegenerationOnce({ workerId })
            lastRunAt = now()
            lastSuccessfulRunAt = lastRunAt
            lastErrorCode = ''
            if (result) {
                console.info(JSON.stringify({
                    event: 'topic_roadmap_regeneration_processed',
                    workerId,
                    regenerationId: String(result.id || '').slice(0, 128),
                    correlationId: String(result.correlationId || '').slice(0, 128),
                    status: String(result.status || '').slice(0, 40),
                    outcomeCode: String(result.outcomeCode || '').slice(0, 120),
                    errorCode: String(result.errorCode || '').slice(0, 120)
                }))
            }
            return result
        } catch (error) {
            lastRunAt = now()
            lastErrorCode = safeErrorCode(error)
            console.error(JSON.stringify({
                event: 'topic_roadmap_regeneration_failed',
                workerId,
                regenerationId: String(error?.regenerationId || '').slice(0, 128),
                correlationId: String(error?.correlationId || '').slice(0, 128),
                errorCode: lastErrorCode
            }))
            return null
        } finally {
            running = false
            lastHeartbeatAt = now()
        }
    }

    const start = () => {
        if (timer) return { started: false, workerId }
        workerId = `topic-roadmap:${hostname()}:${processId}:${now().getTime().toString(36)}`
        registeredAt = now()
        lastHeartbeatAt = registeredAt
        timer = setIntervalFn(tick, getPollMs())
        timer.unref?.()
        void tick()
        return { started: true, workerId }
    }

    const stop = () => {
        if (!timer) return { stopped: false }
        clearIntervalFn(timer)
        timer = null
        return { stopped: true }
    }

    const status = () => ({
        serviceRegistered: Boolean(timer),
        workerActive: running,
        schedulerActive: Boolean(timer) && enabled(),
        workerId,
        registeredAt: registeredAt?.toISOString?.() || null,
        lastHeartbeatAt: lastHeartbeatAt?.toISOString?.() || null,
        lastRunAt: lastRunAt?.toISOString?.() || null,
        lastSuccessfulRunAt: lastSuccessfulRunAt?.toISOString?.() || null,
        lastErrorCode,
        tickCount,
        pollIntervalMs: getPollMs()
    })

    return { start, stop, status, tick }
}

const runtime = createTopicRoadmapRegenerationRuntime()

module.exports = {
    createTopicRoadmapRegenerationRuntime,
    getPollMs,
    getTopicRoadmapRegenerationRuntime: runtime.status,
    startTopicRoadmapRegenerationRuntime: runtime.start,
    stopTopicRoadmapRegenerationRuntime: runtime.stop,
    tickTopicRoadmapRegeneration: runtime.tick
}
