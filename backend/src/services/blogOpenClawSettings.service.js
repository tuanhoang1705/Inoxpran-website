'use strict'

const { parseBoolean, DEFAULT_TIMEZONE } = require('../utils/blogSchedule.util');
const { isProductionEnv } = require('../config/runtimeEnv');

// Central Blog OpenClaw (BOS) configuration resolver.
// Every execution resolves one effective, non-secret configuration snapshot
// from hard defaults, validated environment configuration, and the
// schedule-level user guidance. Secrets must never be added here.
const CONFIG_VERSION = 'bos-config-v1';
const POLICY_VERSION = 'content-operations-v3';
const DECISION_VERSION = 'opportunity-decision-v3';

const resolveBlogOpenClawConfig = ({ schedule = {}, now = new Date() } = {}) => ({
    configVersion: CONFIG_VERSION,
    policyVersion: POLICY_VERSION,
    decisionVersion: DECISION_VERSION,
    resolvedAt: now.toISOString(),
    scheduleId: schedule._id ? String(schedule._id) : String(schedule.id || ''),
    simpleContract: schedule.agentConfig?.simpleContract === true,
    timezone: schedule.timezone || DEFAULT_TIMEZONE,
    mode: schedule.mode || 'fixed_brief',
    draftOnly: isProductionEnv() || schedule.draftOnly !== false,
    allowSkip: schedule.allowSkip !== false,
    autoPublish: isProductionEnv() || schedule.draftOnly !== false ? false : Boolean(schedule.autoPublish),
    minimumOpportunityScore: Number(schedule.minimumOpportunityScore ?? 0.65),
    maximumTasksPerDay: Number(schedule.maximumTasksPerDay || 0),
    runtime: {
        cronEnabled: parseBoolean(process.env.OPENCLAW_BLOG_CRON_ENABLED, false),
        seoAgentEnabled: parseBoolean(process.env.SEO_AGENT_ENABLED, false),
        autoPublishEnabled: parseBoolean(process.env.SEO_AGENT_AUTO_PUBLISH, false),
        qaRuntimeEnabled: parseBoolean(process.env.AGENTIC_BLOG_QA_ENABLED, false)
    }
});

module.exports = {
    BLOG_OPENCLAW_CONFIG_VERSION: CONFIG_VERSION,
    BLOG_OPENCLAW_POLICY_VERSION: POLICY_VERSION,
    BLOG_OPENCLAW_DECISION_VERSION: DECISION_VERSION,
    resolveBlogOpenClawConfig
};
