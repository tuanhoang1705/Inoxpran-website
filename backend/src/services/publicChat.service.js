"use strict";

const crypto = require("node:crypto");
const ChatSession = require("../models/chatSession.model");
const ChatMessage = require("../models/chatMessage.model");
const { publishLiveSupportEvent } = require("./liveSupportEvent.service");
const { BadRequestError } = require("../core/error.response");
const { convertToObjectIdMongodb } = require("../utils");

const MAX_SESSION_ID_LENGTH = 160;
const MAX_VISITOR_ID_LENGTH = 160;
const MAX_TELEMETRY_ID_LENGTH = 160;
const MAX_SOURCE_PATH_LENGTH = 600;
const MAX_MESSAGE_LENGTH = 12000;
const DEFAULT_MESSAGE_LIMIT = 60;
const MAX_MESSAGE_LIMIT = 200;
const CUSTOMER_HISTORY_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;

const normalizeString = (value = "", maxLength = 500) =>
  String(value || "").trim().slice(0, maxLength);

const normalizeOptionalString = (value = "", maxLength = 500) => {
  const normalized = normalizeString(value, maxLength);
  return normalized || null;
};

const normalizeLocale = (value = "vi") => {
  const normalized = normalizeString(value, 12).toLowerCase();
  return normalized === "en" ? "en" : "vi";
};

const normalizeSourcePath = (value = "/") => {
  const normalized = normalizeString(value, MAX_SOURCE_PATH_LENGTH);
  if (!normalized) return "/";
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
};

const normalizeSessionId = (value = "") =>
  normalizeOptionalString(value, MAX_SESSION_ID_LENGTH);

const normalizeMessageText = (value = "") =>
  normalizeOptionalString(value, MAX_MESSAGE_LENGTH);

const normalizeMetaObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const buildSessionId = () => {
  if (typeof crypto.randomUUID === "function") {
    return `chat_${crypto.randomUUID().replace(/-/g, "")}`;
  }
  return `chat_${Date.now().toString(36)}_${crypto.randomBytes(8).toString("hex")}`;
};

const buildReusableSessionFilter = ({
  userObjectId = null,
  visitorId = null,
  telemetrySessionId = null,
  at = new Date(),
}) => {
  const identityFilters = [];
  if (userObjectId) identityFilters.push({ user: userObjectId });
  if (visitorId) identityFilters.push({ visitorId });
  if (telemetrySessionId) identityFilters.push({ telemetrySessionId });
  if (!identityFilters.length) return null;

  return {
    $or: identityFilters,
    lastActiveAt: { $gte: new Date(at.getTime() - CUSTOMER_HISTORY_RETENTION_MS) },
  };
};

const toObjectIdString = (value) => {
  if (!value) return "";
  try {
    return String(value);
  } catch {
    return "";
  }
};

const toDateOrNull = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const mapTypingState = (typing = {}) => ({
  active: Boolean(typing?.active),
  source: typing?.source || null,
  updatedAt: typing?.updatedAt || null,
  until: typing?.until || null,
});

const mapLiveSupport = (session = {}) => ({
  active: Boolean(session?.liveSupport?.active),
  channel: session?.liveSupport?.channel || null,
  adminName:
    session?.liveSupport?.adminName ||
    session?.liveSupport?.assignedAdminName ||
    null,
  adminEmail:
    session?.liveSupport?.adminEmail ||
    session?.liveSupport?.assignedAdminEmail ||
    null,
  accountLabel:
    session?.liveSupport?.accountLabel ||
    session?.liveSupport?.assignedAccountLabel ||
    null,
  lastMessageAt: session?.liveSupport?.lastMessageAt || null,
  typing: mapTypingState(session?.liveSupport?.typing),
});

const mapCustomerPresence = (session = {}) => ({
  state: session?.customerPresence?.state || "active",
  lastSeenAt: session?.customerPresence?.lastSeenAt || null,
  leftAt: session?.customerPresence?.leftAt || null,
});

const mapMessage = (message = {}) => ({
  id: toObjectIdString(message?._id),
  role: message?.role || null,
  text: message?.text || "",
  meta: message?.meta || null,
  createdAt: message?.createdAt || null,
  updatedAt: message?.updatedAt || null,
});

const buildHandoffReply = (locale = "vi") =>
  normalizeLocale(locale) === "en"
    ? "The current support flow uses AI first. A consultant request has been recorded for this chat room. Please leave your phone number in the chat if needed so the support team can follow up."
    : "Khung chat này đang hỗ trợ AI trước. Yêu cầu chuyển sang tư vấn viên đã được ghi nhận cho phòng chat này. Anh/chị vui lòng để lại số điện thoại trong khung chat nếu cần để đội CSKH liên hệ.";

const applyPresenceState = (session, state, at = new Date()) => {
  const current = session?.customerPresence?.toObject
    ? session.customerPresence.toObject()
    : session?.customerPresence || {};
  const nextState = state === "left" ? "left" : "active";
  session.customerPresence = {
    ...current,
    state: nextState,
    lastSeenAt: at,
    leftAt: nextState === "left" ? at : null,
  };
};

