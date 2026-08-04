import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  loadRuntimeEnv,
  validateRuntimeConfig,
} = require("../src/config/runtimeEnv");
const {
  buildCorsOptions,
  normalizeOrigin,
  resolveTrustProxy,
} = require("../src/config/httpSecurity");
const {
  getConfiguredApiKeyDefinitions,
} = require("../src/helpers/bootstrapApiKey");
const {
  requestContext,
  safeRequestId,
} = require("../src/middleware/requestContext");
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const productionEnv = (overrides = {}) => ({
  NODE_ENV: "production",
  MONGODB_URI: "mongodb://database.invalid/app",
  APP_BASE_URL: "https://inoxpran.com",
  API_BASE_URL: "http://backend:3056/v1/api",
  PUBLIC_SITE_URL: "https://inoxpran.com",
  ADMIN_BASE_URL: "https://admin.inoxpran.com",
  PUBLIC_API_KEY: "public-api-key-for-test-only-000000000001",
  USER_API_KEY: "user-api-key-for-test-only-00000000000002",
  ADMIN_BFF_API_KEY: "admin-bff-key-for-test-only-000000000003",
  OPENCLAW_INTERNAL_API_KEY: "openclaw-key-for-test-only-0000000000004",
  CORS_ORIGIN: "https://inoxpran.com",
  JWT_SECRET: "jwt-secret-for-test-only-32-characters",
  REDIS_REQUIRED: "true",
  REDIS_PASSWORD: "redis-password-for-test-only-0000",
  REDIS_TLS: "true",
  OPENCLAW_TOPIC_ROADMAP_ENABLED: "true",
  OPENAI_API_KEY: "openai-key-for-test-only",
  OPENAI_WRITER_MODEL: "writer-model-test",
  OPENAI_IDEATION_MODEL: "ideation-model-test",
  OPENCLAW_TOPIC_ALLOWED_RESOLVED_MODELS:
    "writer-model-test,ideation-model-test",
  OPENCLAW_TOPIC_EXPECTED_RESOLVED_MODEL: "writer-model-test",
  OPENCLAW_MARKET_SEARCH_PROVIDER: "disabled",
  OPENCLAW_GATEWAY_HTTP_URL: "http://openclaw:18789",
  OPENCLAW_GATEWAY_TOKEN: "openclaw-gateway-token-for-test-only-0000",
  SEO_AGENT_AUTO_PUBLISH: "false",
  INOXPRAN_SEO_AGENT_AUTO_PUBLISH: "false",
  AGENTIC_BLOG_QA_ALLOW_PUBLIC_PUBLISH: "false",
  CONTENT_LEARNING_AUTO_APPLY: "false",
  OPENCLAW_UPDATE_ENABLED: "false",
  OPENCLAW_NO_AUTO_UPDATE: "1",
  ...overrides,
});

