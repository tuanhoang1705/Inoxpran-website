"use strict";

const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off", ""]);
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const UNSAFE_PLACEHOLDER =
  /(?:change[-_ ]?this|replace[-_ ]?me|replace[-_ ]?with|example[-_ ]?(?:secret|token|key)|your[-_ ]?(?:secret|token|key))/i;
const AUTO_MUTATION_FLAGS = Object.freeze([
  "SEO_AGENT_AUTO_PUBLISH",
  "INOXPRAN_SEO_AGENT_AUTO_PUBLISH",
  "AGENTIC_BLOG_QA_ALLOW_PUBLIC_PUBLISH",
  "OPENCLAW_BLOG_AUTO_PUBLISH",
  "CONTENT_LEARNING_AUTO_APPLY",
  "OPENCLAW_UPDATE_ENABLED",
]);

const normalizeEnvValue = (value) => String(value ?? "").trim();

const parseBooleanEnv = (value, fallback = false) => {
  const normalized = normalizeEnvValue(value).toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return fallback;
};

const isProductionEnv = (env = process.env) =>
  normalizeEnvValue(env.NODE_ENV).toLowerCase() === "production";

const loadRuntimeEnv = ({ env = process.env } = {}) => {
  if (isProductionEnv(env)) {
    return { loaded: false, source: "process_environment" };
  }

  const explicitPath = normalizeEnvValue(env.LOCAL_ENV_FILE);
  const envPath = explicitPath
    ? path.resolve(process.cwd(), explicitPath)
    : path.resolve(__dirname, "../../../.env");

  if (!fs.existsSync(envPath)) {
    return { loaded: false, source: "process_environment" };
  }

  const result = dotenv.config({
    path: envPath,
    override: false,
    processEnv: env,
    quiet: true,
  });
  if (result.error) throw result.error;
  return {
    loaded: true,
    source: explicitPath ? "LOCAL_ENV_FILE" : "repository_root_env",
  };
};

const hasConfiguredApiKey = (env = process.env) =>
  [
    "PUBLIC_API_KEY",
    "USER_API_KEY",
    "ADMIN_BFF_API_KEY",
    "OPENCLAW_INTERNAL_API_KEY",
    "API_KEY",
  ].some((key) => Boolean(normalizeEnvValue(env[key])));

const validateAbsoluteUrl = (name, value, { httpsOnly = false } = {}) => {
  const normalized = normalizeEnvValue(value);
  if (!normalized) return `${name} is required`;
  try {
    const parsed = new URL(normalized);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return `${name} must use http or https`;
    }
    if (httpsOnly && parsed.protocol !== "https:") {
      return `${name} must use https in production`;
    }
    if (parsed.username || parsed.password) {
      return `${name} must not contain credentials`;
    }
    return "";
  } catch {
    return `${name} must be an absolute URL`;
  }
};

