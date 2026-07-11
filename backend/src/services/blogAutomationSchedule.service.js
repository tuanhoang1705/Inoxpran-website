'use strict'

const crypto = require('node:crypto');
const { BlogAutomationSchedule } = require('../models/blogAutomationSchedule.model');
const { BlogAutomationExecution } = require('../models/blogAutomationExecution.model');
const AutomationSeoBlogService = require('./automationSeoBlog.service');
const { AgenticBlogCoreService } = require('./agenticBlogCore.service');
const { TelegramApprovalService } = require('./telegramApproval.service');
const { BadRequestError, NotFoundError } = require('../core/error.response');
const { convertToObjectIdMongodb } = require('../utils');
const {
    calculateNextRun,
    describeSchedule,
    normalizeSchedulePayload,
    parseBoolean
} = require('../utils/blogSchedule.util');

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const LEASE_MS = 5 * 60 * 1000;

const isCronEnabled = () => parseBoolean(process.env.OPENCLAW_BLOG_CRON_ENABLED, false);
const isSeoAgentEnabled = () => process.env.SEO_AGENT_ENABLED === 'true';

const mapSchedule = (schedule) => {
    if (!schedule) return null;
    return {
        id: String(schedule._id || schedule.id),
        name: schedule.name,
        description: schedule.description || '',
        enabled: Boolean(schedule.enabled),
        scheduleType: schedule.scheduleType,
        timezone: schedule.timezone,
        daily: schedule.daily || { times: [] },
        weekly: schedule.weekly || { daysOfWeek: [], times: [] },
        interval: schedule.interval || { value: 24, unit: 'hours' },
        runLimit: Number(schedule.runLimit || 0),
        runCount: Number(schedule.runCount || 0),
        startAt: schedule.startAt,
        endAt: schedule.endAt,
        autoPublish: Boolean(schedule.autoPublish),
        agentConfig: schedule.agentConfig || {},
        lastRunAt: schedule.lastRunAt,
        nextRunAt: schedule.nextRunAt,
        lastRunStatus: schedule.lastRunStatus || '',
        lastError: schedule.lastError || '',
        scheduleDescription: describeSchedule(schedule),
        createdAt: schedule.createdAt,
        updatedAt: schedule.updatedAt
    };
};

const mapExecution = (execution) => {
    if (!execution) return null;
    return {
        id: String(execution._id || execution.id),
        scheduleId: String(execution.scheduleId || ''),
        executionKey: execution.executionKey,
        status: execution.status,
        startedAt: execution.startedAt,
        completedAt: execution.completedAt,
        blogId: execution.blogId ? String(execution.blogId) : '',
        blogSlug: execution.blogSlug || '',
        blogTitle: execution.blogTitle || '',
        mode: execution.mode || 'draft',
        error: execution.error || '',
        telegramNotificationStatus: execution.telegramNotificationStatus || '',
        telegramNotificationError: execution.telegramNotificationError || '',
        googleIntelSnapshotId: execution.googleIntelSnapshotId ? String(execution.googleIntelSnapshotId) : '',
        researchBundleId: execution.researchBundleId ? String(execution.researchBundleId) : '',
        editorialStyleProfileId: execution.editorialStyleProfileId ? String(execution.editorialStyleProfileId) : '',
        strategyPlanId: execution.strategyPlanId ? String(execution.strategyPlanId) : '',
        correlationId: execution.correlationId || '',
        agentSteps: execution.agentSteps || [],
        reviewerDecisions: execution.reviewerDecisions || {},
        publisherDecision: execution.publisherDecision || {},
        metadata: execution.metadata || {},
        createdAt: execution.createdAt,
        updatedAt: execution.updatedAt
    };
};

const scheduleToPlainPayload = (schedule = {}) => ({
    name: schedule.name,
    description: schedule.description || '',
    enabled: schedule.enabled,
    scheduleType: schedule.scheduleType,
    timezone: schedule.timezone,
    daily: schedule.daily || { times: [] },
    weekly: schedule.weekly || { daysOfWeek: [], times: [] },
    interval: schedule.interval || { value: 24, unit: 'hours' },
    runLimit: schedule.runLimit || 0,
    startAt: schedule.startAt,
    endAt: schedule.endAt,
    autoPublish: schedule.autoPublish,
    agentConfig: schedule.agentConfig || {}
});

const mergeSchedulePatch = (current, patch = {}) => {
    const base = scheduleToPlainPayload(current);
    return {
        ...base,
        ...patch,
        daily: {
            ...(base.daily || {}),
            ...(patch.daily || {})
        },
        weekly: {
            ...(base.weekly || {}),
            ...(patch.weekly || {})
        },
        interval: {
            ...(base.interval || {}),
            ...(patch.interval || {})
        },
        agentConfig: {
            ...(base.agentConfig || {}),
            ...(patch.agentConfig || {})
        }
    };
};

