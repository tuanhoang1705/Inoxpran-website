import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  enrichProductMentions,
  findMentionedCodes,
  resolveInsertionPoint,
  resolveMentionedProduct,
} = require("../src/services/openclaw/productMentionEnrichment.service");
const { sanitizeSeoBlogHtml } = require("../src/utils/seoBlogSanitizer");

const ORIGINAL_ENV = { ...process.env };

const catalogItem = {
  _id: "6a1b2c3d4e5f60718293a4b5",
  product_name: "Nồi cơm điện đa năng giảm đường INOXPRAN INP6002",
  product_slug: "noi-com-dien-da-nang-giam-duong-inoxpran-inp6002",
  product_thumb:
    "https://firebasestorage.googleapis.com/v0/b/her-ai-a4653.appspot.com/o/products%2Finp6002.png?alt=media&token=abc",
  product_price: 1900000,
};

const section = (heading, filler) =>
  `<h2>${heading}</h2><figure><img src="https://firebasestorage.googleapis.com/v0/b/her-ai-a4653.appspot.com/o/a.webp?alt=media&token=t" alt="minh hoa" /></figure><p>${filler}</p>`;

const words = (count) => Array.from({ length: count }, () => "noi").join(" ");

// Long enough that an h2 boundary clears the 350-word and 35% progress floors.
const article = [
  "<article>",
  section("Co che giam duong hoat dong ra sao", words(320)),
  section("Khi nao ky vong dung muc", `Model INP6002 duoc nhac o day. ${words(320)}`),
  section("Ket luan", words(200)),
  "</article>",
].join("");

const productModel = (result) => ({
  findOne: () => ({
    select: () => ({ lean: async () => result }),
  }),
});

describe("findMentionedCodes", () => {
  it("finds model codes in prose and ignores repeats", () => {
    expect(findMentionedCodes("<p>INP6002 va lai INP6002, them INP2111.</p>")).toEqual([
      "INP6002",
      "INP2111",
    ]);
  });

  it("ignores codes that only appear inside markup", () => {
    expect(
      findMentionedCodes('<img src="https://x/INP6002.png" alt="anh" />'),
    ).toEqual([]);
  });
});

describe("resolveInsertionPoint", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("refuses a point that would make the product shot the first image", () => {
    const noEditorialImages = [
      "<article>",
      `<h2>Mot</h2><p>${words(400)}</p>`,
      `<h2>Hai</h2><p>${words(400)}</p>`,
      `<h2>Ba</h2><p>${words(400)}</p>`,
      "</article>",
    ].join("");

    expect(
      resolveInsertionPoint({
        html: noEditorialImages,
        requireEditorialImageBefore: true,
      }),
    ).toBeNull();
    expect(
      resolveInsertionPoint({
        html: noEditorialImages,
        requireEditorialImageBefore: false,
      }),
    ).toBeTruthy();
  });
});

