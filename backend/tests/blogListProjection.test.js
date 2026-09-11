import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const BlogService = require("../src/services/blog.service");
const { blog: BlogModel } = require("../src/models/blog.model");

// Mirrors the .find().sort().skip().limit().select().lean() chain the service uses,
// recording what it was asked to project.
const stubFind = (documents) => {
  const calls = { select: null };
  const chain = {
    sort: () => chain,
    skip: () => chain,
    limit: () => chain,
    select: (fields) => {
      calls.select = fields;
      return chain;
    },
    lean: async () => documents,
  };
  vi.spyOn(BlogModel, "find").mockReturnValue(chain);
  vi.spyOn(BlogModel, "countDocuments").mockResolvedValue(documents.length);
  return calls;
};

const heavyPost = {
  _id: "507f1f77bcf86cd799439801",
  blog_slug: "noi-ap-suat-an-toan",
  blog_title: "Dùng nồi áp suất an toàn",
  blog_excerpt: "Những bước kiểm tra trước khi mở nắp.",
  blog_image: "https://cdn.example/cover.jpg",
  blog_category_key: "guide",
  blog_author_name: "Inoxpran",
  blog_tags: ["an-toan"],
  blog_read_time_minutes: 7,
  blog_views: 120,
  blog_comments_count: 3,
  publishedAt: new Date("2026-08-01T00:00:00.000Z"),
  createdAt: new Date("2026-07-30T00:00:00.000Z"),
  updatedAt: new Date("2026-08-02T00:00:00.000Z"),
  isPublished: true,
  isDraft: false,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("public blog list projection", () => {
  it("never asks the database for the article body or the pipeline blobs", async () => {
    const calls = stubFind([heavyPost]);

    await BlogService.listBlogsPublic({ limit: 8, page: 1, sort: "published" });

    expect(calls.select).toBeTruthy();
    // These four fields are 77% of a blog document in production and no list renders
    // any of them; selecting them is what made the homepage feed time out.
    for (const field of [
      "blog_content",
      "visualPlan",
      "generationMetadata",
      "contentImages",
    ]) {
      expect(calls.select).not.toContain(field);
    }
    expect(calls.select).toContain("blog_title");
    expect(calls.select).toContain("blog_excerpt");
  });

  it("keeps every field the storefront, home feed and sitemap actually read", async () => {
    stubFind([heavyPost]);

    const { items } = await BlogService.listBlogsPublic({ limit: 8, page: 1 });

    expect(items).toHaveLength(1);
    const [item] = items;
    expect(item.id).toBe(String(heavyPost._id));
    expect(item.slug).toBe(heavyPost.blog_slug);
    expect(item.title).toBe(heavyPost.blog_title);
    expect(item.excerpt).toBe(heavyPost.blog_excerpt);
    expect(item.image).toBe(heavyPost.blog_image);
    expect(item.categoryKey).toBe(heavyPost.blog_category_key);
    expect(item.readTimeMinutes).toBe(7);
    expect(item.views).toBe(120);
    // The sitemap dates entries by publication, so the raw value has to survive.
    expect(item.publishedAt).toEqual(heavyPost.publishedAt);
  });

  it("omits the pipeline keys rather than guessing them from absent fields", async () => {
    stubFind([heavyPost]);

    const { items } = await BlogService.listBlogsPublic({ limit: 8, page: 1 });

    // resolveBlogSourceType would infer "manual" from a document whose visualPlan and
    // contentImages were simply not selected. Publishing that guess would be worse
    // than publishing nothing, so the keys are absent instead of wrong.
    expect(items[0]).not.toHaveProperty("sourceType");
    expect(items[0]).not.toHaveProperty("isAgentic");
    expect(items[0]).not.toHaveProperty("visualPlan");
  });
});

describe("admin blog list projection", () => {
  it("drops the article body but keeps the fields the admin list renders", async () => {
    const calls = stubFind([heavyPost]);

    await BlogService.listBlogsForAdmin({ limit: 20, page: 1 });

    expect(calls.select).toContain("-blog_content");
    // The agentic/manual chip is derived from these, so they must stay.
    expect(calls.select).not.toContain("-visualPlan");
    expect(calls.select).not.toContain("-generationMetadata");
  });

  it("reduces the related-post picker to ids and titles", async () => {
    const calls = stubFind([heavyPost]);

    const { items } = await BlogService.listBlogsForAdmin({
      limit: 100,
      page: 1,
      view: "options",
    });

    expect(calls.select).toBe("blog_title blog_slug blog_category_key isPublished");
    expect(items[0]).toEqual({
      id: String(heavyPost._id),
      _id: String(heavyPost._id),
      slug: heavyPost.blog_slug,
      title: heavyPost.blog_title,
      categoryKey: heavyPost.blog_category_key,
      isPublished: true,
    });
  });
});
