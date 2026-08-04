"use strict";

const fs = require("node:fs");
const redis = require("redis");
const {
  isProductionEnv,
  normalizeEnvValue,
  parseBooleanEnv,
} = require("./runtimeEnv");

const DEFAULT_REDIS_STARTUP_TIMEOUT_MS = 15000;
const DEFAULT_REDIS_ERROR_LOG_WINDOW_MS = 30000;
const DEFAULT_REDIS_SHUTDOWN_TIMEOUT_MS = 5000;

const boundedInteger = (value, fallback, { min, max }) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const hasExplicitRedisConfig = (env = process.env) =>
  [
    "REDIS_URL",
    "REDIS_HOST",
    "REDIS_USERNAME",
    "REDIS_PASSWORD",
    "REDIS_TLS_CA_FILE",
  ].some((key) => Boolean(normalizeEnvValue(env[key])));

const redisIsRequired = (env = process.env) =>
  parseBooleanEnv(env.REDIS_REQUIRED, isProductionEnv(env));

const redisIsEnabled = (env = process.env) =>
  redisIsRequired(env) ||
  parseBooleanEnv(env.REDIS_ENABLED, hasExplicitRedisConfig(env));

const redisStartupTimeout = (env = process.env) =>
  boundedInteger(
    env.REDIS_STARTUP_TIMEOUT_MS,
    DEFAULT_REDIS_STARTUP_TIMEOUT_MS,
    { min: 1000, max: 120000 },
  );

const safeRedisErrorCode = (error) => {
  const rawCode = String(error?.code || error?.name || "REDIS_ERROR");
  return (
    rawCode.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 80) || "REDIS_ERROR"
  );
};

const createRedisErrorReporter = ({
  event = "redis_client_error",
  log = (payload) => console.error(JSON.stringify(payload)),
  now = Date.now,
  windowMs = DEFAULT_REDIS_ERROR_LOG_WINDOW_MS,
} = {}) => {
  let lastCode = "";
  let lastLoggedAt = 0;
  let suppressedCount = 0;

  const report = (error) => {
    const code = safeRedisErrorCode(error);
    const currentTime = Number(now());
    const repeatedInsideWindow =
      code === lastCode && currentTime - lastLoggedAt < windowMs;

    if (repeatedInsideWindow) {
      suppressedCount += 1;
      return false;
    }

    const payload = { event, code };
    if (code === lastCode && suppressedCount > 0) {
      payload.suppressedCount = suppressedCount;
    }
    log(payload);
    lastCode = code;
    lastLoggedAt = currentTime;
    suppressedCount = 0;
    return true;
  };

  report.reset = () => {
    lastCode = "";
    lastLoggedAt = 0;
    suppressedCount = 0;
  };
  return report;
};

const createRedisUnavailableError = (code, cause) => {
  const error = new Error("Redis dependency is unavailable");
  error.code = code;
  if (cause) error.cause = cause;
  return error;
};

const withRedisDeadline = async (
  operation,
  {
    timeoutMs = DEFAULT_REDIS_STARTUP_TIMEOUT_MS,
    code = "REDIS_OPERATION_TIMEOUT",
  } = {},
) => {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(
      () => reject(createRedisUnavailableError(code)),
      timeoutMs,
    );
    timer.unref?.();
  });
  try {
    return await Promise.race([Promise.resolve(operation), timeout]);
  } finally {
    clearTimeout(timer);
  }
};

const destroyRedisClient = (client) => {
  try {
    client?.destroy?.();
  } catch {
    // The client may already be closed. Shutdown remains best-effort and bounded.
  }
};

const closeRedisClient = async (
  client,
  { timeoutMs = DEFAULT_REDIS_SHUTDOWN_TIMEOUT_MS } = {},
) => {
  if (!client?.isOpen) return;
  if (!client.isReady) {
    destroyRedisClient(client);
    return;
  }
  try {
    await withRedisDeadline(client.quit(), {
      timeoutMs,
      code: "REDIS_SHUTDOWN_TIMEOUT",
    });
  } catch {
    destroyRedisClient(client);
  }
};

const readRedisCa = (env = process.env) => {
  const caFile = normalizeEnvValue(env.REDIS_TLS_CA_FILE);
  if (!caFile) return undefined;
  try {
    return fs.readFileSync(caFile);
  } catch {
    const error = new Error("REDIS_TLS_CA_FILE is not readable");
    error.code = "REDIS_TLS_CA_UNREADABLE";
    throw error;
  }
};