const validateRuntimeConfig = ({ env = process.env } = {}) => {
  const errors = [];
  const production = isProductionEnv(env);

  if (!normalizeEnvValue(env.MONGODB_URI))
    errors.push("MONGODB_URI is required");
  if (!hasConfiguredApiKey(env)) {
    errors.push("At least one scoped API key is required");
  }

  for (const key of AUTO_MUTATION_FLAGS) {
    if (parseBooleanEnv(env[key], false)) {
      errors.push(`${key} must remain false at process startup`);
    }
  }

  if (production) {
    if (normalizeEnvValue(env.OPENCLAW_NO_AUTO_UPDATE) !== "1") {
      errors.push("OPENCLAW_NO_AUTO_UPDATE must equal 1 in production");
    }
    for (const scopedKey of [
      "PUBLIC_API_KEY",
      "USER_API_KEY",
      "ADMIN_BFF_API_KEY",
      "OPENCLAW_INTERNAL_API_KEY",
    ]) {
      const value = normalizeEnvValue(env[scopedKey]);
      if (!value) errors.push(`${scopedKey} is required in production`);
      else if (value.length < 32) {
        errors.push(
          `${scopedKey} must contain at least 32 characters in production`,
        );
      }
    }
    const scopedApiKeyValues = [
      "PUBLIC_API_KEY",
      "USER_API_KEY",
      "ADMIN_BFF_API_KEY",
      "OPENCLAW_INTERNAL_API_KEY",
    ].map((name) => normalizeEnvValue(env[name]));
    if (
      scopedApiKeyValues.every(Boolean) &&
      new Set(scopedApiKeyValues).size !== scopedApiKeyValues.length
    ) {
      errors.push("Production scoped API keys must use four distinct values");
    }
    for (const [name, httpsOnly] of [
      ["APP_BASE_URL", true],
      ["API_BASE_URL", false],
      ["PUBLIC_SITE_URL", true],
      ["ADMIN_BASE_URL", true],
    ]) {
      const urlError = validateAbsoluteUrl(name, env[name], { httpsOnly });
      if (urlError) errors.push(urlError);
    }
    if (!normalizeEnvValue(env.CORS_ORIGIN)) {
      errors.push("CORS_ORIGIN is required in production");
    } else {
      for (const rawOrigin of normalizeEnvValue(env.CORS_ORIGIN).split(",")) {
        const originError = validateAbsoluteUrl(
          "CORS_ORIGIN",
          rawOrigin.trim(),
          { httpsOnly: true },
        );
        if (originError) errors.push(originError);
        else {
          const parsed = new URL(rawOrigin.trim());
          if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
            errors.push(
              "CORS_ORIGIN entries must be origins without path, query, or fragment",
            );
          }
        }
      }
    }
    if (normalizeEnvValue(env.JWT_SECRET).length < 32) {
      errors.push(
        "JWT_SECRET must contain at least 32 characters in production",
      );
    }
    if (parseBooleanEnv(env.MONGOOSE_AUTO_INDEX, false)) {
      errors.push("MONGOOSE_AUTO_INDEX must remain false in production");
    }

    const blogPipelineEnabled =
      parseBooleanEnv(env.OPENCLAW_TOPIC_ROADMAP_ENABLED, true) ||
      parseBooleanEnv(env.OPENCLAW_BLOG_CRON_ENABLED, false);
    if (blogPipelineEnabled) {
      for (const requiredName of [
        "OPENAI_API_KEY",
        "OPENCLAW_GATEWAY_HTTP_URL",
        "OPENCLAW_GATEWAY_TOKEN",
      ]) {
        if (!normalizeEnvValue(env[requiredName])) {
          errors.push(
            `${requiredName} is required when the blog pipeline is enabled`,
          );
        }
      }
      const gatewayToken = normalizeEnvValue(env.OPENCLAW_GATEWAY_TOKEN);
      if (gatewayToken && gatewayToken.length < 32) {
        errors.push(
          "OPENCLAW_GATEWAY_TOKEN must contain at least 32 characters",
        );
      }

      const gatewayUrlError = validateAbsoluteUrl(
        "OPENCLAW_GATEWAY_HTTP_URL",
        env.OPENCLAW_GATEWAY_HTTP_URL,
      );
      if (gatewayUrlError) errors.push(gatewayUrlError);

      for (const modelName of [
        "OPENAI_WRITER_MODEL",
        "OPENAI_IDEATION_MODEL",
      ]) {
        const model = normalizeEnvValue(env[modelName]);
        if (!model)
          errors.push(
            `${modelName} is required when the blog pipeline is enabled`,
          );
        else if (!MODEL_ID.test(model))
          errors.push(`${modelName} is not a valid model identifier`);
      }

      const allowedModels = normalizeEnvValue(
        env.OPENCLAW_TOPIC_ALLOWED_RESOLVED_MODELS,
      )
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
      if (!allowedModels.length) {
        errors.push(
          "OPENCLAW_TOPIC_ALLOWED_RESOLVED_MODELS is required when the blog pipeline is enabled",
        );
      } else if (allowedModels.some((model) => !MODEL_ID.test(model))) {
        errors.push(
          "OPENCLAW_TOPIC_ALLOWED_RESOLVED_MODELS contains an invalid model identifier",
        );
      }

      const expectedResolvedModel = normalizeEnvValue(
        env.OPENCLAW_TOPIC_EXPECTED_RESOLVED_MODEL,
      );
      if (!expectedResolvedModel) {
        errors.push(
          "OPENCLAW_TOPIC_EXPECTED_RESOLVED_MODEL is required when the blog pipeline is enabled",
        );
      } else if (!MODEL_ID.test(expectedResolvedModel)) {
        errors.push(
          "OPENCLAW_TOPIC_EXPECTED_RESOLVED_MODEL is not a valid model identifier",
        );
      } else if (
        allowedModels.length &&
        !allowedModels.includes(expectedResolvedModel)
      ) {
        errors.push(
          "OPENCLAW_TOPIC_EXPECTED_RESOLVED_MODEL must be present in OPENCLAW_TOPIC_ALLOWED_RESOLVED_MODELS",
        );
      }
    }

    const marketSearchProvider = normalizeEnvValue(
      env.OPENCLAW_MARKET_SEARCH_PROVIDER || "disabled",
    ).toLowerCase();
    if (!["disabled", "firecrawl"].includes(marketSearchProvider)) {
      errors.push(
        "OPENCLAW_MARKET_SEARCH_PROVIDER must equal disabled or firecrawl",
      );
    } else if (
      marketSearchProvider === "firecrawl" &&
      !normalizeEnvValue(env.FIRECRAWL_API_KEY)
    ) {
      errors.push(
        "FIRECRAWL_API_KEY is required when OPENCLAW_MARKET_SEARCH_PROVIDER is firecrawl",
      );
    }

    if (parseBooleanEnv(env.SEO_AGENT_ENABLED, false)) {
      for (const requiredName of [
        "SEO_AGENT_API_KEY",
        "SEO_AGENT_HMAC_SECRET",
      ]) {
        if (!normalizeEnvValue(env[requiredName])) {
          errors.push(
            `${requiredName} is required when SEO_AGENT_ENABLED is true`,
          );
        }
      }
      const seoHmacSecret = normalizeEnvValue(env.SEO_AGENT_HMAC_SECRET);
      const seoApiKey = normalizeEnvValue(env.SEO_AGENT_API_KEY);
      if (seoApiKey && seoApiKey.length < 32) {
        errors.push("SEO_AGENT_API_KEY must contain at least 32 characters");
      }
      if (seoHmacSecret && seoHmacSecret.length < 32) {
        errors.push(
          "SEO_AGENT_HMAC_SECRET must contain at least 32 characters",
        );
      }
    }

    if (parseBooleanEnv(env.CONTENT_OPERATIONS_ENABLED, false)) {
      const auditHmacSecret = normalizeEnvValue(
        env.CONTENT_OPERATIONS_AUDIT_HMAC_SECRET,
      );
      if (!auditHmacSecret) {
        errors.push(
          "CONTENT_OPERATIONS_AUDIT_HMAC_SECRET is required when CONTENT_OPERATIONS_ENABLED is true",
        );
      } else if (auditHmacSecret.length < 32) {
        errors.push(
          "CONTENT_OPERATIONS_AUDIT_HMAC_SECRET must contain at least 32 characters",
        );
      }
    }
    const redisRequired = parseBooleanEnv(env.REDIS_REQUIRED, true);
    if (!redisRequired) {
      errors.push("REDIS_REQUIRED must remain true in production");
    }
    if (
      normalizeEnvValue(env.REDIS_ENABLED) &&
      !parseBooleanEnv(env.REDIS_ENABLED, false)
    ) {
      errors.push("REDIS_ENABLED must remain true in production");
    }
    if (redisRequired) {
      const redisPassword = normalizeEnvValue(env.REDIS_PASSWORD);
      if (!redisPassword) {
        errors.push(
          "REDIS_PASSWORD is required when Redis is required in production",
        );
      } else if (redisPassword.length < 24) {
        errors.push(
          "REDIS_PASSWORD must contain at least 24 characters in production",
        );
      }
    }
    if (redisRequired) {
      const redisUrl = normalizeEnvValue(env.REDIS_URL);
      const encrypted = redisUrl
        ? /^rediss:\/\//i.test(redisUrl)
        : parseBooleanEnv(env.REDIS_TLS, false);
      if (!encrypted)
        errors.push("Redis transport encryption is required in production");
    }

    if (parseBooleanEnv(env.TELEGRAM_BOT_ENABLED, false)) {
      if (!normalizeEnvValue(env.TELEGRAM_BOT_TOKEN)) {
        errors.push("TELEGRAM_BOT_TOKEN is required when Telegram is enabled");
      }
      if (
        !normalizeEnvValue(env.TELEGRAM_ALLOWED_CHAT_IDS) &&
        !normalizeEnvValue(env.TELEGRAM_ALLOWED_USER_IDS)
      ) {
        errors.push(
          "A Telegram chat or user allowlist is required when Telegram is enabled",
        );
      }
      if (
        !normalizeEnvValue(env.TELEGRAM_NOTIFY_CHAT_IDS) &&
        !normalizeEnvValue(env.TELEGRAM_ALLOWED_CHAT_IDS)
      ) {
        errors.push(
          "A Telegram notification chat is required when Telegram is enabled",
        );
      }
      const telegramMode = normalizeEnvValue(
        env.TELEGRAM_MODE || "webhook",
      ).toLowerCase();
      if (telegramMode !== "webhook") {
        errors.push("TELEGRAM_MODE must equal webhook in production");
      }
      const webhookSecret = normalizeEnvValue(env.TELEGRAM_WEBHOOK_SECRET);
      if (!webhookSecret) {
        errors.push(
          "TELEGRAM_WEBHOOK_SECRET is required when Telegram is enabled",
        );
      } else if (webhookSecret.length < 32) {
        errors.push(
          "TELEGRAM_WEBHOOK_SECRET must contain at least 32 characters",
        );
      }
    }

    if (parseBooleanEnv(env.OPENCLAW_IMAGE_PIPELINE_ENABLED, false)) {
      const searchProvider = normalizeEnvValue(
        env.IMAGE_SEARCH_PROVIDER,
      ).toLowerCase();
      const aiProvider = normalizeEnvValue(env.AI_IMAGE_PROVIDER).toLowerCase();
      const searchConfigured =
        Boolean(searchProvider && searchProvider !== "disabled") &&
        Boolean(normalizeEnvValue(env.IMAGE_SEARCH_API_KEY));
      const aiConfigured =
        Boolean(aiProvider && aiProvider !== "disabled") &&
        Boolean(
          normalizeEnvValue(env.AI_IMAGE_API_KEY) ||
          normalizeEnvValue(env.OPENAI_API_KEY),
        );
      if (!searchConfigured && !aiConfigured) {
        errors.push(
          "An image search or AI image provider credential is required when the image pipeline is enabled",
        );
      }
    }

    for (const legacyName of [
      "API_KEY",
      "ADMIN_API_KEY",
      "INTERNAL_API_KEY",
      "FRONTEND_API_KEY",
      "OPENCLAW_BACKEND_API_KEY",
    ]) {
      if (normalizeEnvValue(env[legacyName])) {
        errors.push(
          `${legacyName} is legacy-only and is rejected in production`,
        );
      }
    }

    const secretNames = [
      "API_KEY",
      "PUBLIC_API_KEY",
      "USER_API_KEY",
      "ADMIN_BFF_API_KEY",
      "OPENCLAW_INTERNAL_API_KEY",
      "JWT_SECRET",
      "FRONTEND_API_KEY",
      "OPENCLAW_BACKEND_API_KEY",
      "REDIS_PASSWORD",
      "N8N_ENCRYPTION_KEY",
      "OPENCLAW_GATEWAY_TOKEN",
      "OPENAI_API_KEY",
      "SEO_AGENT_API_KEY",
      "SEO_AGENT_HMAC_SECRET",
      "CONTENT_OPERATIONS_AUDIT_HMAC_SECRET",
      "TELEGRAM_BOT_TOKEN",
      "TELEGRAM_WEBHOOK_SECRET",
      "IMAGE_SEARCH_API_KEY",
      "AI_IMAGE_API_KEY",
      "FIRECRAWL_API_KEY",
    ];
    for (const key of secretNames) {
      const value = normalizeEnvValue(env[key]);
      if (value && UNSAFE_PLACEHOLDER.test(value)) {
        errors.push(`${key} contains an unsafe placeholder`);
      }
    }
  }

  if (errors.length) {
    const error = new Error(
      `Runtime configuration rejected (${errors.join("; ")})`,
    );
    error.code = "RUNTIME_CONFIG_INVALID";
    error.details = errors;
    throw error;
  }

  return {
    production,
    redisRequired: parseBooleanEnv(env.REDIS_REQUIRED, production),
  };
};

module.exports = {
  AUTO_MUTATION_FLAGS,
  hasConfiguredApiKey,
  isProductionEnv,
  loadRuntimeEnv,
  normalizeEnvValue,
  parseBooleanEnv,
  validateAbsoluteUrl,
  validateRuntimeConfig,
};
