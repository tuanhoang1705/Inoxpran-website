"use strict";

const crypto = require("node:crypto");
const redis = require("redis");
const { getRedisConfig } = require("../config/redis");
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

const buildEventId = () => {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString("hex");
};

const buildRedisClient = () => {
  const client = redis.createClient(getRedisConfig());
  client.on("error", (error) => {
    console.error(
      "[live-support-events] redis client error",
      error?.message || error,
    );
  });
  return client;
};

const ensurePublisherClient = async () => {
  if (!publisherClient) {
    publisherClient = buildRedisClient();
  }
  if (!publisherReadyPromise) {
    publisherReadyPromise = (async () => {
      if (!publisherClient.isOpen) {
        await publisherClient.connect();
      }
      return publisherClient;
    })().catch((error) => {
      publisherReadyPromise = null;
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

const ensureSubscriberClient = async () => {
  if (!subscriberClient) {
    subscriberClient = buildRedisClient();
  }
  if (!subscriberReadyPromise) {
    subscriberReadyPromise = (async () => {
      if (!subscriberClient.isOpen) {
        await subscriberClient.connect();
      }
      await subscriberClient.subscribe(
        LIVE_SUPPORT_EVENT_CHANNEL,
        (message) => {
          if (!message) return;
          try {
            const parsed = JSON.parse(message);
            deliverEvent(parsed);
            void dispatchLiveSupportPushNotifications(parsed).catch((error) => {
              console.error(
                "[live-support-events] web push dispatch failed",
                error?.message || error,
              );
            });
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
      subscriberReadyPromise = null;
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
  try {
    const client = await ensurePublisherClient();
    await client.publish(LIVE_SUPPORT_EVENT_CHANNEL, JSON.stringify(payload));
  } catch (error) {
    console.error(
      "[live-support-events] publish failed",
      error?.message || error,
    );
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

  void ensureSubscriberClient().catch((error) => {
    console.error(
      "[live-support-events] subscriber init failed",
      error?.message || error,
    );
  });

  return () => {
    listeners.delete(listenerId);
  };
};

module.exports = {
  LIVE_SUPPORT_EVENT_CHANNEL,
  publishLiveSupportEvent,
  registerLiveSupportListener,
};
