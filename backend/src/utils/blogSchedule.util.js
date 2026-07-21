'use strict'

const { BadRequestError } = require('../core/error.response');
const { normalizeString } = require('./seoBlogSanitizer');
const { buildEnvProductSeedingConfig, normalizeProductSeedingOptions } = require('../config/productSeeding.config');
const { buildEnvProductPlacementConfig, normalizeProductPlacementOptions } = require('../config/productPlacement.config');

const DEFAULT_TIMEZONE = 'Asia/Ho_Chi_Minh';
const MAX_TIMES_PER_SCHEDULE = 12;
const MAX_RUN_LIMIT = 3650;
const MIN_INTERVAL_MINUTES = 5;
const SCHEDULE_MODES = Object.freeze(['best_action', 'fixed_brief', 'maintenance_only']);
const MONITORING_WINDOWS = Object.freeze(['1d', '7d', '14d', '30d', '90d']);
const SOURCE_REQUIREMENT_ALIASES = Object.freeze({
    searchConsole: 'google_search_console', search_console: 'google_search_console',
    analytics: 'first_party_aggregate_analytics',
    contentInventory: 'content_inventory', content_inventory: 'content_inventory',
    products: 'product_catalog', inventory: 'product_catalog',
    salesSignals: 'content_signals', customerSupportSignals: 'content_signals',
    internalSearchSignals: 'content_signals', campaignSignals: 'content_signals'
});
const SOURCE_REQUIREMENTS = Object.freeze([
    'google_intelligence', 'google_search_console', 'first_party_aggregate_analytics',
    'trends', 'content_inventory', 'product_catalog', 'content_signals'
]);
const CONTENT_ACTIONS = Object.freeze([
    'new', 'update', 'expand', 'merge', 'metadata_refresh',
    'internal_link_maintenance', 'content_maintenance', 'skip'
]);

const parseBoolean = (value, fallback = false) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    if (typeof value !== 'string') return fallback;
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on', 'publish'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off', 'draft'].includes(normalized)) return false;
    return fallback;
};

const parseInteger = (value, fallback = 0) => {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : fallback;
};

const parseDate = (value) => {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date;
};

const assertTimeZone = (timezone) => {
    const normalized = normalizeString(timezone || DEFAULT_TIMEZONE) || DEFAULT_TIMEZONE;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: normalized }).format(new Date());
        return normalized;
    } catch {
        throw new BadRequestError('timezone is invalid');
    }
};

const normalizeTime = (value) => {
    const raw = normalizeString(value);
    const match = raw.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
    if (!match) return '';
    return `${match[1].padStart(2, '0')}:${match[2]}`;
};

const normalizeTimes = (value) => {
    const source = Array.isArray(value)
        ? value
        : String(value || '')
            .split(',')
            .map((item) => item.trim());
    const seen = new Set();
    const times = [];
    source.forEach((item) => {
        const time = normalizeTime(item);
        if (!time || seen.has(time)) return;
        seen.add(time);
        times.push(time);
    });
    return times.sort();
};

const normalizeDaysOfWeek = (value) => {
    const source = Array.isArray(value)
        ? value
        : String(value || '')
            .split(',')
            .map((item) => item.trim());
    const seen = new Set();
    const days = [];
    source.forEach((item) => {
        const day = parseInteger(item, -1);
        if (day < 0 || day > 6 || seen.has(day)) return;
        seen.add(day);
        days.push(day);
    });
    return days.sort((a, b) => a - b);
};

const assertTimes = (times, fieldName) => {
    if (!times.length) throw new BadRequestError(`${fieldName} requires at least one HH:mm time`);
    if (times.length > MAX_TIMES_PER_SCHEDULE) {
        throw new BadRequestError(`${fieldName} supports at most ${MAX_TIMES_PER_SCHEDULE} times`);
    }
};

const intervalToMinutes = ({ value, unit }) => {
    const safeValue = Math.max(1, Number(value) || 0);
    if (unit === 'minutes') return safeValue;
    if (unit === 'hours') return safeValue * 60;
    if (unit === 'days') return safeValue * 24 * 60;
    return 0;
};

const MAX_AGENT_TOPIC_LENGTH = 300;

const normalizeObjectId = (value, field) => {
    const normalized = normalizeString(value || '');
    if (normalized && !/^[a-f\d]{24}$/i.test(normalized)) throw new BadRequestError(`${field} is invalid`);
    return normalized;
};

