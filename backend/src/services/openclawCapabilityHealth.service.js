'use strict';

const mongoose = require('mongoose');
const { BadRequestError } = require('../core/error.response');
const { TelegramApprovalService } = require('./telegramApproval.service');
const { getBlogAutomationSchedulerRuntime } = require('./blogAutomationScheduler.runtime');
const { getContentOperationsConfig } = require('../config/contentOperations.config');
const { isProductionEnv } = require('../config/runtimeEnv');
const { BlogAutomationSchedule } = require('../models/blogAutomationSchedule.model');
const {
    BlogAutomationExecution,
    BlogAutomationWorkerHeartbeat
} = require('../models/blogAutomationExecution.model');
const { ContentOperationsDailySnapshot } = require('../models/contentOperationsDailySnapshot.model');
const { ContentOperationsSchedule } = require('../models/contentOperationsSchedule.model');
const { ContentOperationsRun } = require('../models/contentOperationsRun.model');
const { GoogleIntelligenceSnapshot } = require('../models/googleIntelligenceSnapshot.model');
const { GoogleIntelligenceSchedule } = require('../models/googleIntelligenceSchedule.model');
const { GoogleIntelligenceRun } = require('../models/googleIntelligenceRun.model');
const { ContentInventorySnapshot } = require('../models/contentInventorySnapshot.model');
const { ContentSignal } = require('../models/contentSignal.model');
const { ContentPerformanceSnapshot } = require('../models/contentPerformanceSnapshot.model');
const { ContentLearningRecord } = require('../models/contentLearningRecord.model');
const { blog: Blog } = require('../models/blog.model');

const DEFAULT_CACHE_MS = 30 * 1000;
const DEFAULT_TIMEOUT_MS = 10 * 1000;
const BLOG_WORKER_HEARTBEAT_ID = '0000000000000000000000b1';
const MAX_SAFE_DEPTH = 5;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const BLOG_SUCCESSFUL_EXECUTION_STATUSES = Object.freeze(['draft_created', 'maintenance_created', 'published', 'completed', 'skipped']);

const CAPABILITY_STATUSES = Object.freeze(['disabled', 'expected_disabled', 'missing_config', 'pending_check', 'healthy', 'degraded', 'failed', 'unavailable', 'manual_review', 'not_applicable']);
const CAPABILITY_STATUS_SET = new Set(CAPABILITY_STATUSES);

const CAPABILITY_META = Object.freeze({
    seoAgent: {
        featureKey: 'seo_agent',
        labelKey: 'openclaw.capabilities.seoAgent'
    },
    contentOperations: {
        featureKey: 'content_operations',
        labelKey: 'openclaw.capabilities.contentOperations'
    },
    blogCron: {
        featureKey: 'blog_cron',
        labelKey: 'openclaw.capabilities.blogCron',
        expectedDisabled: true
    },
    contentOperationsCron: {
        featureKey: 'content_operations_cron',
        labelKey: 'openclaw.capabilities.contentOperationsCron',
        expectedDisabled: true
    },
    googleIntelligence: {
        featureKey: 'google_intelligence',
        labelKey: 'openclaw.capabilities.googleIntelligence'
    },
    searchConsole: {
        featureKey: 'search_console',
        labelKey: 'openclaw.capabilities.searchConsole'
    },
    aggregateAnalytics: {
        featureKey: 'content_analytics',
        labelKey: 'openclaw.capabilities.aggregateAnalytics'
    },
    trends: {
        featureKey: 'market_trends',
        labelKey: 'openclaw.capabilities.trends'
    },
    inventory: {
        featureKey: 'content_inventory',
        labelKey: 'openclaw.capabilities.inventory'
    },
    contentSignals: {
        featureKey: 'content_signals',
        labelKey: 'openclaw.capabilities.contentSignals',
        expectedDisabled: true
    },
    performanceMonitoring: {
        featureKey: 'content_performance_monitoring',
        labelKey: 'openclaw.capabilities.performanceMonitoring',
        expectedDisabled: true
    },
    learning: {
        featureKey: 'content_learning',
        labelKey: 'openclaw.capabilities.learning',
        expectedDisabled: true
    },
    imagePipeline: {
        featureKey: 'image_pipeline',
        labelKey: 'openclaw.capabilities.imagePipeline',
        expectedDisabled: true
    },
    imageSearch: {
        featureKey: 'image_search',
        labelKey: 'openclaw.capabilities.imageSearch',
        expectedDisabled: true
    },
    aiImage: {
        featureKey: 'ai_image',
        labelKey: 'openclaw.capabilities.aiImage',
        expectedDisabled: true
    },
    telegram: {
        featureKey: 'telegram_bot',
        labelKey: 'openclaw.capabilities.telegram',
        expectedDisabled: true
    },
    openclawGateway: {
        featureKey: 'openclaw_gateway',
        labelKey: 'openclaw.capabilities.openclawGateway'
    }
});

const STATUS_MESSAGE_KEYS = Object.freeze({
    disabled: 'openclaw.capabilities.disabled',
    expected_disabled: 'openclaw.capabilities.expectedDisabled',
    missing_config: 'openclaw.capabilities.missingConfig',
    pending_check: 'openclaw.capabilities.pendingCheck',
    healthy: 'openclaw.capabilities.runtimeVerified',
    degraded: 'openclaw.capabilities.degraded',
    failed: 'openclaw.capabilities.failed',
    unavailable: 'openclaw.capabilities.unavailable',
    manual_review: 'openclaw.capabilities.manualReview',
    not_applicable: 'openclaw.capabilities.notApplicable'
});

const parseBooleanState = (value, fallback = false) => {
    if (value === undefined || value === null || String(value).trim() === '') {
        return { value: Boolean(fallback), valid: true, explicit: false };
    }
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
        return { value: true, valid: true, explicit: true };
    }
    if (['0', 'false', 'no', 'off'].includes(normalized)) {
        return { value: false, valid: true, explicit: true };
    }
    // Invalid non-empty values fail closed, but remain distinguishable from an intentional disable.
    return { value: false, valid: false, explicit: true };
};

const booleanCapabilityConfig = (env, key, { fallback = false, configured = true } = {}) => {
    const state = parseBooleanState(env[key], fallback);
    return {
        enabled: state.value,
        configured: Boolean(configured) && state.valid,
        configurationValid: state.valid,
        invalidConfigKeys: state.valid ? [] : [key]
    };
};

const hasConfiguredValue = (value) => Boolean(String(value || '').trim());
const providerConfigured = (value) => {
    const normalized = String(value || '')
        .trim()
        .toLowerCase();
    return Boolean(normalized && !['disabled', 'none', 'off', 'false'].includes(normalized));
};

const boundedDuration = (value, fallback, { min = 1, max = 10 * 60 * 1000 } = {}) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
};

const freshnessState = (value, { now = new Date(), maxAgeHours = 24 } = {}) => {
    const timestamp = value ? new Date(value).getTime() : Number.NaN;
    const maxAgeMs = Math.max(1, Number(maxAgeHours) || 24) * 60 * 60 * 1000;
    return {
        timestampValid: Number.isFinite(timestamp),
        stale: !Number.isFinite(timestamp) || now.getTime() - timestamp > maxAgeMs
    };
};

