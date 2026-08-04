'use strict'

const crypto = require('node:crypto');
const { BlogAutomationSchedule } = require('../models/blogAutomationSchedule.model');
const { BlogAutomationExecution } = require('../models/blogAutomationExecution.model');
const { blog } = require('../models/blog.model');
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
    expandSimpleSchedulePayload,
    getZonedParts,
    isSimpleSchedulePayload,
    normalizeSchedulePayload,
    parseBoolean,
    zonedTimeToUtc
} = require('../utils/blogSchedule.util');
const { resolveBlogOpenClawConfig } = require('./blogOpenClawSettings.service');
const { BlogTopicRoadmapService } = require('./contentOperations/blogTopicRoadmap.service');

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const LEASE_MS = 5 * 60 * 1000;
const MANUAL_RUN_ACTIVE_WINDOW_MS = 45 * 60 * 1000;
const HEARTBEAT_MS = Math.max(15 * 1000, Math.floor(LEASE_MS / 3));
const DEFAULT_RETRY_MAX_ATTEMPTS = 3;
const MIN_RETRY_MAX_ATTEMPTS = 1;
const MAX_RETRY_MAX_ATTEMPTS = 10;
const DEFAULT_RETRY_BASE_MS = 30 * 1000;
const MIN_RETRY_BASE_MS = 1000;
const MAX_RETRY_BASE_MS = 30 * 60 * 1000;
const DEFAULT_RETRY_MAX_MS = 15 * 60 * 1000;
const MAX_RETRY_DELAY_MS = 24 * 60 * 60 * 1000;
const TRANSIENT_EXECUTION_CODE_PATTERNS = [
    /(?:^|[_-])HTTP_(?:408|425|429|500|502|503|504)(?:$|[_-])/,
    /(?:^|[_-])(?:TIMEOUT|TIMEDOUT)(?:$|[_-])/,
    /(?:^|[_-])(?:RATE_LIMIT|TOO_MANY_REQUESTS)(?:$|[_-])/,
    /(?:^|[_-])(?:SERVICE_UNAVAILABLE|GATEWAY_UNAVAILABLE|GATEWAY_TIMEOUT)(?:$|[_-])/,
    /(?:^|[_-])(?:TEMPORARY|TRANSIENT|UPSTREAM_UNAVAILABLE)(?:$|[_-])/,
    /^E(?:CONNRESET|CONNREFUSED|TIMEDOUT|AI_AGAIN|NETUNREACH|HOSTUNREACH|PIPE)$/
];
const TERMINAL_EXECUTION_CODE_PATTERNS = [
    /(?:^|[_-])(?:INVALID|VALIDATION|MALFORMED|UNSUPPORTED|MISSING|NOT_ALLOWED|UNSAFE)(?:$|[_-])/,
    /(?:^|[_-])(?:AUTH|AUTHENTICATION|AUTHORIZATION|TOKEN|CREDENTIALS?)(?:$|[_-])/,
    /(?:^|[_-])CONFIG(?:URATION)?(?:$|[_-])/,
    /(?:^|[_-])MODEL(?:$|[_-])/,
    /(?:^|[_-])(?:UNAUTHORIZED|FORBIDDEN|NOT_FOUND)(?:$|[_-])/,
    /(?:^|[_-])(?:SAFETY|POLICY|PROVENANCE|FENCE_LOST)(?:$|[_-])/,
    /^QA_/,
    /^ROADMAP_NO_/,
    /^CONTENT_OPERATIONS_REQUIRED_SOURCE_UNAVAILABLE$/
];
const SAFE_ROADMAP_SKIP_CODES = new Set([
    'ROADMAP_NO_ACCEPTABLE_TOPIC',
    'ROADMAP_NO_SAFE_TOPIC',
    'ROADMAP_NO_READY_TOPIC',
    'ROADMAP_REQUIRED_EVIDENCE_UNAVAILABLE',
    'ROADMAP_SCORE_UNREACHABLE'
]);
const qaTopicUniquenessService = new QaTopicUniquenessService();
const createTopicRoadmapService = () => new BlogTopicRoadmapService();

const boundedInteger = (value, fallback, { min, max }) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
};

const getExecutionRetryPolicy = (env = process.env) => {
    const maxAttempts = boundedInteger(
        env.OPENCLAW_BLOG_RETRY_MAX_ATTEMPTS,
        DEFAULT_RETRY_MAX_ATTEMPTS,
        { min: MIN_RETRY_MAX_ATTEMPTS, max: MAX_RETRY_MAX_ATTEMPTS }
    );
    const baseMs = boundedInteger(
        env.OPENCLAW_BLOG_RETRY_BASE_MS,
        DEFAULT_RETRY_BASE_MS,
        { min: MIN_RETRY_BASE_MS, max: MAX_RETRY_BASE_MS }
    );
    const configuredMaxMs = boundedInteger(
        env.OPENCLAW_BLOG_RETRY_MAX_MS,
        DEFAULT_RETRY_MAX_MS,
        { min: MIN_RETRY_BASE_MS, max: MAX_RETRY_DELAY_MS }
    );
    return {
        maxAttempts,
        baseMs,
        maxMs: Math.max(baseMs, configuredMaxMs)
    };
};

const normalizeAttemptCount = (execution = {}) =>
    Math.min(
        MAX_RETRY_MAX_ATTEMPTS,
        Math.max(1, Number.isInteger(Number(execution.attemptCount))
            ? Number(execution.attemptCount)
            : 1)
    );

const calculateExecutionRetryAt = ({
    attemptCount = 1,
    now = new Date(),
    policy = getExecutionRetryPolicy()
} = {}) => {
    const exponent = Math.max(0, Math.min(20, Number(attemptCount || 1) - 1));
    const delayMs = Math.min(policy.maxMs, policy.baseMs * (2 ** exponent));
    return new Date(new Date(now).getTime() + delayMs);
};

const classifyExecutionFailure = (error = {}) => {
    const code = safeErrorCode({ code: error?.code || error?.name || 'BLOG_SCHEDULE_EXECUTION_FAILED' })
        .toUpperCase();
    if (TERMINAL_EXECUTION_CODE_PATTERNS.some((pattern) => pattern.test(code))) return 'terminal';
    // OpenClaw adapter errors deliberately expose a generic 503 to callers while
    // retaining the canonical upstream status in httpStatus. Classify that
    // canonical status first so an upstream auth/not-found response can never be
    // mistaken for a retryable wrapper 503.
    const upstreamStatus = Number(error?.httpStatus || 0);
    if ([408, 425, 429, 500, 502, 503, 504].includes(upstreamStatus)) return 'transient';
    if (Number.isInteger(upstreamStatus) && upstreamStatus >= 400 && upstreamStatus < 500) {
        return 'terminal';
    }
    const explicitRetryable = error?.retryable ?? error?.transient;
    if (explicitRetryable === true) return 'transient';
    if (explicitRetryable === false) return 'terminal';
    const status = Number(error?.statusCode || error?.status || error?.response?.status || 0);
    if (Number.isInteger(status) && status >= 400 && status < 500 && ![408, 425, 429].includes(status)) {
        return 'terminal';
    }
    if (TRANSIENT_EXECUTION_CODE_PATTERNS.some((pattern) => pattern.test(code))) return 'transient';
    if ([408, 425, 429, 500, 502, 503, 504].includes(status)) return 'transient';
    return 'terminal';
};

