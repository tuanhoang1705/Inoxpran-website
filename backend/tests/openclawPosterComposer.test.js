import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sharp = require("sharp");
const {
  DESIGNS,
  composePoster,
  isPosterEnabled,
  layout,
  pickDesign,
} = require("../src/services/openclaw/posterComposer.service");

const solid = (width, height, background) =>
  sharp({ create: { width, height, channels: 3, background } })
    .jpeg()
    .toBuffer();

const photo = () => solid(1600, 900, { r: 40, g: 90, b: 120 });
const productShot = () => solid(800, 800, { r: 230, g: 60, b: 60 });

describe("isPosterEnabled", () => {
  it("stays off unless the operator opts in", () => {
    expect(isPosterEnabled({})).toBe(false);
    expect(isPosterEnabled({ OPENCLAW_POSTER_COVER_ENABLED: "true" })).toBe(true);
  });
});

describe("pickDesign", () => {
  it("gives one article the same look every time it is rebuilt", () => {
    expect(pickDesign("noi-com-inp6002").id).toBe(pickDesign("noi-com-inp6002").id);
  });

  it("spreads articles across the available designs", () => {
    const seen = new Set(
      Array.from({ length: 60 }, (_, i) => pickDesign(`bai-viet-so-${i}`).id),
    );
    expect(seen.size).toBeGreaterThan(1);
    for (const id of seen) expect(DESIGNS.map((d) => d.id)).toContain(id);
  });
});

describe("layout", () => {
  it("keeps every design inside the canvas with the logo clear of the product", () => {
    for (const design of DESIGNS) {
      const box = layout(1200, 675, design);
      expect(box.productLeft).toBeGreaterThanOrEqual(0);
      expect(box.productLeft + box.productWidth).toBeLessThanOrEqual(1200);
      expect(box.productTop + box.productHeight).toBeLessThanOrEqual(675);
      const logoRight = box.logoLeft + box.logoWidth;
      const overlaps = logoRight > box.productLeft && box.logoLeft < box.productLeft + box.productWidth;
      expect(overlaps).toBe(false);
    }
  });

  it("keeps the product panel inside the canvas", () => {
    const box = layout(1200, 675);

    expect(box.productLeft).toBeGreaterThan(0);
    expect(box.productLeft + box.productWidth).toBeLessThanOrEqual(1200);
    expect(box.productTop).toBeGreaterThanOrEqual(0);
    expect(box.productTop + box.productHeight).toBeLessThanOrEqual(675);
  });
});

describe("composePoster", () => {
  it("returns a cover-sized WebP carrying both overlays", async () => {
    const result = await composePoster({
      baseBuffer: await photo(),
      productImageBuffer: await productShot(),
    });
    const meta = await sharp(result.buffer).metadata();

    expect(result.mimeType).toBe("image/webp");
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(1200);
    expect(meta.height).toBe(675);
    expect(result.applied).toEqual(["product", "logo"]);
  });

  it("places the product on the right half of the frame", async () => {
    const result = await composePoster({
      baseBuffer: await photo(),
      productImageBuffer: await productShot(),
    });
    // sharp's stats() reads the source image and ignores extract, so pixels are
    // sampled straight from the raw output instead.
    const pixel = async (x, y) => {
      const data = await sharp(result.buffer)
        .extract({ left: x, top: y, width: 1, height: 1 })
        .raw()
        .toBuffer();
      return { r: data[0], g: data[1], b: data[2] };
    };

    const left = await pixel(100, 300);
    const right = await pixel(950, 300);

    // The photograph stays blue where it is untouched; the product panel is red.
    expect(left.b).toBeGreaterThan(left.r);
    expect(right.r).toBeGreaterThan(right.b);
  });

  it("still produces a cover when there is no product to show", async () => {
    const result = await composePoster({ baseBuffer: await photo() });
    const meta = await sharp(result.buffer).metadata();

    expect(meta.width).toBe(1200);
    expect(result.applied).toEqual(["logo"]);
  });

  it("ships the photograph rather than nothing when the logo is unreadable", async () => {
    const result = await composePoster({
      baseBuffer: await photo(),
      logoPath: "/nowhere/missing-logo.png",
    });

    expect(result.applied).toEqual([]);
    expect((await sharp(result.buffer).metadata()).width).toBe(1200);
  });

  it("refuses to build a poster with no photograph", async () => {
    await expect(composePoster({ baseBuffer: Buffer.alloc(0) })).rejects.toThrow(
      "poster_base_image_missing",
    );
  });
});
