import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import crypto from "node:crypto";
import {
  getAdminBlogCategoryTranslationKey,
  getAdminBlogSourceTranslationKey,
  isAgenticBlog,
} from "../../frontend/src/lib/utils/adminBlogPresentation.js";
import {
  defaultLocale as adminDefaultLocale,
  messages as adminMessages,
} from "../../frontend/src/lib/i18n/admin/messages.js";

const require = createRequire(import.meta.url);
const {
  areAgenticImagesReviewed,
  buildBlogSourceFilter,
  buildPromptSuggestions,
  findInlineImageHtmlTarget,
  normalizePostImages,
  replaceInlineImageHtml,
  resolveBlogSourceType,
  resolveImageTarget,
} = require("../src/utils/agenticImageReview.util");
const {
  searchPexelsImages,
} = require("../src/services/openclaw/imageSearch.service");
const AgenticImageReviewService = require("../src/services/agenticImageReview.service");

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = global.fetch;

const post = {
  sourceType: "agentic",
  blog_title: "Cách vệ sinh nồi inox bị ố vàng",
  blog_excerpt: "Phân loại vết bẩn và làm sạch nồi inox an toàn.",
  blog_content: [
    "<h2>Phân loại vết bẩn</h2>",
    "<p>Kiểm tra vết ố trước khi vệ sinh.</p>",
    '<img src="https://cdn.example.com/stain.webp" data-image-id="inline-stain" alt="Nồi inox bị ố">',
    "<h2>Làm sạch bằng khăn mềm</h2>",
  ].join(""),
  visualPlan: { articleType: "product_care" },
  coverImage: {
    imageId: "cover",
    url: "https://cdn.example.com/cover.webp",
    status: "needs_review",
  },
  contentImages: [
    {
      imageId: "inline-stain",
      url: "https://cdn.example.com/stain.webp",
      headingIndex: 0,
      afterHeading: "Phân loại vết bẩn",
      status: "complete",
    },
  ],
};

beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    IMAGE_SEARCH_PROVIDER: "pexels",
    IMAGE_SEARCH_API_KEY: "test-pexels-key",
  };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  global.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

describe("agentic/manual feature visibility", () => {
  it("marks explicit and legacy automation posts as agentic", () => {
    expect(resolveBlogSourceType(post)).toBe("agentic");
    expect(resolveBlogSourceType({ visualPlan: { cover: {} } })).toBe(
      "agentic",
    );
  });

  it("keeps manual posts outside the image review workflow", () => {
    expect(
      resolveBlogSourceType({ sourceType: "manual", contentImages: [] }),
    ).toBe("manual");
    expect(resolveBlogSourceType({ blog_title: "Bài viết thủ công" })).toBe(
      "manual",
    );
    expect(areAgenticImagesReviewed({ sourceType: "manual" })).toBe(true);
  });

  it("blocks agentic publishing until every persisted image is reviewed", () => {
    expect(areAgenticImagesReviewed(post)).toBe(false);
    expect(
      areAgenticImagesReviewed({
        ...post,
        coverImage: { ...post.coverImage, reviewStatus: "approved" },
        contentImages: [{ ...post.contentImages[0], reviewStatus: "replaced" }],
      }),
    ).toBe(true);
  });

  it("builds backward-compatible source filters", () => {
    expect(buildBlogSourceFilter("agentic").$or[0]).toEqual({
      sourceType: "agentic",
    });
    expect(buildBlogSourceFilter("manual").$or[0]).toEqual({
      sourceType: "manual",
    });
    expect(buildBlogSourceFilter("all")).toBeNull();
  });
});

