"use strict";

const bcrypt = require("bcrypt");
const crypto = require("node:crypto");
const adminModel = require("../models/admin.model");
const KeyTokenService = require("./keyToken.service");
const UserService = require("./user.service");
const TelemetryService = require("./telemetry.service");
const DashboardMetricsService = require("./dashboardMetrics.service");
const SiteSettingService = require("./siteSetting.service");
const { deleteImageFromStorage } = require("./storage.service");
const { publishLiveSupportEvent } = require("./liveSupportEvent.service");
const {
  getWebPushClientConfig,
  registerAdminWebPushSubscription,
  unregisterAdminWebPushSubscription,
} = require("./webPush.service");
const { createTokenPair } = require("../auth/authUtils");
const { findByEmail, findById } = require("../models/repositories/admin.repo");
const {
  findAllUsers,
  countUsers,
  findById: findUserById,
} = require("../models/repositories/user.repo");
const {
  BadRequestError,
  AuthFailureError,
  ForbiddenError,
  NotFoundError,
} = require("../core/error.response");
const {
  getInfoData,
  removeUndefinedObject,
  convertToObjectIdMongodb,
} = require("../utils");
const userModel = require("../models/user.model");
const UserToken = require("../models/userToken.model");
const ChatLead = require("../models/chatLead.model");
const ChatSession = require("../models/chatSession.model");
const ChatMessage = require("../models/chatMessage.model");
const AdminAuditLog = require("../models/adminAuditLog.model");
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

const RoleAdmin = {
  ADMIN: "ADMIN",
  SUPER_ADMIN: "SUPER_ADMIN",
  CONTACT_MANAGER: "CONTACT_MANAGER",
  SLIDE_MANAGER: "SLIDE_MANAGER",
  LEAD_MANAGER: "LEAD_MANAGER",
  CHAT_MANAGER: "CHAT_MANAGER",
};

const LEAD_STATUS = ["new", "contacted", "won", "lost"];
const CHAT_ROOM_STATUS = ["open", "closed", "handoff"];
const ADMIN_ACCOUNT_STATUS = ["active", "inactive", "blocked", "pending"];
const ADMIN_AUDIT_ACTION = {
  STATUS_UPDATED: "admin_account.status_updated",
  ROLES_UPDATED: "admin_account.roles_updated",
  DELETED: "admin_account.deleted",
  ROUTING_UPDATED: "admin_account.routing_updated",
};
const CHAT_CAPABLE_ADMIN_ROLES = [
  RoleAdmin.CHAT_MANAGER,
  RoleAdmin.ADMIN,
  RoleAdmin.SUPER_ADMIN,
];
const LIVE_SUPPORT_WAITING_SLA_MS = Math.max(
  Number(process.env.LIVE_SUPPORT_WAITING_SLA_MS) || 5 * 60 * 1000,
  60 * 1000,
);
const LIVE_SUPPORT_ACTIVE_SLA_MS = Math.max(
  Number(process.env.LIVE_SUPPORT_ACTIVE_SLA_MS) || 10 * 60 * 1000,
  60 * 1000,
);
const LIVE_SUPPORT_TIMEZONE =
  String(
    process.env.LIVE_SUPPORT_TIMEZONE ||
      process.env.GENERIC_TIMEZONE ||
      "Asia/Ho_Chi_Minh",
  ).trim() || "Asia/Ho_Chi_Minh";
const DEFAULT_SHIFT_DAYS = [1, 2, 3, 4, 5, 6, 0];
const escapeRegex = (value = "") =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const normalizeAdminEmail = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase();
const normalizeShiftTime = (value = "") => {
  const normalized = String(value || "").trim();
  return /^\d{2}:\d{2}$/.test(normalized) ? normalized : null;
};
const normalizeShiftDays = (value) => {
  const source = Array.isArray(value) ? value : [value];
  const normalized = source
    .flatMap((item) => String(item || "").split(","))
    .map((item) => Number.parseInt(String(item || "").trim(), 10))
    .filter((item) => Number.isInteger(item) && item >= 0 && item <= 6);
  return Array.from(new Set(normalized)).sort((left, right) => left - right);
};
const normalizeRoutingPriority = (value) => {
  const normalized = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(normalized)) return 100;
  return Math.min(Math.max(normalized, 1), 999);
};
const parseTimeToMinutes = (value) => {
  const normalized = normalizeShiftTime(value);
  if (!normalized) return null;
  const [hour, minute] = normalized
    .split(":")
    .map((item) => Number.parseInt(item, 10));
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  return hour * 60 + minute;
};
const getZonedDayAndMinutes = (
  value = new Date(),
  timeZone = LIVE_SUPPORT_TIMEZONE,
) => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(value);
  const entries = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  const weekdayMap = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    day: weekdayMap[entries.weekday] ?? value.getDay(),
    minutes:
      Number.parseInt(entries.hour || "0", 10) * 60 +
      Number.parseInt(entries.minute || "0", 10),
  };
};
const isConfiguredRootAdminEmail = (email = "") =>
  ROOT_ADMIN_EMAILS.has(normalizeAdminEmail(email));
const normalizeAdminRoles = (roles = [], email = "") => {
  const items = (Array.isArray(roles) ? roles : [roles])
    .map((role) => String(role || "").trim())
    .filter((role) => Object.values(RoleAdmin).includes(role));
  if (isConfiguredRootAdminEmail(email)) {
    items.push(RoleAdmin.ADMIN, RoleAdmin.SUPER_ADMIN);
  }
  return Array.from(new Set(items));
};
const resolveEffectiveAdminRoles = (admin) =>
  normalizeAdminRoles(admin?.roles || [], admin?.email);
const isEffectiveSuperAdmin = (admin) =>
  resolveEffectiveAdminRoles(admin).includes(RoleAdmin.SUPER_ADMIN);
const sortRoles = (roles = []) =>
  [...roles].sort((left, right) => left.localeCompare(right));
const sameRoles = (left = [], right = []) => {
  const leftSorted = sortRoles(left);
  const rightSorted = sortRoles(right);
  if (leftSorted.length !== rightSorted.length) return false;
  return leftSorted.every((role, index) => role === rightSorted[index]);
};
const buildAdminAuditSnapshot = (admin) => ({
  adminId: admin?._id ? String(admin._id) : null,
  name: admin?.name || null,
  email: admin?.email || null,
  status: admin?.status || null,
  roles: resolveEffectiveAdminRoles(admin),
});
const buildLiveSupportConsultantIdentity = (admin) => {
  if (!admin) return null;
  if (!adminSupportsLiveChat(admin) || admin?.status !== "active") {
    return null;
  }
  const adminId = admin?._id ? String(admin._id) : null;
  if (!adminId) return null;
  const accountKey = `admin:${adminId}`;
  const accountLabel = admin?.name || admin?.email || accountKey;

  return {
    adminId,
    adminEmail: admin?.email || null,
    adminName: admin?.name || null,
    accountKey,
    accountLabel,
    channel: "admin_console",
    routing: buildLiveSupportRoutingSnapshot(admin),
  };
};
const firstNonEmptyValue = (...values) =>
  values
    .map((value) => (typeof value === "string" ? value.trim() : value))
    .find((value) => typeof value === "string" && value.length > 0) || null;
const getConsultantDisplayName = (...values) =>
  firstNonEmptyValue(...values) || "tư vấn viên";
const buildConsultantJoinedText = (name) =>
  `Tư vấn viên ${name} đã vào phòng chat.`;
const buildConsultantLeftText = (name) =>
  `Tư vấn viên ${name} đã rời phòng chat.`;
const buildRoomClosedText = (name) =>
  `Phòng chat đã được đóng bởi tư vấn viên ${name}.`;
const buildRoomReopenedText = (name) =>
  `Phòng chat đã được mở lại bởi tư vấn viên ${name}.`;
const buildRoomTransferredText = (sourceName, targetName) =>
  `Phòng chat được chuyển từ ${sourceName} sang ${targetName}.`;
const buildRoomAssignedText = (targetName, actorName) =>
  `Phòng chat được giao cho ${targetName} bởi tư vấn viên ${actorName}.`;
const normalizeLiveSupportRouting = (routing = {}) => {
  const enabled = Boolean(routing?.enabled);
  const autoAssign = Boolean(routing?.autoAssign);
  const shiftEnabled = Boolean(routing?.shiftEnabled);
  const shiftStart = normalizeShiftTime(routing?.shiftStart);
  const shiftEnd = normalizeShiftTime(routing?.shiftEnd);
  const shiftDays = normalizeShiftDays(routing?.shiftDays);
  const priority = normalizeRoutingPriority(routing?.priority);

  if (
    !enabled &&
    !autoAssign &&
    !shiftEnabled &&
    !shiftStart &&
    !shiftEnd &&
    !shiftDays.length &&
    !routing?.updatedAt &&
    (Number(routing?.priority) || 0) === 0
  ) {
    return {
      enabled: false,
      autoAssign: false,
      shiftEnabled: false,
      shiftStart: null,
      shiftEnd: null,
      shiftDays: [...DEFAULT_SHIFT_DAYS],
      priority: 100,
      lastAutoAssignedAt: null,
      lastAutoAssignedSessionId: null,
      updatedAt: null,
    };
  }

  return {
    enabled,
    autoAssign: enabled && autoAssign,
    shiftEnabled: enabled && shiftEnabled,
    shiftStart: enabled ? shiftStart : null,
    shiftEnd: enabled ? shiftEnd : null,
    shiftDays: enabled
      ? shiftDays.length
        ? shiftDays
        : [...DEFAULT_SHIFT_DAYS]
      : [...DEFAULT_SHIFT_DAYS],
    priority,
    lastAutoAssignedAt: routing?.lastAutoAssignedAt
      ? new Date(routing.lastAutoAssignedAt)
      : null,
    lastAutoAssignedSessionId: enabled
      ? String(routing?.lastAutoAssignedSessionId || "").trim() || null
      : null,
    updatedAt: new Date(),
  };
};
const buildLiveSupportRoutingSnapshot = (admin) => ({
  enabled: Boolean(admin?.liveSupport?.routing?.enabled),
  autoAssign: Boolean(admin?.liveSupport?.routing?.autoAssign),
  shiftEnabled: Boolean(admin?.liveSupport?.routing?.shiftEnabled),
  shiftStart: admin?.liveSupport?.routing?.shiftStart || null,
  shiftEnd: admin?.liveSupport?.routing?.shiftEnd || null,
  shiftDays: Array.isArray(admin?.liveSupport?.routing?.shiftDays)
    ? [...admin.liveSupport.routing.shiftDays]
    : [...DEFAULT_SHIFT_DAYS],
  priority: Number.isFinite(Number(admin?.liveSupport?.routing?.priority))
    ? Number(admin.liveSupport.routing.priority)
    : 100,
  lastAutoAssignedAt: admin?.liveSupport?.routing?.lastAutoAssignedAt || null,
  lastAutoAssignedSessionId:
    admin?.liveSupport?.routing?.lastAutoAssignedSessionId || null,
});
const sameLiveSupportRouting = (left = {}, right = {}) =>
  Boolean(left?.enabled) === Boolean(right?.enabled) &&
  Boolean(left?.autoAssign) === Boolean(right?.autoAssign) &&
  Boolean(left?.shiftEnabled) === Boolean(right?.shiftEnabled) &&
  (left?.shiftStart || null) === (right?.shiftStart || null) &&
  (left?.shiftEnd || null) === (right?.shiftEnd || null) &&
  normalizeRoutingPriority(left?.priority) ===
    normalizeRoutingPriority(right?.priority) &&
  (left?.lastAutoAssignedSessionId || null) ===
    (right?.lastAutoAssignedSessionId || null) &&
  JSON.stringify(
    normalizeShiftDays(left?.shiftDays).length
      ? normalizeShiftDays(left?.shiftDays)
      : DEFAULT_SHIFT_DAYS,
  ) ===
    JSON.stringify(
      normalizeShiftDays(right?.shiftDays).length
        ? normalizeShiftDays(right?.shiftDays)
        : DEFAULT_SHIFT_DAYS,
    ) &&
  String(left?.lastAutoAssignedAt || "") ===
    String(right?.lastAutoAssignedAt || "");