const normalizeAgentConfig = (value = {}, operations = {}) => {
    const config = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const topic = normalizeString(config.topic || config.primaryKeyword || 'noi inox cho gia dinh');
    if (topic.length > MAX_AGENT_TOPIC_LENGTH) {
        throw new BadRequestError(`Topic must be at most ${MAX_AGENT_TOPIC_LENGTH} characters (received ${topic.length}). Use a short subject phrase.`);
    }
    const contentAction = normalizeString(config.contentAction || config.action || operations.selectedAction || '');
    if (contentAction && !CONTENT_ACTIONS.includes(contentAction)) throw new BadRequestError('agentConfig.contentAction is invalid');
    const mergeSourceBlogIds = Array.isArray(config.mergeSourceBlogIds)
        ? [...new Set(config.mergeSourceBlogIds.map((item) => normalizeObjectId(item, 'agentConfig.mergeSourceBlogIds')).filter(Boolean))]
        : [];
    return {
        topic,
        primaryKeyword: normalizeString(config.primaryKeyword || config.topic || 'noi inox'),
        secondaryKeywords: Array.isArray(config.secondaryKeywords)
            ? config.secondaryKeywords.map((item) => normalizeString(item)).filter(Boolean).slice(0, 12)
            : String(config.secondaryKeywords || '')
                .split(',')
                .map((item) => normalizeString(item))
                .filter(Boolean)
                .slice(0, 12),
        categoryKey: normalizeString(config.categoryKey || 'guide').toLowerCase(),
        articleType: normalizeString(config.articleType || 'how-to'),
        language: normalizeString(config.language || 'vi'),
        tone: normalizeString(config.tone || 'practical'),
        generateImages: parseBoolean(config.generateImages, true),
        researchSources: Array.isArray(config.researchSources)
            ? config.researchSources.map((item) => normalizeString(item)).filter(Boolean).slice(0, 12)
            : String(config.researchSources || '')
                .split(',')
                .map((item) => normalizeString(item))
                .filter(Boolean)
                .slice(0, 12),
        prompt: normalizeString(config.prompt || ''),
        contentAction,
        workOrderId: normalizeObjectId(config.workOrderId || config.selectedWorkOrderId || operations.selectedWorkOrderId, 'agentConfig.workOrderId'),
        targetBlogId: normalizeObjectId(config.targetBlogId, 'agentConfig.targetBlogId'),
        mergeSourceBlogIds,
        primaryBusinessGoal: normalizeString(config.primaryBusinessGoal || ''),
        successMetrics: Array.isArray(config.successMetrics) ? config.successMetrics.slice(0, 20) : [],
        productSeeding: normalizeProductSeedingOptions(
            config.productSeeding || {},
            buildEnvProductSeedingConfig()
        ),
        productPlacement: normalizeProductPlacementOptions(
            config.productPlacement || {},
            buildEnvProductPlacementConfig()
        ),
        rankingEvidence: config.rankingEvidence && typeof config.rankingEvidence === 'object' ? config.rankingEvidence : null
    };
};

