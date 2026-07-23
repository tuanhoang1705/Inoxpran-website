"use strict";

const { SuccessResponse } = require("../core/success.response");
const { BadRequestError } = require("../core/error.response");
const {
  openClawRuntimeControlService,
} = require("../services/openclawRuntimeControl.service");

const canManageRuntimeControls = (req) => {
  const roles = new Set(Array.isArray(req.adminRoles) ? req.adminRoles : []);
  if (roles.has("SUPER_ADMIN")) return true;
  return (
    Array.isArray(req.adminPermissions) &&
    req.adminPermissions.includes("openclaw_runtime_control.manage")
  );
};

const assertEmptyQuery = (req) => {
  if (
    req?.query != null &&
    (typeof req.query !== "object" ||
      Array.isArray(req.query) ||
      Object.keys(req.query).length)
  ) {
    throw new BadRequestError(
      "OpenClaw runtime control query parameters are not supported",
    );
  }
};

const exactUpdateBody = (body) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new BadRequestError(
      "OpenClaw runtime control body must be a JSON object",
    );
  }
  const keys = Object.keys(body).sort();
  const expected = ["acknowledgement", "enabled", "expectedRevision", "reason"];
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index])
  ) {
    throw new BadRequestError(
      "OpenClaw runtime control body contains invalid fields",
    );
  }
  return body;
};

class OpenClawRuntimeControlController {
  getControls = async (req, res) => {
    assertEmptyQuery(req);
    new SuccessResponse({
      message: "Get OpenClaw runtime controls success",
      metadata: await openClawRuntimeControlService.list({
        canManage: canManageRuntimeControls(req),
      }),
    }).send(res);
  };

  updateControl = async (req, res) => {
    assertEmptyQuery(req);
    new SuccessResponse({
      message: "Update OpenClaw runtime control success",
      metadata: await openClawRuntimeControlService.update({
        controlKey: req.params.controlKey,
        payload: exactUpdateBody(req.body),
        adminId: req.user?.userId,
        idempotencyKey: req.get("Idempotency-Key"),
        canManage: canManageRuntimeControls(req),
      }),
    }).send(res);
  };
}

module.exports = new OpenClawRuntimeControlController();
module.exports.OpenClawRuntimeControlController =
  OpenClawRuntimeControlController;
module.exports.assertEmptyQuery = assertEmptyQuery;
module.exports.canManageRuntimeControls = canManageRuntimeControls;
module.exports.exactUpdateBody = exactUpdateBody;