const adminSupportsLiveChat = (admin) =>
  resolveEffectiveAdminRoles(admin).some((role) =>
    CHAT_CAPABLE_ADMIN_ROLES.includes(role),
  );
const isRoutingActiveNow = (routing = {}, now = new Date()) => {
  if (!routing?.enabled) return false;
  if (!routing?.shiftEnabled) return true;

  const shiftStartMinutes = parseTimeToMinutes(routing?.shiftStart);
  const shiftEndMinutes = parseTimeToMinutes(routing?.shiftEnd);
  const shiftDays = normalizeShiftDays(routing?.shiftDays).length
    ? normalizeShiftDays(routing?.shiftDays)
    : [...DEFAULT_SHIFT_DAYS];

  if (shiftStartMinutes === null || shiftEndMinutes === null) return false;

  const { day, minutes } = getZonedDayAndMinutes(now);
  if (!shiftDays.includes(day)) return false;

  if (shiftStartMinutes <= shiftEndMinutes) {
    return minutes >= shiftStartMinutes && minutes <= shiftEndMinutes;
  }

  return minutes >= shiftStartMinutes || minutes <= shiftEndMinutes;
};
const createAdminAuditLogs = async ({
  actorAdmin,
  targetAdmin,
  entries = [],
}) => {
  if (!entries.length) return;

  try {
    await AdminAuditLog.insertMany(
      entries.map((entry) => ({
        category: "admin_account",
        action: entry.action,
        actorAdmin: actorAdmin?._id || null,
        actorSnapshot: buildAdminAuditSnapshot(actorAdmin),
        targetAdmin: targetAdmin?._id || null,
        targetSnapshot: buildAdminAuditSnapshot(targetAdmin),
        summary: entry.summary,
        metadata: entry.metadata || {},
      })),
      { ordered: true },
    );
  } catch (error) {
    console.error("[admin-audit] failed to persist audit log", error);
  }
};
const toObjectIdString = (value) => {
  if (!value) return "";
  try {
    return String(value);
  } catch {
    return "";
  }
};
const getReadReceiptForAdmin = (session, adminId) => {
  const normalizedAdminId = toObjectIdString(adminId);
  if (!normalizedAdminId) return null;
  const receipts = Array.isArray(session?.liveSupport?.readReceipts)
    ? session.liveSupport.readReceipts
    : [];
  return (
    receipts.find(
      (receipt) => toObjectIdString(receipt?.adminId) === normalizedAdminId,
    ) || null
  );
};
const upsertReadReceipt = (session, adminId, at = new Date()) => {
  const normalizedAdminId = toObjectIdString(adminId);
  if (!normalizedAdminId) return;
  const nextReadAt = at instanceof Date ? at : new Date(at);
  const receipts = Array.isArray(session.liveSupport?.readReceipts)
    ? [...session.liveSupport.readReceipts]
    : [];
  const index = receipts.findIndex(
    (receipt) => toObjectIdString(receipt?.adminId) === normalizedAdminId,
  );
  if (index >= 0) {
    const previousReadAt = receipts[index]?.lastReadAt
      ? new Date(receipts[index].lastReadAt)
      : null;
    if (previousReadAt && previousReadAt >= nextReadAt) {
      return;
    }
    receipts[index] = {
      ...receipts[index],
      adminId: receipts[index].adminId,
      lastReadAt: nextReadAt,
    };
  } else {
    receipts.push({
      adminId: convertToObjectIdMongodb(normalizedAdminId),
      lastReadAt: nextReadAt,
    });
  }
  session.liveSupport = {
    ...(session.liveSupport?.toObject
      ? session.liveSupport.toObject()
      : session.liveSupport || {}),
    readReceipts: receipts,
  };
};
const buildChatRoomSla = ({
  session,
  latestMessage = null,
  latestCustomerMessageAt = null,
}) => {
  const status = String(session?.status || "").toLowerCase();
  const lastCustomerAt = latestCustomerMessageAt
    ? new Date(latestCustomerMessageAt)
    : null;
  const lastConsultantAt = session?.liveSupport?.lastMessageAt
    ? new Date(session.liveSupport.lastMessageAt)
    : null;
  const requestedAt = session?.handoff?.requestedAt
    ? new Date(session.handoff.requestedAt)
    : null;
  let startedAt = null;
  let state = "open";
  let targetMs = LIVE_SUPPORT_ACTIVE_SLA_MS;

  if (status === "closed") {
    state = "closed";
    startedAt = session?.resolvedAt || session?.updatedAt || null;
    targetMs = LIVE_SUPPORT_ACTIVE_SLA_MS;
  } else if (status === "handoff" && !session?.liveSupport?.active) {
    state = "waiting";
    startedAt =
      requestedAt ||
      lastCustomerAt ||
      session?.lastActiveAt ||
      session?.createdAt ||
      null;
    targetMs = LIVE_SUPPORT_WAITING_SLA_MS;
  } else if (status === "handoff" && session?.liveSupport?.active) {
    state = "active";
    startedAt =
      lastCustomerAt ||
      lastConsultantAt ||
      requestedAt ||
      session?.lastActiveAt ||
      session?.createdAt ||
      null;
    targetMs = LIVE_SUPPORT_ACTIVE_SLA_MS;
  } else {
    state = "open";
    startedAt =
      latestMessage?.createdAt ||
      lastCustomerAt ||
      session?.lastActiveAt ||
      session?.createdAt ||
      null;
    targetMs = LIVE_SUPPORT_ACTIVE_SLA_MS;
  }

  const startedDate = startedAt ? new Date(startedAt) : null;
  const elapsedMs = startedDate
    ? Math.max(Date.now() - startedDate.getTime(), 0)
    : 0;
  const ratio = targetMs > 0 ? elapsedMs / targetMs : 0;
  const level =
    !startedDate || state === "closed"
      ? "neutral"
      : ratio >= 1
        ? "critical"
        : ratio >= 0.6
          ? "warning"
          : "normal";
  return {
    state,
    startedAt: startedDate,
    elapsedMs,
    targetMs,
    breached: Boolean(startedDate) && elapsedMs > targetMs,
    ratio,
    level,
  };
};
const buildCannedReplies = (texts = []) =>
  texts.map((text, index) => ({
    id: `reply_${index + 1}`,
    category: "general",
    text,
  }));
const emitChatRoomEvent = (sessionId, action, payload = {}) => {
  if (!sessionId) return;
  void publishLiveSupportEvent({
    type: "chat_room.updated",
    source: "backend",
    sessionId,
    action,
    payload,
  });
};

class AdminService {
  static signUp = async ({ name, email, password, phone }) => {
    const normalizedName = typeof name === "string" ? name.trim() : "";
    const normalizedEmail =
      typeof email === "string" ? email.trim().toLowerCase() : "";
    const sanitizedPassword = typeof password === "string" ? password : "";

    if (!normalizedName) throw new BadRequestError("Name is required");
    if (!normalizedEmail) throw new BadRequestError("Email is required");
    if (!/\S+@\S+\.\S+/.test(normalizedEmail))
      throw new BadRequestError("Email is invalid");
    if (!sanitizedPassword) throw new BadRequestError("Password is required");
    if (sanitizedPassword.length < 6)
      throw new BadRequestError("Password must be at least 6 characters");

    const existingAdmin = await findByEmail({
      email: normalizedEmail,
      select: { _id: 1 },
    });
    if (existingAdmin) throw new BadRequestError("Admin already registered");

    const passwordHash = await bcrypt.hash(sanitizedPassword, 10);

    const newAdmin = await adminModel.create({
      name: normalizedName,
      email: normalizedEmail,
      password: passwordHash,
      phone: typeof phone === "string" ? phone.trim() : phone,
      status: "pending",
      roles: [RoleAdmin.ADMIN],
    });

    return {
      admin: getInfoData({
        fileds: ["_id", "name", "email", "status", "roles"],
        object: newAdmin,
      }),
      message: "Registration successful. Waiting for admin approval.",
    };
  };

  static login = async ({ email, password }) => {
    const normalizedEmail =
      typeof email === "string" ? email.trim().toLowerCase() : "";
    const sanitizedPassword = typeof password === "string" ? password : "";

    if (!normalizedEmail) throw new BadRequestError("Email is required");
    if (!/\S+@\S+\.\S+/.test(normalizedEmail))
      throw new BadRequestError("Email is invalid");
    if (!sanitizedPassword) throw new BadRequestError("Password is required");
    if (sanitizedPassword.length < 6)
      throw new BadRequestError("Password must be at least 6 characters");

    const foundAdmin = await findByEmail({ email: normalizedEmail });
    if (!foundAdmin) throw new BadRequestError("Admin not registered");
    if (foundAdmin.status && foundAdmin.status !== "active")
      throw new AuthFailureError("Admin is inactive");
    foundAdmin.roles = resolveEffectiveAdminRoles(foundAdmin);

    const match = await bcrypt.compare(sanitizedPassword, foundAdmin.password);
    if (!match) throw new AuthFailureError("Authentication error");

    const { _id: userId } = foundAdmin;
    const keyId = crypto.randomBytes(16).toString("hex");
    const privateKey = crypto.randomBytes(64).toString("hex");
    const publicKey = crypto.randomBytes(64).toString("hex");

    const tokens = await createTokenPair(
      { userId, email: normalizedEmail, keyId },
      publicKey,
      privateKey,
    );
    const savedKey = await KeyTokenService.createKeyToken({
      userId,
      publicKey,
      privateKey,
      refreshToken: tokens.refreshToken,
      userType: "Admin",
      keyId,
    });
    if (!savedKey) throw new BadRequestError("Key store error");

    return {
      admin: getInfoData({
        fileds: ["_id", "name", "email", "status", "roles"],
        object: foundAdmin,
      }),
      tokens,
    };
  };