const buildRetryTransition = ({
    execution,
    errorCode,
    currentStage,
    now = new Date(),
    policy = getExecutionRetryPolicy()
}) => {
    const attemptCount = normalizeAttemptCount(execution);
    const persistedMaxAttempts = boundedInteger(
        execution?.maxAttempts,
        policy.maxAttempts,
        { min: MIN_RETRY_MAX_ATTEMPTS, max: MAX_RETRY_MAX_ATTEMPTS }
    );
    if (attemptCount >= persistedMaxAttempts) {
        return {
            retryable: false,
            attemptCount,
            maxAttempts: persistedMaxAttempts,
            failureClass: 'terminal',
            retryAt: null
        };
    }
    return {
        retryable: true,
        attemptCount,
        maxAttempts: persistedMaxAttempts,
        failureClass: 'transient',
        retryAt: calculateExecutionRetryAt({ attemptCount, now, policy }),
        errorCode,
        currentStage: String(currentStage || execution?.currentStage || 'pipeline').slice(0, 80)
    };
};

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
const isEmbeddedBlogWorkerEnabled = () => parseBoolean(
    process.env.OPENCLAW_EMBEDDED_WORKER,
    String(process.env.NODE_ENV || '').trim().toLowerCase() !== 'production'
);
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

const transitionExecutionToRetryWait = async ({
    execution,
    errorCode,
    currentStage,
    expectedLeaseOwner = '',
    now = new Date(),
    policy = getExecutionRetryPolicy()
}) => {
    if (!execution?._id) return { scheduled: false, reason: 'execution_missing' };
    const transition = buildRetryTransition({
        execution,
        errorCode,
        currentStage,
        now,
        policy
    });
    if (!transition.retryable) {
        return {
            scheduled: false,
            reason: 'attempts_exhausted',
            ...transition
        };
    }

    const claimToken = getExecutionClaimToken(execution);
    const workOrderId = execution.contentWorkOrderId || null;
    const normalizedLeaseOwner = String(expectedLeaseOwner || '').trim();

    const result = await BlogAutomationExecution.updateOne(
        {
            _id: execution._id,
            status: { $in: ['running', 'committing'] },
            ...(normalizedLeaseOwner
                ? { 'metadata.leaseOwner': normalizedLeaseOwner }
                : {}),
            ...(workOrderId && claimToken
                ? {
                    contentWorkOrderId: workOrderId,
                    'metadata.contentWorkOrderClaimToken': claimToken
                }
                : unclaimedExecutionFilter())
        },
        {
            $set: {
                status: 'retry_wait',
                retryAt: transition.retryAt,
                completedAt: null,
                currentStage: transition.currentStage,
                failureClass: 'transient',
                maxAttempts: transition.maxAttempts,
                error: errorCode,
                ...(workOrderId && claimToken ? { contentWorkOrderId: null } : {}),
                'metadata.contentWorkOrderClaimToken': '',
                'metadata.leaseOwner': '',
                'metadata.lastFailureCode': errorCode,
                'metadata.lastFailureAt': now,
                'metadata.retryScheduledAt': now,
                ...(workOrderId
                    ? { 'metadata.previousContentWorkOrderId': String(workOrderId) }
                    : {})
            },
            $inc: { retryCount: 1 }
        }
    );
    const scheduled = matchedExactlyOne(result);
    if (!scheduled) {
        return {
            scheduled: false,
            reason: 'execution_ownership_lost',
            ...transition
        };
    }

    // Move the execution behind its owner CAS before releasing the old Work
    // Order. A late worker can therefore never consume a successor attempt's
    // freshly-bound claim token. Failure to release is recoverable metadata
    // debt; the durable execution remains safely queued for retry.
    let workOrderReleased = true;
    if (workOrderId && claimToken) {
        workOrderReleased = Boolean(await ContentWorkOrderService.transitionClaimed({
            workOrderId,
            claimToken,
            status: 'blocked',
            updates: {
                'metadata.lastFailureCode': errorCode,
                'metadata.retryExecutionId': execution._id
            }
        }).catch(() => null));
    }
    return {
        scheduled: true,
        reason: workOrderReleased ? 'retry_scheduled' : 'retry_scheduled_work_order_release_lost',
        workOrderReleased,
        ...transition
    };
};

const activeScheduleLease = (schedule = {}, now = new Date()) => (
    Boolean(schedule.lockedBy) &&
    schedule.leaseUntil &&
    new Date(schedule.leaseUntil).getTime() > now.getTime()
);

const assertScheduleMutable = (schedule, now = new Date()) => {
    if (!activeScheduleLease(schedule, now)) return true;
    const error = new BadRequestError('This schedule has an active run and cannot be changed until it finishes.');
    error.code = 'BLOG_SCHEDULE_ACTIVE_RUN';
    throw error;
};

const isPersistedBlogCommitForExecution = ({ execution, persistedBlog }) => {
    if (!execution?._id || !persistedBlog?._id) return false;
    if (
        persistedBlog.agenticExecutionId
        && String(persistedBlog.agenticExecutionId) !== String(execution._id)
    ) {
        return false;
    }
    if (
        execution.contentWorkOrderId
        && String(persistedBlog.contentWorkOrderId || '') !== String(execution.contentWorkOrderId)
    ) {
        return false;
    }
    if (
        persistedBlog.sourceType
        && String(persistedBlog.sourceType).toLowerCase() !== 'agentic'
    ) {
        return false;
    }
    if (persistedBlog.isPublished === true) {
        return persistedBlog.isDraft !== true;
    }
    return persistedBlog.isDraft !== false && !persistedBlog.publishedAt;
};

