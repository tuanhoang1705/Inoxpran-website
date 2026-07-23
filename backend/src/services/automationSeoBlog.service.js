'use strict';

const crypto = require('node:crypto');
const { blog } = require('../models/blog.model');
const { BlogAutomationExecution } = require('../models/blogAutomationExecution.model');
const { BlogAutomationSchedule } = require('../models/blogAutomationSchedule.model');
const { AgenticBlogQaBatch } = require('../models/agenticBlogQaBatch.model');
const { ResearchBundle } = require('../models/researchBundle.model');
const { BlogStrategyPlan } = require('../models/blogStrategyPlan.model');
const { ProductSeedPlan } = require('../models/productSeedPlan.model');
const { ProductSeedExposure } = require('../models/productSeedExposure.model');
const { EditorialProductPlacementPlan } = require('../models/editorialProductPlacementPlan.model');
const { ContentWorkOrder } = require('../models/contentWorkOrder.model');
const {
  ContentMaintenanceAlert
} = require('../models/contentMaintenanceAlert.model');
const { UnifiedContentBrief } = require('../models/unifiedContentBrief.model');
const { EvidenceMap } = require('../models/evidenceMap.model');
const {
  ContentOpportunityDecision
} = require('../models/contentOpportunityDecision.model');
const { BadRequestError } = require('../core/error.response');
const { normalizeString } = require('../utils/seoBlogSanitizer');
const { normalizeForSimilarity } = require('../utils/agenticBlogCore.util');
const { validateAutomationPayload } = require('../utils/seoBlogValidation');
const {
  hasQaProvenanceMarkers,
  normalizeTrustedQaProvenance,
  qaProvenanceMatches
} = require('../utils/qaProvenance.util');
const { runImagePipeline } = require('./openclaw/imagePipeline.service');
const { GoogleIntelligenceService } = require('./googleIntelligence.service');
const { AgenticBlogCoreService } = require('./agenticBlogCore.service');
const { ProductSeedPlanningService } = require('./productSeedPlanning.service');
const { EditorialProductPlacementPlanningService } = require('./editorialProductPlacementPlanning.service');
const { extractProductBlocks, reviewProductLayer } = require('./productSeedingReview.service');
const { extractPlacementBlocks, reviewEditorialProductPlacement } = require('./editorialProductPlacementReview.service');

const {
  BlogRevisionService
} = require('./contentOperations/blogRevision.service');
const {
  ContentPublishReadinessService
} = require('./contentOperations/publishReadiness.service');
const {
  ContentWorkOrderService,
  getActiveClaimToken
} = require('./contentOperations/workOrder.service');
const {
  PerformanceLearningService
} = require('./contentOperations/performanceLearning.service');
const {
  PostPublishVerificationService
} = require('./contentOperations/postPublishVerification.service');
const {
  writeContentOperationsAudit
} = require('./contentOperations/contentOperationsAudit.service');

const WORDS_PER_MINUTE = 220;
const DEFAULT_SITE_URL = 'https://inoxpran.com';

const REVISION_ACTIONS = new Set([
  'update',
  'expand',
  'merge',
  'metadata_refresh',
  'internal_link_maintenance',
  'content_maintenance'
]);
const SCOPED_MAINTENANCE_ACTIONS = new Set([
  'metadata_refresh',
  'internal_link_maintenance',
  'content_maintenance'
]);

const publisherProvenanceError = label =>
  new BadRequestError(
    `${String(label || 'artifact')} does not match the trusted publisher provenance scope`
  );

/**
 * The publisher is the final shared persistence boundary. Persisted artifacts
 * must therefore prove their scope independently of payload IDs before either
 * a readiness report or a Blog document can be created.
 *
 * A clean production snapshot may be reused as immutable source intelligence
 * by a QA run. Derived case artifacts never receive that exception.
 */
const assertPublisherArtifactProvenance = ({
  label,
  artifact,
  qaContext = null,
  allowCleanProductionReuse = false
} = {}) => {
  if (!artifact || typeof artifact !== 'object') {
    throw publisherProvenanceError(label);
  }

  if (!qaContext) {
    if (hasQaProvenanceMarkers(artifact)) {
      throw publisherProvenanceError(label);
    }
    return 'production_clean';
  }

  const expected = normalizeTrustedQaProvenance(qaContext);
  if (artifact.isQaTest !== true) {
    if (allowCleanProductionReuse && !hasQaProvenanceMarkers(artifact)) {
      return 'production_reused';
    }
    throw publisherProvenanceError(label);
  }

  let actual;
  try {
    actual = normalizeTrustedQaProvenance(artifact);
  } catch {
    throw publisherProvenanceError(label);
  }
  if (!qaProvenanceMatches(expected, actual)) {
    throw publisherProvenanceError(label);
  }
  return 'qa_exact';
};

const assertPublisherArtifactChainProvenance = ({
  artifacts = {},
  qaContext = null
} = {}) => {
  for (const [label, artifact] of Object.entries(artifacts)) {
    assertPublisherArtifactProvenance({ label, artifact, qaContext });
  }
  return true;
};

const assertTrustedQaExecutionFence = async ({ executionId, qaContext, now = new Date() }) => {
  if (!qaContext) return true;
  const execution = await BlogAutomationExecution.findOne({
    _id: executionId,
    status: 'committing',
    isQaTest: true,
    qaBatchId: qaContext.qaBatchId,
    qaCaseId: qaContext.qaCaseId,
    qaIteration: qaContext.qaIteration,
    environment: qaContext.environment,
    executionMode: qaContext.executionMode
  }).select('_id scheduleId metadata.leaseOwner').lean();
  const lockOwner = String(execution?.metadata?.leaseOwner || '');
  if (!execution || !lockOwner) throw createWorkOrderLeaseLostError();
  const [schedule, batch] = await Promise.all([
    BlogAutomationSchedule.findOne({
      _id: execution.scheduleId,
      isQaTest: true,
      qaBatchId: qaContext.qaBatchId,
      qaCaseId: qaContext.qaCaseId,
      lockedBy: lockOwner,
      leaseUntil: { $gt: now }
    }).select('_id').lean(),
    AgenticBlogQaBatch.findOne({
      _id: qaContext.qaBatchId,
      isQaTest: true,
      environment: qaContext.environment,
      iteration: qaContext.qaIteration,
      status: { $in: ['planned', 'running'] },
      stopNewDrafts: { $ne: true }
    }).select('_id').lean()
  ]);
  if (!schedule || !batch) throw createWorkOrderLeaseLostError();
  return true;
};

const parseBoolean = (value, fallback = false) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    if (typeof value !== 'string') return fallback;
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const estimateReadTimeMinutes = wordCount => Math.max(1, Math.ceil(wordCount / WORDS_PER_MINUTE));

const buildPublicUrl = slug => {
    const baseUrl = normalizeString(process.env.PUBLIC_SITE_URL || process.env.APP_BASE_URL || DEFAULT_SITE_URL)
        .replace(/\/+$/g, '');
    return `${baseUrl}/blog/${slug}`;
};

const appendDraftReason = (reasons, reason) => {
    if (!reasons.includes(reason)) reasons.push(reason);
};

const buildBlogLifecycleMetadata = ({
  brief,
  slug, shouldPublish = false,
  readinessReviewed = false,
  readinessPassed = false,
  now = new Date(),
  reviewDays = Number(process.env.CONTENT_INVENTORY_REVIEW_DAYS || 90)
} = {}) => {
  if (!brief || typeof brief !== 'object') return {};
  const reviewedAt = readinessReviewed ? new Date(now) : null;
  const boundedReviewDays = Math.min(
    3650,
    Math.max(7, Number(reviewDays) || 90)
  );
  const nextReviewAt = reviewedAt
    ? new Date(reviewedAt.getTime() + boundedReviewDays * 24 * 60 * 60 * 1000)
    : null;
  return {
    contentRole: normalizeString(
      brief.contentRole || brief.articleType || ''
    ).slice(0, 120),
    primaryIntent: normalizeString(brief.primarySearchIntent || '').slice(
      0,
      120
    ),
    topicSummary: normalizeString(
      brief.topic || brief.workingTitle || ''
    ).slice(0, 1000),
    entitySummary: Array.isArray(brief.requiredEntities)
      ? [
          ...new Set(
            brief.requiredEntities
              .map(item => normalizeString(item))
              .filter(Boolean)
          )
        ].slice(0, 50)
      : [],
    canonicalUrl: buildPublicUrl(slug),
    indexability: {
      index: shouldPublish,
      follow: shouldPublish,
      determinable: true
    },
    lastReviewedAt: reviewedAt,
    nextReviewAt,
    lifecycleStatus: shouldPublish
      ? 'published'
      : readinessPassed
        ? 'ready'
        : 'planned'
  };
};

const POST_COMMIT_WARNING_CODES = Object.freeze({
  monitoring: 'performance_monitoring_schedule_failed',
  verification: 'post_publish_verification_failed'
});

const sanitizeErrorCode = error =>
  String(error?.code || error?.name || 'auxiliary_error')
    .replace(/[^a-zA-Z0-9_.:-]/g, '_')
    .slice(0, 120) || 'auxiliary_error';

const createWorkOrderLeaseLostError = () => {
  const error = new BadRequestError(
    'Content Work Order execution claim is no longer current'
  );
  error.code = 'CONTENT_WORK_ORDER_LEASE_LOST';
  error.status = 409;
  return error;
};

const renewOwnedWorkOrderOrThrow = async ({ workOrderId, claimToken }) => {
  if (
    !workOrderId ||
    !claimToken ||
    !(await ContentWorkOrderService.renewProductionClaim({
      workOrderId,
      claimToken
    }))
  ) {
    throw createWorkOrderLeaseLostError();
    }
};