const normalizeSchedulePayload = (payload = {}) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new BadRequestError('schedule payload must be an object');
    const operations = payload.contentOperations && typeof payload.contentOperations === 'object' && !Array.isArray(payload.contentOperations)
        ? payload.contentOperations
        : {};
    const name = normalizeString(payload.name);
    if (!name) throw new BadRequestError('name is required');

    const scheduleType = normalizeString(payload.scheduleType || 'daily').toLowerCase();
    if (!['daily', 'weekly', 'interval'].includes(scheduleType)) {
        throw new BadRequestError('scheduleType must be daily, weekly, or interval');
    }

    const timezone = assertTimeZone(payload.timezone || DEFAULT_TIMEZONE);
    const startAt = parseDate(payload.startAt);
    const endAt = parseDate(payload.endAt);
    if (startAt && endAt && endAt.getTime() <= startAt.getTime()) {
        throw new BadRequestError('endAt must be after startAt');
    }

    const runLimit = Math.min(Math.max(parseInteger(payload.runLimit, 0), 0), MAX_RUN_LIMIT);
    const dailyTimes = normalizeTimes(payload.daily?.times ?? payload.dailyTimes);
    const weeklyTimes = normalizeTimes(payload.weekly?.times ?? payload.weeklyTimes);
    const daysOfWeek = normalizeDaysOfWeek(payload.weekly?.daysOfWeek ?? payload.daysOfWeek);
    const intervalUnit = normalizeString(payload.interval?.unit || payload.intervalUnit || 'hours').toLowerCase();
    const intervalValue = Math.max(1, parseInteger(payload.interval?.value ?? payload.intervalValue, 24));

    if (scheduleType === 'daily') {
        assertTimes(dailyTimes, 'daily');
    }
    if (scheduleType === 'weekly') {
        if (!daysOfWeek.length) throw new BadRequestError('weekly requires at least one day');
        assertTimes(weeklyTimes, 'weekly');
    }
    if (scheduleType === 'interval') {
        if (!['minutes', 'hours', 'days'].includes(intervalUnit)) {
            throw new BadRequestError('interval.unit must be minutes, hours, or days');
        }
        if (intervalToMinutes({ value: intervalValue, unit: intervalUnit }) < MIN_INTERVAL_MINUTES) {
            throw new BadRequestError(`interval must be at least ${MIN_INTERVAL_MINUTES} minutes`);
        }
    }

    const mode = normalizeString(payload.mode || operations.mode || 'fixed_brief').toLowerCase();
    if (!SCHEDULE_MODES.includes(mode)) {
        throw new BadRequestError(`mode must be one of: ${SCHEDULE_MODES.join(', ')}`);
    }
    const draftOnlyInput = payload.draftOnly ?? operations.draftOnly;
    if (draftOnlyInput !== undefined && typeof draftOnlyInput !== 'boolean') throw new BadRequestError('draftOnly must be a boolean');
    const draftOnly = draftOnlyInput === undefined ? true : draftOnlyInput;
    const sourceInput = payload.sourceRequirements ?? operations.sourceRequirements ?? [];
    if (!Array.isArray(sourceInput)) throw new BadRequestError('sourceRequirements must be an array');
    const sourceRequirements = [...new Set(sourceInput.map((item) => {
        const raw = normalizeString(item);
        return SOURCE_REQUIREMENT_ALIASES[raw] || raw;
    }).filter(Boolean))].slice(0, 12);
    const invalidSource = sourceRequirements.find((item) => !SOURCE_REQUIREMENTS.includes(item));
    if (invalidSource) throw new BadRequestError(`sourceRequirements contains unsupported source: ${invalidSource}`);
    const monitoringInput = payload.monitoringWindows ?? operations.monitoringWindows ?? MONITORING_WINDOWS;
    if (!Array.isArray(monitoringInput)) throw new BadRequestError('monitoringWindows must be an array');
    const monitoringWindows = [...new Set(monitoringInput.map((item) => {
        const raw = normalizeString(item).toLowerCase();
        return /^\d+$/.test(raw) ? `${raw}d` : raw;
    }))];
    const invalidWindow = monitoringWindows.find((item) => !MONITORING_WINDOWS.includes(item));
    if (invalidWindow) throw new BadRequestError(`monitoringWindows contains unsupported window: ${invalidWindow}`);
    const minimumOpportunityScore = Number(payload.minimumOpportunityScore ?? operations.minimumOpportunityScore ?? 0.65);
    if (!Number.isFinite(minimumOpportunityScore) || minimumOpportunityScore < 0 || minimumOpportunityScore > 1) {
        throw new BadRequestError('minimumOpportunityScore must be between 0 and 1');
    }
    const allowSkipInput = payload.allowSkip ?? operations.allowSkip;
    if (allowSkipInput !== undefined && typeof allowSkipInput !== 'boolean') throw new BadRequestError('allowSkip must be a boolean');
    const maximumTasksPerDay = Number(payload.maximumTasksPerDay ?? payload.maxTasksPerDay ?? operations.maximumTasksPerDay ?? operations.maxTasksPerDay ?? 1);
    if (!Number.isInteger(maximumTasksPerDay) || maximumTasksPerDay < 1 || maximumTasksPerDay > 24) {
        throw new BadRequestError('maximumTasksPerDay must be an integer between 1 and 24');
    }

    return {
        name,
        description: normalizeString(payload.description).slice(0, 500),
        enabled: parseBoolean(payload.enabled, true),
        scheduleType,
        timezone,
        daily: { times: dailyTimes },
        weekly: { daysOfWeek, times: weeklyTimes },
        interval: { value: intervalValue, unit: intervalUnit },
        runLimit,
        startAt,
        endAt,
        autoPublish: draftOnly ? false : parseBoolean(payload.autoPublish, false),
        mode,
        sourceRequirements,
        minimumOpportunityScore,
        allowSkip: allowSkipInput === undefined ? true : allowSkipInput,
        draftOnly,
        maximumTasksPerDay,
        monitoringWindows: monitoringWindows.length ? monitoringWindows : [...MONITORING_WINDOWS],
        agentConfig: normalizeAgentConfig(payload.agentConfig || {}, operations)
    };
};

const getZonedParts = (date, timeZone) => {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
    });
    const values = Object.fromEntries(
        formatter.formatToParts(date)
            .filter((part) => part.type !== 'literal')
            .map((part) => [part.type, Number(part.value)])
    );
    return {
        year: values.year,
        month: values.month,
        day: values.day,
        hour: values.hour,
        minute: values.minute,
        second: values.second || 0
    };
};

