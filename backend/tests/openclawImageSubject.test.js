import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  buildImagePrompt,
} = require("../src/services/openclaw/imagePromptBuilder.service");
const {
  buildVisualPlan,
} = require("../src/services/openclaw/visualPlan.service");
const {
  toProductSubject,
} = require("../src/services/openclaw/productMentionEnrichment.service");

describe("toProductSubject", () => {
  it("keeps the appliance type and drops the brand and model code", () => {
    expect(toProductSubject("Máy sấy bát đĩa INOXPRAN INP6601")).toBe(
      "Máy sấy bát đĩa",
    );
    expect(toProductSubject("Nồi cơm điện đa năng giảm đường INOXPRAN INP6002")).toBe(
      "Nồi cơm điện đa năng giảm đường",
    );
  });

  it("leaves a name carrying neither alone", () => {
    expect(toProductSubject("Chảo gang tráng men")).toBe("Chảo gang tráng men");
  });
});

describe("image prompts for an article about a known product", () => {
  const article = {
    title: "Lập nhịp kiểm tra an toàn khi dùng INP6601 trong nhà có trẻ nhỏ",
    slug: "lap-nhip-kiem-tra-an-toan-inp6601",
    contentHtml:
      "<h2>Bon thoi diem</h2><p>x</p><h2>Dau hieu can dung</h2><p>y</p>",
    articleType: "product_care",
  };

  it("names the appliance and forbids substituting cookware", () => {
    const plan = buildVisualPlan({ ...article, productSubject: "Máy sấy bát đĩa" });

    for (const item of [plan.cover, ...plan.inline]) {
      const { positivePrompt } = buildImagePrompt(item);
      expect(positivePrompt).toContain("must be Máy sấy bát đĩa");
      expect(positivePrompt).toContain("no other kind of kitchen appliance");
      // Naming forbidden items breaks down when the subject is one of them.
      expect(positivePrompt).not.toMatch(/Do not substitute[^.]*kettles/);
      // The generic fallbacks are what produced pots for a dish dryer article.
      expect(positivePrompt).not.toContain("practical stainless steel cookware");
      expect(positivePrompt).not.toContain("light burn marks");
    }
  });

  it("keeps the generic kitchen scene when no product is known", () => {
    const plan = buildVisualPlan(article);
    const { positivePrompt } = buildImagePrompt(plan.inline[0]);

    expect(positivePrompt).toContain("practical stainless steel cookware");
    expect(positivePrompt).not.toContain("must be");
  });
});

describe("a subject that is itself common cookware", () => {
  it("does not forbid the very appliance it asks for", () => {
    const plan = buildVisualPlan({
      title: "Te tay hay thay nuoc quanh am: luc nao phai ngat dien ngay?",
      slug: "te-tay-hay-thay-nuoc-quanh-am",
      contentHtml: "<h2>Dau hieu</h2><p>x</p><h2>Xu ly</h2><p>y</p>",
      articleType: "product_care",
      productSubject: "Ấm điện siêu tốc",
    });
    const { positivePrompt } = buildImagePrompt(plan.cover);

    expect(positivePrompt).toContain("must be Ấm điện siêu tốc");
    expect(positivePrompt).not.toContain("kettles");
  });
});