  static handlerRefreshTokenV2 = async ({
    keyStore,
    keyPair,
    user,
    refreshToken,
  }) => {
    const { userId, email } = user;
    const hasKeyPairs =
      Array.isArray(keyStore.keys) && keyStore.keys.length > 0;
    const legacyRefreshTokensUsed = keyStore.refreshTokensUsed || [];
    const sessionKey = keyPair || null;
    if (hasKeyPairs && !sessionKey) {
      throw new AuthFailureError("Admin not registered");
    }
    const refreshTokensUsed =
      sessionKey?.refreshTokensUsed || legacyRefreshTokensUsed;
    const activeRefreshToken =
      sessionKey?.refreshToken || keyStore.refreshToken;

    if (refreshTokensUsed.includes(refreshToken)) {
      if (sessionKey?.keyId) {
        await KeyTokenService.removeKeyByKeyId({
          keyStoreId: keyStore._id,
          keyId: sessionKey.keyId,
        });
      } else {
        await KeyTokenService.deleteKeyById(userId);
      }
      throw new ForbiddenError("Something warning happened, please relogin");
    }
    if (!activeRefreshToken || activeRefreshToken !== refreshToken) {
      throw new AuthFailureError("Admin not registered");
    }

    const foundAdmin = await findByEmail({
      email,
      select: { _id: 1, email: 1 },
    });
    if (!foundAdmin) throw new AuthFailureError("Admin not registered");

    const newKeyId =
      sessionKey?.keyId || crypto.randomBytes(16).toString("hex");
    const newPrivateKey = crypto.randomBytes(64).toString("hex");
    const newPublicKey = crypto.randomBytes(64).toString("hex");
    const tokens = await createTokenPair(
      { userId, email, keyId: newKeyId },
      newPublicKey,
      newPrivateKey,
    );

    if (sessionKey?.keyId) {
      const nextUsed = Array.isArray(refreshTokensUsed)
        ? [...refreshTokensUsed, refreshToken]
        : [refreshToken];
      const keyIndex = Array.isArray(keyStore.keys)
        ? keyStore.keys.findIndex((item) => item.keyId === sessionKey.keyId)
        : -1;
      if (keyIndex === -1) throw new AuthFailureError("Admin not registered");

      keyStore.keys[keyIndex].publicKey = newPublicKey;
      keyStore.keys[keyIndex].privateKey = newPrivateKey;
      keyStore.keys[keyIndex].refreshToken = tokens.refreshToken;
      keyStore.keys[keyIndex].refreshTokensUsed = nextUsed;
      await keyStore.save();
    } else {
      const nextUsed = Array.isArray(legacyRefreshTokensUsed)
        ? [...legacyRefreshTokensUsed, refreshToken]
        : [refreshToken];
      await keyStore.updateOne({
        $push: {
          keys: {
            keyId: newKeyId,
            publicKey: newPublicKey,
            privateKey: newPrivateKey,
            refreshToken: tokens.refreshToken,
            refreshTokensUsed: nextUsed,
          },
        },
        $addToSet: {
          refreshTokensUsed: refreshToken,
        },
      });
    }
    return {
      user,
      tokens,
    };
  };

  static logout = async (keyStore, keyPair, refreshToken) => {
    if (!keyStore?._id) return null;

    if (keyPair?.keyId) {
      const updated = await KeyTokenService.removeKeyByKeyId({
        keyStoreId: keyStore._id,
        keyId: keyPair.keyId,
      });
      const remainingKeys = Array.isArray(updated?.keys)
        ? updated.keys.length
        : 0;
      if (!remainingKeys && !updated?.refreshToken) {
        await KeyTokenService.removeKeyById(keyStore._id);
      }
      return updated;
    }

    if (refreshToken) {
      if (keyStore.refreshToken === refreshToken) {
        await keyStore.updateOne({ $set: { refreshToken: null } });
      }
      return keyStore;
    }

    return await KeyTokenService.removeKeyById(keyStore._id);
  };

  static getProfile = async ({ adminId }) => {
    const adminObjectId = convertToObjectIdMongodb(adminId);
    if (!adminObjectId) throw new BadRequestError("Invalid admin id");

    const foundAdmin = await findById({
      adminId: adminObjectId,
      select: { password: 0 },
    });
    if (!foundAdmin) throw new NotFoundError("Admin not found");
    foundAdmin.roles = resolveEffectiveAdminRoles(foundAdmin);
    return foundAdmin;
  };

  static getWebPushConfig = async ({ adminId }) => {
    const adminObjectId = convertToObjectIdMongodb(adminId);
    if (!adminObjectId) throw new BadRequestError("Invalid admin id");
    return getWebPushClientConfig();
  };

  static getAdminById = async ({ adminId }) => {
    const adminObjectId = convertToObjectIdMongodb(adminId);
    if (!adminObjectId) throw new BadRequestError("Invalid admin id");

    const foundAdmin = await findById({
      adminId: adminObjectId,
      select: { password: 0 },
    });
    if (!foundAdmin) throw new NotFoundError("Admin not found");
    foundAdmin.roles = resolveEffectiveAdminRoles(foundAdmin);
    return foundAdmin;
  };

  static listAdminAccounts = async ({
    page = 1,
    limit = 20,
    status,
    q,
  } = {}) => {
    const normalizedPage = Math.max(Number(page) || 1, 1);
    const normalizedLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const skip = (normalizedPage - 1) * normalizedLimit;
    const normalizedStatus = String(status || "")
      .trim()
      .toLowerCase();
    const normalizedQuery = String(q || "").trim();

    const filter = {};
    if (ADMIN_ACCOUNT_STATUS.includes(normalizedStatus)) {
      filter.status = normalizedStatus;
    }
    if (normalizedQuery) {
      const regex = new RegExp(escapeRegex(normalizedQuery), "i");
      filter.$or = [{ name: regex }, { email: regex }, { phone: regex }];
    }

    const [items, total] = await Promise.all([
      adminModel
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(normalizedLimit)
        .select({ password: 0 })
        .lean(),
      adminModel.countDocuments(filter),
    ]);

    const totalPages = Math.max(Math.ceil(total / normalizedLimit), 1);
    return {
      items: items.map((item) => ({
        ...item,
        roles: resolveEffectiveAdminRoles(item),
        isConfiguredRoot: isConfiguredRootAdminEmail(item.email),
      })),
      pagination: {
        page: normalizedPage,
        limit: normalizedLimit,
        total,
        totalPages,
        hasPrevPage: normalizedPage > 1,
        hasNextPage: normalizedPage < totalPages,
      },
      filters: {
        status: ADMIN_ACCOUNT_STATUS.includes(normalizedStatus)
          ? normalizedStatus
          : "",
        q: normalizedQuery,
      },
    };
  };

  static listAdminAuditLogs = async ({ page = 1, limit = 20 } = {}) => {
    const normalizedPage = Math.max(Number(page) || 1, 1);
    const normalizedLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const skip = (normalizedPage - 1) * normalizedLimit;

    const filter = { category: "admin_account" };
    const [items, total] = await Promise.all([
      AdminAuditLog.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(normalizedLimit)
        .lean(),
      AdminAuditLog.countDocuments(filter),
    ]);

    const totalPages = Math.max(Math.ceil(total / normalizedLimit), 1);
    return {
      items,
      pagination: {
        page: normalizedPage,
        limit: normalizedLimit,
        total,
        totalPages,
        hasPrevPage: normalizedPage > 1,
        hasNextPage: normalizedPage < totalPages,
      },
    };
  };

  static listLiveSupportConsultants = async () => {
    const admins = await adminModel
      .find({
        status: "active",
      })
      .select({ password: 0 })
      .sort({ name: 1, email: 1, _id: 1 })
      .lean();

    return admins
      .filter((admin) => adminSupportsLiveChat(admin))
      .map((admin) => {
        const identity = buildLiveSupportConsultantIdentity(admin);
        if (!identity) return null;
        return {
          ...identity,
          onShift: isRoutingActiveNow(admin?.liveSupport?.routing),
          supportsAutoAssign: Boolean(admin?.liveSupport?.routing?.autoAssign),
          routingEnabled: Boolean(admin?.liveSupport?.routing?.enabled),
        };
      })
      .filter(Boolean);
  };

  static getNextLiveSupportConsultant = async ({ sessionId } = {}) => {
    const normalizedSessionId = String(sessionId || "").trim() || null;
    const candidates = await adminModel
      .find({
        status: "active",
        "liveSupport.routing.enabled": true,
        "liveSupport.routing.autoAssign": true,
      })
      .select({ password: 0 })
      .lean();

    const eligible = candidates
      .filter((admin) => adminSupportsLiveChat(admin))
      .filter((admin) => isRoutingActiveNow(admin?.liveSupport?.routing));

    if (!eligible.length) {
      return null;
    }

    const candidateIds = eligible
      .map((admin) => convertToObjectIdMongodb(admin?._id))
      .filter(Boolean);

    const roomLoadRows = candidateIds.length
      ? await ChatSession.aggregate([
          {
            $match: {
              status: "handoff",
              assignedTo: { $in: candidateIds },
            },
          },
          {
            $group: {
              _id: "$assignedTo",
              assignedRoomCount: { $sum: 1 },
              activeRoomCount: {
                $sum: {
                  $cond: [{ $eq: ["$liveSupport.active", true] }, 1, 0],
                },
              },
            },
          },
        ])
      : [];
    const roomLoadByAdminId = new Map(
      roomLoadRows.map((row) => [
        String(row._id),
        {
          assignedRoomCount: Number(row.assignedRoomCount) || 0,
          activeRoomCount: Number(row.activeRoomCount) || 0,
        },
      ]),
    );

    const ranked = eligible
      .map((admin) => {
        const identity = buildLiveSupportConsultantIdentity(admin);
        const routing = buildLiveSupportRoutingSnapshot(admin);
        const accountKey = identity?.accountKey || null;
        const accountLabel = identity?.accountLabel || null;
        const load = roomLoadByAdminId.get(String(admin._id)) || {
          assignedRoomCount: 0,
          activeRoomCount: 0,
        };

        return {
          admin,
          routing,
          accountKey,
          accountLabel,
          load,
        };
      })
      .sort((left, right) => {
        if (left.load.activeRoomCount !== right.load.activeRoomCount) {
          return left.load.activeRoomCount - right.load.activeRoomCount;
        }
        if (left.load.assignedRoomCount !== right.load.assignedRoomCount) {
          return left.load.assignedRoomCount - right.load.assignedRoomCount;
        }
        const leftAssignedAt = left.routing.lastAutoAssignedAt
          ? new Date(left.routing.lastAutoAssignedAt).getTime()
          : 0;
        const rightAssignedAt = right.routing.lastAutoAssignedAt
          ? new Date(right.routing.lastAutoAssignedAt).getTime()
          : 0;
        if (leftAssignedAt !== rightAssignedAt) {
          return leftAssignedAt - rightAssignedAt;
        }
        if (left.routing.priority !== right.routing.priority) {
          return left.routing.priority - right.routing.priority;
        }
        return String(left.admin._id).localeCompare(String(right.admin._id));
      });

    const selected = ranked[0];
    if (!selected) return null;

    const now = new Date();
    await adminModel
      .updateOne(
        { _id: selected.admin._id },
        {
          $set: {
            "liveSupport.routing.lastAutoAssignedAt": now,
            "liveSupport.routing.lastAutoAssignedSessionId":
              normalizedSessionId,
          },
        },
      )
      .catch(() => null);

    return {
      ...buildLiveSupportConsultantIdentity(selected.admin),
      routing: {
        ...selected.routing,
        lastAutoAssignedAt: now,
        lastAutoAssignedSessionId: normalizedSessionId,
      },
      load: selected.load,
      assignmentMode: "round_robin",
    };
  };

