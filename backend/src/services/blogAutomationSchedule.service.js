'use strict'

const crypto = require('node:crypto');
const { BlogAutomationSchedule } = require('../models/blogAutomationSchedule.model');
const { BlogAutomationExecution } = require('../models/blogAutomationExecution.model');
const AutomationSeoBlogService = require('./automationSeoBlog.service');
const { AgenticBlogCoreService } = require('./agenticBlogCore.service');
const { TelegramApprovalService } = require('./telegramApproval.service');
const { ProductSeedPlanningService } = require('./productSeedPlanning.service');
const { EditorialProductPlacementPlanningService } = require('./editorialProductPlacementPlanning.service');
const { BadRequestError, NotFoundError } = require('../core/error.response');
const { convertToObjectIdMongodb } = require('../utils');
const { redactInternalOwnership, safeErrorCode, safeStoredErrorCode } = require('../utils/httpError.util');
const {
    ContentWorkOrderService,
    getExecutionClaimToken,
    unclaimedExecutionFilter
} = require('./contentOperations/workOrder.service');
const {
    calculateNextRun,
    describeSchedule,
    getZonedParts,
    normalizeSchedulePayload,
    parseBoolean,
    zonedTimeToUtc
} = require('../utils/blogSchedule.util');

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const LEASE_MS = 5 * 60 * 1000;
const MANUAL_RUN_ACTIVE_WINDOW_MS = 45 * 60 * 1000;
const HEARTBEAT_MS = Math.max(15 * 1000, Math.floor(LEASE_MS / 3));

