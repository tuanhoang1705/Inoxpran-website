import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  OpenClawRuntimeControlService,
  acknowledgementFor,
} = require("../src/services/openclawRuntimeControl.service");
const {
  exactUpdateBody,
  canManageRuntimeControls,
} = require("../src/controllers/openclawRuntimeControl.controller");

const adminId = "507f1f77bcf86cd799439011";

const buildHarness = ({
  env: envOverrides = {},
  controls = [],
  enabledScheduleCount = 1,
  activeExecutionCount = 0,
  activeContentOperationsRunCount = 0,
  blogConfigured = true,
  seoAgentConfigured = true,
  telegramConfigured = true,
  imageConfigured = true,
} = {}) => {
  const env = {
    SEO_AGENT_ENABLED: "true",
    OPENCLAW_BLOG_CRON_ENABLED: "false",
    SEO_AGENT_AUTO_PUBLISH: "false",
    TELEGRAM_BOT_ENABLED: "false",
    OPENCLAW_IMAGE_PIPELINE_ENABLED: "false",
    CONTENT_PUBLISH_READINESS_ENABLED: "true",
    CONTENT_POST_PUBLISH_VERIFY_ENABLED: "true",
    ...envOverrides,
  };
  const state = new Map(
    controls.map((control) => [control.controlKey, { ...control }]),
  );
  const applyEnvironment = vi.fn((envKey, enabled) => {
    env[envKey] = enabled ? "true" : "false";
  });
  const telegramRuntime = {
    start: vi.fn(() => ({ started: true })),
    stop: vi.fn(() => ({ stopped: true })),
  };
  const audits = [];

  const ControlModel = {
    find: vi.fn(() => ({
      select: vi.fn(() => ({
        lean: vi.fn(async () =>
          Array.from(state.values()).map((item) => ({ ...item })),
        ),
      })),
    })),
    findOne: vi.fn(({ controlKey }) => ({
      select: vi.fn(async () => {
        const item = state.get(controlKey);
        return item ? { ...item } : null;
      }),
    })),
    create: vi.fn(async (payload) => {
      if (state.has(payload.controlKey)) {
        const error = new Error("duplicate");
        error.code = 11000;
        throw error;
      }
      const created = {
        ...payload,
        revision: 1,
        createdAt: new Date("2026-07-23T10:00:00.000Z"),
        updatedAt: new Date("2026-07-23T10:00:00.000Z"),
      };
      state.set(payload.controlKey, created);
      return { ...created };
    }),
    findOneAndUpdate: vi.fn(async (filter, update) => {
      const item = state.get(filter.controlKey);
      if (!item || Number(item.revision) !== Number(filter.revision))
        return null;
      const updated = {
        ...item,
        ...update.$set,
        revision: Number(item.revision) + Number(update.$inc?.revision || 0),
        updatedAt: new Date("2026-07-23T10:01:00.000Z"),
      };
      state.set(filter.controlKey, updated);
      return { ...updated };
    }),
  };

  const service = new OpenClawRuntimeControlService({
    ControlModel,
    ScheduleModel: {
      countDocuments: vi.fn(async () => enabledScheduleCount),
    },
    ExecutionModel: {
      countDocuments: vi.fn(async () => activeExecutionCount),
    },
    ContentOperationsRunModel: {
      countDocuments: vi.fn(async () => activeContentOperationsRunCount),
    },
    AdminModel: {
      findById: vi.fn(() => ({
        select: vi.fn(() => ({
          lean: vi.fn(async () => ({
            _id: adminId,
            name: "Root Admin",
            email: "root@example.com",
            status: "active",
            roles: ["SUPER_ADMIN"],
          })),
        })),
      })),
    },
    AuditModel: {
      create: vi.fn(async (payload) => {
        const audit = { ...payload, _id: `audit-${audits.length + 1}` };
        audits.push(audit);
        return audit;
      }),
      updateOne: vi.fn(async (_filter, update) => {
        Object.assign(audits.at(-1).metadata, {
          outcome: update.$set["metadata.outcome"],
          appliedRevision: update.$set["metadata.appliedRevision"],
        });
        return { modifiedCount: 1 };
      }),
    },
    envProvider: () => env,
    capabilityDefinitionsProvider: () => ({
      blogCron: { configured: blogConfigured },
      seoAgent: { configured: seoAgentConfigured },
      telegram: { configured: telegramConfigured },
      imagePipeline: { configured: imageConfigured },
    }),
    applyEnvironment,
    telegramRuntime,
    now: () => new Date("2026-07-23T10:00:00.000Z"),
  });

  return {
    service,
    env,
    state,
    audits,
    applyEnvironment,
    telegramRuntime,
    ControlModel,
  };
};

