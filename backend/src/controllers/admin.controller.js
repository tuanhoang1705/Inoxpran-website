"use strict";

const AdminService = require("../services/admin.service");
const { SuccessResponse, CREATED } = require("../core/success.response");
const {
  registerLiveSupportListener,
} = require("../services/liveSupportEvent.service");
const {
  cleanupPendingStorageSession,
  registerPendingStorageUpload,
} = require("../services/pendingStorageUpload.service");

const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  "x-accel-buffering": "no",
};

const writeSseEvent = (res, event, data) => {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
  if (typeof res.flush === "function") {
    res.flush();
  }
};

class AdminController {
  signUp = async (req, res, next) => {
    new CREATED({
      message: "Registered OK!",
      metadata: await AdminService.signUp(req.body),
    }).send(res);
  };

  login = async (req, res, next) => {
    new SuccessResponse({
      message: "Login success",
      metadata: await AdminService.login(req.body),
    }).send(res);
  };

  logout = async (req, res, next) => {
    new SuccessResponse({
      message: "Logout success!",
      metadata: await AdminService.logout(
        req.keyStore,
        req.keyPair,
        req.refreshToken,
      ),
    }).send(res);
  };

  handlerRefreshToken = async (req, res, next) => {
    new SuccessResponse({
      message: "Get token success!",
      metadata: await AdminService.handlerRefreshTokenV2({
        refreshToken: req.refreshToken,
        user: req.user,
        keyStore: req.keyStore,
        keyPair: req.keyPair,
      }),
    }).send(res);
  };

  getProfile = async (req, res, next) => {
    new SuccessResponse({
      message: "Get profile success",
      metadata: await AdminService.getProfile({ adminId: req.user.userId }),
    }).send(res);
  };

  getWebPushConfig = async (req, res, next) => {
    new SuccessResponse({
      message: "Get web push config success",
      metadata: await AdminService.getWebPushConfig({
        adminId: req.user.userId,
      }),
    }).send(res);
  };

  updateProfile = async (req, res, next) => {
    new SuccessResponse({
      message: "Update profile success",
      metadata: await AdminService.updateProfile({
        adminId: req.user.userId,
        payload: req.body,
      }),
    }).send(res);
  };

  registerWebPushSubscription = async (req, res, next) => {
    new SuccessResponse({
      message: "Register web push subscription success",
      metadata: await AdminService.registerWebPushSubscription({
        adminId: req.user?.userId,
        payload: req.body,
        userAgent: req.headers["user-agent"],
      }),
    }).send(res);
  };

  unregisterWebPushSubscription = async (req, res, next) => {
    new SuccessResponse({
      message: "Unregister web push subscription success",
      metadata: await AdminService.unregisterWebPushSubscription({
        adminId: req.user?.userId,
        payload: req.body,
      }),
    }).send(res);
  };

  getAdminById = async (req, res, next) => {
    new SuccessResponse({
      message: "Get admin success",
      metadata: await AdminService.getAdminById({
        adminId: req.params.adminId,
      }),
    }).send(res);
  };

  listAdminAccounts = async (req, res, next) => {
    new SuccessResponse({
      message: "Get admin accounts success",
      metadata: await AdminService.listAdminAccounts(req.query),
    }).send(res);
  };

  listLiveSupportConsultants = async (req, res, next) => {
    new SuccessResponse({
      message: "List live-support consultants success",
      metadata: await AdminService.listLiveSupportConsultants(),
    }).send(res);
  };

  listAdminAuditLogs = async (req, res, next) => {
    new SuccessResponse({
      message: "Get admin audit logs success",
      metadata: await AdminService.listAdminAuditLogs(req.query),
    }).send(res);
  };

  updateAdminAccount = async (req, res, next) => {
    new SuccessResponse({
      message: "Update admin account success",
      metadata: await AdminService.updateAdminAccount({
        adminId: req.params.adminId,
        payload: req.body,
        actorAdminId: req.user?.userId,
      }),
    }).send(res);
  };

