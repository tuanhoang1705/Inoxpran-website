"use strict";

const webPush = require("web-push");
const adminModel = require("../models/admin.model");
const {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} = require("../core/error.response");
const { convertToObjectIdMongodb } = require("../utils");

const CHAT_CAPABLE_ADMIN_ROLES = new Set([
  "CHAT_MANAGER",
  "ADMIN",
  "SUPER_ADMIN",
  "LEAD_MANAGER",
]);
const ROOT_ADMIN_EMAILS = new Set(
  String(
    process.env.ROOT_ADMIN_EMAILS || "congtytnhhdaututhangvuong2@gmail.com",
  )
    .split(",")
    .map((value) =>
      String(value || "")
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean),
);
const PUSHABLE_EVENT_ACTIONS = new Set([
  "handoff_requested",
  "customer_message",
]);
const MAX_SUBSCRIPTIONS_PER_ADMIN = Math.min(
  Math.max(Number(process.env.WEB_PUSH_MAX_SUBSCRIPTIONS_PER_ADMIN) || 6, 1),
  20,
);
const DEFAULT_PUSH_ICON = "/icons/android-icon-192x192.png";
const DEFAULT_PUSH_BADGE = "/icons/favicon-96x96.png";
let lastConfiguredSignature = "";

const normalizeEnvValue = (value) => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

const normalizeText = (value = "") => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const normalizeAdminEmail = (value = "") => normalizeText(value).toLowerCase();

const normalizeAdminRoles = (roles = [], email = "") => {
  const items = (Array.isArray(roles) ? roles : [roles])
    .map((role) => normalizeText(role))
    .filter(Boolean);
  if (ROOT_ADMIN_EMAILS.has(normalizeAdminEmail(email))) {
    items.push("ADMIN", "SUPER_ADMIN");
  }
  return Array.from(new Set(items));
};

const adminCanReceiveLiveSupportPush = (admin) => {
  if (
    String(admin?.status || "")
      .trim()
      .toLowerCase() !== "active"
  )
    return false;
  return normalizeAdminRoles(admin?.roles || [], admin?.email).some((role) =>
    CHAT_CAPABLE_ADMIN_ROLES.has(role),
  );
};