const isCronEnabled = () => parseBoolean(process.env.OPENCLAW_BLOG_CRON_ENABLED, false);
const isSeoAgentEnabled = () => process.env.SEO_AGENT_ENABLED === 'true';
const safeStoredError = (value) => safeStoredErrorCode(value);

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
        mode: schedule.mode || 'fixed_brief',
        sourceRequirements: schedule.sourceRequirements || [],
        minimumOpportunityScore: Number(schedule.minimumOpportunityScore ?? 0.65),
        allowSkip: schedule.allowSkip !== false,
        draftOnly: schedule.draftOnly !== false,
        maximumTasksPerDay: Number(schedule.maximumTasksPerDay || 1),
        monitoringWindows: schedule.monitoringWindows || ['1d', '7d', '14d', '30d', '90d'],
        agentConfig: schedule.agentConfig || {},
        lastRunAt: schedule.lastRunAt,
        nextRunAt: schedule.nextRunAt,
        lastRunStatus: schedule.lastRunStatus || '',
        lastError: safeStoredError(schedule.lastError),
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
        error: safeStoredError(execution.error),
        telegramNotificationStatus: execution.telegramNotificationStatus || '',
        telegramNotificationType: execution.telegramNotificationType || '',
        telegramNotificationError: safeStoredError(execution.telegramNotificationError),
        googleIntelSnapshotId: execution.googleIntelSnapshotId ? String(execution.googleIntelSnapshotId) : '',
        contentOperationsSnapshotId: execution.contentOperationsSnapshotId ? String(execution.contentOperationsSnapshotId) : '',
        contentInventorySnapshotId: execution.contentInventorySnapshotId ? String(execution.contentInventorySnapshotId) : '',
        contentOpportunityDecisionId: execution.contentOpportunityDecisionId ? String(execution.contentOpportunityDecisionId) : '',
        contentWorkOrderId: execution.contentWorkOrderId ? String(execution.contentWorkOrderId) : '',
        unifiedContentBriefId: execution.unifiedContentBriefId ? String(execution.unifiedContentBriefId) : '',
        evidenceMapId: execution.evidenceMapId ? String(execution.evidenceMapId) : '',
        blogRevisionId: execution.blogRevisionId ? String(execution.blogRevisionId) : '',
        publishReadinessReportId: execution.publishReadinessReportId ? String(execution.publishReadinessReportId) : '',
        postPublishVerificationId: execution.postPublishVerificationId ? String(execution.postPublishVerificationId) : '',
        contentAction: execution.contentAction || '',
        opportunityCandidates: execution.opportunityCandidates || [],
        rejectedDecisions: execution.rejectedDecisions || [],
        sourceHealth: execution.sourceHealth || {},
        sourceFreshness: execution.sourceFreshness || {},
        overrideReason: execution.overrideReason || '',
        publishReadiness: execution.publishReadiness || null,
        postPublishVerification: execution.postPublishVerification || null,
        monitoringTasks: execution.monitoringTasks || [],
        learningRecommendations: execution.learningRecommendations || [],
        researchBundleId: execution.researchBundleId ? String(execution.researchBundleId) : '',
        editorialStyleProfileId: execution.editorialStyleProfileId ? String(execution.editorialStyleProfileId) : '',
        strategyPlanId: execution.strategyPlanId ? String(execution.strategyPlanId) : '',
        productCatalogSnapshotId: execution.productCatalogSnapshotId ? String(execution.productCatalogSnapshotId) : '',
        productSeedPlanId: execution.productSeedPlanId ? String(execution.productSeedPlanId) : '',
        editorialProductPlacementPlanId: execution.editorialProductPlacementPlanId ? String(execution.editorialProductPlacementPlanId) : '',
        productSeedingMode: execution.productSeedingMode || 'off',
        productSeedingDecision: execution.productSeedingDecision || '',
        seededProductIds: (execution.seededProductIds || []).map(String),
        productSeedingReview: execution.productSeedingReview || null,
        productClaimReview: execution.productClaimReview || null,
        editorialProductPlacementReview: execution.editorialProductPlacementReview || null,
        correlationId: execution.correlationId || '',
        agentSteps: execution.agentSteps || [],
        reviewerDecisions: execution.reviewerDecisions || {},
        publisherDecision: execution.publisherDecision || {},
        metadata: redactInternalOwnership(execution.metadata || {}),
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
    mode: schedule.mode || 'fixed_brief',
    sourceRequirements: schedule.sourceRequirements || [],
    minimumOpportunityScore: schedule.minimumOpportunityScore ?? 0.65,
    allowSkip: schedule.allowSkip !== false,
    draftOnly: schedule.draftOnly !== false,
    maximumTasksPerDay: schedule.maximumTasksPerDay || 1,
    monitoringWindows: schedule.monitoringWindows || ['1d', '7d', '14d', '30d', '90d'],
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
        mode: patch.mode ?? base.mode,
        sourceRequirements: patch.sourceRequirements ?? base.sourceRequirements,
        minimumOpportunityScore: patch.minimumOpportunityScore ?? base.minimumOpportunityScore,
        allowSkip: patch.allowSkip ?? base.allowSkip,
        draftOnly: patch.draftOnly ?? base.draftOnly,
        maximumTasksPerDay: patch.maximumTasksPerDay ?? base.maximumTasksPerDay,
        monitoringWindows: patch.monitoringWindows ?? base.monitoringWindows,
        agentConfig: {
            ...(base.agentConfig || {}),
            ...(patch.agentConfig || {}),
            productSeeding: {
                ...(base.agentConfig?.productSeeding || {}),
                ...(patch.agentConfig?.productSeeding || {})
            },
            productPlacement: {
                ...(base.agentConfig?.productPlacement || {}),
                ...(patch.agentConfig?.productPlacement || {})
            }
        }
    };
};

const assertCanRunAutomation = ({ requireCron = true } = {}) => {
    if (requireCron && !isCronEnabled()) throw new BadRequestError('OPENCLAW_BLOG_CRON_ENABLED is false');
    if (!isSeoAgentEnabled()) throw new BadRequestError('SEO_AGENT_ENABLED is false');
};

const buildExecutionKey = ({ scheduleId, trigger, dueAt }) => {
    if (trigger === 'scheduled' && dueAt) {
        return `${scheduleId}:${new Date(dueAt).toISOString()}`;
    }
    return `${scheduleId}:${trigger}:${crypto.randomUUID()}`;
};

const buildLeaseOwner = (workerId = `worker-${process.pid}`) =>
    `${String(workerId || `worker-${process.pid}`).slice(0, 120)}:${crypto.randomUUID()}`;