const assertCanRunAutomation = () => {
    if (!isCronEnabled()) throw new BadRequestError('OPENCLAW_BLOG_CRON_ENABLED is false');
    if (!isSeoAgentEnabled()) throw new BadRequestError('SEO_AGENT_ENABLED is false');
};

const buildExecutionKey = ({ scheduleId, trigger, dueAt }) => {
    if (trigger === 'scheduled' && dueAt) {
        return `${scheduleId}:${new Date(dueAt).toISOString()}`;
    }
    return `${scheduleId}:${trigger}:${crypto.randomUUID()}`;
};

class BlogAutomationScheduleService {
    static async listSchedules({ limit = DEFAULT_LIMIT, page = 1 } = {}) {
        const safeLimit = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
        const safePage = Math.max(Number(page) || 1, 1);
        const [items, total] = await Promise.all([
            BlogAutomationSchedule.find()
                .sort({ createdAt: -1 })
                .skip((safePage - 1) * safeLimit)
                .limit(safeLimit)
                .lean(),
            BlogAutomationSchedule.countDocuments()
        ]);
        return {
            schedules: items.map(mapSchedule),
            pagination: {
                total,
                page: safePage,
                limit: safeLimit,
                pages: Math.max(1, Math.ceil(total / safeLimit))
            },
            runtime: {
                cronEnabled: isCronEnabled(),
                seoAgentEnabled: isSeoAgentEnabled(),
                autoPublishEnabled: parseBoolean(process.env.SEO_AGENT_AUTO_PUBLISH, false),
                telegramEnabled: TelegramApprovalService.isEnabled()
            }
        };
    }

    static async getSchedule({ scheduleId }) {
        const objectId = convertToObjectIdMongodb(scheduleId);
        if (!objectId) throw new BadRequestError('Invalid schedule id');
        const schedule = await BlogAutomationSchedule.findById(objectId).lean();
        if (!schedule) throw new NotFoundError('Schedule not found');
        return mapSchedule(schedule);
    }

    static async createSchedule({ payload, adminId }) {
        const normalized = normalizeSchedulePayload(payload);
        const nextRunAt = normalized.enabled ? calculateNextRun({ schedule: normalized }) : null;
        const created = await BlogAutomationSchedule.create({
            ...normalized,
            nextRunAt,
            createdBy: convertToObjectIdMongodb(adminId) || null
        });
        return mapSchedule(created.toObject());
    }

    static async updateSchedule({ scheduleId, payload }) {
        const objectId = convertToObjectIdMongodb(scheduleId);
        if (!objectId) throw new BadRequestError('Invalid schedule id');
        const current = await BlogAutomationSchedule.findById(objectId).lean();
        if (!current) throw new NotFoundError('Schedule not found');

        const normalized = normalizeSchedulePayload(mergeSchedulePatch(current, payload));
        const nextRunAt = normalized.enabled
            ? calculateNextRun({
                schedule: {
                    ...normalized,
                    runCount: current.runCount || 0,
                    lastRunAt: current.lastRunAt || null
                }
            })
            : null;
        const updated = await BlogAutomationSchedule.findByIdAndUpdate(
            objectId,
            {
                $set: {
                    ...normalized,
                    nextRunAt,
                    leaseUntil: null,
                    lockedBy: ''
                }
            },
            { new: true }
        ).lean();
        return mapSchedule(updated);
    }

    static async setEnabled({ scheduleId, enabled }) {
        const objectId = convertToObjectIdMongodb(scheduleId);
        if (!objectId) throw new BadRequestError('Invalid schedule id');
        const current = await BlogAutomationSchedule.findById(objectId).lean();
        if (!current) throw new NotFoundError('Schedule not found');
        const nextRunAt = enabled ? calculateNextRun({ schedule: { ...current, enabled: true } }) : null;
        const updated = await BlogAutomationSchedule.findByIdAndUpdate(
            objectId,
            {
                $set: {
                    enabled: Boolean(enabled),
                    nextRunAt,
                    leaseUntil: null,
                    lockedBy: '',
                    lastError: ''
                }
            },
            { new: true }
        ).lean();
        return mapSchedule(updated);
    }

    static async deleteSchedule({ scheduleId }) {
        const objectId = convertToObjectIdMongodb(scheduleId);
        if (!objectId) throw new BadRequestError('Invalid schedule id');
        const deleted = await BlogAutomationSchedule.findByIdAndDelete(objectId).lean();
        if (!deleted) throw new NotFoundError('Schedule not found');
        return { deleted: true, id: String(deleted._id) };
    }