const recoverStaleExecution = async ({
    execution,
    errorCode,
    recoveryReason,
    allowRetry = false,
    reconcileOnly = false,
    now = new Date()
}) => {
    const supportedStatuses = ['running', 'committing', 'draft_created', 'published'];
    if (!execution?._id || !supportedStatuses.includes(execution.status)) return false;
    const completedAt = now;
    const claimToken = getExecutionClaimToken(execution);
    const workOrderId = execution.contentWorkOrderId;
    const draft = await blog.findOne({ agenticExecutionId: execution._id })
        .select(
            '_id blog_slug blog_title isDraft isPublished publishedAt '
            + 'agenticExecutionId contentWorkOrderId sourceType imagePipelineStatus'
        )
        .lean();
    if (
        draft
        && !isPersistedBlogCommitForExecution({ execution, persistedBlog: draft })
    ) {
        return false;
    }
    let recovered = false;

    if (draft && ['draft_created', 'published'].includes(execution.status)) {
        recovered = (
            String(execution.blogId || '') === String(draft._id)
            && execution.status === (draft.isPublished ? 'published' : 'draft_created')
        );
    } else if (draft) {
        const recoveredImagePipelineStatus = ['pending', 'partial', 'complete', 'failed']
            .includes(String(draft.imagePipelineStatus || ''))
            ? String(draft.imagePipelineStatus)
            : '';
        // The blog insert is the commit point. If the process died after that insert
        // but before the execution transition, reconcile to success rather than
        // failing an already persisted draft or published article.
        let workOrderReconciled = !workOrderId;
        if (workOrderId && claimToken) {
            workOrderReconciled = Boolean(await ContentWorkOrderService.transitionClaimed({
                workOrderId,
                claimToken,
                status: draft.isPublished ? 'completed' : 'reviewing',
                updates: { 'metadata.lastRecoveryCode': errorCode }
            }).catch(() => null));
        }
        if (!workOrderReconciled) return false;
        const result = await BlogAutomationExecution.updateOne(
            {
                _id: execution._id,
                status: execution.status,
                ...(workOrderId ? { contentWorkOrderId: workOrderId } : {}),
                ...(claimToken ? { 'metadata.contentWorkOrderClaimToken': claimToken } : unclaimedExecutionFilter())
            },
            {
                $set: {
                    status: draft.isPublished ? 'published' : 'draft_created',
                    completedAt,
                    blogId: draft._id,
                    blogSlug: draft.blog_slug || '',
                    blogTitle: draft.blog_title || '',
                    mode: draft.isPublished ? 'publish' : 'draft',
                    error: '',
                    retryAt: null,
                    currentStage: 'completed',
                    failureClass: '',
                    'metadata.contentWorkOrderClaimToken': '',
                    'metadata.recoveredAt': completedAt,
                    'metadata.recoveryCode': safeStoredError(errorCode),
                    'metadata.recoveryReason': String(
                        recoveryReason || 'persisted_blog_reconciled_after_process_restart'
                    ).slice(0, 160),
                    ...(recoveredImagePipelineStatus
                        ? { 'metadata.imagePipelineStatus': recoveredImagePipelineStatus }
                        : {})
                }
            }
        );
        recovered = matchedExactlyOne(result);
    }

    if (!recovered && !draft && reconcileOnly) return false;

    if (!recovered && !draft && allowRetry) {
        const retryTransition = await transitionExecutionToRetryWait({
            execution,
            errorCode,
            currentStage: execution.currentStage || execution.status,
            now
        });
        recovered = retryTransition.scheduled;
    }

    if (!recovered && !draft && workOrderId && claimToken) {
        const revoked = await ContentWorkOrderService.transitionClaimed({
            workOrderId,
            claimToken,
            status: 'blocked',
            updates: { 'metadata.lastFailureCode': errorCode }
        });
        if (revoked) {
            recovered = await ContentWorkOrderService.transitionExecutionClaimed({
                executionId: execution._id,
                workOrderId,
                claimToken,
                status: 'failed',
                completedAt,
                fromStatuses: ['running', 'committing'],
                updates: {
                    error: errorCode,
                    retryAt: null,
                    currentStage: execution.currentStage || 'recovery',
                    failureClass: 'terminal',
                    'metadata.recoveredAt': completedAt,
                    'metadata.recoveryReason': recoveryReason
                }
            });
        }
    } else if (!recovered && !draft) {
        recovered = await ContentWorkOrderService.transitionExecutionUnclaimed({
            executionId: execution._id,
            status: 'failed',
            completedAt,
            fromStatuses: ['running', 'committing'],
            updates: {
                error: errorCode,
                retryAt: null,
                currentStage: execution.currentStage || 'recovery',
                failureClass: 'terminal',
                'metadata.recoveredAt': completedAt,
                'metadata.recoveryReason': recoveryReason
            }
        });
        if (recovered) {
            await BlogAutomationExecution.updateOne(
                { _id: execution._id, status: 'failed' },
                { $inc: { retryCount: 1 } }
            );
        }
    }
    if (recovered && draft) {
        console.info(JSON.stringify({
            event: 'persisted_blog_commit_reconciled',
            executionId: String(execution._id).slice(0, 128),
            blogId: String(draft._id).slice(0, 128),
            status: draft.isPublished ? 'published' : 'draft_created',
            recoveryCode: safeStoredError(errorCode)
        }));
    }
    if (
        recovered &&
        execution.isQaTest !== true &&
        (execution.topicRoadmapItemId || execution.metadata?.topicRoadmap?.itemId)
    ) {
        await createTopicRoadmapService().recoverExecutionClaim({
            executionId: execution._id,
            reasonCode: errorCode
        }).catch(() => null);
    }
    return recovered;
};

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
                currentStage: 'commit',
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
        direction: schedule.agentConfig?.direction || schedule.description || '',
        simpleContract: schedule.agentConfig?.simpleContract === true,
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
        maximumTasksPerDay: Number(schedule.maximumTasksPerDay || 0),
        monitoringWindows: schedule.monitoringWindows || ['1d', '7d', '14d', '30d', '90d'],
        agentConfig: schedule.agentConfig || {},
        lastRunAt: schedule.lastRunAt,
        nextRunAt: schedule.nextRunAt,
        lastRunStatus: schedule.lastRunStatus || '',
        lastError: safeStoredError(schedule.lastError),
        lastOutcomeCode: safeStoredError(schedule.lastOutcomeCode),
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
        retryAt: execution.retryAt || null,
        attemptCount: Math.max(0, Number(execution.attemptCount || 0)),
        maxAttempts: Math.max(1, Number(execution.maxAttempts || DEFAULT_RETRY_MAX_ATTEMPTS)),
        retryCount: Math.max(0, Number(execution.retryCount || 0)),
        currentStage: String(execution.currentStage || '').slice(0, 80),
        failureClass: ['transient', 'terminal'].includes(execution.failureClass)
            ? execution.failureClass
            : '',
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
        topicRoadmapId: execution.topicRoadmapId ? String(execution.topicRoadmapId) : '',
        topicRoadmapItemId: execution.topicRoadmapItemId ? String(execution.topicRoadmapItemId) : '',
        topicRoadmapGeneration: Number(execution.topicRoadmapGeneration || 0),
        topicDirectionRevision: Number(execution.topicDirectionRevision || 0),
        topicLineage: {
            ideationRunIds: (execution.agentExecutionRefs || []).map(String),
            totalScore: Math.min(100, Math.max(0, Number(execution.topicScoreReport?.totalScore) || 0)),
            noveltySubtotal: Math.min(65, Math.max(0, Number(execution.topicScoreReport?.noveltySubtotal) || 0)),
            rubricVersion: execution.topicScoreReport?.rubricVersion || '',
            corpusVersion: execution.topicScoreReport?.corpusVersion || '',
            hardGatesPassed: execution.topicScoreReport?.hardGatesPassed === true
        },
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

