"use strict";

const crypto = require("node:crypto");
const { uploadImage } = require("../storage.service");
const { buildImageFilename } = require("../../utils/imageFilename.util");
const {
  buildImageSeoMetadata,
  insertInlineImages,
} = require("../../utils/imageSeo.util");
const { sanitizeSeoBlogHtml } = require("../../utils/seoBlogSanitizer");
const { generateImage } = require("./aiImageGenerate.service");
const { buildImagePrompt } = require("./imagePromptBuilder.service");
const { optimizeImage } = require("./imageOptimize.service");
const { reviewImageQuality } = require("./imageQualityReview.service");
const { downloadRemoteImage, searchImages } = require("./imageSearch.service");
const { buildVisualPlan } = require("./visualPlan.service");

const parseBoolean = (value, fallback = false) => {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
};

const IMAGE_ATTEMPT_LIMIT = 3;

// Storage returns these for its own transient faults; a planned image is lost for
// good if one of them ends the attempt, so the upload is retried before giving up.
const TRANSIENT_UPLOAD_ERROR =
  /internalerror|backenderror|serviceunavailable|timeout|fetch failed|econnres|etimedout|econnrefused|socket hang up|network|und_err|eai_again|"code"\s*:\s*5\d\d/i;

const uploadImageWithRetry = async (
  params,
  { attempts = 3, uploadImpl = uploadImage, retryDelayMs = 1500 } = {},
) => {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await uploadImpl(params);
    } catch (error) {
      lastError = error;
      const retryable = TRANSIENT_UPLOAD_ERROR.test(
        `${error?.message || ""} ${error?.code || ""} ${error?.cause?.code || ""}`,
      );
      if (!retryable || attempt === attempts) throw lastError;
      await new Promise((resolve) =>
        setTimeout(resolve, attempt * retryDelayMs),
      );
    }
  }
  throw lastError;
};

const buildStorageFolder = (slug, date = new Date()) => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `blog/${year}/${month}/${slug}`;
};

const pendingMetadata = ({ planItem, prompt, seo, reason }) => ({
  imageId: crypto.randomUUID(),
  url: "",
  alt: seo.alt,
  title: seo.title,
  caption: seo.caption,
  width: Number(planItem.width) || 0,
  height: Number(planItem.height) || 0,
  mimeType: "",
  sizeBytes: 0,
  sourceType: "pending",
  sourceUrl: "",
  license: "",
  author: "",
  prompt: prompt.positivePrompt,
  model: "",
  checksum: "",
  status: "pending_generation",
  reviewStatus: "pending_review",
  warning: reason,
  ...(planItem.purpose === "inline"
    ? {
        afterHeading: planItem.afterHeading,
        headingIndex: planItem.headingIndex,
      }
    : {}),
});

// Auto-publish means the operator delegated the visual check up front, so an image
// that reached storage carries the approval a human would otherwise give by hand.
// One that never reached storage stays pending and still holds the article back.
const approveStoredImage = (image) => {
  if (!image?.url) return image;
  return {
    ...image,
    status: "complete",
    reviewStatus: "approved",
    qualityReview: {
      ...(image.qualityReview || {}),
      manualReviewRequired: false,
      autoApproved: true,
      reviewedAt: new Date().toISOString(),
    },
  };
};