  static updateAdminAccount = async ({
    adminId,
    payload = {},
    actorAdminId,
  }) => {
    const targetObjectId = convertToObjectIdMongodb(adminId);
    const actorObjectId = convertToObjectIdMongodb(actorAdminId);
    if (!targetObjectId) throw new BadRequestError("Invalid admin id");
    if (!actorObjectId) throw new BadRequestError("Invalid actor admin id");

    const [targetAdmin, actorAdmin] = await Promise.all([
      adminModel.findById(targetObjectId).select({ password: 0 }),
      adminModel.findById(actorObjectId).select({ password: 0 }),
    ]);

    if (!targetAdmin) throw new NotFoundError("Admin not found");
    if (!actorAdmin) throw new NotFoundError("Actor admin not found");
    if (!isEffectiveSuperAdmin(actorAdmin)) {
      throw new ForbiddenError("Super admin required");
    }

    const isSelf = String(targetAdmin._id) === String(actorAdmin._id);
    const targetIsConfiguredRoot = isConfiguredRootAdminEmail(
      targetAdmin.email,
    );
    const updatePayload = {};
    const previousStatus = targetAdmin.status;
    const previousRoles = resolveEffectiveAdminRoles(targetAdmin);
    const previousRouting = buildLiveSupportRoutingSnapshot(targetAdmin);

    const nextStatus = String(payload?.status || "")
      .trim()
      .toLowerCase();
    if (nextStatus) {
      if (!ADMIN_ACCOUNT_STATUS.includes(nextStatus)) {
        throw new BadRequestError("Invalid admin status");
      }
      if (isSelf && nextStatus !== "active") {
        throw new ForbiddenError("You cannot disable your own admin account");
      }
      if (targetIsConfiguredRoot && nextStatus !== "active") {
        throw new ForbiddenError("Configured root admin cannot be disabled");
      }
      if (nextStatus !== targetAdmin.status) {
        updatePayload.status = nextStatus;
      }
    }

    if (payload?.roles) {
      const nextRoles = normalizeAdminRoles(payload.roles, targetAdmin.email);
      if (!nextRoles.length) {
        throw new BadRequestError("At least one admin role is required");
      }

      const targetCurrentlySuperAdmin = isEffectiveSuperAdmin(targetAdmin);
      const targetWillRemainSuperAdmin = nextRoles.includes(
        RoleAdmin.SUPER_ADMIN,
      );
      if (isSelf && !targetWillRemainSuperAdmin) {
        throw new ForbiddenError("You cannot remove your own super admin role");
      }
      if (targetIsConfiguredRoot && !targetWillRemainSuperAdmin) {
        throw new ForbiddenError(
          "Configured root admin must keep super admin access",
        );
      }
      if (targetCurrentlySuperAdmin && !targetWillRemainSuperAdmin) {
        const otherAdmins = await adminModel
          .find({ _id: { $ne: targetObjectId } })
          .select({ email: 1, roles: 1 })
          .lean();
        const otherSuperAdminCount = otherAdmins.filter(
          isEffectiveSuperAdmin,
        ).length;
        if (otherSuperAdminCount === 0) {
          throw new ForbiddenError("At least one super admin must remain");
        }
      }
      if (!sameRoles(previousRoles, nextRoles)) {
        updatePayload.roles = nextRoles;
      }
    }

    if (payload?.routing && typeof payload.routing === "object") {
      const currentLiveSupport =
        updatePayload.liveSupport ||
        (targetAdmin.liveSupport?.toObject
          ? targetAdmin.liveSupport.toObject()
          : targetAdmin.liveSupport || {});
      const nextRouting = normalizeLiveSupportRouting({
        ...(currentLiveSupport.routing || previousRouting),
        ...payload.routing,
      });
      const targetSupportsChat =
        previousRoles.includes(RoleAdmin.CHAT_MANAGER) ||
        previousRoles.includes(RoleAdmin.ADMIN) ||
        previousRoles.includes(RoleAdmin.SUPER_ADMIN) ||
        (Array.isArray(updatePayload.roles) &&
          updatePayload.roles.some((role) =>
            CHAT_CAPABLE_ADMIN_ROLES.includes(role),
          ));

      if (nextRouting.enabled && !targetSupportsChat) {
        throw new BadRequestError(
          "Live-support routing requires CHAT_MANAGER or admin access",
        );
      }
      if (
        nextRouting.shiftEnabled &&
        (!nextRouting.shiftStart || !nextRouting.shiftEnd)
      ) {
        throw new BadRequestError(
          "Shift start and end are required when shift-based routing is enabled",
        );
      }

      if (!sameLiveSupportRouting(previousRouting, nextRouting)) {
        updatePayload.liveSupport = {
          ...currentLiveSupport,
          routing: nextRouting,
        };
      }
    }

    const effectiveLiveSupport =
      updatePayload.liveSupport ||
      (targetAdmin.liveSupport?.toObject
        ? targetAdmin.liveSupport.toObject()
        : targetAdmin.liveSupport || {});
    const effectiveRouting = buildLiveSupportRoutingSnapshot({
      liveSupport: effectiveLiveSupport,
    });

    if (!Object.keys(updatePayload).length) {
      const current = targetAdmin.toObject
        ? targetAdmin.toObject()
        : targetAdmin;
      return {
        ...current,
        roles: previousRoles,
        isConfiguredRoot: isConfiguredRootAdminEmail(targetAdmin.email),
      };
    }

    const updated = await adminModel
      .findByIdAndUpdate(targetObjectId, updatePayload, { new: true })
      .select({ password: 0 })
      .lean();

    if (!updated) throw new NotFoundError("Admin not found");

    const rolesChanged = Array.isArray(updatePayload.roles);
    const statusChanged = typeof updatePayload.status === "string";
    if (rolesChanged || statusChanged) {
      await KeyTokenService.deleteKeyById(targetObjectId);
    }

    const effectiveUpdatedRoles = resolveEffectiveAdminRoles(updated);
    const nextRouting = buildLiveSupportRoutingSnapshot(updated);
    const auditEntries = [];
    if (statusChanged && previousStatus !== updated.status) {
      auditEntries.push({
        action: ADMIN_AUDIT_ACTION.STATUS_UPDATED,
        summary: `${actorAdmin.email} changed status for ${updated.email} from ${previousStatus} to ${updated.status}`,
        metadata: {
          previousStatus,
          nextStatus: updated.status,
        },
      });
    }
    if (rolesChanged && !sameRoles(previousRoles, effectiveUpdatedRoles)) {
      auditEntries.push({
        action: ADMIN_AUDIT_ACTION.ROLES_UPDATED,
        summary: `${actorAdmin.email} changed roles for ${updated.email}`,
        metadata: {
          previousRoles,
          nextRoles: effectiveUpdatedRoles,
        },
      });
    }
    if (!sameLiveSupportRouting(previousRouting, nextRouting)) {
      auditEntries.push({
        action: ADMIN_AUDIT_ACTION.ROUTING_UPDATED,
        summary: `${actorAdmin.email} updated live-support routing for ${updated.email}`,
        metadata: {
          previousRouting,
          nextRouting,
        },
      });
    }
    await createAdminAuditLogs({
      actorAdmin,
      targetAdmin: updated,
      entries: auditEntries,
    });

    return {
      ...updated,
      roles: effectiveUpdatedRoles,
      isConfiguredRoot: isConfiguredRootAdminEmail(updated.email),
    };
  };

  static deleteAdminAccount = async ({ adminId, actorAdminId }) => {
    const targetObjectId = convertToObjectIdMongodb(adminId);
    const actorObjectId = convertToObjectIdMongodb(actorAdminId);
    if (!targetObjectId) throw new BadRequestError("Invalid admin id");
    if (!actorObjectId) throw new BadRequestError("Invalid actor admin id");

    const [targetAdmin, actorAdmin] = await Promise.all([
      adminModel.findById(targetObjectId).select({ password: 0 }),
      adminModel.findById(actorObjectId).select({ password: 0 }),
    ]);

    if (!targetAdmin) throw new NotFoundError("Admin not found");
    if (!actorAdmin) throw new NotFoundError("Actor admin not found");
    if (!isEffectiveSuperAdmin(actorAdmin)) {
      throw new ForbiddenError("Super admin required");
    }
    if (String(targetAdmin._id) === String(actorAdmin._id)) {
      throw new ForbiddenError("You cannot delete your own admin account");
    }
    if (isConfiguredRootAdminEmail(targetAdmin.email)) {
      throw new ForbiddenError("Configured root admin cannot be deleted");
    }

    if (isEffectiveSuperAdmin(targetAdmin)) {
      const otherAdmins = await adminModel
        .find({ _id: { $ne: targetObjectId } })
        .select({ email: 1, roles: 1 })
        .lean();
      const otherSuperAdminCount = otherAdmins.filter(
        isEffectiveSuperAdmin,
      ).length;
      if (otherSuperAdminCount === 0) {
        throw new ForbiddenError("At least one super admin must remain");
      }
    }

    const deletedAdmin = await adminModel
      .findByIdAndDelete(targetObjectId)
      .select({ password: 0 })
      .lean();
    if (!deletedAdmin) throw new NotFoundError("Admin not found");

    await KeyTokenService.deleteKeyById(targetObjectId);
    await createAdminAuditLogs({
      actorAdmin,
      targetAdmin: deletedAdmin,
      entries: [
        {
          action: ADMIN_AUDIT_ACTION.DELETED,
          summary: `${actorAdmin.email} deleted admin account ${deletedAdmin.email}`,
          metadata: {
            deletedAt: new Date().toISOString(),
            previousStatus: deletedAdmin.status,
            previousRoles: resolveEffectiveAdminRoles(deletedAdmin),
          },
        },
      ],
    });
    return {
      ...deletedAdmin,
      roles: resolveEffectiveAdminRoles(deletedAdmin),
      deleted: true,
    };
  };

  static updateProfile = async ({ adminId, payload }) => {
    const adminObjectId = convertToObjectIdMongodb(adminId);
    if (!adminObjectId) throw new BadRequestError("Invalid admin id");

    const updatePayload = removeUndefinedObject({
      name: typeof payload?.name === "string" ? payload.name.trim() : undefined,
      phone:
        typeof payload?.phone === "string"
          ? payload.phone.trim()
          : payload?.phone,
      avatar:
        typeof payload?.avatar === "string"
          ? payload.avatar.trim()
          : payload?.avatar,
    });

    if (!Object.keys(updatePayload).length) {
      throw new BadRequestError("No valid fields to update");
    }

    const previousAdmin = Object.prototype.hasOwnProperty.call(updatePayload, "avatar")
      ? await adminModel.findById(adminObjectId).select("avatar").lean()
      : null;

    const updatedAdmin = await adminModel
      .findByIdAndUpdate(adminObjectId, updatePayload, { new: true })
      .select({ password: 0 })
      .lean();

    if (!updatedAdmin) throw new NotFoundError("Admin not found");
    if (
      previousAdmin?.avatar &&
      updatedAdmin.avatar &&
      previousAdmin.avatar !== updatedAdmin.avatar
    ) {
      try {
        await deleteImageFromStorage({ url: previousAdmin.avatar });
      } catch (error) {
        console.error("Failed to delete old admin avatar", {
          adminId,
          error: error?.message || "delete-avatar-failed",
        });
      }
    }
    return updatedAdmin;
  };