const toIso = (value) => {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

const stripSensitiveUrlParts = (value) => {
    const raw = String(value || '').trim();
    if (!/^https?:\/\//i.test(raw)) return raw;
    try {
        const parsed = new URL(raw);
        parsed.username = '';
        parsed.password = '';
        for (const key of Array.from(parsed.searchParams.keys())) {
            if (/token|auth|access[_-]?token|api[_-]?key|secret|password/i.test(key)) {
                parsed.searchParams.delete(key);
            }
        }
        // Dashboard fragments are never required server-side and may contain opaque credentials.
        parsed.hash = '';
        return parsed.toString();
    } catch {
        return '';
    }
};

const isPrivateGatewayHost = (hostname) => {
    const host = String(hostname || '')
        .trim()
        .toLowerCase()
        .replace(/^\[|\]$/g, '');
    if (['localhost', '::1', 'app_openclaw', 'openclaw'].includes(host)) return true;
    if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;
    if (/^(?:fc|fd)[0-9a-f]{2}:/i.test(host)) return true;
    const match = host.match(/^172\.(\d{1,2})\./);
    return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
};

const sanitizeString = (value) => {
    let output = stripSensitiveUrlParts(value);
    output = output.replace(/sk-[A-Za-z0-9_-]{12,}/g, '[redacted]');
    output = output.replace(/mongodb(\+srv)?:\/\/[^\s"']+/gi, '[redacted]');
    output = output.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]');
    output = output.replace(/\b(API_KEY|OPENCLAW_INTERNAL_API_KEY|SEO_AGENT_API_KEY|SEO_AGENT_HMAC_SECRET|OPENCLAW_GATEWAY_TOKEN|OPENAI_API_KEY|FIRECRAWL_API_KEY|IMAGE_SEARCH_API_KEY|AI_IMAGE_API_KEY|MONGODB_URI|TELEGRAM_BOT_TOKEN|TELEGRAM_WEBHOOK_SECRET)(\s*[:=]\s*)([^\s"']+)/gi, '$1$2[redacted]');
    return output.slice(0, 1000);
};

const isSensitiveKey = (key) => /token|secret|password|authorization|credential|api[_-]?key|mongodb|connection[_-]?uri/i.test(String(key || ''));
const isSafeConfiguredBoolean = (key, value) => typeof value === 'boolean' && /configured$/i.test(String(key || ''));

const sanitizeSafeValue = (value, depth = 0) => {
    if (value === null || value === undefined) return value ?? null;
    if (depth > MAX_SAFE_DEPTH) return null;
    if (value instanceof Date) return toIso(value);
    if (typeof value === 'string') return sanitizeString(value);
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'boolean') return value;
    if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeSafeValue(item, depth + 1));
    if (typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value)
                .filter(([key, entry]) => !isSensitiveKey(key) || isSafeConfiguredBoolean(key, entry))
                .slice(0, 80)
                .map(([key, entry]) => [key, sanitizeSafeValue(entry, depth + 1)])
        );
    }
    return null;
};

const safeErrorCode = (error) =>
    String(error?.code || error?.name || 'CAPABILITY_PROBE_FAILED')
        .replace(/[^A-Za-z0-9_-]/g, '_')
        .slice(0, 120)
        .toLowerCase();

const emptyRuntime = () => ({
    serviceRegistered: null,
    workerActive: null,
    schedulerActive: null,
    persistedScheduleEnabled: null,
    lastHeartbeatAt: null,
    lastSuccessfulRunAt: null,
    nextRunAt: null,
    latestArtifactStatus: null
});

const normalizeRuntime = (runtime = {}) =>
    sanitizeSafeValue({
        ...emptyRuntime(),
        ...runtime,
        lastHeartbeatAt: toIso(runtime.lastHeartbeatAt),
        lastSuccessfulRunAt: toIso(runtime.lastSuccessfulRunAt),
        nextRunAt: toIso(runtime.nextRunAt)
    });

const availabilityForStatus = (status) => {
    if (status === 'healthy') return 'available';
    if (status === 'degraded') return 'degraded';
    if (status === 'failed' || status === 'missing_config' || status === 'unavailable') return 'unavailable';
    return 'unknown';
};

const schedulerRuntimeIssue = ({ scheduler = {}, workloadKey, now = new Date(), nextRunAt = null, persistedActivityAt = null } = {}) => {
    const pollIntervalMs = Number.isFinite(Number(scheduler.pollIntervalMs)) ? Math.max(1000, Number(scheduler.pollIntervalMs)) : DEFAULT_CACHE_MS;
    const allowedLagMs = Math.max(60_000, pollIntervalMs * 3);
    const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
    const nextRunMs = nextRunAt ? new Date(nextRunAt).getTime() : Number.NaN;
    if (!scheduler.serviceRegistered) {
        const persistedActivityMs = persistedActivityAt ? new Date(persistedActivityAt).getTime() : Number.NaN;
        // Runtime registration is process-local. A separate worker may have advanced a
        // persisted schedule, but that is not enough evidence for a green result.
        // Keep readiness fail-closed while avoiding a false operational failure.
        if (Number.isFinite(persistedActivityMs) && Number.isFinite(nextRunMs) && nextRunMs >= nowMs - allowedLagMs) {
            return {
                status: 'degraded',
                reasonCode: 'scheduler_runtime_registration_unverified'
            };
        }
        return { status: 'failed', reasonCode: 'scheduler_runtime_not_registered' };
    }
    if (!scheduler.enabledWorkloads?.[workloadKey]) {
        return { status: 'degraded', reasonCode: 'scheduler_workload_inactive' };
    }
    if (!scheduler.schedulerActive) {
        return { status: 'degraded', reasonCode: 'scheduler_workload_inactive' };
    }

    const heartbeatMs = scheduler.lastHeartbeatAt ? new Date(scheduler.lastHeartbeatAt).getTime() : Number.NaN;
    if (!Number.isFinite(heartbeatMs) || nowMs - heartbeatMs > allowedLagMs) {
        return { status: 'degraded', reasonCode: 'stale_runtime' };
    }

    if (Number.isFinite(nextRunMs) && nowMs - nextRunMs > allowedLagMs) {
        return { status: 'degraded', reasonCode: 'scheduler_workload_overdue' };
    }
    return null;
};

const canonicalCapability = (definition, overrides = {}) => {
    const status = CAPABILITY_STATUS_SET.has(overrides.status) ? overrides.status : 'unavailable';
    const checked = Boolean(overrides.checked);
    const lastCheckedAt = checked ? toIso(overrides.lastCheckedAt) : null;
    const reasonCode = String(overrides.reasonCode || '')
        .replace(/[^A-Za-z0-9_-]/g, '_')
        .slice(0, 120)
        .toLowerCase();
    const warningList = Array.isArray(overrides.warnings) ? overrides.warnings : overrides.warnings ? [overrides.warnings] : [];
    return {
        featureKey: definition.featureKey,
        labelKey: definition.labelKey,
        configured: Boolean(definition.configured),
        enabled: Boolean(definition.enabled),
        checked,
        status,
        expectedState: overrides.expectedState || (definition.enabled ? 'enabled' : 'disabled'),
        reasonCode,
        messageKey: overrides.messageKey || STATUS_MESSAGE_KEYS[status],
        lastCheckedAt,
        latencyMs: checked && Number.isFinite(Number(overrides.latencyMs)) ? Math.max(0, Math.round(Number(overrides.latencyMs))) : null,
        runtime: normalizeRuntime(overrides.runtime),
        warnings: Array.from(new Set(warningList.map((warning) => sanitizeString(warning)).filter(Boolean))).slice(0, 30),
        safeDetails: sanitizeSafeValue(overrides.safeDetails || {}),
        // Compatibility aliases for older dashboard clients. They never contain secrets.
        availability: availabilityForStatus(status),
        checkedAt: lastCheckedAt
    };
};

const capabilityStatus = ({ featureKey = 'unknown', labelKey = 'openclaw.capabilities.unknown', enabled, configured = true, configurationValid = true, invalidConfigKeys = [], expectedDisabled = false, configDetails = {}, status, checked, reasonCode, lastCheckedAt, latencyMs, runtime, warnings, safeDetails } = {}) => {
    const definition = {
        featureKey,
        labelKey,
        enabled: Boolean(enabled),
        configured: Boolean(configured) && configurationValid !== false,
        configurationValid: configurationValid !== false,
        invalidConfigKeys,
        expectedDisabled
    };
    const resolvedStatus = status || (!definition.enabled ? (expectedDisabled ? 'expected_disabled' : 'disabled') : !definition.configured ? 'missing_config' : 'pending_check');
    return canonicalCapability(definition, {
        status: resolvedStatus,
        checked: checked ?? resolvedStatus !== 'pending_check',
        reasonCode: reasonCode || (resolvedStatus === 'missing_config' ? (definition.configurationValid ? 'missing_configuration' : 'invalid_boolean_configuration') : resolvedStatus === 'expected_disabled' ? 'safe_rollout_disabled' : resolvedStatus === 'disabled' ? 'disabled_by_configuration' : resolvedStatus === 'pending_check' ? 'check_pending' : 'runtime_verified'),
        lastCheckedAt,
        latencyMs,
        runtime,
        warnings: configDetails?.legacyConfigurationFallback ? [...(Array.isArray(warnings) ? warnings : warnings ? [warnings] : []), 'legacy_analytics_configuration_fallback'] : warnings,
        safeDetails: safeDetails ?? configDetails
    });
};

const buildCapabilityDefinitions = (env = process.env, telegramStatus = TelegramApprovalService.status()) => {
    const imageSearchConfigured = providerConfigured(env.IMAGE_SEARCH_PROVIDER) && hasConfiguredValue(env.IMAGE_SEARCH_API_KEY);
    const aiImageConfigured = providerConfigured(env.AI_IMAGE_PROVIDER) && hasConfiguredValue(env.AI_IMAGE_API_KEY || env.OPENAI_API_KEY);
    const searchConsoleConfigured = hasConfiguredValue(env.SEARCH_CONSOLE_PROPERTY || env.GOOGLE_SEARCH_CONSOLE_PROPERTY || env.SEARCH_CONSOLE_SITE_URL) && hasConfiguredValue(env.GOOGLE_APPLICATION_CREDENTIALS);
    const trendsProviderConfigured =
        String(env.CONTENT_TRENDS_PROVIDER || '')
            .trim()
            .toLowerCase() === 'google_trends_rss';
    const telegramMode =
        String(telegramStatus?.mode || env.TELEGRAM_MODE || 'webhook')
            .trim()
            .toLowerCase() === 'polling'
            ? 'polling'
            : 'webhook';
    const telegramProductionModeAllowed = !isProductionEnv(env) || telegramMode === 'webhook';
    const telegramNotifyConfigured = hasConfiguredValue(env.TELEGRAM_NOTIFY_CHAT_IDS || env.TELEGRAM_ALLOWED_CHAT_IDS);
    const telegramConfigured = Boolean(telegramProductionModeAllowed && telegramStatus?.tokenConfigured && telegramStatus?.allowlistConfigured && telegramStatus?.adminBaseUrlConfigured && telegramStatus?.adminBaseUrlHttps && telegramNotifyConfigured && (telegramMode !== 'webhook' || telegramStatus?.webhookSecretConfigured));
    const writerModelConfigured = MODEL_ID.test(String(env.OPENAI_WRITER_MODEL || '').trim());
    const ideationModelConfigured = MODEL_ID.test(String(env.OPENAI_IDEATION_MODEL || '').trim());
    const allowedResolvedModels = String(env.OPENCLAW_TOPIC_ALLOWED_RESOLVED_MODELS || '')
        .split(',')
        .map((model) => model.trim())
        .filter(Boolean);
    const allowedResolvedModelsConfigured = allowedResolvedModels.length > 0 && allowedResolvedModels.every((model) => MODEL_ID.test(model));
    const expectedResolvedModel = String(env.OPENCLAW_TOPIC_EXPECTED_RESOLVED_MODEL || '').trim();
    const expectedResolvedModelConfigured = MODEL_ID.test(expectedResolvedModel);
    const expectedResolvedModelAllowlisted = expectedResolvedModelConfigured && allowedResolvedModels.includes(expectedResolvedModel);
    const gatewayToken = String(env.OPENCLAW_GATEWAY_TOKEN || '').trim();
    const gatewayTokenConfigured = Boolean(gatewayToken && (!isProductionEnv(env) || gatewayToken.length >= 32));
    let gatewayUrlConfigured = false;
    try {
        const gatewayUrl = new URL(String(env.OPENCLAW_GATEWAY_HTTP_URL || '').trim());
        gatewayUrlConfigured = ['http:', 'https:'].includes(gatewayUrl.protocol) && !gatewayUrl.username && !gatewayUrl.password;
    } catch {
        gatewayUrlConfigured = false;
    }
    const blogPipelineConfigured = Boolean(hasConfiguredValue(env.OPENAI_API_KEY) && gatewayUrlConfigured && gatewayTokenConfigured && writerModelConfigured && ideationModelConfigured && allowedResolvedModelsConfigured && expectedResolvedModelAllowlisted);

    const canonicalAnalyticsConfigured = env.CONTENT_ANALYTICS_ENABLED !== undefined;
    const legacyAnalyticsConfigured = !canonicalAnalyticsConfigured && env.CONTENT_AGGREGATE_ANALYTICS_ENABLED !== undefined;
    const analyticsFlagKey = canonicalAnalyticsConfigured ? 'CONTENT_ANALYTICS_ENABLED' : 'CONTENT_AGGREGATE_ANALYTICS_ENABLED';
    const openclawInternalApiKey = env.OPENCLAW_INTERNAL_API_KEY || (!isProductionEnv(env) ? env.API_KEY : undefined);
    const config = {
        seoAgent: booleanCapabilityConfig(env, 'SEO_AGENT_ENABLED', {
            configured: [openclawInternalApiKey, env.SEO_AGENT_API_KEY, env.SEO_AGENT_HMAC_SECRET, env.OPENAI_API_KEY].every(hasConfiguredValue)
        }),
        contentOperations: booleanCapabilityConfig(env, 'CONTENT_OPERATIONS_ENABLED'),
        blogCron: booleanCapabilityConfig(env, 'OPENCLAW_BLOG_CRON_ENABLED', {
            configured: blogPipelineConfigured
        }),
        contentOperationsCron: booleanCapabilityConfig(env, 'CONTENT_OPERATIONS_CRON_ENABLED'),
        googleIntelligence: booleanCapabilityConfig(env, 'GOOGLE_INTELLIGENCE_ENABLED'),
        searchConsole: booleanCapabilityConfig(env, 'SEARCH_CONSOLE_ENABLED', {
            configured: searchConsoleConfigured
        }),
        aggregateAnalytics: booleanCapabilityConfig(env, analyticsFlagKey),
        trends: booleanCapabilityConfig(env, 'CONTENT_TRENDS_ENABLED', {
            configured: trendsProviderConfigured
        }),
        inventory: booleanCapabilityConfig(env, 'CONTENT_INVENTORY_ENABLED', {
            fallback: true
        }),
        contentSignals: booleanCapabilityConfig(env, 'CONTENT_SIGNALS_ENABLED', {
            fallback: false
        }),
        performanceMonitoring: booleanCapabilityConfig(env, 'CONTENT_PERFORMANCE_MONITORING_ENABLED'),
        learning: booleanCapabilityConfig(env, 'CONTENT_LEARNING_ENABLED'),
        imagePipeline: booleanCapabilityConfig(env, 'OPENCLAW_IMAGE_PIPELINE_ENABLED', {
            configured: imageSearchConfigured || aiImageConfigured
        }),
        imageSearch: {
            enabled: providerConfigured(env.IMAGE_SEARCH_PROVIDER),
            configured: imageSearchConfigured
        },
        aiImage: {
            enabled: providerConfigured(env.AI_IMAGE_PROVIDER),
            configured: aiImageConfigured
        },
        telegram: booleanCapabilityConfig(env, 'TELEGRAM_BOT_ENABLED', {
            configured: telegramConfigured
        }),
        openclawGateway: {
            enabled: true,
            configured: hasConfiguredValue(env.OPENCLAW_GATEWAY_TOKEN)
        }
    };

    return Object.fromEntries(
        Object.entries(CAPABILITY_META).map(([dashboardKey, meta]) => [
            dashboardKey,
            {
                dashboardKey,
                ...meta,
                ...config[dashboardKey],
                configDetails:
                    dashboardKey === 'telegram'
                        ? {
                              mode: telegramMode,
                              productionModeAllowed: telegramProductionModeAllowed,
                              tokenConfigured: Boolean(telegramStatus?.tokenConfigured),
                              allowlistConfigured: Boolean(telegramStatus?.allowlistConfigured),
                              notifyTargetsConfigured: telegramNotifyConfigured,
                              webhookSecretConfigured: Boolean(telegramStatus?.webhookSecretConfigured),
                              adminBaseUrlConfigured: Boolean(telegramStatus?.adminBaseUrlConfigured),
                              adminBaseUrlHttps: Boolean(telegramStatus?.adminBaseUrlHttps)
                          }
                        : dashboardKey === 'blogCron'
                          ? {
                                openAiConfigured: hasConfiguredValue(env.OPENAI_API_KEY),
                                gatewayUrlConfigured,
                                gatewayTokenConfigured,
                                writerModelConfigured,
                                ideationModelConfigured,
                                allowedResolvedModelsConfigured,
                                expectedResolvedModelConfigured,
                                expectedResolvedModelAllowlisted
                            }
                          : dashboardKey === 'aggregateAnalytics' && legacyAnalyticsConfigured
                            ? {
                                  legacyConfigurationFallback: true,
                                  deprecatedConfigurationKey: 'CONTENT_AGGREGATE_ANALYTICS_ENABLED',
                                  preferredConfigurationKey: 'CONTENT_ANALYTICS_ENABLED'
                              }
                            : {}
            }
        ])
    );
};

const buildCapabilityMatrix = (env = process.env, telegramStatus = TelegramApprovalService.status()) => Object.fromEntries(Object.entries(buildCapabilityDefinitions(env, telegramStatus)).map(([dashboardKey, definition]) => [dashboardKey, capabilityStatus(definition)]));

const getGatewayHttpUrl = (env = process.env) => {
    const dockerManaged =
        String(env.OPENCLAW_DEPLOYMENT_MODE || '')
            .trim()
            .toLowerCase() === 'docker';
    const raw = String(env.OPENCLAW_GATEWAY_HTTP_URL || (dockerManaged ? 'http://app_openclaw:18789' : 'http://127.0.0.1:18789')).trim();
    const sanitized = stripSensitiveUrlParts(raw);
    try {
        const parsed = new URL(sanitized);
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || !isPrivateGatewayHost(parsed.hostname) || !['', '/'].includes(parsed.pathname)) {
            return '';
        }
        // Gateway health routes never require query parameters; dropping them prevents credential forwarding.
        parsed.search = '';
        parsed.hash = '';
        return parsed.toString().replace(/\/+$/, '');
    } catch {
        return '';
    }
};

const probeOpenClawGateway = async ({ fetchImpl = global.fetch, timeoutMs = 5000, env = process.env } = {}) => {
    const checkedAt = new Date().toISOString();
    if (typeof fetchImpl !== 'function') {
        return {
            reachable: false,
            live: false,
            ready: false,
            checkedAt,
            error: 'fetch_not_available'
        };
    }
    const baseUrl = getGatewayHttpUrl(env);
    if (!baseUrl)
        return {
            reachable: false,
            live: false,
            ready: false,
            checkedAt,
            error: 'gateway_url_invalid'
        };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), boundedDuration(timeoutMs, 5000, { min: 100, max: 60 * 1000 }));
    try {
        const check = async (pathName, headers = {}) => {
            const response = await fetchImpl(`${baseUrl}/${pathName}`, {
                headers: {
                    accept: 'application/json,text/plain;q=0.8',
                    ...headers
                },
                redirect: 'error',
                signal: controller.signal
            });
            return { ok: response.ok, status: response.status };
        };
        const [liveness, readiness] = await Promise.all([check('healthz'), check('readyz')]);
        const gatewayToken = String(env.OPENCLAW_GATEWAY_TOKEN || '').trim();
        // GET /v1/models is an authenticated, read-only compatibility endpoint. Unlike
        // POST /v1/responses, it never starts an agent run or consumes model quota.
        const authentication = await check('v1/models', gatewayToken ? { authorization: `Bearer ${gatewayToken}` } : {});
        const authenticated = authentication.ok;
        const ready = readiness.ok && authenticated;
        const authenticationError = authentication.status === 401 ? 'authentication_failed' : authentication.status === 403 ? 'permission_denied' : 'gateway_not_ready';
        return {
            reachable: true,
            live: liveness.ok,
            ready,
            authenticated,
            livenessStatus: liveness.status,
            readinessStatus: readiness.status,
            authenticationStatus: authentication.status,
            checkedAt: new Date().toISOString(),
            error: ready ? '' : !authenticated ? authenticationError : 'gateway_not_ready'
        };
    } catch (error) {
        return {
            reachable: false,
            live: false,
            ready: false,
            checkedAt: new Date().toISOString(),
            error: error?.name === 'AbortError' ? 'gateway_health_timeout' : 'gateway_unreachable'
        };
    } finally {
        clearTimeout(timeout);
    }
};