const resolveSourceImage = async ({ planItem, prompt, warnings }) => {
  const query = planItem.imageSearchQuery
    ? planItem.imageSearchQuery
    : [planItem.articleTitle, planItem.afterHeading].filter(Boolean).join(" ");
  try {
    const search = await searchImages({ query, limit: 5 });
    if (search.reason) warnings.push(search.reason);
    for (const candidate of search.candidates || []) {
      // Unsplash requires API hotlinking, which conflicts with this pipeline's no-hotlink rule.
      if (candidate.provider === "unsplash") {
        warnings.push("unsplash_rehosting_not_permitted");
        continue;
      }
      try {
        const downloaded = await downloadRemoteImage(candidate.downloadUrl);
        const review = await reviewImageQuality({
          ...downloaded,
          planItem,
          positivePrompt: prompt.positivePrompt,
          candidate,
        });
        if (!review.passes) {
          warnings.push(...review.reasons);
          continue;
        }
        return {
          ...downloaded,
          candidate,
          sourceType: "licensed_search",
          provider: candidate.provider,
          model: "",
          manualReviewRequired: false,
          initialReview: review,
        };
      } catch (error) {
        warnings.push(error?.message || "image_search_candidate_failed");
      }
    }
  } catch (error) {
    warnings.push(error?.message || "image_search_failed");
  }

  try {
    const generated = await generateImage({ prompt });
    if (generated.reason) warnings.push(generated.reason);
    if (generated.status !== "complete") return null;
    const downloaded = generated.buffer
      ? { buffer: generated.buffer, mimeType: generated.mimeType }
      : await downloadRemoteImage(generated.downloadUrl);
    const review = await reviewImageQuality({
      ...downloaded,
      planItem,
      positivePrompt: prompt.positivePrompt,
    });
    if (!review.passes) {
      warnings.push(...review.reasons);
      return null;
    }
    return {
      ...downloaded,
      candidate: null,
      sourceType: "ai_generation",
      provider: generated.provider,
      model: generated.model || "",
      manualReviewRequired: true,
      initialReview: review,
    };
  } catch (error) {
    warnings.push(error?.message || "ai_image_generation_failed");
    return null;
  }
};

const acquirePlanItemImage = async ({
  planItem,
  slug,
  prompt,
  seo,
  warnings,
}) => {
  const source = await resolveSourceImage({ planItem, prompt, warnings });
  if (!source) return null;

  const optimized = await optimizeImage({
    buffer: source.buffer,
    purpose: planItem.purpose,
    width: planItem.width,
    height: planItem.height,
  });
  const finalReview = await reviewImageQuality({
    ...optimized,
    planItem,
    positivePrompt: prompt.positivePrompt,
    candidate: source.candidate,
    optimized: true,
  });
  if (!finalReview.passes) {
    warnings.push(...finalReview.reasons);
    throw new Error("optimized_image_failed_quality_review");
  }

  const fileName = buildImageFilename({
    slug,
    purpose: planItem.purpose,
    heading: planItem.afterHeading,
    index: planItem.headingIndex,
    extension: "webp",
  });
  const uploaded = await uploadImageWithRetry({
    file: {
      buffer: optimized.buffer,
      mimetype: optimized.mimeType,
      originalname: fileName,
    },
    folder: buildStorageFolder(slug),
    validation: {
      maxSizeBytes: Math.max(optimized.sizeBytes, 1),
      requireDimensions: false,
    },
    optimization: null,
  });

  return {
    imageId: crypto.randomUUID(),
    url: uploaded.url,
    path: uploaded.path,
    alt: seo.alt,
    title: seo.title,
    caption: seo.caption,
    width: optimized.width,
    height: optimized.height,
    mimeType: optimized.mimeType,
    sizeBytes: optimized.sizeBytes,
    sourceType: source.sourceType,
    sourceUrl: source.candidate?.sourceUrl || "",
    license: source.candidate?.license || "",
    author: source.candidate?.author || "",
    prompt: prompt.positivePrompt,
    model: source.model,
    checksum: optimized.checksum,
    status: source.manualReviewRequired ? "needs_review" : "complete",
    reviewStatus: "pending_review",
    qualityReview: {
      ...finalReview,
      manualReviewRequired: source.manualReviewRequired,
    },
    ...(planItem.purpose === "inline"
      ? {
          afterHeading: planItem.afterHeading,
          headingIndex: planItem.headingIndex,
        }
      : {}),
  };
};

// Every planned image is expected to end up in the article, so a plan item that
// comes back empty or unusable is attempted again before it is given up on.
const processPlanItem = async ({
  planItem,
  slug,
  primaryKeyword,
  warnings,
}) => {
  const prompt = buildImagePrompt(planItem);
  const seo = buildImageSeoMetadata({
    articleTitle: planItem.articleTitle,
    heading: planItem.afterHeading,
    primaryKeyword,
    purpose: planItem.purpose,
  });

  let lastReason = "no_image_provider_result";
  for (let attempt = 1; attempt <= IMAGE_ATTEMPT_LIMIT; attempt += 1) {
    try {
      const acquired = await acquirePlanItemImage({
        planItem,
        slug,
        prompt,
        seo,
        warnings,
      });
      if (acquired) return acquired;
      lastReason = "no_image_provider_result";
    } catch (error) {
      lastReason = error?.message || "image_attempt_failed";
      warnings.push(lastReason);
    }
  }
  return pendingMetadata({ planItem, prompt, seo, reason: lastReason });
};