  deleteAdminAccount = async (req, res, next) => {
    new SuccessResponse({
      message: "Delete admin account success",
      metadata: await AdminService.deleteAdminAccount({
        adminId: req.params.adminId,
        actorAdminId: req.user?.userId,
      }),
    }).send(res);
  };

  getDashboardSummary = async (req, res, next) => {
    new SuccessResponse({
      message: "Get dashboard summary success",
      metadata: await AdminService.getDashboardSummary(),
    }).send(res);
  };

  getHomeSlides = async (req, res, next) => {
    new SuccessResponse({
      message: "Get home slides success",
      metadata: await AdminService.getHomeSlides(),
    }).send(res);
  };

  updateHomeSlides = async (req, res, next) => {
    new SuccessResponse({
      message: "Update home slides success",
      metadata: await AdminService.updateHomeSlides({
        slides: req.body?.slides,
        adminId: req.user?.userId,
      }),
    }).send(res);
  };

  listUsers = async (req, res, next) => {
    new SuccessResponse({
      message: "Get users success",
      metadata: await AdminService.listUsers(req.query),
    }).send(res);
  };

  listAnonymousVisitors = async (req, res, next) => {
    new SuccessResponse({
      message: "Get anonymous visitors success",
      metadata: await AdminService.listAnonymousVisitors(req.query),
    }).send(res);
  };

  getAnonymousVisitorBySession = async (req, res, next) => {
    new SuccessResponse({
      message: "Get anonymous visitor success",
      metadata: await AdminService.getAnonymousVisitorBySession({
        sessionId: req.params.sessionId,
      }),
    }).send(res);
  };

  listLeads = async (req, res, next) => {
    new SuccessResponse({
      message: "Get leads success",
      metadata: await AdminService.listLeads(req.query),
    }).send(res);
  };

  getLeadById = async (req, res, next) => {
    new SuccessResponse({
      message: "Get lead success",
      metadata: await AdminService.getLeadById({ leadId: req.params.leadId }),
    }).send(res);
  };

  updateLead = async (req, res, next) => {
    new SuccessResponse({
      message: "Update lead success",
      metadata: await AdminService.updateLead({
        leadId: req.params.leadId,
        payload: req.body,
        adminId: req.user?.userId,
      }),
    }).send(res);
  };

  listChatRooms = async (req, res, next) => {
    new SuccessResponse({
      message: "Get chat rooms success",
      metadata: await AdminService.listChatRooms({
        ...req.query,
        adminId: req.user?.userId,
      }),
    }).send(res);
  };