class CapabilityHealthService {
    constructor({ envProvider = () => process.env, telegramStatusProvider = () => TelegramApprovalService.status(), schedulerRuntimeProvider = () => getBlogAutomationSchedulerRuntime(), gatewayProbe = (options) => probeOpenClawGateway(options), probeRegistry = {}, databaseReady = () => mongoose.connection.readyState === 1, now = () => new Date(), cacheMs, timeoutMs } = {}) {
        this.envProvider = envProvider;
        this.telegramStatusProvider = telegramStatusProvider;
        this.schedulerRuntimeProvider = schedulerRuntimeProvider;
        this.gatewayProbe = gatewayProbe;
        this.probeRegistry = probeRegistry;
        this.databaseReady = databaseReady;
        this.now = now;
        this.cacheMsOverride = cacheMs;
        this.timeoutMsOverride = timeoutMs;
        this.cache = new Map();
        this.inFlight = new Map();
    }

    get cacheMs() {
        const env = this.envProvider();
        return boundedDuration(this.cacheMsOverride ?? Number(env.OPENCLAW_CAPABILITY_HEALTH_CACHE_SECONDS) * 1000, DEFAULT_CACHE_MS, { min: 1, max: 10 * 60 * 1000 });
    }

    get timeoutMs() {
        const env = this.envProvider();
        return boundedDuration(this.timeoutMsOverride ?? env.OPENCLAW_CAPABILITY_HEALTH_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, { min: 1, max: 60 * 1000 });
    }