const touchSessionContext = (session, { userObjectId, sourcePath, locale, visitorId, telemetrySessionId, at }) => {
  if (visitorId) session.visitorId = visitorId;
  if (telemetrySessionId) session.telemetrySessionId = telemetrySessionId;
  if (locale) session.locale = locale;
  if (sourcePath) session.sourcePath = sourcePath;
  if (userObjectId) {
    session.user = userObjectId;
  }

  const currentContext = session?.context?.toObject
    ? session.context.toObject()
    : session?.context || {};
  session.context = {
    ...currentContext,
    authenticatedCustomer: Boolean(userObjectId || session.user),
    userLinkSource: userObjectId || session.user ? "direct" : currentContext.userLinkSource || null,
  };
  session.lastActiveAt = at;
};

const ensureChatSession = async ({
  sessionId = null,
  visitorId = null,
  telemetrySessionId = null,
  userId = null,
  locale = "vi",
  sourcePath = "/",
  presenceState = "active",
}) => {
  const now = new Date();
  const normalizedSessionId = normalizeSessionId(sessionId);
  const normalizedVisitorId = normalizeOptionalString(visitorId, MAX_VISITOR_ID_LENGTH);
  const normalizedTelemetrySessionId = normalizeOptionalString(
    telemetrySessionId,
    MAX_TELEMETRY_ID_LENGTH,
  );
  const normalizedLocale = normalizeLocale(locale);
  const normalizedSourcePath = normalizeSourcePath(sourcePath);
  const userObjectId = convertToObjectIdMongodb(userId);

  const reusableFilter = !normalizedSessionId
    ? buildReusableSessionFilter({
        userObjectId,
        visitorId: normalizedVisitorId,
        telemetrySessionId: normalizedTelemetrySessionId,
        at: now,
      })
    : null;

  const foundSession =
    (normalizedSessionId
      ? await ChatSession.findOne({ sessionId: normalizedSessionId })
      : null) ||
    (reusableFilter
      ? await ChatSession.findOne(reusableFilter).sort({
          lastActiveAt: -1,
          updatedAt: -1,
          _id: -1,
        })
      : null) ||
    new ChatSession({
      sessionId: normalizedSessionId || buildSessionId(),
      status: "open",
    });

  touchSessionContext(foundSession, {
    userObjectId,
    sourcePath: normalizedSourcePath,
    locale: normalizedLocale,
    visitorId: normalizedVisitorId,
    telemetrySessionId: normalizedTelemetrySessionId,
    at: now,
  });
  applyPresenceState(foundSession, presenceState, now);
  await foundSession.save();

  return foundSession;
};

const emitRoomEvent = async (session, action, payload = {}) => {
  await publishLiveSupportEvent({
    type: "chat_room.updated",
    source: "frontend_chat",
    sessionId: session?.sessionId || null,
    action,
    payload,
  });
};

class PublicChatService {
  static createSession = async ({
    sessionId = null,
    visitorId = null,
    telemetrySessionId = null,
    userId = null,
    locale = "vi",
    sourcePath = "/",
  } = {}) => {
    const session = await ensureChatSession({
      sessionId,
      visitorId,
      telemetrySessionId,
      userId,
      locale,
      sourcePath,
      presenceState: "active",
    });

    return {
      sessionId: session.sessionId,
      visitorId: session.visitorId || null,
      telemetrySessionId: session.telemetrySessionId || null,
      locale: session.locale || normalizeLocale(locale),
      sourcePath: session.sourcePath || normalizeSourcePath(sourcePath),
      status: session.status || "open",
      liveSupport: mapLiveSupport(session),
      customerPresence: mapCustomerPresence(session),
    };
  };

  static createChatExchange = async ({
    sessionId = null,
    visitorId = null,
    telemetrySessionId = null,
    userId = null,
    locale = "vi",
    sourcePath = "/",
    userText = "",
    assistantText = "",
    userMeta = null,
    assistantMeta = null,
  } = {}) => {
    const normalizedUserText = normalizeMessageText(userText);
    const normalizedAssistantText = normalizeMessageText(assistantText);
    if (!normalizedUserText || !normalizedAssistantText) {
      throw new BadRequestError("Chat exchange is missing text");
    }

    const session = await ensureChatSession({
      sessionId,
      visitorId,
      telemetrySessionId,
      userId,
      locale,
      sourcePath,
      presenceState: "active",
    });

    if (session.status === "closed" && !session?.liveSupport?.active) {
      session.status = "open";
      session.resolvedAt = null;
      session.resolvedBy = null;
    }
    session.lastProvider = "openai";
    session.lastActiveAt = new Date();
    await session.save();

    const safeUserMeta = normalizeMetaObject(userMeta);
    const safeAssistantMeta = normalizeMetaObject(assistantMeta);
    const inserted = await ChatMessage.insertMany([
      {
        sessionId: session.sessionId,
        role: "user",
        text: normalizedUserText,
        meta: {
          source: "widget",
          kind: "ai_request",
          telemetrySessionId: session.telemetrySessionId || null,
          sourcePath: session.sourcePath || "/",
          ...safeUserMeta,
        },
      },
      {
        sessionId: session.sessionId,
        role: "assistant",
        text: normalizedAssistantText,
        meta: {
          source: "openai",
          kind: "ai_reply",
          ...safeAssistantMeta,
        },
      },
    ]);

    await emitRoomEvent(session, "customer_message", {
      status: session.status,
      liveSupportActive: Boolean(session?.liveSupport?.active),
      customerPresence: mapCustomerPresence(session),
      latestMessageRole: "assistant",
    });

    return {
      sessionId: session.sessionId,
      status: session.status,
      liveSupport: mapLiveSupport(session),
      customerPresence: mapCustomerPresence(session),
      messages: inserted.map(mapMessage),
    };
  };