const normalizeExecutionSummaryScheduleIds = (value) => {
    const rawIds = Array.isArray(value)
        ? value
        : String(value || '').split(',');
    const requestedIds = rawIds.map((entry) => String(entry || '').trim()).filter(Boolean);
    if (!requestedIds.length) throw new BadRequestError('scheduleIds is required');
    if (requestedIds.length > 50) throw new BadRequestError('scheduleIds cannot exceed 50 items');

    const uniqueIds = [];
    const seen = new Set();
    for (const scheduleId of requestedIds) {
        const objectId = convertToObjectIdMongodb(scheduleId);
        if (!objectId) throw new BadRequestError('Invalid schedule id');
        const canonicalId = String(objectId);
        if (seen.has(canonicalId)) continue;
        seen.add(canonicalId);
        uniqueIds.push({ canonicalId, objectId });
    }
    return uniqueIds;
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
    maximumTasksPerDay: schedule.maximumTasksPerDay ?? 0,
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
        throw new BadRequestError('Idempotency-Key must be 8-128 safe ASCII characters');
    }
    const key = String(value).trim();
    if (key.length < 8 || key.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
        throw new BadRequestError('Idempotency-Key must be 8-128 safe ASCII characters');
    }
    return { key, generated: false };
};

const safeExecutionDecisionReason = (value) => String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/https?:\/\/[^\s<>"']+/gi, '[link removed]')
    .replace(/\b(?:authorization|token|secret|password|credential|api[_-]?key)\b\s*[:=]\s*[^\s,;]+/gi, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);

const mapExecutionSummary = (execution) => {
    if (!execution) return null;
    const errorCode = safeStoredError(execution.error);
    const outcomeCode = safeStoredError(execution.metadata?.outcomeCode);
    return {
        id: String(execution._id || execution.id),
        scheduleId: String(execution.scheduleId || ''),
        status: String(execution.status || ''),
        startedAt: execution.startedAt || null,
        completedAt: execution.completedAt || null,
        retryAt: execution.retryAt || null,
        attemptCount: Math.max(0, Number(execution.attemptCount || 0)),
        maxAttempts: Math.max(1, Number(execution.maxAttempts || DEFAULT_RETRY_MAX_ATTEMPTS)),
        currentStage: String(execution.currentStage || '').slice(0, 80),
        failureClass: ['transient', 'terminal'].includes(execution.failureClass)
            ? execution.failureClass
            : '',
        createdAt: execution.createdAt || null,
        blogId: execution.blogId ? String(execution.blogId) : '',
        correlationId: String(execution.correlationId || '').slice(0, 128),
        error: errorCode,
        errorCode,
        metadata: {
            trigger: String(execution.metadata?.trigger || '').slice(0, 80),
            outcomeCode,
            decisionReason: safeExecutionDecisionReason(execution.metadata?.decisionReason)
        }
    };
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
    `${String(workerId || `worker-${process.pid}`).slice(0, 160)}:${crypto.randomUUID()}`;

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
        const effectivePayload = isSimpleSchedulePayload(payload)
            ? expandSimpleSchedulePayload(payload)
            : payload;
        const normalized = normalizeSchedulePayload(effectivePayload);
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
        assertScheduleMutable(current);

        let effectivePatch = payload;
        if (isSimpleSchedulePayload(payload)) {
            effectivePatch = expandSimpleSchedulePayload(payload, {
                currentAgentConfig: current.agentConfig || {}
            });
            if (current.agentConfig?.simpleContract !== true && !current.agentConfig?.legacyConfig) {
                // First conversion of an advanced schedule: retain a safe,
                // non-secret compatibility snapshot of the replaced settings.
                effectivePatch.agentConfig.legacyConfig = {
                    convertedAt: new Date().toISOString(),
                    scheduleType: current.scheduleType,
                    daily: current.daily || null,
                    weekly: current.weekly || null,
                    interval: current.interval || null,
                    runLimit: Number(current.runLimit || 0),
                    mode: current.mode || 'fixed_brief',
                    minimumOpportunityScore: current.minimumOpportunityScore ?? 0.65,
                    maximumTasksPerDay: Number(current.maximumTasksPerDay || 0)
                };
            }
        }
        const normalized = normalizeSchedulePayload(mergeSchedulePatch(current, effectivePatch));
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
        assertScheduleMutable(current);
        const nextRunAt = enabled ? calculateNextRun({ schedule: { ...current, enabled: true } }) : null;
        const updated = await BlogAutomationSchedule.findByIdAndUpdate(
            objectId,
            {
                $set: {
                    enabled: Boolean(enabled),
                    nextRunAt,
                    leaseUntil: null,
                    lockedBy: '',
                    lastError: '',
                    lastOutcomeCode: ''
                }
            },
            { new: true }
        ).lean();
        return mapSchedule(updated);
    }

    static async deleteSchedule({ scheduleId }) {
        const objectId = convertToObjectIdMongodb(scheduleId);
        if (!objectId) throw new BadRequestError('Invalid schedule id');
        const current = await BlogAutomationSchedule.findById(objectId)
            .select('_id isQaTest leaseUntil lockedBy')
            .lean();
        if (!current) throw new NotFoundError('Schedule not found');
        if (current.isQaTest === true) throw new BadRequestError('QA schedules are retained for audit and cannot be deleted here');
        assertScheduleMutable(current);
        await createTopicRoadmapService().archiveForSchedule({ scheduleId: objectId });
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

    static async listExecutionSummaries({ scheduleIds, limit = 5 } = {}) {
        const requested = normalizeExecutionSummaryScheduleIds(scheduleIds);
        const safeLimit = Math.min(Math.max(Number(limit) || 5, 1), 5);
        const rows = await BlogAutomationExecution.aggregate([
            {
                $match: {
                    scheduleId: { $in: requested.map((entry) => entry.objectId) },
                    isQaTest: { $ne: true }
                }
            },
            {
                $project: {
                    _id: 1,
                    scheduleId: 1,
                    status: 1,
                    startedAt: 1,
                    completedAt: 1,
                    retryAt: 1,
                    attemptCount: 1,
                    maxAttempts: 1,
                    currentStage: 1,
                    failureClass: 1,
                    createdAt: 1,
                    blogId: 1,
                    correlationId: 1,
                    error: 1,
                    'metadata.trigger': 1,
                    'metadata.outcomeCode': 1,
                    'metadata.decisionReason': 1
                }
            },
            {
                $group: {
                    _id: '$scheduleId',
                    executions: {
                        $topN: {
                            n: safeLimit,
                            sortBy: { createdAt: -1, _id: -1 },
                            output: '$$ROOT'
                        }
                    }
                }
            }
        ]);
        const bySchedule = new Map((Array.isArray(rows) ? rows : []).map((row) => [
            String(row?._id || ''),
            (Array.isArray(row?.executions) ? row.executions : [])
                .slice(0, safeLimit)
                .map(mapExecutionSummary)
        ]));
        return {
            checkedAt: new Date().toISOString(),
            summaries: requested.map(({ canonicalId }) => ({
                scheduleId: canonicalId,
                executions: bySchedule.get(canonicalId) || []
            }))
        };
    }

    static async getTopicRoadmap({ scheduleId, limit = 30 } = {}) {
        return createTopicRoadmapService().getRoadmap({ scheduleId, limit });
    }

    static async regenerateTopicRoadmap({
        scheduleId,
        idempotencyKey,
        adminId,
        requestId,
        reason = 'regenerated_by_admin'
    } = {}) {
        return createTopicRoadmapService().enqueueRegeneration({
            scheduleId,
            idempotencyKey,
            adminId,
            requestId,
            reason: String(reason || 'regenerated_by_admin').slice(0, 160)
        });
    }

    static async runQueuedTopicRoadmapRegenerationOnce({ workerId = `topic-roadmap-${process.pid}` } = {}) {
        return createTopicRoadmapService().runQueuedRegenerationOnce({ workerId });
    }

    static async dismissTopicRoadmapItem({
        scheduleId,
        itemId,
        reason = 'dismissed_by_admin'
    } = {}) {
        return createTopicRoadmapService().dismiss({
            scheduleId,
            itemId,
            reason: String(reason || 'dismissed_by_admin').slice(0, 160)
        });
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

    static async runNow({
        scheduleId,
        idempotencyKey,
        adminId,
        requestId = '',
        trustedQaRun = false,
        qaIteration = 0
    }) {
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
        const normalizedRequestId = String(requestId || '').trim();
        const correlationId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(normalizedRequestId)
            ? normalizedRequestId
            : crypto.randomUUID();
        const existing = await BlogAutomationExecution.findOne({ executionKey: identity.executionKey }).lean();
        if (existing && trustedQaRun === true) {
            assertQaExecutionProvenance({
                schedule: { ...scheduleIdentity, qaIteration: Number(qaIteration) },
                execution: existing
            });
        }
        if (existing && existing.status !== 'queued') {
            return {
                queued: ['running', 'retry_wait'].includes(existing.status),
                duplicate: true,
                idempotent: true,
                scheduleId: String(objectId),
                executionId: String(existing._id),
                correlationId: existing.correlationId || correlationId,
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
                    correlationId: existing.correlationId || correlationId,
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
                status: { $in: ['queued', 'retry_wait', 'running', 'committing'] },
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
                    retryAt: null,
                    attemptCount: 0,
                    maxAttempts: getExecutionRetryPolicy().maxAttempts,
                    currentStage: 'queued',
                    failureClass: '',
                    correlationId,
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

        if (isEmbeddedBlogWorkerEnabled()) {
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
                    console.error(JSON.stringify({
                        event: 'manual_blog_schedule_run_failed',
                        executionId: String(execution?._id || '').slice(0, 128),
                        correlationId: String(execution?.correlationId || correlationId).slice(0, 128),
                        errorCode: safeErrorCode({ code: error?.code || 'BLOG_SCHEDULE_MANUAL_FAILED' })
                    }));
                });
        } else {
            await releaseLease();
        }
        return {
            queued: true,
            duplicate: Boolean(existing),
            idempotent: Boolean(existing),
            scheduleId: String(objectId),
            executionId: String(execution._id),
            correlationId: execution.correlationId || correlationId,
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
            $and: [{
                $or: [
                    {
                        status: { $in: ['queued', 'running', 'committing'] },
                        $or: [
                            { 'metadata.queuedAt': { $exists: false } },
                            { 'metadata.queuedAt': { $lte: now } }
                        ]
                    },
                    {
                        status: 'retry_wait',
                        retryAt: { $ne: null, $lte: now }
                    }
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
        if (['running', 'committing'].includes(claimed.execution.status)) {
            const completedAt = new Date();
            const errorCode = claimed.execution.status === 'committing'
                ? 'STALE_COMMITTING_EXECUTION_RECOVERED'
                : 'STALE_RUNNING_EXECUTION_RECOVERED';
            const recovered = await recoverStaleExecution({
                execution: claimed.execution,
                errorCode,
                recoveryReason: 'process_restart_after_schedule_lease_expiry',
                allowRetry: true,
                now: completedAt
            });
            if (!recovered) {
                await BlogAutomationSchedule.updateOne(
                    { _id: claimed.schedule._id, lockedBy: claimed.lockOwner },
                    { $unset: { leaseUntil: '', lockedBy: '' } }
                );
                return {
                    recovered: false,
                    executionId: String(claimed.execution._id),
                    status: claimed.execution.status,
                    reason: 'stale_execution_ownership_not_revoked'
                };
            }
            const recoveredExecution = await BlogAutomationExecution.findById(claimed.execution._id)
                .select('status retryAt attemptCount maxAttempts currentStage failureClass')
                .lean();
            const finalStatus = recoveredExecution?.status || 'failed';
            if (claimed.execution.isQaTest === true) {
                if (finalStatus === 'retry_wait') {
                    await AgenticBlogQaCase.updateOne(
                        { _id: claimed.execution.qaCaseId, qaBatchId: claimed.execution.qaBatchId, isQaTest: true },
                        { $set: { executionId: claimed.execution._id, status: 'running', lastErrorCode: errorCode } }
                    );
                    await updateQaRunAttempt({
                        schedule: claimed.schedule,
                        execution: claimed.execution,
                        status: 'running',
                        values: {
                            'runAttempts.$[attempt].dispatchState': 'pending',
                            'runAttempts.$[attempt].errorCode': errorCode
                        }
                    });
                } else {
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
            }
            if (finalStatus === 'retry_wait' && recoveredExecution?.retryAt) {
                await BlogAutomationSchedule.updateOne(
                    { _id: claimed.schedule._id, lockedBy: claimed.lockOwner },
                    {
                        $set: {
                            lastRunStatus: 'retry_wait',
                            lastError: errorCode,
                            lastOutcomeCode: '',
                            leaseUntil: recoveredExecution.retryAt,
                            lockedBy: ''
                        }
                    }
                );
            } else {
                await BlogAutomationSchedule.updateOne(
                    { _id: claimed.schedule._id, lockedBy: claimed.lockOwner },
                    {
                        $set: {
                            lastRunAt: completedAt,
                            lastRunStatus: finalStatus,
                            lastError: finalStatus === 'failed' ? errorCode : '',
                            lastOutcomeCode: '',
                            ...(claimed.schedule.isQaTest === true ? { enabled: false, nextRunAt: null } : {})
                        },
                        ...(claimed.schedule.isQaTest === true ? { $inc: { runCount: 1 } } : {}),
                        $unset: { leaseUntil: '', lockedBy: '' }
                    }
                );
            }
            return { recovered: true, executionId: String(claimed.execution._id), status: finalStatus, reason: errorCode };
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
        const retryPolicy = getExecutionRetryPolicy();
        let currentStage = 'claim';
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

        const completeSchedule = async ({
            runCountDelta = 0,
            lastRunStatus,
            lastError = '',
            lastOutcomeCode = '',
            nextRunAt
        }) => {
            const update = {
                $set: {
                    lastRunAt: new Date(),
                    lastRunStatus,
                    lastError,
                    lastOutcomeCode,
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

        const deferScheduleForRetry = ({ retryAt, errorCode }) => {
            if (!retryAt) return releaseSchedule();
            return BlogAutomationSchedule.updateOne(
                { _id: scheduleObjectId, lockedBy: resolvedLockOwner },
                {
                    $set: {
                        lastRunStatus: 'retry_wait',
                        lastError: errorCode,
                        lastOutcomeCode: '',
                        leaseUntil: retryAt,
                        lockedBy: ''
                    }
                }
            );
        };

        const recoverDuplicateExecution = async (duplicate) => {
            const completedAt = new Date();
            let recoveredStatus = duplicate?.status || 'duplicate_execution';
            if (['running', 'committing'].includes(duplicate?.status)) {
                const errorCode = duplicate.status === 'committing'
                    ? 'STALE_COMMITTING_EXECUTION_RECOVERED'
                    : 'STALE_DETERMINISTIC_EXECUTION_RECOVERED';
                const recovered = await recoverStaleExecution({
                    execution: duplicate,
                    errorCode,
                    recoveryReason: 'stale_schedule_lease',
                    allowRetry: true,
                    now: completedAt
                });
                if (recovered) {
                    const latest = await BlogAutomationExecution.findById(duplicate._id)
                        .select('status retryAt attemptCount maxAttempts currentStage failureClass')
                        .lean();
                    recoveredStatus = latest?.status || 'failed';
                    duplicate = { ...duplicate, ...latest };
                    await updateQaRunAttempt({
                        schedule,
                        execution: duplicate,
                        status: recoveredStatus === 'retry_wait' ? 'running' : recoveredStatus,
                        values: {
                            'runAttempts.$[attempt].dispatchState': recoveredStatus === 'retry_wait'
                                ? 'pending'
                                : recoveredStatus,
                            ...(recoveredStatus === 'retry_wait'
                                ? {}
                                : { 'runAttempts.$[attempt].completedAt': completedAt }),
                            'runAttempts.$[attempt].errorCode': ['failed', 'retry_wait'].includes(recoveredStatus)
                                ? errorCode
                                : ''
                        }
                    });
                }
            }
            if (recoveredStatus === 'retry_wait') {
                await deferScheduleForRetry({
                    retryAt: duplicate.retryAt,
                    errorCode: duplicate.error || 'STALE_DETERMINISTIC_EXECUTION_RECOVERED'
                });
                return {
                    retryScheduled: true,
                    skipped: false,
                    reason: 'duplicate_execution_retry_scheduled',
                    executionKey,
                    executionId: duplicate?._id ? String(duplicate._id) : '',
                    retryAt: duplicate.retryAt || null
                };
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
                lastError: recoveredStatus === 'failed' ? 'STALE_DETERMINISTIC_EXECUTION_RECOVERED' : '',
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
                if (existingExecution?.status === 'retry_wait') {
                    const retryAt = existingExecution.retryAt
                        ? new Date(existingExecution.retryAt)
                        : null;
                    if (!retryAt || retryAt.getTime() > now.getTime()) {
                        await deferScheduleForRetry({
                            retryAt,
                            errorCode: existingExecution.error || 'BLOG_EXECUTION_RETRY_WAIT'
                        });
                        return {
                            retryScheduled: true,
                            skipped: false,
                            reason: 'duplicate_execution_retry_pending',
                            executionKey,
                            executionId: String(existingExecution._id),
                            retryAt
                        };
                    }
                    precreatedExecutionId = existingExecution._id;
                } else if (existingExecution) {
                    return await recoverDuplicateExecution(existingExecution);
                }
            }
            // The per-day task limit has been removed: schedules may create as
            // many posts per day as their configured run times trigger.

            try {
                if (precreatedExecutionId) {
                    execution = await BlogAutomationExecution.findOneAndUpdate(
                        {
                            _id: precreatedExecutionId,
                            executionKey,
                            $or: [
                                { status: 'queued' },
                                { status: 'retry_wait', retryAt: { $ne: null, $lte: now } }
                            ],
                            ...(schedule.isQaTest === true
                                ? trustedQaFields(schedule)
                                : { isQaTest: { $ne: true } })
                        },
                        {
                            $set: {
                                status: 'running',
                                startedAt: now,
                                completedAt: null,
                                retryAt: null,
                                currentStage: 'claim',
                                failureClass: '',
                                error: '',
                                'metadata.trigger': trigger,
                                'metadata.dueAt': dueAt,
                                'metadata.leaseOwner': resolvedLockOwner,
                                'metadata.pipelineVersion': 'agentic-blog-core-v2',
                                'metadata.resolvedConfigSnapshot': resolveBlogOpenClawConfig({ schedule, now })
                            },
                            $inc: { attemptCount: 1 }
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
                        retryAt: null,
                        attemptCount: 1,
                        maxAttempts: retryPolicy.maxAttempts,
                        currentStage: 'claim',
                        failureClass: '',
                        correlationId: crypto.randomUUID(),
                        ...trustedQaFields(schedule),
                        metadata: {
                            trigger,
                            dueAt,
                            leaseOwner: resolvedLockOwner,
                            pipelineVersion: 'agentic-blog-core-v2',
                            resolvedConfigSnapshot: resolveBlogOpenClawConfig({ schedule, now })
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

        let roadmapService = null;
        let roadmapClaim = null;
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

        const markExecutionStage = async (stage) => {
            currentStage = String(stage || 'pipeline').slice(0, 80);
            const marked = await BlogAutomationExecution.updateOne(
                {
                    _id: execution._id,
                    status: { $in: ['running', 'committing'] },
                    'metadata.leaseOwner': resolvedLockOwner
                },
                { $set: { currentStage } }
            );
            if (!matchedExactlyOne(marked)) throw scheduleFenceError();
            execution.currentStage = currentStage;
        };

        try {
            const now = new Date();
            const usesTopicRoadmap =
                schedule.isQaTest !== true &&
                schedule.agentConfig?.simpleContract === true &&
                schedule.agentConfig?.topicRoadmapEnabled !== false;
            if (usesTopicRoadmap) {
                await markExecutionStage('topic_roadmap');
                roadmapService = createTopicRoadmapService();
                await roadmapService.recoverExpiredClaims({ now });
                await roadmapService.ensureReadyBuffer({
                    scheduleId,
                    reason: trigger === 'manual' ? 'manual_run' : 'scheduled_run'
                });
                roadmapClaim = await roadmapService.claimNext({
                    scheduleId,
                    executionId: execution._id
                });
                const roadmapBound = await BlogAutomationExecution.updateOne(
                    {
                        _id: execution._id,
                        status: 'running',
                        'metadata.leaseOwner': resolvedLockOwner
                    },
                    {
                        $set: {
                            topicRoadmapId: roadmapClaim.roadmapId,
                            topicRoadmapItemId: roadmapClaim.itemId,
                            topicRoadmapGeneration: roadmapClaim.generation,
                            topicDirectionRevision: roadmapClaim.directionRevision,
                            agentExecutionRefs: roadmapClaim.ideationRunId ? [roadmapClaim.ideationRunId] : [],
                            topicScoreReport: roadmapClaim.topicScoreReport,
                            'metadata.topicRoadmap': {
                                roadmapId: roadmapClaim.roadmapId,
                                itemId: roadmapClaim.itemId,
                                generation: roadmapClaim.generation,
                                directionRevision: roadmapClaim.directionRevision,
                                ideationRunId: roadmapClaim.ideationRunId,
                                rubricVersion: roadmapClaim.topicScoreReport?.rubricVersion || '',
                                corpusVersion: roadmapClaim.topicScoreReport?.corpusVersion || '',
                                topic: roadmapClaim.topic,
                                angle: roadmapClaim.angle,
                                productIds: (roadmapClaim.productEvidence || [])
                                    .map((item) => String(item.productId || ''))
                                    .filter(Boolean),
                                sourceIds: (roadmapClaim.marketEvidence || [])
                                    .map((item) => String(item.sourceId || ''))
                                    .filter(Boolean)
                            }
                        }
                    }
                );
                if (!matchedExactlyOne(roadmapBound)) throw scheduleFenceError();
            }
            await markExecutionStage('agentic_pipeline');
            const pipeline = await AgenticBlogCoreService.runPipeline({
                schedule,
                executionKey,
                executionId: execution._id,
                now,
                trustedRoadmapContext: roadmapClaim
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
            if (pipeline.blocked || pipeline.skipped) {
                const completedAt = new Date();
                const nextRunAt = calculateNextRun({
                    schedule: { ...schedule, runCount: Number(schedule.runCount || 0) + 1, lastRunAt: completedAt },
                    from: completedAt
                });
                const terminalStatus = pipeline.blocked ? 'blocked' : 'skipped';
                const decisionCode = String(
                    pipeline.blocked
                        ? pipeline.context?.contentPlanning?.blockCode || pipeline.reason || 'CONTENT_OPERATIONS_BLOCKED'
                        : pipeline.reason || ''
                ).slice(0, 160);
                const terminalExecution = await BlogAutomationExecution.updateOne({
                    _id: execution._id,
                    status: 'running',
                    'metadata.leaseOwner': resolvedLockOwner,
                    ...unclaimedExecutionFilter()
                }, {
                    $set: {
                        status: terminalStatus, completedAt,
                        error: pipeline.blocked ? decisionCode : '',
                        retryAt: null,
                        currentStage: 'completed',
                        failureClass: pipeline.blocked ? 'terminal' : '',
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
                            trigger,
                            dueAt,
                            decision: pipeline.blocked ? 'blocked' : 'skip',
                            decisionReason: decisionCode || pipeline.reason,
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
                if (!matchedExactlyOne(terminalExecution)) throw scheduleFenceError();
                if (schedule.isQaTest === true) {
                    await AgenticBlogQaCase.updateOne(
                        { _id: schedule.qaCaseId, qaBatchId: schedule.qaBatchId, isQaTest: true },
                        {
                            $set: {
                                executionId: execution._id,
                                status: pipeline.blocked ? 'blocked' : 'failed',
                                completedAt,
                                lastErrorCode: String(pipeline.reason || 'QA_PIPELINE_SKIPPED').slice(0, 160)
                            }
                        }
                    );
                    await updateQaAttempt(pipeline.blocked ? 'blocked' : 'failed', {
                        'runAttempts.$[attempt].completedAt': completedAt,
                        'runAttempts.$[attempt].errorCode': String(pipeline.reason || 'QA_PIPELINE_SKIPPED').slice(0, 160)
                    });
                }
                if (roadmapClaim && roadmapService) {
                    if (!pipeline.blocked) {
                        await roadmapService.invalidateClaim({
                            context: roadmapClaim,
                            reasonCode: String(pipeline.reason || 'roadmap_topic_no_longer_safe').slice(0, 160)
                        });
                    } else {
                        await roadmapService.failClaim({
                            context: roadmapClaim,
                            error: Object.assign(new Error(String(pipeline.reason || 'roadmap_topic_blocked')), {
                                code: String(pipeline.reason || 'ROADMAP_TOPIC_BLOCKED').slice(0, 160)
                            })
                        });
                    }
                }
                await completeSchedule({
                    runCountDelta: 1,
                    lastRunStatus: terminalStatus,
                    lastError: pipeline.blocked ? decisionCode : '',
                    nextRunAt
                });
                return {
                    skipped: !pipeline.blocked,
                    blocked: pipeline.blocked === true,
                    reason: decisionCode || pipeline.reason,
                    executionId: String(execution._id)
                };
            }
            if (pipeline.maintenance) {
                if (roadmapClaim && roadmapService) {
                    await roadmapService.invalidateClaim({
                        context: roadmapClaim,
                        reasonCode: 'roadmap_selected_non_new_action'
                    });
                }
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
                        retryAt: null,
                        currentStage: 'completed',
                        failureClass: '',
                        error: '',
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
            if (roadmapClaim && roadmapService) {
                await roadmapService.completeClaim({
                    context: roadmapClaim,
                    blogId: result.blogId,
                    workOrderId: payload.contentWorkOrderId,
                    briefId: payload.unifiedContentBriefId
                });
            }

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
                    retryAt: null,
                    currentStage: 'completed',
                    failureClass: '',
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
            const latestForCommitRecovery = await BlogAutomationExecution.findById(execution._id)
                .lean()
                .catch(() => null);
            const commitRecovered = latestForCommitRecovery
                ? await recoverStaleExecution({
                    execution: latestForCommitRecovery,
                    errorCode: message,
                    recoveryReason: 'persisted_blog_reconciled_after_pipeline_error',
                    reconcileOnly: true
                }).catch(() => false)
                : false;
            if (commitRecovered) {
                const recoveredExecution = await BlogAutomationExecution.findById(execution._id)
                    .lean();
                const recoveredStatus = recoveredExecution?.status || 'draft_created';
                const completedAt = recoveredExecution?.completedAt || new Date();
                const nextRunAt = calculateNextRun({
                    schedule: {
                        ...schedule,
                        runCount: Number(schedule.runCount || 0) + 1,
                        lastRunAt: completedAt
                    },
                    from: completedAt
                });
                if (schedule.isQaTest === true) {
                    await AgenticBlogQaCase.updateOne(
                        {
                            _id: schedule.qaCaseId,
                            qaBatchId: schedule.qaBatchId,
                            isQaTest: true
                        },
                        {
                            $set: {
                                executionId: execution._id,
                                blogId: recoveredExecution?.blogId || null,
                                actualRunAt: completedAt,
                                status: recoveredStatus
                            }
                        }
                    ).catch(() => null);
                    await updateQaAttempt(recoveredStatus, {
                        'runAttempts.$[attempt].completedAt': completedAt,
                        'runAttempts.$[attempt].errorCode': ''
                    }).catch(() => null);
                }
                await completeSchedule({
                    runCountDelta: 1,
                    lastRunStatus: recoveredStatus,
                    lastError: '',
                    nextRunAt
                });
                return {
                    recovered: true,
                    execution: mapExecution(recoveredExecution),
                    result: {
                        mode: recoveredExecution?.mode || (recoveredStatus === 'published' ? 'publish' : 'draft'),
                        blogId: recoveredExecution?.blogId || null,
                        slug: recoveredExecution?.blogSlug || '',
                        published: recoveredStatus === 'published',
                        reasons: ['persisted_blog_commit_reconciled']
                    },
                    telegram: null
                };
            }
            if (
                schedule.isQaTest !== true
                && !roadmapClaim
                && SAFE_ROADMAP_SKIP_CODES.has(message)
            ) {
                const completedAt = new Date();
                const skippedByOwner = await ContentWorkOrderService.transitionExecutionUnclaimed({
                    executionId: execution._id,
                    expectedLeaseOwner: resolvedLockOwner,
                    status: 'skipped',
                    completedAt,
                    fromStatuses: ['queued', 'running', 'committing'],
                    updates: {
                        error: '',
                        retryAt: null,
                        currentStage: 'completed',
                        failureClass: '',
                        contentAction: 'skip',
                        'metadata.decision': 'skip',
                        'metadata.outcomeCode': message,
                        'metadata.decisionReason': message
                    }
                });
                if (!skippedByOwner) throw scheduleFenceError();
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
                    lastRunStatus: 'skipped',
                    lastError: '',
                    lastOutcomeCode: message,
                    nextRunAt
                });
                return {
                    skipped: true,
                    blocked: false,
                    outcomeCode: message,
                    reason: message,
                    executionId: String(execution._id)
                };
            }
            const failureClass = classifyExecutionFailure(error);
            const failureAt = new Date();
            let latestExecutionForFailure = await BlogAutomationExecution.findById(execution._id)
                .lean()
                .catch(() => null);
            if (
                latestExecutionForFailure
                && String(latestExecutionForFailure.metadata?.leaseOwner || '') !== resolvedLockOwner
            ) {
                throw scheduleFenceError();
            }
            latestExecutionForFailure ||= execution;
            if (roadmapClaim && roadmapService) {
                await roadmapService.failClaim({ context: roadmapClaim, error }).catch(() => null);
            }
            if (failureClass === 'transient' && latestExecutionForFailure) {
                const retryTransition = await transitionExecutionToRetryWait({
                    execution: latestExecutionForFailure,
                    errorCode: message,
                    currentStage,
                    expectedLeaseOwner: resolvedLockOwner,
                    now: failureAt,
                    policy: retryPolicy
                }).catch(() => ({ scheduled: false, reason: 'retry_transition_failed' }));
                if (retryTransition.scheduled) {
                    if (schedule.isQaTest === true) {
                        await AgenticBlogQaCase.updateOne(
                            { _id: schedule.qaCaseId, qaBatchId: schedule.qaBatchId, isQaTest: true },
                            {
                                $set: {
                                    executionId: execution._id,
                                    status: 'running',
                                    lastErrorCode: message
                                }
                            }
                        ).catch(() => {});
                        await updateQaAttempt('running', {
                            'runAttempts.$[attempt].dispatchState': 'pending',
                            'runAttempts.$[attempt].errorCode': message
                        }).catch(() => {});
                    }
                    await deferScheduleForRetry({
                        retryAt: retryTransition.retryAt,
                        errorCode: message
                    });
                    return {
                        retryScheduled: true,
                        execution: mapExecution({
                            ...latestExecutionForFailure,
                            status: 'retry_wait',
                            retryAt: retryTransition.retryAt,
                            attemptCount: retryTransition.attemptCount,
                            maxAttempts: retryTransition.maxAttempts,
                            currentStage: retryTransition.currentStage,
                            failureClass: 'transient',
                            error: message
                        }),
                        retryAt: retryTransition.retryAt,
                        attemptCount: retryTransition.attemptCount,
                        maxAttempts: retryTransition.maxAttempts,
                        failureClass: 'transient',
                        errorCode: message
                    };
                }
                if (retryTransition.reason === 'execution_ownership_lost') {
                    throw scheduleFenceError();
                }
            }
            const latestExecution = latestExecutionForFailure;
            const workOrderId = latestExecution?.contentWorkOrderId || null;
            const claimToken = getExecutionClaimToken(latestExecution);
            const terminalUpdates = {
                error: message,
                retryAt: null,
                currentStage,
                failureClass: 'terminal',
                maxAttempts: boundedInteger(
                    latestExecution?.maxAttempts,
                    retryPolicy.maxAttempts,
                    { min: MIN_RETRY_MAX_ATTEMPTS, max: MAX_RETRY_MAX_ATTEMPTS }
                )
            };
            let terminalized = false;
            try {
                if (workOrderId && claimToken) {
                    terminalized = await ContentWorkOrderService.transitionExecutionClaimed({
                        executionId: execution._id,
                        workOrderId,
                        claimToken,
                        expectedLeaseOwner: resolvedLockOwner,
                        status: 'failed',
                        fromStatuses: ['running', 'committing'],
                        updates: terminalUpdates
                    });
                } else {
                    terminalized = await ContentWorkOrderService.transitionExecutionUnclaimed({
                        executionId: execution._id,
                        expectedLeaseOwner: resolvedLockOwner,
                        status: 'failed',
                        fromStatuses: ['running', 'committing'],
                        updates: terminalUpdates
                    });
                }
            } catch {
                terminalized = false;
            }
            if (!terminalized) throw scheduleFenceError();
            if (workOrderId && claimToken) {
                await ContentWorkOrderService.transitionClaimed({
                    workOrderId,
                    claimToken,
                    status: 'blocked',
                    updates: { 'metadata.lastFailureCode': message }
                }).catch(() => null);
            }
            if (schedule.isQaTest === true) {
                await AgenticBlogQaCase.updateOne(
                    { _id: schedule.qaCaseId, qaBatchId: schedule.qaBatchId, isQaTest: true },
                    { $set: { executionId: execution?._id || null, status: 'failed', completedAt: failureAt, lastErrorCode: message } }
                ).catch(() => {});
                await updateQaAttempt('failed', {
                    'runAttempts.$[attempt].completedAt': failureAt,
                    'runAttempts.$[attempt].errorCode': message
                }).catch(() => {});
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
    getExecutionRetryPolicy,
    calculateExecutionRetryAt,
    classifyExecutionFailure,
    isCronEnabled,
    isEmbeddedBlogWorkerEnabled,
    isSeoAgentEnabled,
    mapExecution,
    mapExecutionSummary,
    mapSchedule,
    SAFE_ROADMAP_SKIP_CODES,
    safeStoredError,
    activeScheduleLease,
    assertScheduleMutable,
    isPersistedBlogCommitForExecution,
    recoverStaleExecution,
    transitionExecutionToRetryWait,
    assertActiveExecutionOwnership,
    claimPublishFence,
    scheduleFenceError,
    trustedQaFields,
    updateQaRunAttempt,
    validateManualIdempotencyKey
};
