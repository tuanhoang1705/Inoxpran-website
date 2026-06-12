"use strict";

const express = require("express");
const adminController = require("../../controllers/admin.controller");
const contactController = require("../../controllers/contact.controller");
const asyncHandler = require("../../helpers/asyncHandler");
const { authenticationAdmin } = require("../../auth/authUtils");
const { upload, uploadLarge } = require("../../middleware/upload");
const {
  cleanupUploadedArtifacts,
  uploadSingleImage,
} = require("../../middleware/firebaseUpload");
const { requireAdminRole } = require("../../middleware/requireAdminRole");

const router = express.Router();
const DESCRIPTION_IMAGE_MAX_SIZE = Number(
  process.env.UPLOAD_DESC_MAX_SIZE || 5 * 1024 * 1024,
);
const DESCRIPTION_IMAGE_VALIDATION = {
  maxSizeBytes: DESCRIPTION_IMAGE_MAX_SIZE,
  requireDimensions: false,
};
const HOME_SLIDE_IMAGE_MAX_SIZE = 5 * 1024 * 1024;
const HOME_SLIDE_IMAGE_VALIDATION = {
  maxSizeBytes: HOME_SLIDE_IMAGE_MAX_SIZE,
  requireDimensions: true,
  requiredWidth: 940,
  requiredHeight: 788,
};
const PRODUCT_IMAGE_VALIDATION = {
  maxSizeBytes: 5 * 1024 * 1024,
  requireDimensions: false,
  maxWidth: 1920,
  maxHeight: 1920,
};

router.post("/signup", asyncHandler(adminController.signUp));
router.post("/login", asyncHandler(adminController.login));

router.use(authenticationAdmin);

router.post("/logout", asyncHandler(adminController.logout));
router.post(
  "/refresh-token",
  asyncHandler(adminController.handlerRefreshToken),
);
router.get("/profile", asyncHandler(adminController.getProfile));
router.patch(
  "/profile",
  upload.single("avatar"),
  uploadSingleImage({ field: "avatar", folder: "admins" }),
  asyncHandler(adminController.updateProfile),
);
router.get(
  "/push/public-key",
  requireAdminRole(["CHAT_MANAGER", "LEAD_MANAGER", "ADMIN", "SUPER_ADMIN"]),
  asyncHandler(adminController.getWebPushConfig),
);
router.post(
  "/push/subscriptions",
  requireAdminRole(["CHAT_MANAGER", "LEAD_MANAGER", "ADMIN", "SUPER_ADMIN"]),
  asyncHandler(adminController.registerWebPushSubscription),
);
router.delete(
  "/push/subscriptions",
  requireAdminRole(["CHAT_MANAGER", "LEAD_MANAGER", "ADMIN", "SUPER_ADMIN"]),
  asyncHandler(adminController.unregisterWebPushSubscription),
);
router.get(
  "/live-support/consultants",
  requireAdminRole(["CHAT_MANAGER", "LEAD_MANAGER", "ADMIN", "SUPER_ADMIN"]),
  asyncHandler(adminController.listLiveSupportConsultants),
);
router.get("/admins/:adminId", asyncHandler(adminController.getAdminById));
router.get(
  "/admin-accounts",
  requireAdminRole(["SUPER_ADMIN"]),
  asyncHandler(adminController.listAdminAccounts),
);
router.get(
  "/admin-account-audit-logs",
  requireAdminRole(["SUPER_ADMIN"]),
  asyncHandler(adminController.listAdminAuditLogs),
);
router.patch(
  "/admin-accounts/:adminId",
  requireAdminRole(["SUPER_ADMIN"]),
  asyncHandler(adminController.updateAdminAccount),
);
router.delete(
  "/admin-accounts/:adminId",
  requireAdminRole(["SUPER_ADMIN"]),
  asyncHandler(adminController.deleteAdminAccount),
);
router.get(
  "/dashboard-summary",
  asyncHandler(adminController.getDashboardSummary),
);
router.get(
  "/home-slides",
  requireAdminRole(["SLIDE_MANAGER", "ADMIN", "SUPER_ADMIN"]),
  asyncHandler(adminController.getHomeSlides),
);
router.put(
  "/home-slides",
  requireAdminRole(["SLIDE_MANAGER", "ADMIN", "SUPER_ADMIN"]),
  asyncHandler(adminController.updateHomeSlides),
);
router.post(
  "/home-slides/image",
  requireAdminRole(["SLIDE_MANAGER", "ADMIN", "SUPER_ADMIN"]),
  uploadLarge.single("image"),
  uploadSingleImage({
    field: "image",
    folder: "homepage-slides",
    validation: HOME_SLIDE_IMAGE_VALIDATION,
    optimization: { profile: "homeSlide" },
  }),
  asyncHandler(adminController.uploadHomeSlideImage),
);
router.post(
  "/description-images",
  uploadLarge.single("image"),
  uploadSingleImage({
    field: "image",
    folder: "product-descriptions",
    validation: DESCRIPTION_IMAGE_VALIDATION,
  }),
  asyncHandler(adminController.uploadDescriptionImage),
);
const registerProductImageUpload = (path, profile) => {
  router.post(
    path,
    uploadLarge.single("image"),
    uploadSingleImage({
      field: "image",
      folder: "products",
      validation: PRODUCT_IMAGE_VALIDATION,
      optimization: { profile },
    }),
    asyncHandler(adminController.uploadProductImage),
  );
};