const getScheduleDayBounds = ({ schedule = {}, now = new Date() } = {}) => {
    const timezone = schedule.timezone || 'Asia/Ho_Chi_Minh';
    const local = getZonedParts(now, timezone);
    return {
        start: zonedTimeToUtc({
            year: local.year,
            month: local.month,
            day: local.day,
            timeZone: timezone
        }),
        end: zonedTimeToUtc({
            year: local.year,
            month: local.month,
            day: local.day + 1,
            timeZone: timezone
        })
    };
};

const buildRealTaskCountQuery = ({ scheduleId, schedule, now }) => {
    const bounds = getScheduleDayBounds({ schedule, now });
    return {
        scheduleId,
        startedAt: { $gte: bounds.start, $lt: bounds.end },
        status: { $in: ['running', 'draft_created', 'maintenance_created', 'published', 'completed', 'blocked', 'failed'] },
        contentAction: { $exists: true, $nin: ['', 'skip', null] }
    };
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
        assertCanRunAutomation({ requireCron: false });
        const objectId = convertToObjectIdMongodb(scheduleId);
        if (!objectId) throw new BadRequestError('Invalid schedule id');
        const dueAt = new Date();
        const lockOwner = buildLeaseOwner(`manual-${process.pid}`);
        const schedule = await BlogAutomationSchedule.findOneAndUpdate(
            {
                _id: objectId,
                $or: [
                    { leaseUntil: null },
                    { leaseUntil: { $exists: false } },
                    { leaseUntil: { $lte: dueAt } }
                ]
            },
            {
                $set: {
                    lockedBy: lockOwner,
                    leaseUntil: new Date(dueAt.getTime() + LEASE_MS)
                }
            },
            { new: true }
        ).lean();
        if (!schedule) {
            const exists = await BlogAutomationSchedule.findById(objectId).select('_id').lean();
            if (!exists) throw new NotFoundError('Schedule not found');
            throw new BadRequestError('This schedule already has an active run.');
        }

        const activeSince = new Date(dueAt.getTime() - MANUAL_RUN_ACTIVE_WINDOW_MS);
        let activeRun;
        try {
            activeRun = await BlogAutomationExecution.findOne({
                scheduleId: objectId,
                status: 'running',
                startedAt: { $gte: activeSince }
            }).select('_id startedAt').lean();
        } catch (error) {
            await BlogAutomationSchedule.updateOne(
                { _id: objectId, lockedBy: lockOwner },
                { $unset: { leaseUntil: '', lockedBy: '' } }
            );
            throw error;
        }
        if (activeRun) {
            await BlogAutomationSchedule.updateOne(
                { _id: objectId, lockedBy: lockOwner },
                { $unset: { leaseUntil: '', lockedBy: '' } }
            );
            throw new BadRequestError('Lịch này đang có một lần chạy chưa kết thúc. Theo dõi mục "Lịch sử chạy" và đợi lần chạy hiện tại hoàn tất.');
        }

        Promise.resolve()
            .then(() => BlogAutomationScheduleService.executeSchedule({ schedule, trigger: 'manual', dueAt, lockOwner }))
            .catch((error) => {
                console.error('Manual blog schedule run failed:', safeErrorCode({ code: error?.code || 'BLOG_SCHEDULE_MANUAL_FAILED' }));
            });
        return {
            queued: true,
            scheduleId: String(objectId),
            startedAt: dueAt.toISOString(),
            message: 'Đã bắt đầu chạy trong nền. Theo dõi tiến trình ở mục Lịch sử chạy.'
        };
    }

    static async claimDueSchedule({ workerId, now = new Date() } = {}) {
        if (!isCronEnabled() || !isSeoAgentEnabled()) return null;
        const lockOwner = buildLeaseOwner(workerId);
        return BlogAutomationSchedule.findOneAndUpdate(
            {
                enabled: true,
                nextRunAt: { $ne: null, $lte: now },
                $or: [
                    { leaseUntil: null },
                    { leaseUntil: { $exists: false } },
                    { leaseUntil: { $lte: now } }
                ],
                $expr: {
                    $or: [
                        { $eq: ['$runLimit', 0] },
                        { $lt: ['$runCount', '$runLimit'] }
                    ]
                }
            },
            {
                $set: {
                    lockedBy: lockOwner,
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
            dueAt: schedule.nextRunAt,
            lockOwner: schedule.lockedBy
        });
    }

    static async executeSchedule({ schedule, trigger = 'scheduled', dueAt = new Date(), lockOwner }) {
        const scheduleId = String(schedule._id || schedule.id || '');
        const scheduleObjectId = convertToObjectIdMongodb(scheduleId);
        const resolvedLockOwner = String(lockOwner || schedule.lockedBy || '');
        if (!scheduleObjectId || !resolvedLockOwner) {
            throw new Error('A claimed schedule and unique lock owner are required');
        }
        const executionKey = buildExecutionKey({ scheduleId, trigger, dueAt });
        let execution;

        const completeSchedule = async ({ runCountDelta = 0, lastRunStatus, lastError = '', nextRunAt }) => {
            const update = {
                $set: {
                    lastRunAt: new Date(),
                    lastRunStatus,
                    lastError,
                    nextRunAt
                },
                $unset: { leaseUntil: '', lockedBy: '' }
            };
            if (!nextRunAt) update.$set.enabled = false;
            if (runCountDelta) update.$inc = { runCount: runCountDelta };
            return BlogAutomationSchedule.updateOne(
                { _id: scheduleObjectId, lockedBy: resolvedLockOwner },
                update
            );
        };

        const releaseSchedule = () => BlogAutomationSchedule.updateOne(
            { _id: scheduleObjectId, lockedBy: resolvedLockOwner },
            { $unset: { leaseUntil: '', lockedBy: '' } }
        );

        const recoverDuplicateExecution = async (duplicate) => {
            const completedAt = new Date();
            let recoveredStatus = duplicate?.status || 'duplicate_execution';
            if (duplicate?.status === 'running') {
                const recoveryMessage = 'Recovered stale deterministic execution after its schedule lease expired';
                const recovery = await BlogAutomationExecution.updateOne(
                    {
                        _id: duplicate._id,
                        status: 'running',
                        ...unclaimedExecutionFilter()
                    },
                    {
                        $set: {
                            status: 'failed',
                            completedAt,
                            error: recoveryMessage,
                            'metadata.recoveredAt': completedAt,
                            'metadata.recoveryReason': 'stale_schedule_lease'
                        },
                        $inc: { retryCount: 1 }
                    }
                );
                if (Number(recovery?.modifiedCount || 0) > 0) recoveredStatus = 'failed';
            }
            const nextRunAt = calculateNextRun({
                schedule: {
                    ...schedule,
                    runCount: Number(schedule.runCount || 0) + 1,
                    lastRunAt: completedAt
                },
                from: completedAt
            });
            await completeSchedule({
                runCountDelta: 1,
                lastRunStatus: recoveredStatus,
                lastError: recoveredStatus === 'failed' ? 'stale deterministic execution recovered' : '',
                nextRunAt
            });
            return {
                skipped: true,
                reason: 'duplicate_execution_recovered',
                executionKey,
                executionId: duplicate?._id ? String(duplicate._id) : '',
                nextRunAt
            };
        };

        try {
            assertCanRunAutomation({ requireCron: trigger === 'scheduled' });
            const now = new Date();
            if (trigger === 'scheduled') {
                const existingExecution = await BlogAutomationExecution.findOne({ executionKey }).lean();
                if (existingExecution) return await recoverDuplicateExecution(existingExecution);
            }
            const realTasksToday = await BlogAutomationExecution.countDocuments(
                buildRealTaskCountQuery({ scheduleId: scheduleObjectId, schedule, now })
            );
            if (realTasksToday >= Number(schedule.maximumTasksPerDay || 1)) {
                const nextRunAt = trigger === 'scheduled'
                    ? calculateNextRun({ schedule: { ...schedule, lastRunAt: now }, from: now })
                    : schedule.nextRunAt || null;
                await completeSchedule({ lastRunStatus: 'daily_limit', nextRunAt });
                return {
                    skipped: true,
                    reason: 'maximum_tasks_per_day_reached',
                    nextRunAt
                };
            }

            try {
                execution = await BlogAutomationExecution.create({
                    scheduleId,
                    executionKey,
                    status: 'running',
                    startedAt: now,
                    correlationId: crypto.randomUUID(),
                    metadata: {
                        trigger,
                        dueAt,
                        leaseOwner: resolvedLockOwner,
                        pipelineVersion: 'agentic-blog-core-v2'
                    }
                });
            } catch (error) {
                if (error?.code !== 11000) throw error;

                const duplicate = await BlogAutomationExecution.findOne({ executionKey }).lean();
                return await recoverDuplicateExecution(duplicate);
            }
        } catch (error) {
            await releaseSchedule();
            throw error;
        }

        const heartbeat = setInterval(() => {
            Promise.resolve(BlogAutomationSchedule.updateOne(
                { _id: scheduleObjectId, lockedBy: resolvedLockOwner },
                { $set: { leaseUntil: new Date(Date.now() + LEASE_MS) } }
            )).catch((error) => {
                console.error('Blog schedule lease heartbeat failed:', safeErrorCode({ code: error?.code || 'BLOG_SCHEDULE_HEARTBEAT_FAILED' }));
            });
        }, HEARTBEAT_MS);
        heartbeat.unref?.();

        try {
            const now = new Date();
            const pipeline = await AgenticBlogCoreService.runPipeline({
                schedule,
                executionKey,
                executionId: execution._id,
                now
            });
            if (pipeline.context?.productSeedPlan?._id) {
                await ProductSeedPlanningService.attachExecution({ planId: pipeline.context.productSeedPlan._id, executionId: execution._id });
            }
            if (pipeline.context?.editorialPlacementPlan?._id) {
                await EditorialProductPlacementPlanningService.attachRelations({ planId: pipeline.context.editorialPlacementPlan._id, executionId: execution._id, strategyPlanId: pipeline.context.strategy?._id });
            }
            if (pipeline.skipped) {
                const completedAt = new Date();
                const nextRunAt = calculateNextRun({
                    schedule: { ...schedule, runCount: Number(schedule.runCount || 0) + 1, lastRunAt: completedAt },
                    from: completedAt
                });
                await BlogAutomationExecution.updateOne({
                    _id: execution._id,
                    status: 'running',
                    ...unclaimedExecutionFilter()
                }, {
                    $set: {
                        status: 'skipped', completedAt,
                        googleIntelSnapshotId: pipeline.context.snapshot.id,
                        contentOperationsSnapshotId: pipeline.context.contentPlanning?.contentOperationsSnapshotId || null,
                        contentInventorySnapshotId: pipeline.context.contentPlanning?.contentInventorySnapshotId || null,
                        contentOpportunityDecisionId: pipeline.context.contentPlanning?.contentOpportunityDecisionId || null,
                        contentWorkOrderId: pipeline.context.contentWorkOrder?._id || pipeline.context.contentWorkOrder?.id || null,
                        unifiedContentBriefId: pipeline.context.unifiedBrief?._id || pipeline.context.unifiedBrief?.id || null,
                        evidenceMapId: pipeline.context.evidenceMap?._id || pipeline.context.evidenceMap?.id || null,
                        contentAction: pipeline.context.opportunity?.decision || 'skip',
                        opportunityCandidates: pipeline.context.contentPlanning?.candidates || [],
                        rejectedDecisions: pipeline.context.contentPlanning?.candidates?.filter((item) => item.candidateId !== pipeline.context.contentPlanning?.selectedOpportunity?.candidateId) || [],
                        sourceHealth: pipeline.context.contentPlanning?.sourceHealth || {},
                        sourceFreshness: pipeline.context.contentPlanning?.sourceFreshness || {},
                        researchBundleId: pipeline.context.researchBundle?._id || null,
                        editorialStyleProfileId: pipeline.context.style?._id || null,
                        strategyPlanId: pipeline.context.strategy?._id || null,
                        productCatalogSnapshotId: pipeline.context.productSeedPlan?.productCatalogSnapshotId || null,
                        productSeedPlanId: pipeline.context.productSeedPlan?._id || null,
                        editorialProductPlacementPlanId: pipeline.context.editorialPlacementPlan?._id || null,
                        productSeedingMode: pipeline.context.productSeedPlan?.mode || 'off',
                        productSeedingDecision: pipeline.context.productSeedPlan?.decision || '',
                        seededProductIds: [pipeline.context.productSeedPlan?.primaryProduct, ...(pipeline.context.productSeedPlan?.supportingProducts || [])].filter(Boolean).map((item) => item.productId),
                        agentSteps: pipeline.blocked
                            ? ['google-intelligence-gate', 'daily-content-snapshot', 'opportunity-decision', 'content-work-order', 'blocked']
                            : ['google-intelligence-gate', 'daily-content-snapshot', 'opportunity-decision', 'content-work-order', 'skip'],
                        publisherDecision: { allowed: false, reason: pipeline.reason },
                        metadata: {
                            trigger, dueAt, decision: 'skip', decisionReason: pipeline.reason,
                            productSeeding: {
                                selectedProducts: [pipeline.context.productSeedPlan?.primaryProduct, ...(pipeline.context.productSeedPlan?.supportingProducts || [])].filter(Boolean),
                                rejectedCandidates: pipeline.context.productSeedPlan?.rejectedCandidates || [],
                                candidateScores: pipeline.context.productSeedPlan?.candidateScores || [],
                                placementPlan: pipeline.context.editorialPlacementPlan?.placementSequence || [],
                                placementStyle: pipeline.context.editorialPlacementPlan?.placementStyle || 'no-product',
                                warnings: pipeline.context.productSeedPlan?.warnings || [],
                                errorCodes: pipeline.context.productSeedPlan?.errorCodes || []
                            }
                        }
                    }
                });
                await completeSchedule({ runCountDelta: 1, lastRunStatus: 'skipped', nextRunAt });
                return { skipped: true, reason: pipeline.reason, executionId: String(execution._id) };
            }
            if (pipeline.maintenance) {
                const completedAt = new Date();
                const nextRunAt = calculateNextRun({
                    schedule: { ...schedule, runCount: Number(schedule.runCount || 0) + 1, lastRunAt: completedAt },
                    from: completedAt
                });
                await completeSchedule({ runCountDelta: 1, lastRunStatus: 'maintenance_created', nextRunAt });
                return {
                    execution: mapExecution({
                        ...execution.toObject(),
                        status: 'maintenance_created',
                        completedAt,
                        blogId: pipeline.result.blogId,
                        blogSlug: pipeline.result.slug,
                        blogTitle: pipeline.context.opportunity.targets[0]?.blog_title || '',
                        mode: 'maintenance'
                    }),
                    result: pipeline.result,
                    telegram: null
                };
            }
            const payload = pipeline.payload;
            await BlogAutomationExecution.updateOne({ _id: execution._id }, {
                $set: {
                    googleIntelSnapshotId: payload.googleIntelSnapshotId,
                    contentOperationsSnapshotId: payload.contentOperationsSnapshotId || null,
                    contentInventorySnapshotId: payload.contentInventorySnapshotId || null,
                    contentOpportunityDecisionId: payload.contentOpportunityDecisionId || null,
                    contentWorkOrderId: payload.contentWorkOrderId || null,
                    unifiedContentBriefId: payload.unifiedContentBriefId || null,
                    evidenceMapId: payload.evidenceMapId || null,
                    contentAction: payload.contentDecision,
                    opportunityCandidates: pipeline.context.contentPlanning?.candidates || [],
                    rejectedDecisions: pipeline.context.contentPlanning?.candidates?.filter((item) => item.candidateId !== pipeline.context.contentPlanning?.selectedOpportunity?.candidateId) || [],
                    sourceHealth: pipeline.context.contentPlanning?.sourceHealth || {},
                    sourceFreshness: pipeline.context.contentPlanning?.sourceFreshness || {},
                    researchBundleId: payload.researchBundleId,
                    editorialStyleProfileId: payload.editorialStyleProfileId,
                    strategyPlanId: payload.strategyPlanId,
                    productCatalogSnapshotId: payload.productCatalogSnapshotId || null,
                    productSeedPlanId: payload.productSeedPlanId || null,
                    editorialProductPlacementPlanId: payload.editorialProductPlacementPlanId || null,
                    productSeedingMode: payload.productSeedingMode || 'off',
                    productSeedingDecision: payload.productSeedingDecision || '',
                    seededProductIds: payload.seededProductIds || [],
                    productSeedingReview: payload.productSeedingReview || null,
                    productClaimReview: payload.productClaimReview || null,
                    editorialProductPlacementReview: payload.editorialProductPlacementReview || null,
                    agentSteps: [
                        'google-intelligence-gate', 'daily-content-snapshot', 'content-inventory', 'opportunity-decision',
                        'content-work-order', 'unified-content-brief', 'product-catalog-snapshot', 'product-relevance-analysis', 'product-seed-plan',
                        'editorial-product-placement-plan', 'industry-content-research', 'evidence-map',
                        'editorial-style-planning', 'content-strategy-plan', 'content-architecture', 'draft-generation',
                        'product-claim-review', 'product-seeding-review', 'editorial-product-placement-review', 'fact-review', 'originality-review', 'seo-aeo-geo-review', 'people-first-spam-review',
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
                {
                    _id: execution._id,
                    status,
                    ...unclaimedExecutionFilter()
                },
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
                            , productCatalogSnapshotId: payload.productCatalogSnapshotId || ''
                            , productSeedPlanId: payload.productSeedPlanId || ''
                            , editorialProductPlacementPlanId: payload.editorialProductPlacementPlanId || ''
                            , productSeedingMode: payload.productSeedingMode || 'off'
                            , productSeedingDecision: payload.productSeedingDecision || ''
                            , productSeeding: {
                                selectedProducts: [pipeline.context.productSeedPlan?.primaryProduct, ...(pipeline.context.productSeedPlan?.supportingProducts || [])].filter(Boolean),
                                rejectedCandidates: pipeline.context.productSeedPlan?.rejectedCandidates || [],
                                candidateScores: pipeline.context.productSeedPlan?.candidateScores || [],
                                placementPlan: pipeline.context.editorialPlacementPlan?.placementSequence || [],
                                placementStyle: pipeline.context.editorialPlacementPlan?.placementStyle || 'no-product',
                                firstProductMention: pipeline.context.editorialPlacementPlan?.firstProductMention || {},
                                rankingStrategy: pipeline.context.editorialPlacementPlan?.rankingStrategy || {},
                                disclosure: pipeline.context.editorialPlacementPlan?.disclosure || {},
                                warnings: pipeline.context.productSeedPlan?.warnings || []
                            }
                        }
                    }
                }
            );

            if (!result.published && result.blogId && !result.revisionStaged) {
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
                            telegramNotificationType: telegramResult.notificationType || '',
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
                    telegramNotificationType: telegramResult?.notificationType || '',
                    telegramNotificationError: telegramResult?.reason || ''
                }),
                result,
                telegram: telegramResult
            };
        } catch (error) {
            const message = safeErrorCode({ code: error?.code || 'BLOG_SCHEDULE_EXECUTION_FAILED' });
            try {
                const latestExecution = await BlogAutomationExecution.findById(execution._id).lean();
                const workOrderId = latestExecution?.contentWorkOrderId || null;
                const claimToken = getExecutionClaimToken(latestExecution);
                if (workOrderId && claimToken) {
                    await ContentWorkOrderService.transitionClaimed({
                        workOrderId,
                        claimToken,
                        status: 'blocked',
                        updates: { 'metadata.lastFailureCode': message }
                    });
                    await ContentWorkOrderService.transitionExecutionClaimed({
                        executionId: execution._id,
                        workOrderId,
                        claimToken,
                        status: 'failed',
                        updates: { error: message }
                    });
                } else {
                    await ContentWorkOrderService.transitionExecutionUnclaimed({
                        executionId: execution._id,
                        status: 'failed',
                        updates: { error: message }
                    });
                }
            } catch {
                // Preserve the original bounded pipeline error; ownership cleanup is best effort and fail-closed.
            }
            const nextRunAt = calculateNextRun({
                schedule: {
                    ...schedule,
                    lastRunAt: new Date()
                },
                from: new Date()
            });
            await completeSchedule({ lastRunStatus: 'failed', lastError: message, nextRunAt });
            throw error;
        } finally {
            clearInterval(heartbeat);
        }
    }
}

module.exports = {
    BlogAutomationScheduleService,
    buildLeaseOwner,
    buildRealTaskCountQuery,
    getScheduleDayBounds,
    isCronEnabled,
    isSeoAgentEnabled,
    mapExecution,
    mapSchedule,
    safeStoredError
};
