'use strict';

const http = require('node:http');
const {
  isProductionEnv,
  loadRuntimeEnv,
  validateRuntimeConfig
} = require('./src/config/runtimeEnv');

const envLoad = loadRuntimeEnv();
if (envLoad.loaded && isProductionEnv()) {
  throw new Error(
    'Production worker startup must receive environment variables from the process or secret store, not a dotenv file'
  );
}
const runtimeConfig = validateRuntimeConfig();
process.env.OPENCLAW_PROCESS_ROLE = 'worker';

const database = require('./src/dbs/init.mongodb');
const { closeRedis, connectRedis, getRedisHealth } = require('./src/config/redis');
const {
  getBlogAutomationSchedulerRuntime,
  getShutdownWaitMs,
  startBlogAutomationScheduler,
  stopBlogAutomationScheduler
} = require('./src/services/blogAutomationScheduler.runtime');
const {
  getTopicRoadmapRegenerationRuntime,
  startTopicRoadmapRegenerationRuntime,
  stopTopicRoadmapRegenerationRuntime
} = require('./src/services/topicRoadmapRegeneration.runtime');
const {
  openClawRuntimeControlService
} = require('./src/services/openclawRuntimeControl.service');

const HEALTH_HOST = process.env.OPENCLAW_WORKER_HEALTH_HOST || '0.0.0.0';
const HEALTH_PORT = Math.min(
  65535,
  Math.max(1, Number(process.env.OPENCLAW_WORKER_HEALTH_PORT) || 3057)
);
const SHUTDOWN_TIMEOUT_MS = Math.min(
  60_000,
  Math.max(5000, Number(process.env.SHUTDOWN_TIMEOUT_MS) || 20_000)
);

let healthServer = null;
let ready = false;
let shuttingDown = false;

const heartbeatIsFresh = (runtime, now = Date.now()) => {
  if (runtime.workerActive) return true;
  const heartbeatAt = Date.parse(runtime.lastHeartbeatAt || '');
  const staleAfterMs = Math.max(30_000, Number(runtime.pollIntervalMs || 30_000) * 4);
  return Number.isFinite(heartbeatAt) && now - heartbeatAt <= staleAfterMs;
};

const buildHealth = () => {
  const scheduler = getBlogAutomationSchedulerRuntime();
  const roadmap = getTopicRoadmapRegenerationRuntime();
  const redis = getRedisHealth();
  const dependenciesReady = database.isReady() && (!redis.required || redis.ready);
  const runtimesReady =
    scheduler.serviceRegistered &&
    roadmap.serviceRegistered &&
    heartbeatIsFresh(scheduler) &&
    heartbeatIsFresh(roadmap);
  return {
    ok: ready && !shuttingDown && dependenciesReady && runtimesReady,
    ready: ready && !shuttingDown,
    database: database.status(),
    redis: {
      required: redis.required,
      ready: redis.ready
    },
    scheduler: {
      registered: scheduler.serviceRegistered,
      acceptingClaims: scheduler.acceptingClaims,
      active: scheduler.workerActive,
      lastHeartbeatAt: scheduler.lastHeartbeatAt,
      lastErrorCode: scheduler.lastErrorCode
    },
    roadmap: {
      registered: roadmap.serviceRegistered,
      active: roadmap.workerActive,
      lastHeartbeatAt: roadmap.lastHeartbeatAt,
      lastErrorCode: roadmap.lastErrorCode
    }
  };
};

const createHealthServer = () => http.createServer((request, response) => {
  if (request.method !== 'GET' || !['/healthz', '/health/live', '/health/ready'].includes(request.url)) {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end('{"ok":false}');
    return;
  }
  const health = buildHealth();
  const liveOnly = request.url === '/health/live';
  const statusCode = liveOnly || health.ok ? 200 : 503;
  response.writeHead(statusCode, {
    'content-type': 'application/json',
    'cache-control': 'no-store'
  });
  response.end(JSON.stringify(liveOnly ? { ok: true, shuttingDown } : health));
});

