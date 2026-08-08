import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  uploadImageWithRetry,
} = require("../src/services/openclaw/imagePipeline.service");

// Verbatim shape of the Firebase Storage fault that dropped a planned inline
// image from a production draft.
const FIREBASE_INTERNAL_ERROR = JSON.stringify({
  error: {
    code: 500,
    message: "We encountered an internal error. Please try again.",
    errors: [{ reason: "internalError", domain: "global" }],
  },
});

const uploaded = { url: "https://storage.example/cover.webp", path: "blog/x" };

describe("image upload retry", () => {
  it("recovers when storage fails once with a transient internal error", async () => {
    const uploadImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error(FIREBASE_INTERNAL_ERROR))
      .mockResolvedValue(uploaded);

    const result = await uploadImageWithRetry(
      { folder: "blog/2026/08/slug" },
      { uploadImpl, retryDelayMs: 0 },
    );

    expect(result).toEqual(uploaded);
    expect(uploadImpl).toHaveBeenCalledTimes(2);
  });

  it("gives up after the attempt budget and surfaces the last error", async () => {
    const uploadImpl = vi
      .fn()
      .mockRejectedValue(new Error(FIREBASE_INTERNAL_ERROR));

    await expect(
      uploadImageWithRetry({}, { uploadImpl, attempts: 3, retryDelayMs: 0 }),
    ).rejects.toThrow(/internalError/);
    expect(uploadImpl).toHaveBeenCalledTimes(3);
  });

  it("does not retry a rejection the storage layer will repeat", async () => {
    const uploadImpl = vi
      .fn()
      .mockRejectedValue(new Error("unsupported_image_mime_type"));

    await expect(
      uploadImageWithRetry({}, { uploadImpl, retryDelayMs: 0 }),
    ).rejects.toThrow("unsupported_image_mime_type");
    expect(uploadImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a dropped connection", async () => {
    const error = new Error("fetch failed");
    error.cause = { code: "ECONNRESET" };
    const uploadImpl = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValue(uploaded);

    await expect(
      uploadImageWithRetry({}, { uploadImpl, retryDelayMs: 0 }),
    ).resolves.toEqual(uploaded);
    expect(uploadImpl).toHaveBeenCalledTimes(2);
  });
});