const persistPostCommitWarning = async ({
    phase,
    error,
    blogId,
    workOrderId,
    executionId,
    correlationId,
    revisionHash
  },
  dependencies = {}
) => {
        const {
    ExecutionModel = BlogAutomationExecution,
    WorkOrderModel = ContentWorkOrder,
    AlertModel = ContentMaintenanceAlert,
    auditWriter = writeContentOperationsAudit
  } = dependencies;
  const code =
    POST_COMMIT_WARNING_CODES[phase] || 'post_publish_auxiliary_failed';
  const errorCode = sanitizeErrorCode(error);
        const warning = { code, phase, errorCode, publicationPreserved: true };
  const idempotencyKey = `post-commit:${phase}:${blogId}:${revisionHash}`.slice(
    0,
    256
  );
  const type = phase === 'verification' ? 'technical_verification' : 'other';
  const severity = phase === 'verification' ? 'high' : 'medium';
  const safely = operation => Promise.resolve().then(operation);

  await Promise.allSettled([
    safely(() =>
      ExecutionModel.updateOne(
        { _id: executionId },
        { $addToSet: { 'metadata.postCommitWarnings': warning } })
    ),
    safely(() =>
      WorkOrderModel.updateOne({ _id: workOrderId },
        { $addToSet: { warnings: code } }
      )
    ),
    safely(() =>
      AlertModel.findOneAndUpdate(
        { idempotencyKey },
        {
          $setOnInsert: {
            blogId,
            contentWorkOrderId: workOrderId,
            type,
            severity,
            status: 'open',
            summary:
              phase === 'verification'
                ? 'Post-publish technical verification could not complete; the publication was preserved for maintenance review.'
                : 'Post-publish performance monitoring could not be scheduled; the publication was preserved for maintenance review.',
            issues: [warning],
            detectedAt: new Date(),
            idempotencyKey
          }
        },
        { upsert: true, new: true, runValidators: true }
      )
    ),
    safely(() =>
      auditWriter({
        action: 'post_publish_auxiliary_failed',
        entityType: 'blog',
        entityId: blogId,
        contentWorkOrderId: workOrderId,
        reason: code,
        changes: [
          { field: 'postCommitWarnings', operation: 'add', value: code }
        ],
        metadata: warning,
        correlationId
      })
    )]);

  return warning;
};

const runPostCommitSafeguards = async (
  {
    shouldPublish,
    workOrder,
    blogId,
    executionId,
    correlationId = '',
    publishedAt,
    monitoringWindows = [],
    postPublishVerificationEnabled,
    publishReadinessReportId = null,
    slug,
    contentHtml,
    requireCover = false
  },
  dependencies = {}
) => {
  const {
    PerformanceService = PerformanceLearningService,
    VerificationService = PostPublishVerificationService,
    ExecutionModel = BlogAutomationExecution,
    WorkOrderService = ContentWorkOrderService,
    environment = process.env,
    fetchImpl = global.fetch
  } = dependencies;
  const monitoringTasks = [];
  const postCommitWarnings = [];
  let postPublishVerification = null;

  if (!shouldPublish || !workOrder || !blogId) {
    return { monitoringTasks, postPublishVerification, postCommitWarnings };
  }

  const operationsEnabled = parseBoolean(
    environment.CONTENT_OPERATIONS_ENABLED,
    false
  );
  const revisionHash = contentHash(contentHtml);
  const warningContext = {
    blogId,
    workOrderId: workOrder._id,
    executionId,
    correlationId,
    revisionHash
  };

  if (
    operationsEnabled &&
    parseBoolean(environment.CONTENT_PERFORMANCE_MONITORING_ENABLED, false)
  ) {
    try {
      const scheduledTasks = await PerformanceService.scheduleMonitoring({
        blogId,
        contentWorkOrderId: workOrder._id,
        publishedAt: publishedAt || new Date(),
        windows: monitoringWindows
      });
      monitoringTasks.push(
        ...(Array.isArray(scheduledTasks) ? scheduledTasks : [])
      );
        await ExecutionModel.updateOne({ _id: executionId },
        {
          $set: {
            monitoringTasks: monitoringTasks.map(task => ({
              id: String(task._id),
              window: task.window,
              dueAt: task.dueAt
            }))
          }
        }
      );
    } catch (error) {
      postCommitWarnings.push(
        await persistPostCommitWarning(
          {
            phase: 'monitoring',
            error, ...warningContext
          },
          dependencies
        )
      );
    }
  }

  if (operationsEnabled && postPublishVerificationEnabled) {
    try {
      const verificationResult = await VerificationService.run({
        blogId,
        contentWorkOrderId: workOrder._id,
        publishReadinessReportId,
        expectedUrl: buildPublicUrl(slug),
        expectedRevisionHash: revisionHash,
        expected: {
          revisionMarkerRequired: true,
          structuredDataRequired: true,
          coverRequired: requireCover,
          mobileSafeRequired: true
        },
        fetchImpl: async (url, options) => {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 15_000);
          try {
            return await fetchImpl(url, {
              ...options,
              signal: controller.signal,
              headers: { Accept: 'text/html' }
            });
          } finally {
            clearTimeout(timeout);
          }
        }
      });
      postPublishVerification = verificationResult?.verification || null;
      if (!postPublishVerification?._id) {
        const missingArtifactError = new Error(
          'Post-publish verification did not return a persisted artifact'
        );
        missingArtifactError.code =
          'POST_PUBLISH_VERIFICATION_ARTIFACT_MISSING';
        throw missingArtifactError;
      }
      await Promise.all([
        WorkOrderService.attachArtifact({
          workOrderId: workOrder._id,
          artifactType: 'postPublishVerificationId',
          artifactId: postPublishVerification._id
        }),
        ExecutionModel.updateOne(
          { _id: executionId },
          {
            $set: {
              postPublishVerificationId: postPublishVerification._id,
              postPublishVerification
            }
          }
        )
      ]);
    } catch (error) {
      postCommitWarnings.push(
        await persistPostCommitWarning({
            phase: 'verification',
            error,
            ...warningContext
          },
          dependencies
        )
      );
    }
  }

  return { monitoringTasks, postPublishVerification, postCommitWarnings };
};

const contentHash = value =>
  crypto
    .createHash('sha256')
    .update(String(value || ''))
    .digest('hex');

const extractArticleSections = html => {
  const source = String(html || '');
  const headings = Array.from(source.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi));
  const occurrences = new Map();
  const sections = headings.map((match, index) => {
    const heading = normalizeString(
      String(match[1] || '').replace(/<[^>]+>/g, ' '));
    const baseKey =
      normalizeForSimilarity(heading).replace(/\s+/g, '-').slice(0, 120) ||
      `section-${index + 1}`;
    const occurrence = (occurrences.get(baseKey) || 0) + 1;
    occurrences.set(baseKey, occurrence);
    const sectionKey = occurrence === 1 ? baseKey : `${baseKey}--${occurrence}`;
    const start = match.index;
    const end = headings[index + 1]?.index ?? source.search(/<\/article>\s*$/i);
    const contentHtml = source
      .slice(start, end >= start ? end : source.length)
      .replace(/<\/article>\s*$/i, '')
      .trim();
    return {
      sectionKey,
      heading,
      contentHtml,
      contentHash: contentHash(contentHtml)
    };
  });
  const firstHeadingIndex =
    headings[0]?.index ?? source.search(/<\/article>\s*$/i);
  const introductionHtml = source
    .slice(0, firstHeadingIndex >= 0 ? firstHeadingIndex : source.length)
    .replace(/^\s*<article\b[^>]*>/i, '')
    .replace(/<\/article>\s*$/i, '')
    .trim();
  return { introductionHtml, sections };
};

const buildRevisionSectionChanges = ({
  action,
  currentHtml,
  proposedHtml,
  primaryBlogId,
  sourceBlogIds = []
}) => {
  const current = extractArticleSections(currentHtml);
  const proposed = extractArticleSections(proposedHtml);
  const currentByKey = new Map(
    current.sections.map(section => [section.sectionKey, section])
  );
  const warnings = [];

  if (action === 'expand') {
    const sectionChanges = proposed.sections
      .filter(section => !currentByKey.has(section.sectionKey))
      .map(section => ({
        operation: 'add_missing_section',
        sectionKey: section.sectionKey,
        heading: section.heading,
        proposedContentHtml: section.contentHtml,
        reason:
          'This heading is absent from the primary article and is staged as an additive expansion.'
      }));
    const changedExisting = proposed.sections.some(section => {
      const existing = currentByKey.get(section.sectionKey);
      return existing && existing.contentHash !== section.contentHash;
    });
    if (
      changedExisting ||
      (current.introductionHtml &&
        contentHash(current.introductionHtml) !==
          contentHash(proposed.introductionHtml))
    ) {
      warnings.push('writer_changes_to_existing_sections_ignored_for_expand');
    }
    if (!sectionChanges.length)
      throw new BadRequestError(
        'Expand revision must add at least one missing section'
      );
    return {
      sectionChanges,
      preservedSectionKeys: [
        'article-introduction',
        ...current.sections.map(section => section.sectionKey)
      ],
      warnings
    };
  }

  if (action === 'merge') {
    const proposedParts = [
      ...(proposed.introductionHtml
        ? [
            {
              sectionKey: 'article-introduction',
              heading: '',
              contentHtml: proposed.introductionHtml
            }
          ]
        : []),
      ...proposed.sections
    ];
    if (!proposedParts.length)
      throw new BadRequestError(
        'Merge revision requires consolidated proposed sections'
      );
    return {
      sectionChanges: proposedParts.map(section => ({
        operation: 'consolidate_into_primary_section',
        sectionKey: section.sectionKey,
        heading: section.heading,
        proposedContentHtml: section.contentHtml,
        primaryBlogId: String(primaryBlogId),
        sourceBlogIds: sourceBlogIds.map(String),
        reason:
          'Non-duplicate material is staged for consolidation into the canonical primary article.'
      })),
      preservedSectionKeys: ['canonical_identity'],
      warnings
    };
  }

  const sectionChanges = [];
  if (
    proposed.introductionHtml &&
    contentHash(current.introductionHtml) !==
      contentHash(proposed.introductionHtml)
  ) {
    sectionChanges.push({
      operation: 'update_existing_section',
      sectionKey: 'article-introduction',
      previousContentHash: contentHash(current.introductionHtml),
      proposedContentHtml: proposed.introductionHtml,
      reason:
        'The proposed introduction differs from the current introduction and is staged for review.'
    });
  } else if (current.introductionHtml && !proposed.introductionHtml) {
    warnings.push('proposed_draft_omitted_existing_introduction_preserved');
  }
  for (const section of proposed.sections) {
    const existing = currentByKey.get(section.sectionKey);
    if (!existing) {
      sectionChanges.push({
        operation: 'add_reviewed_section',
        sectionKey: section.sectionKey,
        heading: section.heading,
        proposedContentHtml: section.contentHtml,
        reason: 'A new section is staged as part of the scoped update.'
      });
    } else if (existing.contentHash !== section.contentHash) {
      sectionChanges.push({
        operation: 'update_existing_section',
        sectionKey: section.sectionKey,
        heading: section.heading,
        previousContentHash: existing.contentHash,
        proposedContentHtml: section.contentHtml,
        reason: 'Only this changed section is staged for review.'
      });
    }
  }
  const proposedKeys = new Set(
    proposed.sections.map(section => section.sectionKey)
  );
  const omittedKeys = current.sections
    .filter(section => !proposedKeys.has(section.sectionKey))
    .map(section => section.sectionKey);
  if (omittedKeys.length)
    warnings.push('proposed_draft_omitted_existing_sections_preserved');
  const changedKeys = new Set(
    sectionChanges
      .filter(change => change.operation === 'update_existing_section')
      .map(change => change.sectionKey)
  );
  return {
    sectionChanges,
    preservedSectionKeys: current.sections
      .map(section => section.sectionKey)
      .filter(key => !changedKeys.has(key)),
    warnings
  };
};