describe("runtime production safety", () => {
  it("does not load dotenv in production", () => {
    expect(loadRuntimeEnv({ env: productionEnv() })).toEqual({
      loaded: false,
      source: "process_environment",
    });
  });

  it("rejects auto-publish, auto-apply and update flags", () => {
    for (const key of [
      "SEO_AGENT_AUTO_PUBLISH",
      "INOXPRAN_SEO_AGENT_AUTO_PUBLISH",
      "AGENTIC_BLOG_QA_ALLOW_PUBLIC_PUBLISH",
      "OPENCLAW_BLOG_AUTO_PUBLISH",
      "CONTENT_LEARNING_AUTO_APPLY",
      "OPENCLAW_UPDATE_ENABLED",
    ]) {
      expect(() =>
        validateRuntimeConfig({
          env: productionEnv({ [key]: "true" }),
        }),
      ).toThrow(key);
    }
  });

  it("hard-disables the simple-schedule publish opt-in across release surfaces", () => {
    const deployScript = fs.readFileSync(
      path.join(repositoryRoot, "deploy/scripts/deploy.sh"),
      "utf8",
    );
    const compose = fs.readFileSync(
      path.join(repositoryRoot, "docker-compose.yml"),
      "utf8",
    );
    const exampleEnv = fs.readFileSync(
      path.join(repositoryRoot, ".env.example"),
      "utf8",
    );
    expect(deployScript).toMatch(
      /for protected_flag in[\s\S]*OPENCLAW_BLOG_AUTO_PUBLISH[\s\S]*do/,
    );
    expect(compose).toMatch(/OPENCLAW_BLOG_AUTO_PUBLISH:\s*"false"/);
    expect(exampleEnv).toMatch(/^OPENCLAW_BLOG_AUTO_PUBLISH=false$/m);
  });

  it("plumbs fail-closed model identity and opt-in evidence search through release surfaces", () => {
    const deployScript = fs.readFileSync(
      path.join(repositoryRoot, "deploy/scripts/deploy.sh"),
      "utf8",
    );
    const compose = fs.readFileSync(
      path.join(repositoryRoot, "docker-compose.yml"),
      "utf8",
    );
    const exampleEnv = fs.readFileSync(
      path.join(repositoryRoot, ".env.example"),
      "utf8",
    );
    const openclawConfig = fs.readFileSync(
      path.join(repositoryRoot, "deploy/openclaw/openclaw.json5"),
      "utf8",
    );
    const patcher = fs.readFileSync(
      path.join(
        repositoryRoot,
        "deploy/openclaw/patches/patch-openresponses-provider-model.mjs",
      ),
      "utf8",
    );

    expect(compose).toMatch(
      /OPENCLAW_TOPIC_EXPECTED_RESOLVED_MODEL:\s*\$\{OPENCLAW_TOPIC_EXPECTED_RESOLVED_MODEL:\?/,
    );
    expect(compose).toMatch(
      /NINE_ROUTER_API_KEY:\s*\$\{NINE_ROUTER_API_KEY:\?/,
    );
    expect(compose).toMatch(/FIRECRAWL_API_KEY:\s*\$\{FIRECRAWL_API_KEY:-\}/);
    expect(deployScript).toContain(
      "OPENCLAW_TOPIC_EXPECTED_RESOLVED_MODEL must be present in OPENCLAW_TOPIC_ALLOWED_RESOLVED_MODELS",
    );
    expect(deployScript).toContain("firecrawl) require_config FIRECRAWL_API_KEY");
    expect(deployScript).toContain("--verify-patched");
    expect(deployScript).toContain("OPENCLAW_PACKAGE_ROOT");
    expect(exampleEnv).toMatch(
      /^OPENCLAW_TOPIC_EXPECTED_RESOLVED_MODEL=$/m,
    );
    expect(exampleEnv).toMatch(/^OPENCLAW_PACKAGE_ROOT=$/m);
    expect(exampleEnv).toMatch(/^OPENCLAW_MARKET_SEARCH_PROVIDER=disabled$/m);
    expect(openclawConfig).toContain(
      'primary: "${OPENCLAW_TOPIC_EXPECTED_RESOLVED_MODEL}"',
    );
    expect(openclawConfig).toContain('baseUrl: "http://nine-router:20128/v1"');
    expect(openclawConfig).toContain('apiKey: "${NINE_ROUTER_API_KEY}"');
    expect(openclawConfig).toContain('id: "cx/gpt-5.6-sol"');
    expect(openclawConfig).toMatch(/fallbacks:\s*\[\]/);
    expect(patcher).toContain("version: '2026.6.11'");
    expect(patcher).toContain("provider_model: params.providerModel");
  });

  it("rejects production auto-index and missing Redis credentials", () => {
    expect(() =>
      validateRuntimeConfig({
        env: productionEnv({ MONGOOSE_AUTO_INDEX: "true" }),
      }),
    ).toThrow("MONGOOSE_AUTO_INDEX");
    expect(() =>
      validateRuntimeConfig({
        env: productionEnv({ REDIS_PASSWORD: "" }),
      }),
    ).toThrow("REDIS_PASSWORD");
    expect(() =>
      validateRuntimeConfig({
        env: productionEnv({ REDIS_TLS: "false" }),
      }),
    ).toThrow("transport encryption");
    expect(() =>
      validateRuntimeConfig({
        env: productionEnv({ REDIS_REQUIRED: "false" }),
      }),
    ).toThrow("REDIS_REQUIRED must remain true");
    expect(() =>
      validateRuntimeConfig({
        env: productionEnv({ REDIS_ENABLED: "false" }),
      }),
    ).toThrow("REDIS_ENABLED must remain true");
  });

  it("requires canonical URLs and rejects legacy production API keys", () => {
    expect(() =>
      validateRuntimeConfig({
        env: productionEnv({ ADMIN_BASE_URL: "" }),
      }),
    ).toThrow("ADMIN_BASE_URL");
    expect(() =>
      validateRuntimeConfig({
        env: productionEnv({ API_KEY: "legacy-key" }),
      }),
    ).toThrow("legacy-only");
    expect(() =>
      validateRuntimeConfig({
        env: productionEnv({ OPENCLAW_NO_AUTO_UPDATE: "0" }),
      }),
    ).toThrow("OPENCLAW_NO_AUTO_UPDATE");
    expect(() =>
      validateRuntimeConfig({
        env: productionEnv({ CORS_ORIGIN: "http://inoxpran.com" }),
      }),
    ).toThrow("must use https");
    expect(() =>
      validateRuntimeConfig({
        env: productionEnv({ CORS_ORIGIN: "https://inoxpran.com/admin" }),
      }),
    ).toThrow("without path");
  });

  it("requires strong, distinct caller-scoped keys before connecting to MongoDB", () => {
    expect(() =>
      validateRuntimeConfig({
        env: productionEnv({ PUBLIC_API_KEY: "too-short" }),
      }),
    ).toThrow("PUBLIC_API_KEY must contain at least 32 characters");
    expect(() =>
      validateRuntimeConfig({
        env: productionEnv({
          USER_API_KEY: productionEnv().PUBLIC_API_KEY,
        }),
      }),
    ).toThrow("must use four distinct values");
    expect(() =>
      validateRuntimeConfig({
        env: productionEnv({ REDIS_PASSWORD: "too-short" }),
      }),
    ).toThrow("REDIS_PASSWORD must contain at least 24 characters");
  });

  it("requires explicit valid blog models and a pinned allowlisted resolved model", () => {
    expect(() =>
      validateRuntimeConfig({
        env: productionEnv({ OPENAI_API_KEY: "" }),
      }),
    ).toThrow("OPENAI_API_KEY");
    expect(() =>
      validateRuntimeConfig({
        env: productionEnv({ OPENCLAW_GATEWAY_TOKEN: "" }),
      }),
    ).toThrow("OPENCLAW_GATEWAY_TOKEN");
    expect(() =>
      validateRuntimeConfig({
        env: productionEnv({ OPENCLAW_GATEWAY_TOKEN: "too-short" }),
      }),
    ).toThrow("OPENCLAW_GATEWAY_TOKEN must contain at least 32 characters");
    expect(() =>
      validateRuntimeConfig({
        env: productionEnv({ OPENCLAW_GATEWAY_HTTP_URL: "not-a-url" }),
      }),
    ).toThrow("OPENCLAW_GATEWAY_HTTP_URL");
    expect(() =>
      validateRuntimeConfig({
        env: productionEnv({ OPENAI_WRITER_MODEL: "" }),
      }),
    ).toThrow("OPENAI_WRITER_MODEL");
    expect(() =>
      validateRuntimeConfig({
        env: productionEnv({ OPENAI_IDEATION_MODEL: "model with spaces" }),
      }),
    ).toThrow("OPENAI_IDEATION_MODEL");
    expect(() =>
      validateRuntimeConfig({
        env: productionEnv({ OPENCLAW_TOPIC_ALLOWED_RESOLVED_MODELS: "" }),
      }),
    ).toThrow("OPENCLAW_TOPIC_ALLOWED_RESOLVED_MODELS");
    expect(() =>
      validateRuntimeConfig({
        env: productionEnv({ OPENCLAW_TOPIC_EXPECTED_RESOLVED_MODEL: "" }),
      }),
    ).toThrow("OPENCLAW_TOPIC_EXPECTED_RESOLVED_MODEL");
    expect(() =>
      validateRuntimeConfig({
        env: productionEnv({
          OPENCLAW_TOPIC_EXPECTED_RESOLVED_MODEL: "unreviewed-model",
        }),
      }),
    ).toThrow("must be present in OPENCLAW_TOPIC_ALLOWED_RESOLVED_MODELS");

    expect(() =>
      validateRuntimeConfig({
        env: productionEnv({
          OPENCLAW_TOPIC_ROADMAP_ENABLED: "false",
          OPENCLAW_BLOG_CRON_ENABLED: "false",
          OPENAI_API_KEY: "",
          OPENAI_WRITER_MODEL: "",
          OPENAI_IDEATION_MODEL: "",
          OPENCLAW_TOPIC_ALLOWED_RESOLVED_MODELS: "",
          OPENCLAW_TOPIC_EXPECTED_RESOLVED_MODEL: "",
          OPENCLAW_GATEWAY_HTTP_URL: "",
          OPENCLAW_GATEWAY_TOKEN: "",
        }),
      }),
    ).not.toThrow();
  });

  it("requires Firecrawl credentials only when query-directed search is enabled", () => {
    expect(() =>
      validateRuntimeConfig({
        env: productionEnv({
          OPENCLAW_MARKET_SEARCH_PROVIDER: "firecrawl",
          FIRECRAWL_API_KEY: "",
        }),
      }),
    ).toThrow("FIRECRAWL_API_KEY");
    expect(() =>
      validateRuntimeConfig({
        env: productionEnv({
          OPENCLAW_MARKET_SEARCH_PROVIDER: "firecrawl",
          FIRECRAWL_API_KEY: "firecrawl-key-for-test-only",
        }),
      }),
    ).not.toThrow();
    expect(() =>
      validateRuntimeConfig({
        env: productionEnv({
          OPENCLAW_MARKET_SEARCH_PROVIDER: "disabled",
          FIRECRAWL_API_KEY: "",
        }),
      }),
    ).not.toThrow();
    expect(() =>
      validateRuntimeConfig({
        env: productionEnv({ OPENCLAW_MARKET_SEARCH_PROVIDER: "unknown" }),
      }),
    ).toThrow("OPENCLAW_MARKET_SEARCH_PROVIDER");
  });

  it("requires feature-specific audit and SEO credentials only when enabled", () => {
    expect(() =>
      validateRuntimeConfig({
        env: productionEnv({ SEO_AGENT_ENABLED: "true" }),
      }),
    ).toThrow("SEO_AGENT_API_KEY");
    expect(() =>
      validateRuntimeConfig({
        env: productionEnv({
          SEO_AGENT_ENABLED: "true",
          SEO_AGENT_API_KEY: "seo-agent-key-for-test-only-0000000000",
        }),
      }),
    ).toThrow("SEO_AGENT_HMAC_SECRET");
    expect(() =>
      validateRuntimeConfig({
        env: productionEnv({ CONTENT_OPERATIONS_ENABLED: "true" }),
      }),
    ).toThrow("CONTENT_OPERATIONS_AUDIT_HMAC_SECRET");
    expect(() =>
      validateRuntimeConfig({
        env: productionEnv({
          SEO_AGENT_ENABLED: "true",
          SEO_AGENT_API_KEY: "seo-agent-key-for-test-only-0000000000",
          SEO_AGENT_HMAC_SECRET: "seo-agent-hmac-for-test-only-00000000",
          CONTENT_OPERATIONS_ENABLED: "true",
          CONTENT_OPERATIONS_AUDIT_HMAC_SECRET:
            "content-audit-hmac-for-test-only-00000000",
        }),
      }),
    ).not.toThrow();
  });

  it("fails startup when an enabled Telegram or image capability is not configured", () => {
    expect(() =>
      validateRuntimeConfig({
        env: productionEnv({ TELEGRAM_BOT_ENABLED: "true" }),
      }),
    ).toThrow("TELEGRAM_BOT_TOKEN");
    expect(() =>
      validateRuntimeConfig({
        env: productionEnv({
          TELEGRAM_BOT_ENABLED: "true",
          TELEGRAM_BOT_TOKEN: "telegram-token-for-test-only",
          TELEGRAM_ALLOWED_CHAT_IDS: "100",
          TELEGRAM_ALLOWED_USER_IDS: "900",
          TELEGRAM_NOTIFY_CHAT_IDS: "100",
          TELEGRAM_MODE: "polling",
          TELEGRAM_WEBHOOK_SECRET: "telegram-webhook-for-test-only-000000",
        }),
      }),
    ).toThrow("TELEGRAM_MODE must equal webhook");
    expect(() =>
      validateRuntimeConfig({
        env: productionEnv({
          TELEGRAM_BOT_ENABLED: "true",
          TELEGRAM_BOT_TOKEN: "telegram-token-for-test-only",
          TELEGRAM_ALLOWED_CHAT_IDS: "100",
          TELEGRAM_ALLOWED_USER_IDS: "900",
          TELEGRAM_NOTIFY_CHAT_IDS: "100",
          TELEGRAM_MODE: "webhook",
          TELEGRAM_WEBHOOK_SECRET: "telegram-webhook-for-test-only-000000",
        }),
      }),
    ).not.toThrow();

    expect(() =>
      validateRuntimeConfig({
        env: productionEnv({
          OPENCLAW_IMAGE_PIPELINE_ENABLED: "true",
          IMAGE_SEARCH_PROVIDER: "disabled",
          AI_IMAGE_PROVIDER: "disabled",
        }),
      }),
    ).toThrow("provider credential is required");
    expect(() =>
      validateRuntimeConfig({
        env: productionEnv({
          OPENCLAW_IMAGE_PIPELINE_ENABLED: "true",
          IMAGE_SEARCH_PROVIDER: "pexels",
          IMAGE_SEARCH_API_KEY: "image-search-key-for-test-only",
        }),
      }),
    ).not.toThrow();
  });
});

describe("HTTP boundary configuration", () => {
  it("accepts exact origins and rejects paths or credentials", () => {
    expect(normalizeOrigin("https://inoxpran.com")).toBe(
      "https://inoxpran.com",
    );
    expect(() => normalizeOrigin("https://inoxpran.com/admin")).toThrow();
    expect(() => normalizeOrigin("https://user:pass@inoxpran.com")).toThrow();
    expect(() =>
      buildCorsOptions({
        NODE_ENV: "production",
        CORS_ORIGIN: "http://inoxpran.com",
      }),
    ).toThrow("must use https");
  });

  it("uses a bounded numeric trust proxy setting", () => {
    expect(
      resolveTrustProxy({ NODE_ENV: "production", TRUST_PROXY_HOPS: "1" }),
    ).toBe(1);
    expect(() => resolveTrustProxy({ TRUST_PROXY_HOPS: "true" })).toThrow();
  });

  it("denies an unlisted browser origin", async () => {
    const options = buildCorsOptions({
      NODE_ENV: "production",
      CORS_ORIGIN: "https://inoxpran.com",
    });
    await expect(
      new Promise((resolve, reject) => {
        options.origin("https://attacker.invalid", (error, allowed) => {
          if (error) reject(error);
          else resolve(allowed);
        });
      }),
    ).rejects.toMatchObject({ code: "CORS_ORIGIN_DENIED", statusCode: 403 });
  });
});

describe("request identity and scoped API keys", () => {
  it("preserves only a safe upstream request ID", () => {
    expect(safeRequestId("edge:request-123")).toBe("edge:request-123");
    expect(safeRequestId("bad id\nvalue")).toBe("");

    const headers = {};
    const req = { get: () => "edge-request-1" };
    const res = {
      set: (name, value) => {
        headers[name] = value;
      },
    };
    let called = false;
    requestContext(req, res, () => {
      called = true;
    });
    expect(called).toBe(true);
    expect(req.requestId).toBe("edge-request-1");
    expect(headers["X-Request-Id"]).toBe("edge-request-1");
  });

  it("builds least-privilege keys and detects scope collisions", () => {
    expect(
      getConfiguredApiKeyDefinitions({
        PUBLIC_API_KEY: "public",
        USER_API_KEY: "user",
        ADMIN_BFF_API_KEY: "admin-bff",
        OPENCLAW_INTERNAL_API_KEY: "openclaw",
      }).map(({ envName, permissions }) => ({ envName, permissions })),
    ).toEqual([
      { envName: "PUBLIC_API_KEY", permissions: ["PUBLIC"] },
      { envName: "USER_API_KEY", permissions: ["USER"] },
      { envName: "ADMIN_BFF_API_KEY", permissions: ["ADMIN"] },
      { envName: "OPENCLAW_INTERNAL_API_KEY", permissions: ["ADMIN_SYSTEM"] },
    ]);

    expect(() =>
      getConfiguredApiKeyDefinitions({
        PUBLIC_API_KEY: "same-key",
        OPENCLAW_INTERNAL_API_KEY: "same-key",
      }),
    ).toThrow("scoped keys must be distinct");
  });
});
