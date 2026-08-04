"use strict";

const crypto = require("node:crypto");
const mongoose = require("mongoose");
const Admin = require("../models/admin.model");
const AdminAuditLog = require("../models/adminAuditLog.model");
const {
  BlogAutomationSchedule,
} = require("../models/blogAutomationSchedule.model");
const {
  BlogAutomationExecution,
} = require("../models/blogAutomationExecution.model");
const {
  ContentOperationsRun,
} = require("../models/contentOperationsRun.model");
const {
  CONTROL_KEYS,
  OpenClawRuntimeControl,
} = require("../models/openclawRuntimeControl.model");
const {
  BadRequestError,
  ConflictRequestError,
  ForbiddenError,
} = require("../core/error.response");
const {
  buildCapabilityDefinitions,
} = require("./openclawCapabilityHealth.service");
const { TelegramApprovalService } = require("./telegramApproval.service");
const {
  startTelegramPolling,
  stopTelegramPolling,
} = require("./telegramPolling.runtime");

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,128}$/;
const ACTIVE_EXECUTION_STATUSES = Object.freeze([
  "queued",
  "running",
  "committing",
]);

const CONTROL_DEFINITIONS = Object.freeze({
  blog_cron: Object.freeze({
    envKey: "OPENCLAW_BLOG_CRON_ENABLED",
    risk: "scheduled_writes",
  }),
  auto_publish: Object.freeze({
    envKey: "SEO_AGENT_AUTO_PUBLISH",
    risk: "public_publish",
  }),
  telegram_approval: Object.freeze({
    envKey: "TELEGRAM_BOT_ENABLED",
    risk: "external_notification",
  }),
  image_pipeline: Object.freeze({
    envKey: "OPENCLAW_IMAGE_PIPELINE_ENABLED",
    risk: "paid_external_provider",
  }),
});

const parseBoolean = (value, fallback = false) => {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
};

const isProductionPublishLocked = (controlKey, env = process.env) =>
  controlKey === "auto_publish" &&
  String(env.NODE_ENV || "").trim().toLowerCase() === "production";

const isProductionTelegramModeLocked = (controlKey, env = process.env) =>
  controlKey === "telegram_approval" &&
  String(env.NODE_ENV || "").trim().toLowerCase() === "production" &&
  String(env.TELEGRAM_MODE || "webhook").trim().toLowerCase() !== "webhook";

const isPolicyLocked = (controlKey, env = process.env) =>
  isProductionPublishLocked(controlKey, env) ||
  isProductionTelegramModeLocked(controlKey, env);

const existingEnableBlocked = (preconditions = []) =>
  preconditions.some(
    (check) => check.key !== "no_active_runs" && check.pass !== true,
  );

const acknowledgementFor = (controlKey, enabled) =>
  `ACKNOWLEDGE ${controlKey.toUpperCase()} ${enabled ? "ENABLE" : "DISABLE"}`;

const adminSnapshot = (admin) => ({
  adminId: admin?._id ? String(admin._id) : null,
  name: admin?.name || null,
  email: admin?.email || null,
  status: admin?.status || null,
  roles: Array.isArray(admin?.roles) ? admin.roles : [],
});

const safeControlDocument = (document) => {
  if (!document) return null;
  return typeof document.toObject === "function"
    ? document.toObject()
    : document;
};

const waitForDatabase = async ({
  connection = mongoose.connection,
  timeoutMs = 15_000,
} = {}) => {
  if (connection.readyState === 1) return true;
  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      connection.off("open", handleOpen);
      connection.off("error", handleError);
      if (error) reject(error);
      else resolve();
    };
    const handleOpen = () => finish();
    const handleError = (error) => finish(error);
    const timer = setTimeout(
      () => finish(new Error("OpenClaw runtime control database timeout")),
      timeoutMs,
    );
    connection.once("open", handleOpen);
    connection.once("error", handleError);
  });
  return true;
};