const normalizeTrustedQaContext = value => {
  if (!value) return null;
  if (
    value.isQaTest !== true ||
    !value.qaBatchId ||
    !value.qaCaseId ||
    !['local', 'staging'].includes(value.environment) ||
    !['run_now', 'schedule_run_now', 'actual_schedule'].includes(value.executionMode) ||
    !Number.isInteger(Number(value.qaIteration)) ||
    Number(value.qaIteration) < 0 ||
    Number(value.qaIteration) > 3 ||
    !value.originalTopicSeed ||
    !value.normalizedTopicKey ||
    !value.qaTopicReservationId
  ) {
    throw new BadRequestError('Trusted QA context is incomplete or unsafe');
  }
  return {
    isQaTest: true,
    qaBatchId: value.qaBatchId,
    qaCaseId: value.qaCaseId,
    qaIteration: Number(value.qaIteration),
    environment: value.environment,
    executionMode: value.executionMode,
    originalTopicSeed: String(value.originalTopicSeed),
    normalizedTopicKey: String(value.normalizedTopicKey),
    qaTopicReservationId: String(value.qaTopicReservationId)
  };
};

const createBlogDocument = ({
  normalized,
  shouldPublish,
  imagePipeline,
  lifecycle = {},
  qaContext = null
}) => ({
  sourceType: 'agentic',
  generationMetadata: {
    provider: 'openclaw',
    generatedAt: new Date().toISOString(),
    pipelineVersion: 'agentic-blog-core-v2',
    ...(qaContext || {}),
    ...normalized.metadata
  },
  googleIntelSnapshotId: normalized.googleIntelSnapshotId,
  googleIntelSnapshotDate: normalized.googleIntelSnapshotDate,
  googleIntelStatus: normalized.googleIntelStatus,
  contentOperationsSnapshotId: normalized.contentOperationsSnapshotId || null,
  contentInventorySnapshotId: normalized.contentInventorySnapshotId || null,
  contentOpportunityDecisionId: normalized.contentOpportunityDecisionId || null,
  contentWorkOrderId: normalized.contentWorkOrderId || null,
  unifiedContentBriefId: normalized.unifiedContentBriefId || null,
  evidenceMapId: normalized.evidenceMapId || null,
  publishReadinessReportId: normalized.publishReadinessReportId || null,
  researchBundleId: normalized.researchBundleId,
  editorialStyleProfileId: normalized.editorialStyleProfileId,
  strategyPlanId: normalized.strategyPlanId,
  agenticExecutionId: normalized.agenticExecutionId,
  productSeedingEnabled: normalized.productSeedingMode !== 'off',
  productSeedingMode: normalized.productSeedingMode,
  productSeedingDecision: normalized.productSeedingDecision,
  productCatalogSnapshotId: normalized.productCatalogSnapshotId || null,
  productSeedPlanId: normalized.productSeedPlanId || null,
  editorialProductPlacementPlanId:
    normalized.editorialProductPlacementPlanId || null,
  seededProductIds: normalized.seededProductIds || [],
  productSeedingReview: normalized.productSeedingReview,
  productClaimReview: normalized.productClaimReview,
  editorialProductPlacementReview: normalized.editorialProductPlacementReview,
  contentDecision: normalized.contentDecision,
  ...lifecycle,
  ...(qaContext || {}),
  ...(qaContext ? {
    canonicalUrl: '',
    indexability: { index: false, follow: false, determinable: true, reason: 'qa_draft_only' }
  } : {}),
  structuralFingerprint: normalized.structuralFingerprint,
  agenticReviews: normalized.agenticReviews,
  blog_title: normalized.title,
  blog_slug: normalized.slug,
  blog_excerpt: normalized.excerpt,
  blog_content: imagePipeline.contentHtml || normalized.contentHtml,
  contentRevisionHash: crypto
    .createHash('sha256')
    .update(imagePipeline.contentHtml || normalized.contentHtml)
    .digest('hex'),
  blog_image: imagePipeline.coverImage?.url || normalized.imageUrl,
  blog_image_path: imagePipeline.coverImage?.path || '',
  coverImage: imagePipeline.coverImage,
  contentImages: imagePipeline.contentImages,
  visualPlan: imagePipeline.visualPlan,
  imagePipelineStatus: imagePipeline.status,
  blog_category_key: normalized.categoryKey,
  blog_tags: normalized.tags,
  blog_author_name: normalized.authorName,
  blog_author_avatar: 'IP',
  blog_read_time_minutes: estimateReadTimeMinutes(normalized.wordCount),
  blog_views: 0,
  blog_comments_count: 0,
  blog_seo_title: normalized.seoTitle,
  blog_seo_description: normalized.seoDescription,
  blog_shop: 'Inoxpran',
  publishedAt: qaContext ? null : (shouldPublish ? new Date() : null),
  isDraft: qaContext ? true : !shouldPublish,
  isPublished: qaContext ? false : shouldPublish
});

const buildContentActionContract = (context = {}) => {
  const selected = context.contentPlanning?.selectedOpportunity || {};
  const workOrder = context.contentWorkOrder || {};
  const decision =
    context.opportunity?.decision ||
    selected.recommendedAction ||
    selected.decisionType ||
    workOrder.decision ||
    '';
  const targetBlogId =
    selected.primaryTargetBlogId ||
    selected.targetBlogIds?.[0] ||
    workOrder.targetBlogId ||
    null;
  const score =
    selected.totalScore ??
    context.contentPlanning?.opportunityScore ??
    workOrder.opportunityScore;
  return {
    decision,
    reason:
      context.opportunity?.reason ||
      selected.decisionReason ||
      workOrder.decisionReason ||
      '',
    targetBlogId: targetBlogId ? String(targetBlogId) : null,
    mergeSourceBlogIds: (
      workOrder.mergeSourceBlogIds ||
      selected.mergeSourceBlogIds ||
      []
    ).map(String),
    businessGoal: workOrder.primaryBusinessGoal || '',
    opportunityScore: Number.isFinite(Number(score)) ? Number(score) : null
  };
};

class AutomationSeoBlogService {
  static buildRevisionSectionChanges(input) {
    return buildRevisionSectionChanges(input);
  }

  static async runPostCommitSafeguards(input, dependencies = {}) {
    return runPostCommitSafeguards(input, dependencies);
  }

  static async health() {
    return {
      status: 'ok',
      automation: process.env.SEO_AGENT_ENABLED === 'true',
      autoPublish: parseBoolean(process.env.SEO_AGENT_AUTO_PUBLISH, false),
      time: new Date().toISOString()
    };
  }

