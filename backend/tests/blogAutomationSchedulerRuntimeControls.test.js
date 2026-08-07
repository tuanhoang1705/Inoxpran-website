import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { tick } = require("../src/services/blogAutomationScheduler.runtime");
const {
  openClawRuntimeControlService,
} = require("../src/services/openclawRuntimeControl.service");
const {
  BlogAutomationScheduleService,
} = require("../src/services/blogAutomationSchedule.service");
const {
  GoogleIntelligenceService,
} = require("../src/services/googleIntelligence.service");
const {
  ContentOperationsScheduleService,
} = require("../src/services/contentOperations/contentOperationsSchedule.service");
const {
  PerformanceLearningService,
} = require("../src/services/contentOperations/performanceLearning.service");

const WORKLOAD_ENV_KEYS = [
  "SEO_AGENT_ENABLED",
  "OPENCLAW_BLOG_CRON_ENABLED",
  "GOOGLE_INTELLIGENCE_ENABLED",
  "CONTENT_OPERATIONS_ENABLED",
];

const disableEveryWorkload = () => {
  for (const key of WORKLOAD_ENV_KEYS) process.env[key] = "false";
};

const stubWorkloads = () => ({
  runQueuedOnce: vi
    .spyOn(BlogAutomationScheduleService, "runQueuedOnce")
    .mockResolvedValue(null),
  runDueOnce: vi
    .spyOn(BlogAutomationScheduleService, "runDueOnce")
    .mockResolvedValue(null),
  googleIntelligence: vi
    .spyOn(GoogleIntelligenceService, "runDueOnce")
    .mockResolvedValue(null),
  contentOperations: vi
    .spyOn(ContentOperationsScheduleService, "runDueOnce")
    .mockResolvedValue(null),
  performanceLearning: vi
    .spyOn(PerformanceLearningService, "runDueOnce")
    .mockResolvedValue(null),
});

describe("blog automation scheduler runtime control refresh", () => {
  const originalEnv = Object.fromEntries(
    WORKLOAD_ENV_KEYS.map((key) => [key, process.env[key]]),
  );

  afterEach(() => {
    vi.restoreAllMocks();
    for (const key of WORKLOAD_ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  it("applies a control toggled in another process before the enablement gate runs", async () => {
    disableEveryWorkload();
    const workloads = stubWorkloads();
    // Stands in for the admin process having persisted the toggle: this worker
    // only learns about it through the refresh at the top of the tick.
    const hydrate = vi
      .spyOn(openClawRuntimeControlService, "hydrate")
      .mockImplementation(async () => {
        process.env.SEO_AGENT_ENABLED = "true";
        return { applied: 1 };
      });

    await tick();

    expect(hydrate).toHaveBeenCalledWith({ waitForConnection: false });
    expect(workloads.runQueuedOnce).toHaveBeenCalled();
  });

  it("stays fail-closed and keeps running when the control refresh fails", async () => {
    disableEveryWorkload();
    const workloads = stubWorkloads();
    vi.spyOn(openClawRuntimeControlService, "hydrate").mockRejectedValue(
      new Error("db_unavailable"),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(tick()).resolves.toBeUndefined();

    expect(workloads.runQueuedOnce).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
  });
});
