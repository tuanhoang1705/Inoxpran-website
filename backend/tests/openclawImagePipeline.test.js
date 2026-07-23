import { beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sharp = require("sharp");
const { buildImageFilename } = require("../src/utils/imageFilename.util");
const {
  buildImageSeoMetadata,
  insertInlineImages,
  isKeywordStuffed,
} = require("../src/utils/imageSeo.util");
const { sanitizeSeoBlogHtml } = require("../src/utils/seoBlogSanitizer");
const {
  generateImage,
} = require("../src/services/openclaw/aiImageGenerate.service");
const {
  runImagePipeline,
} = require("../src/services/openclaw/imagePipeline.service");
const {
  buildImagePrompt,
} = require("../src/services/openclaw/imagePromptBuilder.service");
const {
  optimizeImage,
} = require("../src/services/openclaw/imageOptimize.service");
const {
  searchImages,
} = require("../src/services/openclaw/imageSearch.service");
const {
  buildVisualPlan,
  detectArticleType,
} = require("../src/services/openclaw/visualPlan.service");

const ORIGINAL_ENV = { ...process.env };

const contentHtml = [
  "<section>",
  "<h2>Phan loai vet ban</h2><p>Noi dung phan loai.</p>",
  "<h2>Lau bang khan mem</h2><p>Noi dung ve sinh.</p>",
  "<h2>Rua lai bang nuoc am</h2><p>Noi dung hoan tat.</p>",
  "</section>",
].join("");

beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    OPENCLAW_IMAGE_PIPELINE_ENABLED: "false",
    IMAGE_SEARCH_PROVIDER: "disabled",
    AI_IMAGE_PROVIDER: "disabled",
    IMAGE_MAX_INLINE_COUNT: "4",
  };
});

describe("visual plan", () => {
  it.each([
    ["Cach ve sinh noi inox bi o vang", "product_care"],
    ["Top 10 thiet bi gia dung thong minh", "listicle"],
    ["Huong dan chon mua noi inox cho gia dinh", "buying_guide"],
    ["So sanh inox 304 va inox 201", "comparison"],
    ["Cach nau com bang noi inox", "how_to"],
  ])("detects %s as %s", (title, expected) => {
    expect(detectArticleType({ title })).toBe(expected);
  });

  it("creates one cover and a bounded set of heading-linked inline plans", () => {
    const plan = buildVisualPlan({
      title: "Cach ve sinh noi inox bi o vang",
      slug: "cach-ve-sinh-noi-inox",
      contentHtml,
    });

    expect(plan.cover).toMatchObject({
      purpose: "cover",
      masterWidth: 1600,
      masterHeight: 900,
      width: 1200,
      height: 675,
    });
    expect(plan.inline.length).toBeGreaterThanOrEqual(2);
    expect(plan.inline.length).toBeLessThanOrEqual(4);
    expect(plan.inline[0]).toHaveProperty("headingIndex");
  });

  it("anchors inline plans to actual HTML headings before outline hints", () => {
    const plan = buildVisualPlan({
      title: "Cach ve sinh noi inox",
      slug: "cach-ve-sinh-noi-inox",
      outline: ["Heading khong ton tai", "Heading cung khong ton tai"],
      contentHtml,
    });

    expect(plan.inline[0].afterHeading).toBe("Phan loai vet ban");
  });
});

describe("image SEO utilities", () => {
  it("normalizes a Vietnamese slug into a purpose-based WebP filename", () => {
    expect(
      buildImageFilename({
        slug: "Cach ve sinh noi inox bi o vang",
        purpose: "inline",
        heading: "Lau bang khan mem",
      }),
    ).toBe("cach-ve-sinh-noi-inox-bi-o-vang-lau-bang-khan-mem.webp");
  });

  it("avoids keyword stuffing in generated alt text", () => {
    const metadata = buildImageSeoMetadata({
      articleTitle: "Cach chon noi inox 304",
      heading: "Kiem tra day noi",
      primaryKeyword: "noi inox 304",
      purpose: "inline",
    });

    expect(isKeywordStuffed(metadata.alt, "noi inox 304")).toBe(false);
    expect(metadata.alt.length).toBeLessThanOrEqual(160);
  });

  it("inserts a semantic figure after the selected heading only once", () => {
    const result = insertInlineImages(contentHtml, [
      {
        url: "/images/test.webp",
        alt: "Khan mem lau noi inox",
        title: "Lau bang khan mem",
        caption: "Lau nhe bang khan mem.",
        width: 1200,
        height: 800,
        headingIndex: 1,
      },
    ]);

    expect(result.indexOf("Lau bang khan mem")).toBeLessThan(
      result.indexOf("<figure>"),
    );
    expect(result.match(/<figure>/g)).toHaveLength(1);
    expect(
      insertInlineImages(result, [
        {
          url: "/images/test.webp",
          headingIndex: 1,
        },
      ]).match(/<figure>/g),
    ).toHaveLength(1);
  });

  it("keeps safe figure attributes and removes scripts and event handlers", () => {
    const result = sanitizeSeoBlogHtml(
      '<figure onclick="bad()"><img src="/images/test.webp" alt="Noi inox" width="1200" height="800" loading="lazy" decoding="async" onerror="bad()"><figcaption>Anh minh hoa</figcaption><script>bad()</script></figure>',
    );

    expect(result).toContain("<figure>");
    expect(result).toContain("<figcaption>Anh minh hoa</figcaption>");
    expect(result).toContain('loading="lazy"');
    expect(result).not.toContain("onclick");
    expect(result).not.toContain("onerror");
    expect(result).not.toContain("<script>");
  });
});

