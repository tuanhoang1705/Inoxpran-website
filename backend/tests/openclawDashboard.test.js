import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

const require = createRequire(import.meta.url);
const {
  OpenClawDashboardService,
  appendDashboardRunOutput,
  buildCapabilityMatrix,
  decodeDashboardRunOutput,
  extractDashboardUrl,
  finalizeDashboardRunOutput,
  formatDockerUpdateStatus,
  getConfiguredDashboardUrl,
  probeOpenClawGateway,
  queueDockerUpdateRequest,
  redactForDashboard,
  releaseDockerUpdateQueueLock,
} = require("../src/services/openclawDashboard.service");
const {
  BlogAutomationScheduleService,
} = require("../src/services/blogAutomationSchedule.service");
const {
  OpenClawCapabilityHealthService,
} = require("../src/services/openclawCapabilityHealth.service");
const {
  OpenClawDashboardRun,
} = require("../src/models/openclawDashboardRun.model");

describe("openclaw dashboard service", () => {
  it("returns canonical configuration states before runtime probes complete", () => {
    const telegramStatus = {
      tokenConfigured: true,
      allowlistConfigured: true,
      webhookSecretConfigured: true,
      adminBaseUrlConfigured: true,
      adminBaseUrlHttps: true,
    };
    const capabilities = buildCapabilityMatrix(
      {
        SEO_AGENT_ENABLED: "false",
        API_KEY: "set",
        SEO_AGENT_API_KEY: "set",
        SEO_AGENT_HMAC_SECRET: "set",
        OPENAI_API_KEY: "set",
        SEARCH_CONSOLE_ENABLED: "true",
        GOOGLE_APPLICATION_CREDENTIALS: "/run/secrets/google.json",
        CONTENT_TRENDS_ENABLED: "true",
        CONTENT_TRENDS_PROVIDER: "google_trends_rss",
        IMAGE_SEARCH_PROVIDER: "disabled",
        IMAGE_SEARCH_API_KEY: "set",
        TELEGRAM_BOT_ENABLED: "false",
        TELEGRAM_ALLOWED_CHAT_IDS: "configured",
      },
      telegramStatus,
    );

    expect(capabilities.seoAgent).toMatchObject({
      featureKey: "seo_agent",
      enabled: false,
      configured: true,
      checked: true,
      status: "disabled",
      availability: "unknown",
      reasonCode: "disabled_by_configuration",
    });
    expect(capabilities.searchConsole).toMatchObject({
      enabled: true,
      configured: false,
      checked: true,
      status: "missing_config",
      availability: "unavailable",
      reasonCode: "missing_configuration",
    });
    expect(capabilities.trends).toMatchObject({
      enabled: true,
      configured: true,
      checked: false,
      status: "pending_check",
    });
    expect(capabilities.imageSearch).toMatchObject({
      enabled: false,
      configured: false,
      status: "expected_disabled",
    });
    expect(capabilities.telegram).toMatchObject({
      enabled: false,
      configured: true,
      status: "expected_disabled",
    });
  });

  it("redacts sensitive values from command output", () => {
    const output = redactForDashboard(
      "API_KEY=abc123 SEO_AGENT_HMAC_SECRET=hmac123 OPENAI_API_KEY=sk-testsecret123456 mongodb+srv://user:pass@example/db authorization: Bearer abc.def http://127.0.0.1:18789/?token=secret-token",
    );

    expect(output).not.toContain("abc123");
    expect(output).not.toContain("hmac123");
    expect(output).not.toContain("sk-testsecret123456");
    expect(output).not.toContain("user:pass");
    expect(output).not.toContain("abc.def");
    expect(output).not.toContain("secret-token");
    expect(output).toContain("[redacted");
  });

  it("redacts the configured gateway token even when a log does not label it as a token", () => {
    const previousToken = process.env.OPENCLAW_GATEWAY_TOKEN;
    process.env.OPENCLAW_GATEWAY_TOKEN = "opaque-gateway-secret-value";
    try {
      const output = redactForDashboard(
        "dashboard session opaque-gateway-secret-value https://admin.inoxpran.com/openclaw/#opaque-gateway-secret-value",
      );
      expect(output).not.toContain("opaque-gateway-secret-value");
      expect(output).not.toContain("#");
    } finally {
      if (previousToken === undefined)
        delete process.env.OPENCLAW_GATEWAY_TOKEN;
      else process.env.OPENCLAW_GATEWAY_TOKEN = previousToken;
    }
  });

  const privateKeyPemBegin = ["-----BEGIN", "PRIVATE", "KEY-----"].join(" ");
  const privateKeyPemEnd = ["-----END", "PRIVATE", "KEY-----"].join(" ");

  it.each([
    ["snake token", "GHTK_API_TOKEN=ghtk-canary-value", "ghtk-canary-value"],
    [
      "snake client secret",
      "GOOGLE_CLIENT_SECRET: google-canary-value",
      "google-canary-value",
    ],
    [
      "private key",
      'PRIVATE_KEY="private-material-value"',
      "private-material-value",
    ],
    [
      "camel secret",
      '{"clientSecret":"camel-secret-value"}',
      "camel-secret-value",
    ],
    [
      "camel access token",
      "accessToken=camel-access-value",
      "camel-access-value",
    ],
    [
      "camel refresh token",
      "refreshToken: camel-refresh-value",
      "camel-refresh-value",
    ],
    [
      "generic credential",
      "credential=generic-credential-value",
      "generic-credential-value",
    ],
    ["password", 'PASSWORD="two word password"', "two word password"],
    [
      "basic authorization",
      "Authorization: Basic QWxhZGRpbjpPcGVuU2VzYW1l",
      "QWxhZGRpbjpPcGVuU2VzYW1l",
    ],
    [
      "URL-encoded secret",
      encodeURIComponent(
        "GHTK_API_TOKEN=encoded-token-canary Authorization: Basic encoded-basic-canary",
      ),
      "encoded-token-canary",
    ],
    [
      "double URL-encoded secret",
      encodeURIComponent(
        encodeURIComponent("privateKey=double-encoded-canary"),
      ),
      "double-encoded-canary",
    ],
    [
      "encoded secret beside malformed percent bytes",
      "bad=%E0%A4%A token%3DENCODED-SECRET-CANARY",
      "ENCODED-SECRET-CANARY",
    ],
    [
      "multiline PEM private key",
      `{"private_key":"${["-----BEGIN", "PRIVATE KEY-----"].join(" ")}\nSUPERSECRETBASE64PAYLOAD123456\n-----END PRIVATE KEY-----"}`,
      "SUPERSECRETBASE64PAYLOAD123456",
    ],
    [
      "URL-encoded PEM private key",
      encodeURIComponent(
        `privateKey=${privateKeyPemBegin}\nENCODEDPEMCANARY123456\n${privateKeyPemEnd}`,
      ),
      "ENCODEDPEMCANARY123456",
    ],
    [
      "unterminated PEM private key",
      `private_key=${privateKeyPemBegin}\nUNTERMINATEDPEMCANARY123456`,
      "UNTERMINATEDPEMCANARY123456",
    ],
    [
      "JSON secret containing an escaped double quote",
      JSON.stringify({
        password: 'prefix"ESCAPED-QUOTE-CANARY-123',
        safe: "ok",
      }),
      "ESCAPED-QUOTE-CANARY-123",
    ],
    [
      "single-quoted secret containing an escaped quote and backslash",
      String.raw`clientSecret='prefix\'SINGLE-QUOTE-CANARY-123\\tail'`,
      "SINGLE-QUOTE-CANARY-123",
    ],
  ])("redacts fail-closed credential form: %s", (_label, input, canary) => {
    const output = redactForDashboard(input);
    expect(output).not.toContain(canary);
    expect(output).toContain("[redacted");
    expect(output).not.toContain("[redacted]]");
  });

  it("keeps redacted JSON syntactically valid", () => {
    const output = redactForDashboard(
      JSON.stringify({
        clientSecret: "json-secret-canary",
        privateKey: "json-private-canary",
        nested: {
          password: 'prefix"nested-quote-canary\\tail',
        },
        safe: "visible",
      }),
    );
    expect(JSON.parse(output)).toEqual({
      clientSecret: "[redacted]",
      privateKey: "[redacted]",
      nested: {
        password: "[redacted]",
      },
      safe: "visible",
    });
  });

  it.each([
    "secretValue",
    "token_value",
    "apiKeyMaterial",
    "passwordText",
    "credentialData",
    "privateKeyContent",
    "accessKeyValue",
    "_secretValue",
    "__token_value",
    "1apiKeyMaterial",
    "client.secretValue",
    "$tokenValue",
  ])(
    "redacts a sensitive assignment token anywhere in the field name: %s",
    (fieldName) => {
      const canary = `FIELD-SUFFIX-CANARY-${fieldName}`;
      const rawOutput = redactForDashboard(`${fieldName}=${canary}`);
      const jsonOutput = redactForDashboard(
        JSON.stringify({ [fieldName]: canary, safe: "visible" }),
      );
      const escapedJsonOutput = redactForDashboard(
        JSON.stringify(
          JSON.stringify({ [fieldName]: canary, safe: "visible" }),
        ),
      );
      const run = {
        rawOutput: "",
        rawOutputBuffers: [],
        rawOutputBytes: 0,
        rawOutputTruncated: false,
        rawOutputFinalized: false,
        output: "",
      };
      appendDashboardRunOutput(
        run,
        Buffer.from(JSON.stringify({ [fieldName]: canary }), "utf8"),
      );
      const terminalOutput = finalizeDashboardRunOutput(run);
      const escapedRun = {
        rawOutput: "",
        rawOutputBuffers: [],
        rawOutputBytes: 0,
        rawOutputTruncated: false,
        rawOutputFinalized: false,
        output: "",
      };
      appendDashboardRunOutput(
        escapedRun,
        Buffer.from(
          JSON.stringify(JSON.stringify({ [fieldName]: canary })),
          "utf8",
        ),
      );
      const escapedTerminalOutput =
        finalizeDashboardRunOutput(escapedRun);

      expect(rawOutput).not.toContain(canary);
      expect(JSON.parse(jsonOutput)).toEqual({
        [fieldName]: "[redacted]",
        safe: "visible",
      });
      expect(JSON.parse(JSON.parse(escapedJsonOutput))).toEqual({
        [fieldName]: "[redacted]",
        safe: "visible",
      });
      expect(terminalOutput).not.toContain(canary);
      expect(JSON.parse(terminalOutput)).toEqual({
        [fieldName]: "[redacted]",
      });
      expect(escapedTerminalOutput).not.toContain(canary);
      expect(JSON.parse(JSON.parse(escapedTerminalOutput))).toEqual({
        [fieldName]: "[redacted]",
      });
    },
  );

  it("exact-redacts every configured sensitive environment value, raw and encoded", () => {
    const previous = {
      ghtk: process.env.GHTK_API_TOKEN,
      google: process.env.GOOGLE_CLIENT_SECRET,
      short: process.env.LOCAL_QA_PASSWORD,
      suffixed: process.env.LOCAL_SECRET_VALUE,
    };
    process.env.GHTK_API_TOKEN = ["bare", "ghtk", "env", "canary", "123"].join("-");
    process.env.GOOGLE_CLIENT_SECRET = "bare google env canary 456";
    process.env.LOCAL_QA_PASSWORD = "a+b c7";
    process.env.LOCAL_SECRET_VALUE = "unlabelled-suffixed-env-canary-789";
    try {
      const output = redactForDashboard(
        [
          "unlabelled bare-ghtk-env-canary-123",
          encodeURIComponent("bare google env canary 456"),
          "short raw a+b c7",
          `short encoded ${encodeURIComponent("a+b c7")}`,
          "unlabelled-suffixed-env-canary-789",
        ].join("\n"),
      );
      expect(output).not.toContain("bare-ghtk-env-canary-123");
      expect(output).not.toContain("bare google env canary 456");
      expect(output).not.toContain(
        encodeURIComponent("bare google env canary 456"),
      );
      expect(output).not.toContain("a+b c7");
      expect(output).not.toContain(encodeURIComponent("a+b c7"));
      expect(output).not.toContain("unlabelled-suffixed-env-canary-789");
    } finally {
      if (previous.ghtk === undefined) delete process.env.GHTK_API_TOKEN;
      else process.env.GHTK_API_TOKEN = previous.ghtk;
      if (previous.google === undefined)
        delete process.env.GOOGLE_CLIENT_SECRET;
      else process.env.GOOGLE_CLIENT_SECRET = previous.google;
      if (previous.short === undefined) delete process.env.LOCAL_QA_PASSWORD;
      else process.env.LOCAL_QA_PASSWORD = previous.short;
      if (previous.suffixed === undefined)
        delete process.env.LOCAL_SECRET_VALUE;
      else process.env.LOCAL_SECRET_VALUE = previous.suffixed;
    }
  });

  it("keeps redaction markers idempotent when short env secrets equal marker words", () => {
    const previous = {
      password: process.env.LOCAL_QA_PASSWORD,
      token: process.env.LOCAL_CAP_TOKEN,
    };
    process.env.LOCAL_QA_PASSWORD = "secret";
    process.env.LOCAL_CAP_TOKEN = "redacted";
    try {
      const once = redactForDashboard(
        "unlabelled secret redacted PASSWORD=secret; existing=[redacted-env-secret]",
      );
      const twice = redactForDashboard(once);
      expect(twice).toBe(once);
      expect(once).not.toContain("unlabelled secret redacted");
      expect(once).not.toContain("[redacted-env-[redacted");
      expect(
        once.match(/\[redacted-env-secret\]/g)?.length,
      ).toBeGreaterThanOrEqual(3);
    } finally {
      if (previous.password === undefined) delete process.env.LOCAL_QA_PASSWORD;
      else process.env.LOCAL_QA_PASSWORD = previous.password;
      if (previous.token === undefined) delete process.env.LOCAL_CAP_TOKEN;
      else process.env.LOCAL_CAP_TOKEN = previous.token;
    }
  });

  it("exact-redacts marker-bearing and overlapping configured secrets before preserving existing markers", () => {
    const previous = {
      password: process.env.LOCAL_QA_PASSWORD,
      token: process.env.LOCAL_CAP_TOKEN,
      gateway: process.env.OPENCLAW_GATEWAY_TOKEN,
    };
    const markerSecret = "prefix[redacted]suffix";
    const overlappingGatewaySecret = `${markerSecret}-longer`;
    process.env.LOCAL_QA_PASSWORD = markerSecret;
    process.env.LOCAL_CAP_TOKEN = "redacted";
    process.env.OPENCLAW_GATEWAY_TOKEN = overlappingGatewaySecret;
    try {
      const encodedMarkerSecret = encodeURIComponent(markerSecret);
      const encodedGatewaySecret = encodeURIComponent(overlappingGatewaySecret);
      const once = redactForDashboard(
        [
          `raw gateway ${overlappingGatewaySecret}`,
          `raw env ${markerSecret}`,
          `encoded gateway ${encodedGatewaySecret}`,
          `encoded env ${encodedMarkerSecret}`,
          "existing [redacted-env-secret]",
        ].join("\n"),
      );
      const twice = redactForDashboard(once);

      expect(twice).toBe(once);
      expect(once).not.toContain(overlappingGatewaySecret);
      expect(once).not.toContain(markerSecret);
      expect(once).not.toContain(encodedGatewaySecret);
      expect(once).not.toContain(encodedMarkerSecret);
      expect(once).toContain("[redacted-gateway-token]");
      expect(once).toContain("[redacted-env-secret]");
      expect(once).not.toMatch(/[\uE000\uE001]/);
    } finally {
      if (previous.password === undefined) delete process.env.LOCAL_QA_PASSWORD;
      else process.env.LOCAL_QA_PASSWORD = previous.password;
      if (previous.token === undefined) delete process.env.LOCAL_CAP_TOKEN;
      else process.env.LOCAL_CAP_TOKEN = previous.token;
      if (previous.gateway === undefined)
        delete process.env.OPENCLAW_GATEWAY_TOKEN;
      else process.env.OPENCLAW_GATEWAY_TOKEN = previous.gateway;
    }
  });

  it.each([
    [
      "multiline assignment",
      "API_KEY=TOKEN-FIRST\nTOKEN-SECOND-CANARY",
      "TOKEN-SECOND-CANARY",
    ],
    [
      "Bearer authorization",
      "Authorization: Bearer BEARER-CHUNK-CANARY",
      "BEARER-CHUNK-CANARY",
    ],
    [
      "Basic authorization",
      "Authorization: Basic BASIC-CHUNK-CANARY",
      "BASIC-CHUNK-CANARY",
    ],
    [
      "PEM private key",
      "PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nPEM-BODY-CHUNK-CANARY\n-----END PRIVATE KEY-----",
      "PEM-BODY-CHUNK-CANARY",
    ],
    [
      "bare OpenAI key",
      "provider key sk-OPENAI-CHUNK-CANARY-123456",
      "OPENAI-CHUNK-CANARY-123456",
    ],
  ])(
    "redacts %s across every process-output chunk boundary",
    (_label, content, canary) => {
      for (let split = 0; split <= content.length; split += 1) {
        const run = {
          rawOutput: "",
          rawOutputTruncated: false,
          rawOutputFinalized: false,
          output: "",
        };
        appendDashboardRunOutput(run, content.slice(0, split));
        expect(run.output).toContain("withheld");
        expect(run.output).not.toMatch(/\bsk-[A-Za-z0-9_-]+/);
        appendDashboardRunOutput(run, content.slice(split));
        expect(run.output).toContain("withheld");
        finalizeDashboardRunOutput(run);
        expect(run.output).not.toContain(canary);
        expect(run.output).toContain("[redacted");
        expect(run.rawOutput).toBe("");
        expect(run.rawOutputFinalized).toBe(true);
      }
    },
  );

  it("withholds every incomplete quoted JSON secret prefix until terminal finalization", () => {
    const content = JSON.stringify({
      password: "QUOTED-PASSWORD-CANARY-123456789",
      safe: "usable",
    });
    for (let split = 0; split <= content.length; split += 1) {
      const run = {
        rawOutput: "",
        rawOutputTruncated: false,
        rawOutputFinalized: false,
        output: "",
      };
      appendDashboardRunOutput(run, content.slice(0, split));
      expect(run.output).toContain("withheld");
      expect(run.output).not.toContain("QUOTED-PASSWORD");
      appendDashboardRunOutput(run, content.slice(split));
      expect(run.output).toContain("withheld");
      const finalOutput = finalizeDashboardRunOutput(run);
      expect(finalOutput).not.toContain("QUOTED-PASSWORD-CANARY-123456789");
      expect(run.rawOutput).toBe("");
      expect(run.rawOutputFinalized).toBe(true);
      expect(JSON.parse(finalOutput)).toEqual({
        password: "[redacted]",
        safe: "usable",
      });
    }
  });

  it("withholds every configured environment-secret prefix while the run is active", () => {
    const previous = process.env.LOCAL_QA_PASSWORD;
    const secret = "BARE-CONFIGURED-ENV-CANARY-123456789";
    process.env.LOCAL_QA_PASSWORD = secret;
    try {
      const content = `safe-prefix ${secret} safe-suffix`;
      for (let split = 0; split <= content.length; split += 1) {
        const run = {
          rawOutput: "",
          rawOutputTruncated: false,
          rawOutputFinalized: false,
          output: "",
        };
        appendDashboardRunOutput(run, content.slice(0, split));
        expect(run.output).toContain("withheld");
        expect(run.output).not.toContain("BARE-CONFIGURED");
        appendDashboardRunOutput(run, content.slice(split));
        expect(run.output).toContain("withheld");
        const finalOutput = finalizeDashboardRunOutput(run);
        expect(finalOutput).toBe(
          "safe-prefix [redacted-env-secret] safe-suffix",
        );
        expect(run.rawOutput).toBe("");
        expect(run.rawOutputFinalized).toBe(true);
      }
    } finally {
      if (previous === undefined) delete process.env.LOCAL_QA_PASSWORD;
      else process.env.LOCAL_QA_PASSWORD = previous;
    }
  });

  it("decodes buffered UTF-8 once and redacts a Unicode secret across every byte boundary", () => {
    const previous = process.env.LOCAL_QA_PASSWORD;
    const secret = "pässword-UNICODE-CANARY-123456789";
    const expectedOutput = "safe-prefix [redacted-env-secret] safe-suffix";
    const content = Buffer.from(`safe-prefix ${secret} safe-suffix`, "utf8");
    process.env.LOCAL_QA_PASSWORD = secret;
    try {
      for (let split = 0; split <= content.length; split += 1) {
        const run = {
          rawOutput: "",
          rawOutputBuffers: [],
          rawOutputBytes: 0,
          rawOutputTruncated: false,
          rawOutputFinalized: false,
          output: "",
        };
        appendDashboardRunOutput(run, content.subarray(0, split));
        expect(run.output).toContain("withheld");
        expect(run.output).not.toContain("UNICODE-CANARY");
        appendDashboardRunOutput(run, content.subarray(split));
        expect(run.output).toContain("withheld");

        const finalOutput = finalizeDashboardRunOutput(run);
        expect(finalOutput).toBe(expectedOutput);
        expect(finalOutput).not.toContain("\uFFFD");
        expect(run.rawOutput).toBe("");
        expect(run.rawOutputBuffers).toEqual([]);
        expect(run.rawOutputBytes).toBe(0);
        expect(run.rawOutputFinalized).toBe(true);
      }
    } finally {
      if (previous === undefined) delete process.env.LOCAL_QA_PASSWORD;
      else process.env.LOCAL_QA_PASSWORD = previous;
    }
  });

  it("fails closed and suppresses later chunks after the raw output memory cap", () => {
    const run = {
      rawOutput: "",
      rawOutputTruncated: false,
      rawOutputFinalized: false,
      output: "",
    };
    appendDashboardRunOutput(
      run,
      `PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n${"A".repeat(270000)}OVERFLOW-PEM-CANARY\n-----END PRIVATE KEY-----`,
    );
    const cappedOutput = run.output;
    appendDashboardRunOutput(run, "LATE-OUTPUT-CANARY");
    finalizeDashboardRunOutput(run);

    expect(run.rawOutputTruncated).toBe(true);
    expect(run.rawOutput).toBe("");
    expect(run.output).toBe(cappedOutput);
    expect(run.output).not.toContain("OVERFLOW-PEM-CANARY");
    expect(run.output).not.toContain("LATE-OUTPUT-CANARY");
  });

  it("rejects unsupported dashboard actions", async () => {
    await expect(
      OpenClawDashboardService.startRun({
        action: "rm -rf /",
      }),
    ).rejects.toThrow("Unsupported OpenClaw action");
  });

  it("rejects unsafe profile names before spawning OpenClaw", async () => {
    await expect(
      OpenClawDashboardService.startRun({
        action: "status",
        profile: "inoxpran; rm -rf /",
      }),
    ).rejects.toThrow("Invalid OpenClaw profile");
  });

  it("removes authentication material from discovered OpenClaw dashboard URLs", () => {
    const output = [
      "Dashboard URL: http://127.0.0.1:18789/",
      "OPENCLAW_DASHBOARD_URL=http://127.0.0.1:18789/?token=secret-token",
    ].join("\n");

    expect(extractDashboardUrl(output)).toBe("http://127.0.0.1:18789/");
    expect(redactForDashboard(output)).not.toContain("secret-token");
  });

  it("fails closed when a discovered dashboard pathname contains the configured gateway token", () => {
    const previousToken = process.env.OPENCLAW_GATEWAY_TOKEN;
    const token = "opaque:gateway@path-secret";
    process.env.OPENCLAW_GATEWAY_TOKEN = token;
    try {
      for (const pathToken of [
        token,
        encodeURIComponent(token),
        encodeURIComponent(encodeURIComponent(token)),
        encodeURIComponent(encodeURIComponent(encodeURIComponent(token))),
      ]) {
        const output = `OPENCLAW_DASHBOARD_URL=http://127.0.0.1:18789/session/${pathToken}`;
        const dashboardUrl = extractDashboardUrl(output);

        expect(dashboardUrl).toBe("http://127.0.0.1:18789/");
        expect(dashboardUrl).not.toContain(token);
        expect(dashboardUrl).not.toContain(encodeURIComponent(token));
      }
    } finally {
      if (previousToken === undefined)
        delete process.env.OPENCLAW_GATEWAY_TOKEN;
      else process.env.OPENCLAW_GATEWAY_TOKEN = previousToken;
    }
  });

  it("discovers a sanitized dashboard URL after its bytes arrive across every chunk boundary", () => {
    const previousToken = process.env.OPENCLAW_GATEWAY_TOKEN;
    const token = "BUFFERED-DASHBOARD-TOKEN-CANARY-123456789";
    const content = Buffer.from(
      `starting\nOPENCLAW_DASHBOARD_URL=http://127.0.0.1:18789/?token=${token}\nready`,
      "utf8",
    );
    process.env.OPENCLAW_GATEWAY_TOKEN = token;
    try {
      for (let split = 0; split <= content.length; split += 1) {
        const run = {
          rawOutput: "",
          rawOutputBuffers: [],
          rawOutputBytes: 0,
          rawOutputTruncated: false,
          rawOutputFinalized: false,
          output: "",
        };
        appendDashboardRunOutput(run, content.subarray(0, split));
        appendDashboardRunOutput(run, content.subarray(split));
        expect(run.output).toContain("withheld");
        expect(run.output).not.toContain(token);

        const decodedSnapshot = decodeDashboardRunOutput(run);
        expect(decodedSnapshot.truncated).toBe(false);
        const dashboardUrl = extractDashboardUrl(decodedSnapshot.output);
        expect(dashboardUrl).toBe("http://127.0.0.1:18789/");
        expect(dashboardUrl).not.toContain(token);

        const finalOutput = finalizeDashboardRunOutput(run, decodedSnapshot);
        expect(finalOutput).not.toContain(token);
        expect(run.rawOutput).toBe("");
        expect(run.rawOutputBuffers).toEqual([]);
      }
    } finally {
      if (previousToken === undefined)
        delete process.env.OPENCLAW_GATEWAY_TOKEN;
      else process.env.OPENCLAW_GATEWAY_TOKEN = previousToken;
    }
  });

  it("never appends the gateway token to the configured Docker dashboard URL", () => {
    const previous = {
      deploymentMode: process.env.OPENCLAW_DEPLOYMENT_MODE,
      dashboardUrl: process.env.OPENCLAW_DASHBOARD_URL,
      gatewayToken: process.env.OPENCLAW_GATEWAY_TOKEN,
    };
    process.env.OPENCLAW_DEPLOYMENT_MODE = "docker";
    process.env.OPENCLAW_DASHBOARD_URL =
      "https://admin.inoxpran.com/openclaw-dashboard/?access_token=url-secret#opaque-secret";
    process.env.OPENCLAW_GATEWAY_TOKEN = "gateway-secret";

    try {
      const dashboardUrl = getConfiguredDashboardUrl();
      expect(dashboardUrl).toBe(
        "https://admin.inoxpran.com/openclaw-dashboard/",
      );
      expect(dashboardUrl).not.toContain("gateway-secret");
      expect(dashboardUrl).not.toContain("url-secret");
      expect(dashboardUrl).not.toContain("opaque-secret");
      expect(dashboardUrl).not.toContain("token=");
      expect(dashboardUrl).not.toContain("#");
    } finally {
      for (const [name, value] of Object.entries({
        OPENCLAW_DEPLOYMENT_MODE: previous.deploymentMode,
        OPENCLAW_DASHBOARD_URL: previous.dashboardUrl,
        OPENCLAW_GATEWAY_TOKEN: previous.gatewayToken,
      })) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it("checks Docker gateway liveness, readiness, and authentication without spawning the OpenClaw CLI", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response('{"ok":true}', {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const health = await probeOpenClawGateway({
      fetchImpl,
      env: {
        OPENCLAW_GATEWAY_HTTP_URL: "http://127.0.0.1:18789",
        OPENCLAW_GATEWAY_TOKEN: "gateway-secret",
      },
    });
    expect(health).toMatchObject({
      reachable: true,
      live: true,
      ready: true,
      authenticated: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("reports an unreachable Docker gateway without throwing or leaking internals", async () => {
    const health = await probeOpenClawGateway({
      fetchImpl: vi.fn(async () => {
        throw new Error("connect ECONNREFUSED secret-host");
      }),
    });
    expect(health).toMatchObject({
      reachable: false,
      live: false,
      ready: false,
    });
    expect(health.error).toBe("gateway_unreachable");
  });

  it("uses the canonical capability report as both the dashboard source and compatibility alias", async () => {
    const gateway = {
      featureKey: "openclaw_gateway",
      labelKey: "openclaw.capabilities.openclawGateway",
      configured: true,
      enabled: true,
      checked: true,
      status: "healthy",
      expectedState: "enabled",
      reasonCode: "runtime_verified",
      messageKey: "openclaw.capabilities.runtimeVerified",
      lastCheckedAt: "2026-07-22T00:00:00.000Z",
      latencyMs: 2,
      runtime: { serviceRegistered: true },
      warnings: [],
      safeDetails: { reachable: true, live: true, ready: true },
    };
    const healthStatus = vi
      .spyOn(OpenClawCapabilityHealthService, "getStatus")
      .mockResolvedValue({
        checkedAt: gateway.lastCheckedAt,
        healthEnabled: true,
        cacheSeconds: 30,
        timeoutMs: 10_000,
        capabilities: { openclawGateway: gateway },
      });

    try {
      const dashboard = await OpenClawDashboardService.dashboard();
      expect(dashboard.capabilities.openclawGateway).toEqual(gateway);
      expect(dashboard.capabilityHealth.capabilities).toBe(
        dashboard.capabilities,
      );
      expect(dashboard.openclaw.health).toMatchObject({
        reachable: true,
        live: true,
        ready: true,
      });
      expect(dashboard.env).not.toHaveProperty("OPENCLAW_GATEWAY_TOKEN");
      expect(healthStatus).toHaveBeenCalledOnce();
    } finally {
      healthStatus.mockRestore();
    }
  });

  it("runs Docker Daily Draft through a saved schedule without requiring a script or CLI", async () => {
    const previousMode = process.env.OPENCLAW_DEPLOYMENT_MODE;
    process.env.OPENCLAW_DEPLOYMENT_MODE = "docker";
    const scheduleId = "507f1f77bcf86cd799439011";
    const executionId = "507f1f77bcf86cd799439012";
    const blogId = "507f1f77bcf86cd799439013";
    const listSchedules = vi
      .spyOn(BlogAutomationScheduleService, "listSchedules")
      .mockResolvedValue({
        schedules: [{ id: scheduleId, name: "Daily draft", enabled: false }],
      });
    const runNow = vi
      .spyOn(BlogAutomationScheduleService, "runNow")
      .mockResolvedValue({
        queued: true,
        scheduleId,
        startedAt: new Date().toISOString(),
        message: "queued",
      });
    const listExecutions = vi
      .spyOn(BlogAutomationScheduleService, "listExecutions")
      .mockResolvedValue({
        executions: [
          {
            id: executionId,
            scheduleId,
            status: "draft_created",
            createdAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            blogId,
            blogTitle: "OPENAI_API_KEY=blog-title-canary",
            blogSlug: "credential=blog-slug-canary",
            contentAction: "new",
          },
        ],
      });
    const createRun = vi
      .spyOn(OpenClawDashboardRun, "create")
      .mockImplementation(async (payload) => payload);
    const initRun = vi
      .spyOn(OpenClawDashboardRun, "init")
      .mockResolvedValue(OpenClawDashboardRun);
    const updateManyRuns = vi
      .spyOn(OpenClawDashboardRun, "updateMany")
      .mockResolvedValue({ acknowledged: true, matchedCount: 0 });
    const findRun = vi.spyOn(OpenClawDashboardRun, "findOne").mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
    });
    const updateRun = vi
      .spyOn(OpenClawDashboardRun, "updateOne")
      .mockResolvedValue({ acknowledged: true });

    try {
      const started = await OpenClawDashboardService.startRun({
        action: "daily-draft",
        profile: "inoxpran",
        idempotencyKey: "dashboard-test-001",
        principalId: "507f1f77bcf86cd799439099",
      });
      expect(started.command).toContain("audited backend pipeline");
      expect(started.error).not.toContain("Missing script");
      await vi.waitFor(async () => {
        expect(
          await OpenClawDashboardService.getRun({ runId: started.id }),
        ).toMatchObject({
          status: "completed",
          executionId,
          blogId,
          blogTitle: expect.stringContaining("[redacted]"),
          blogSlug: expect.stringContaining("[redacted]"),
        });
      });
      expect(listSchedules).toHaveBeenCalledOnce();
      expect(runNow).toHaveBeenCalledWith({
        scheduleId,
        idempotencyKey: `dashboard:${started.id}`,
        adminId: "507f1f77bcf86cd799439099",
      });
      expect(listExecutions).toHaveBeenCalledWith({ scheduleId, limit: 20 });
      expect(JSON.stringify(updateRun.mock.calls)).not.toContain(
        "blog-title-canary",
      );
      expect(JSON.stringify(updateRun.mock.calls)).not.toContain(
        "blog-slug-canary",
      );
    } finally {
      listSchedules.mockRestore();
      runNow.mockRestore();
      listExecutions.mockRestore();
      createRun.mockRestore();
      initRun.mockRestore();
      updateManyRuns.mockRestore();
      findRun.mockRestore();
      updateRun.mockRestore();
      if (previousMode === undefined)
        delete process.env.OPENCLAW_DEPLOYMENT_MODE;
      else process.env.OPENCLAW_DEPLOYMENT_MODE = previousMode;
    }
  });

  it("queues exactly one structured Docker update request at a time", () => {
    const runtimeDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "openclaw-update-"),
    );
    const runId = randomUUID();

    try {
      const queued = queueDockerUpdateRequest({ runId, runtimeDir });
      expect(
        JSON.parse(fs.readFileSync(queued.requestFile, "utf8")),
      ).toMatchObject({
        schemaVersion: 1,
        action: "update-openclaw",
        requestId: runId,
      });
      expect(
        JSON.parse(fs.readFileSync(queued.statusFile, "utf8")),
      ).toMatchObject({
        requestId: runId,
        state: "queued",
      });
      expect(() =>
        queueDockerUpdateRequest({ runId: randomUUID(), runtimeDir }),
      ).toThrow("already queued or running");
    } finally {
      fs.rmSync(runtimeDir, { recursive: true, force: true });
    }
  });

  it("accepts exactly one Docker update enqueue across parallel OS workers", async () => {
    const runtimeDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "openclaw-update-race-"),
    );
    const servicePath = fileURLToPath(
      new URL("../src/services/openclawDashboard.service.js", import.meta.url),
    );
    const workerSource = `
            const { parentPort, workerData } = require('node:worker_threads');
            const { queueDockerUpdateRequest } = require(workerData.servicePath);
            parentPort.postMessage({ ready: true });
            parentPort.once('message', () => {
                try {
                    const result = queueDockerUpdateRequest({
                        runId: workerData.runId,
                        runtimeDir: workerData.runtimeDir
                    });
                    parentPort.postMessage({ accepted: true, runId: result.request.requestId });
                } catch (error) {
                    parentPort.postMessage({ accepted: false, message: error.message });
                }
            });
        `;
    const workers = [randomUUID(), randomUUID()].map(
      (runId) =>
        new Worker(workerSource, {
          eval: true,
          workerData: { servicePath, runtimeDir, runId },
        }),
    );
    const receive = (worker) =>
      new Promise((resolve, reject) => {
        worker.once("message", resolve);
        worker.once("error", reject);
      });

    try {
      await Promise.all(workers.map(receive));
      const results = workers.map((worker) => receive(worker));
      workers.forEach((worker) => worker.postMessage({ start: true }));
      const settled = await Promise.all(results);
      expect(settled.filter((result) => result.accepted)).toHaveLength(1);
      expect(settled.filter((result) => !result.accepted)).toHaveLength(1);
      const persisted = JSON.parse(
        fs.readFileSync(path.join(runtimeDir, "request.json"), "utf8"),
      );
      expect(persisted.requestId).toBe(
        settled.find((result) => result.accepted).runId,
      );
    } finally {
      await Promise.all(workers.map((worker) => worker.terminate()));
      fs.rmSync(runtimeDir, { recursive: true, force: true });
    }
  }, 15000);

  it("does not let a stale lock owner remove a replacement owner lock", () => {
    const runtimeDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "openclaw-update-owner-"),
    );
    const lockFile = path.join(runtimeDir, ".queue.lock");
    const displacedOwnerFile = path.join(runtimeDir, ".queue.lock.displaced");
    try {
      const displacedDescriptor = fs.openSync(displacedOwnerFile, "w");
      fs.writeFileSync(
        lockFile,
        JSON.stringify({
          schemaVersion: 1,
          lockId: "replacement-owner-lock",
          runId: "replacement-owner",
          acquiredAt: new Date().toISOString(),
        }),
      );

      releaseDockerUpdateQueueLock({
        descriptor: displacedDescriptor,
        lockFile,
        lockId: "displaced-owner-lock",
      });
      expect(JSON.parse(fs.readFileSync(lockFile, "utf8"))).toMatchObject({
        lockId: "replacement-owner-lock",
      });
    } finally {
      fs.rmSync(runtimeDir, { recursive: true, force: true });
    }
  });

  it("formats updater status without leaking provider keys", () => {
    const output = formatDockerUpdateStatus({
      message: "pull complete",
      error:
        "FIRECRAWL_API_KEY=fc-secretvalue123456 IMAGE_SEARCH_API_KEY=pexels-secret-value",
    });
    expect(output).toContain("pull complete");
    expect(output).not.toContain("fc-secretvalue123456");
    expect(output).not.toContain("pexels-secret-value");
  });
});
