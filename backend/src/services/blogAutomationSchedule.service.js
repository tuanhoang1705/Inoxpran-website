'use strict'

const crypto = require('node:crypto');
const { BlogAutomationSchedule } = require('../models/blogAutomationSchedule.model');
const { BlogAutomationExecution } = require('../models/blogAutomationExecution.model');
const AutomationSeoBlogService = require('./automationSeoBlog.service');
const { AgenticBlogCoreService } = require('./agenticBlogCore.service');
const { TelegramApprovalService } = require('./telegramApproval.service');
const { ProductSeedPlanningService } = require('./productSeedPlanning.service');
const { EditorialProductPlacementPlanningService } = require('./editorialProductPlacementPlanning.service');
const { QaTopicUniquenessService } = require('./qaTopicUniqueness.service');
const { AgenticBlogQaCase } = require('../models/agenticBlogQaCase.model');
const { AgenticBlogQaBatch } = require('../models/agenticBlogQaBatch.model');
const { buildAgenticBlogQaConfig, buildQaRunSlotKeyHash, readBoolean: readStrictBoolean } = require('../config/agenticBlogQa.config');
const { ensureQaInfrastructureOnce } = require('./agenticBlogQaInfrastructure.service');
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
const qaTopicUniquenessService = new QaTopicUniquenessService();

const updateQaRunAttempt = async ({ schedule, execution, status, values = {} }) => {
    if (schedule?.isQaTest !== true || !execution?._id) return;
    const iteration = Number(execution.qaIteration ?? schedule.qaIteration ?? 0);
    const slotKeyHash = buildQaRunSlotKeyHash({
        caseId: schedule.qaCaseId,
        iteration,
        executionMode: schedule.executionMode
    });
    const set = {
        'runAttempts.$[attempt].status': status,
        'runAttempts.$[attempt].executionId': execution._id,
        'runAttempts.$[attempt].executionKey': String(execution.executionKey || ''),
        ...(execution.metadata?.leaseOwner ? {
            'runAttempts.$[attempt].leaseOwnerHash': crypto
                .createHash('sha256')
                .update(String(execution.metadata.leaseOwner))
                .digest('hex')
        } : {}),
        ...(execution.metadata?.commitClaimedAt ? {
            'runAttempts.$[attempt].commitClaimedAt': execution.metadata.commitClaimedAt
        } : {}),
        ...values
    };
    await AgenticBlogQaCase.updateOne(
        { _id: schedule.qaCaseId, qaBatchId: schedule.qaBatchId, isQaTest: true },
        { $set: set },
        {
            arrayFilters: [{
                'attempt.idempotencyKeyHash': slotKeyHash,
                'attempt.batchIteration': iteration,
                'attempt.executionMode': schedule.executionMode
            }]
        }
    );
};

const isCronEnabled = () => parseBoolean(process.env.OPENCLAW_BLOG_CRON_ENABLED, false);
const isSeoAgentEnabled = () => readStrictBoolean(process.env.SEO_AGENT_ENABLED, false, 'SEO_AGENT_ENABLED');
const isQaRuntimeEnabled = () => readStrictBoolean(
    process.env.AGENTIC_BLOG_QA_ENABLED,
    false,
    'AGENTIC_BLOG_QA_ENABLED'
);
const safeStoredError = (value) => safeStoredErrorCode(value);

const scheduleFenceError = () => {
    const error = new Error('The schedule execution ownership fence was lost');
    error.code = 'SCHEDULE_EXECUTION_FENCE_LOST';
    return error;
};

const matchedExactlyOne = result => Number(result?.matchedCount ?? result?.modifiedCount ?? result?.n ?? 0) === 1;

const assertActiveExecutionOwnership = async ({ scheduleObjectId, executionId, lockOwner, now = new Date() }) => {
    const [ownedSchedule, activeExecution] = await Promise.all([
        BlogAutomationSchedule.findOne({
            _id: scheduleObjectId,
            lockedBy: lockOwner,
            leaseUntil: { $gt: now }
        }).select('_id').lean(),
        BlogAutomationExecution.findOne({
            _id: executionId,
            status: 'running',
            'metadata.leaseOwner': lockOwner
        }).select('_id isQaTest qaBatchId environment').lean()
    ]);
    if (!ownedSchedule || !activeExecution) throw scheduleFenceError();
    if (activeExecution.isQaTest === true) {
        const activeBatch = await AgenticBlogQaBatch.findOne({
            _id: activeExecution.qaBatchId,
            isQaTest: true,
            environment: activeExecution.environment,
            status: { $in: ['planned', 'running'] },
            stopNewDrafts: { $ne: true }
        }).select('_id').lean();
        if (!activeBatch) throw scheduleFenceError();
    }
    return true;
};

