"use strict";

const crypto = require("node:crypto");
const redis = require("redis");
const {
  closeRedisClient,
  connectRedisClientWithDeadline,
  createRedisErrorReporter,
  getRedisConfig,
  redisIsEnabled,
  redisStartupTimeout,
  withRedisDeadline,
} = require("../config/redis");
const { dispatchLiveSupportPushNotifications } = require("./webPush.service");

const LIVE_SUPPORT_EVENT_CHANNEL =
  String(
    process.env.LIVE_SUPPORT_EVENT_CHANNEL || "live_support_events_v1",
  ).trim() || "live_support_events_v1";

const listeners = new Map();
let publisherClient = null;
let subscriberClient = null;
let publisherReadyPromise = null;
let subscriberReadyPromise = null;

const reportClientError = createRedisErrorReporter({
  event: "live_support_redis_client_error",
});
const reportPublishError = createRedisErrorReporter({
  event: "live_support_redis_publish_unavailable",
});
const reportSubscriberError = createRedisErrorReporter({
  event: "live_support_redis_subscriber_unavailable",
});
const reportWebPushError = createRedisErrorReporter({
  event: "live_support_web_push_error",
});

const buildEventId = () => {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString("hex");
};

const buildRedisClient = () => {
  const client = redis.createClient(getRedisConfig());
  client.on("error", reportClientError);
  return client;
};

const ensurePublisherClient = async () => {
  if (!publisherClient) {
    publisherClient = buildRedisClient();
  }
  if (!publisherReadyPromise) {
    publisherReadyPromise = (async () => {
      await connectRedisClientWithDeadline(publisherClient, {
        timeoutMs: redisStartupTimeout(),
        timeoutCode: "LIVE_SUPPORT_REDIS_STARTUP_UNAVAILABLE",
      });
      return publisherClient;
    })().catch((error) => {
      const failedClient = publisherClient;
      publisherClient = null;
      publisherReadyPromise = null;
      void closeRedisClient(failedClient);
      throw error;
    });
  }
  return publisherReadyPromise;
};

const deliverEvent = (event) => {
  for (const [listenerId, listener] of listeners.entries()) {
    if (listener.sessionId && listener.sessionId !== event.sessionId) {
      continue;
    }

    try {
      listener.onEvent(event);
    } catch (error) {
      console.error(
        "[live-support-events] listener delivery failed",
        error?.message || error,
      );
      listeners.delete(listenerId);
    }
  }
};

const deliverEventAndNotifications = (event) => {
  deliverEvent(event);
  void dispatchLiveSupportPushNotifications(event).catch(reportWebPushError);
};

const ensureSubscriberClient = async () => {
  if (!subscriberClient) {
    subscriberClient = buildRedisClient();
  }
  if (!subscriberReadyPromise) {
    subscriberReadyPromise = (async () => {
      await connectRedisClientWithDeadline(subscriberClient, {
        timeoutMs: redisStartupTimeout(),
        timeoutCode: "LIVE_SUPPORT_REDIS_STARTUP_UNAVAILABLE",
      });
      await subscriberClient.subscribe(
        LIVE_SUPPORT_EVENT_CHANNEL,
        (message) => {
          if (!message) return;
          try {
            const parsed = JSON.parse(message);
            deliverEventAndNotifications(parsed);
          } catch (error) {
            console.error(
              "[live-support-events] invalid payload",
              error?.message || error,
            );
          }
        },
      );
      return subscriberClient;
    })().catch((error) => {
      const failedClient = subscriberClient;
      subscriberClient = null;
      subscriberReadyPromise = null;
      void closeRedisClient(failedClient);
      throw error;
    });
  }
  return subscriberReadyPromise;
};

const normalizeEventPayload = (event = {}) => ({
  id: String(event.id || "").trim() || buildEventId(),
  type: String(event.type || "chat_room.updated").trim() || "chat_room.updated",
  action: String(event.action || "updated").trim() || "updated",
  source: String(event.source || "unknown").trim() || "unknown",
  sessionId: String(event.sessionId || "").trim() || null,
  occurredAt: event.occurredAt
    ? new Date(event.occurredAt).toISOString()
    : new Date().toISOString(),
  payload:
    event.payload &&
    typeof event.payload === "object" &&
    !Array.isArray(event.payload)
      ? event.payload
      : {},
});

const publishLiveSupportEvent = async (event = {}) => {
  const payload = normalizeEventPayload(event);
  if (!redisIsEnabled()) {
    deliverEventAndNotifications(payload);
    return payload;
  }
  try {
    const client = await ensurePublisherClient();
    await withRedisDeadline(
      client.publish(LIVE_SUPPORT_EVENT_CHANNEL, JSON.stringify(payload)),
      {
        timeoutMs: redisStartupTimeout(),
        code: "LIVE_SUPPORT_REDIS_PUBLISH_TIMEOUT",
      },
    );
  } catch (error) {
    reportPublishError(error);
    deliverEventAndNotifications(payload);
  }
  return payload;
};

const registerLiveSupportListener = ({
  adminId = null,
  sessionId = null,
  onEvent,
} = {}) => {
  if (typeof onEvent !== "function") {
    throw new Error("onEvent listener is required");
  }

  const listenerId = buildEventId();
  listeners.set(listenerId, {
    adminId: adminId ? String(adminId) : null,
    sessionId: sessionId ? String(sessionId).trim() : null,
    onEvent,
  });

  if (redisIsEnabled()) {
    void ensureSubscriberClient().catch(reportSubscriberError);
  }

  return () => {
    listeners.delete(listenerId);
    if (listeners.size === 0 && subscriberClient) {
      const idleClient = subscriberClient;
      subscriberClient = null;
      subscriberReadyPromise = null;
      void closeRedisClient(idleClient);
    }
  };
};

const closeLiveSupportEventClients = async () => {
  listeners.clear();
  const clients = [publisherClient, subscriberClient].filter(Boolean);
  publisherClient = null;
  subscriberClient = null;
  publisherReadyPromise = null;
  subscriberReadyPromise = null;
  await Promise.allSettled(clients.map(closeRedisClient));
};

module.exports = {
  LIVE_SUPPORT_EVENT_CHANNEL,
  closeLiveSupportEventClients,
  publishLiveSupportEvent,
  registerLiveSupportListener,
};
