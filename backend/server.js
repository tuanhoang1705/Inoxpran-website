'use strict';

const {
  isProductionEnv,
  loadRuntimeEnv,
  validateRuntimeConfig
} = require('./src/config/runtimeEnv');

const envLoad = loadRuntimeEnv();
if (envLoad.loaded && isProductionEnv()) {
  throw new Error(
    'Production startup must receive environment variables from the process or secret store, not a dotenv file'
  );
}
const runtimeConfig = validateRuntimeConfig();

const app = require('./src/app');
const database = require('./src/dbs/init.mongodb');
const runtimeHealth = require('./src/config/runtimeHealth');
const { closeRedis, connectRedis } = require('./src/config/redis');
const {
  cleanupExpiredPendingStorageUploads
} = require('./src/services/pendingStorageUpload.service');
const {
  startBlogAutomationScheduler,
  stopBlogAutomationScheduler
} = require('./src/services/blogAutomationScheduler.runtime');
const {
  startTelegramPolling,
  stopTelegramPolling
} = require('./src/services/telegramPolling.runtime');
const {
  getTopicRoadmapRegenerationRuntime,
  startTopicRoadmapRegenerationRuntime,
  stopTopicRoadmapRegenerationRuntime
} = require('./src/services/topicRoadmapRegeneration.runtime');
const {
  openClawRuntimeControlService
} = require('./src/services/openclawRuntimeControl.service');
const {
  closeLiveSupportEventClients
} = require('./src/services/liveSupportEvent.service');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT) || 3056;
const SHUTDOWN_TIMEOUT_MS = Math.max(
  5000,
  Math.min(60000, Number(process.env.SHUTDOWN_TIMEOUT_MS || 15000))
);

let server = null;
let cleanupTimer = null;
let shuttingDown = false;

const embeddedWorkerEnabled = () => {
  const value = String(process.env.OPENCLAW_EMBEDDED_WORKER || '').trim().toLowerCase();
  if (!value) return !isProductionEnv();
  return ['1', 'true', 'yes', 'on'].includes(value);
};

const closeHttpServer = async () => {
  if (!server) return;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
};