    clearCache() {
        this.cache.clear();
    }

    definitions() {
        return buildCapabilityDefinitions(this.envProvider(), this.telegramStatusProvider());
    }

    healthChecksEnabled() {
        const state = this.healthCheckConfiguration();
        return state.valid && state.value;
    }

    healthCheckConfiguration() {
        return parseBooleanState(this.envProvider().OPENCLAW_CAPABILITY_HEALTH_ENABLED, true);
    }

    resolveDefinition(featureKey) {
        const requested = String(featureKey || '').trim();
        const definition = Object.values(this.definitions()).find((candidate) => candidate.featureKey === requested || candidate.dashboardKey === requested);
        if (!definition) throw new BadRequestError('Unsupported OpenClaw capability');
        return definition;
    }

    async getStatus({ force = false, featureKeys = null } = {}) {
        const definitions = this.definitions();
        const requested = Array.isArray(featureKeys) && featureKeys.length ? featureKeys.map((featureKey) => this.resolveDefinition(featureKey)) : Object.values(definitions);
        const results = await Promise.all(requested.map((definition) => this._checkDefinition(definition, { force })));
        const capabilities = Object.fromEntries(
            results.map((capability) => {
                const definition = requested.find((candidate) => candidate.featureKey === capability.featureKey);
                return [definition.dashboardKey, capability];
            })
        );
        const healthConfiguration = this.healthCheckConfiguration();
        return {
            checkedAt: this.now().toISOString(),
            healthEnabled: healthConfiguration.valid && healthConfiguration.value,
            healthConfigurationValid: healthConfiguration.valid,
            healthConfigurationReasonCode: healthConfiguration.valid ? null : 'invalid_boolean_configuration',
            cacheSeconds: this.cacheMs / 1000,
            timeoutMs: this.timeoutMs,
            capabilities
        };
    }

    async checkAll() {
        return this.getStatus({ force: true });
    }

    async checkOne({ featureKey, force = true } = {}) {
        return this._checkDefinition(this.resolveDefinition(featureKey), { force });
    }

    _signature(definition) {
        return JSON.stringify({
            enabled: definition.enabled,
            configured: definition.configured,
            configurationValid: definition.configurationValid,
            invalidConfigKeys: definition.invalidConfigKeys,
            expectedDisabled: definition.expectedDisabled,
            configDetails: definition.configDetails,
            healthConfiguration: this.healthCheckConfiguration()
        });
    }

    _cacheResult(definition, signature, value) {
        this.cache.set(definition.featureKey, {
            signature,
            expiresAt: Date.now() + this.cacheMs,
            value
        });
        return value;
    }

    async _checkDefinition(definition, { force = false } = {}) {
        const signature = this._signature(definition);
        if (definition.configurationValid === false) {
            return this._cacheResult(
                definition,
                signature,
                canonicalCapability(definition, {
                    checked: true,
                    status: 'missing_config',
                    reasonCode: 'invalid_boolean_configuration',
                    expectedState: 'valid_boolean_configuration',
                    lastCheckedAt: this.now(),
                    latencyMs: 0,
                    runtime: { serviceRegistered: null },
                    warnings: ['invalid_boolean_configuration'],
                    safeDetails: {
                        ...definition.configDetails,
                        invalidConfigurationKeys: definition.invalidConfigKeys || []
                    }
                })
            );
        }
        const healthConfiguration = this.healthCheckConfiguration();
        if (!healthConfiguration.valid) {
            return canonicalCapability(definition, {
                checked: true,
                status: 'missing_config',
                reasonCode: 'invalid_boolean_configuration',
                expectedState: 'valid_boolean_configuration',
                lastCheckedAt: this.now(),
                latencyMs: 0,
                runtime: { serviceRegistered: null },
                warnings: ['invalid_boolean_configuration'],
                safeDetails: {
                    invalidConfigurationKeys: ['OPENCLAW_CAPABILITY_HEALTH_ENABLED']
                }
            });
        }
        const cached = this.cache.get(definition.featureKey);
        if (!force && cached?.signature === signature && cached.expiresAt > Date.now()) return cached.value;

        if (!definition.enabled) {
            const status = definition.expectedDisabled ? 'expected_disabled' : 'disabled';
            return this._cacheResult(
                definition,
                signature,
                canonicalCapability(definition, {
                    checked: true,
                    status,
                    reasonCode: definition.expectedDisabled ? 'safe_rollout_disabled' : 'disabled_by_configuration',
                    lastCheckedAt: this.now(),
                    latencyMs: 0,
                    runtime: { serviceRegistered: true, schedulerActive: false },
                    warnings: definition.configDetails?.legacyConfigurationFallback ? ['legacy_analytics_configuration_fallback'] : [],
                    safeDetails: definition.configDetails
                })
            );
        }

        if (!definition.configured) {
            return this._cacheResult(
                definition,
                signature,
                canonicalCapability(definition, {
                    checked: true,
                    status: 'missing_config',
                    reasonCode: 'missing_configuration',
                    lastCheckedAt: this.now(),
                    latencyMs: 0,
                    runtime: { serviceRegistered: true },
                    warnings: definition.configDetails?.legacyConfigurationFallback ? ['legacy_analytics_configuration_fallback'] : [],
                    safeDetails: definition.configDetails
                })
            );
        }

        if (!healthConfiguration.value) {
            return this._cacheResult(
                definition,
                signature,
                canonicalCapability(definition, {
                    checked: false,
                    status: 'pending_check',
                    reasonCode: 'capability_health_disabled',
                    expectedState: 'enabled',
                    runtime: { serviceRegistered: null },
                    warnings: definition.configDetails?.legacyConfigurationFallback ? ['legacy_analytics_configuration_fallback'] : [],
                    safeDetails: definition.configDetails
                })
            );
        }

        const active = this.inFlight.get(definition.featureKey);
        if (active?.signature === signature) return active.promise;

        const promise = this._executeProbe(definition)
            .then((value) => this._cacheResult(definition, signature, value))
            .finally(() => {
                if (this.inFlight.get(definition.featureKey)?.promise === promise) {
                    this.inFlight.delete(definition.featureKey);
                }
            });
        this.inFlight.set(definition.featureKey, { signature, promise });
        return promise;
    }