  static async prepareAgenticContext({ payload = {} }) {
    const topic = normalizeString(payload.topic || payload.primaryKeyword);
    if (!topic) throw new BadRequestError('topic is required');
    const context = await AgenticBlogCoreService.prepareContext({
      topic,
      primaryKeyword: normalizeString(payload.primaryKeyword || topic),
      articleType: normalizeString(payload.articleType),
      sourceUrls: Array.isArray(payload.researchSources)
        ? payload.researchSources
        : [],
      productSeeding: payload.productSeeding || {},
      productPlacement: payload.productPlacement || {},
      rankingEvidence: payload.rankingEvidence || null,
      language: normalizeString(payload.language || 'vi'),
      categoryKey: normalizeString(payload.categoryKey || 'guide'),
      secondaryKeywords: Array.isArray(payload.secondaryKeywords)
        ? payload.secondaryKeywords
        : [],
      contentOperations: {
        mode: payload.mode || 'fixed_brief',
        action:
          payload.action ||
          payload.contentAction?.decision ||
          payload.contentAction,
        workOrderId: payload.workOrderId,
        targetBlogId: payload.targetBlogId,
        mergeSourceBlogIds: payload.mergeSourceBlogIds,
        primaryBusinessGoal: payload.primaryBusinessGoal,
        successMetrics: payload.successMetrics,
        draftOnly: true,
        claimWorkOrder: true,
        claimMaintenanceWorkOrder: false
      }
    });
    const skipped = context.skipped || context.opportunity?.decision === 'skip';
    const workOrderClaimToken = getActiveClaimToken(context.contentWorkOrder);
    const productSeedPlan = context.productSeedPlan || null;
    const contentAction = buildContentActionContract(context);
    const execution = await BlogAutomationExecution.create({
      scheduleId: null,
      executionKey: `external:${context.snapshot.snapshotDate}:${crypto.randomUUID()}`,
      status:
        context.blocked || skipped
          ? 'skipped'
          : context.maintenance
            ? 'completed'
            : 'running',
      startedAt: new Date(),
      completedAt:
        context.blocked || skipped || context.maintenance ? new Date() : null,
      googleIntelSnapshotId: context.snapshot.id,
      contentOperationsSnapshotId:
        context.contentPlanning?.contentOperationsSnapshotId || null,
      contentInventorySnapshotId:
        context.contentPlanning?.contentInventorySnapshotId || null,
      contentOpportunityDecisionId:
        context.contentPlanning?.contentOpportunityDecisionId || null,
      contentWorkOrderId:
        context.contentWorkOrder?._id || context.contentWorkOrder?.id || null,
      unifiedContentBriefId:
        context.unifiedBrief?._id || context.unifiedBrief?.id || null,
      evidenceMapId:
        context.evidenceMap?._id ||
        context.evidenceMap?.id ||
        context.contentPlanning?.evidenceMapId ||
        null,
      contentAction: context.opportunity?.decision || '',
      opportunityCandidates: context.contentPlanning?.candidates || [],
      researchBundleId: context.researchBundle?._id || null,
      editorialStyleProfileId: context.style?._id || null,
      strategyPlanId: context.strategy?._id || null,
      productCatalogSnapshotId:
        productSeedPlan?.productCatalogSnapshotId || null,
      productSeedPlanId: productSeedPlan?._id || null,
      editorialProductPlacementPlanId:
        context.editorialPlacementPlan?._id || null,
      productSeedingMode: productSeedPlan?.mode || 'off',
      productSeedingDecision: productSeedPlan?.decision || '',
      seededProductIds: [
        productSeedPlan?.primaryProduct,
        ...(productSeedPlan?.supportingProducts || [])
      ]
        .filter(Boolean)
        .map(item => item.productId),
      correlationId:
        context.contentPlanning?.correlationId || crypto.randomUUID(),
      agentSteps: context.blocked
        ? [
            'google-intelligence-gate',
            'product-catalog-snapshot',
            'product-relevance-analysis',
            'product-seed-plan',
            'blocked'
          ]
        : skipped
          ? [
              'google-intelligence-gate',
              'daily-content-snapshot',
              'opportunity-decision',
              'content-work-order',
              'skip'
            ]
          : context.maintenance
            ? [
                'google-intelligence-gate',
                'daily-content-snapshot',
                'opportunity-decision',
                'content-work-order',
                'unified-content-brief',
                'evidence-map',
                'scoped-maintenance-contract'
              ]
            : [
                'google-intelligence-gate',
                'product-catalog-snapshot',
                'product-relevance-analysis',
                'product-seed-plan',
                'editorial-product-placement-plan',
                'topic-opportunity-research',
                'industry-content-research',
                'editorial-style-planning',
                'content-strategy-plan',
                'content-architecture'
              ],
      publisherDecision:
        context.blocked || skipped || context.maintenance
          ? {
              allowed: false,
              reason: context.blocked
                ? context.blockReason
                : context.maintenance
                  ? 'Scoped maintenance requires a reviewed revision workflow.'
                  : context.opportunity?.reason ||
                    'No safe high-value action was selected.'
            }
          : {},
      metadata: {
        trigger: 'external_prepare',
        pipelineVersion: 'agentic-blog-core-v4-editorial-product-placement',
        ...(workOrderClaimToken
          ? { contentWorkOrderClaimToken: workOrderClaimToken }
          : {}),
        productSeeding: {
          selectedProducts: [
            productSeedPlan?.primaryProduct,
            ...(productSeedPlan?.supportingProducts || [])
          ].filter(Boolean),
          rejectedCandidates: productSeedPlan?.rejectedCandidates || [],
          candidateScores: productSeedPlan?.candidateScores || [],
          editorialProductPlacementPlanId:
            context.editorialPlacementPlan?._id || null,
          placementPlan:
            context.editorialPlacementPlan?.placementSequence || [],
          placementStyle:
            context.editorialPlacementPlan?.placementStyle || 'no-product',
          warnings: productSeedPlan?.warnings || []
        }
      }
    });
    if (
      !context.blocked &&
      !skipped &&
      !context.maintenance &&
      context.contentWorkOrder
    ) {
      if (!workOrderClaimToken)
        throw new BadRequestError(
          'Content Work Order execution claim is no longer current'
        );
      const workOrderId =
        context.contentWorkOrder._id || context.contentWorkOrder.id;
      const bound = await ContentWorkOrderService.bindExecution({
        workOrderId,
        planningCorrelationId: context.contentPlanning?.correlationId,
        executionId: execution._id,
        claimToken: workOrderClaimToken
      });
      if (!bound)
        throw new BadRequestError(
          'Content Work Order execution claim is no longer current'
        );
      const executionBound = await ContentWorkOrderService.bindExecutionClaim({
        executionId: execution._id,
        workOrderId,
        claimToken: workOrderClaimToken
      });
      if (!executionBound) throw createWorkOrderLeaseLostError();
    }
    if (productSeedPlan?._id)
      await ProductSeedPlanningService.attachExecution({
        planId: productSeedPlan._id,
        executionId: execution._id
      });
    await EditorialProductPlacementPlanningService.attachRelations({
      planId: context.editorialPlacementPlan?._id,
      executionId: execution._id,
      strategyPlanId: context.strategy?._id
    });
    if (context.blocked)
      throw new BadRequestError(
        context.blockReason ||
          'Required product integration has no suitable product'
      );
    if (skipped) {
      return {
        skipped: true,
        action: 'skip',
        reason:
          contentAction.reason || 'No safe high-value action was selected.',
        contentDecision: 'skip',
        contentAction,
        googleIntelSnapshotId: context.snapshot.id,
        contentOperationsSnapshotId:
          context.contentPlanning?.contentOperationsSnapshotId || '',
        contentInventorySnapshotId:
          context.contentPlanning?.contentInventorySnapshotId || '',
        contentOpportunityDecisionId:
          context.contentPlanning?.contentOpportunityDecisionId || '',
        contentWorkOrderId: String(
          context.contentWorkOrder?._id || context.contentWorkOrder?.id || ''
        ),
        unifiedContentBriefId: '',
        existingProductArtifacts: {},
        existingResearchArtifacts: {},
        existingStrategyArtifacts: {},
        agenticExecutionId: String(execution._id)
      };
    }
    if (context.maintenance) {
      return {
        skipped: false,
        maintenanceOnly: true,
        contentDecision: contentAction.decision,
        contentAction,
        googleIntelSnapshotId: context.snapshot.id,
        googleIntelSnapshotDate: context.snapshot.snapshotDate,
        googleIntelStatus: context.snapshot.status,
        contentOperationsSnapshotId:
          context.contentPlanning?.contentOperationsSnapshotId || '',
        contentInventorySnapshotId:
          context.contentPlanning?.contentInventorySnapshotId || '',
        contentOpportunityDecisionId:
          context.contentPlanning?.contentOpportunityDecisionId || '',
        contentWorkOrderId: String(
          context.contentWorkOrder?._id || context.contentWorkOrder?.id || ''
        ),
        unifiedContentBriefId: String(
          context.unifiedBrief?._id || context.unifiedBrief?.id || ''
        ),
        evidenceMapId: String(
          context.evidenceMap?._id || context.evidenceMap?.id || ''
        ),
        maintenanceContract: {
          action: contentAction.decision,
          targetBlogId: contentAction.targetBlogId,
          mergeSourceBlogIds: contentAction.mergeSourceBlogIds,
          fullArticleDraftRequired: false,
          liveMutationAllowed: false,
          reviewRequired: true
        },
        existingProductArtifacts: {},
        existingResearchArtifacts: {
          evidenceMapId: String(
            context.evidenceMap?._id || context.evidenceMap?.id || ''
          )
        },
        existingStrategyArtifacts: {},
        agenticExecutionId: String(execution._id)
      };
    }
    const selectedProducts = [
      productSeedPlan.primaryProduct,
      ...(productSeedPlan.supportingProducts || [])
    ].filter(Boolean);
    return {
      googleIntelSnapshotId: context.snapshot.id,
      googleIntelSnapshotDate: context.snapshot.snapshotDate,
      googleIntelStatus: context.snapshot.status,
      googleGuidance: context.snapshot.contentGuidance,
      contentOperationsSnapshotId:
        context.contentPlanning?.contentOperationsSnapshotId || '',
      contentInventorySnapshotId:
        context.contentPlanning?.contentInventorySnapshotId || '',
      contentOpportunityDecisionId:
        context.contentPlanning?.contentOpportunityDecisionId || '',
      contentWorkOrderId: String(
        context.contentWorkOrder?._id || context.contentWorkOrder?.id || ''
      ),
      unifiedContentBriefId: String(
        context.unifiedBrief?._id || context.unifiedBrief?.id || ''
      ),
      evidenceMapId: String(
        context.evidenceMap?._id || context.evidenceMap?.id || ''
      ),
      contentDecision: contentAction.decision,
      contentAction,
      researchBundleId: String(context.researchBundle._id),
      researchCoverage: context.researchBundle.researchCoverage,
      editorialPatterns: context.researchBundle.editorialPatterns,
      editorialStyleProfileId: String(context.style._id),
      editorialStyle: {
        styleFamily: context.style.styleFamily,
        openingMode: context.style.openingMode,
        headingMode: context.style.headingMode,
        paragraphRhythm: context.style.paragraphRhythm,
        evidenceMode: context.style.evidenceMode,
        ctaMode: context.style.ctaMode,
        forbiddenRecentPatterns: context.style.forbiddenRecentPatterns,
        brandVoiceConstraints: context.style.brandVoiceConstraints,
        activeVariant: context.style.activeVariant
      },
      strategyPlanId: String(context.strategy._id),
      agenticExecutionId: String(execution._id),
      productCatalogSnapshotId: context.productSeedPlan.productCatalogSnapshotId
        ? String(context.productSeedPlan.productCatalogSnapshotId)
        : '',
      productSeedPlanId: String(context.productSeedPlan._id),
      editorialProductPlacementPlanId: String(
        context.editorialPlacementPlan?._id || ''
      ),
      productSeeding: {
        mode: context.productSeedPlan.mode,
        intensity: context.productSeedPlan.intensity,
        decision: context.productSeedPlan.decision,
        selectedProducts: selectedProducts.map(item => ({
          productId: String(item.productId),
          name: item.name,
          slug: item.slug,
          canonicalUrl: item.canonicalUrl,
          relevanceScore: item.relevanceScore,
          allowedClaims: item.allowedClaims
        })),
        placementPlan: context.productSeedPlan.placementPlan || [],
        claimConstraints: selectedProducts.map(item => ({
          productId: String(item.productId),
          allowedClaims: item.allowedClaims,
          forbiddenClaims: item.forbiddenClaims
        })),
        commercialDensityLimits:
          context.productSeedPlan.commercialDensityLimits || {}
      },
      editorialProductPlacement: context.editorialPlacementPlan
        ? {
            id: String(context.editorialPlacementPlan._id),
            decision: context.editorialPlacementPlan.decision,
            placementStyle: context.editorialPlacementPlan.placementStyle,
            effectiveTopic: context.editorialPlacementPlan.effectiveTopic,
            ownedProductPositionPolicy:
              context.editorialPlacementPlan.ownedProductPositionPolicy,
            firstProductMention:
              context.editorialPlacementPlan.firstProductMention,
            placementSequence: context.editorialPlacementPlan.placementSequence,
            rankingStrategy: context.editorialPlacementPlan.rankingStrategy,
            rankingClaimReview:
              context.editorialPlacementPlan.rankingClaimReview,
            commercialDensity: context.editorialPlacementPlan.commercialDensity,
            visualPlacement: context.editorialPlacementPlan.visualPlacement,
            disclosure: context.editorialPlacementPlan.disclosure,
            ctaStrategy: context.editorialPlacementPlan.ctaStrategy,
            forbiddenPatterns: context.editorialPlacementPlan.forbiddenPatterns,
            reviewRules: context.editorialPlacementPlan.reviewRules,
            alternativesRejected:
              context.editorialPlacementPlan.alternativesRejected,
            reason: context.editorialPlacementPlan.reason,
            warnings: context.editorialPlacementPlan.warnings
          }
        : null,
      strategy: {
        decision: context.strategy.decision,
        decisionReason: context.strategy.decisionReason,
        targetBlogIds: (context.strategy.targetBlogIds || []).map(String),
        searchIntent: context.strategy.searchIntent,
        primaryQuestion: context.strategy.primaryQuestion,
        supportingQuestions: context.strategy.supportingQuestions,
        articleType: context.strategy.articleType,
        evidenceRequirements: context.strategy.evidenceRequirements,
        riskFlags: context.strategy.riskFlags,
        contentArchitecture: context.strategy.contentArchitecture
      },
      existingProductArtifacts: {
        productCatalogSnapshotId: context.productSeedPlan
          .productCatalogSnapshotId
          ? String(context.productSeedPlan.productCatalogSnapshotId)
          : '',
        productSeedPlanId: String(context.productSeedPlan._id),
        editorialProductPlacementPlanId: String(
          context.editorialPlacementPlan?._id || ''
        )
      },
      existingResearchArtifacts: {
        researchBundleId: String(context.researchBundle._id),
        evidenceMapId: String(
          context.evidenceMap?._id || context.evidenceMap?.id || ''
        )
      },
      existingStrategyArtifacts: {
        editorialStyleProfileId: String(context.style._id),
        strategyPlanId: String(context.strategy._id)
      }
    };
  }

