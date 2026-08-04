import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  closeRedisClient,
  connectRedis,
  createRedisErrorReporter,
  getRedisConfig,
  hasExplicitRedisConfig,
  redisIsEnabled,
} = require("../src/config/redis");

const trackedEnvNames = [
  "REDIS_ENABLED",
  "REDIS_REQUIRED",
  "REDIS_URL",
  "REDIS_HOST",
  "REDIS_PORT",
  "REDIS_USERNAME",
  "REDIS_PASSWORD",
  "REDIS_TLS_CA_FILE",
];
const originalEnv = Object.fromEntries(
  trackedEnvNames.map((name) => [name, process.env[name]]),
);

afterEach(() => {
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

const hangingClient = () => {
  const client = {
    isOpen: false,
    isReady: false,
    connect: vi.fn(),
    ping: vi.fn(),
    quit: vi.fn(),
    destroy: vi.fn(),
  };
  client.connect.mockImplementation(() => {
    client.isOpen = true;
    return new Promise(() => {});
  });
  client.destroy.mockImplementation(() => {
    client.isOpen = false;
    client.isReady = false;
  });
  return client;
};

describe("Redis runtime policy", () => {
  it("supports an explicit local disable without weakening required Redis", () => {
    const localDisabled = {
      REDIS_ENABLED: "false",
      REDIS_REQUIRED: "false",
      REDIS_HOST: "redis",
    };
    expect(redisIsEnabled(localDisabled)).toBe(false);
    expect(redisIsEnabled({ ...localDisabled, REDIS_REQUIRED: "true" })).toBe(
      true,
    );
    expect(hasExplicitRedisConfig({ REDIS_PORT: "6379" })).toBe(false);
    expect(hasExplicitRedisConfig({ REDIS_HOST: "127.0.0.1" })).toBe(true);
  });

  it("fails offline commands instead of queueing mutations during reconnect", () => {
    const config = getRedisConfig({
      REDIS_HOST: "127.0.0.1",
      REDIS_PORT: "6379",
    });
    expect(config.disableOfflineQueue).toBe(true);
    expect(config.socket).toMatchObject({ host: "127.0.0.1", port: 6379 });
  });

  it("bounds required startup and destroys a reconnecting client", async () => {
    const client = hangingClient();
    await expect(
      connectRedis({
        client,
        enabled: true,
        required: true,
        timeoutMs: 20,
      }),
    ).rejects.toMatchObject({ code: "REDIS_STARTUP_UNAVAILABLE" });
    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(client.ping).not.toHaveBeenCalled();
    expect(client.destroy).toHaveBeenCalledTimes(1);
  });

  it("degrades optional startup after the same bounded deadline", async () => {
    const client = hangingClient();
    await expect(
      connectRedis({
        client,
        enabled: true,
        required: false,
        timeoutMs: 20,
      }),
    ).resolves.toEqual({
      connected: false,
      skipped: false,
      degraded: true,
      errorCode: "REDIS_STARTUP_UNAVAILABLE",
    });
    expect(client.destroy).toHaveBeenCalledTimes(1);
  });

  it("skips Redis entirely when it is explicitly disabled and optional", async () => {
    const client = hangingClient();
    await expect(
      connectRedis({
        client,
        enabled: false,
        required: false,
        timeoutMs: 20,
      }),
    ).resolves.toEqual({
      connected: false,
      skipped: true,
      degraded: false,
    });
    expect(client.connect).not.toHaveBeenCalled();
  });

  it("deduplicates repeated DNS errors without serializing their messages", () => {
    const logs = [];
    let currentTime = 1000;
    const report = createRedisErrorReporter({
      event: "redis_test_error",
      log: (payload) => logs.push(payload),
      now: () => currentTime,
      windowMs: 1000,
    });
    const error = Object.assign(
      new Error("getaddrinfo ENOTFOUND redis://user:secret@private-host"),
      { code: "ENOTFOUND" },
    );

    for (let index = 0; index < 8; index += 1) report(error);
    expect(logs).toEqual([{ event: "redis_test_error", code: "ENOTFOUND" }]);

    currentTime += 1000;
    report(error);
    expect(logs[1]).toEqual({
      event: "redis_test_error",
      code: "ENOTFOUND",
      suppressedCount: 7,
    });
    expect(JSON.stringify(logs)).not.toContain("private-host");
    expect(JSON.stringify(logs)).not.toContain("secret");
  });

  it("destroys a reconnecting client during shutdown instead of queuing QUIT", async () => {
    const client = hangingClient();
    client.isOpen = true;
    await closeRedisClient(client);
    expect(client.destroy).toHaveBeenCalledTimes(1);
    expect(client.quit).not.toHaveBeenCalled();
  });

  it("bounds QUIT when a ready client stops responding during shutdown", async () => {
    const client = hangingClient();
    client.isOpen = true;
    client.isReady = true;
    client.quit.mockImplementation(() => new Promise(() => {}));
    await closeRedisClient(client, { timeoutMs: 20 });
    expect(client.quit).toHaveBeenCalledTimes(1);
    expect(client.destroy).toHaveBeenCalledTimes(1);
  });

  it("keeps same-process live support working when local Redis is disabled", async () => {
    process.env.REDIS_ENABLED = "false";
    process.env.REDIS_REQUIRED = "false";
    const {
      closeLiveSupportEventClients,
      publishLiveSupportEvent,
      registerLiveSupportListener,
    } = require("../src/services/liveSupportEvent.service");
    const received = [];
    const unsubscribe = registerLiveSupportListener({
      sessionId: "chat-local-redis-disabled",
      onEvent: (event) => received.push(event),
    });

    try {
      const published = await publishLiveSupportEvent({
        action: "updated",
        sessionId: "chat-local-redis-disabled",
        source: "redis-runtime-test",
      });
      expect(received).toHaveLength(1);
      expect(received[0].id).toBe(published.id);
    } finally {
      unsubscribe();
      await closeLiveSupportEventClients();
    }
  });
});