    async _executeProbe(definition) {
        const startedAt = Date.now();
        let timeout;
        const legacyWarnings = definition.configDetails?.legacyConfigurationFallback ? ['legacy_analytics_configuration_fallback'] : [];
        const probe = this.probeRegistry[definition.dashboardKey] || (() => this._defaultProbe(definition));
        const settledProbe = Promise.resolve()
            .then(() => probe({ definition, service: this }))
            .then(
                (result) => ({ type: 'result', result }),
                (error) => ({ type: 'error', error })
            );
        const timed = new Promise((resolve) => {
            timeout = setTimeout(() => resolve({ type: 'timeout' }), this.timeoutMs);
        });

        try {
            const outcome = await Promise.race([settledProbe, timed]);
            const checkedAt = this.now();
            const latencyMs = Date.now() - startedAt;
            if (outcome.type === 'timeout') {
                return canonicalCapability(definition, {
                    checked: true,
                    status: 'failed',
                    reasonCode: 'probe_timeout',
                    lastCheckedAt: checkedAt,
                    latencyMs,
                    runtime: { serviceRegistered: true },
                    warnings: [...legacyWarnings, 'capability_probe_timeout'],
                    safeDetails: definition.configDetails
                });
            }
            if (outcome.type === 'error') {
                return canonicalCapability(definition, {
                    checked: true,
                    status: outcome.error?.code === 'DATABASE_UNAVAILABLE' ? 'unavailable' : 'failed',
                    reasonCode: outcome.error?.code === 'DATABASE_UNAVAILABLE' ? 'database_unavailable' : 'probe_failed',
                    lastCheckedAt: checkedAt,
                    latencyMs,
                    runtime: { serviceRegistered: true },
                    warnings: legacyWarnings,
                    safeDetails: {
                        ...definition.configDetails,
                        errorCode: safeErrorCode(outcome.error)
                    }
                });
            }
            const result = outcome.result || {};
            const validProbeStatus = CAPABILITY_STATUS_SET.has(result.status);
            const status = validProbeStatus ? result.status : 'unavailable';
            const warnings = validProbeStatus ? (Array.isArray(result.warnings) ? result.warnings : result.warnings ? [result.warnings] : []) : ['invalid_probe_result'];
            return canonicalCapability(definition, {
                checked: true,
                status,
                expectedState: result.expectedState,
                reasonCode: validProbeStatus ? result.reasonCode || (status === 'healthy' ? 'runtime_verified' : status) : 'invalid_probe_result',
                messageKey: result.messageKey,
                lastCheckedAt: checkedAt,
                latencyMs,
                runtime: result.runtime,
                warnings: [...warnings, ...legacyWarnings],
                safeDetails: {
                    ...definition.configDetails,
                    ...(result.safeDetails && typeof result.safeDetails === 'object' ? result.safeDetails : {})
                }
            });
        } finally {
            if (timeout) clearTimeout(timeout);
        }
    }

    _assertDatabaseReady() {
        if (this.databaseReady()) return;
        const error = new Error('database_unavailable');
        error.code = 'DATABASE_UNAVAILABLE';
        throw error;
    }

    async _latest(Model, { filter = {}, select = '', sort = { createdAt: -1 } } = {}) {
        this._assertDatabaseReady();
        // Capability health describes the production workflow. Isolated QA artifacts must never
        // make the operational dashboard greener or redder than the real system.
        let query = Model.findOne({ ...filter, isQaTest: { $ne: true } }).sort(sort);
        if (select) query = query.select(select);
        query = query.lean();
        if (typeof query.maxTimeMS === 'function') query = query.maxTimeMS(Math.min(this.timeoutMs, DEFAULT_TIMEOUT_MS));
        return query;
    }

    async _count(Model, filter = {}) {
        this._assertDatabaseReady();
        let query = Model.countDocuments({ ...filter, isQaTest: { $ne: true } });
        if (typeof query.maxTimeMS === 'function') query = query.maxTimeMS(Math.min(this.timeoutMs, DEFAULT_TIMEOUT_MS));
        return query;
    }

    async _schedulerRuntime() {
        const localRuntime = sanitizeSafeValue(
            await Promise.resolve(this.schedulerRuntimeProvider() || {})
        );
        const embeddedWorker = String(
            this.envProvider().OPENCLAW_EMBEDDED_WORKER || ''
        ).trim().toLowerCase();
        if (localRuntime.serviceRegistered || embeddedWorker !== 'false') {
            return localRuntime;
        }
        this._assertDatabaseReady();
        let query = BlogAutomationWorkerHeartbeat.findById(BLOG_WORKER_HEARTBEAT_ID)
            .select(
                'state acceptingClaims workerActive schedulerActive pollIntervalMs '
                + 'lastHeartbeatAt lastSuccessfulRunAt lastErrorCode enabledWorkloads processRole'
            )
            .lean();
        if (typeof query.maxTimeMS === 'function') {
            query = query.maxTimeMS(Math.min(this.timeoutMs, DEFAULT_TIMEOUT_MS));
        }
        const heartbeat = await query;
        if (!heartbeat) return localRuntime;
        return sanitizeSafeValue({
            serviceRegistered:
                heartbeat.state === 'running'
                && heartbeat.acceptingClaims === true,
            workerActive: heartbeat.workerActive === true,
            schedulerActive: heartbeat.schedulerActive === true,
            externalWorker: true,
            processRole: heartbeat.processRole || 'dedicated_worker',
            lastHeartbeatAt: heartbeat.lastHeartbeatAt || null,
            lastSuccessfulRunAt: heartbeat.lastSuccessfulRunAt || null,
            lastErrorCode: heartbeat.lastErrorCode || '',
            pollIntervalMs: Number(heartbeat.pollIntervalMs || DEFAULT_CACHE_MS),
            enabledWorkloads: heartbeat.enabledWorkloads || {}
        });
    }

    async _probeExecutionHistory() {
        const [execution, successfulExecution] = await Promise.all([
            this._latest(BlogAutomationExecution, {
                select: 'status completedAt createdAt metadata.imagePipelineStatus'
            }),
            this._latest(BlogAutomationExecution, {
                filter: { status: { $in: BLOG_SUCCESSFUL_EXECUTION_STATUSES } },
                select: 'status completedAt createdAt',
                sort: { completedAt: -1, createdAt: -1 }
            })
        ]);
        const latestStatus = String(execution?.status || '');
        const latestSucceeded = BLOG_SUCCESSFUL_EXECUTION_STATUSES.includes(latestStatus);
        const latestFailed = latestStatus === 'failed';
        return {
            status: latestSucceeded ? 'healthy' : latestFailed ? 'failed' : 'degraded',
            reasonCode: latestSucceeded ? 'runtime_verified' : latestFailed ? 'latest_execution_failed' : execution ? 'latest_execution_not_terminal_success' : 'no_execution_history',
            runtime: {
                serviceRegistered: true,
                lastSuccessfulRunAt: successfulExecution?.completedAt || successfulExecution?.createdAt || null,
                latestArtifactStatus: execution?.status || null
            },
            warnings: latestSucceeded ? [] : [execution ? 'latest_execution_not_successful' : 'no_execution_history']
        };
    }