class OpenClawRuntimeControlService {
  constructor({
    ControlModel = OpenClawRuntimeControl,
    ScheduleModel = BlogAutomationSchedule,
    ExecutionModel = BlogAutomationExecution,
    ContentOperationsRunModel = ContentOperationsRun,
    AdminModel = Admin,
    AuditModel = AdminAuditLog,
    envProvider = () => process.env,
    capabilityDefinitionsProvider = (env) =>
      buildCapabilityDefinitions(env, TelegramApprovalService.status()),
    applyEnvironment = (envKey, enabled) => {
      process.env[envKey] = enabled ? "true" : "false";
    },
    telegramRuntime = {
      start: startTelegramPolling,
      stop: stopTelegramPolling,
    },
    now = () => new Date(),
  } = {}) {
    this.ControlModel = ControlModel;
    this.ScheduleModel = ScheduleModel;
    this.ExecutionModel = ExecutionModel;
    this.ContentOperationsRunModel = ContentOperationsRunModel;
    this.AdminModel = AdminModel;
    this.AuditModel = AuditModel;
    this.envProvider = envProvider;
    this.capabilityDefinitionsProvider = capabilityDefinitionsProvider;
    this.applyEnvironment = applyEnvironment;
    this.telegramRuntime = telegramRuntime;
    this.now = now;
  }

  definition(controlKey) {
    const definition = CONTROL_DEFINITIONS[controlKey];
    if (!definition)
      throw new BadRequestError("Unsupported OpenClaw runtime control");
    return definition;
  }

  async _runtimeFacts() {
    const now = this.now();
    const [
      enabledScheduleCount,
      activeExecutionCount,
      activeContentOperationsRunCount,
    ] = await Promise.all([
      this.ScheduleModel.countDocuments({
        isQaTest: { $ne: true },
        enabled: true,
      }),
      this.ExecutionModel.countDocuments({
        isQaTest: { $ne: true },
        status: { $in: ACTIVE_EXECUTION_STATUSES },
      }),
      this.ContentOperationsRunModel.countDocuments({
        isQaTest: { $ne: true },
        status: "running",
        leaseUntil: { $gt: now },
      }),
    ]);
    return {
      enabledScheduleCount,
      activeExecutionCount,
      activeContentOperationsRunCount,
      activeRunCount: activeExecutionCount + activeContentOperationsRunCount,
    };
  }

  _preconditions(controlKey, facts, currentValues) {
    const env = this.envProvider();
    const definitions = this.capabilityDefinitionsProvider(env);
    const noActiveRuns = facts.activeRunCount === 0;
    const seoAgentEnabled = parseBoolean(env.SEO_AGENT_ENABLED, false);
    const imagePipelineEnabled =
      currentValues.image_pipeline ??
      parseBoolean(env.OPENCLAW_IMAGE_PIPELINE_ENABLED, false);
    const checks = {
      blog_cron: [
        {
          key: "seo_agent_enabled",
          pass: seoAgentEnabled,
        },
        {
          key: "seo_agent_configured",
          pass: definitions.seoAgent?.configured === true,
        },
        {
          key: "blog_pipeline_configured",
          pass: definitions.blogCron?.configured === true,
        },
        {
          key: "enabled_schedule_exists",
          pass: facts.enabledScheduleCount > 0,
          value: facts.enabledScheduleCount,
        },
        {
          key: "no_active_runs",
          pass: noActiveRuns,
          value: facts.activeRunCount,
        },
      ],
      auto_publish: [
        {
          key: "production_draft_only_policy",
          pass: !isProductionPublishLocked(controlKey, env),
        },
        {
          key: "seo_agent_enabled",
          pass: seoAgentEnabled,
        },
        {
          key: "publish_readiness_enabled",
          pass: parseBoolean(env.CONTENT_PUBLISH_READINESS_ENABLED, true),
        },
        {
          key: "post_publish_verification_enabled",
          pass: parseBoolean(env.CONTENT_POST_PUBLISH_VERIFY_ENABLED, true),
        },
        {
          key: "image_pipeline_enabled",
          pass: imagePipelineEnabled,
        },
        {
          key: "image_pipeline_configured",
          pass: definitions.imagePipeline?.configured === true,
        },
        {
          key: "no_active_runs",
          pass: noActiveRuns,
          value: facts.activeRunCount,
        },
      ],
      telegram_approval: [
        {
          key: "production_webhook_policy",
          pass: !isProductionTelegramModeLocked(controlKey, env),
        },
        {
          key: "telegram_configured",
          pass: definitions.telegram?.configured === true,
        },
        {
          key: "no_active_runs",
          pass: noActiveRuns,
          value: facts.activeRunCount,
        },
      ],
      image_pipeline: [
        {
          key: "image_provider_configured",
          pass: definitions.imagePipeline?.configured === true,
        },
        {
          key: "no_active_runs",
          pass: noActiveRuns,
          value: facts.activeRunCount,
        },
      ],
    };
    return checks[controlKey] || [];
  }