  streamChatRooms = async (req, res, next) => {
    res.writeHead(200, SSE_HEADERS);
    if (typeof res.flushHeaders === "function") {
      res.flushHeaders();
    }
    req.socket?.setTimeout?.(0);

    const unsubscribe = registerLiveSupportListener({
      adminId: req.user?.userId,
      onEvent: (event) => {
        writeSseEvent(res, "room", event);
      },
    });

    const heartbeat = setInterval(() => {
      writeSseEvent(res, "ping", { at: new Date().toISOString() });
    }, 15000);

    writeSseEvent(res, "ready", {
      scope: "chat-rooms",
      adminId: req.user?.userId || null,
      at: new Date().toISOString(),
    });

    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    });
  };

  getChatRoomBySession = async (req, res, next) => {
    new SuccessResponse({
      message: "Get chat room success",
      metadata: await AdminService.getChatRoomBySession({
        sessionId: req.params.sessionId,
        messageLimit: req.query?.messageLimit,
        adminId: req.user?.userId,
        markRead: req.query?.markRead,
      }),
    }).send(res);
  };

  streamChatRoomBySession = async (req, res, next) => {
    res.writeHead(200, SSE_HEADERS);
    if (typeof res.flushHeaders === "function") {
      res.flushHeaders();
    }
    req.socket?.setTimeout?.(0);

    const unsubscribe = registerLiveSupportListener({
      adminId: req.user?.userId,
      sessionId: req.params.sessionId,
      onEvent: (event) => {
        writeSseEvent(res, "room", event);
      },
    });

    const heartbeat = setInterval(() => {
      writeSseEvent(res, "ping", {
        at: new Date().toISOString(),
        sessionId: req.params.sessionId,
      });
    }, 15000);

    writeSseEvent(res, "ready", {
      scope: "chat-room",
      sessionId: req.params.sessionId,
      adminId: req.user?.userId || null,
      at: new Date().toISOString(),
    });

    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    });
  };

  updateChatRoom = async (req, res, next) => {
    new SuccessResponse({
      message: "Update chat room success",
      metadata: await AdminService.updateChatRoom({
        sessionId: req.params.sessionId,
        payload: req.body,
        adminId: req.user?.userId,
      }),
    }).send(res);
  };

  deleteChatRoom = async (req, res, next) => {
    new SuccessResponse({
      message: "Delete chat room success",
      metadata: await AdminService.deleteChatRoom({
        sessionId: req.params.sessionId,
        adminId: req.user?.userId,
      }),
    }).send(res);
  };

  getUserById = async (req, res, next) => {
    new SuccessResponse({
      message: "Get user success",
      metadata: await AdminService.getUserById({ userId: req.params.userId }),
    }).send(res);
  };

  updateUserStatus = async (req, res, next) => {
    new SuccessResponse({
      message: "Update user status success",
      metadata: await AdminService.updateUserStatus({
        userId: req.params.userId,
        status: req.body.status,
      }),
    }).send(res);
  };

  sendUserResetPasswordEmail = async (req, res, next) => {
    new SuccessResponse({
      message: "Password reset email sent",
      metadata: await AdminService.sendUserResetPasswordEmail({
        userId: req.params.userId,
        locale: req.body?.locale,
      }),
    }).send(res);
  };

  deleteUser = async (req, res, next) => {
    new SuccessResponse({
      message: "User deleted",
      metadata: await AdminService.deleteUser({
        userId: req.params.userId,
      }),
    }).send(res);
  };

  uploadDescriptionImage = async (req, res, next) => {
    const imageUrl = req.body?.image;
    if (!imageUrl) {
      return res.status(400).json({
        message: "Image upload failed",
      });
    }
    await registerPendingStorageUpload({
      ownerId: req.user?.userId,
      sessionId: req.body?.upload_session_id,
      entityType: req.body?.entity_type,
      url: imageUrl,
      path: req.body?.image_path,
      variants: req.body?.image_variants,
    });
    new SuccessResponse({
      message: "Upload description image success",
      metadata: {
        url: imageUrl,
        path: req.body?.image_path,
      },
    }).send(res);
  };

  cleanupPendingUploads = async (req, res, next) => {
    new SuccessResponse({
      message: "Pending uploads cleaned",
      metadata: await cleanupPendingStorageSession({
        ownerId: req.user?.userId,
        sessionId: req.params.sessionId,
      }),
    }).send(res);
  };

  uploadHomeSlideImage = async (req, res, next) => {
    const imageUrl = req.body?.image;
    if (!imageUrl) {
      return res.status(400).json({
        message: "Slide image upload failed",
      });
    }
    new SuccessResponse({
      message: "Upload home slide image success",
      metadata: {
        url: imageUrl,
        path: req.body?.image_path,
        variants: req.body?.image_variants || null,
      },
    }).send(res);
  };

  listPendingAdmins = async (req, res, next) => {
    new SuccessResponse({
      message: "Get pending admins success",
      metadata: await AdminService.listPendingAdmins(),
    }).send(res);
  };

  approveAdmin = async (req, res, next) => {
    new SuccessResponse({
      message: "Admin approved successfully",
      metadata: await AdminService.approveAdmin({
        adminId: req.params.adminId,
        approvedBy: req.user.userId,
        note: req.body?.note,
        roles: req.body?.roles,
      }),
    }).send(res);
  };

  rejectAdmin = async (req, res, next) => {
    new SuccessResponse({
      message: "Admin rejected successfully",
      metadata: await AdminService.rejectAdmin({
        adminId: req.params.adminId,
        rejectionReason: req.body?.reason,
      }),
    }).send(res);
  };
}

module.exports = new AdminController();