    async _probeContentOperations() {
        const [snapshot, run] = await Promise.all([
            this._latest(ContentOperationsDailySnapshot, {
                select: 'status checkedAt warnings sourceHealth',
                sort: { checkedAt: -1 }
            }),
            this._latest(ContentOperationsRun, {
                select: 'status completedAt createdAt',
                sort: { createdAt: -1 }
            })
        ]);
        const hasWarnings = Boolean(snapshot?.warnings?.length);
        const snapshotFreshness = freshnessState(snapshot?.checkedAt, {
            now: this.now(),
            maxAgeHours: getContentOperationsConfig(this.envProvider()).snapshotMaxAgeHours
        });
        const snapshotReady = snapshot?.status === 'complete' && !hasWarnings && !snapshotFreshness.stale;
        const status = snapshotReady ? 'healthy' : snapshot ? 'degraded' : 'degraded';
        return {
            status,
            reasonCode: snapshotReady ? 'runtime_verified' : hasWarnings ? 'persisted_snapshot_warning' : snapshot?.status === 'complete' && snapshotFreshness.stale ? 'snapshot_stale' : snapshot ? 'latest_snapshot_not_complete' : 'no_snapshot',
            runtime: {
                serviceRegistered: true,
                lastSuccessfulRunAt: snapshot?.checkedAt || run?.completedAt || null,
                latestArtifactStatus: snapshot?.status || run?.status || null
            },
            warnings: snapshot ? (snapshot.warnings?.length ? ['persisted_snapshot_warning'] : snapshotFreshness.stale ? ['snapshot_stale'] : []) : ['no_content_operations_snapshot'],
            safeDetails: {
                snapshotFound: Boolean(snapshot),
                runFound: Boolean(run),
                warningCount: snapshot?.warnings?.length || 0,
                stale: snapshotFreshness.stale
            }
        };
    }