  async _documents() {
    const items = await this.ControlModel.find({
      controlKey: { $in: CONTROL_KEYS },
    })
      .select(
        "controlKey enabled revision reason updatedBy createdAt updatedAt",
      )
      .lean();
    return new Map(items.map((item) => [item.controlKey, item]));
  }

  async list({ canManage = false } = {}) {
    const documents = await this._documents();
    const facts = await this._runtimeFacts();
    const env = this.envProvider();
    const configuredValues = Object.fromEntries(
      CONTROL_KEYS.map((controlKey) => {
        const document = documents.get(controlKey);
        const definition = this.definition(controlKey);
        const configuredEnabled = document
          ? document.enabled === true
          : parseBoolean(env[definition.envKey], false);
        return [
          controlKey,
          isPolicyLocked(controlKey, env)
            ? false
            : configuredEnabled,
        ];
      }),
    );
    return {
      controls: CONTROL_KEYS.map((controlKey) => {
        const definition = this.definition(controlKey);
        const document = documents.get(controlKey) || null;
        const preconditions = this._preconditions(
          controlKey,
          facts,
          configuredValues,
        );
        const enabled =
          configuredValues[controlKey] === true &&
          !existingEnableBlocked(preconditions);
        return {
          controlKey,
          envKey: definition.envKey,
          risk: definition.risk,
          enabled,
          revision: Number(document?.revision || 0),
          source: document ? "runtime_override" : "environment_default",
          policyLocked: isPolicyLocked(controlKey, env),
          readyToEnable: preconditions.every((check) => check.pass === true),
          preconditions,
          acknowledgement: acknowledgementFor(controlKey, !enabled),
          updatedAt: document?.updatedAt || null,
          reason: document?.reason || "",
        };
      }),
      actions: { manage: canManage === true },
      runtime: facts,
      checkedAt: this.now().toISOString(),
    };
  }

  async _recordAudit({
    adminId,
    controlKey,
    beforeEnabled,
    afterEnabled,
    reason,
    expectedRevision,
  }) {
    const admin = await this.AdminModel.findById(adminId)
      .select("name email status roles")
      .lean();
    if (!admin) throw new ForbiddenError("Valid administrator is required");
    const snapshot = adminSnapshot(admin);
    return this.AuditModel.create({
      category: "openclaw_runtime_control",
      action: "runtime_control_change_requested",
      actorAdmin: admin._id,
      actorSnapshot: snapshot,
      targetAdmin: admin._id,
      targetSnapshot: snapshot,
      summary: `${controlKey} requested ${afterEnabled ? "enabled" : "disabled"}`,
      metadata: {
        controlKey,
        beforeEnabled,
        afterEnabled,
        expectedRevision,
        reason,
        outcome: "requested",
      },
    });
  }

  _apply(controlKey, enabled) {
    const definition = this.definition(controlKey);
    const effectiveEnabled = isProductionPublishLocked(
      controlKey,
      this.envProvider(),
    ) || isProductionTelegramModeLocked(controlKey, this.envProvider())
      ? false
      : enabled;
    this.applyEnvironment(definition.envKey, effectiveEnabled);
    if (controlKey === "telegram_approval") {
      if (effectiveEnabled) this.telegramRuntime.start();
      else this.telegramRuntime.stop();
    }
  }