describe("image identity and review transitions", () => {
  it("resolves an inline image by stable id before URL fallback", () => {
    const target = resolveImageTarget(post, {
      type: "inline",
      imageId: "inline-stain",
      url: "https://wrong.example/image.webp",
    });
    expect(target.index).toBe(0);
    expect(target.image.afterHeading).toBe("Phân loại vết bẩn");
  });

  it("normalizes legacy image review states without changing the source post", () => {
    const normalized = normalizePostImages({
      coverImage: { url: "cover.webp", status: "complete" },
      contentImages: [
        { url: "inline.webp", status: "rejected", headingIndex: 1 },
      ],
    });
    expect(normalized.coverImage.imageId).toBe("cover");
    expect(normalized.coverImage.reviewStatus).toBe("pending_review");
    expect(normalized.contentImages[0].reviewStatus).toBe("rejected");
  });

  it("transitions only the selected inline image to approved", () => {
    const updated = AgenticImageReviewService._test.updateReviewStatus({
      post,
      target: { type: "inline", imageId: "inline-stain" },
      decision: "approved",
    });
    expect(updated.nextImage.reviewStatus).toBe("approved");
    expect(updated.nextImage.status).toBe("complete");
    expect(updated.normalized.coverImage.reviewStatus).toBe("pending_review");
  });

  it("supports cover targets and rejected images remain targetable", () => {
    expect(resolveImageTarget(post, { targetType: "cover" })).toMatchObject({
      type: "cover",
      index: -1,
    });
    const rejected = AgenticImageReviewService._test.updateReviewStatus({
      post,
      target: { type: "inline", imageId: "inline-stain" },
      decision: "rejected",
    });
    expect(rejected.nextImage.reviewStatus).toBe("rejected");
    expect(
      resolveImageTarget(
        { ...post, contentImages: [rejected.nextImage] },
        { type: "inline", imageId: "inline-stain" },
      ).index,
    ).toBe(0);
  });

  it("returns controlled client errors for invalid and missing targets", () => {
    expect(() =>
      AgenticImageReviewService._test.parseSelection("{invalid-json"),
    ).toThrowError(expect.objectContaining({ status: 400 }));
    expect(() =>
      AgenticImageReviewService._test.resolveTarget(post, {
        type: "video",
      }),
    ).toThrowError(expect.objectContaining({ status: 400 }));
    expect(() =>
      AgenticImageReviewService._test.validateInlineHtmlTarget({
        html: "<p>No image here</p>",
        target: { type: "inline", imageIndex: 0 },
      }),
    ).toThrowError(expect.objectContaining({ status: 404 }));
  });

  it("validates local upload replacement files before optimization", () => {
    expect(() =>
      AgenticImageReviewService._test.readLocalUpload(null),
    ).toThrowError(expect.objectContaining({ status: 400 }));
    expect(() =>
      AgenticImageReviewService._test.readLocalUpload({
        buffer: Buffer.from("not-an-image"),
        mimetype: "text/plain",
        originalname: "notes.txt",
      }),
    ).toThrowError(expect.objectContaining({ status: 400 }));
    expect(
      AgenticImageReviewService._test.readLocalUpload({
        buffer: Buffer.from([1, 2, 3]),
        mimetype: "image/png",
        originalname: "local-cover.png",
        size: 3,
      }),
    ).toMatchObject({
      mimeType: "image/png",
      originalName: "local-cover.png",
      sizeBytes: 3,
    });
  });
});

describe("prompt suggestions and exact replacement", () => {
  it("uses article context for cover and nearest heading for inline prompts", () => {
    const cover = buildPromptSuggestions({ post, target: { type: "cover" } });
    const inline = buildPromptSuggestions({
      post,
      target: {
        type: "inline",
        headingIndex: 0,
        afterHeading: "Phân loại vết bẩn",
      },
    });
    expect(cover[0]).toContain("Cách vệ sinh nồi inox bị ố vàng");
    expect(inline[0]).toContain("Phân loại vết bẩn");
    expect(inline).toHaveLength(3);
  });

  it("replaces only the matching inline img and preserves surrounding HTML", () => {
    const html = `${post.blog_content}<img src="https://cdn.example.com/other.webp">`;
    const replaced = replaceInlineImageHtml({
      html,
      target: post.contentImages[0],
      replacement: {
        imageId: "inline-stain",
        url: "https://cdn.example.com/replacement.webp",
        alt: "Nồi inox sạch",
      },
    });
    expect(replaced).toContain(
      'src="https://cdn.example.com/replacement.webp"',
    );
    expect(replaced).toContain('alt="Nồi inox sạch"');
    expect(replaced).toContain('src="https://cdn.example.com/other.webp"');
    expect(replaced).not.toContain('src="https://cdn.example.com/stain.webp"');
  });

  it("repairs legacy metadata mismatch by using currentSrc and imageIndex", () => {
    const legacyHtml = [
      '<figure><img src="https://cdn.example.com/live-first.webp"><figcaption>Keep first caption</figcaption></figure>',
      '<figure><img src="https://cdn.example.com/live-second.webp"><figcaption>Keep second caption</figcaption></figure>',
    ].join("");
    const located = findInlineImageHtmlTarget({
      html: legacyHtml,
      target: {
        imageId: "legacy-id-not-in-html",
        url: "https://cdn.example.com/stale-metadata.webp",
        currentSrc: "https://cdn.example.com/live-second.webp",
        imageIndex: 1,
      },
    });
    expect(located.tagIndex).toBe(1);

    const replaced = replaceInlineImageHtml({
      html: legacyHtml,
      target: {
        imageId: "legacy-id-not-in-html",
        url: "https://cdn.example.com/stale-metadata.webp",
        currentSrc: "https://cdn.example.com/live-second.webp",
        imageIndex: 1,
      },
      replacement: {
        imageId: "legacy-id-not-in-html",
        url: "https://cdn.example.com/repaired.webp",
      },
    });
    expect(replaced).toContain("live-first.webp");
    expect(replaced).toContain("Keep first caption");
    expect(replaced).toContain("Keep second caption");
    expect(replaced).toContain("repaired.webp");
    expect(replaced).not.toContain("live-second.webp");
  });

  it("builds a persisted cover replacement update", () => {
    const resolved = resolveImageTarget(post, { type: "cover" });
    const replacement = {
      ...resolved.image,
      url: "https://cdn.example.com/new-cover.webp",
      path: "blog/new-cover.webp",
      reviewStatus: "replaced",
    };
    const update = AgenticImageReviewService._test.buildReplacementUpdate({
      post,
      resolved,
      parsedTarget: { type: "cover" },
      replacement,
    });
    expect(update.blog_image).toBe(replacement.url);
    expect(update.blog_image_path).toBe(replacement.path);
    expect(update.coverImage.reviewStatus).toBe("replaced");
  });

  it("builds a persisted inline replacement update without changing the cover", () => {
    const staleContentRevisionHash = crypto
      .createHash("sha256")
      .update(post.blog_content)
      .digest("hex");
    const resolved = resolveImageTarget(post, {
      type: "inline",
      imageId: "inline-stain",
    });
    const replacement = {
      ...resolved.image,
      url: "https://storage.googleapis.com/inoxpran/new-inline.webp",
      reviewStatus: "replaced",
    };
    const update = AgenticImageReviewService._test.buildReplacementUpdate({
      post,
      resolved,
      parsedTarget: {
        type: "inline",
        imageId: "inline-stain",
        currentSrc: "https://cdn.example.com/stain.webp",
        imageIndex: 0,
      },
      replacement,
    });
    expect(update.coverImage.url).toBe(post.coverImage.url);
    expect(update.contentImages[0].reviewStatus).toBe("replaced");
    expect(update.blog_content).toContain("new-inline.webp");
    expect(update.blog_content).toContain('data-image-id="inline-stain"');
    expect(update.contentRevisionHash).toBe(
      crypto.createHash("sha256").update(update.blog_content).digest("hex"),
    );
    expect(update.contentRevisionHash).not.toBe(staleContentRevisionHash);
  });
});