  static registerWebPushSubscription = async ({
    adminId,
    payload,
    userAgent,
  }) => {
    return registerAdminWebPushSubscription({
      adminId,
      payload,
      userAgent,
    });
  };

  static unregisterWebPushSubscription = async ({ adminId, payload }) => {
    return unregisterAdminWebPushSubscription({
      adminId,
      payload,
    });
  };

  static listUsers = async ({ limit, page, sort, status }) => {
    const filter = {};
    if (status) filter.status = status;
    const normalizedLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const normalizedPage = Math.max(Number(page) || 1, 1);
    const normalizedSort = sort || "ctime";

    const [items, total] = await Promise.all([
      findAllUsers({
        limit: normalizedLimit,
        page: normalizedPage,
        sort: normalizedSort,
        filter,
        select: [
          "name",
          "email",
          "status",
          "roles",
          "verify",
          "phone",
          "preferredLocale",
          "loginCount",
          "firstLoginAt",
          "lastLoginAt",
          "lastLoginIp",
          "telemetryIdentity",
          "createdAt",
          "updatedAt",
        ],
      }),
      countUsers({ filter }),
    ]);

    const telemetryByUserId = await TelemetryService.getUserListTelemetryMeta({
      userIds: items.map((item) => item?._id).filter(Boolean),
    });
    const enrichedItems = items.map((item) => ({
      ...item,
      telemetrySummary: item?._id
        ? telemetryByUserId[String(item._id)] || null
        : null,
    }));

    const totalPages = Math.max(Math.ceil(total / normalizedLimit), 1);
    return {
      items: enrichedItems,
      pagination: {
        page: normalizedPage,
        limit: normalizedLimit,
        total,
        totalPages,
        hasPrevPage: normalizedPage > 1,
        hasNextPage: normalizedPage < totalPages,
      },
      filters: {
        status: status || "",
        sort: normalizedSort,
      },
    };
  };

  static getDashboardSummary = async () => {
    return DashboardMetricsService.getDashboardSummary();
  };

  static getHomeSlides = async () => {
    return SiteSettingService.getHomeSlides();
  };

  static updateHomeSlides = async ({ slides, adminId }) => {
    return SiteSettingService.updateHomeSlides({ slides, adminId });
  };

  static listAnonymousVisitors = async ({ page, limit, mapped }) => {
    return TelemetryService.listAnonymousVisitors({ page, limit, mapped });
  };

  static getAnonymousVisitorBySession = async ({ sessionId }) => {
    const session = await TelemetryService.getAnonymousVisitorDetail({
      sessionId,
    });
    if (!session)
      throw new NotFoundError("Anonymous visitor session not found");
    return session;
  };

  static listLeads = async ({ page = 1, limit = 20, status, q } = {}) => {
    const normalizedPage = Math.max(Number(page) || 1, 1);
    const normalizedLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const skip = (normalizedPage - 1) * normalizedLimit;
    const normalizedStatus = String(status || "")
      .trim()
      .toLowerCase();
    const normalizedQuery = String(q || "").trim();

    const filter = {};
    if (LEAD_STATUS.includes(normalizedStatus)) {
      filter.status = normalizedStatus;
    }
    if (normalizedQuery) {
      const regex = new RegExp(escapeRegex(normalizedQuery), "i");
      filter.$or = [
        { phone: regex },
        { name: regex },
        { need: regex },
        { sessionId: regex },
      ];
    }

    const [items, total] = await Promise.all([
      ChatLead.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(normalizedLimit)
        .populate("user", "name email status phone")
        .populate("assignedTo", "name email")
        .lean(),
      ChatLead.countDocuments(filter),
    ]);

    const totalPages = Math.max(Math.ceil(total / normalizedLimit), 1);
    return {
      items,
      pagination: {
        page: normalizedPage,
        limit: normalizedLimit,
        total,
        totalPages,
        hasPrevPage: normalizedPage > 1,
        hasNextPage: normalizedPage < totalPages,
      },
      filters: {
        status: LEAD_STATUS.includes(normalizedStatus) ? normalizedStatus : "",
        q: normalizedQuery,
      },
    };
  };

  static getLeadById = async ({ leadId }) => {
    const objectId = convertToObjectIdMongodb(leadId);
    if (!objectId) throw new BadRequestError("Invalid lead id");

    const lead = await ChatLead.findById(objectId)
      .populate(
        "user",
        "name email status phone loginCount firstLoginAt lastLoginAt",
      )
      .populate("assignedTo", "name email")
      .lean();
    if (!lead) throw new NotFoundError("Lead not found");
    return lead;
  };

  static updateLead = async ({ leadId, payload = {} }) => {
    const objectId = convertToObjectIdMongodb(leadId);
    if (!objectId) throw new BadRequestError("Invalid lead id");

    const nextStatus = String(payload?.status || "")
      .trim()
      .toLowerCase();
    if (nextStatus && !LEAD_STATUS.includes(nextStatus)) {
      throw new BadRequestError("Invalid lead status");
    }

    let assignedTo = undefined;
    if (payload?.assignedTo) {
      assignedTo = convertToObjectIdMongodb(payload.assignedTo);
      if (!assignedTo) throw new BadRequestError("Invalid assigned admin");
      const foundAdmin = await adminModel
        .findById(assignedTo)
        .select("_id")
        .lean();
      if (!foundAdmin) throw new BadRequestError("Assigned admin not found");
    }

    const updatePayload = removeUndefinedObject({
      status: nextStatus || undefined,
      internalNote:
        typeof payload?.internalNote === "string"
          ? payload.internalNote.trim()
          : undefined,
      assignedTo,
    });

    if (assignedTo) {
      updatePayload.assignedAt = new Date();
    }
    if (nextStatus === "contacted") {
      updatePayload.lastContactedAt = new Date();
    }
    if (!Object.keys(updatePayload).length) {
      throw new BadRequestError("No valid fields to update");
    }

    const updated = await ChatLead.findByIdAndUpdate(objectId, updatePayload, {
      new: true,
    })
      .populate(
        "user",
        "name email status phone loginCount firstLoginAt lastLoginAt",
      )
      .populate("assignedTo", "name email")
      .lean();
    if (!updated) throw new NotFoundError("Lead not found");
    return updated;
  };