    static async listExecutions({ scheduleId, limit = 20 } = {}) {
        const query = {};
        const objectId = convertToObjectIdMongodb(scheduleId);
        if (scheduleId && !objectId) throw new BadRequestError('Invalid schedule id');
        if (objectId) query.scheduleId = objectId;
        const executions = await BlogAutomationExecution.find(query)
            .sort({ createdAt: -1 })
            .limit(Math.min(Math.max(Number(limit) || 20, 1), 100))
            .lean();
        return { executions: executions.map(mapExecution) };
    }

    static async runNow({ scheduleId }) {
        assertCanRunAutomation();
        const objectId = convertToObjectIdMongodb(scheduleId);
        if (!objectId) throw new BadRequestError('Invalid schedule id');
        const schedule = await BlogAutomationSchedule.findById(objectId).lean();
        if (!schedule) throw new NotFoundError('Schedule not found');
        return BlogAutomationScheduleService.executeSchedule({
            schedule,
            trigger: 'manual',
            dueAt: new Date()
        });
    }

    static async claimDueSchedule({ workerId, now = new Date() } = {}) {
        if (!isCronEnabled() || !isSeoAgentEnabled()) return null;
        return BlogAutomationSchedule.findOneAndUpdate(
            {
                enabled: true,
                nextRunAt: { $ne: null, $lte: now },
                $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }],
                $expr: {
                    $or: [
                        { $eq: ['$runLimit', 0] },
                        { $lt: ['$runCount', '$runLimit'] }
                    ]
                }
            },
            {
                $set: {
                    lockedBy: workerId,
                    leaseUntil: new Date(now.getTime() + LEASE_MS)
                }
            },
            { sort: { nextRunAt: 1 }, new: true }
        ).lean();
    }

    static async runDueOnce({ workerId = `worker-${process.pid}` } = {}) {
        const schedule = await BlogAutomationScheduleService.claimDueSchedule({ workerId });
        if (!schedule) return null;
        return BlogAutomationScheduleService.executeSchedule({
            schedule,
            trigger: 'scheduled',
            dueAt: schedule.nextRunAt
        });
    }

    static async executeSchedule({ schedule, trigger = 'scheduled', dueAt = new Date() }) {
        assertCanRunAutomation();
        const scheduleId = String(schedule._id || schedule.id || '');
        const executionKey = buildExecutionKey({ scheduleId, trigger, dueAt });
        let execution;

        try {
            execution = await BlogAutomationExecution.create({
                scheduleId,
                executionKey,
                status: 'running',
                startedAt: new Date(),
                correlationId: crypto.randomUUID(),
                metadata: { trigger, dueAt, pipelineVersion: 'agentic-blog-core-v2' }
            });
        } catch (error) {
            if (error?.code === 11000) {
                return { skipped: true, reason: 'duplicate_execution', executionKey };
            }
            throw error;
        }

        const scheduleObjectId = convertToObjectIdMongodb(scheduleId);
        const completeSchedule = async ({ runCountDelta = 0, lastRunStatus, lastError = '', nextRunAt }) => {
            const update = {
                $set: {
                    lastRunAt: new Date(),
                    lastRunStatus,
                    lastError,
                    leaseUntil: null,
                    lockedBy: '',
                    nextRunAt,
                    enabled: Boolean(nextRunAt)
                }
            };
            if (runCountDelta) update.$inc = { runCount: runCountDelta };
            await BlogAutomationSchedule.updateOne({ _id: scheduleObjectId }, update);
        };

        try {
            const now = new Date();
            const pipeline = await AgenticBlogCoreService.runPipeline({
                schedule,
                executionKey,
                executionId: execution._id,
                now
            });
            if (pipeline.skipped) {
                const completedAt = new Date();
                const nextRunAt = calculateNextRun({
                    schedule: { ...schedule, runCount: Number(schedule.runCount || 0) + 1, lastRunAt: completedAt },
                    from: completedAt
                });
                await BlogAutomationExecution.updateOne({ _id: execution._id }, {
                    $set: {
                        status: 'skipped', completedAt,
                        googleIntelSnapshotId: pipeline.context.snapshot.id,
                        researchBundleId: pipeline.context.researchBundle._id,
                        editorialStyleProfileId: pipeline.context.style._id,
                        strategyPlanId: pipeline.context.strategy._id,
                        agentSteps: ['google-intelligence-gate', 'topic-opportunity-research', 'skip'],
                        publisherDecision: { allowed: false, reason: pipeline.reason },
                        metadata: { trigger, dueAt, decision: 'skip', decisionReason: pipeline.reason }
                    }
                });
                await completeSchedule({ runCountDelta: 1, lastRunStatus: 'skipped', nextRunAt });
                return { skipped: true, reason: pipeline.reason, executionId: String(execution._id) };
            }
            const payload = pipeline.payload;
            await BlogAutomationExecution.updateOne({ _id: execution._id }, {
                $set: {
                    googleIntelSnapshotId: payload.googleIntelSnapshotId,
                    researchBundleId: payload.researchBundleId,
                    editorialStyleProfileId: payload.editorialStyleProfileId,
                    strategyPlanId: payload.strategyPlanId,
                    agentSteps: [
                        'google-intelligence-gate', 'topic-opportunity-research', 'industry-content-research',
                        'editorial-style-planning', 'content-strategy-plan', 'content-architecture', 'draft-generation',
                        'fact-review', 'originality-review', 'seo-aeo-geo-review', 'people-first-spam-review',
                        'brand-voice-review', 'publisher-gate'
                    ],
                    reviewerDecisions: pipeline.reviews,
                    publisherDecision: { allowed: !pipeline.highRisk, requestedMode: payload.mode }
                }
            });
            const result = await AutomationSeoBlogService.publishSeoBlog({ payload });
            const completedAt = new Date();
            const status = result.published ? 'published' : 'draft_created';
            let telegramResult = null;

            await BlogAutomationExecution.updateOne(
                { _id: execution._id },
                {
                    $set: {
                        status,
                        completedAt,
                        blogId: result.blogId || null,
                        blogSlug: result.slug || payload.slug,
                        blogTitle: payload.title,
                        mode: result.mode,
                        metadata: {
                            trigger,
                            dueAt,
                            resultReasons: result.reasons || [],
                            imagePipelineStatus: result.imagePipelineStatus || '',
                            pipelineVersion: 'agentic-blog-core-v2',
                            decision: payload.contentDecision,
                            googleIntelSnapshotId: payload.googleIntelSnapshotId,
                            researchBundleId: payload.researchBundleId,
                            editorialStyleProfileId: payload.editorialStyleProfileId,
                            strategyPlanId: payload.strategyPlanId
                        }
                    }
                }
            );

            if (!result.published && result.blogId) {
                telegramResult = await TelegramApprovalService.createDraftApprovalAndNotify({
                    blogId: result.blogId,
                    blogTitle: payload.title,
                    blogSlug: result.slug || payload.slug,
                    coverImageUrl: result.coverImage?.url || '',
                    snapshotStatus: payload.googleIntelStatus,
                    styleFamily: payload.metadata?.styleFamily || '',
                    reviewStatus: pipeline.highRisk ? 'blocked — manual review required' : 'passed',
                    scheduleId,
                    executionId: execution._id
                });
                await BlogAutomationExecution.updateOne(
                    { _id: execution._id },
                    {
                        $set: {
                            telegramNotificationStatus: telegramResult.status || '',
                            telegramNotificationError: telegramResult.reason || ''
                        }
                    }
                );
            }

            const nextRunAt = calculateNextRun({
                schedule: {
                    ...schedule,
                    runCount: Number(schedule.runCount || 0) + 1,
                    lastRunAt: completedAt
                },
                from: completedAt
            });
            await completeSchedule({ runCountDelta: 1, lastRunStatus: status, nextRunAt });

            return {
                execution: mapExecution({
                    ...execution.toObject(),
                    status,
                    completedAt,
                    blogId: result.blogId,
                    blogSlug: result.slug,
                    blogTitle: payload.title,
                    mode: result.mode,
                    telegramNotificationStatus: telegramResult?.status || '',
                    telegramNotificationError: telegramResult?.reason || ''
                }),
                result,
                telegram: telegramResult
            };
        } catch (error) {
            const message = error?.message || 'schedule_execution_failed';
            await BlogAutomationExecution.updateOne(
                { _id: execution._id },
                {
                    $set: {
                        status: 'failed',
                        completedAt: new Date(),
                        error: message
                    }
                }
            );
            const nextRunAt = calculateNextRun({
                schedule: {
                    ...schedule,
                    lastRunAt: new Date()
                },
                from: new Date()
            });
            await completeSchedule({ lastRunStatus: 'failed', lastError: message, nextRunAt });
            throw error;
        }
    }
}

module.exports = {
    BlogAutomationScheduleService,
    isCronEnabled,
    isSeoAgentEnabled,
    mapExecution,
    mapSchedule
};
