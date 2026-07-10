"use strict";

const crypto = require("node:crypto");
const sanitizeHtml = require("sanitize-html");

const REVIEW_STATUSES = new Set([
  "pending_review",
  "approved",
  "rejected",
  "replaced",
]);

const createTargetError = (code) => {
  const error = new Error(code);
  error.code = code;
  return error;
};

const decodeHtmlAttribute = (value) =>
  String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");

const normalizeComparableUrl = (value) => {
  const decoded = decodeHtmlAttribute(value).trim();
  if (!decoded) return "";
  try {
    const parsed = new URL(decoded);
    return `${parsed.protocol}//${parsed.hostname}${decodeURIComponent(parsed.pathname)}${parsed.search}`;
  } catch {
    return decoded;
  }
};

const normalizeUrlPath = (value) => {
  const decoded = decodeHtmlAttribute(value).trim();
  if (!decoded) return "";
  try {
    const parsed = new URL(decoded);
    return `${parsed.hostname}${decodeURIComponent(parsed.pathname)}`;
  } catch {
    return decoded.split("?")[0];
  }
};

const normalizeText = (value, maxLength = 240) =>
  sanitizeHtml(String(value || ""), { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);

const buildImageId = ({
  purpose = "inline",
  url = "",
  headingIndex = -1,
  index = 0,
} = {}) => {
  if (purpose === "cover") return "cover";
  const digest = crypto
    .createHash("sha256")
    .update(`${url}|${headingIndex}|${index}`)
    .digest("hex")
    .slice(0, 16);
  return `inline-${digest}`;
};

const resolveBlogSourceType = (post = {}) => {
  if (post.sourceType === "agentic") return "agentic";
  if (post.sourceType === "manual") return "manual";
  return post.visualPlan ||
    post.generationMetadata?.provider === "openclaw" ||
    (Array.isArray(post.contentImages) && post.contentImages.length > 0) ||
    ["ai_generation", "licensed_search"].includes(post.coverImage?.sourceType)
    ? "agentic"
    : "manual";
};

const LEGACY_AGENTIC_FILTERS = [
  { visualPlan: { $nin: [null, {}] } },
  { "generationMetadata.provider": "openclaw" },
  { "contentImages.0": { $exists: true } },
  { "coverImage.sourceType": { $in: ["ai_generation", "licensed_search"] } },
];

const buildBlogSourceFilter = (source) => {
  if (source === "agentic") {
    return {
      $or: [
        { sourceType: "agentic" },
        {
          $and: [
            { sourceType: { $nin: ["manual", "agentic"] } },
            { $or: LEGACY_AGENTIC_FILTERS },
          ],
        },
      ],
    };
  }
  if (source === "manual") {
    return {
      $or: [
        { sourceType: "manual" },
        {
          $and: [
            { sourceType: { $nin: ["manual", "agentic"] } },
            { $nor: LEGACY_AGENTIC_FILTERS },
          ],
        },
      ],
    };
  }
  return null;
};

const normalizeImageMetadata = (
  image = {},
  { purpose = "inline", index = 0 } = {},
) => ({
  ...image,
  imageId:
    image.imageId ||
    buildImageId({
      purpose,
      url: image.url,
      headingIndex: image.headingIndex,
      index,
    }),
  reviewStatus: REVIEW_STATUSES.has(image.reviewStatus)
    ? image.reviewStatus
    : image.status === "rejected"
      ? "rejected"
      : image.status === "complete" &&
          image.qualityReview?.manualApproved === true
        ? "approved"
        : "pending_review",
});

const normalizePostImages = (post = {}) => ({
  coverImage: normalizeImageMetadata(post.coverImage || {}, {
    purpose: "cover",
  }),
  contentImages: (Array.isArray(post.contentImages)
    ? post.contentImages
    : []
  ).map((image, index) =>
    normalizeImageMetadata(image, { purpose: "inline", index }),
  ),
});

const areAgenticImagesReviewed = (post = {}) => {
  if (resolveBlogSourceType(post) !== "agentic") return true;
  const normalized = normalizePostImages(post);
  const images = [normalized.coverImage, ...normalized.contentImages].filter(
    (image) => image.url,
  );
  return (
    images.length > 0 &&
    images.every((image) =>
      ["approved", "replaced"].includes(image.reviewStatus),
    )
  );
};

const resolveImageTarget = (post = {}, target = {}) => {
  const type = String(target.type || target.targetType || "")
    .trim()
    .toLowerCase();
  const normalized = normalizePostImages(post);
  if (type === "cover") {
    return { type: "cover", index: -1, image: normalized.coverImage };
  }
  if (type !== "inline") throw createTargetError("invalid_image_target");

  const imageId = String(target.imageId || "").trim();
  const candidateUrls = [target.currentSrc, target.oldSrc, target.url]
    .map(normalizeComparableUrl)
    .filter(Boolean);
  const headingIndex = Number(target.headingIndex);
  const imageIndex = Number(target.imageIndex);
  let index = normalized.contentImages.findIndex(
    (image) => imageId && image.imageId === imageId,
  );
  if (index < 0) {
    index = normalized.contentImages.findIndex(
      (image) =>
        candidateUrls.includes(normalizeComparableUrl(image.url)) &&
        (!Number.isFinite(headingIndex) ||
          Number(image.headingIndex) === headingIndex),
    );
  }
  if (
    index < 0 &&
    Number.isInteger(imageIndex) &&
    imageIndex >= 0 &&
    imageIndex < normalized.contentImages.length
  ) {
    index = imageIndex;
  }
  if (index < 0) throw createTargetError("inline_image_target_not_found");
  return { type: "inline", index, image: normalized.contentImages[index] };
};

const readTagAttribute = (tag, name) => {
  const expression = new RegExp(`\\b${name}=(["'])(.*?)\\1`, "i");
  return decodeHtmlAttribute(tag.match(expression)?.[2] || "");
};

const findInlineImageHtmlTarget = ({ html, target = {} }) => {
  const source = String(html || "");
  const tags = [...source.matchAll(/<img\b[^>]*>/gi)];
  const imageId = String(target.imageId || "").trim();
  const candidateUrls = [target.currentSrc, target.oldSrc, target.url]
    .map(normalizeComparableUrl)
    .filter(Boolean);
  const candidatePaths = [target.currentSrc, target.oldSrc, target.url]
    .map(normalizeUrlPath)
    .filter(Boolean);

  let tagIndex = tags.findIndex((match) => {
    const tag = match[0];
    if (imageId && readTagAttribute(tag, "data-image-id") === imageId)
      return true;
    const src = readTagAttribute(tag, "src");
    return (
      candidateUrls.includes(normalizeComparableUrl(src)) ||
      candidatePaths.includes(normalizeUrlPath(src))
    );
  });
  const imageIndex = Number(target.imageIndex);
  if (
    tagIndex < 0 &&
    Number.isInteger(imageIndex) &&
    imageIndex >= 0 &&
    imageIndex < tags.length
  ) {
    tagIndex = imageIndex;
  }
  if (tagIndex < 0)
    throw createTargetError("inline_image_html_target_not_found");
  const match = tags[tagIndex];
  return {
    tag: match[0],
    tagIndex,
    start: Number(match.index),
    end: Number(match.index) + match[0].length,
    currentSrc: readTagAttribute(match[0], "src"),
  };
};

const replaceInlineImageHtml = ({ html, target, replacement }) => {
  const source = String(html || "");
  const located = findInlineImageHtmlTarget({ html: source, target });
  let nextTag = located.tag.replace(
    /\bsrc=(["']).*?\1/i,
    `src="${String(replacement.url || "").replace(/"/g, "&quot;")}"`,
  );
  if (/\bdata-image-id=(["']).*?\1/i.test(nextTag)) {
    nextTag = nextTag.replace(
      /\bdata-image-id=(["']).*?\1/i,
      `data-image-id="${replacement.imageId}"`,
    );
  } else {
    nextTag = nextTag.replace(/>$/, ` data-image-id="${replacement.imageId}">`);
  }
  if (replacement.alt && /\balt=(["']).*?\1/i.test(nextTag)) {
    nextTag = nextTag.replace(
      /\balt=(["']).*?\1/i,
      `alt="${String(replacement.alt).replace(/"/g, "&quot;")}"`,
    );
  } else if (replacement.alt) {
    nextTag = nextTag.replace(
      />$/,
      ` alt="${String(replacement.alt).replace(/"/g, "&quot;")}">`,
    );
  }
  return `${source.slice(0, located.start)}${nextTag}${source.slice(located.end)}`;
};

const extractHeadings = (html) =>
  [...String(html || "").matchAll(/<h[2-4]\b[^>]*>([\s\S]*?)<\/h[2-4]>/gi)]
    .map((match) => normalizeText(match[1], 140))
    .filter(Boolean);

const buildPromptSuggestions = ({ post = {}, target = {} } = {}) => {
  const title = normalizeText(post.blog_title || post.title, 140);
  const summary = normalizeText(post.blog_excerpt || post.excerpt, 200);
  const headings = extractHeadings(post.blog_content || post.content);
  const headingIndex = Number(target.headingIndex);
  const section = normalizeText(
    target.afterHeading ||
      (Number.isFinite(headingIndex) ? headings[headingIndex] : "") ||
      headings[0] ||
      title,
    140,
  );
  const subject = target.type === "cover" ? title : section;
  return [
    `Ảnh editorial chân thực minh họa "${subject}", bếp gia đình Việt Nam, dụng cụ inox đúng tỷ lệ, ánh sáng cửa sổ tự nhiên, bố cục ngang, không chữ, không logo.`,
    `Cảnh thao tác thực tế cho "${subject}", tập trung vào bàn tay và bề mặt inox, vật liệu chân thực, ánh sáng ban ngày, phong cách ảnh hướng dẫn, không nhãn hiệu.`,
    `Ảnh cận cảnh giàu thông tin về "${subject}", bối cảnh ${summary || title}, màu sắc trung tính, chi tiết rõ, không chữ trong ảnh, không watermark.`,
  ];
};

module.exports = {
  areAgenticImagesReviewed,
  buildBlogSourceFilter,
  buildImageId,
  buildPromptSuggestions,
  findInlineImageHtmlTarget,
  normalizeImageMetadata,
  normalizePostImages,
  replaceInlineImageHtml,
  resolveBlogSourceType,
  resolveImageTarget,
};