  async update({
    controlKey,
    payload,
    adminId,
    idempotencyKey,
    canManage = false,
  }) {
    if (!canManage) throw new ForbiddenError("Insufficient permission");
    const definition = this.definition(controlKey);
    if (!IDEMPOTENCY_KEY.test(String(idempotencyKey || ""))) {
      throw new BadRequestError("A valid Idempotency-Key is required");
    }
    const reason = String(payload?.reason || "").trim();
    const enabled = payload?.enabled;
    const expectedRevision = Number(payload?.expectedRevision);
    const acknowledgement = String(payload?.acknowledgement || "");
    if (typeof enabled !== "boolean") {
      throw new BadRequestError("enabled must be a boolean");
    }
    if (
      !Number.isInteger(expectedRevision) ||
      expectedRevision < 0 ||
      expectedRevision > Number.MAX_SAFE_INTEGER
    ) {
      throw new BadRequestError(
        "expectedRevision must be a non-negative integer",
      );
    }
    if (reason.length < 10 || reason.length > 500) {
      throw new BadRequestError("reason must contain 10 to 500 characters");
    }
    if (acknowledgement !== acknowledgementFor(controlKey, enabled)) {
      throw new BadRequestError("Runtime control acknowledgement is invalid");
    }
    if (
      enabled &&
      isProductionPublishLocked(controlKey, this.envProvider())
    ) {
      throw new BadRequestError(
        "Auto publish is locked off by the production draft-only policy",
      );
    }

    const requestHash = crypto
      .createHash("sha256")
      .update(String(idempotencyKey))
      .digest("hex");
    const currentDocument = safeControlDocument(
      await this.ControlModel.findOne({ controlKey }).select(
        "+lastIdempotencyKeyHash",
      ),
    );
    const env = this.envProvider();
    const beforeEnabled = currentDocument
      ? currentDocument.enabled === true
      : parseBoolean(env[definition.envKey], false);

    if (currentDocument?.lastIdempotencyKeyHash === requestHash) {
      return { ...(await this.list({ canManage })), idempotentReplay: true };
    }
    const currentRevision = Number(currentDocument?.revision || 0);
    if (currentRevision !== expectedRevision) {
      throw new ConflictRequestError(
        "OpenClaw runtime control revision is stale",
      );
    }
    if (beforeEnabled === enabled) {
      return { ...(await this.list({ canManage })), noChange: true };
    }

    if (enabled) {
      const status = await this.list({ canManage });
      const requestedControl = status.controls.find(
        (item) => item.controlKey === controlKey,
      );
      if (!requestedControl?.readyToEnable) {
        throw new BadRequestError(
          "OpenClaw runtime control preconditions are not satisfied",
        );
      }
    }

    const audit = await this._recordAudit({
      adminId,
      controlKey,
      beforeEnabled,
      afterEnabled: enabled,
      reason,
      expectedRevision,
    });

    let updated;
    if (!currentDocument) {
      try {
        updated = await this.ControlModel.create({
          controlKey,
          enabled,
          revision: 1,
          reason,
          updatedBy: adminId,
          lastIdempotencyKeyHash: requestHash,
        });
      } catch (error) {
        if (error?.code === 11000) {
          throw new ConflictRequestError(
            "OpenClaw runtime control was updated concurrently",
          );
        }
        throw error;
      }
    } else {
      updated = await this.ControlModel.findOneAndUpdate(
        { controlKey, revision: expectedRevision },
        {
          $set: {
            enabled,
            reason,
            updatedBy: adminId,
            lastIdempotencyKeyHash: requestHash,
          },
          $inc: { revision: 1 },
        },
        { new: true, runValidators: true },
      );
      if (!updated) {
        throw new ConflictRequestError(
          "OpenClaw runtime control was updated concurrently",
        );
      }
    }

    this._apply(controlKey, enabled);
    await this.AuditModel.updateOne(
      { _id: audit._id },
      {
        $set: {
          "metadata.outcome": "applied",
          "metadata.appliedRevision": Number(updated.revision),
        },
      },
    ).catch(() => null);
    return this.list({ canManage });
  }

  async hydrate({ waitForConnection = true, timeoutMs = 15_000 } = {}) {
    if (waitForConnection) await waitForDatabase({ timeoutMs });
    const documents = await this._documents();
    const facts = await this._runtimeFacts();
    const env = this.envProvider();
    const configuredValues = Object.fromEntries(
      CONTROL_KEYS.map((controlKey) => {
        const document = documents.get(controlKey);
        const definition = this.definition(controlKey);
        return [
          controlKey,
          document
            ? document.enabled === true
            : parseBoolean(env[definition.envKey], false),
        ];
      }),
    );
    for (const controlKey of CONTROL_KEYS) {
      const document = documents.get(controlKey);
      if (!document) continue;
      const preconditions = this._preconditions(
        controlKey,
        facts,
        configuredValues,
      );
      const enabled =
        document.enabled === true && !existingEnableBlocked(preconditions);
      this._apply(controlKey, enabled);
    }
    return { applied: documents.size };
  }

  forceFailClosed() {
    for (const controlKey of CONTROL_KEYS) this._apply(controlKey, false);
    return { applied: CONTROL_KEYS.length };
  }
}

const openClawRuntimeControlService = new OpenClawRuntimeControlService();

module.exports = {
  ACTIVE_EXECUTION_STATUSES,
  CONTROL_DEFINITIONS,
  IDEMPOTENCY_KEY,
  OpenClawRuntimeControlService,
  acknowledgementFor,
  existingEnableBlocked,
  isPolicyLocked,
  isProductionPublishLocked,
  isProductionTelegramModeLocked,
  openClawRuntimeControlService,
  parseBoolean,
  waitForDatabase,
};