const getTimeZoneOffset = (date, timeZone) => {
    const parts = getZonedParts(date, timeZone);
    const localAsUtc = Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour,
        parts.minute,
        parts.second
    );
    return localAsUtc - date.getTime();
};

const zonedTimeToUtc = ({ year, month, day, hour = 0, minute = 0, second = 0, timeZone }) => {
    const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
    let utc = new Date(localAsUtc - getTimeZoneOffset(new Date(localAsUtc), timeZone));
    const actual = getZonedParts(utc, timeZone);
    const actualAsUtc = Date.UTC(
        actual.year,
        actual.month - 1,
        actual.day,
        actual.hour,
        actual.minute,
        actual.second
    );
    const drift = localAsUtc - actualAsUtc;
    if (drift) utc = new Date(utc.getTime() + drift);
    return utc;
};

const localDatePlusDays = ({ year, month, day, addDays }) => {
    const date = new Date(Date.UTC(year, month - 1, day + addDays));
    return {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate()
    };
};

const localDayOfWeek = ({ year, month, day }) =>
    new Date(Date.UTC(year, month - 1, day)).getUTCDay();

const splitTime = (time) => {
    const [hour, minute] = String(time).split(':').map((item) => Number(item));
    return { hour, minute };
};

const isScheduleExhausted = (schedule = {}) => {
    const runLimit = Number(schedule.runLimit || 0);
    const runCount = Number(schedule.runCount || 0);
    return runLimit > 0 && runCount >= runLimit;
};

const capByEndAt = (candidate, schedule = {}) => {
    const endAt = parseDate(schedule.endAt);
    if (endAt && candidate && candidate.getTime() > endAt.getTime()) return null;
    return candidate;
};

const calculateNextRun = ({ schedule = {}, from = new Date() }) => {
    if (!schedule.enabled || isScheduleExhausted(schedule)) return null;
    const timezone = assertTimeZone(schedule.timezone || DEFAULT_TIMEZONE);
    const startAt = parseDate(schedule.startAt);
    const searchFrom = startAt && startAt.getTime() > from.getTime() ? startAt : from;
    const endAt = parseDate(schedule.endAt);
    if (endAt && searchFrom.getTime() > endAt.getTime()) return null;

    if (schedule.scheduleType === 'interval') {
        const minutes = intervalToMinutes(schedule.interval || {});
        const intervalMs = minutes * 60 * 1000;
        const base =
            schedule.lastRunAt
                ? parseDate(schedule.lastRunAt)
                : startAt && startAt.getTime() > from.getTime()
                  ? startAt
                  : from;
        const candidate = schedule.lastRunAt
            ? new Date(base.getTime() + intervalMs)
            : new Date(base.getTime() + (base === from ? intervalMs : 0));
        return capByEndAt(candidate, schedule);
    }

    const parts = getZonedParts(searchFrom, timezone);
    const times =
        schedule.scheduleType === 'weekly'
            ? schedule.weekly?.times || []
            : schedule.daily?.times || [];
    const days = schedule.weekly?.daysOfWeek || [];

    for (let addDays = 0; addDays <= 370; addDays += 1) {
        const localDate = localDatePlusDays({ ...parts, addDays });
        if (schedule.scheduleType === 'weekly' && !days.includes(localDayOfWeek(localDate))) {
            continue;
        }
        for (const time of times) {
            const { hour, minute } = splitTime(time);
            const candidate = zonedTimeToUtc({ ...localDate, hour, minute, timeZone: timezone });
            if (candidate.getTime() > searchFrom.getTime()) {
                return capByEndAt(candidate, schedule);
            }
        }
    }

    return null;
};

const describeSchedule = (schedule = {}) => {
    if (schedule.scheduleType === 'daily') {
        return `Daily at ${(schedule.daily?.times || []).join(', ')} ${schedule.timezone || DEFAULT_TIMEZONE}`;
    }
    if (schedule.scheduleType === 'weekly') {
        return `Weekly days ${(schedule.weekly?.daysOfWeek || []).join(', ')} at ${(schedule.weekly?.times || []).join(', ')} ${schedule.timezone || DEFAULT_TIMEZONE}`;
    }
    const interval = schedule.interval || {};
    return `Every ${interval.value || 1} ${interval.unit || 'hours'}`;
};

module.exports = {
    DEFAULT_TIMEZONE,
    MONITORING_WINDOWS,
    SCHEDULE_MODES,
    SOURCE_REQUIREMENTS,
    calculateNextRun,
    describeSchedule,
    getZonedParts,
    intervalToMinutes,
    normalizeSchedulePayload,
    normalizeTimes,
    parseBoolean,
    zonedTimeToUtc
};
