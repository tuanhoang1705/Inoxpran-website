import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const storageService = require("../src/services/storage.service");
const cleanupSpy = vi
  .spyOn(storageService, "deleteRemovedHtmlImagesFromStorage")
  .mockResolvedValue();

delete require.cache[require.resolve("../src/services/blog.service")];

const BlogService = require("../src/services/blog.service");
const { blog: BlogModel } = require("../src/models/blog.model");

const sha256 = (value) =>
  crypto.createHash("sha256").update(String(value || "")).digest("hex");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("QA blog content revision hash", () => {
  it("hashes the exact sanitized content persisted by the admin editor", async () => {
    const blogId = "507f1f77bcf86cd799439731";
    const previousContent = "<p>Original retained QA draft.</p>";
    const submittedContent =
      '<section><h2>Revised answer</h2><p>Safe text.</p><script>alert("x")</script></section>';
    const sanitizedContent = BlogService.normalizePayload(
      { blog_content: submittedContent },
      { isUpdate: true },
    ).blog_content;
    const current = {
      _id: blogId,
      isQaTest: true,
      qaBatchId: "507f1f77bcf86cd799439732",
      qaCaseId: "507f1f77bcf86cd799439733",
      isDraft: true,
      isPublished: false,
      publishedAt: null,
      blog_title: "Retained QA draft",
      blog_slug: "retained-qa-draft",
      blog_excerpt: "A retained QA draft.",
      blog_content: previousContent,
      contentRevisionHash: sha256(previousContent),
      blog_image: "https://inoxpran.com/static/qa-cover.jpg",
      blog_image_path: "",
      contentImages: [],
    };
    let persistedUpdate = null;

    vi.spyOn(BlogModel, "findById").mockReturnValue({
      lean: vi.fn().mockResolvedValue(current),
    });
    vi.spyOn(BlogModel, "findByIdAndUpdate").mockImplementation(
      (_id, update) => {
        persistedUpdate = update;
        return {
          lean: vi.fn().mockResolvedValue({ ...current, ...update }),
        };
      },
    );

    const result = await BlogService.updateBlog({
      blogId,
      payload: { blog_content: submittedContent },
    });

    expect(sanitizedContent).not.toContain("<script");
    expect(persistedUpdate).toMatchObject({
      blog_content: sanitizedContent,
      contentRevisionHash: sha256(sanitizedContent),
    });
    expect(persistedUpdate.contentRevisionHash).not.toBe(
      current.contentRevisionHash,
    );
    expect(result.contentRevisionHash).toBe(
      persistedUpdate.contentRevisionHash,
    );
    expect(cleanupSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        previousHtml: previousContent,
        nextHtml: sanitizedContent,
      }),
    );
  });

  it("retains QA drafts and their evidence when the generic admin delete path is used", async () => {
    const blogId = "507f1f77bcf86cd799439741";
    const updateRelated = vi
      .spyOn(BlogModel, "updateMany")
      .mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
    const hardDelete = vi
      .spyOn(BlogModel, "deleteOne")
      .mockResolvedValue({ deletedCount: 1 });
    vi.spyOn(BlogModel, "findById").mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        _id: blogId,
        isQaTest: true,
        qaBatchId: "507f1f77bcf86cd799439742",
        qaCaseId: "507f1f77bcf86cd799439743",
        isDraft: true,
        isPublished: false,
      }),
    });

    await expect(BlogService.deleteBlog({ blogId })).rejects.toThrow(
      "QA drafts are retained audit evidence",
    );
    expect(updateRelated).not.toHaveBeenCalled();
    expect(hardDelete).not.toHaveBeenCalled();
  });
});