const stopRuntimes = async () => {
  if (cleanupTimer) clearInterval(cleanupTimer);
  cleanupTimer = null;
  const configuredDrainMs = Number(process.env.OPENCLAW_WORKER_DRAIN_TIMEOUT_MS);
  const maximumDrainMs = Math.max(1000, SHUTDOWN_TIMEOUT_MS - 1000);
  const drainWaitMs = Number.isInteger(configuredDrainMs)
    ? Math.min(maximumDrainMs, Math.max(1000, configuredDrainMs))
    : Math.min(maximumDrainMs, 15000);
  const drainDeadline = Date.now() + drainWaitMs;
  const results = await Promise.allSettled([
    stopBlogAutomationScheduler({ timeoutMs: drainWaitMs }),
    Promise.resolve().then(() => stopTopicRoadmapRegenerationRuntime()),
    Promise.resolve().then(() => stopTelegramPolling())
  ]);
  while (
    getTopicRoadmapRegenerationRuntime().workerActive
    && Date.now() < drainDeadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return results;
};

const shutdown = async (reason, exitCode = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  runtimeHealth.markApplicationNotReady({ shutdown: true });
  console.info(`${reason} received. Shutting down.`);

  const forceTimer = setTimeout(() => {
    try {
      server?.closeAllConnections?.();
    } finally {
      process.exit(1);
    }
  }, SHUTDOWN_TIMEOUT_MS);
  forceTimer.unref();

  const runtimeStopResults = await stopRuntimes();
  const results = await Promise.allSettled([
    closeHttpServer(),
    closeLiveSupportEventClients(),
    closeRedis(),
    database.disconnect()
  ]);
  clearTimeout(forceTimer);

  for (const result of [...runtimeStopResults, ...results]) {
    if (result.status === 'rejected') {
      exitCode = 1;
      console.error(JSON.stringify({
        event: 'shutdown_dependency_error',
        code: String(result.reason?.code || result.reason?.name || 'SHUTDOWN_ERROR').slice(0, 80)
      }));
    }
  }

  process.exit(exitCode);
};

const listen = async () => new Promise((resolve, reject) => {
  const candidate = app.listen(PORT, HOST, () => resolve(candidate));
  candidate.once('error', reject);
});

const start = async () => {
  await database.connect();
  await connectRedis({ required: runtimeConfig.redisRequired });

  try {
    const hydration = await openClawRuntimeControlService.hydrate({
      waitForConnection: true,
      timeoutMs: 15000
    });
    if (hydration.applied) {
      console.info(`OpenClaw runtime controls restored: ${hydration.applied}`);
    }
  } catch (error) {
    openClawRuntimeControlService.forceFailClosed();
    console.error(JSON.stringify({
      event: 'openclaw_runtime_controls_failed_closed',
      code: String(error?.code || error?.name || 'RUNTIME_CONTROL_ERROR').slice(0, 80)
    }));
  }

  server = await listen();
  server.keepAliveTimeout = Math.max(1000, Number(process.env.HTTP_KEEP_ALIVE_TIMEOUT_MS || 5000));
  server.headersTimeout = Math.max(
    server.keepAliveTimeout + 1000,
    Number(process.env.HTTP_HEADERS_TIMEOUT_MS || 10000)
  );

  const cleanupIntervalMs = Math.max(
    60000,
    Number(process.env.PENDING_UPLOAD_CLEANUP_INTERVAL_MS || 60 * 60 * 1000)
  );
  cleanupTimer = setInterval(() => {
    cleanupExpiredPendingStorageUploads().catch((error) => {
      console.error(JSON.stringify({
        event: 'pending_upload_cleanup_failed',
        code: String(error?.code || error?.name || 'CLEANUP_ERROR').slice(0, 80)
      }));
    });
  }, cleanupIntervalMs);
  cleanupTimer.unref();

  if (embeddedWorkerEnabled()) {
    const blogScheduler = startBlogAutomationScheduler();
    if (blogScheduler.started) {
      console.info(`OpenClaw embedded blog scheduler ready: ${blogScheduler.workerId}`);
    }
    const roadmapRegeneration = startTopicRoadmapRegenerationRuntime();
    if (roadmapRegeneration.started) {
      console.info(
        `OpenClaw embedded topic roadmap worker ready: ${roadmapRegeneration.workerId}`
      );
    }
  }
  const telegramPolling = startTelegramPolling();
  if (telegramPolling.started) console.info('Telegram approval polling ready');

  runtimeHealth.markApplicationReady();
  console.info(`API listening on ${HOST}:${PORT}`);

  cleanupExpiredPendingStorageUploads().catch((error) => {
    console.error(JSON.stringify({
      event: 'initial_pending_upload_cleanup_failed',
      code: String(error?.code || error?.name || 'CLEANUP_ERROR').slice(0, 80)
    }));
  });
};

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('uncaughtException', (error) => {
  console.error(JSON.stringify({
    event: 'uncaught_exception',
    code: String(error?.code || error?.name || 'UNCAUGHT_EXCEPTION').slice(0, 80)
  }));
  void shutdown('uncaughtException', 1);
});
process.once('unhandledRejection', (error) => {
  console.error(JSON.stringify({
    event: 'unhandled_rejection',
    code: String(error?.code || error?.name || 'UNHANDLED_REJECTION').slice(0, 80)
  }));
  void shutdown('unhandledRejection', 1);
});

start().catch((error) => {
  runtimeHealth.markApplicationNotReady();
  console.error(JSON.stringify({
    event: 'startup_failed',
    code: String(error?.code || error?.name || 'STARTUP_ERROR').slice(0, 80)
  }));
  void shutdown('startupFailure', 1);
});