describe("enrichProductMentions", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  it("attaches the catalog image and link for a model named in prose", async () => {
    const result = await enrichProductMentions({
      html: article,
      disclosureText: "Inoxpran la san pham cua chinh chung toi.",
      productModel: productModel(catalogItem),
    });

    expect(result.applied).toBe(true);
    expect(result.code).toBe("INP6002");
    expect(result.html).toContain("products%2Finp6002.png");
    expect(result.html).toContain(
      "/product/noi-com-dien-da-nang-giam-duong-inoxpran-inp6002",
    );
    expect(result.html).toContain("1.900.000 đ");
    expect(result.html).toContain('data-disclosure-type="owned-product"');
  });

  it("emits markup the blog sanitizer keeps intact", async () => {
    const result = await enrichProductMentions({
      html: article,
      productModel: productModel(catalogItem),
    });
    const sanitized = sanitizeSeoBlogHtml(result.html);

    expect(sanitized).toContain("products%2Finp6002.png");
    expect(sanitized).toContain('data-image-role="product"');
    expect(sanitized).toContain(`data-product-id="${catalogItem._id}"`);
    expect(sanitized).toContain('data-block-type="product-recommendation"');
  });

  it("places the block after the article has earned its own value", async () => {
    const result = await enrichProductMentions({
      html: article,
      productModel: productModel(catalogItem),
    });
    const blockIndex = result.html.indexOf('data-block-type="product-recommendation"');
    const firstHeadingEnd = result.html.indexOf("</h2>");

    expect(blockIndex).toBeGreaterThan(firstHeadingEnd);
    expect(result.html.slice(0, blockIndex)).toContain("<figure");
  });

  it("does not add a second block for a product the plan already placed", async () => {
    const withPlacedBlock = article.replace(
      "</article>",
      `<section data-block-type="product-recommendation" data-product-id="${catalogItem._id}"><p>da co</p></section></article>`,
    );

    const result = await enrichProductMentions({
      html: withPlacedBlock,
      productModel: productModel(catalogItem),
    });

    expect(result.applied).toBe(false);
    expect(result.reason).toBe("product_already_placed");
  });

  it("leaves the article alone when the code is not in the catalog", async () => {
    const result = await enrichProductMentions({
      html: article,
      productModel: productModel(null),
    });

    expect(result.applied).toBe(false);
    expect(result.reason).toBe("mentioned_product_not_in_catalog");
    expect(result.html).toBe(article);
  });

  it("skips a catalog row that has no image to show", async () => {
    const result = await enrichProductMentions({
      html: article,
      productModel: productModel({ ...catalogItem, product_thumb: "" }),
    });

    expect(result.applied).toBe(false);
    expect(result.html).toBe(article);
  });

  it("can be turned off entirely", async () => {
    process.env.PRODUCT_MENTION_IMAGE_ENABLED = "false";

    const result = await enrichProductMentions({
      html: article,
      productModel: productModel(catalogItem),
    });

    expect(result).toEqual({
      html: article,
      applied: false,
      reason: "product_mention_image_disabled",
      code: "",
    });
  });
});

describe("resolveMentionedProduct", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("finds the product without touching the article", async () => {
    const result = await resolveMentionedProduct({
      html: article,
      productModel: productModel(catalogItem),
    });

    expect(result.found).toBe(true);
    expect(result.code).toBe("INP6002");
    expect(result.productImageUrl).toContain("products%2Finp6002.png");
  });

  it("reports a code the catalog does not carry", async () => {
    const result = await resolveMentionedProduct({
      html: article,
      productModel: productModel(null),
    });

    expect(result.found).toBe(false);
    expect(result.reason).toBe("mentioned_product_not_in_catalog");
  });
});

describe("insertion after the image pipeline", () => {
  it("uses a product resolved earlier instead of looking it up again", async () => {
    const productModelSpy = { findOne: vi.fn() };
    const resolved = {
      found: true,
      code: "INP6002",
      item: catalogItem,
      productId: catalogItem._id,
      productName: catalogItem.product_name,
      productImageUrl: catalogItem.product_thumb,
    };

    const result = await enrichProductMentions({
      html: article,
      resolved,
      productModel: productModelSpy,
    });

    expect(result.applied).toBe(true);
    expect(productModelSpy.findOne).not.toHaveBeenCalled();
    expect(result.html).toContain("products%2Finp6002.png");
  });

  it("holds back while the article still has no editorial image", async () => {
    const bare = [
      "<article>",
      "<h2>Mot</h2><p>" + words(400) + "</p>",
      "<h2>Hai</h2><p>" + words(400) + "</p>",
      "<h2>Ba</h2><p>INP6002 o day. " + words(400) + "</p>",
      "</article>",
    ].join("");

    const result = await enrichProductMentions({
      html: bare,
      productModel: productModel(catalogItem),
    });

    expect(result.applied).toBe(false);
    expect(result.reason).toBe("no_eligible_insertion_point");
  });
});