    async _probeBlogCron() {
        const now = this.now();
        const [nextSchedule, latestRunSchedule, execution, successfulExecution, dueTaskCount, enabledScheduleCount] = await Promise.all([
            this._latest(BlogAutomationSchedule, {
                filter: { enabled: true },
                select: 'enabled nextRunAt lastRunAt lastRunStatus lastError leaseUntil',
                sort: { nextRunAt: 1, updatedAt: -1 }
            }),
            this._latest(BlogAutomationSchedule, {
                filter: { enabled: true, lastRunAt: { $ne: null } },
                select: 'enabled nextRunAt lastRunAt lastRunStatus lastError leaseUntil',
                sort: { lastRunAt: -1, updatedAt: -1 }
            }),
            this._latest(BlogAutomationExecution, {
                select: 'status completedAt createdAt',
                sort: { createdAt: -1 }
            }),
            this._latest(BlogAutomationExecution, {
                filter: { status: { $in: BLOG_SUCCESSFUL_EXECUTION_STATUSES } },
                select: 'status completedAt createdAt',
                sort: { completedAt: -1, createdAt: -1 }
            }),
            this._count(BlogAutomationSchedule, {
                enabled: true,
                nextRunAt: { $lte: now },
                $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }]
            }),
            this._count(BlogAutomationSchedule, { enabled: true })
        ]);
        const scheduleWithLatestRun = latestRunSchedule || nextSchedule;
        const latestSuccessfulAt = successfulExecution?.completedAt || successfulExecution?.createdAt || (BLOG_SUCCESSFUL_EXECUTION_STATUSES.includes(String(scheduleWithLatestRun?.lastRunStatus || '')) ? scheduleWithLatestRun?.lastRunAt : null);
        const scheduler = await this._schedulerRuntime();
        const runtimeIssue = schedulerRuntimeIssue({
            scheduler,
            workloadKey: 'blogCron',
            now,
            nextRunAt: nextSchedule?.nextRunAt,
            persistedActivityAt: latestSuccessfulAt
        });
        let status = runtimeIssue?.status || 'healthy';
        let reasonCode = runtimeIssue?.reasonCode || 'runtime_verified';
        if (!runtimeIssue && !nextSchedule) {
            status = 'degraded';
            reasonCode = 'no_enabled_schedule';
        } else if (!runtimeIssue && (scheduleWithLatestRun?.lastError || execution?.status === 'failed' || scheduler.lastErrorCode)) {
            status = 'degraded';
            reasonCode = 'scheduler_last_run_error';
        }
        return {
            status,
            reasonCode,
            runtime: {
                ...scheduler,
                persistedScheduleEnabled: Boolean(nextSchedule?.enabled),
                lastSuccessfulRunAt: latestSuccessfulAt || scheduler.lastSuccessfulRunAt || null,
                nextRunAt: nextSchedule?.nextRunAt || null,
                latestArtifactStatus: execution?.status || scheduleWithLatestRun?.lastRunStatus || null,
                dueTaskCount,
                leaseActive: Boolean(nextSchedule?.leaseUntil && new Date(nextSchedule.leaseUntil) > now)
            },
            safeDetails: {
                scheduleFound: Boolean(nextSchedule),
                latestRunScheduleFound: Boolean(latestRunSchedule),
                enabledSchedules: enabledScheduleCount,
                latestExecutionFound: Boolean(execution),
                successfulExecutionFound: Boolean(successfulExecution),
                lastErrorPresent: Boolean(scheduleWithLatestRun?.lastError)
            }
        };
    }

    async _probeContentOperationsCron() {
        const now = this.now();
        const [schedule, run, dueTaskCount] = await Promise.all([
            this._latest(ContentOperationsSchedule, {
                select: 'enabled nextRunAt lastRunAt lastRunStatus lastError leaseUntil',
                sort: { updatedAt: -1 }
            }),
            this._latest(ContentOperationsRun, {
                select: 'status completedAt createdAt',
                sort: { createdAt: -1 }
            }),
            this._count(ContentOperationsSchedule, {
                enabled: true,
                nextRunAt: { $lte: now },
                $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }]
            })
        ]);
        const scheduler = await this._schedulerRuntime();
        const runtimeIssue = schedulerRuntimeIssue({
            scheduler,
            workloadKey: 'contentOperationsCron',
            now,
            nextRunAt: schedule?.nextRunAt
        });
        let status = runtimeIssue?.status || 'healthy';
        let reasonCode = runtimeIssue?.reasonCode || 'runtime_verified';
        if (!runtimeIssue && (!schedule || !schedule.enabled)) {
            status = 'degraded';
            reasonCode = schedule ? 'persisted_schedule_disabled' : 'persisted_schedule_missing';
        } else if (!runtimeIssue && (schedule.lastError || scheduler.lastErrorCode)) {
            status = 'degraded';
            reasonCode = 'scheduler_last_run_error';
        }
        return {
            status,
            reasonCode,
            runtime: {
                ...scheduler,
                persistedScheduleEnabled: Boolean(schedule?.enabled),
                lastSuccessfulRunAt: schedule?.lastRunAt || run?.completedAt || scheduler.lastSuccessfulRunAt || null,
                nextRunAt: schedule?.nextRunAt || null,
                latestArtifactStatus: run?.status || schedule?.lastRunStatus || null,
                dueTaskCount,
                leaseActive: Boolean(schedule?.leaseUntil && new Date(schedule.leaseUntil) > now)
            },
            safeDetails: {
                scheduleFound: Boolean(schedule),
                latestRunFound: Boolean(run),
                lastErrorPresent: Boolean(schedule?.lastError)
            }
        };
    }

    async _probeGoogleIntelligence() {
        const now = this.now();
        const [schedule, snapshot, run] = await Promise.all([
            this._latest(GoogleIntelligenceSchedule, {
                select: 'enabled strictGate maxSnapshotAgeHours lastRunAt nextRunAt lastRunStatus lastError leaseUntil',
                sort: { updatedAt: -1 }
            }),
            this._latest(GoogleIntelligenceSnapshot, {
                select: 'status checkedAt mandatorySourcesSucceeded failedSources',
                sort: { checkedAt: -1 }
            }),
            this._latest(GoogleIntelligenceRun, {
                select: 'status completedAt createdAt',
                sort: { createdAt: -1 }
            })
        ]);
        const scheduler = await this._schedulerRuntime();
        const maxAgeMs = Math.max(1, Number(schedule?.maxSnapshotAgeHours || 24)) * 60 * 60 * 1000;
        const stale = !snapshot?.checkedAt || now.getTime() - new Date(snapshot.checkedAt).getTime() > maxAgeMs;
        const runtimeIssue = schedulerRuntimeIssue({
            scheduler,
            workloadKey: 'googleIntelligence',
            now,
            nextRunAt: schedule?.nextRunAt,
            persistedActivityAt: snapshot?.checkedAt || run?.completedAt || schedule?.lastRunAt
        });
        let status = runtimeIssue?.status || 'healthy';
        let reasonCode = runtimeIssue?.reasonCode || 'runtime_verified';
        if (!runtimeIssue && !schedule) {
            status = 'degraded';
            reasonCode = 'persisted_schedule_missing';
        } else if (!runtimeIssue && !schedule.enabled) {
            status = 'degraded';
            reasonCode = 'persisted_schedule_disabled';
        } else if (!runtimeIssue && !schedule.strictGate) {
            status = 'degraded';
            reasonCode = 'strict_mode_disabled';
        } else if (!runtimeIssue && !snapshot) {
            status = 'degraded';
            reasonCode = 'no_snapshot';
        } else if (!runtimeIssue && stale) {
            status = 'degraded';
            reasonCode = 'snapshot_stale';
        } else if (!runtimeIssue && (['partial', 'failed'].includes(snapshot.status) || !snapshot.mandatorySourcesSucceeded || schedule?.lastError)) {
            status = 'degraded';
            reasonCode = 'latest_snapshot_degraded';
        }
        return {
            status,
            reasonCode,
            runtime: {
                ...scheduler,
                persistedScheduleEnabled: Boolean(schedule?.enabled),
                lastSuccessfulRunAt: snapshot?.checkedAt || run?.completedAt || schedule?.lastRunAt || null,
                nextRunAt: schedule?.nextRunAt || null,
                latestArtifactStatus: snapshot?.status || run?.status || null,
                leaseActive: Boolean(schedule?.leaseUntil && new Date(schedule.leaseUntil) > now)
            },
            safeDetails: {
                scheduleFound: Boolean(schedule),
                snapshotFound: Boolean(snapshot),
                runFound: Boolean(run),
                strictMode: Boolean(schedule?.strictGate),
                snapshotStale: stale,
                mandatorySourcesSucceeded: Boolean(snapshot?.mandatorySourcesSucceeded),
                failedSourceCount: Number(snapshot?.failedSources || 0),
                lastErrorPresent: Boolean(schedule?.lastError)
            }
        };
    }

    async _probePersistedSource(source) {
        const snapshot = await this._latest(ContentOperationsDailySnapshot, {
            select: 'status checkedAt sourceHealth',
            sort: { checkedAt: -1 }
        });
        const health = snapshot?.sourceHealth?.find((entry) => entry?.source === source) || null;
        const available = health?.status === 'available';
        const partial = health?.status === 'partial';
        const checkedAt = health?.checkedAt || snapshot?.checkedAt || null;
        const checkedAtMs = checkedAt ? new Date(checkedAt).getTime() : Number.NaN;
        const maxAgeMs = getContentOperationsConfig(this.envProvider()).snapshotMaxAgeHours * 60 * 60 * 1000;
        const stale = !Number.isFinite(checkedAtMs) || this.now().getTime() - checkedAtMs > maxAgeMs;
        const adapterRegistered = ['google_search_console', 'first_party_aggregate_analytics', 'trends'].includes(source);
        const sourceReady = available && !stale && snapshot?.status === 'complete' && adapterRegistered;
        const reasonCode = sourceReady ? 'runtime_verified' : stale && health ? 'persisted_source_stale' : !adapterRegistered ? 'source_adapter_not_registered' : snapshot && snapshot.status !== 'complete' ? 'source_snapshot_not_complete' : partial ? 'persisted_source_partial' : health ? 'persisted_source_unavailable' : 'no_persisted_source_check';
        return {
            status: sourceReady ? 'healthy' : 'degraded',
            reasonCode,
            runtime: {
                serviceRegistered: adapterRegistered,
                lastSuccessfulRunAt: available ? checkedAt : null,
                latestArtifactStatus: health?.status || snapshot?.status || null
            },
            warnings: health?.errorCode ? ['persisted_source_error'] : health ? [] : ['no_persisted_source_check'],
            safeDetails: {
                snapshotFound: Boolean(snapshot),
                sourceRecordFound: Boolean(health),
                sourceConfigured: Boolean(health?.configured),
                sourceEnabled: health?.enabled ?? null,
                adapterRegistered,
                stale
            }
        };
    }

    async _probeInventory() {
        const snapshot = await this._latest(ContentInventorySnapshot, {
            select: 'status checkedAt itemCount warnings errorCodes',
            sort: { checkedAt: -1 }
        });
        const hasWarnings = Boolean(snapshot?.warnings?.length || snapshot?.errorCodes?.length);
        const snapshotFreshness = freshnessState(snapshot?.checkedAt, {
            now: this.now(),
            maxAgeHours: getContentOperationsConfig(this.envProvider()).inventory.maxAgeHours
        });
        const snapshotReady = snapshot?.status === 'complete' && !hasWarnings && !snapshotFreshness.stale;
        return {
            status: snapshotReady ? 'healthy' : 'degraded',
            reasonCode: snapshotReady ? 'runtime_verified' : hasWarnings ? 'persisted_inventory_warning' : snapshot?.status === 'complete' && snapshotFreshness.stale ? 'snapshot_stale' : snapshot ? 'latest_snapshot_not_complete' : 'no_snapshot',
            runtime: {
                serviceRegistered: true,
                lastSuccessfulRunAt: snapshot?.checkedAt || null,
                latestArtifactStatus: snapshot?.status || null
            },
            warnings: snapshot ? (snapshot.warnings?.length || snapshot.errorCodes?.length ? ['persisted_inventory_warning'] : snapshotFreshness.stale ? ['snapshot_stale'] : []) : ['no_inventory_snapshot'],
            safeDetails: {
                snapshotFound: Boolean(snapshot),
                itemCount: Number(snapshot?.itemCount || 0),
                warningCount: snapshot?.warnings?.length || 0,
                errorCount: snapshot?.errorCodes?.length || 0,
                stale: snapshotFreshness.stale
            }
        };
    }

    async _probeContentSignals() {
        const signal = await this._latest(ContentSignal, {
            select: 'status priority expiresAt createdAt',
            sort: { createdAt: -1 }
        });
        const expiresAt = signal?.expiresAt ? new Date(signal.expiresAt).getTime() : Number.NaN;
        const usable = Boolean(signal && ['new', 'reviewed', 'used'].includes(String(signal.status || '')) && Number.isFinite(expiresAt) && expiresAt > this.now().getTime());
        return {
            status: usable ? 'healthy' : 'degraded',
            reasonCode: usable ? 'runtime_verified' : signal ? 'latest_content_signal_inactive' : 'no_content_signal_records',
            runtime: {
                serviceRegistered: true,
                lastSuccessfulRunAt: signal?.createdAt || null,
                latestArtifactStatus: signal?.status || null
            },
            warnings: usable ? [] : [signal ? 'latest_content_signal_inactive' : 'no_content_signal_records'],
            safeDetails: { latestRecordFound: Boolean(signal), usable }
        };
    }

    async _probePerformanceMonitoring() {
        const snapshot = await this._latest(ContentPerformanceSnapshot, {
            select: 'measuredAt window warnings createdAt',
            sort: { measuredAt: -1 }
        });
        const scheduler = await this._schedulerRuntime();
        const workloadActive = Boolean(scheduler.enabledWorkloads?.performanceMonitoring);
        const hasWarnings = Boolean(snapshot?.warnings?.length);
        const runtimeIssue = schedulerRuntimeIssue({
            scheduler,
            workloadKey: 'performanceMonitoring',
            now: this.now()
        });
        return {
            status: runtimeIssue?.status || (workloadActive && snapshot && !hasWarnings ? 'healthy' : 'degraded'),
            reasonCode: runtimeIssue?.reasonCode || (hasWarnings ? 'persisted_performance_warning' : snapshot ? 'runtime_verified' : 'no_performance_snapshot'),
            runtime: {
                ...scheduler,
                lastSuccessfulRunAt: snapshot?.measuredAt || scheduler.lastSuccessfulRunAt || null,
                latestArtifactStatus: snapshot?.window || null
            },
            warnings: snapshot ? (snapshot.warnings?.length ? ['persisted_performance_warning'] : []) : ['no_performance_snapshot'],
            safeDetails: {
                latestSnapshotFound: Boolean(snapshot),
                warningCount: snapshot?.warnings?.length || 0
            }
        };
    }

    async _probeLearning() {
        const record = await this._latest(ContentLearningRecord, {
            select: 'status recommendation autoApplied createdAt updatedAt',
            sort: { createdAt: -1 }
        });
        const config = getContentOperationsConfig(this.envProvider());
        if (!config.enabled) {
            return {
                status: 'degraded',
                reasonCode: 'parent_feature_disabled',
                runtime: {
                    serviceRegistered: true,
                    lastSuccessfulRunAt: record?.createdAt || null,
                    latestArtifactStatus: record?.status || null
                },
                warnings: ['content_operations_disabled'],
                safeDetails: {
                    latestRecordFound: Boolean(record),
                    autoApply: config.learning.autoApply
                }
            };
        }
        if (!config.learning.autoApply) {
            return {
                status: 'manual_review',
                reasonCode: 'manual_review_required',
                runtime: {
                    serviceRegistered: true,
                    lastSuccessfulRunAt: record?.createdAt || null,
                    latestArtifactStatus: record?.status || null
                },
                warnings: ['content_learning_auto_apply_disabled'],
                safeDetails: { latestRecordFound: Boolean(record), autoApply: false }
            };
        }
        return {
            status: record ? 'healthy' : 'degraded',
            reasonCode: record ? 'runtime_verified' : 'no_learning_record',
            runtime: {
                serviceRegistered: true,
                lastSuccessfulRunAt: record?.createdAt || null,
                latestArtifactStatus: record?.status || null
            },
            safeDetails: { latestRecordFound: Boolean(record), autoApply: true }
        };
    }

    async _probeImagePipeline() {
        const pipelineFilter = {
            'metadata.imagePipelineStatus': {
                $in: ['pending', 'partial', 'complete', 'failed']
            }
        };
        const artifactFilter = {
            sourceType: 'agentic',
            agenticExecutionId: { $ne: null },
            imagePipelineStatus: {
                $in: ['pending', 'partial', 'complete', 'failed']
            }
        };
        const [execution, successfulExecution, artifact, successfulArtifact] = await Promise.all([
            this._latest(BlogAutomationExecution, {
                filter: pipelineFilter,
                select: 'metadata.imagePipelineStatus completedAt createdAt updatedAt',
                sort: { updatedAt: -1, createdAt: -1 }
            }),
            this._latest(BlogAutomationExecution, {
                filter: { 'metadata.imagePipelineStatus': 'complete' },
                select: 'completedAt createdAt updatedAt',
                sort: { completedAt: -1, updatedAt: -1, createdAt: -1 }
            }),
            this._latest(Blog, {
                filter: artifactFilter,
                select: ['agenticExecutionId imagePipelineStatus createdAt updatedAt', 'coverImage.status coverImage.reviewStatus coverImage.qualityReview.manualReviewRequired', 'contentImages.status contentImages.reviewStatus contentImages.qualityReview.manualReviewRequired'].join(' '),
                sort: { createdAt: -1 }
            }),
            this._latest(Blog, {
                filter: { ...artifactFilter, imagePipelineStatus: 'complete' },
                select: 'agenticExecutionId imagePipelineStatus createdAt updatedAt',
                sort: { createdAt: -1 }
            })
        ]);
        const executionObservedAt = execution?.completedAt || execution?.updatedAt || execution?.createdAt || null;
        const artifactObservedAt = artifact?.createdAt || null;
        const sameExecution = Boolean(execution?._id && artifact?.agenticExecutionId && String(execution._id) === String(artifact.agenticExecutionId));
        const useArtifact = Boolean(artifact && (sameExecution || !execution || new Date(artifactObservedAt).getTime() > new Date(executionObservedAt).getTime()));
        const pipelineStatus = String(useArtifact ? artifact?.imagePipelineStatus : execution?.metadata?.imagePipelineStatus || '');
        const artifactImages = useArtifact ? [artifact?.coverImage, ...(Array.isArray(artifact?.contentImages) ? artifact.contentImages : [])].filter(Boolean) : [];
        const manualReviewCount = artifactImages.filter((image) => image?.status === 'needs_review' && image?.qualityReview?.manualReviewRequired === true).length;
        const pendingGenerationCount = artifactImages.filter((image) => image?.status === 'pending_generation').length;
        const failedImageCount = artifactImages.filter((image) => image?.status === 'failed' || image?.status === 'rejected').length;
        const approvalOnlyPartial = pipelineStatus === 'partial' && artifactImages.length > 0 && manualReviewCount > 0 && pendingGenerationCount === 0 && failedImageCount === 0 && artifactImages.every((image) => image?.status === 'complete' || (image?.status === 'needs_review' && image?.qualityReview?.manualReviewRequired === true));
        const successfulExecutionAt = successfulExecution?.completedAt || successfulExecution?.updatedAt || successfulExecution?.createdAt || null;
        const successfulArtifactAt = successfulArtifact?.createdAt || null;
        const lastSuccessfulRunAt = new Date(successfulArtifactAt).getTime() > new Date(successfulExecutionAt).getTime() ? successfulArtifactAt : successfulExecutionAt;
        const evidenceFound = Boolean(useArtifact ? artifact : execution);
        return {
            status: pipelineStatus === 'complete' ? 'healthy' : pipelineStatus === 'failed' ? 'failed' : approvalOnlyPartial ? 'manual_review' : 'degraded',
            reasonCode: !evidenceFound ? 'no_image_pipeline_history' : pipelineStatus === 'failed' ? 'latest_pipeline_failed' : pipelineStatus === 'complete' ? 'runtime_verified' : approvalOnlyPartial ? 'image_approval_required' : 'latest_snapshot_not_complete',
            runtime: {
                serviceRegistered: true,
                lastSuccessfulRunAt,
                latestArtifactStatus: pipelineStatus || null
            },
            warnings: !evidenceFound ? ['no_image_pipeline_history'] : approvalOnlyPartial ? ['image_manual_review_required'] : [],
            safeDetails: {
                latestResultFound: evidenceFound,
                evidenceSource: useArtifact ? 'blog_artifact' : execution ? 'execution_metadata' : 'none',
                imageCount: artifactImages.length,
                manualReviewCount,
                pendingGenerationCount,
                failedImageCount
            }
        };
    }

    async _probeTelegram(definition) {
        const mode = definition.configDetails?.mode || 'webhook';
        return {
            status: 'manual_review',
            reasonCode: 'external_delivery_not_probed',
            runtime: {
                serviceRegistered: true,
                workerActive: mode === 'polling' ? null : false,
                schedulerActive: mode === 'polling' ? null : false,
                latestArtifactStatus: 'configuration_only'
            },
            warnings: ['telegram_bot_api_not_called_by_health_check'],
            safeDetails: { ...definition.configDetails, runtimeVerified: false }
        };
    }

    async _probeGateway() {
        const health = await this.gatewayProbe({
            timeoutMs: Math.min(this.timeoutMs, 5000),
            env: this.envProvider()
        });
        const authenticationFailed = health.authenticated === false;
        const ready = Boolean(health.ready) && !authenticationFailed;
        return {
            status: ready ? 'healthy' : authenticationFailed ? 'failed' : health.live ? 'degraded' : 'failed',
            reasonCode: ready ? 'runtime_verified' : health.error || 'gateway_not_ready',
            runtime: {
                serviceRegistered: Boolean(health.reachable),
                workerActive: Boolean(health.live),
                schedulerActive: false,
                lastHeartbeatAt: health.checkedAt,
                latestArtifactStatus: ready ? 'ready' : authenticationFailed ? 'authentication_failed' : health.live ? 'live_not_ready' : 'unreachable'
            },
            safeDetails: {
                reachable: Boolean(health.reachable),
                live: Boolean(health.live),
                ready,
                authenticated: typeof health.authenticated === 'boolean' ? health.authenticated : null,
                livenessStatus: Number(health.livenessStatus || 0) || null,
                readinessStatus: Number(health.readinessStatus || 0) || null,
                authenticationStatus: Number(health.authenticationStatus || 0) || null
            }
        };
    }

    async _defaultProbe(definition) {
        switch (definition.dashboardKey) {
            case 'seoAgent':
                return this._probeExecutionHistory();
            case 'contentOperations':
                return this._probeContentOperations();
            case 'blogCron':
                return this._probeBlogCron();
            case 'contentOperationsCron':
                return this._probeContentOperationsCron();
            case 'googleIntelligence':
                return this._probeGoogleIntelligence();
            case 'searchConsole':
                return this._probePersistedSource('google_search_console');
            case 'aggregateAnalytics':
                return this._probePersistedSource('first_party_aggregate_analytics');
            case 'trends':
                return this._probePersistedSource('trends');
            case 'inventory':
                return this._probeInventory();
            case 'contentSignals':
                return this._probeContentSignals();
            case 'performanceMonitoring':
                return this._probePerformanceMonitoring();
            case 'learning':
                return this._probeLearning();
            case 'imagePipeline':
                return this._probeImagePipeline();
            case 'imageSearch':
            case 'aiImage':
                return {
                    status: 'manual_review',
                    reasonCode: 'external_provider_not_probed',
                    runtime: {
                        serviceRegistered: true,
                        latestArtifactStatus: 'configured'
                    },
                    warnings: ['external_provider_not_called_by_health_check'],
                    safeDetails: { providerConfigured: true, runtimeVerified: false }
                };
            case 'telegram':
                return this._probeTelegram(definition);
            case 'openclawGateway':
                return this._probeGateway();
            default:
                return { status: 'not_applicable', reasonCode: 'probe_not_registered' };
        }
    }
}

const OpenClawCapabilityHealthService = new CapabilityHealthService();

module.exports = {
    CAPABILITY_META,
    CAPABILITY_STATUSES,
    CapabilityHealthService,
    OpenClawCapabilityHealthService,
    buildCapabilityDefinitions,
    buildCapabilityMatrix,
    canonicalCapability,
    capabilityStatus,
    probeOpenClawGateway,
    sanitizeSafeValue,
    isPrivateGatewayHost,
    stripSensitiveUrlParts
};