const getRedisConfig = (env = process.env) => {
  const redisUrl = normalizeEnvValue(env.REDIS_URL);
  const connectTimeout = boundedInteger(env.REDIS_CONNECT_TIMEOUT_MS, 10000, {
    min: 1000,
    max: 60000,
  });
  const ca = readRedisCa(env);
  const servername = normalizeEnvValue(env.REDIS_TLS_SERVERNAME) || undefined;

  if (redisUrl) {
    if (!/^rediss?:\/\//i.test(redisUrl)) {
      throw new Error("REDIS_URL must use redis:// or rediss://");
    }
    return {
      url: redisUrl,
      disableOfflineQueue: true,
      socket: {
        connectTimeout,
        ...(ca ? { ca } : {}),
        ...(servername ? { servername } : {}),
      },
    };
  }

  const host = normalizeEnvValue(env.REDIS_HOST) || "127.0.0.1";
  const port = boundedInteger(env.REDIS_PORT, 6379, { min: 1, max: 65535 });
  const username = normalizeEnvValue(env.REDIS_USERNAME) || undefined;
  const password = normalizeEnvValue(env.REDIS_PASSWORD) || undefined;
  const tlsEnabled = parseBooleanEnv(env.REDIS_TLS, false);

  return {
    disableOfflineQueue: true,
    socket: {
      host,
      port,
      connectTimeout,
      ...(tlsEnabled
        ? {
            tls: true,
            servername: servername || host,
            ...(ca ? { ca } : {}),
          }
        : {}),
    },
    username: username || (password ? "default" : undefined),
    password,
  };
};

const redisClient = redis.createClient(getRedisConfig());

const reportRedisClientError = createRedisErrorReporter({
  windowMs: boundedInteger(
    process.env.REDIS_ERROR_LOG_WINDOW_MS,
    DEFAULT_REDIS_ERROR_LOG_WINDOW_MS,
    { min: 1000, max: 10 * 60 * 1000 },
  ),
});
const reportRedisStartupError = createRedisErrorReporter({
  event: "redis_optional_startup_unavailable",
  windowMs: DEFAULT_REDIS_ERROR_LOG_WINDOW_MS,
});

redisClient.on("error", reportRedisClientError);

const connectPromises = new WeakMap();

const connectClient = (client) => {
  if (client.isReady) return Promise.resolve(client);
  const pending = connectPromises.get(client);
  if (pending) return pending;

  const connection = (async () => {
    if (!client.isOpen) await client.connect();
    return client;
  })();
  connectPromises.set(client, connection);
  const cleanup = () => {
    if (connectPromises.get(client) === connection) {
      connectPromises.delete(client);
    }
  };
  connection.then(cleanup, cleanup);
  return connection;
};

const connectRedisClientWithDeadline = async (
  client,
  {
    timeoutMs = redisStartupTimeout(),
    ping = false,
    timeoutCode = "REDIS_STARTUP_UNAVAILABLE",
  } = {},
) => {
  const startedAt = Date.now();
  try {
    await withRedisDeadline(connectClient(client), {
      timeoutMs,
      code: timeoutCode,
    });
    if (ping) {
      const remainingTimeoutMs = Math.max(
        1,
        timeoutMs - (Date.now() - startedAt),
      );
      await withRedisDeadline(client.ping(), {
        timeoutMs: remainingTimeoutMs,
        code: timeoutCode,
      });
    }
    return client;
  } catch (cause) {
    destroyRedisClient(client);
    if (cause?.code === timeoutCode) throw cause;
    throw createRedisUnavailableError(timeoutCode, cause);
  }
};

const connectRedis = async ({
  required = redisIsRequired(),
  enabled = redisIsEnabled(),
  client = redisClient,
  timeoutMs = redisStartupTimeout(),
} = {}) => {
  if (!enabled && !required) {
    return { connected: false, skipped: true, degraded: false };
  }

  try {
    await connectRedisClientWithDeadline(client, {
      timeoutMs,
      ping: true,
      timeoutCode: "REDIS_STARTUP_UNAVAILABLE",
    });
    reportRedisClientError.reset();
    reportRedisStartupError.reset();
    return { connected: true, skipped: false, degraded: false };
  } catch (error) {
    if (required) throw error;
    reportRedisStartupError(error);
    return {
      connected: false,
      skipped: false,
      degraded: true,
      errorCode: safeRedisErrorCode(error),
    };
  }
};

const closeRedis = async () => {
  await closeRedisClient(redisClient);
};

const getRedisHealth = (env = process.env) => ({
  enabled: redisIsEnabled(env),
  required: redisIsRequired(env),
  configured: hasExplicitRedisConfig(env),
  ready: Boolean(redisClient.isOpen && redisClient.isReady),
});

module.exports = {
  closeRedis,
  closeRedisClient,
  connectRedis,
  connectRedisClientWithDeadline,
  createRedisErrorReporter,
  getRedisConfig,
  getRedisHealth,
  hasExplicitRedisConfig,
  readRedisCa,
  redisClient,
  redisIsEnabled,
  redisStartupTimeout,
  safeRedisErrorCode,
  withRedisDeadline,
  redisIsRequired,
};
