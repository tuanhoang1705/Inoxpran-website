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
  it("uploads the bytes instead of handing over a tokenised URL", async () => {
    const bytes = Buffer.from("fake-image-bytes");
    const validateImageImpl = vi.fn().mockResolvedValue({
      safe: true,
      canonicalUrl: approval.coverImageUrl,
      mimeType: "image/webp",
      sizeBytes: bytes.byteLength,
      bytes,
    });
    const sendPhotoImpl = vi.fn().mockResolvedValue({ sent: true, messageId: "9" });

    const result = await sendApprovalNotification({
      chatId: "1",
      approval,
      validateImageImpl,
      sendPhotoImpl,
      sendMessageImpl: vi.fn(),
    });

    expect(result.notificationType).toBe("photo");
    const args = sendPhotoImpl.mock.calls[0][0];
    expect(args.photoBytes).toBe(bytes);
    expect(args.photoMimeType).toBe("image/webp");
  });

  it("falls back to text and keeps the reason when the photo cannot be sent", async () => {
    const sendMessageImpl = vi.fn().mockResolvedValue({ sent: true, messageId: "10" });

    const result = await sendApprovalNotification({
      chatId: "1",
      approval,
      validateImageImpl: vi
        .fn()
        .mockRejectedValue(new Error("GOOGLE_SOURCE_URL_SENSITIVE_QUERY_NOT_ALLOWED")),
      sendPhotoImpl: vi.fn(),
      sendMessageImpl,
    });

    expect(result.notificationType).toBe("text_fallback");
    expect(result.notificationError).toContain("SENSITIVE_QUERY");
    expect(sendMessageImpl).toHaveBeenCalledTimes(1);
  });
});