const runImagePipeline = async ({
  title,
  slug,
  category,
  summary,
  outline,
  contentHtml,
  primaryKeyword,
  articleType,
  imageSearchQuery = "",
  editorialProductPlacement = null,
} = {}) => {
  const visualPlan = buildVisualPlan({
    title,
    slug,
    category,
    summary,
    outline,
    contentHtml,
    targetKeyword: primaryKeyword,
    articleType,
    editorialProductPlacement,
  });
  const planItems = [visualPlan.cover, ...visualPlan.inline];
  const normalizedImageQuery = String(imageSearchQuery || "").trim();
  for (const planItem of planItems)
    planItem.imageSearchQuery = normalizedImageQuery;
  const warnings = [];
  const enabled = parseBoolean(
    process.env.OPENCLAW_IMAGE_PIPELINE_ENABLED,
    false,
  );

  if (!enabled) {
    const pending = planItems.map((planItem) =>
      pendingMetadata({
        planItem,
        prompt: buildImagePrompt(planItem),
        seo: buildImageSeoMetadata({
          articleTitle: planItem.articleTitle,
          heading: planItem.afterHeading,
          primaryKeyword,
          purpose: planItem.purpose,
        }),
        reason: "image_pipeline_disabled",
      }),
    );
    return {
      visualPlan,
      coverImage: pending[0],
      contentImages: pending.slice(1),
      contentHtml,
      status: "pending",
      warnings: ["image_pipeline_disabled"],
      coverReadyForPublish: false,
      publishReady: true,
    };
  }

  const results = [];
  for (const planItem of planItems) {
    try {
      results.push(
        await processPlanItem({ planItem, slug, primaryKeyword, warnings }),
      );
    } catch (error) {
      warnings.push(error?.message || `${planItem.id}_image_pipeline_failed`);
      results.push(
        pendingMetadata({
          planItem,
          prompt: buildImagePrompt(planItem),
          seo: buildImageSeoMetadata({
            articleTitle: planItem.articleTitle,
            heading: planItem.afterHeading,
            primaryKeyword,
            purpose: planItem.purpose,
          }),
          reason: error?.message || "image_pipeline_failed",
        }),
      );
    }
  }

  const reviewed = parseBoolean(process.env.SEO_AGENT_AUTO_PUBLISH, false)
    ? results.map(approveStoredImage)
    : results;
  const coverImage = reviewed[0];
  const contentImages = reviewed.slice(1);
  const uploadedImages = reviewed.filter((item) => item.url);
  const completeImages = reviewed.filter((item) => item.status === "complete");
  const status =
    completeImages.length === reviewed.length
      ? "complete"
      : uploadedImages.length
        ? "partial"
        : reviewed.some((item) => item.status === "pending_generation")
          ? "pending"
          : "failed";
  const withInlineImages = insertInlineImages(
    contentHtml,
    contentImages.filter((item) => item.url),
  );

  return {
    visualPlan,
    coverImage,
    contentImages,
    contentHtml: sanitizeSeoBlogHtml(withInlineImages),
    status,
    warnings: [...new Set(warnings.filter(Boolean))],
    coverReadyForPublish:
      coverImage?.status === "complete" &&
      ["approved", "replaced"].includes(coverImage?.reviewStatus) &&
      coverImage?.qualityReview?.passes === true &&
      coverImage?.qualityReview?.manualReviewRequired !== true,
    publishReady:
      reviewed.length > 0 &&
      reviewed.every(
        (item) =>
          item.status === "complete" &&
          ["approved", "replaced"].includes(item.reviewStatus) &&
          item.qualityReview?.passes === true &&
          item.qualityReview?.manualReviewRequired !== true,
      ),
  };
};

module.exports = {
  IMAGE_ATTEMPT_LIMIT,
  approveStoredImage,
  buildStorageFolder,
  runImagePipeline,
  uploadImageWithRetry,
};