  static listChatRooms = async ({
    page = 1,
    limit = 20,
    status,
    q,
    mine,
    unreadOnly,
    adminId,
  } = {}) => {
    const normalizedPage = Math.max(Number(page) || 1, 1);
    const normalizedLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const normalizedStatus = String(status || "")
      .trim()
      .toLowerCase();
    const normalizedQuery = String(q || "").trim();
    const adminObjectId = convertToObjectIdMongodb(adminId);
    const mineOnly =
      String(mine || "")
        .trim()
        .toLowerCase() === "1" ||
      String(mine || "")
        .trim()
        .toLowerCase() === "true";
    const unreadOnlyFilter =
      String(unreadOnly || "")
        .trim()
        .toLowerCase() === "1" ||
      String(unreadOnly || "")
        .trim()
        .toLowerCase() === "true";

    const baseFilter = {};

    if (normalizedQuery) {
      const regex = new RegExp(escapeRegex(normalizedQuery), "i");
      const matchedLeadSessionIds = await ChatLead.find({
        $or: [
          { phone: regex },
          { name: regex },
          { need: regex },
          { sessionId: regex },
        ],
      })
        .distinct("sessionId")
        .then((items) => items.filter(Boolean).slice(0, 200));

      baseFilter.$or = [
        { sessionId: regex },
        { visitorId: regex },
        { telemetrySessionId: regex },
        { sourcePath: regex },
        { "liveSupport.assignedAccountLabel": regex },
        { "liveSupport.assignedAdminEmail": regex },
        { "liveSupport.assignedAdminName": regex },
        { "liveSupport.accountLabel": regex },
        { "liveSupport.adminEmail": regex },
        { "liveSupport.adminName": regex },
      ];

      if (matchedLeadSessionIds.length) {
        baseFilter.$or.push({ sessionId: { $in: matchedLeadSessionIds } });
      }
    }

    const filter = {
      ...baseFilter,
    };
    if (CHAT_ROOM_STATUS.includes(normalizedStatus)) {
      filter.status = normalizedStatus;
    }
    if (mineOnly && adminObjectId) {
      filter.assignedTo = adminObjectId;
      baseFilter.assignedTo = adminObjectId;
    }

    const shouldComputeUnreadBeforePagination =
      unreadOnlyFilter && adminObjectId;
    const [items, total, statusCountRows] = await Promise.all([
      ChatSession.find(filter)
        .sort({ lastActiveAt: -1, createdAt: -1, _id: -1 })
        .skip(
          shouldComputeUnreadBeforePagination
            ? 0
            : (normalizedPage - 1) * normalizedLimit,
        )
        .limit(shouldComputeUnreadBeforePagination ? 500 : normalizedLimit)
        .populate("user", "name email status phone")
        .populate("assignedTo", "name email roles")
        .populate("resolvedBy", "name email roles")
        .lean(),
      shouldComputeUnreadBeforePagination
        ? Promise.resolve(0)
        : ChatSession.countDocuments(filter),
      ChatSession.aggregate([
        { $match: baseFilter },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const sessionIds = items.map((item) => item.sessionId).filter(Boolean);
    const [latestMessages, latestLeads, userMessages] = sessionIds.length
      ? await Promise.all([
          ChatMessage.aggregate([
            { $match: { sessionId: { $in: sessionIds } } },
            { $sort: { createdAt: -1, _id: -1 } },
            {
              $group: {
                _id: "$sessionId",
                doc: { $first: "$$ROOT" },
              },
            },
            { $replaceRoot: { newRoot: "$doc" } },
          ]),
          ChatLead.aggregate([
            { $match: { sessionId: { $in: sessionIds } } },
            { $sort: { createdAt: -1, _id: -1 } },
            {
              $group: {
                _id: "$sessionId",
                doc: { $first: "$$ROOT" },
              },
            },
            { $replaceRoot: { newRoot: "$doc" } },
          ]),
          ChatMessage.find({
            sessionId: { $in: sessionIds },
            role: "user",
          })
            .select({ sessionId: 1, createdAt: 1, _id: 0 })
            .sort({ createdAt: -1, _id: -1 })
            .lean(),
        ])
      : [[], [], []];

    const latestMessageMap = new Map(
      latestMessages.map((item) => [
        item.sessionId,
        {
          role: item.role,
          text: item.text,
          createdAt: item.createdAt,
        },
      ]),
    );
    const latestLeadMap = new Map(
      latestLeads.map((item) => [
        item.sessionId,
        {
          _id: item._id,
          phone: item.phone,
          status: item.status,
          need: item.need,
          createdAt: item.createdAt,
        },
      ]),
    );
    const userMessageMap = new Map();
    for (const item of userMessages) {
      const list = userMessageMap.get(item.sessionId) || [];
      list.push(item);
      userMessageMap.set(item.sessionId, list);
    }

    const statusCounts = {
      all: statusCountRows.reduce(
        (sum, item) => sum + (Number(item.count) || 0),
        0,
      ),
      open: 0,
      handoff: 0,
      closed: 0,
    };
    for (const row of statusCountRows) {
      const key = String(row?._id || "")
        .trim()
        .toLowerCase();
      if (CHAT_ROOM_STATUS.includes(key)) {
        statusCounts[key] = Number(row.count) || 0;
      }
    }

    const mappedItems = items.map((item) => ({
      ...item,
      latestMessage: latestMessageMap.get(item.sessionId) || null,
      latestLead: latestLeadMap.get(item.sessionId) || null,
      unreadCount: adminObjectId
        ? (userMessageMap.get(item.sessionId) || []).filter((message) => {
            const readReceipt = getReadReceiptForAdmin(item, adminObjectId);
            if (!readReceipt?.lastReadAt) return true;
            return (
              new Date(message.createdAt).getTime() >
              new Date(readReceipt.lastReadAt).getTime()
            );
          }).length
        : 0,
      sla: buildChatRoomSla({
        session: item,
        latestMessage: latestMessageMap.get(item.sessionId) || null,
        latestCustomerMessageAt:
          (userMessageMap.get(item.sessionId) || [])[0]?.createdAt || null,
      }),
    }));
    const filteredItems =
      unreadOnlyFilter && adminObjectId
        ? mappedItems.filter((item) => Number(item.unreadCount || 0) > 0)
        : mappedItems;
    const totalItems = shouldComputeUnreadBeforePagination
      ? filteredItems.length
      : total;
    const pagedItems = shouldComputeUnreadBeforePagination
      ? filteredItems.slice(
          (normalizedPage - 1) * normalizedLimit,
          normalizedPage * normalizedLimit,
        )
      : filteredItems;
    const totalPages = Math.max(Math.ceil(totalItems / normalizedLimit), 1);

    return {
      items: pagedItems,
      pagination: {
        page: normalizedPage,
        limit: normalizedLimit,
        total: totalItems,
        totalPages,
        hasPrevPage: normalizedPage > 1,
        hasNextPage: normalizedPage < totalPages,
      },
      filters: {
        status: CHAT_ROOM_STATUS.includes(normalizedStatus)
          ? normalizedStatus
          : "",
        q: normalizedQuery,
        mine: mineOnly,
        unreadOnly: unreadOnlyFilter,
      },
      statusCounts,
    };
  };

  static getChatRoomBySession = async ({
    sessionId,
    messageLimit = 300,
    adminId,
    markRead = false,
  }) => {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId)
      throw new BadRequestError("Invalid chat session id");

    const safeMessageLimit = Math.min(
      Math.max(Number(messageLimit) || 300, 1),
      500,
    );
    const [session, messages, leads, messageCount, publicSettings] =
      await Promise.all([
        ChatSession.findOne({ sessionId: normalizedSessionId })
          .populate("user", "name email status phone")
          .populate("assignedTo", "name email roles")
          .populate("resolvedBy", "name email roles")
          .lean(),
        ChatMessage.find({ sessionId: normalizedSessionId })
          .sort({ createdAt: 1, _id: 1 })
          .limit(safeMessageLimit)
          .lean(),
        ChatLead.find({ sessionId: normalizedSessionId })
          .sort({ createdAt: -1, _id: -1 })
          .populate("user", "name email status phone")
          .populate("assignedTo", "name email roles")
          .lean(),
        ChatMessage.countDocuments({ sessionId: normalizedSessionId }),
        SiteSettingService.getPublicSettings(),
      ]);

    if (!session) throw new NotFoundError("Chat room not found");
    const adminObjectId = convertToObjectIdMongodb(adminId);
    if (markRead && adminObjectId) {
      await AdminService.markChatRoomRead({
        sessionId: normalizedSessionId,
        adminId: adminObjectId,
        readAt: new Date(),
      });
      const nextReadReceipts = Array.isArray(session?.liveSupport?.readReceipts)
        ? [...session.liveSupport.readReceipts]
        : [];
      const readIndex = nextReadReceipts.findIndex(
        (receipt) =>
          toObjectIdString(receipt?.adminId) ===
          toObjectIdString(adminObjectId),
      );
      if (readIndex >= 0) {
        nextReadReceipts[readIndex] = {
          ...nextReadReceipts[readIndex],
          lastReadAt: new Date(),
        };
      } else {
        nextReadReceipts.push({
          adminId: adminObjectId,
          lastReadAt: new Date(),
        });
      }
      session.liveSupport = {
        ...(session.liveSupport || {}),
        readReceipts: nextReadReceipts,
      };
    }
    const latestCustomerMessage =
      [...messages].reverse().find((message) => message.role === "user") ||
      null;
    const currentReadReceipt = adminObjectId
      ? getReadReceiptForAdmin(session, adminObjectId)
      : null;

    return {
      session,
      messages,
      leads,
      latestLead: leads[0] || null,
      summary: {
        messageCount,
        returnedMessageCount: messages.length,
        leadCount: leads.length,
        unreadCount: adminObjectId
          ? messages.filter((message) => {
              if (message.role !== "user") return false;
              if (!currentReadReceipt?.lastReadAt) return true;
              return (
                new Date(message.createdAt).getTime() >
                new Date(currentReadReceipt.lastReadAt).getTime()
              );
            }).length
          : 0,
      },
      sla: buildChatRoomSla({
        session,
        latestMessage: messages[messages.length - 1] || null,
        latestCustomerMessageAt: latestCustomerMessage?.createdAt || null,
      }),
      cannedReplies: buildCannedReplies(
        publicSettings?.chatConsole?.cannedReplies || [],
      ),
    };
  };

  static markChatRoomRead = async ({
    sessionId,
    adminId,
    readAt = new Date(),
  }) => {
    const normalizedSessionId = String(sessionId || "").trim();
    const adminObjectId = convertToObjectIdMongodb(adminId);
    if (!normalizedSessionId || !adminObjectId) {
      throw new BadRequestError("Invalid chat room read receipt");
    }

    const foundSession = await ChatSession.findOne({
      sessionId: normalizedSessionId,
    });
    if (!foundSession) throw new NotFoundError("Chat room not found");
    const previousReadReceipt = getReadReceiptForAdmin(
      foundSession,
      adminObjectId,
    );
    upsertReadReceipt(foundSession, adminObjectId, readAt);
    await foundSession.save();

    if (
      !previousReadReceipt?.lastReadAt ||
      new Date(previousReadReceipt.lastReadAt).getTime() <
        new Date(readAt).getTime()
    ) {
      emitChatRoomEvent(normalizedSessionId, "read", {
        adminId: toObjectIdString(adminObjectId),
        lastReadAt: new Date(readAt).toISOString(),
      });
    }

    return {
      sessionId: normalizedSessionId,
      adminId: toObjectIdString(adminObjectId),
      lastReadAt: readAt,
    };
  };

  static updateChatRoom = async ({ sessionId, payload = {}, adminId }) => {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId)
      throw new BadRequestError("Invalid chat session id");

    const foundSession = await ChatSession.findOne({
      sessionId: normalizedSessionId,
    });
    if (!foundSession) throw new NotFoundError("Chat room not found");

    const actorObjectId = convertToObjectIdMongodb(adminId);
    const actorAdmin = actorObjectId
      ? await adminModel
          .findById(actorObjectId)
          .select({ email: 1, name: 1, status: 1, roles: 1, liveSupport: 1 })
          .lean()
      : null;
    const actorLabel = getConsultantDisplayName(
      actorAdmin?.name,
      actorAdmin?.email,
      "admin",
    );
    const now = new Date();
    const previousStatus = foundSession.status;
    const previousLiveSupport = foundSession.liveSupport?.toObject
      ? foundSession.liveSupport.toObject()
      : foundSession.liveSupport || {};
    const nextStatus = String(payload?.status || "")
      .trim()
      .toLowerCase();
    const allowedStatus = CHAT_ROOM_STATUS.includes(nextStatus)
      ? nextStatus
      : "";
    const internalNote =
      typeof payload?.internalNote === "string"
        ? payload.internalNote.trim().slice(0, 4000)
        : undefined;
    const transferToAdminId = convertToObjectIdMongodb(
      payload?.transferToAdminId,
    );
    const messageText =
      typeof payload?.messageText === "string"
        ? payload.messageText.trim().slice(0, 4000)
        : "";
    const messageClientId =
      typeof payload?.messageClientId === "string"
        ? payload.messageClientId.trim().slice(0, 120)
        : "";
    const shouldClaim = Boolean(payload?.claimRoom);
    const shouldRelease = Boolean(payload?.releaseRoom);
    const shouldMarkRead = Boolean(payload?.markRead);
    const hasTypingState = typeof payload?.typingActive === "boolean";
    const typingActive = Boolean(payload?.typingActive);
    const typingDurationMs = Math.min(
      Math.max(Number(payload?.typingDurationMs) || 12000, 3000),
      20000,
    );
    const actorIdentity = actorAdmin
      ? buildLiveSupportConsultantIdentity({
          ...actorAdmin,
          _id: actorObjectId,
        })
      : null;

    if (typeof internalNote === "string") {
      foundSession.internalNote = internalNote;
    }
    if (shouldMarkRead && actorObjectId) {
      upsertReadReceipt(foundSession, actorObjectId, now);
    }

    if (payload?.assignToMe && actorObjectId) {
      foundSession.assignedTo = actorObjectId;
      foundSession.assignedAt = now;
    }

    if (payload?.clearAssignment) {
      foundSession.assignedTo = null;
      foundSession.assignedAt = null;
    }

    const ensureActorCanHandleRoom = () => {
      if (!actorObjectId || !actorAdmin || !actorIdentity) {
        throw new ForbiddenError(
          "Admin session is required for live support actions",
        );
      }
      if (!adminSupportsLiveChat(actorAdmin)) {
        throw new ForbiddenError(
          "Admin account is not eligible for live support",
        );
      }
      if (foundSession.status === "closed") {
        throw new BadRequestError("Cannot operate on a closed room");
      }
    };

    const claimRoomForActor = ({ allowReclaim = false } = {}) => {
      ensureActorCanHandleRoom();
      const currentOwnerKey =
        previousLiveSupport?.accountKey ||
        previousLiveSupport?.assignedAccountKey ||
        null;
      if (
        previousLiveSupport?.active &&
        currentOwnerKey &&
        currentOwnerKey !== actorIdentity.accountKey &&
        !allowReclaim
      ) {
        throw new BadRequestError(
          "Room is currently handled by another consultant",
        );
      }

      foundSession.status = "handoff";
      foundSession.assignedTo = actorObjectId;
      foundSession.assignedAt = foundSession.assignedAt || now;
      foundSession.resolvedAt = null;
      foundSession.resolvedBy = null;
      foundSession.liveSupport = {
        ...previousLiveSupport,
        active: true,
        channel: "admin_console",
        assignedAccountKey: actorIdentity.accountKey,
        assignedAccountLabel: actorIdentity.accountLabel,
        assignedAdminEmail: actorIdentity.adminEmail,
        assignedAdminName: actorIdentity.adminName,
        assignmentMode: previousLiveSupport?.assignmentMode || "admin_console",
        assignmentQueuedAt:
          previousLiveSupport?.assignmentQueuedAt ||
          foundSession.assignedAt ||
          now,
        accountKey: actorIdentity.accountKey,
        accountLabel: actorIdentity.accountLabel,
        adminEmail: actorIdentity.adminEmail,
        adminName: actorIdentity.adminName,
        claimedAt: previousLiveSupport?.active
          ? previousLiveSupport.claimedAt || now
          : now,
        releasedAt: null,
        typing: {
          active: false,
          source: "admin_console",
          updatedAt: now,
          until: null,
        },
        readReceipts: Array.isArray(previousLiveSupport?.readReceipts)
          ? previousLiveSupport.readReceipts
          : [],
      };
      upsertReadReceipt(foundSession, actorObjectId, now);
    };

    let claimEvent = null;
    if (shouldClaim) {
      const wasActive = Boolean(previousLiveSupport?.active);
      claimRoomForActor();
      if (!wasActive) {
        claimEvent = {
          text: buildConsultantJoinedText(
            getConsultantDisplayName(
              actorIdentity.adminName,
              actorIdentity.accountLabel,
              actorIdentity.adminEmail,
            ),
          ),
          meta: {
            kind: "consultant_joined",
            actorAdminId: actorObjectId,
            actorAdminEmail: actorIdentity.adminEmail,
            actorAdminName: actorIdentity.adminName,
            accountLabel: actorIdentity.accountLabel,
            adminEmail: actorIdentity.adminEmail,
            adminName: actorIdentity.adminName,
            channel: "admin_console",
          },
        };
      }
    }

    let releaseEvent = null;
    if (shouldRelease) {
      ensureActorCanHandleRoom();
      const currentOwnerKey =
        previousLiveSupport?.accountKey ||
        previousLiveSupport?.assignedAccountKey ||
        null;
      if (
        previousLiveSupport?.active &&
        currentOwnerKey &&
        currentOwnerKey !== actorIdentity.accountKey
      ) {
        throw new BadRequestError(
          "Room is currently handled by another consultant",
        );
      }

      foundSession.assignedTo = null;
      foundSession.assignedAt = null;
      foundSession.liveSupport = {
        ...previousLiveSupport,
        active: false,
        channel: "admin_console",
        assignedAccountKey: null,
        assignedAccountLabel: null,
        assignedAdminEmail: null,
        assignedAdminName: null,
        assignmentMode: null,
        assignmentQueuedAt: null,
        accountKey: actorIdentity.accountKey,
        accountLabel: actorIdentity.accountLabel,
        adminEmail: actorIdentity.adminEmail,
        adminName: actorIdentity.adminName,
        releasedAt: now,
        typing: {
          active: false,
          source: "admin_console",
          updatedAt: now,
          until: null,
        },
      };
      releaseEvent = {
        text: buildConsultantLeftText(
          getConsultantDisplayName(
            actorIdentity.adminName,
            actorIdentity.accountLabel,
            actorIdentity.adminEmail,
          ),
        ),
        meta: {
          kind: "consultant_left",
          actorAdminId: actorObjectId,
          actorAdminEmail: actorIdentity.adminEmail,
          actorAdminName: actorIdentity.adminName,
          accountLabel: actorIdentity.accountLabel,
          adminEmail: actorIdentity.adminEmail,
          adminName: actorIdentity.adminName,
          channel: "admin_console",
        },
      };
    }

    let transferEvent = null;
    if (transferToAdminId) {
      if (foundSession.status === "closed") {
        throw new BadRequestError("Cannot transfer a closed room");
      }
      if (foundSession.status !== "handoff" && !previousLiveSupport?.active) {
        throw new BadRequestError("Room must be in handoff before transfer");
      }

      const targetAdmin = await adminModel
        .findById(transferToAdminId)
        .select({ password: 0 })
        .lean();
      if (!targetAdmin) {
        throw new BadRequestError("Target consultant not found");
      }
      if (targetAdmin.status !== "active") {
        throw new BadRequestError("Target consultant is not active");
      }
      if (!adminSupportsLiveChat(targetAdmin)) {
        throw new BadRequestError(
          "Target consultant is not eligible for live support",
        );
      }

      const targetIdentity = buildLiveSupportConsultantIdentity(targetAdmin);
      if (!targetIdentity) {
        throw new BadRequestError("Target consultant identity is incomplete");
      }
      if (String(foundSession.assignedTo || "") === String(transferToAdminId)) {
        throw new BadRequestError(
          "Room already belongs to the selected consultant",
        );
      }

      const sourceLabel =
        previousLiveSupport?.accountLabel ||
        previousLiveSupport?.assignedAccountLabel ||
        previousLiveSupport?.accountKey ||
        previousLiveSupport?.assignedAccountKey ||
        null;
      const sourceAdminEmail =
        previousLiveSupport?.adminEmail ||
        previousLiveSupport?.assignedAdminEmail ||
        null;
      const sourceAdminName =
        previousLiveSupport?.adminName ||
        previousLiveSupport?.assignedAdminName ||
        null;

      foundSession.status = "handoff";
      foundSession.assignedTo = transferToAdminId;
      foundSession.assignedAt = now;
      foundSession.resolvedAt = null;
      foundSession.resolvedBy = null;
      foundSession.liveSupport = {
        ...previousLiveSupport,
        active: true,
        channel: targetIdentity.channel || "admin_console",
        assignedAccountKey: targetIdentity.accountKey,
        assignedAccountLabel: targetIdentity.accountLabel,
        assignedAdminEmail: targetIdentity.adminEmail,
        assignedAdminName: targetIdentity.adminName,
        assignmentMode: sourceLabel ? "admin_transfer" : "admin_assign",
        assignmentQueuedAt:
          previousLiveSupport?.assignmentQueuedAt ||
          foundSession.assignedAt ||
          now,
        accountKey: targetIdentity.accountKey,
        accountLabel: targetIdentity.accountLabel,
        adminEmail: targetIdentity.adminEmail,
        adminName: targetIdentity.adminName,
        claimedAt: now,
        releasedAt: null,
        transferredAt: now,
      };

      transferEvent = {
        targetIdentity,
        sourceLabel,
        sourceAdminEmail,
        sourceAdminName,
      };
    }

    const shouldResolve =
      Boolean(payload?.markResolved) || allowedStatus === "closed";
    const shouldReopen =
      Boolean(payload?.reopen) || (allowedStatus && allowedStatus !== "closed");

    if (!transferEvent && shouldResolve) {
      foundSession.status = "closed";
      foundSession.resolvedAt = now;
      foundSession.resolvedBy =
        actorObjectId || foundSession.resolvedBy || null;
      foundSession.assignedTo = null;
      foundSession.assignedAt = null;
      foundSession.liveSupport = {
        ...previousLiveSupport,
        active: false,
        assignedAccountKey: null,
        assignedAccountLabel: null,
        assignedAdminEmail: null,
        assignedAdminName: null,
        assignmentMode: null,
        assignmentQueuedAt: null,
        releasedAt: now,
        typing: {
          active: false,
          source: "admin_console",
          updatedAt: now,
          until: null,
        },
        readReceipts: Array.isArray(previousLiveSupport?.readReceipts)
          ? previousLiveSupport.readReceipts
          : [],
      };
    } else if (!transferEvent && shouldReopen) {
      foundSession.status = allowedStatus || "open";
      foundSession.resolvedAt = null;
      foundSession.resolvedBy = null;
    }

    if (!transferEvent && !shouldResolve && !shouldReopen && allowedStatus) {
      foundSession.status = allowedStatus;
    }

    const timelineEvents = [];
    if (transferEvent) {
      if (transferEvent.sourceLabel) {
        timelineEvents.push({
          text: buildRoomTransferredText(
            getConsultantDisplayName(
              transferEvent.sourceAdminName,
              transferEvent.sourceLabel,
              transferEvent.sourceAdminEmail,
            ),
            getConsultantDisplayName(
              transferEvent.targetIdentity.adminName,
              transferEvent.targetIdentity.accountLabel,
              transferEvent.targetIdentity.adminEmail,
            ),
          ),
          meta: {
            kind: "consultant_transferred",
            actorAdminId: actorObjectId || null,
            actorAdminEmail: actorAdmin?.email || null,
            actorAdminName: actorAdmin?.name || null,
            fromAccountLabel: transferEvent.sourceLabel,
            fromAdminEmail: transferEvent.sourceAdminEmail,
            fromAdminName: transferEvent.sourceAdminName,
            accountLabel: transferEvent.targetIdentity.accountLabel,
            adminEmail: transferEvent.targetIdentity.adminEmail,
            adminName: transferEvent.targetIdentity.adminName,
            channel: transferEvent.targetIdentity.channel || "admin_console",
          },
        });
      } else {
        timelineEvents.push({
          text: buildRoomAssignedText(
            getConsultantDisplayName(
              transferEvent.targetIdentity.adminName,
              transferEvent.targetIdentity.accountLabel,
              transferEvent.targetIdentity.adminEmail,
            ),
            actorLabel,
          ),
          meta: {
            kind: "consultant_assigned",
            actorAdminId: actorObjectId || null,
            actorAdminEmail: actorAdmin?.email || null,
            actorAdminName: actorAdmin?.name || null,
            accountLabel: transferEvent.targetIdentity.accountLabel,
            adminEmail: transferEvent.targetIdentity.adminEmail,
            adminName: transferEvent.targetIdentity.adminName,
            channel: transferEvent.targetIdentity.channel || "admin_console",
          },
        });
      }
    }
    if (claimEvent) {
      timelineEvents.push(claimEvent);
    }
    if (releaseEvent) {
      timelineEvents.push(releaseEvent);
    }
    if (shouldResolve && previousStatus !== "closed") {
      timelineEvents.push({
        text: buildRoomClosedText(actorLabel),
        meta: {
          kind: "room_closed",
          actorAdminId: actorObjectId || null,
          actorAdminEmail: actorAdmin?.email || null,
          actorAdminName: actorAdmin?.name || null,
        },
      });
    }
    if (shouldReopen && previousStatus === "closed") {
      timelineEvents.push({
        text: buildRoomReopenedText(actorLabel),
        meta: {
          kind: "room_reopened",
          actorAdminId: actorObjectId || null,
          actorAdminEmail: actorAdmin?.email || null,
          actorAdminName: actorAdmin?.name || null,
        },
      });
    }

    if (messageText) {
      ensureActorCanHandleRoom();
      const currentOwnerKey =
        foundSession.liveSupport?.accountKey ||
        foundSession.liveSupport?.assignedAccountKey ||
        null;
      const actorOwnsRoom =
        !currentOwnerKey || currentOwnerKey === actorIdentity.accountKey;
      if (!actorOwnsRoom) {
        throw new BadRequestError(
          "Room is currently handled by another consultant",
        );
      }
      if (!foundSession.liveSupport?.active) {
        claimRoomForActor();
        if (!claimEvent) {
          timelineEvents.push({
            text: buildConsultantJoinedText(
              getConsultantDisplayName(
                actorIdentity.adminName,
                actorIdentity.accountLabel,
                actorIdentity.adminEmail,
              ),
            ),
            meta: {
              kind: "consultant_joined",
              actorAdminId: actorObjectId,
              actorAdminEmail: actorIdentity.adminEmail,
              actorAdminName: actorIdentity.adminName,
              accountLabel: actorIdentity.accountLabel,
              adminEmail: actorIdentity.adminEmail,
              adminName: actorIdentity.adminName,
              channel: "admin_console",
            },
          });
        }
      }

      foundSession.status = "handoff";
      foundSession.assignedTo = actorObjectId;
      foundSession.assignedAt = foundSession.assignedAt || now;
      foundSession.lastProvider = "human";
      foundSession.lastActiveAt = now;
      foundSession.liveSupport = {
        ...(foundSession.liveSupport?.toObject
          ? foundSession.liveSupport.toObject()
          : foundSession.liveSupport || {}),
        active: true,
        channel: "admin_console",
        assignedAccountKey: actorIdentity.accountKey,
        assignedAccountLabel: actorIdentity.accountLabel,
        assignedAdminEmail: actorIdentity.adminEmail,
        assignedAdminName: actorIdentity.adminName,
        accountKey: actorIdentity.accountKey,
        accountLabel: actorIdentity.accountLabel,
        adminEmail: actorIdentity.adminEmail,
        adminName: actorIdentity.adminName,
        assignmentMode:
          foundSession.liveSupport?.assignmentMode || "admin_console",
        assignmentQueuedAt:
          foundSession.liveSupport?.assignmentQueuedAt ||
          foundSession.assignedAt ||
          now,
        lastMessageAt: now,
        typing: {
          active: false,
          source: "admin_console",
          updatedAt: now,
          until: null,
        },
        readReceipts: Array.isArray(foundSession.liveSupport?.readReceipts)
          ? foundSession.liveSupport.readReceipts
          : [],
      };
      upsertReadReceipt(foundSession, actorObjectId, now);
      timelineEvents.push({
        role: "consultant",
        text: messageText,
        meta: {
          provider: "human",
          channel: "admin_console",
          accountLabel: actorIdentity.accountLabel,
          adminEmail: actorIdentity.adminEmail,
          adminName: actorIdentity.adminName,
          source: "admin_console",
          clientRequestId: messageClientId || null,
        },
      });
    }

    const shouldHandleTypingState =
      hasTypingState && !shouldResolve && !shouldRelease;
    if (shouldHandleTypingState) {
      ensureActorCanHandleRoom();
      const currentOwnerKey =
        foundSession.liveSupport?.accountKey ||
        foundSession.liveSupport?.assignedAccountKey ||
        null;
      const actorOwnsRoom =
        !currentOwnerKey || currentOwnerKey === actorIdentity.accountKey;
      if (!actorOwnsRoom) {
        throw new BadRequestError(
          "Room is currently handled by another consultant",
        );
      }
      if (!foundSession.liveSupport?.active && typingActive) {
        claimRoomForActor();
        if (!claimEvent) {
          timelineEvents.push({
            text: buildConsultantJoinedText(
              getConsultantDisplayName(
                actorIdentity.adminName,
                actorIdentity.accountLabel,
                actorIdentity.adminEmail,
              ),
            ),
            meta: {
              kind: "consultant_joined",
              actorAdminId: actorObjectId,
              actorAdminEmail: actorIdentity.adminEmail,
              actorAdminName: actorIdentity.adminName,
              accountLabel: actorIdentity.accountLabel,
              adminEmail: actorIdentity.adminEmail,
              adminName: actorIdentity.adminName,
              channel: "admin_console",
            },
          });
        }
      }

      foundSession.liveSupport = {
        ...(foundSession.liveSupport?.toObject
          ? foundSession.liveSupport.toObject()
          : foundSession.liveSupport || {}),
        active: typingActive ? true : Boolean(foundSession.liveSupport?.active),
        channel: "admin_console",
        assignedAccountKey: actorIdentity.accountKey,
        assignedAccountLabel: actorIdentity.accountLabel,
        assignedAdminEmail: actorIdentity.adminEmail,
        assignedAdminName: actorIdentity.adminName,
        accountKey: actorIdentity.accountKey,
        accountLabel: actorIdentity.accountLabel,
        adminEmail: actorIdentity.adminEmail,
        adminName: actorIdentity.adminName,
        typing: {
          active: typingActive,
          source: "admin_console",
          updatedAt: now,
          until: typingActive
            ? new Date(now.getTime() + typingDurationMs)
            : null,
        },
        readReceipts: Array.isArray(foundSession.liveSupport?.readReceipts)
          ? foundSession.liveSupport.readReceipts
          : [],
      };
      upsertReadReceipt(foundSession, actorObjectId, now);
    }

    await foundSession.save();

    if (timelineEvents.length) {
      await ChatMessage.insertMany(
        timelineEvents.map((event) => ({
          sessionId: normalizedSessionId,
          role: event.role || "system",
          text: event.text,
          meta: event.meta,
        })),
      );
    }

    const updated = await ChatSession.findOne({
      sessionId: normalizedSessionId,
    })
      .populate("user", "name email status phone")
      .populate("assignedTo", "name email roles")
      .populate("resolvedBy", "name email roles")
      .lean();

    const emittedActions = [];
    if (shouldClaim) emittedActions.push("claim");
    if (shouldRelease) emittedActions.push("release");
    if (transferEvent) emittedActions.push("transfer");
    if (shouldResolve && previousStatus !== "closed")
      emittedActions.push("close");
    if (shouldReopen && previousStatus === "closed")
      emittedActions.push("reopen");
    if (messageText) emittedActions.push("message");
    if (shouldHandleTypingState)
      emittedActions.push(typingActive ? "typing_on" : "typing_off");
    if (shouldMarkRead) emittedActions.push("read");
    if (typeof internalNote === "string") emittedActions.push("note");
    emitChatRoomEvent(normalizedSessionId, emittedActions[0] || "updated", {
      actions: emittedActions,
      adminId: actorObjectId ? toObjectIdString(actorObjectId) : null,
      status: updated?.status || foundSession.status,
      liveSupportActive: Boolean(updated?.liveSupport?.active),
    });

    return updated;
  };

  static deleteChatRoom = async ({ sessionId, adminId }) => {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId)
      throw new BadRequestError("Invalid chat session id");

    const existingSession = await ChatSession.findOne({
      sessionId: normalizedSessionId,
    }).lean();
    if (!existingSession) throw new NotFoundError("Chat room not found");

    const [deletedMessages, deletedLeads, deletedSession] = await Promise.all([
      ChatMessage.deleteMany({ sessionId: normalizedSessionId }),
      ChatLead.deleteMany({ sessionId: normalizedSessionId }),
      ChatSession.deleteOne({ sessionId: normalizedSessionId }),
    ]);

    emitChatRoomEvent(normalizedSessionId, "deleted", {
      sessionId: normalizedSessionId,
      adminId: toObjectIdString(adminId),
      previousStatus: existingSession?.status || null,
    });

    return {
      sessionId: normalizedSessionId,
      deleted: true,
      deletedCounts: {
        sessions: Number(deletedSession?.deletedCount) || 0,
        messages: Number(deletedMessages?.deletedCount) || 0,
        leads: Number(deletedLeads?.deletedCount) || 0,
      },
    };
  };

  static getUserById = async ({ userId }) => {
    const userObjectId = convertToObjectIdMongodb(userId);
    if (!userObjectId) throw new BadRequestError("Invalid user id");

    const [foundUser, telemetry] = await Promise.all([
      findUserById({ userId: userObjectId, select: { password: 0 } }),
      TelemetryService.getUserTelemetrySummary({ userId: userObjectId }),
    ]);
    if (!foundUser) throw new NotFoundError("User not found");
    return {
      ...foundUser,
      telemetry,
    };
  };

  static updateUserStatus = async ({ userId, status }) => {
    const userObjectId = convertToObjectIdMongodb(userId);
    if (!userObjectId) throw new BadRequestError("Invalid user id");

    const allowed = ["active", "inactive", "blocked"];
    if (!allowed.includes(status)) {
      throw new BadRequestError("Invalid user status");
    }

    const updatedUser = await userModel
      .findByIdAndUpdate(userObjectId, { status }, { new: true })
      .select({ password: 0 })
      .lean();

    if (!updatedUser) throw new NotFoundError("User not found");
    return updatedUser;
  };

  static sendUserResetPasswordEmail = async ({ userId, locale }) => {
    const userObjectId = convertToObjectIdMongodb(userId);
    if (!userObjectId) throw new BadRequestError("Invalid user id");

    const foundUser = await userModel
      .findById(userObjectId)
      .select({ _id: 1, email: 1, name: 1, preferredLocale: 1 })
      .lean();
    if (!foundUser) throw new NotFoundError("User not found");

    const result = await UserService.requestPasswordReset({
      email: foundUser.email,
      locale: locale || foundUser.preferredLocale,
    });

    return {
      user: getInfoData({
        fileds: ["_id", "name", "email", "preferredLocale"],
        object: foundUser,
      }),
      ...result,
    };
  };

  static deleteUser = async ({ userId }) => {
    const userObjectId = convertToObjectIdMongodb(userId);
    if (!userObjectId) throw new BadRequestError("Invalid user id");

    const deletedUser = await userModel
      .findByIdAndDelete(userObjectId)
      .select({ password: 0 })
      .lean();
    if (!deletedUser) throw new NotFoundError("User not found");

    await Promise.allSettled([
      KeyTokenService.deleteKeyById(userObjectId),
      UserToken.deleteMany({ user: userObjectId }),
      TelemetryService.deleteUserTelemetry({ userId: userObjectId }),
    ]);

    return {
      user: deletedUser,
      deleted: true,
    };
  };

  static listPendingAdmins = async () => {
    const pendingAdmins = await adminModel
      .find({ status: "pending" })
      .select("-password")
      .sort({ createdAt: -1 })
      .lean();
    return pendingAdmins;
  };

  static approveAdmin = async ({ adminId, approvedBy, note, roles }) => {
    const admin = await findById({ adminId });
    if (!admin) throw new NotFoundError("Admin not found");
    if (admin.status !== "pending")
      throw new BadRequestError("Admin is not in pending status");

    const approver = await findById({ adminId: approvedBy });
    if (!approver) throw new NotFoundError("Approver not found");

    let normalizedRoles = null;
    if (roles) {
      const rolesInput = Array.isArray(roles) ? roles : [roles];
      normalizedRoles = rolesInput
        .filter(Boolean)
        .map((role) => String(role).trim())
        .filter((role) => Object.values(RoleAdmin).includes(role));
      if (!normalizedRoles.length) {
        throw new BadRequestError("Invalid roles");
      }
    }

    const updated = await adminModel
      .findByIdAndUpdate(
        adminId,
        {
          status: "active",
          approvedBy: convertToObjectIdMongodb(approvedBy),
          approvedAt: new Date(),
          approvalNote: note || null,
          ...(normalizedRoles ? { roles: normalizedRoles } : {}),
        },
        { new: true },
      )
      .select("-password")
      .lean();

    return {
      admin: updated,
      message: `Admin ${admin.email} has been approved`,
    };
  };

  static rejectAdmin = async ({ adminId, rejectionReason }) => {
    const admin = await findById({ adminId });
    if (!admin) throw new NotFoundError("Admin not found");
    if (admin.status !== "pending")
      throw new BadRequestError("Admin is not in pending status");

    const updated = await adminModel
      .findByIdAndUpdate(
        adminId,
        {
          status: "blocked",
          approvalNote: rejectionReason || "Application rejected",
        },
        { new: true },
      )
      .select("-password")
      .lean();

    return {
      admin: updated,
      message: `Admin ${admin.email} has been rejected`,
    };
  };
}

module.exports = AdminService;
