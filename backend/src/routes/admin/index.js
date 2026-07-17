"use strict";

const express = require("express");
const adminController = require("../../controllers/admin.controller");
const contactController = require("../../controllers/contact.controller");
const openclawDashboardController = require("../../controllers/openclawDashboard.controller");
const blogAutomationScheduleController = require("../../controllers/blogAutomationSchedule.controller");
const googleIntelligenceController = require("../../controllers/googleIntelligence.controller");
const agenticBlogCoreController = require("../../controllers/agenticBlogCore.controller");
const productSeedingAdminController = require("../../controllers/productSeedingAdmin.controller");
const asyncHandler = require("../../helpers/asyncHandler");
const { authenticationAdmin } = require("../../auth/authUtils");
const { upload, uploadLarge } = require("../../middleware/upload");
const {
  cleanupUploadedArtifacts,
  uploadSingleImage,
} = require("../../middleware/firebaseUpload");
const { requireAdminPermission, requireAdminRole } = require("../../middleware/requireAdminRole");

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
  "/openclaw",
  requireAdminRole(["ADMIN", "SUPER_ADMIN"]),
  asyncHandler(openclawDashboardController.getDashboard),
);
router.get(
  "/openclaw/runs",
  requireAdminRole(["ADMIN", "SUPER_ADMIN"]),
  asyncHandler(openclawDashboardController.listRuns),
);
router.post(
  "/openclaw/runs",
  requireAdminRole(["ADMIN", "SUPER_ADMIN"]),
  asyncHandler(openclawDashboardController.startRun),
);
router.get(
  "/openclaw/google-intelligence/status",
  requireAdminPermission(["google_intelligence.view"]),
  asyncHandler(googleIntelligenceController.getStatus),
);
router.get(
  "/openclaw/google-intelligence/snapshots",
  requireAdminPermission(["google_intelligence.view"]),
  asyncHandler(googleIntelligenceController.listSnapshots),
);
router.get(
  "/openclaw/google-intelligence/snapshots/:snapshotId",
  requireAdminPermission(["google_intelligence.view"]),
  asyncHandler(googleIntelligenceController.getSnapshot),
);
router.post(
  "/openclaw/google-intelligence/snapshots/:snapshotId/override",
  requireAdminPermission(["google_intelligence.override_gate"]),
  asyncHandler(googleIntelligenceController.overrideSnapshot),
);
router.post(
  "/openclaw/google-intelligence/run-now",
  requireAdminPermission(["google_intelligence.run"]),
  asyncHandler(googleIntelligenceController.runNow),
);
router.get(
  "/openclaw/google-intelligence/sources",
  requireAdminPermission(["google_intelligence.view"]),
  asyncHandler(googleIntelligenceController.listSources),
);
router.post(
  "/openclaw/google-intelligence/sources",
  requireAdminPermission(["google_intelligence.manage_sources"]),
  asyncHandler(googleIntelligenceController.createSource),
);
router.patch(
  "/openclaw/google-intelligence/sources/:sourceId",
  requireAdminPermission(["google_intelligence.manage_sources"]),
  asyncHandler(googleIntelligenceController.updateSource),
);
router.post(
  "/openclaw/google-intelligence/sources/:sourceId/run-now",
  requireAdminPermission(["google_intelligence.run"]),
  asyncHandler(googleIntelligenceController.runSourceNow),
);
router.get(
  "/openclaw/google-intelligence/schedule",
  requireAdminPermission(["google_intelligence.view"]),
  asyncHandler(googleIntelligenceController.getSchedule),
);
router.patch(
  "/openclaw/google-intelligence/schedule",
  requireAdminPermission(["google_intelligence.manage_schedule"]),
  asyncHandler(googleIntelligenceController.updateSchedule),
);
router.post(
  "/openclaw/google-intelligence/schedule/enable",
  requireAdminPermission(["google_intelligence.manage_schedule"]),
  asyncHandler(googleIntelligenceController.enableSchedule),
);
router.post(
  "/openclaw/google-intelligence/schedule/disable",
  requireAdminPermission(["google_intelligence.manage_schedule"]),
  asyncHandler(googleIntelligenceController.disableSchedule),
);
router.get(
  "/openclaw/google-intelligence/executions",
  requireAdminPermission(["google_intelligence.view"]),
  asyncHandler(googleIntelligenceController.listExecutions),
);
router.get(
  "/openclaw/google-intelligence/related-blogs",
  requireAdminPermission(["google_intelligence.view"]),
  asyncHandler(googleIntelligenceController.listRelatedBlogs),
);
router.get(
  "/openclaw/editorial-styles",
  requireAdminPermission(["editorial_style.view"]),
  asyncHandler(agenticBlogCoreController.listStyles),
);
router.patch(
  "/openclaw/editorial-styles/:styleId",
  requireAdminPermission(["editorial_style.manage"]),
  asyncHandler(agenticBlogCoreController.updateStyle),
);
router.post(
  "/openclaw/editorial-styles/generate-today",
  requireAdminPermission(["editorial_style.manage"]),
  asyncHandler(agenticBlogCoreController.generateTodayStyle),
);
router.get(
  "/openclaw/research-bundles/:bundleId",
  requireAdminPermission(["google_intelligence.view"]),
  asyncHandler(agenticBlogCoreController.getResearchBundle),
);
router.get(
  "/openclaw/blog-strategies/:strategyId",
  requireAdminPermission(["google_intelligence.view"]),
  asyncHandler(agenticBlogCoreController.getStrategy),
);
router.get(
  "/openclaw/product-seeding/config",
  requireAdminPermission(["product_seeding.view"]),
  asyncHandler(productSeedingAdminController.getConfig),
);
router.patch(
  "/openclaw/product-seeding/config",
  requireAdminPermission(["product_seeding.manage"]),
  asyncHandler(productSeedingAdminController.updateConfig),
);
router.post(
  "/openclaw/product-seeding/preview",
  requireAdminPermission(["product_seeding.preview"]),
  asyncHandler(productSeedingAdminController.preview),
);
router.get(
  "/openclaw/product-seeding/plans",
  requireAdminPermission(["product_seeding.view"]),
  asyncHandler(productSeedingAdminController.listPlans),
);
router.get(
  "/openclaw/product-seeding/plans/:id",
  requireAdminPermission(["product_seeding.view"]),
  asyncHandler(productSeedingAdminController.getPlan),
);
router.get(
  "/openclaw/product-placement/plans",
  requireAdminPermission(["product_seeding.view"]),
  asyncHandler(productSeedingAdminController.listPlacementPlans),
);
router.get(
  "/openclaw/product-placement/plans/:id",
  requireAdminPermission(["product_seeding.view"]),
  asyncHandler(productSeedingAdminController.getPlacementPlan),
);
router.get(
  "/openclaw/product-seeding/exposures",
  requireAdminPermission(["product_seeding.view"]),
  asyncHandler(productSeedingAdminController.listExposures),
);
router.get(
  "/openclaw/product-catalog/status",
  requireAdminPermission(["product_catalog_snapshot.view"]),
  asyncHandler(productSeedingAdminController.catalogStatus),
);
router.post(
  "/openclaw/product-catalog/rebuild",
  requireAdminPermission(["product_catalog_snapshot.rebuild"]),
  asyncHandler(productSeedingAdminController.rebuildCatalog),
);
router.get(
  "/openclaw/blog-schedules",
  requireAdminRole(["ADMIN", "SUPER_ADMIN"]),
  asyncHandler(blogAutomationScheduleController.listSchedules),
);
router.post(
  "/openclaw/blog-schedules",
  requireAdminRole(["ADMIN", "SUPER_ADMIN"]),
  asyncHandler(blogAutomationScheduleController.createSchedule),
);
router.get(
  "/openclaw/blog-schedules/:scheduleId",
  requireAdminRole(["ADMIN", "SUPER_ADMIN"]),
  asyncHandler(blogAutomationScheduleController.getSchedule),
);
router.patch(
  "/openclaw/blog-schedules/:scheduleId",
  requireAdminRole(["ADMIN", "SUPER_ADMIN"]),
  asyncHandler(blogAutomationScheduleController.updateSchedule),
);
router.delete(
  "/openclaw/blog-schedules/:scheduleId",
  requireAdminRole(["ADMIN", "SUPER_ADMIN"]),
  asyncHandler(blogAutomationScheduleController.deleteSchedule),
);
router.post(
  "/openclaw/blog-schedules/:scheduleId/enable",
  requireAdminRole(["ADMIN", "SUPER_ADMIN"]),
  asyncHandler(blogAutomationScheduleController.enableSchedule),
);
router.post(
  "/openclaw/blog-schedules/:scheduleId/disable",
  requireAdminRole(["ADMIN", "SUPER_ADMIN"]),
  asyncHandler(blogAutomationScheduleController.disableSchedule),
);
router.post(
  "/openclaw/blog-schedules/:scheduleId/run-now",
  requireAdminRole(["ADMIN", "SUPER_ADMIN"]),
  asyncHandler(blogAutomationScheduleController.runNow),
);
router.get(
  "/openclaw/blog-schedules/:scheduleId/executions",
  requireAdminRole(["ADMIN", "SUPER_ADMIN"]),
  asyncHandler(blogAutomationScheduleController.listExecutions),
);
router.get(
  "/openclaw/runs/:runId",
  requireAdminRole(["ADMIN", "SUPER_ADMIN"]),
  asyncHandler(openclawDashboardController.getRun),
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