const normalizeSubject = (value = "") => {
  const subject = normalizeEnvValue(value);
  if (!subject) return "";
  if (/^https?:\/\//i.test(subject) || /^mailto:/i.test(subject))
    return subject;
  if (subject.includes("@")) return `mailto:${subject}`;
  return "";
};

const getWebPushRuntimeConfig = () => {
  const publicKey = normalizeEnvValue(process.env.WEB_PUSH_VAPID_PUBLIC_KEY);
  const privateKey = normalizeEnvValue(process.env.WEB_PUSH_VAPID_PRIVATE_KEY);
  const subject = normalizeSubject(
    process.env.WEB_PUSH_SUBJECT ||
      process.env.PUBLIC_SUPPORT_EMAIL ||
      process.env.SMTP_FROM ||
      "no-reply@inoxpran.com",
  );
  return {
    enabled: Boolean(publicKey && privateKey && subject),
    publicKey: publicKey || null,
    privateKey: privateKey || null,
    subject: subject || null,
  };
};

const ensureWebPushReady = () => {
  const config = getWebPushRuntimeConfig();
  if (!config.enabled) return null;
  const signature = `${config.subject}|${config.publicKey}|${config.privateKey}`;
  if (signature !== lastConfiguredSignature) {
    webPush.setVapidDetails(
      config.subject,
      config.publicKey,
      config.privateKey,
    );
    lastConfiguredSignature = signature;
  }
  return config;
};

const normalizeSubscriptionPayload = (payload = {}, fallbackUserAgent = "") => {
  const source =
    payload?.subscription &&
    typeof payload.subscription === "object" &&
    !Array.isArray(payload.subscription)
      ? payload.subscription
      : payload;

  const endpoint = normalizeText(source?.endpoint);
  const p256dh = normalizeText(source?.keys?.p256dh);
  const auth = normalizeText(source?.keys?.auth);
  if (!endpoint || !p256dh || !auth) {
    throw new BadRequestError("Invalid web push subscription");
  }

  const rawExpirationTime = source?.expirationTime;
  const expirationTime =
    rawExpirationTime === null ||
    rawExpirationTime === undefined ||
    rawExpirationTime === ""
      ? null
      : Number(rawExpirationTime);
  const deviceLabel = normalizeText(payload?.deviceLabel);
  const userAgent = normalizeText(payload?.userAgent || fallbackUserAgent);

  return {
    endpoint,
    expirationTime: Number.isFinite(expirationTime) ? expirationTime : null,
    keys: {
      p256dh,
      auth,
    },
    deviceLabel: deviceLabel || null,
    userAgent: userAgent || null,
  };
};

const serializeSubscriptionEntry = (entry = {}) => ({
  endpoint: normalizeText(entry.endpoint),
  expirationTime:
    entry.expirationTime === null || entry.expirationTime === undefined
      ? null
      : Number(entry.expirationTime),
  keys: {
    p256dh: normalizeText(entry?.keys?.p256dh),
    auth: normalizeText(entry?.keys?.auth),
  },
  deviceLabel: normalizeText(entry.deviceLabel) || null,
  userAgent: normalizeText(entry.userAgent) || null,
  createdAt: entry.createdAt ? new Date(entry.createdAt) : null,
  updatedAt: entry.updatedAt ? new Date(entry.updatedAt) : null,
  lastSuccessAt: entry.lastSuccessAt ? new Date(entry.lastSuccessAt) : null,
  lastFailureAt: entry.lastFailureAt ? new Date(entry.lastFailureAt) : null,
  failureReason: normalizeText(entry.failureReason) || null,
});

const buildSubscriptionEntry = ({
  existingEntry = null,
  subscription,
  now = new Date(),
}) => ({
  endpoint: subscription.endpoint,
  expirationTime: subscription.expirationTime,
  keys: {
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
  },
  deviceLabel: subscription.deviceLabel,
  userAgent: subscription.userAgent,
  createdAt: existingEntry?.createdAt ? new Date(existingEntry.createdAt) : now,
  updatedAt: now,
  lastSuccessAt: existingEntry?.lastSuccessAt
    ? new Date(existingEntry.lastSuccessAt)
    : null,
  lastFailureAt: null,
  failureReason: null,
});

const buildRoomCode = (sessionId = "") => {
  const normalized = normalizeText(sessionId);
  return normalized.replace(/^chat_?/, "") || normalized || "live-support";
};

const shouldNotifyForLiveSupportEvent = (event = {}) => {
  const action = normalizeText(event?.action).toLowerCase();
  if (!PUSHABLE_EVENT_ACTIONS.has(action)) return false;
  if (action === "customer_message") {
    const status = normalizeText(event?.payload?.status).toLowerCase();
    return status === "handoff" || Boolean(event?.payload?.liveSupportActive);
  }
  return true;
};

const buildLiveSupportPushPayload = (event = {}) => {
  const sessionId = normalizeText(event?.sessionId);
  if (!sessionId) return null;

  const roomCode = buildRoomCode(sessionId);
  const action = normalizeText(event?.action).toLowerCase();
  const url = `/admin/chat-rooms/${sessionId}`;
  const occurredAt = event?.occurredAt
    ? Date.parse(event.occurredAt)
    : Date.now();

  if (action === "handoff_requested") {
    return {
      title: "Khách mới cần tư vấn viên",
      body: `Room ${roomCode} đang chờ tư vấn viên nhận phòng.`,
      tag: `live-support-handoff:${sessionId}`,
      icon: DEFAULT_PUSH_ICON,
      badge: DEFAULT_PUSH_BADGE,
      renotify: true,
      requireInteraction: true,
      data: {
        url,
        sessionId,
        action,
      },
      timestamp: Number.isFinite(occurredAt) ? occurredAt : Date.now(),
    };
  }

  return {
    title: "Khách vừa nhắn thêm",
    body: `Room ${roomCode} vừa có tin nhắn mới từ khách.`,
    tag: `live-support-message:${sessionId}`,
    icon: DEFAULT_PUSH_ICON,
    badge: DEFAULT_PUSH_BADGE,
    renotify: true,
    requireInteraction: false,
    data: {
      url,
      sessionId,
      action,
    },
    timestamp: Number.isFinite(occurredAt) ? occurredAt : Date.now(),
  };
};

const buildSendOptions = () => ({
  TTL: Math.max(Number(process.env.WEB_PUSH_TTL_SECONDS) || 180, 60),
  urgency: "high",
  topic: "live-support",
});

const markSubscriptionSuccess = async ({ adminId, endpoint }) => {
  if (!adminId || !endpoint) return;
  const now = new Date();
  try {
    await adminModel.updateOne(
      {
        _id: adminId,
        "pushNotifications.webPushSubscriptions.endpoint": endpoint,
      },
      {
        $set: {
          "pushNotifications.webPushSubscriptions.$.updatedAt": now,
          "pushNotifications.webPushSubscriptions.$.lastSuccessAt": now,
          "pushNotifications.webPushSubscriptions.$.lastFailureAt": null,
          "pushNotifications.webPushSubscriptions.$.failureReason": null,
        },
      },
    );
  } catch (error) {
    console.error(
      "[web-push] failed to persist success state",
      error?.message || error,
    );
  }
};

const markSubscriptionFailure = async ({
  adminId,
  endpoint,
  reason,
  remove = false,
}) => {
  if (!adminId || !endpoint) return;
  const now = new Date();
  try {
    if (remove) {
      await adminModel.updateOne(
        { _id: adminId },
        { $pull: { "pushNotifications.webPushSubscriptions": { endpoint } } },
      );
      return;
    }

    await adminModel.updateOne(
      {
        _id: adminId,
        "pushNotifications.webPushSubscriptions.endpoint": endpoint,
      },
      {
        $set: {
          "pushNotifications.webPushSubscriptions.$.updatedAt": now,
          "pushNotifications.webPushSubscriptions.$.lastFailureAt": now,
          "pushNotifications.webPushSubscriptions.$.failureReason":
            normalizeText(reason) || "web_push_failed",
        },
      },
    );
  } catch (error) {
    console.error(
      "[web-push] failed to persist failure state",
      error?.message || error,
    );
  }
};

const getWebPushClientConfig = () => {
  const config = getWebPushRuntimeConfig();
  return {
    enabled: config.enabled,
    publicKey: config.enabled ? config.publicKey : null,
  };
};

const registerAdminWebPushSubscription = async ({
  adminId,
  payload,
  userAgent = "",
} = {}) => {
  const config = ensureWebPushReady();
  if (!config) {
    throw new BadRequestError("Web push is not configured");
  }

  const adminObjectId = convertToObjectIdMongodb(adminId);
  if (!adminObjectId) throw new BadRequestError("Invalid admin id");

  const admin = await adminModel
    .findById(adminObjectId)
    .select({
      email: 1,
      name: 1,
      status: 1,
      roles: 1,
      pushNotifications: 1,
    })
    .lean();
  if (!admin) throw new NotFoundError("Admin not found");
  if (!adminCanReceiveLiveSupportPush(admin)) {
    throw new ForbiddenError(
      "Admin is not allowed to receive live-support push notifications",
    );
  }

  const subscription = normalizeSubscriptionPayload(payload, userAgent);
  const now = new Date();

  await adminModel.updateMany(
    {
      "pushNotifications.webPushSubscriptions.endpoint": subscription.endpoint,
    },
    {
      $pull: {
        "pushNotifications.webPushSubscriptions": {
          endpoint: subscription.endpoint,
        },
      },
    },
  );

  const currentSubscriptions = Array.isArray(
    admin?.pushNotifications?.webPushSubscriptions,
  )
    ? admin.pushNotifications.webPushSubscriptions
        .map((item) => serializeSubscriptionEntry(item))
        .filter((item) => item.endpoint)
    : [];
  const existingEntry =
    currentSubscriptions.find(
      (item) => item.endpoint === subscription.endpoint,
    ) || null;
  const nextSubscriptions = [
    buildSubscriptionEntry({ existingEntry, subscription, now }),
    ...currentSubscriptions.filter(
      (item) => item.endpoint !== subscription.endpoint,
    ),
  ].slice(0, MAX_SUBSCRIPTIONS_PER_ADMIN);

  await adminModel.updateOne(
    { _id: adminObjectId },
    {
      $set: {
        "pushNotifications.webPushSubscriptions": nextSubscriptions,
      },
    },
  );

  return {
    enabled: true,
    subscribed: true,
    endpoint: subscription.endpoint,
    deviceLabel: subscription.deviceLabel,
    totalSubscriptions: nextSubscriptions.length,
  };
};

const unregisterAdminWebPushSubscription = async ({
  adminId,
  payload,
} = {}) => {
  const adminObjectId = convertToObjectIdMongodb(adminId);
  if (!adminObjectId) throw new BadRequestError("Invalid admin id");

  const endpoint = normalizeText(
    payload?.endpoint || payload?.subscription?.endpoint,
  );
  if (!endpoint) {
    throw new BadRequestError("Push subscription endpoint is required");
  }

  await adminModel.updateOne(
    { _id: adminObjectId },
    { $pull: { "pushNotifications.webPushSubscriptions": { endpoint } } },
  );

  return {
    removed: true,
    endpoint,
  };
};

const dispatchLiveSupportPushNotifications = async (event = {}) => {
  if (!shouldNotifyForLiveSupportEvent(event))
    return { sent: 0, skipped: true };
  const config = ensureWebPushReady();
  if (!config) return { sent: 0, skipped: true, reason: "not_configured" };

  const payload = buildLiveSupportPushPayload(event);
  if (!payload) return { sent: 0, skipped: true, reason: "invalid_event" };

  const admins = await adminModel
    .find({
      status: "active",
      "pushNotifications.webPushSubscriptions.0": { $exists: true },
    })
    .select({
      email: 1,
      status: 1,
      roles: 1,
      pushNotifications: 1,
    })
    .lean();

  const eligibleAdmins = admins.filter((admin) =>
    adminCanReceiveLiveSupportPush(admin),
  );
  if (!eligibleAdmins.length)
    return { sent: 0, skipped: true, reason: "no_subscribers" };

  let sent = 0;
  const body = JSON.stringify(payload);
  for (const admin of eligibleAdmins) {
    const subscriptions = Array.isArray(
      admin?.pushNotifications?.webPushSubscriptions,
    )
      ? admin.pushNotifications.webPushSubscriptions
          .map((item) => serializeSubscriptionEntry(item))
          .filter((item) => item.endpoint && item.keys.p256dh && item.keys.auth)
      : [];

    for (const subscription of subscriptions) {
      try {
        await webPush.sendNotification(
          {
            endpoint: subscription.endpoint,
            expirationTime: subscription.expirationTime,
            keys: subscription.keys,
          },
          body,
          buildSendOptions(),
        );
        sent += 1;
        await markSubscriptionSuccess({
          adminId: admin._id,
          endpoint: subscription.endpoint,
        });
      } catch (error) {
        const statusCode = Number(error?.statusCode) || 0;
        const shouldRemove = statusCode === 404 || statusCode === 410;
        await markSubscriptionFailure({
          adminId: admin._id,
          endpoint: subscription.endpoint,
          reason: error?.body || error?.message || "web_push_failed",
          remove: shouldRemove,
        });
        console.error(
          "[web-push] notification send failed",
          statusCode || "unknown",
          error?.message || error,
        );
      }
    }
  }

  return { sent, skipped: sent === 0 };
};

module.exports = {
  getWebPushClientConfig,
  registerAdminWebPushSubscription,
  unregisterAdminWebPushSubscription,
  dispatchLiveSupportPushNotifications,
};
