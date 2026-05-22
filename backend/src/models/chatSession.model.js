"use strict";

const { Schema, model } = require("mongoose");

const DOCUMENT_NAME = "ChatSession";
const COLLECTION_NAME = "chat_sessions";

const chatSessionSchema = new Schema(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    visitorId: { type: String, default: null, index: true },
    telemetrySessionId: { type: String, default: null, index: true },
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    locale: { type: String, default: "vi" },
    sourcePath: { type: String, default: "/" },
    status: {
      type: String,
      enum: ["open", "closed", "handoff"],
      default: "open",
    },
    lastActiveAt: { type: Date, default: Date.now },
    lastProvider: { type: String, default: null },
    assignedTo: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
      index: true,
    },
    assignedAt: { type: Date, default: null },
    internalNote: { type: String, default: "" },
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: Schema.Types.ObjectId, ref: "Admin", default: null },
    handoff: {
      requestedAt: { type: Date, default: null },
      requestedBy: { type: String, default: null },
      reason: { type: String, default: null },
      targetChannel: { type: String, default: "admin_console" },
      notifiedAt: { type: Date, default: null },
    },
    liveSupport: {
      active: { type: Boolean, default: false },
      channel: { type: String, default: null },
      assignedAccountKey: { type: String, default: null, trim: true },
      assignedAccountLabel: { type: String, default: null, trim: true },
      assignedAdminEmail: {
        type: String,
        default: null,
        trim: true,
        lowercase: true,
      },
      assignedAdminName: { type: String, default: null, trim: true },
      assignmentMode: { type: String, default: null, trim: true },
      assignmentQueuedAt: { type: Date, default: null },
      accountKey: { type: String, default: null, trim: true },
      accountLabel: { type: String, default: null, trim: true },
      adminEmail: { type: String, default: null, trim: true, lowercase: true },
      adminName: { type: String, default: null, trim: true },
      claimedAt: { type: Date, default: null },
      releasedAt: { type: Date, default: null },
      lastMessageAt: { type: Date, default: null },
      readReceipts: {
        type: [
          new Schema(
            {
              adminId: {
                type: Schema.Types.ObjectId,
                ref: "Admin",
                required: true,
              },
              lastReadAt: { type: Date, default: Date.now },
            },
            { _id: false },
          ),
        ],
        default: [],
      },
      typing: {
        type: new Schema(
          {
            active: { type: Boolean, default: false },
            source: { type: String, default: null, trim: true },
            updatedAt: { type: Date, default: null },
            until: { type: Date, default: null },
          },
          { _id: false },
        ),
        default: () => ({
          active: false,
          source: null,
          updatedAt: null,
          until: null,
        }),
      },
    },
    customerPresence: {
      state: { type: String, enum: ["active", "left"], default: "active" },
      lastSeenAt: { type: Date, default: Date.now },
      leftAt: { type: Date, default: null },
    },
    context: {
      lastIntent: { type: String, default: null },
      leadCaptured: { type: Boolean, default: false },
      authenticatedCustomer: { type: Boolean, default: false },
      userLinkSource: {
        type: String,
        enum: ["direct", "telemetry", null],
        default: null,
      },
    },
  },
  {
    timestamps: true,
    collection: COLLECTION_NAME,
  },
);

module.exports = model(DOCUMENT_NAME, chatSessionSchema);
