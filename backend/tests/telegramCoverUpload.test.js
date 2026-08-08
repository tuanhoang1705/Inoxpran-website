import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  sendApprovalNotification,
} = require("../src/services/telegramApproval.service");

const approval = {
  coverImageUrl:
    "https://firebasestorage.googleapis.com/v0/b/x/o/cover.webp?alt=media&token=secret-read-token",
  blogTitle: "Cach ve sinh noi inox",
  approvalCode: "ABCD1234",
  adminEditUrl: "https://admin.example.com/blogs/1",
};

describe("cover delivery to Telegram", () => {
  it("uploads a tokenised storage cover instead of refusing it", async () => {
    const bytes = Buffer.from("stored-cover-bytes");
    const validateOwnAsset = vi.fn().mockResolvedValue({
      bytes,
      mimeType: "image/webp",
      canonicalUrl: approval.coverImageUrl,
    });
    const sendPhotoImpl = vi.fn().mockResolvedValue({ sent: true, messageId: "9" });

    const result = await sendApprovalNotification({
      chatId: "1",
      approval,
      validateImageImpl: validateOwnAsset,
      sendPhotoImpl,
      sendMessageImpl: vi.fn(),
    });

    expect(result.notificationType).toBe("photo");
    const args = sendPhotoImpl.mock.calls[0][0];
    expect(args.photoBytes).toBe(bytes);
    expect(args.photoMimeType).toBe("image/webp");
  });

  it("falls back to text and reports why the photo failed", async () => {
    const sendMessageImpl = vi
      .fn()
      .mockResolvedValue({ sent: true, messageId: "10" });

    const result = await sendApprovalNotification({
      chatId: "1",
      approval,
      validateImageImpl: vi
        .fn()
        .mockRejectedValue(new Error("telegram_image_too_large")),
      sendPhotoImpl: vi.fn(),
      sendMessageImpl,
    });

    expect(result.notificationType).toBe("text_fallback");
    expect(result.notificationError).toContain("telegram_image_too_large");
    expect(sendMessageImpl).toHaveBeenCalledTimes(1);
  });
});

const {
  validateTelegramImageUrl,
} = require("../src/services/telegramImageSafety.service");

const imageResponse = (bytes) => ({
  ok: true,
  headers: new Headers({ "content-type": "image/webp", "content-length": String(bytes.length) }),
  arrayBuffer: async () => bytes,
});

describe("cover validation", () => {
  it("accepts our own storage URL even though it carries a read token", async () => {
    const bytes = Buffer.from("cover-bytes");
    const result = await validateTelegramImageUrl({
      url: approval.coverImageUrl,
      fetchImpl: async () => imageResponse(bytes),
    });

    expect(result.safe).toBe(true);
    expect(result.mimeType).toBe("image/webp");
    expect(result.bytes.byteLength).toBe(bytes.byteLength);
  });

  it("still refuses a tokenised URL on somebody else's host", async () => {
    await expect(
      validateTelegramImageUrl({
        url: "https://cdn.example.com/a.png?token=leak-me",
        fetchImpl: async () => imageResponse(Buffer.from("x")),
      }),
    ).rejects.toThrow();
  });
});
