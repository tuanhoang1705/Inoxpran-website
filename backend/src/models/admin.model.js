"use strict";

const { model, Schema } = require("mongoose");

const DOCUMENT_NAME = "Admin";
const COLLECTION_NAME = "Admins";

const webPushSubscriptionSchema = new Schema(
  {
    endpoint: {
      type: String,
      trim: true,
      required: true,
    },
    expirationTime: {
      type: Number,
      default: null,
    },
    keys: {
      p256dh: {
        type: String,
        trim: true,
        required: true,
      },
      auth: {
        type: String,
        trim: true,
        required: true,
      },
    },
    deviceLabel: {
      type: String,
      trim: true,
      default: null,
    },
    userAgent: {
      type: String,
      trim: true,
      default: null,
    },
    createdAt: {
      type: Date,
      default: null,
    },
    updatedAt: {
      type: Date,
      default: null,
    },
    lastSuccessAt: {
      type: Date,
      default: null,
    },
    lastFailureAt: {
      type: Date,
      default: null,
    },
    failureReason: {
      type: String,
      trim: true,
      default: null,
    },
  },
  { _id: false },
);

const adminSchema = new Schema(
  {
    name: {
      type: String,
      trim: true,
      maxLength: 150,
      required: true,
    },
    email: {
      type: String,
      unique: true,
      trim: true,
      lowercase: true,
      required: true,
    },
    password: {
      type: String,
      required: true,
      select: false,
    },
    phone: {
      type: String,
      default: null,
    },
    avatar: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ["active", "inactive", "blocked", "pending"],
      default: "pending",
    },
    verify: {
      type: Schema.Types.Boolean,
      default: false,
    },
    roles: {
      type: [String],
      default: ["ADMIN"],
    },
    permissions: {
      type: [String],
      default: [],
    },
    approvedBy: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
      select: false,
    },
    approvedAt: {
      type: Date,
      default: null,
      select: false,
    },
    approvalNote: {
      type: String,
      default: null,
      select: false,
    },
    liveSupport: {
      routing: {
        enabled: {
          type: Boolean,
          default: false,
        },
        autoAssign: {
          type: Boolean,
          default: false,
        },
        shiftEnabled: {
          type: Boolean,
          default: false,
        },
        shiftStart: {
          type: String,
          trim: true,
          default: null,
        },
        shiftEnd: {
          type: String,
          trim: true,
          default: null,
        },
        shiftDays: {
          type: [Number],
          default: [1, 2, 3, 4, 5, 6, 0],
        },
        priority: {
          type: Number,
          default: 100,
        },
        lastAutoAssignedAt: {
          type: Date,
          default: null,
        },
        lastAutoAssignedSessionId: {
          type: String,
          trim: true,
          default: null,
        },
        updatedAt: {
          type: Date,
          default: null,
        },
      },
    },
    pushNotifications: {
      webPushSubscriptions: {
        type: [webPushSubscriptionSchema],
        default: [],
      },
    },
  },
  {
    timestamps: true,
    collection: COLLECTION_NAME,
  },
);

module.exports = model(DOCUMENT_NAME, adminSchema);
