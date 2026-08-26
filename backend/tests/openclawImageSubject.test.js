import { afterEach, describe, expect, it, vi } from "vitest";
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

// The safety clauses in a generated prompt name exactly what they forbid ("not a
// 3D render", "no glossy luxury sheen"). The quality guardrail scans text as a
// proxy for the pixels, so scanning the whole prompt made every generated image
// fail its own instructions and no article got an image for days. It must only
// ever see text this system did not author.
describe('image guardrail scans only untrusted text', () => {
    const STYLE = /\b(3d render|cgi|glossy luxury)\b/i;

    it('keeps the safety clauses in the prompt sent to the model', () => {
        const prompt = buildImagePrompt({
            purpose: 'cover',
            articleTitle: 'Nồi inox có dùng được bếp từ',
            productSubject: 'bộ nồi inox'
        });
        expect(prompt.positivePrompt).toContain('not a 3D render');
    });

    it('never offers its own safety clauses to the guardrail', () => {
        const prompt = buildImagePrompt({
            purpose: 'cover',
            articleTitle: 'Nồi inox có dùng được bếp từ',
            productSubject: 'bộ nồi inox'
        });
        // Asserting both halves is the point: the full prompt DOES contain the
        // forbidden phrase, and that is correct. Only conflating the two texts
        // was ever the bug, so the test fails if subjectText goes missing too.
        expect(typeof prompt.subjectText).toBe('string');
        expect(prompt.subjectText.length).toBeGreaterThan(0);
        expect(STYLE.test(prompt.positivePrompt)).toBe(true);
        expect(STYLE.test(prompt.subjectText)).toBe(false);
    });

    it('still surfaces a forbidden style named by the article itself', () => {
        const prompt = buildImagePrompt({
            purpose: 'cover',
            articleTitle: 'Ảnh 3D render nồi inox',
            productSubject: 'bộ nồi inox'
        });
        expect(STYLE.test(prompt.subjectText)).toBe(true);
    });
});

// Grounding the frame on the real catalog photograph is the largest single gain
// in realism, because the model stops inventing the appliance. It must never be
// load-bearing though: an article with a slightly less real image is far better
// than an article with none.
describe('reference-image grounding', () => {
    const { generateImage } = require("../src/services/openclaw/aiImageGenerate.service");
    const prompt = { positivePrompt: 'a real kitchen photograph', negativePrompt: '' };
    const reference = { buffer: Buffer.from('fake-product-photo'), mimeType: 'image/png' };
    const okBody = { data: [{ b64_json: Buffer.from('generated').toString('base64') }] };

    const stubFetch = (handler) => {
        vi.stubGlobal('fetch', vi.fn(handler));
        process.env.AI_IMAGE_PROVIDER = 'openai';
        process.env.AI_IMAGE_API_KEY = 'sk-test';
    };

    afterEach(() => {
        vi.unstubAllGlobals();
        delete process.env.AI_IMAGE_PROVIDER;
        delete process.env.AI_IMAGE_API_KEY;
    });

    it('sends the product photo to the edits endpoint when one is supplied', async () => {
        const seen = [];
        stubFetch(async (url) => {
            seen.push(String(url));
            return { ok: true, status: 200, json: async () => okBody };
        });
        const result = await generateImage({ prompt, referenceImage: reference });
        expect(seen[0]).toContain('/images/edits');
        expect(result.grounded).toBe(true);
        expect(result.status).toBe('complete');
    });

    it('falls back to plain generation rather than losing the image', async () => {
        const seen = [];
        stubFetch(async (url) => {
            seen.push(String(url));
            if (String(url).includes('/images/edits')) return { ok: false, status: 500, text: async () => 'boom' };
            return { ok: true, status: 200, json: async () => okBody };
        });
        const result = await generateImage({ prompt, referenceImage: reference });
        expect(seen[0]).toContain('/images/edits');
        expect(seen[1]).toContain('/images/generations');
        expect(result.status).toBe('complete');
        expect(result.grounded).toBeUndefined();
    });

    it('uses plain generation when there is no product photo to ground on', async () => {
        const seen = [];
        stubFetch(async (url) => {
            seen.push(String(url));
            return { ok: true, status: 200, json: async () => okBody };
        });
        await generateImage({ prompt });
        expect(seen).toHaveLength(1);
        expect(seen[0]).toContain('/images/generations');
    });
});