describe("provider and pipeline fallback", () => {
  it("builds realistic prompts with explicit negative guardrails", () => {
    const prompt = buildImagePrompt({
      purpose: "cover",
      articleTitle: "Cach ve sinh noi inox bi o vang",
      articleType: "product_care",
      visualRule: "Show practical cleaning steps.",
    });

    expect(prompt.positivePrompt).toContain(
      "Realistic Vietnamese home kitchen",
    );
    expect(prompt.negativePrompt).toContain("3D render");
    expect(prompt.negativePrompt).toContain("fake certification");
  });

  it("skips missing providers without throwing", async () => {
    await expect(
      searchImages({ query: "stainless cookware" }),
    ).resolves.toMatchObject({
      status: "skipped",
      reason: "image_search_disabled",
    });
    await expect(
      generateImage({ prompt: { positivePrompt: "test" } }),
    ).resolves.toMatchObject({
      status: "skipped",
      reason: "ai_image_generation_disabled",
    });
  });

  it("skips configured providers when their API key is missing", async () => {
    process.env.IMAGE_SEARCH_PROVIDER = "pexels";
    process.env.IMAGE_SEARCH_API_KEY = "";
    process.env.AI_IMAGE_PROVIDER = "openai";
    process.env.AI_IMAGE_API_KEY = "";

    await expect(
      searchImages({ query: "stainless cookware" }),
    ).resolves.toMatchObject({
      status: "skipped",
      reason: "image_search_api_key_missing",
    });
    await expect(
      generateImage({ prompt: { positivePrompt: "test" } }),
    ).resolves.toMatchObject({
      status: "skipped",
      reason: "ai_image_api_key_missing",
    });
  });

  it("optimizes a cover to WebP dimensions and computes a checksum", async () => {
    const source = await sharp({
      create: {
        width: 1600,
        height: 900,
        channels: 3,
        background: "#c8d7de",
      },
    })
      .png()
      .toBuffer();
    const result = await optimizeImage({
      buffer: source,
      purpose: "cover",
      width: 1200,
      height: 675,
    });

    expect(result.mimeType).toBe("image/webp");
    expect(result.width).toBe(1200);
    expect(result.height).toBe(675);
    expect(result.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(result.sizeBytes).toBeLessThanOrEqual(350 * 1024);
  });

  it("keeps the text draft and visual plan when the image pipeline is disabled", async () => {
    const result = await runImagePipeline({
      title: "Cach ve sinh noi inox bi o vang",
      slug: "cach-ve-sinh-noi-inox-bi-o-vang",
      contentHtml,
      primaryKeyword: "ve sinh noi inox",
    });

    expect(result.contentHtml).toBe(contentHtml);
    expect(result.status).toBe("pending");
    expect(result.coverImage.status).toBe("pending_generation");
    expect(result.visualPlan.cover).toBeTruthy();
    expect(result.warnings).toContain("image_pipeline_disabled");
  });

  it("fails closed when the image-pipeline flag is missing", async () => {
    delete process.env.OPENCLAW_IMAGE_PIPELINE_ENABLED;

    const result = await runImagePipeline({
      title: "Cach ve sinh noi inox bi o vang",
      slug: "cach-ve-sinh-noi-inox-bi-o-vang",
      contentHtml,
      primaryKeyword: "ve sinh noi inox",
    });

    expect(result.status).toBe("pending");
    expect(result.warnings).toContain("image_pipeline_disabled");
  });
});
