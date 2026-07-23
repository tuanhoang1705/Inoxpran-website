"use strict";

const crypto = require("crypto");
const { blog } = require("../models/blog.model");
const {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} = require("../core/error.response");
const { convertToObjectIdMongodb } = require("../utils");
const { uploadImage } = require("./storage.service");
const { buildImageFilename } = require("../utils/imageFilename.util");
const { sanitizeSeoBlogHtml } = require("../utils/seoBlogSanitizer");
const {
  buildPromptSuggestions,
  findInlineImageHtmlTarget,
  normalizePostImages,
  replaceInlineImageHtml,
  resolveBlogSourceType,
  resolveImageTarget,
} = require("../utils/agenticImageReview.util");
const { NEGATIVE_PROMPT } = require("./openclaw/imagePromptBuilder.service");
const { generateImage } = require("./openclaw/aiImageGenerate.service");
const { optimizeImage } = require("./openclaw/imageOptimize.service");
const {
  downloadRemoteImage,
  resolvePexelsImage,
  searchPexelsImages,
} = require("./openclaw/imageSearch.service");
const { buildStorageFolder } = require("./openclaw/imagePipeline.service");

const hashPersistedBlogContent = (value) =>
  crypto
    .createHash("sha256")
    .update(String(value || ""))
    .digest("hex");

const parseTarget = (value) => {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(String(value || "{}"));
  } catch {
    throw new BadRequestError("Invalid image target");
  }
};

const parseSelection = (value) => {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(String(value || "{}"));
  } catch {
    throw new BadRequestError("Invalid replacement image selection");
  }
};

const resolveTarget = (post, target) => {
  try {
    return resolveImageTarget(post, target);
  } catch (error) {
    if (error?.code === "invalid_image_target") {
      throw new BadRequestError("Image targetType must be cover or inline");
    }
    if (error?.code === "inline_image_target_not_found") {
      throw new NotFoundError("Inline image metadata target was not found");
    }
    throw error;
  }
};

const validateInlineHtmlTarget = ({ html, target }) => {
  try {
    return findInlineImageHtmlTarget({ html, target });
  } catch (error) {
    if (error?.code === "inline_image_html_target_not_found") {
      throw new NotFoundError("Inline image was not found in the blog content");
    }
    throw error;
  }
};

const replaceInlineHtml = ({ html, target, replacement }) => {
  try {
    return replaceInlineImageHtml({ html, target, replacement });
  } catch (error) {
    if (error?.code === "inline_image_html_target_not_found") {
      throw new NotFoundError("Inline image was not found in the blog content");
    }
    throw error;
  }
};

const readDataImage = (dataUrl) => {
  const match = String(dataUrl || "").match(
    /^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=]+)$/i,
  );
  if (!match) throw new BadRequestError("Invalid generated image preview");
  const buffer = Buffer.from(match[2], "base64");
  const maxBytes =
    Number(process.env.IMAGE_MAX_SOURCE_FILE_SIZE_KB || 10240) * 1024;
  if (!buffer.length || buffer.length > maxBytes) {
    throw new BadRequestError("Generated image preview is too large");
  }
  return { buffer, mimeType: match[1].toLowerCase() };
};

const readLocalUpload = (file) => {
  if (!file?.buffer?.length) {
    throw new BadRequestError("Local image file is required");
  }
  if (!String(file.mimetype || "").toLowerCase().startsWith("image/")) {
    throw new BadRequestError("Only image files are allowed");
  }
  return {
    buffer: file.buffer,
    mimeType: String(file.mimetype || "image/jpeg").toLowerCase(),
    originalName: String(file.originalname || "local-upload").slice(0, 160),
    sizeBytes: Number(file.size) || file.buffer.length,
  };
};

const loadAgenticPost = async (blogId) => {
  const objectId = convertToObjectIdMongodb(blogId);
  if (!objectId) throw new BadRequestError("Invalid blog id");
  const post = await blog.findById(objectId).lean();
  if (!post) throw new NotFoundError("Blog not found");
  if (resolveBlogSourceType(post) !== "agentic") {
    throw new ForbiddenError(
      "Image review is only available for agentic blog posts",
    );
  }
  return post;
};

const toClientPost = (post) => {
  const normalized = normalizePostImages(post);
  return {
    id: String(post._id),
    sourceType: "agentic",
    coverImage: normalized.coverImage,
    contentImages: normalized.contentImages,
    content: post.blog_content,
    image: post.blog_image,
  };
};

const updateReviewStatus = ({ post, target, decision }) => {
  const resolved = resolveTarget(post, target);
  const normalized = normalizePostImages(post);
  const nextImage = {
    ...resolved.image,
    reviewStatus: decision,
    status: decision === "approved" ? "complete" : "rejected",
    warning: decision === "approved" ? "" : "manually_rejected",
    qualityReview: {
      ...(resolved.image.qualityReview || {}),
      manualApproved: decision === "approved",
      reviewedAt: new Date().toISOString(),
    },
  };
  if (resolved.type === "cover") {
    normalized.coverImage = nextImage;
  } else {
    normalized.contentImages[resolved.index] = nextImage;
  }
  return { resolved, normalized, nextImage };
};