registerProductImageUpload("/product-images/thumb", "productThumb");
registerProductImageUpload("/product-images/gallery", "productGallery");
router.delete(
  "/pending-uploads/:sessionId",
  asyncHandler(adminController.cleanupPendingUploads),
);

router.get("/users", asyncHandler(adminController.listUsers));
router.get(
  "/anonymous-visitors",
  asyncHandler(adminController.listAnonymousVisitors),
);
router.get(
  "/anonymous-visitors/:sessionId",
  asyncHandler(adminController.getAnonymousVisitorBySession),
);
router.get(
  "/leads",
  requireAdminRole(["LEAD_MANAGER", "CONTACT_MANAGER", "ADMIN", "SUPER_ADMIN"]),
  asyncHandler(adminController.listLeads),
);
router.get(
  "/leads/:leadId",
  requireAdminRole(["LEAD_MANAGER", "CONTACT_MANAGER", "ADMIN", "SUPER_ADMIN"]),
  asyncHandler(adminController.getLeadById),
);
router.patch(
  "/leads/:leadId",
  requireAdminRole(["LEAD_MANAGER", "CONTACT_MANAGER", "ADMIN", "SUPER_ADMIN"]),
  asyncHandler(adminController.updateLead),
);
router.get(
  "/chat-rooms",
  requireAdminRole(["CHAT_MANAGER", "LEAD_MANAGER", "ADMIN", "SUPER_ADMIN"]),
  asyncHandler(adminController.listChatRooms),
);
router.get(
  "/chat-rooms/stream",
  requireAdminRole(["CHAT_MANAGER", "LEAD_MANAGER", "ADMIN", "SUPER_ADMIN"]),
  asyncHandler(adminController.streamChatRooms),
);
router.get(
  "/chat-rooms/:sessionId/stream",
  requireAdminRole(["CHAT_MANAGER", "LEAD_MANAGER", "ADMIN", "SUPER_ADMIN"]),
  asyncHandler(adminController.streamChatRoomBySession),
);
router.get(
  "/chat-rooms/:sessionId",
  requireAdminRole(["CHAT_MANAGER", "LEAD_MANAGER", "ADMIN", "SUPER_ADMIN"]),
  asyncHandler(adminController.getChatRoomBySession),
);
router.patch(
  "/chat-rooms/:sessionId",
  requireAdminRole(["CHAT_MANAGER", "LEAD_MANAGER", "ADMIN", "SUPER_ADMIN"]),
  asyncHandler(adminController.updateChatRoom),
);
router.delete(
  "/chat-rooms/:sessionId",
  requireAdminRole(["SUPER_ADMIN"]),
  asyncHandler(adminController.deleteChatRoom),
);
router.get("/users/:userId", asyncHandler(adminController.getUserById));
router.patch(
  "/users/:userId/status",
  asyncHandler(adminController.updateUserStatus),
);
router.post(
  "/users/:userId/reset-password",
  asyncHandler(adminController.sendUserResetPasswordEmail),
);
router.delete("/users/:userId", asyncHandler(adminController.deleteUser));

router.get("/pending-admins", asyncHandler(adminController.listPendingAdmins));
router.post(
  "/admins/:adminId/approve",
  asyncHandler(adminController.approveAdmin),
);
router.post(
  "/admins/:adminId/reject",
  asyncHandler(adminController.rejectAdmin),
);

router.get(
  "/contacts",
  requireAdminRole(["CONTACT_MANAGER", "ADMIN", "SUPER_ADMIN"]),
  asyncHandler(contactController.listAdmin),
);
router.post(
  "/contacts/bulk-delete",
  requireAdminRole(["CONTACT_MANAGER", "ADMIN", "SUPER_ADMIN"]),
  asyncHandler(contactController.bulkDeleteAdmin),
);
router.get(
  "/contacts/:contactId",
  requireAdminRole(["CONTACT_MANAGER", "ADMIN", "SUPER_ADMIN"]),
  asyncHandler(contactController.getAdminById),
);
router.patch(
  "/contacts/:contactId",
  requireAdminRole(["CONTACT_MANAGER", "ADMIN", "SUPER_ADMIN"]),
  asyncHandler(contactController.updateAdmin),
);
router.delete(
  "/contacts/:contactId",
  requireAdminRole(["CONTACT_MANAGER", "ADMIN", "SUPER_ADMIN"]),
  asyncHandler(contactController.deleteAdmin),
);

router.use(async (error, req, res, next) => {
  if (String(req.originalUrl || "").includes("/description-images")) {
    await cleanupUploadedArtifacts(req);
  }
  next(error);
});

module.exports = router;