  static getMessages = async ({
    sessionId = null,
    after = null,
    limit = DEFAULT_MESSAGE_LIMIT,
  } = {}) => {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
      throw new BadRequestError("Invalid chat session id");
    }

    const session = await ChatSession.findOne({ sessionId: normalizedSessionId }).lean();
    if (!session) {
      return {
        sessionId: normalizedSessionId,
        items: [],
        liveSupport: mapLiveSupport(null),
        customerPresence: mapCustomerPresence(null),
      };
    }

    const safeLimit = Math.min(
      Math.max(Number(limit) || DEFAULT_MESSAGE_LIMIT, 1),
      MAX_MESSAGE_LIMIT,
    );
    const afterDate = toDateOrNull(after);
    const filter = { sessionId: normalizedSessionId };
    const retentionFloor = new Date(Date.now() - CUSTOMER_HISTORY_RETENTION_MS);
    const effectiveAfter =
      afterDate && afterDate > retentionFloor ? afterDate : retentionFloor;
    filter.createdAt = { $gte: effectiveAfter };

    const items = await ChatMessage.find(filter)
      .sort({ createdAt: 1, _id: 1 })
      .limit(safeLimit)
      .lean();

    return {
      sessionId: normalizedSessionId,
      items: items.map(mapMessage),
      liveSupport: mapLiveSupport(session),
      customerPresence: mapCustomerPresence(session),
      status: session.status || "open",
    };
  };

  static requestHandoff = async ({
    sessionId = null,
    visitorId = null,
    telemetrySessionId = null,
    userId = null,
    locale = "vi",
    sourcePath = "/",
    userText = "",
  } = {}) => {
    const session = await ensureChatSession({
      sessionId,
      visitorId,
      telemetrySessionId,
      userId,
      locale,
      sourcePath,
      presenceState: "active",
    });
    const now = new Date();
    const reply = buildHandoffReply(locale);
    const normalizedUserText =
      normalizeMessageText(userText) ||
      (normalizeLocale(locale) === "en"
        ? "I want to talk to a human consultant directly."
        : "Tôi muốn trao đổi với tư vấn viên trực tiếp.");

    session.status = "handoff";
    session.lastProvider = "openai";
    session.lastActiveAt = now;
    session.handoff = {
      ...(session?.handoff?.toObject ? session.handoff.toObject() : session?.handoff || {}),
      requestedAt: session?.handoff?.requestedAt || now,
      requestedBy: "customer",
      targetChannel: "admin_console",
    };
    await session.save();

    const inserted = await ChatMessage.insertMany([
      {
        sessionId: session.sessionId,
        role: "user",
        text: normalizedUserText,
        meta: {
          source: "widget",
          kind: "handoff_request",
          telemetrySessionId: session.telemetrySessionId || null,
          sourcePath: session.sourcePath || "/",
        },
      },
      {
        sessionId: session.sessionId,
        role: "assistant",
        text: reply,
        meta: {
          source: "system",
          kind: "handoff_confirmation",
        },
      },
    ]);

    await emitRoomEvent(session, "handoff_requested", {
      status: session.status,
      liveSupportActive: Boolean(session?.liveSupport?.active),
      customerPresence: mapCustomerPresence(session),
    });

    return {
      sessionId: session.sessionId,
      reply,
      status: session.status,
      liveSupport: mapLiveSupport(session),
      customerPresence: mapCustomerPresence(session),
      messages: inserted.map(mapMessage),
    };
  };

  static updatePresence = async ({
    sessionId = null,
    visitorId = null,
    telemetrySessionId = null,
    userId = null,
    locale = "vi",
    sourcePath = "/",
    state = "active",
  } = {}) => {
    const nextState = String(state || "").trim().toLowerCase();
    if (!["active", "left"].includes(nextState)) {
      throw new BadRequestError("Invalid customer presence state");
    }

    const session = await ensureChatSession({
      sessionId,
      visitorId,
      telemetrySessionId,
      userId,
      locale,
      sourcePath,
      presenceState: nextState,
    });

    await emitRoomEvent(session, "customer_presence_updated", {
      state: nextState,
      customerPresence: mapCustomerPresence(session),
      status: session.status,
    });

    return {
      sessionId: session.sessionId,
      state: nextState,
      liveSupport: mapLiveSupport(session),
      customerPresence: mapCustomerPresence(session),
    };
  };
}

module.exports = PublicChatService;