  static async publishSeoBlog({ payload = {}, trustedQaContext = null }) {
    const qaContext = normalizeTrustedQaContext(trustedQaContext);
    const qaPayloadKeys = [
      'isQaTest', 'qaBatchId', 'qaCaseId', 'environment', 'executionMode',
      'qaIteration', 'originalTopicSeed', 'normalizedTopicKey', 'qaTopicReservationId'
    ];
    if (!qaContext && qaPayloadKeys.some(key => payload[key] !== undefined || payload.metadata?.[key] !== undefined)) {
      throw new BadRequestError('QA provenance cannot be supplied through the automation payload');
    }
    const normalized = validateAutomationPayload(payload);
    if (qaContext) normalized.mode = 'draft';
    const currentSnapshot = qaContext
      ? await GoogleIntelligenceService.ensureGoogleIntelligenceSnapshotForDate({ trustedQaContext: qaContext })
      : await GoogleIntelligenceService.ensureGoogleIntelligenceSnapshotForDate();
    if (
      String(currentSnapshot.id) !== String(normalized.googleIntelSnapshotId)
    ) {
      throw new BadRequestError(
        'googleIntelSnapshotId does not match the current daily snapshot'
      );
    }
    if (
      String(currentSnapshot.snapshotDate) !==
      String(normalized.googleIntelSnapshotDate)
    ) {
      throw new BadRequestError(
        'googleIntelSnapshotDate does not match the current daily snapshot'
      );
    }
    assertPublisherArtifactProvenance({
      label: 'googleIntelligenceSnapshot',
      artifact: currentSnapshot,
      qaContext,
      allowCleanProductionReuse: Boolean(qaContext)
    });

    let verifiedExecution = null;
    let verifiedWorkOrder = null;
    let verifiedWorkOrderClaimToken = '';
    let verifiedBrief = null;
    let verifiedEvidenceMap = null;
    if (parseBoolean(process.env.CONTENT_OPERATIONS_ENABLED, false)) {
      const [
        execution,
        workOrder,
        brief,
        evidenceMap,
        decision,
        researchBundle,
        strategyPlan
      ] = await Promise.all([
        BlogAutomationExecution.findById(normalized.agenticExecutionId).lean(),
        ContentWorkOrder.findById(normalized.contentWorkOrderId).lean(),
        UnifiedContentBrief.findById(normalized.unifiedContentBriefId).lean(),
        EvidenceMap.findById(normalized.evidenceMapId).lean(),
        ContentOpportunityDecision.findById(
          normalized.contentOpportunityDecisionId
        ).lean(),
        ResearchBundle.findById(normalized.researchBundleId).lean(),
        BlogStrategyPlan.findById(normalized.strategyPlanId).lean()
      ]);
      if (
        !execution ||
        !workOrder ||
        !brief ||
        !evidenceMap ||
        !decision ||
        !researchBundle ||
        !strategyPlan
      ) {
        throw new BadRequestError(
          'The persisted Content Operations artifact chain is incomplete'
        );
      }
      assertPublisherArtifactChainProvenance({
        qaContext,
        artifacts: {
          execution,
          workOrder,
          unifiedContentBrief: brief,
          evidenceMap,
          opportunityDecision: decision,
          researchBundle,
          strategyPlan
        }
      });
      const artifactChecks = [
        [
          'executionContentOperationsSnapshotId',
          execution.contentOperationsSnapshotId,
          normalized.contentOperationsSnapshotId
        ],
        [
          'executionContentInventorySnapshotId',
          execution.contentInventorySnapshotId,
          normalized.contentInventorySnapshotId
        ],
        [
          'executionOpportunityDecisionId',
          execution.contentOpportunityDecisionId,
          normalized.contentOpportunityDecisionId
        ],
        [
          'executionWorkOrderId',
          execution.contentWorkOrderId,
          normalized.contentWorkOrderId
        ],
        [
          'executionUnifiedBriefId',
          execution.unifiedContentBriefId,
          normalized.unifiedContentBriefId
        ],
        [
          'executionEvidenceMapId',
          execution.evidenceMapId,
          normalized.evidenceMapId
        ],
        [
          'executionResearchBundleId',
          execution.researchBundleId,
          normalized.researchBundleId
        ],
        [
          'executionEditorialStyleProfileId',
          execution.editorialStyleProfileId,
          normalized.editorialStyleProfileId
        ],
        [
          'executionStrategyPlanId',
          execution.strategyPlanId,
          normalized.strategyPlanId
        ],
        [
          'workOrderContentOperationsSnapshotId',
          workOrder.contentOperationsSnapshotId,
          normalized.contentOperationsSnapshotId
        ],
        [
          'workOrderGoogleIntelSnapshotId',
          workOrder.googleIntelSnapshotId,
          normalized.googleIntelSnapshotId
        ],
        [
          'workOrderOpportunityDecisionId',
          workOrder.contentOpportunityDecisionId,
          normalized.contentOpportunityDecisionId
        ],
        [
          'workOrderActiveExecutionId',
          workOrder.metadata?.activeExecutionId,
          normalized.agenticExecutionId
        ],
        [
          'briefWorkOrderId',
          brief.contentWorkOrderId,
          normalized.contentWorkOrderId
        ],
        [
          'evidenceWorkOrderId',
          evidenceMap.contentWorkOrderId,
          normalized.contentWorkOrderId
        ],
        [
          'evidenceBriefId',
          evidenceMap.unifiedContentBriefId,
          normalized.unifiedContentBriefId
        ],
        [
          'researchWorkOrderId',
          researchBundle.contentWorkOrderId,
          normalized.contentWorkOrderId
        ],
        [
          'researchBriefId',
          researchBundle.unifiedContentBriefId,
          normalized.unifiedContentBriefId
        ],
        [
          'strategyWorkOrderId',
          strategyPlan.contentWorkOrderId,
          normalized.contentWorkOrderId
        ],
        [
          'strategyBriefId',
          strategyPlan.unifiedContentBriefId,
          normalized.unifiedContentBriefId
        ],
        [
          'decisionContentOperationsSnapshotId',
          decision.contentOperationsSnapshotId,
          normalized.contentOperationsSnapshotId
        ]
      ];
      const mismatch = artifactChecks.find(
        ([, actual, expected]) =>
          String(actual || '') !== String(expected || '')
      );
      if (mismatch)
        throw new BadRequestError(
          `${mismatch[0]} does not match the persisted Content Operations chain`
        );
      if (
        workOrder.decision !== normalized.contentDecision ||
        decision.recommendedAction !== normalized.contentDecision
      ) {
        throw new BadRequestError(
          'contentDecision does not match the approved Work Order and opportunity decision'
        );
      }
      if (decision.status === 'dismissed')
        throw new BadRequestError(
          'Dismissed opportunities cannot invoke the publisher'
        );
      if (workOrder.status !== 'drafting')
        throw new BadRequestError(
          'Content Work Order is not in a publisher-runnable state'
        );
      if (workOrder.decision === 'skip')
        throw new BadRequestError(
          'Skip Work Orders cannot invoke the publisher'
        );
      const executionClaimToken = normalizeString(
        execution.metadata?.contentWorkOrderClaimToken
      );
      if (
        !executionClaimToken ||
        executionClaimToken !== getActiveClaimToken(workOrder)
      ) {
        throw createWorkOrderLeaseLostError();
      }
      const requiresTarget = REVISION_ACTIONS.has(normalized.contentDecision);
      if (
        requiresTarget &&
        String(workOrder.targetBlogId || '') !==
          String(normalized.targetBlogId || '')
      ) {
        throw new BadRequestError(
          'targetBlogId does not match the approved Content Work Order'
        );
      }
      if (
        requiresTarget &&
        brief.targetBlogId &&
        String(brief.targetBlogId) !== String(normalized.targetBlogId || '')
      ) {
        throw new BadRequestError(
          'targetBlogId does not match the Unified Content Brief'
        );
      }
      if (normalized.contentDecision === 'merge') {
        const expectedSources = (workOrder.mergeSourceBlogIds || [])
          .map(String)
          .sort();
        const suppliedSources = (normalized.mergeSourceBlogIds || [])
          .map(String)
          .sort();
        if (
          expectedSources.length !== suppliedSources.length ||
          expectedSources.some((id, index) => id !== suppliedSources[index])
        ) {
          throw new BadRequestError(
            'mergeSourceBlogIds do not match the approved Content Work Order'
          );
        }
      }
      verifiedExecution = execution;
      verifiedWorkOrder = workOrder;
      verifiedWorkOrderClaimToken = executionClaimToken;
      verifiedBrief = brief;
      verifiedEvidenceMap = evidenceMap;
      await renewOwnedWorkOrderOrThrow({
        workOrderId: workOrder._id,
        claimToken: verifiedWorkOrderClaimToken
      });
    }

    if (qaContext) {
      const persistedExecution = verifiedExecution || await BlogAutomationExecution.findById(normalized.agenticExecutionId).lean();
      assertPublisherArtifactProvenance({
        label: 'execution',
        artifact: persistedExecution,
        qaContext
      });
      for (const key of ['qaBatchId', 'qaCaseId', 'environment', 'executionMode', 'qaIteration', 'originalTopicSeed', 'normalizedTopicKey', 'qaTopicReservationId']) {
        if (String(persistedExecution[key] || '') !== String(qaContext[key] || '')) {
          throw new BadRequestError(`Trusted QA ${key} does not match the persisted execution`);
        }
      }
    }

    let verifiedProductPlan = null;
    let verifiedPlacementPlan = null;
    if (normalized.productSeedingMode !== 'off') {
      const [execution, plan, placementPlan] = await Promise.all([
        verifiedExecution ||
          BlogAutomationExecution.findById(
            normalized.agenticExecutionId
          ).lean(),
        ProductSeedPlan.findById(normalized.productSeedPlanId).lean(),
        EditorialProductPlacementPlan.findById(
          normalized.editorialProductPlacementPlanId
        ).lean()
      ]);
      if (!execution)
        throw new BadRequestError(
          'Agentic execution was not found for product validation'
        );
      if (!plan) throw new BadRequestError('Product Seed Plan was not found');
      if (!placementPlan)
        throw new BadRequestError(
          'Editorial Product Placement Plan was not found'
        );
      assertPublisherArtifactChainProvenance({
        qaContext,
        artifacts: {
          productValidationExecution: execution,
          productSeedPlan: plan,
          editorialProductPlacementPlan: placementPlan
        }
      });
      const idChecks = [
        [
          'productSeedPlanId',
          execution.productSeedPlanId,
          normalized.productSeedPlanId
        ],
        [
          'editorialProductPlacementPlanId',
          execution.editorialProductPlacementPlanId,
          normalized.editorialProductPlacementPlanId
        ],
        ['strategyPlanId', execution.strategyPlanId, normalized.strategyPlanId],
        [
          'productCatalogSnapshotId',
          execution.productCatalogSnapshotId,
          normalized.productCatalogSnapshotId
        ],
        [
          'googleIntelSnapshotId',
          plan.googleIntelSnapshotId,
          normalized.googleIntelSnapshotId
        ],
        [
          'productCatalogSnapshotId',
          plan.productCatalogSnapshotId,
          normalized.productCatalogSnapshotId
        ],
        [
          'placementProductSeedPlanId',
          placementPlan.productSeedPlanId,
          normalized.productSeedPlanId
        ],
        [
          'placementGoogleIntelSnapshotId',
          placementPlan.googleIntelSnapshotId,
          normalized.googleIntelSnapshotId
        ],
        [
          'placementProductCatalogSnapshotId',
          placementPlan.productCatalogSnapshotId,
          normalized.productCatalogSnapshotId
        ],
        [
          'placementStrategyPlanId',
          placementPlan.strategyPlanId,
          normalized.strategyPlanId
        ]
      ];
      const mismatch = idChecks.find(
        ([, actual, expected]) =>
          String(actual || '') !== String(expected || '')
      );
      if (mismatch)
        throw new BadRequestError(
          `${mismatch[0]} does not match the current execution and product plan`
        );
      const plannedIds = new Set(
        [plan.primaryProduct, ...(plan.supportingProducts || [])]
          .filter(Boolean)
          .map(item => String(item.productId))
      );
      const referencedIds = extractProductBlocks(normalized.contentHtml)
        .map(item => item.productId)
        .filter(Boolean);
      const unplanned = referencedIds.find(
        productId => !plannedIds.has(String(productId))
      );
      if (unplanned)
        throw new BadRequestError(
          `Draft contains unplanned productId: ${unplanned}`
        );
      const productReviews = reviewProductLayer({
        html: normalized.contentHtml,
        plan
      });
      normalized.productSeedingReview = productReviews.productSeedingReview;
      normalized.productClaimReview = productReviews.productClaimReview;
      if (!productReviews.productSeedingReview.pass)
        appendDraftReason(
          normalized.publishGate.reasons,
          'product_seeding_review_not_pass'
        );
      if (!productReviews.productClaimReview.pass)
        appendDraftReason(
          normalized.publishGate.reasons,
          'product_claim_review_not_pass'
        );
      if (productReviews.productSeedingReview.commercialPressure === 'high')
        appendDraftReason(
          normalized.publishGate.reasons,
          'product_commercial_pressure_high'
        );
      const editorialPlacementReview = reviewEditorialProductPlacement({
        html: normalized.contentHtml,
        title: normalized.title,
        productSeedPlan: plan,
        placementPlan
      });
      normalized.editorialProductPlacementReview = editorialPlacementReview;
      if (!editorialPlacementReview.pass)
        appendDraftReason(
          normalized.publishGate.reasons,
          'editorial_product_placement_review_not_pass'
        );
      if (['high', 'critical'].includes(editorialPlacementReview.riskLevel))
        appendDraftReason(
          normalized.publishGate.reasons,
          `editorial_product_placement_risk_${editorialPlacementReview.riskLevel}`
        );
      normalized.publishGate.passes =
        normalized.publishGate.reasons.length === 0;
      verifiedProductPlan = plan;
      verifiedPlacementPlan = placementPlan;
    } else {
      if (
        extractProductBlocks(normalized.contentHtml).length ||
        extractPlacementBlocks(normalized.contentHtml).length
      ) {
        throw new BadRequestError(
          'Draft contains a product block while product seeding mode is off'
        );
      }
      if (normalized.editorialProductPlacementPlanId) {
        const placementPlan = await EditorialProductPlacementPlan.findById(
          normalized.editorialProductPlacementPlanId
        ).lean();
        if (!placementPlan)
          throw new BadRequestError(
            'Editorial Product Placement Plan was not found'
          );
        assertPublisherArtifactProvenance({
          label: 'editorialProductPlacementPlan',
          artifact: placementPlan,
          qaContext
        });
        if (placementPlan.decision !== 'no_product')
          throw new BadRequestError(
            'Product seeding mode is off but placement plan authorizes a product'
          );
        if (
          (normalized.productSeedPlanId &&
            String(placementPlan.productSeedPlanId || '') !== String(normalized.productSeedPlanId)) ||
          String(placementPlan.googleIntelSnapshotId || '') !==
            String(normalized.googleIntelSnapshotId) ||
          String(placementPlan.strategyPlanId || '') !== String(normalized.strategyPlanId)) {
            throw new BadRequestError(
            'Editorial Product Placement Plan does not match the current snapshot and strategy'
          );
        }
        normalized.editorialProductPlacementReview =
          reviewEditorialProductPlacement({
            html: normalized.contentHtml,
            title: normalized.title,
            productSeedPlan: { mode: 'off', decision: 'no_seed' },
            placementPlan
          });
        verifiedPlacementPlan = placementPlan;
      }
    }

    const [existing, targetBlog] = await Promise.all([
      blog.findOne({ blog_slug: normalized.slug }).select('_id').lean(),
      normalized.targetBlogId
        ? blog.findById(normalized.targetBlogId).lean()
        : null
    ]);
    const isRevision = REVISION_ACTIONS.has(normalized.contentDecision);
    if (
      existing &&
      (!isRevision || String(existing._id) !== String(normalized.targetBlogId))
    ) {
      throw new BadRequestError('blog_slug already exists');
    }
    if (isRevision && !normalized.targetBlogId) throw new BadRequestError(
        'targetBlogId is required for revision actions'
      );
            if (isRevision && !targetBlog) throw new BadRequestError('Target blog for the revision was not found');
            if (isRevision && normalized.slug !== targetBlog.blog_slug) throw new BadRequestError(
        'Revision actions must preserve the existing slug'
      );
            const reasons = [...normalized.publishGate.reasons];
            const requestedPublish = normalized.mode === 'publish';
            const envAutoPublish = parseBoolean(
      process.env.SEO_AGENT_AUTO_PUBLISH,
      false
    );
    const readinessEnabled = parseBoolean(
      process.env.CONTENT_PUBLISH_READINESS_ENABLED,
      true
    );
            const postPublishVerificationEnabled = parseBoolean(
      process.env.CONTENT_POST_PUBLISH_VERIFY_ENABLED,
      true
    );

    if (requestedPublish && !envAutoPublish) {
      appendDraftReason(reasons, 'auto_publish_disabled');
    }
    if (!requestedPublish) {
      appendDraftReason(reasons, 'draft_mode_requested');
    }
    if (requestedPublish && !readinessEnabled)
      appendDraftReason(reasons, 'publish_readiness_disabled');
            if (requestedPublish && !postPublishVerificationEnabled)
      appendDraftReason(reasons, 'post_publish_verification_disabled');

    let imagePipeline;
    if (qaContext && isRevision) {
      throw new BadRequestError('QA executions cannot revise or mutate an existing blog');
    }
    if (qaContext) {
      imagePipeline = {
        visualPlan: {
          status: 'planned_pending_generation',
          providerExecution: 'forbidden_in_qa',
          cover: {
            required: true,
            purpose: 'Explain the article topic without making unsupported product claims',
            altText: `Planned cover image for ${normalized.title}`.slice(0, 300),
            reviewRequired: true
          },
          inlineImages: [],
          safety: {
            paidProviderCalled: false,
            externalImageSearchCalled: false,
            publishWithoutReviewAllowed: false
          }
        },
        coverImage: {
          url: normalized.imageUrl || '/og-image.png',
          alt: `Pending reviewed cover image for ${normalized.title}`.slice(0, 300),
          sourceType: 'qa_placeholder',
          status: 'pending_generation',
          reviewStatus: 'pending_review',
          warning: 'qa_paid_image_pipeline_disabled'
        },
        contentImages: [],
        contentHtml: normalized.contentHtml,
        status: 'pending',
        warnings: ['qa_paid_image_pipeline_disabled'],
        coverReadyForPublish: false,
        publishReady: false
      };
      appendDraftReason(reasons, 'qa_draft_only');
    } else if (isRevision) {
      imagePipeline = {
        visualPlan: targetBlog.visualPlan || null,
        coverImage: targetBlog.coverImage || {
          url: targetBlog.blog_image || '',
          status: 'complete'
        },
        contentImages: targetBlog.contentImages || [],
        contentHtml: normalized.contentHtml,
        status: 'not_run_for_revision',
        warnings: ['image_pipeline_not_invoked_for_revision'],
        coverReadyForPublish: false,
        publishReady: false
      };
    } else {
      try {
        imagePipeline = await runImagePipeline({
          title: normalized.title,
          slug: normalized.slug,
          category: normalized.categoryKey,
          summary: normalized.excerpt,
          outline: normalized.outline,
          contentHtml: normalized.contentHtml,
          primaryKeyword: normalized.primaryKeyword,
          articleType: normalized.articleType,
          imageSearchQuery: normalizeString(payload.imageSearchQuery || ''),
          editorialProductPlacement: verifiedPlacementPlan
        });
      } catch (error) {
        const imageErrorCode = sanitizeErrorCode(error);
        imagePipeline = {
          visualPlan: null,
          coverImage: { url: '', status: 'failed', warning: imageErrorCode },
          contentImages: [],
          contentHtml: normalized.contentHtml,
          status: 'failed',
          warnings: [imageErrorCode],
          coverReadyForPublish: false,
          publishReady: false
        };
      }
    }

    const requireCover = parseBoolean(
      process.env.OPENCLAW_REQUIRE_COVER_IMAGE_FOR_PUBLISH,
      true
    );
            if (
      requestedPublish &&
      !isRevision &&
      requireCover &&
      !imagePipeline.coverReadyForPublish
    ) {
      appendDraftReason(reasons, 'cover_image_required_for_publish');
    }
    if (requestedPublish && !isRevision && !imagePipeline.publishReady) {
      appendDraftReason(reasons, 'image_pipeline_not_ready_for_publish');
            }

    let revision = null;
    if (isRevision) {
      if (!verifiedWorkOrder || !verifiedBrief) {
        throw new BadRequestError(
          'Revision actions require a persisted Content Work Order and Unified Content Brief'
        );
      }
      await renewOwnedWorkOrderOrThrow({
        workOrderId: verifiedWorkOrder._id,
        claimToken: verifiedWorkOrderClaimToken
      });
      const canonicalUrl =
        targetBlog.canonicalUrl || buildPublicUrl(targetBlog.blog_slug);
      const maintenanceChanges =
        payload.maintenanceChanges &&
        typeof payload.maintenanceChanges === 'object'
          ? payload.maintenanceChanges
          : normalized.metadata?.maintenanceChanges || {};
      const revisionSections = SCOPED_MAINTENANCE_ACTIONS.has(normalized.contentDecision
      )
        ? {
            sectionChanges: maintenanceChanges.sectionChanges || [],
            preservedSectionKeys: maintenanceChanges.preservedSectionKeys || [
              'all_existing_sections'
            ],
            warnings: maintenanceChanges.warnings || []
          }
        : buildRevisionSectionChanges({
            action: normalized.contentDecision,
            currentHtml: targetBlog.blog_content,
            proposedHtml: imagePipeline.contentHtml || normalized.contentHtml,
            primaryBlogId: targetBlog._id,
            sourceBlogIds: normalized.mergeSourceBlogIds || []
          });
      const mergePlan =
        normalized.contentDecision === 'merge'
          ? maintenanceChanges.mergePlan || {
              primaryBlogId: String(targetBlog._id),
              sourceBlogIds: normalized.mergeSourceBlogIds,
              operation: 'consolidate_non_duplicate_material_into_primary',
              primaryCanonicalPreserved: true,
              sourceArticlesRemainLive: true,
              liveDeletionAllowed: false,
              redirectsApplied: false,
              reviewRequired: true
            }
          : null;
      revision = await BlogRevisionService.stage({
        workOrder: verifiedWorkOrder,
        brief: verifiedBrief,
        currentBlog: {
          ...targetBlog,
          canonicalUrl,
          contentHtml: targetBlog.blog_content
        },
        changes: {
          sectionChanges: revisionSections.sectionChanges,
          metadataChanges: maintenanceChanges.metadataChanges || {
            title: normalized.title,
            seoTitle: normalized.seoTitle,
            seoDescription: normalized.seoDescription,
            canonicalUrl
          },
          internalLinkChanges:
            maintenanceChanges.internalLinkChanges ||
            normalized.internalLinks ||
            [],
          factChanges: maintenanceChanges.factChanges || [],
          mergePlan,
          preservedSectionKeys: revisionSections.preservedSectionKeys,
          redirectRecommendations:
            maintenanceChanges.redirectRecommendations || [],
          warnings: revisionSections.warnings
        }
      });
      appendDraftReason(reasons, 'revision_staged_live_article_unchanged');
        }

    let readinessReport = null;
    if (verifiedWorkOrder && verifiedBrief && readinessEnabled) {
      readinessReport = await ContentPublishReadinessService.createReport({
        workOrder: verifiedWorkOrder,
        brief: verifiedBrief,
        evidenceMap: verifiedEvidenceMap,
        expectedCanonical: isRevision
          ? targetBlog.canonicalUrl || buildPublicUrl(targetBlog.blog_slug)
          : buildPublicUrl(normalized.slug),
        draft: {
                title: normalized.title,
                slug: normalized.slug,
          seoDescription: normalized.seoDescription,
          canonicalUrl: isRevision
            ? targetBlog.canonicalUrl || buildPublicUrl(targetBlog.blog_slug)
            : buildPublicUrl(normalized.slug),
                contentHtml: imagePipeline.contentHtml || normalized.contentHtml,
          mode: isRevision ? 'draft' : normalized.mode,
          targetBlogId: normalized.targetBlogId || null,
          blogRevisionId: revision?._id || null,
          preserveCanonical: true,
          fullContentRewrite: !SCOPED_MAINTENANCE_ACTIONS.has(
            normalized.contentDecision
          ),
                coverImage: imagePipeline.coverImage,
          contentImages: imagePipeline.contentImages,
          requireCoverImage: !isRevision && requireCover,
          internalLinks: normalized.internalLinks || [],
          materialClaims: normalized.materialClaims,
          materialClaimsManifestProvided:
            normalized.materialClaimsManifestProvided,
          productClaimReview: normalized.productClaimReview,
          productPlacementReview: normalized.editorialProductPlacementReview,
          productDisclosurePassed: normalized.productSeedingMode === 'off' ||
            normalized.productSeedingReview?.pass === true,
          structuredDataType:
            verifiedBrief.structuredDataCandidate || 'Article',
          structuredDataValid: true,
          rendererProvidesH1: true,
          mobileSafeMarkup: true
        },
        existingQualityGates: normalized.agenticReviews || {}
      });
      assertPublisherArtifactProvenance({
        label: 'publishReadinessReport',
        artifact: readinessReport,
        qaContext
      });
      normalized.publishReadinessReportId = readinessReport._id;
      if (!readinessReport.pass)
        appendDraftReason(reasons,
          `publish_readiness_${readinessReport.riskLevel}`
        );
        }

        const shouldPublish =
      !qaContext &&
      !isRevision &&
      requestedPublish &&
            envAutoPublish &&
      readinessEnabled &&
      postPublishVerificationEnabled &&
      normalized.publishGate.passes &&
      (!readinessReport || readinessReport.autoPublishAllowed) &&
      imagePipeline.publishReady &&
            (!requireCover || imagePipeline.coverReadyForPublish);
        let created;
        try {
      if (verifiedWorkOrder) {
        await renewOwnedWorkOrderOrThrow({
          workOrderId: verifiedWorkOrder._id,
          claimToken: verifiedWorkOrderClaimToken
        });
      }
      await assertTrustedQaExecutionFence({
        executionId: normalized.agenticExecutionId,
        qaContext
      });
      if (isRevision) {
        created = targetBlog;
      } else {
        const lifecycle = buildBlogLifecycleMetadata({
          brief: verifiedBrief,
          slug: normalized.slug,
          shouldPublish,
          readinessReviewed: Boolean(readinessReport),
          readinessPassed: readinessReport?.pass === true });
        const document = createBlogDocument({
          normalized,
          shouldPublish,
          imagePipeline,
          lifecycle,
          qaContext
        });
        created = await blog.create(document);
      }
    } catch (error) {
      if (error?.code === 11000 && qaContext) {
        const retainedQaDraft = await blog.findOne({
          isQaTest: true,
          qaCaseId: qaContext.qaCaseId,
          qaIteration: qaContext.qaIteration
        }).lean();
        if (
          retainedQaDraft &&
          String(retainedQaDraft.agenticExecutionId || '') === String(normalized.agenticExecutionId || '')
        ) {
          created = retainedQaDraft;
        } else {
          throw new BadRequestError('The QA draft slot for this case iteration is already consumed');
        }
      } else if (error?.code === 11000) {
        throw new BadRequestError('blog_slug already exists');
      } else {
      throw error;
      }
        }
        const createdObject = typeof created.toObject === 'function' ? created.toObject() : created;
        const blogId = String(createdObject?._id || createdObject?.id || '');
        const mode = isRevision ? 'revision' : shouldPublish ? 'publish' : 'draft';

        if (verifiedPlacementPlan && blogId && !qaContext) {
            await EditorialProductPlacementPlanningService.attachRelations({ planId: verifiedPlacementPlan._id, executionId: normalized.agenticExecutionId, strategyPlanId: normalized.strategyPlanId, blogId });
        }

        if (verifiedProductPlan && blogId && !isRevision && !qaContext) {
            const blocks = extractPlacementBlocks(normalized.contentHtml);
            const selected = [verifiedProductPlan.primaryProduct, ...(verifiedProductPlan.supportingProducts || [])].filter(Boolean);
            await Promise.all(selected.map(item => {
                const productBlocks = blocks.filter(
            block => String(block.productId) === String(item.productId));
                const mentionCount = productBlocks.reduce((sum, block) => sum + (block.text.match(new RegExp(String(item.name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length, 0);
                const linkCount = productBlocks.reduce((sum, block) => sum + block.links.filter(link => link.linkType === 'product').length, 0);
                return ProductSeedExposure.updateOne(
                    { productId: item.productId, blogId },
                    {
                        $set: {
                            executionId: normalized.agenticExecutionId,
                            categoryKey: item.category?.id || '',
                            articleType: normalized.articleType,
                            placementTypes: (verifiedPlacementPlan?.placementSequence || []).filter(
                    placement => String(placement.productId) === String(item.productId)).map(placement => placement.presentation),
                            placementFingerprint: crypto.createHash('sha256').update(JSON.stringify(verifiedPlacementPlan?.placementSequence || [])).digest('hex'),
                            editorialProductPlacementPlanId: verifiedPlacementPlan?._id || null,
                            placementStyle: verifiedPlacementPlan?.placementStyle || '',
                            ownedProductPosition: verifiedPlacementPlan?.ownedProductPositionPolicy || 'none',
                            firstMentionPercent: normalized.editorialProductPlacementReview?.firstProductMention?.progressPercent || 0,
                            productBlockCount: productBlocks.length,
                            productImageCount: normalized.editorialProductPlacementReview?.metrics?.productImages || 0,
                            mentionCount,
                            linkCount,
                            ctaMode: verifiedProductPlan.ctaPlan?.mode || 'none',
                            publishedAt: shouldPublish ? new Date() : null
                        }
                    },
                    { upsert: true }
                );
            }));
        }

    const completedAt = new Date();
    if (verifiedWorkOrder) {
      await renewOwnedWorkOrderOrThrow({
        workOrderId: verifiedWorkOrder._id,
        claimToken: verifiedWorkOrderClaimToken
      });
      const workOrderUpdates = {};
      if (revision?._id)
        workOrderUpdates['artifactIds.blogRevisionId'] = revision._id;
      if (readinessReport?._id)
        workOrderUpdates['artifactIds.publishReadinessReportId'] =
          readinessReport._id;
      const transitioned = await ContentWorkOrderService.transitionClaimed(
            {
        workOrderId: verifiedWorkOrder._id,
        claimToken: verifiedWorkOrderClaimToken,
        status: shouldPublish ? 'completed' : 'reviewing',
        updates: workOrderUpdates
      });
      if (!transitioned) throw createWorkOrderLeaseLostError();
      verifiedWorkOrder = transitioned;
    }

    const executionStatus = isRevision
      ? 'maintenance_created'
      : shouldPublish
        ? 'published'
        : 'draft_created';
    const executionUpdates = {
      blogId,
      blogSlug: normalized.slug,
      blogTitle: normalized.title,
      mode,
      blogRevisionId: revision?._id || null,
      publishReadinessReportId: readinessReport?._id || null,
      publishReadiness: readinessReport || null,
      reviewerDecisions: normalized.agenticReviews || normalized.metadata?.reviewerDecisions || {},
      productSeedingReview: normalized.productSeedingReview,
      productClaimReview: normalized.productClaimReview,
      editorialProductPlacementReview: normalized.editorialProductPlacementReview,
      publisherDecision: { allowed: shouldPublish, reasons },
      'metadata.resultReasons': reasons,
      'metadata.imagePipelineStatus': imagePipeline.status,
      'metadata.editorialProductPlacementPlanId': normalized.editorialProductPlacementPlanId || '',
      'metadata.editorialProductPlacementReview': normalized.editorialProductPlacementReview || null
    };
    const executionTransitioned = verifiedWorkOrder
      ? await ContentWorkOrderService.transitionExecutionClaimed({
          executionId: normalized.agenticExecutionId,
          workOrderId: verifiedWorkOrder._id,
          claimToken: verifiedWorkOrderClaimToken,
          status: executionStatus,
          completedAt,
          fromStatuses: qaContext ? ['committing'] : ['running', 'committing'],
          updates: executionUpdates
        })
      : await ContentWorkOrderService.transitionExecutionUnclaimed({
          executionId: normalized.agenticExecutionId,
          status: executionStatus,
          completedAt,
          fromStatuses: qaContext ? ['committing'] : ['running', 'committing'],
          updates: executionUpdates
        });
    if (!executionTransitioned)
      throw createWorkOrderLeaseLostError();

    const { monitoringTasks, postPublishVerification, postCommitWarnings } =
      await runPostCommitSafeguards({
        shouldPublish,
        workOrder: verifiedWorkOrder,
        blogId,
        executionId: normalized.agenticExecutionId,
        correlationId: verifiedExecution?.correlationId || '',
        publishedAt: createdObject.publishedAt || new Date(),
        monitoringWindows: normalized.monitoringWindows,
        postPublishVerificationEnabled,
        publishReadinessReportId: readinessReport?._id || null,
        slug: normalized.slug,
        contentHtml: imagePipeline.contentHtml || normalized.contentHtml,
        requireCover
      }
        );

        return {
            mode,
            blogId,
            slug: normalized.slug,
            url: buildPublicUrl(normalized.slug),
            seoScore: normalized.review.seoScore,
            published: shouldPublish,
            reasons,
            wordCount: normalized.wordCount,
            metadata: normalized.metadata,
            imagePipelineStatus: imagePipeline.status,
            imageWarnings: imagePipeline.warnings,
            coverImage: imagePipeline.coverImage,
            contentImages: imagePipeline.contentImages,
            contentDecision: normalized.contentDecision,
            editorialProductPlacementPlanId: normalized.editorialProductPlacementPlanId || '',
            editorialProductPlacementReview: normalized.editorialProductPlacementReview,
      publishReadinessReportId: String(readinessReport?._id || ''),
      publishReadiness: readinessReport,
      revisionStaged: Boolean(revision),
      blogRevisionId: String(revision?._id || ''),
      liveBlogMutated: false,
      monitoringTasks: monitoringTasks.map(task => ({
        id: String(task._id),
        window: task.window,
        dueAt: task.dueAt
      })),
      postCommitWarnings,
      postPublishVerification: postPublishVerification
        ? typeof postPublishVerification.toObject === 'function'
          ? postPublishVerification.toObject()
          : postPublishVerification
        : null,
      updatedExisting: isRevision
    };
    }
}

AutomationSeoBlogService.buildBlogLifecycleMetadata =
  buildBlogLifecycleMetadata;
AutomationSeoBlogService.assertTrustedQaExecutionFence =
  assertTrustedQaExecutionFence;
AutomationSeoBlogService.assertPublisherArtifactProvenance =
  assertPublisherArtifactProvenance;
AutomationSeoBlogService.assertPublisherArtifactChainProvenance =
  assertPublisherArtifactChainProvenance;

module.exports = AutomationSeoBlogService;