const listenForHealth = () => new Promise((resolve, reject) => {
  healthServer = createHealthServer();
  healthServer.once('error', reject);
  healthServer.listen(HEALTH_PORT, HEALTH_HOST, resolve);
});

const closeHealthServer = async () => {
  if (!healthServer) return;
  const current = healthServer;
  healthServer = null;
  await new Promise((resolve) => {
    current.close(() => resolve());
    current.closeAllConnections?.();
  });
};

const waitForRoadmapDrain = async (timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  while (getTopicRoadmapRegenerationRuntime().workerActive && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !getTopicRoadmapRegenerationRuntime().workerActive;
};

const shutdown = async (reason, exitCode = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  ready = false;
  console.info(`${reason} received. Draining OpenClaw worker.`);

  const forceTimer = setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS);
  forceTimer.unref();
  const drainMs = Math.min(SHUTDOWN_TIMEOUT_MS - 1000, getShutdownWaitMs());
  const drainDeadline = Date.now() + drainMs;

  const stopResults = await Promise.allSettled([
    stopBlogAutomationScheduler({ timeoutMs: drainMs }),
    Promise.resolve().then(() => stopTopicRoadmapRegenerationRuntime())
  ]);
  const roadmapDrained = await waitForRoadmapDrain(
    Math.max(0, drainDeadline - Date.now())
  );
  const schedulerDrained = stopResults[0].status === 'fulfilled'
    && stopResults[0].value?.drained !== false;
  if (!schedulerDrained || !roadmapDrained) {
    exitCode = 1;
    console.error(JSON.stringify({
      event: 'openclaw_worker_drain_timeout',
      schedulerDrained,
      roadmapDrained
    }));
  }

  const closeResults = await Promise.allSettled([
    closeHealthServer(),
    closeRedis(),
    database.disconnect()
  ]);
  clearTimeout(forceTimer);
  if (
    stopResults.some((result) => result.status === 'rejected')
    || closeResults.some((result) => result.status === 'rejected')
  ) {
    exitCode = 1;
  }
  process.exit(exitCode);
};

const start = async () => {
  await database.connect();
  await connectRedis({ required: runtimeConfig.redisRequired });
  try {
    await openClawRuntimeControlService.hydrate({
      waitForConnection: true,
      timeoutMs: 15_000
    });
  } catch (error) {
    openClawRuntimeControlService.forceFailClosed();
    console.error(JSON.stringify({
      event: 'openclaw_worker_runtime_controls_failed_closed',
      code: String(error?.code || error?.name || 'RUNTIME_CONTROL_ERROR').slice(0, 80)
    }));
  }

  await listenForHealth();
  const scheduler = startBlogAutomationScheduler();
  const roadmap = startTopicRoadmapRegenerationRuntime();
  ready = true;
  console.info(JSON.stringify({
    event: 'openclaw_worker_ready',
    schedulerWorkerId: scheduler.workerId,
    roadmapWorkerId: roadmap.workerId,
    healthPort: HEALTH_PORT
  }));
};

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('uncaughtException', (error) => {
  console.error(JSON.stringify({
    event: 'openclaw_worker_uncaught_exception',
    code: String(error?.code || error?.name || 'UNCAUGHT_EXCEPTION').slice(0, 80)
  }));
  void shutdown('uncaughtException', 1);
});
process.once('unhandledRejection', (error) => {
  console.error(JSON.stringify({
    event: 'openclaw_worker_unhandled_rejection',
    code: String(error?.code || error?.name || 'UNHANDLED_REJECTION').slice(0, 80)
  }));
  void shutdown('unhandledRejection', 1);
});

start().catch((error) => {
  console.error(JSON.stringify({
    event: 'openclaw_worker_startup_failed',
    code: String(error?.code || error?.name || 'STARTUP_ERROR').slice(0, 80)
  }));
  void shutdown('startupFailure', 1);
});
