import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  IMAGE_ATTEMPT_LIMIT,
  approveStoredImage,
  isImageReviewDelegated,
  runImagePipeline,
} = require("../src/services/openclaw/imagePipeline.service");
const {
  alertOnMissingImages,
} = require("../src/services/automationSeoBlog.service");
const {
  TelegramApprovalService,
} = require("../src/services/telegramApproval.service");

const ORIGINAL_ENV = { ...process.env };

const storedImage = {
  url: "https://storage.example/cover.webp",
  status: "needs_review",
  reviewStatus: "pending_review",
  qualityReview: { passes: true, manualReviewRequired: true },
};

const missingImage = {
  url: "",
  status: "pending_generation",
  reviewStatus: "pending_review",
  warning: "no_image_provider_result",
  qualityReview: null,
};

describe("approveStoredImage", () => {
  it("carries an AI image past the review gate once it is stored", () => {
    const result = approveStoredImage(storedImage);

    expect(result.reviewStatus).toBe("approved");
    expect(result.status).toBe("complete");
    expect(result.qualityReview.autoApproved).toBe(true);
    expect(result.qualityReview.manualReviewRequired).toBe(false);
    expect(result.qualityReview.passes).toBe(true);
  });

  it("leaves an image that never reached storage untouched", () => {
    expect(approveStoredImage(missingImage)).toBe(missingImage);
  });
});

describe("image pipeline attempts", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("retries a plan item before recording it as pending", async () => {
    expect(IMAGE_ATTEMPT_LIMIT).toBe(3);
    // Provider named but unkeyed: every attempt gives up locally, no network.
    process.env.OPENCLAW_IMAGE_PIPELINE_ENABLED = "true";
    process.env.IMAGE_SEARCH_PROVIDER = "pexels";
    process.env.IMAGE_SEARCH_API_KEY = "";
    process.env.AI_IMAGE_PROVIDER = "disabled";
    process.env.SEO_AGENT_AUTO_PUBLISH = "true";

    const result = await runImagePipeline({
      title: "Cach ve sinh noi inox bi o vang",
      slug: "cach-ve-sinh-noi-inox-bi-o-vang",
      contentHtml:
        "<section><h2>Phan loai vet ban</h2><p>Noi dung.</p></section>",
      primaryKeyword: "ve sinh noi inox",
    });

    expect(result.coverImage.status).toBe("pending_generation");
    expect(result.warnings).toContain("image_search_api_key_missing");
    // Auto-publish must not wave through an article whose images do not exist.
    expect(result.coverImage.reviewStatus).toBe("pending_review");
    expect(result.publishReady).toBe(false);
    expect(result.coverReadyForPublish).toBe(false);
  });
});

describe("alertOnMissingImages", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports the shortfall and names the cover when it is the one missing", async () => {
    const notify = vi
      .spyOn(TelegramApprovalService, "notifyOperators")
      .mockResolvedValue({ sent: true });

    await alertOnMissingImages({
      title: "Cach ve sinh noi inox",
      slug: "cach-ve-sinh-noi-inox",
      imagePipeline: {
        coverImage: missingImage,
        contentImages: [storedImage, storedImage],
      },
    });

    expect(notify).toHaveBeenCalledTimes(1);
    const { text } = notify.mock.calls[0][0];
    expect(text).toContain("Thieu 1/3 anh");
    expect(text).toContain("anh bia");
    expect(text).toContain("no_image_provider_result");
    expect(text).toContain("cach-ve-sinh-noi-inox");
  });

  it("stays silent when every planned image was stored", async () => {
    const notify = vi.spyOn(TelegramApprovalService, "notifyOperators");

    const result = await alertOnMissingImages({
      title: "Cach ve sinh noi inox",
      slug: "cach-ve-sinh-noi-inox",
      imagePipeline: { coverImage: storedImage, contentImages: [storedImage] },
    });

    expect(notify).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: false, reason: "no_missing_images" });
  });

  it("does not let a Telegram outage break article creation", async () => {
    vi.spyOn(TelegramApprovalService, "notifyOperators").mockRejectedValue(
      new Error("telegram_unreachable"),
    );

    await expect(
      alertOnMissingImages({
        title: "Cach ve sinh noi inox",
        slug: "cach-ve-sinh-noi-inox",
        imagePipeline: { coverImage: missingImage, contentImages: [] },
      }),
    ).resolves.toEqual({ sent: false, reason: "telegram_unreachable" });
  });
});

describe("notifyOperators", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("reaches every notify chat and survives one failing chat", async () => {
    process.env.TELEGRAM_BOT_ENABLED = "true";
    process.env.TELEGRAM_BOT_TOKEN = "token";
    process.env.TELEGRAM_ALLOWED_CHAT_IDS = "1,2";
    process.env.TELEGRAM_NOTIFY_CHAT_IDS = "1,2";
    process.env.TELEGRAM_WEBHOOK_SECRET = "secret";
    process.env.ADMIN_BASE_URL = "https://admin.example.com";
    const sendMessageImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("chat_not_found"))
      .mockResolvedValue({ sent: true });

    const result = await TelegramApprovalService.notifyOperators({
      text: "thieu anh",
      sendMessageImpl,
    });

    expect(sendMessageImpl).toHaveBeenCalledTimes(2);
    expect(result.sent).toBe(true);
  });

  it("stays quiet when Telegram is off", async () => {
    process.env.TELEGRAM_BOT_ENABLED = "false";
    const sendMessageImpl = vi.fn();

    const result = await TelegramApprovalService.notifyOperators({
      text: "thieu anh",
      sendMessageImpl,
    });

    expect(sendMessageImpl).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: false, reason: "telegram_disabled" });
  });
});

describe("isImageReviewDelegated", () => {
  it("delegates when the operator publishes directly", () => {
    expect(
      isImageReviewDelegated({
        SEO_AGENT_AUTO_PUBLISH: "true",
        TELEGRAM_BOT_ENABLED: "false",
      }),
    ).toBe(true);
  });

  it("delegates when the operator approves each draft in Telegram", () => {
    expect(
      isImageReviewDelegated({
        SEO_AGENT_AUTO_PUBLISH: "false",
        TELEGRAM_BOT_ENABLED: "true",
      }),
    ).toBe(true);
  });

  it("keeps the per-image sign-off in draft-only mode", () => {
    expect(
      isImageReviewDelegated({
        SEO_AGENT_AUTO_PUBLISH: "false",
        TELEGRAM_BOT_ENABLED: "false",
      }),
    ).toBe(false);
  });
});