const updateRequest = (controlKey, overrides = {}) => ({
  controlKey,
  payload: {
    enabled: true,
    expectedRevision: 0,
    reason: "Controlled production rollout approved",
    acknowledgement: acknowledgementFor(controlKey, true),
    ...overrides,
  },
  adminId,
  idempotencyKey: `runtime-${controlKey}-request-001`,
  canManage: true,
});

describe("OpenClaw runtime controls", () => {
  it("exposes four environment-default controls with explicit readiness checks", async () => {
    const { service } = buildHarness();
    const result = await service.list({ canManage: true });

    expect(result.actions).toEqual({ manage: true });
    expect(result.controls.map((item) => item.controlKey)).toEqual([
      "blog_cron",
      "auto_publish",
      "telegram_approval",
      "image_pipeline",
    ]);
    expect(
      result.controls.every((item) => item.source === "environment_default"),
    ).toBe(true);
    expect(
      result.controls.find((item) => item.controlKey === "blog_cron"),
    ).toMatchObject({
      enabled: false,
      revision: 0,
      readyToEnable: true,
    });
  });

  it("fails closed when enabling cron without an enabled production schedule", async () => {
    const { service, applyEnvironment, audits } = buildHarness({
      enabledScheduleCount: 0,
    });

    await expect(service.update(updateRequest("blog_cron"))).rejects.toThrow(
      "preconditions are not satisfied",
    );
    expect(applyEnvironment).not.toHaveBeenCalled();
    expect(audits).toHaveLength(0);
  });

  it("fails closed when enabling cron without the configured model and gateway pipeline", async () => {
    const { service, applyEnvironment, audits } = buildHarness({
      blogConfigured: false,
    });

    await expect(service.update(updateRequest("blog_cron"))).rejects.toThrow(
      "preconditions are not satisfied",
    );
    expect(applyEnvironment).not.toHaveBeenCalled();
    expect(audits).toHaveLength(0);
  });

  it("persists, audits and applies an authorized cron enable once", async () => {
    const { service, env, state, audits, applyEnvironment } = buildHarness();
    const result = await service.update(updateRequest("blog_cron"));

    expect(state.get("blog_cron")).toMatchObject({
      enabled: true,
      revision: 1,
    });
    expect(env.OPENCLAW_BLOG_CRON_ENABLED).toBe("true");
    expect(applyEnvironment).toHaveBeenCalledWith(
      "OPENCLAW_BLOG_CRON_ENABLED",
      true,
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      category: "openclaw_runtime_control",
      action: "runtime_control_change_requested",
      metadata: {
        controlKey: "blog_cron",
        beforeEnabled: false,
        afterEnabled: true,
        outcome: "applied",
        appliedRevision: 1,
      },
    });
    expect(
      result.controls.find((item) => item.controlKey === "blog_cron"),
    ).toMatchObject({
      enabled: true,
      revision: 1,
      source: "runtime_override",
    });
    const replay = await service.update(updateRequest("blog_cron"));
    expect(replay.idempotentReplay).toBe(true);
    expect(applyEnvironment).toHaveBeenCalledTimes(1);
    expect(audits).toHaveLength(1);
  });

  it("rejects stale revisions", async () => {
    const existing = {
      controlKey: "image_pipeline",
      enabled: true,
      revision: 3,
      reason: "Approved image rollout",
      updatedBy: adminId,
      lastIdempotencyKeyHash: "a".repeat(64),
      updatedAt: new Date("2026-07-23T09:00:00.000Z"),
    };
    const { service } = buildHarness({
      controls: [existing],
      env: { OPENCLAW_IMAGE_PIPELINE_ENABLED: "true" },
    });

    await expect(
      service.update(
        updateRequest("image_pipeline", {
          enabled: false,
          expectedRevision: 2,
          acknowledgement: acknowledgementFor("image_pipeline", false),
        }),
      ),
    ).rejects.toThrow("revision is stale");
  });

  it("blocks auto publish until the image pipeline is enabled", async () => {
    const { service } = buildHarness();
    await expect(service.update(updateRequest("auto_publish"))).rejects.toThrow(
      "preconditions are not satisfied",
    );
  });

  it("cannot enable or hydrate auto publish in production", async () => {
    const retained = {
      controlKey: "auto_publish",
      enabled: true,
      revision: 2,
      reason: "Legacy retained rollout",
      updatedBy: adminId,
    };
    const { service, env, applyEnvironment } = buildHarness({
      env: {
        NODE_ENV: "production",
        OPENCLAW_IMAGE_PIPELINE_ENABLED: "true",
      },
      controls: [retained],
    });

    const listed = await service.list({ canManage: true });
    expect(
      listed.controls.find((item) => item.controlKey === "auto_publish"),
    ).toMatchObject({
      enabled: false,
      policyLocked: true,
      readyToEnable: false,
      revision: 2,
    });

    await service.hydrate({ waitForConnection: false });
    expect(env.SEO_AGENT_AUTO_PUBLISH).toBe("false");
    expect(applyEnvironment).toHaveBeenCalledWith(
      "SEO_AGENT_AUTO_PUBLISH",
      false,
    );

    await expect(
      service.update(
        updateRequest("auto_publish", {
          expectedRevision: 2,
        }),
      ),
    ).rejects.toThrow("locked off by the production draft-only policy");
  });

  it("starts and stops the polling runtime when Telegram changes", async () => {
    const { service, telegramRuntime } = buildHarness();
    const enabled = await service.update(updateRequest("telegram_approval"));
    const telegram = enabled.controls.find(
      (item) => item.controlKey === "telegram_approval",
    );

    const disableRequest = updateRequest("telegram_approval", {
      enabled: false,
      expectedRevision: telegram.revision,
      acknowledgement: acknowledgementFor("telegram_approval", false),
    });
    disableRequest.idempotencyKey = "runtime-telegram-approval-request-002";

    await service.update(disableRequest);

    expect(telegramRuntime.start).toHaveBeenCalledTimes(1);
    expect(telegramRuntime.stop).toHaveBeenCalledTimes(1);
  });

  it("rejects a production Telegram polling override even when credentials are configured", async () => {
    const { service, telegramRuntime } = buildHarness({
      env: {
        NODE_ENV: "production",
        TELEGRAM_MODE: "polling",
      },
    });

    const listed = await service.list({ canManage: true });
    expect(
      listed.controls.find(
        (item) => item.controlKey === "telegram_approval",
      ),
    ).toMatchObject({
      enabled: false,
      policyLocked: true,
      readyToEnable: false,
    });
    await expect(
      service.update(updateRequest("telegram_approval")),
    ).rejects.toThrow("preconditions are not satisfied");
    expect(telegramRuntime.start).not.toHaveBeenCalled();
  });

  it("does not restore a persisted enable when required configuration became invalid", async () => {
    const { service, env, applyEnvironment } = buildHarness({
      blogConfigured: false,
      controls: [
        {
          controlKey: "blog_cron",
          enabled: true,
          revision: 2,
          reason: "Retained rollout",
          updatedBy: adminId,
        },
      ],
    });

    await service.hydrate({ waitForConnection: false });

    expect(env.OPENCLAW_BLOG_CRON_ENABLED).toBe("false");
    expect(applyEnvironment).toHaveBeenCalledWith(
      "OPENCLAW_BLOG_CRON_ENABLED",
      false,
    );
    const listed = await service.list({ canManage: true });
    expect(
      listed.controls.find((item) => item.controlKey === "blog_cron"),
    ).toMatchObject({
      enabled: false,
      readyToEnable: false,
    });
  });

  it("restores persisted overrides and can force every control closed", async () => {
    const { service, env, applyEnvironment } = buildHarness({
      controls: [
        {
          controlKey: "blog_cron",
          enabled: true,
          revision: 2,
          reason: "Retained rollout",
          updatedBy: adminId,
        },
        {
          controlKey: "auto_publish",
          enabled: false,
          revision: 4,
          reason: "Retained draft policy",
          updatedBy: adminId,
        },
      ],
    });

    await expect(
      service.hydrate({ waitForConnection: false }),
    ).resolves.toEqual({
      applied: 2,
    });
    expect(env.OPENCLAW_BLOG_CRON_ENABLED).toBe("true");
    service.forceFailClosed();
    expect(env.OPENCLAW_BLOG_CRON_ENABLED).toBe("false");
    expect(env.SEO_AGENT_AUTO_PUBLISH).toBe("false");
    expect(env.TELEGRAM_BOT_ENABLED).toBe("false");
    expect(env.OPENCLAW_IMAGE_PIPELINE_ENABLED).toBe("false");
    expect(applyEnvironment).toHaveBeenCalled();
  });
});

describe("OpenClaw runtime control controller contracts", () => {
  it("requires an exact update body", () => {
    const valid = {
      enabled: true,
      expectedRevision: 0,
      reason: "Controlled production rollout approved",
      acknowledgement: acknowledgementFor("blog_cron", true),
    };
    expect(exactUpdateBody(valid)).toBe(valid);
    expect(() => exactUpdateBody({ ...valid, unexpected: true })).toThrow(
      "invalid fields",
    );
  });

  it("limits management to Super Admin or the explicit permission", () => {
    expect(canManageRuntimeControls({ adminRoles: ["SUPER_ADMIN"] })).toBe(
      true,
    );
    expect(
      canManageRuntimeControls({
        adminRoles: ["ADMIN"],
        adminPermissions: ["openclaw_runtime_control.manage"],
      }),
    ).toBe(true);
    expect(
      canManageRuntimeControls({ adminRoles: ["ADMIN"], adminPermissions: [] }),
    ).toBe(false);
  });
});