const claimPublishFence = async ({ scheduleObjectId, executionId, lockOwner, now = new Date() }) => {
    const renewed = await BlogAutomationSchedule.updateOne(
        {
            _id: scheduleObjectId,
            lockedBy: lockOwner,
            leaseUntil: { $gt: now }
        },
        { $set: { leaseUntil: new Date(now.getTime() + LEASE_MS) } }
    );
    if (!matchedExactlyOne(renewed)) throw scheduleFenceError();
    const execution = await BlogAutomationExecution.findOneAndUpdate(
        {
            _id: executionId,
            status: 'running',
            'metadata.leaseOwner': lockOwner
        },
        {
            $set: {
                status: 'committing',
                'metadata.commitClaimedAt': now
            }
        },
        { new: true }
    );
    if (!execution) throw scheduleFenceError();
    return execution;
};

const mapSchedule = (schedule) => {
    if (!schedule) return null;
    return {
        id: String(schedule._id || schedule.id),
        isQaTest: schedule.isQaTest === true,
        qaBatchId: schedule.qaBatchId ? String(schedule.qaBatchId) : '',
        qaCaseId: schedule.qaCaseId ? String(schedule.qaCaseId) : '',
        environment: schedule.environment || '',
        executionMode: schedule.executionMode || '',
        originalTopicSeed: schedule.originalTopicSeed || '',
        normalizedTopicKey: schedule.normalizedTopicKey || '',
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
        isQaTest: execution.isQaTest === true,
        qaBatchId: execution.qaBatchId ? String(execution.qaBatchId) : '',
        qaCaseId: execution.qaCaseId ? String(execution.qaCaseId) : '',
        environment: execution.environment || '',
        executionMode: execution.executionMode || '',
        originalTopicSeed: execution.originalTopicSeed || '',
        normalizedTopicKey: execution.normalizedTopicKey || '',
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

const validateManualIdempotencyKey = (value) => {
    if (value === undefined || value === null || String(value).trim() === '') {
        return { key: `generated.${crypto.randomUUID()}`, generated: true };
    }
    const key = String(value).trim();
    if (key.length < 8 || key.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
        throw new BadRequestError('Idempotency-Key must be 8-128 safe ASCII characters');
    }
    return { key, generated: false };
};

const buildManualExecutionIdentity = ({ scheduleId, adminId, idempotencyKey }) => {
    const validated = validateManualIdempotencyKey(idempotencyKey);
    const adminScope = String(adminId || 'system');
    const idempotencyKeyHash = crypto
        .createHash('sha256')
        .update(`blog-schedule-manual-v1\0${scheduleId}\0${adminScope}\0${validated.key}`)
        .digest('hex');
    return {
        executionKey: `manual:${scheduleId}:${idempotencyKeyHash}`,
        idempotencyKeyHash,
        generated: validated.generated
    };
};

const trustedQaFields = (source = {}) => source?.isQaTest === true ? {
    isQaTest: true,
    qaBatchId: source.qaBatchId,
    qaCaseId: source.qaCaseId,
    qaIteration: Number(source.qaIteration || 0),
    environment: source.environment,
    executionMode: source.executionMode,
    originalTopicSeed: source.originalTopicSeed,
    normalizedTopicKey: source.normalizedTopicKey,
    qaTopicReservationId: source.qaTopicReservationId
} : {};

const qaExecutionProvenanceError = () => {
    const error = new BadRequestError('QA execution provenance does not match its retained schedule');
    error.code = 'QA_EXECUTION_PROVENANCE_MISMATCH';
    return error;
};

const assertQaExecutionProvenance = ({ schedule = {}, execution = {} } = {}) => {
    if (schedule.isQaTest !== true) return true;
    const exactStringFields = [
        'qaBatchId',
        'qaCaseId',
        'environment',
        'executionMode',
        'originalTopicSeed',
        'normalizedTopicKey',
        'qaTopicReservationId'
    ];
    if (
        execution?.isQaTest !== true ||
        Number(execution.qaIteration ?? -1) !== Number(schedule.qaIteration ?? -1) ||
        exactStringFields.some((field) => String(execution?.[field] || '') !== String(schedule?.[field] || ''))
    ) {
        throw qaExecutionProvenanceError();
    }
    return true;
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
        ...(schedule?.isQaTest === true ? { isQaTest: true, qaIteration: Number(schedule.qaIteration || 0) } : {}),
        startedAt: { $gte: bounds.start, $lt: bounds.end },
        status: { $in: ['running', 'committing', 'draft_created', 'maintenance_created', 'published', 'completed', 'blocked', 'failed'] },
        contentAction: { $exists: true, $nin: ['', 'skip', null] }
    };
};

class BlogAutomationScheduleService {
    static async listSchedules({ limit = DEFAULT_LIMIT, page = 1 } = {}) {
        const safeLimit = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
        const safePage = Math.max(Number(page) || 1, 1);
        const [items, total] = await Promise.all([
            BlogAutomationSchedule.find({ isQaTest: { $ne: true } })
                .sort({ createdAt: -1 })
                .skip((safePage - 1) * safeLimit)
                .limit(safeLimit)
                .lean(),
            BlogAutomationSchedule.countDocuments({ isQaTest: { $ne: true } })
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
        const schedule = await BlogAutomationSchedule.findOne({
            _id: objectId,
            isQaTest: { $ne: true }
        }).lean();
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
        if (current.isQaTest === true) throw new BadRequestError('QA schedules are immutable outside the QA harness');

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
        if (current.isQaTest === true) throw new BadRequestError('QA schedules can only be enabled by the QA harness');
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
        const current = await BlogAutomationSchedule.findById(objectId).select('_id isQaTest').lean();
        if (!current) throw new NotFoundError('Schedule not found');
        if (current.isQaTest === true) throw new BadRequestError('QA schedules are retained for audit and cannot be deleted here');
        const deleted = await BlogAutomationSchedule.findByIdAndDelete(objectId).lean();
        if (!deleted) throw new NotFoundError('Schedule not found');
        return { deleted: true, id: String(deleted._id) };
    }

    static async listExecutions({ scheduleId, limit = 20 } = {}) {
        const query = { isQaTest: { $ne: true } };
        const objectId = convertToObjectIdMongodb(scheduleId);
        if (scheduleId && !objectId) throw new BadRequestError('Invalid schedule id');
        if (objectId) query.scheduleId = objectId;
        const executions = await BlogAutomationExecution.find(query)
            .sort({ createdAt: -1 })
            .limit(Math.min(Math.max(Number(limit) || 20, 1), 100))
            .lean();
        return { executions: executions.map(mapExecution) };
    }

    static async runNowLegacy({ scheduleId }) {
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

    static async runNow({ scheduleId, idempotencyKey, adminId, trustedQaRun = false, qaIteration = 0 }) {
        assertCanRunAutomation({ requireCron: false });
        const objectId = convertToObjectIdMongodb(scheduleId);
        if (!objectId) throw new BadRequestError('Invalid schedule id');
        const scheduleIdentity = await BlogAutomationSchedule.findById(objectId)
            .select('_id isQaTest qaBatchId qaCaseId qaIteration environment executionMode originalTopicSeed normalizedTopicKey qaTopicReservationId')
            .lean();
        if (!scheduleIdentity) throw new NotFoundError('Schedule not found');
        if (scheduleIdentity.isQaTest === true && trustedQaRun !== true) {
            throw new BadRequestError('QA schedules can only run through the Agentic Blog QA harness');
        }
        if (trustedQaRun === true && scheduleIdentity.isQaTest !== true) {
            throw new BadRequestError('trustedQaRun is only valid for a retained QA schedule');
        }
        if (!Number.isInteger(Number(qaIteration)) || Number(qaIteration) < 0 || Number(qaIteration) > 3) {
            throw new BadRequestError('qaIteration must be between 0 and 3');
        }
        const identity = buildManualExecutionIdentity({
            scheduleId: String(objectId),
            adminId,
            idempotencyKey
        });
        const dueAt = new Date();
        const existing = await BlogAutomationExecution.findOne({ executionKey: identity.executionKey }).lean();
        if (existing && trustedQaRun === true) {
            assertQaExecutionProvenance({
                schedule: { ...scheduleIdentity, qaIteration: Number(qaIteration) },
                execution: existing
            });
        }
        if (existing && existing.status !== 'queued') {
            return {
                queued: existing.status === 'running',
                duplicate: true,
                idempotent: true,
                scheduleId: String(objectId),
                executionId: String(existing._id),
                status: existing.status,
                createdAt: existing.createdAt
            };
        }

        const lockOwner = buildLeaseOwner(`manual-${process.pid}`);
        const schedule = await BlogAutomationSchedule.findOneAndUpdate(
            {
                _id: objectId,
                ...(trustedQaRun === true ? {
                    isQaTest: true,
                    qaBatchId: scheduleIdentity.qaBatchId,
                    qaCaseId: scheduleIdentity.qaCaseId,
                    environment: scheduleIdentity.environment,
                    executionMode: scheduleIdentity.executionMode,
                    qaTopicReservationId: scheduleIdentity.qaTopicReservationId
                } : {}),
                $or: [
                    { leaseUntil: null },
                    { leaseUntil: { $exists: false } },
                    { leaseUntil: { $lte: dueAt } }
                ]
            },
            {
                $set: {
                    lockedBy: lockOwner,
                    leaseUntil: new Date(dueAt.getTime() + LEASE_MS),
                    ...(trustedQaRun === true ? { qaIteration: Number(qaIteration) } : {})
                }
            },
            { new: true }
        ).lean();
        if (!schedule) {
            const exists = await BlogAutomationSchedule.findById(objectId).select('_id').lean();
            if (!exists) throw new NotFoundError('Schedule not found');
            if (existing) {
                return {
                    queued: true,
                    duplicate: true,
                    idempotent: true,
                    scheduleId: String(objectId),
                    executionId: String(existing._id),
                    status: existing.status
                };
            }
            throw new BadRequestError('This schedule already has an active run.');
        }

        const releaseLease = () => BlogAutomationSchedule.updateOne(
            { _id: objectId, lockedBy: lockOwner },
            { $unset: { leaseUntil: '', lockedBy: '' } }
        );
        const activeSince = new Date(dueAt.getTime() - MANUAL_RUN_ACTIVE_WINDOW_MS);
        try {
            const activeRun = await BlogAutomationExecution.findOne({
                scheduleId: objectId,
                _id: { $ne: existing?._id || null },
                status: { $in: ['queued', 'running'] },
                createdAt: { $gte: activeSince }
            }).select('_id status createdAt').lean();
            if (activeRun) {
                await releaseLease();
                throw new BadRequestError('This schedule already has an unfinished run.');
            }
        } catch (error) {
            if (!(error instanceof BadRequestError)) await releaseLease();
            throw error;
        }

        let execution = existing;
        if (!execution) {
            try {
                execution = await BlogAutomationExecution.create({
                    scheduleId: objectId,
                    executionKey: identity.executionKey,
                    status: 'queued',
                    startedAt: null,
                    correlationId: crypto.randomUUID(),
                    mode: 'draft',
                    ...trustedQaFields({ ...schedule, qaIteration: Number(qaIteration) }),
                    metadata: {
                        trigger: 'manual',
                        dueAt,
                        queuedAt: dueAt,
                        idempotencyKeyHash: identity.idempotencyKeyHash,
                        generatedIdempotencyKey: identity.generated,
                        pipelineVersion: 'agentic-blog-core-v2'
                    }
                });
            } catch (error) {
                if (error?.code !== 11000) {
                    await releaseLease();
                    throw error;
                }
                execution = await BlogAutomationExecution.findOne({ executionKey: identity.executionKey }).lean();
                if (!execution) {
                    await releaseLease();
                    throw error;
                }
            }
        }
        if (trustedQaRun === true) {
            assertQaExecutionProvenance({ schedule, execution });
        }

        Promise.resolve()
            .then(() => BlogAutomationScheduleService.executeSchedule({
                schedule,
                trigger: 'manual',
                dueAt,
                lockOwner,
                precreatedExecutionId: execution._id,
                executionKeyOverride: identity.executionKey
            }))
            .catch((error) => {
                console.error('Manual blog schedule run failed:', safeErrorCode({ code: error?.code || 'BLOG_SCHEDULE_MANUAL_FAILED' }));
            });
        return {
            queued: true,
            duplicate: Boolean(existing),
            idempotent: Boolean(existing),
            scheduleId: String(objectId),
            executionId: String(execution._id),
            status: execution.status || 'queued',
            queuedAt: dueAt.toISOString(),
            message: 'The run was durably queued. Follow its execution ID in run history.'
        };
    }

    static async runDailyDraftForQa({ scheduleId, idempotencyKey, adminId, trustedQaRun = false, qaIteration = 0 }) {
        if (trustedQaRun !== true) throw new BadRequestError('The QA Daily Draft entrypoint requires a trusted QA invocation');
        const objectId = convertToObjectIdMongodb(scheduleId);
        if (!objectId) throw new BadRequestError('Invalid schedule id');
        const schedule = await BlogAutomationSchedule.findById(objectId)
            .select('_id isQaTest executionMode qaBatchId qaCaseId')
            .lean();
        if (!schedule || schedule.isQaTest !== true) throw new NotFoundError('QA schedule not found');
        if (schedule.executionMode !== 'run_now') {
            throw new BadRequestError('The QA Daily Draft entrypoint only accepts run_now cases');
        }
        return BlogAutomationScheduleService.runNow({
            scheduleId: objectId,
            idempotencyKey,
            adminId,
            trustedQaRun: true,
            qaIteration
        });
    }

    static async claimQueuedExecution({ workerId = `queued-${process.pid}`, now = new Date() } = {}) {
        if (!isSeoAgentEnabled()) return null;
        const qaRuntimeEnabled =
            isQaRuntimeEnabled() &&
            ['local', 'staging'].includes(String(process.env.AGENTIC_BLOG_QA_ENVIRONMENT || '').trim().toLowerCase());
        const qaEnvironment = String(process.env.AGENTIC_BLOG_QA_ENVIRONMENT || '').trim().toLowerCase();
        const provenanceFilter = qaRuntimeEnabled
            ? { $or: [{ isQaTest: { $ne: true } }, { isQaTest: true, environment: qaEnvironment }] }
            : { isQaTest: { $ne: true } };
        let query = BlogAutomationExecution.find({
            ...provenanceFilter,
            status: { $in: ['queued', 'running'] },
            $and: [{
                $or: [
                    { 'metadata.queuedAt': { $exists: false } },
                    { 'metadata.queuedAt': { $lte: now } }
                ]
            }]
        });
        if (query?.sort) query = query.sort({ createdAt: 1, _id: 1 });
        if (query?.limit) query = query.limit(20);
        if (query?.lean) query = query.lean();
        const executions = await query;
        for (const execution of Array.isArray(executions) ? executions : []) {
            const lockOwner = buildLeaseOwner(workerId);
            const schedule = await BlogAutomationSchedule.findOneAndUpdate(
                {
                    _id: execution.scheduleId,
                    ...(execution.isQaTest === true
                        ? trustedQaFields(execution)
                        : { isQaTest: { $ne: true } }),
                    $or: [
                        { leaseUntil: null },
                        { leaseUntil: { $exists: false } },
                        { leaseUntil: { $lte: now } }
                    ]
                },
                {
                    $set: {
                        lockedBy: lockOwner,
                        leaseUntil: new Date(now.getTime() + LEASE_MS)
                    }
                },
                { new: true }
            ).lean();
            if (schedule) return { execution, schedule, lockOwner };
        }
        return null;
    }

    static async runQueuedOnce({ workerId = `queued-${process.pid}` } = {}) {
        const claimed = await BlogAutomationScheduleService.claimQueuedExecution({ workerId });
        if (!claimed) return null;
        if (claimed.execution.status === 'running') {
            const completedAt = new Date();
            const errorCode = 'STALE_RUNNING_EXECUTION_RECOVERED';
            const claimToken = getExecutionClaimToken(claimed.execution);
            const workOrderId = claimed.execution.contentWorkOrderId;
            let recovered = false;
            if (workOrderId && claimToken) {
                const revoked = await ContentWorkOrderService.transitionClaimed({
                    workOrderId,
                    claimToken,
                    status: 'blocked',
                    updates: { 'metadata.lastFailureCode': errorCode }
                });
                if (revoked) {
                    recovered = await ContentWorkOrderService.transitionExecutionClaimed({
                        executionId: claimed.execution._id,
                        workOrderId,
                        claimToken,
                        status: 'failed',
                        completedAt,
                        fromStatuses: ['running'],
                        updates: {
                            error: errorCode,
                            'metadata.recoveredAt': completedAt,
                            'metadata.recoveryReason': 'process_restart_after_schedule_lease_expiry'
                        }
                    });
                }
            } else {
                const result = await BlogAutomationExecution.updateOne(
                    {
                        _id: claimed.execution._id,
                        status: 'running',
                        ...unclaimedExecutionFilter()
                    },
                    {
                        $set: {
                            status: 'failed',
                            completedAt,
                            error: errorCode,
                            'metadata.recoveredAt': completedAt,
                            'metadata.recoveryReason': 'process_restart_after_schedule_lease_expiry'
                        },
                        $inc: { retryCount: 1 }
                    }
                );
                recovered = matchedExactlyOne(result);
            }
            if (!recovered) {
                await BlogAutomationSchedule.updateOne(
                    { _id: claimed.schedule._id, lockedBy: claimed.lockOwner },
                    { $unset: { leaseUntil: '', lockedBy: '' } }
                );
                return {
                    recovered: false,
                    executionId: String(claimed.execution._id),
                    status: 'running',
                    reason: 'stale_execution_ownership_not_revoked'
                };
            }
            if (claimed.execution.isQaTest === true) {
                await AgenticBlogQaCase.updateOne(
                    { _id: claimed.execution.qaCaseId, qaBatchId: claimed.execution.qaBatchId, isQaTest: true },
                    { $set: { executionId: claimed.execution._id, status: 'failed', completedAt, lastErrorCode: errorCode } }
                );
                await updateQaRunAttempt({
                    schedule: claimed.schedule,
                    execution: claimed.execution,
                    status: 'failed',
                    values: {
                        'runAttempts.$[attempt].dispatchState': 'failed',
                        'runAttempts.$[attempt].completedAt': completedAt,
                        'runAttempts.$[attempt].errorCode': errorCode
                    }
                });
            }
            await BlogAutomationSchedule.updateOne(
                { _id: claimed.schedule._id, lockedBy: claimed.lockOwner },
                {
                    $set: {
                        lastRunAt: completedAt,
                        lastRunStatus: 'failed',
                        lastError: errorCode,
                        ...(claimed.schedule.isQaTest === true ? { enabled: false, nextRunAt: null } : {})
                    },
                    ...(claimed.schedule.isQaTest === true ? { $inc: { runCount: 1 } } : {}),
                    $unset: { leaseUntil: '', lockedBy: '' }
                }
            );
            return { recovered: true, executionId: String(claimed.execution._id), status: 'failed', reason: errorCode };
        }
        const dueAt = claimed.execution.metadata?.dueAt || claimed.execution.metadata?.queuedAt || claimed.execution.createdAt || new Date();
        return BlogAutomationScheduleService.executeSchedule({
            schedule: claimed.schedule,
            trigger: claimed.execution.metadata?.trigger || 'manual',
            dueAt,
            lockOwner: claimed.lockOwner,
            precreatedExecutionId: claimed.execution._id,
            executionKeyOverride: claimed.execution.executionKey
        });
    }

    static async claimDueSchedule({ workerId, now = new Date() } = {}) {
        if (!isCronEnabled() || !isSeoAgentEnabled()) return null;
        const lockOwner = buildLeaseOwner(workerId);
        const qaEnvironment = String(process.env.AGENTIC_BLOG_QA_ENVIRONMENT || '').trim().toLowerCase();
        const qaRuntimeEnabled =
            isQaRuntimeEnabled() &&
            ['local', 'staging'].includes(qaEnvironment);
        return BlogAutomationSchedule.findOneAndUpdate(
            {
                ...(qaRuntimeEnabled
                    ? { $and: [{ $or: [{ isQaTest: { $ne: true } }, { isQaTest: true, environment: qaEnvironment }] }] }
                    : { isQaTest: { $ne: true } }),
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

    static async executeSchedule({
        schedule,
        trigger = 'scheduled',
        dueAt = new Date(),
        lockOwner,
        precreatedExecutionId = null,
        executionKeyOverride = ''
    }) {
        const scheduleId = String(schedule._id || schedule.id || '');
        const scheduleObjectId = convertToObjectIdMongodb(scheduleId);
        const resolvedLockOwner = String(lockOwner || schedule.lockedBy || '');
        if (!scheduleObjectId || !resolvedLockOwner) {
            throw new Error('A claimed schedule and unique lock owner are required');
        }
        let qaBatchExecutionAuthorized = true;
        if (schedule.isQaTest === true) {
            const qaConfig = buildAgenticBlogQaConfig();
            if (schedule.environment !== qaConfig.environment) {
                throw new BadRequestError('QA schedule environment does not match the active isolated QA runtime');
            }
            await ensureQaInfrastructureOnce({ config: qaConfig });
            const activeBatch = await AgenticBlogQaBatch.findOne({
                _id: schedule.qaBatchId,
                isQaTest: true,
                environment: schedule.environment,
                status: { $in: ['planned', 'running'] },
                stopNewDrafts: { $ne: true }
            }).select('_id').lean();
            qaBatchExecutionAuthorized = Boolean(activeBatch);
        }
        const executionKey = executionKeyOverride || buildExecutionKey({ scheduleId, trigger, dueAt });
        let execution;

        const updateQaAttempt = (status, values = {}) => updateQaRunAttempt({
            schedule,
            execution,
            status,
            values
        });

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
                if (Number(recovery?.modifiedCount || 0) > 0) {
                    recoveredStatus = 'failed';
                    await updateQaRunAttempt({
                        schedule,
                        execution: duplicate,
                        status: 'failed',
                        values: {
                            'runAttempts.$[attempt].dispatchState': 'failed',
                            'runAttempts.$[attempt].completedAt': completedAt,
                            'runAttempts.$[attempt].errorCode': 'STALE_DETERMINISTIC_EXECUTION_RECOVERED'
                        }
                    });
                }
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
            if (!qaBatchExecutionAuthorized) throw new BadRequestError('QA batch is not active for execution');
            assertCanRunAutomation({ requireCron: trigger === 'scheduled' });
            const now = new Date();
            if (trigger === 'scheduled' && !precreatedExecutionId) {
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
                if (precreatedExecutionId) {
                    await BlogAutomationExecution.updateOne(
                        { _id: precreatedExecutionId, status: 'queued' },
                        { $set: { status: 'skipped', completedAt: now, error: 'maximum_tasks_per_day_reached' } }
                    );
                }
                return {
                    skipped: true,
                    reason: 'maximum_tasks_per_day_reached',
                    nextRunAt
                };
            }

            try {
                if (precreatedExecutionId) {
                    execution = await BlogAutomationExecution.findOneAndUpdate(
                        {
                            _id: precreatedExecutionId,
                            executionKey,
                            status: 'queued',
                            ...(schedule.isQaTest === true
                                ? trustedQaFields(schedule)
                                : { isQaTest: { $ne: true } })
                        },
                        {
                            $set: {
                                status: 'running',
                                startedAt: now,
                                'metadata.trigger': trigger,
                                'metadata.dueAt': dueAt,
                                'metadata.leaseOwner': resolvedLockOwner,
                                'metadata.pipelineVersion': 'agentic-blog-core-v2'
                            }
                        },
                        { new: true }
                    );
                    if (!execution) {
                        const duplicate = await BlogAutomationExecution.findById(precreatedExecutionId).lean();
                        await releaseSchedule();
                        return {
                            skipped: true,
                            reason: 'precreated_execution_already_claimed',
                            executionKey,
                            executionId: duplicate?._id ? String(duplicate._id) : '',
                            status: duplicate?.status || 'missing'
                        };
                    }
                } else {
                    execution = await BlogAutomationExecution.create({
                        scheduleId,
                        executionKey,
                        status: 'running',
                        startedAt: now,
                        correlationId: crypto.randomUUID(),
                        ...trustedQaFields(schedule),
                        metadata: {
                            trigger,
                            dueAt,
                            leaseOwner: resolvedLockOwner,
                            pipelineVersion: 'agentic-blog-core-v2'
                        }
                    });
                }
                assertQaExecutionProvenance({ schedule, execution });
            } catch (error) {
                if (error?.code !== 11000) throw error;

                const duplicate = await BlogAutomationExecution.findOne({ executionKey }).lean();
                return await recoverDuplicateExecution(duplicate);
            }
        } catch (error) {
            await releaseSchedule();
            throw error;
        }

        await updateQaAttempt('running', {
            'runAttempts.$[attempt].dispatchState': 'dispatched',
            'runAttempts.$[attempt].startedAt': execution.startedAt || new Date()
        });

        let leaseLost = false;
        const heartbeat = setInterval(() => {
            Promise.resolve(BlogAutomationSchedule.updateOne(
                { _id: scheduleObjectId, lockedBy: resolvedLockOwner },
                { $set: { leaseUntil: new Date(Date.now() + LEASE_MS) } }
            )).then(result => {
                if (!matchedExactlyOne(result)) leaseLost = true;
            }).catch((error) => {
                leaseLost = true;
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
            if (leaseLost) throw scheduleFenceError();
            await assertActiveExecutionOwnership({
                scheduleObjectId,
                executionId: execution._id,
                lockOwner: resolvedLockOwner
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
                if (schedule.isQaTest === true) {
                    await AgenticBlogQaCase.updateOne(
                        { _id: schedule.qaCaseId, qaBatchId: schedule.qaBatchId, isQaTest: true },
                        {
                            $set: {
                                executionId: execution._id,
                                status: pipeline.blocked ? 'blocked' : 'failed',
                                completedAt,
                                lastErrorCode: String(pipeline.reason || 'QA_PIPELINE_SKIPPED').slice(0, 120)
                            }
                        }
                    );
                    await updateQaAttempt(pipeline.blocked ? 'blocked' : 'failed', {
                        'runAttempts.$[attempt].completedAt': completedAt,
                        'runAttempts.$[attempt].errorCode': String(pipeline.reason || 'QA_PIPELINE_SKIPPED').slice(0, 120)
                    });
                }
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
            execution = await claimPublishFence({
                scheduleObjectId,
                executionId: execution._id,
                lockOwner: resolvedLockOwner
            });
            const persistedArtifacts = await BlogAutomationExecution.updateOne({
                _id: execution._id,
                status: 'committing',
                'metadata.leaseOwner': resolvedLockOwner
            }, {
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
            if (!matchedExactlyOne(persistedArtifacts)) throw scheduleFenceError();
            const qaContext = schedule.isQaTest === true
                ? trustedQaFields(execution)
                : null;
            const result = await AutomationSeoBlogService.publishSeoBlog({ payload, trustedQaContext: qaContext });
            if (schedule.isQaTest === true && result.published) {
                const unsafeError = new Error('QA execution attempted to publish a public article');
                unsafeError.code = 'QA_PUBLICATION_FORBIDDEN';
                throw unsafeError;
            }
            const completedAt = new Date();
            const status = result.published ? 'published' : 'draft_created';
            let telegramResult = null;

            const terminalExecution = await BlogAutomationExecution.updateOne(
                {
                    _id: execution._id,
                    status,
                    blogId: result.blogId || null,
                    'metadata.leaseOwner': resolvedLockOwner,
                },
                {
                    $set: {
                        'metadata.trigger': trigger,
                        'metadata.dueAt': dueAt,
                        'metadata.resultReasons': result.reasons || [],
                        'metadata.imagePipelineStatus': result.imagePipelineStatus || '',
                        'metadata.pipelineVersion': 'agentic-blog-core-v2',
                        'metadata.decision': payload.contentDecision,
                        'metadata.googleIntelSnapshotId': payload.googleIntelSnapshotId,
                        'metadata.researchBundleId': payload.researchBundleId,
                        'metadata.editorialStyleProfileId': payload.editorialStyleProfileId,
                        'metadata.strategyPlanId': payload.strategyPlanId,
                        'metadata.productCatalogSnapshotId': payload.productCatalogSnapshotId || '',
                        'metadata.productSeedPlanId': payload.productSeedPlanId || '',
                        'metadata.editorialProductPlacementPlanId': payload.editorialProductPlacementPlanId || '',
                        'metadata.productSeedingMode': payload.productSeedingMode || 'off',
                        'metadata.productSeedingDecision': payload.productSeedingDecision || '',
                        'metadata.productSeeding': {
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
            );
            if (!matchedExactlyOne(terminalExecution)) throw scheduleFenceError();

            if (schedule.isQaTest === true && result.blogId) {
                await qaTopicUniquenessService.consume({
                    reservationId: schedule.qaTopicReservationId,
                    batchId: schedule.qaBatchId,
                    caseId: schedule.qaCaseId,
                    blogId: result.blogId,
                    executionId: execution._id,
                    iteration: Number(execution.qaIteration ?? schedule.qaIteration ?? 0),
                    executionMode: schedule.executionMode
                });
                await AgenticBlogQaCase.updateOne(
                    {
                        _id: schedule.qaCaseId,
                        qaBatchId: schedule.qaBatchId,
                        isQaTest: true
                    },
                    {
                        $set: {
                            executionId: execution._id,
                            blogId: result.blogId,
                            actualRunAt: completedAt,
                            status: 'draft_created'
                        }
                    }
                );
                await updateQaAttempt('draft_created', {
                    'runAttempts.$[attempt].completedAt': completedAt,
                    'runAttempts.$[attempt].errorCode': ''
                });
            }

            if (schedule.isQaTest === true) {
                telegramResult = { status: 'not_sent', reason: 'qa_telegram_forbidden', notificationType: '' };
            } else if (!result.published && result.blogId && !result.revisionStaged) {
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
            if (schedule.isQaTest === true) {
                await AgenticBlogQaCase.updateOne(
                    { _id: schedule.qaCaseId, qaBatchId: schedule.qaBatchId, isQaTest: true },
                    { $set: { executionId: execution?._id || null, status: 'failed', completedAt: new Date(), lastErrorCode: message } }
                ).catch(() => {});
                await updateQaAttempt('failed', {
                    'runAttempts.$[attempt].completedAt': new Date(),
                    'runAttempts.$[attempt].errorCode': message
                }).catch(() => {});
            }
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
                        fromStatuses: ['running', 'committing'],
                        updates: { error: message }
                    });
                } else {
                    await ContentWorkOrderService.transitionExecutionUnclaimed({
                        executionId: execution._id,
                        status: 'failed',
                        fromStatuses: ['running', 'committing'],
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
            await completeSchedule({
                runCountDelta: schedule.isQaTest === true ? 1 : 0,
                lastRunStatus: 'failed',
                lastError: message,
                nextRunAt: schedule.isQaTest === true ? null : nextRunAt
            });
            throw error;
        } finally {
            clearInterval(heartbeat);
        }
    }
}

module.exports = {
    BlogAutomationScheduleService,
    buildManualExecutionIdentity,
    buildLeaseOwner,
    buildRealTaskCountQuery,
    getScheduleDayBounds,
    isCronEnabled,
    isSeoAgentEnabled,
    mapExecution,
    mapSchedule,
    safeStoredError,
    assertActiveExecutionOwnership,
    claimPublishFence,
    scheduleFenceError,
    trustedQaFields,
    updateQaRunAttempt,
    validateManualIdempotencyKey
};