const buildPlanItem = ({ post, resolved }) => ({
  purpose: resolved.type,
  articleTitle: post.blog_title,
  afterHeading: resolved.image.afterHeading,
  headingIndex: resolved.image.headingIndex,
  width:
    resolved.type === "cover" ? 1200 : Number(resolved.image.width) || 1200,
  height:
    resolved.type === "cover" ? 675 : Number(resolved.image.height) || 800,
  articleType: post.visualPlan?.articleType || "",
  visualRule:
    "Realistic editorial image directly relevant to the article section.",
});

const buildReplacementUpdate = ({
  post,
  resolved,
  parsedTarget,
  replacement,
}) => {
  const normalized = normalizePostImages(post);
  const set = {
    sourceType: "agentic",
    coverImage: normalized.coverImage,
    contentImages: normalized.contentImages,
  };
  if (resolved.type === "cover") {
    set.coverImage = replacement;
    set.blog_image = replacement.url;
    set.blog_image_path = replacement.path;
    return set;
  }

  const htmlTarget = {
    ...resolved.image,
    ...parsedTarget,
    type: "inline",
    imageIndex: resolved.index,
  };
  normalized.contentImages[resolved.index] = replacement;
  set.contentImages = normalized.contentImages;
  set.blog_content = sanitizeSeoBlogHtml(
    replaceInlineHtml({
      html: post.blog_content,
      target: htmlTarget,
      replacement,
    }),
  );
  set.contentRevisionHash = hashPersistedBlogContent(set.blog_content);
  return set;
};

class AgenticImageReviewService {
  static async getPromptSuggestions({ blogId, target }) {
    const post = await loadAgenticPost(blogId);
    const parsedTarget = parseTarget(target);
    const resolved = resolveTarget(post, parsedTarget);
    return {
      target: {
        type: resolved.type,
        imageId: resolved.image.imageId,
        headingIndex: resolved.image.headingIndex,
        afterHeading: resolved.image.afterHeading,
      },
      suggestions: buildPromptSuggestions({
        post,
        target: { ...parsedTarget, ...resolved.image },
      }),
    };
  }

  static async reviewImage({ blogId, target, decision }) {
    const normalizedDecision = String(decision || "")
      .trim()
      .toLowerCase();
    if (!["approved", "rejected"].includes(normalizedDecision)) {
      throw new BadRequestError("Invalid image review decision");
    }
    const post = await loadAgenticPost(blogId);
    const update = updateReviewStatus({
      post,
      target: parseTarget(target),
      decision: normalizedDecision,
    });
    const updated = await blog
      .findByIdAndUpdate(
        post._id,
        {
          $set: {
            sourceType: "agentic",
            coverImage: update.normalized.coverImage,
            contentImages: update.normalized.contentImages,
          },
        },
        { new: true },
      )
      .lean();
    return toClientPost(updated);
  }

  static async searchPexels({ blogId, target, query, page, perPage = 10 }) {
    const post = await loadAgenticPost(blogId);
    const parsedTarget = parseTarget(target);
    const resolved = resolveTarget(post, parsedTarget);
    const suggestions = buildPromptSuggestions({
      post,
      target: { ...parsedTarget, ...resolved.image },
    });
    const searchQuery =
      String(query || "").trim() ||
      String(resolved.image.afterHeading || post.blog_title || "").trim();
    const result = await searchPexelsImages({
      query: searchQuery,
      page,
      perPage,
    });
    return {
      ...result,
      query: searchQuery,
      candidates: (result.candidates || []).map((candidate) => ({
        assetId: candidate.providerAssetId,
        previewUrl: candidate.previewUrl,
        sourceUrl: candidate.sourceUrl,
        author: candidate.author,
        description: candidate.description,
        width: candidate.width,
        height: candidate.height,
      })),
      suggestions,
    };
  }