describe("admin blog presentation i18n", () => {
  const resolve = (dictionary, key) =>
    key.split(".").reduce((value, part) => value?.[part], dictionary);
  const translate = (locale, key) =>
    resolve(adminMessages[locale], key) ??
    resolve(adminMessages[adminDefaultLocale], key) ??
    key;

  it.each([
    ["vi", "guide", "Hướng dẫn"],
    ["vi", "care", "Chăm sóc & bảo quản"],
    ["vi", "product", "Sản phẩm"],
    ["en", "guide", "Guide"],
    ["en", "care", "Care & Maintenance"],
    ["en", "product", "Product"],
    ["vi", "legacy-unknown", "Khác"],
    ["en", "legacy-unknown", "Other"],
  ])(
    "maps %s category %s to a readable label",
    (locale, category, expected) => {
      const key = getAdminBlogCategoryTranslationKey(category);
      const label = translate(locale, key);
      expect(label).toBe(expected);
      expect(label).not.toMatch(/^blog\./);
    },
  );

  it("maps Agentic/manual badges in both languages without raw keys", () => {
    const agentic = { sourceType: "agentic" };
    const manual = {};
    expect(isAgenticBlog(agentic)).toBe(true);
    expect(isAgenticBlog(manual)).toBe(false);
    expect(translate("vi", getAdminBlogSourceTranslationKey(agentic))).toBe(
      "Agentic",
    );
    expect(translate("vi", getAdminBlogSourceTranslationKey(manual))).toBe(
      "Thủ công",
    );
    expect(translate("en", getAdminBlogSourceTranslationKey(manual))).toBe(
      "Manual",
    );
    expect(translate("vi", "admin.blogs.readTimeValue")).not.toBe(
      "blog.readTime",
    );
  });
});

describe("Pexels pagination", () => {
  it("requests ten landscape results for the requested page and exposes load-more state", async () => {
    global.fetch = vi.fn(async (url, options) => {
      const parsed = new URL(url);
      expect(parsed.searchParams.get("page")).toBe("2");
      expect(parsed.searchParams.get("per_page")).toBe("10");
      expect(parsed.searchParams.get("orientation")).toBe("landscape");
      expect(options.headers.Authorization).toBe("test-pexels-key");
      return {
        ok: true,
        json: async () => ({
          page: 2,
          per_page: 10,
          total_results: 24,
          next_page: "https://api.pexels.com/v1/search?page=3",
          photos: [
            {
              id: 42,
              url: "https://www.pexels.com/photo/42",
              photographer: "Test Photographer",
              width: 1200,
              height: 800,
              alt: "Stainless cookware",
              src: {
                medium: "https://images.pexels.com/photos/42/medium.jpeg",
                original: "https://images.pexels.com/photos/42/original.jpeg",
              },
            },
          ],
        }),
      };
    });

    const result = await searchPexelsImages({
      query: "stainless cookware",
      page: 2,
      perPage: 10,
    });
    expect(result.page).toBe(2);
    expect(result.perPage).toBe(10);
    expect(result.hasMore).toBe(true);
    expect(result.candidates[0]).toMatchObject({
      providerAssetId: "42",
      author: "Test Photographer",
    });
  });
});