  static async generatePreview({ blogId, target, prompt }) {
    const post = await loadAgenticPost(blogId);
    const parsedTarget = parseTarget(target);
    resolveTarget(post, parsedTarget);
    const normalizedPrompt = String(prompt || "")
      .trim()
      .slice(0, 1800);
    if (normalizedPrompt.length < 20) {
      throw new BadRequestError(
        "Image prompt must contain at least 20 characters",
      );
    }
    const generated = await generateImage({
      prompt: {
        positivePrompt: normalizedPrompt,
        negativePrompt: NEGATIVE_PROMPT,
      },
    });
    if (generated.status !== "complete") {
      throw new BadRequestError(
        generated.reason || "AI image generation did not return an image",
      );
    }
    const source = generated.buffer
      ? { buffer: generated.buffer, mimeType: generated.mimeType }
      : await downloadRemoteImage(generated.downloadUrl);
    const optimized = await optimizeImage({
      buffer: source.buffer,
      purpose: parsedTarget.type === "cover" ? "cover" : "inline",
      width: parsedTarget.type === "cover" ? 1200 : 1200,
      height: parsedTarget.type === "cover" ? 675 : 800,
    });
    return {
      kind: "ai",
      prompt: normalizedPrompt,
      model: generated.model || "",
      provider: generated.provider,
      previewDataUrl: `data:${optimized.mimeType};base64,${optimized.buffer.toString("base64")}`,
      width: optimized.width,
      height: optimized.height,
      sizeBytes: optimized.sizeBytes,
      checksum: optimized.checksum,
    };
  }

  static async replaceImage({ blogId, target, selection, file }) {
    const post = await loadAgenticPost(blogId);
    const parsedTarget = parseTarget(target);
    const parsedSelection = parseSelection(selection);
    const resolved = resolveTarget(post, parsedTarget);
    const purpose = resolved.type === "cover" ? "cover" : "inline";
    const htmlTarget = {
      ...resolved.image,
      ...parsedTarget,
      type: "inline",
      imageIndex: resolved.index,
    };
    if (resolved.type === "inline") {
      validateInlineHtmlTarget({
        html: post.blog_content,
        target: htmlTarget,
      });
    }
    let source;
    let sourceMetadata;

    if (parsedSelection.kind === "ai") {
      source = readDataImage(parsedSelection.previewDataUrl);
      sourceMetadata = {
        sourceType: "ai_generation",
        sourceUrl: "",
        license: "",
        author: "",
        prompt: String(parsedSelection.prompt || "").slice(0, 1800),
        model: String(parsedSelection.model || ""),
      };
    } else if (parsedSelection.kind === "pexels") {
      const candidate = await resolvePexelsImage(parsedSelection.assetId);
      source = await downloadRemoteImage(candidate.downloadUrl);
      sourceMetadata = {
        sourceType: "licensed_search",
        sourceUrl: candidate.sourceUrl,
        license: candidate.license,
        author: candidate.author,
        prompt: "",
        model: "",
      };
    } else if (parsedSelection.kind === "local_upload") {
      const uploadedSource = readLocalUpload(file);
      source = uploadedSource;
      sourceMetadata = {
        sourceType: "manual_upload",
        sourceUrl: "",
        license: "",
        author: "",
        prompt: "",
        model: "",
        originalFileName: uploadedSource.originalName,
      };
    } else {
      throw new BadRequestError("Invalid replacement image selection");
    }

    const planItem = buildPlanItem({ post, resolved });
    const optimized = await optimizeImage({
      buffer: source.buffer,
      purpose,
      width: planItem.width,
      height: planItem.height,
    });
    const fileName = buildImageFilename({
      slug: post.blog_slug,
      purpose,
      heading: resolved.image.afterHeading,
      index: resolved.image.headingIndex,
      extension: "webp",
    });
    const uploaded = await uploadImage({
      file: {
        buffer: optimized.buffer,
        mimetype: optimized.mimeType,
        originalname: fileName,
      },
      folder: buildStorageFolder(post.blog_slug),
      validation: {
        maxSizeBytes: Math.max(optimized.sizeBytes, 1),
        requireDimensions: false,
      },
      optimization: null,
    });

    const replacement = {
      ...resolved.image,
      ...sourceMetadata,
      url: uploaded.url,
      path: uploaded.path,
      width: optimized.width,
      height: optimized.height,
      mimeType: optimized.mimeType,
      sizeBytes: optimized.sizeBytes,
      checksum: optimized.checksum,
      status: "complete",
      reviewStatus: "replaced",
      warning: "",
      replacementMetadata: {
        previousUrl: resolved.image.url,
        replacedAt: new Date().toISOString(),
        replacementSource: parsedSelection.kind,
        ...(sourceMetadata.originalFileName
          ? { originalFileName: sourceMetadata.originalFileName }
          : {}),
      },
      qualityReview: {
        passes: true,
        manualApproved: true,
        reviewedAt: new Date().toISOString(),
      },
    };
    const set = buildReplacementUpdate({
      post,
      resolved,
      parsedTarget: htmlTarget,
      replacement,
    });
    const updated = await blog
      .findByIdAndUpdate(post._id, { $set: set }, { new: true })
      .lean();
    return toClientPost(updated);
  }
}

module.exports = AgenticImageReviewService;
module.exports._test = {
  buildReplacementUpdate,
  parseTarget,
  parseSelection,
  readDataImage,
  readLocalUpload,
  resolveTarget,
  updateReviewStatus,
  validateInlineHtmlTarget,
};
