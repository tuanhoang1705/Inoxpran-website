"use strict";

const { CREATED, SuccessResponse } = require("../core/success.response");
const {
  AgenticBlogQaBatchService,
} = require("../services/agenticBlogQa.service");

const service = new AgenticBlogQaBatchService();

const ALL_ACTIONS = Object.freeze([
  "view",
  "create",
  "run",
  "review",
  "remediate",
]);
const ACTION_SCOPES = Object.freeze({
  view: "agentic_blog_qa.view",
  create: "agentic_blog_qa.run",
  run: "agentic_blog_qa.run",
  review: "agentic_blog_qa.review",
  remediate: "agentic_blog_qa.remediate",
});

const allowedActionsForRequest = (req) => {
  const roles = new Set(Array.isArray(req.adminRoles) ? req.adminRoles : []);
  if (roles.has("ADMIN") || roles.has("SUPER_ADMIN")) return [...ALL_ACTIONS];
  const permissions = new Set(
    Array.isArray(req.adminPermissions) ? req.adminPermissions : [],
  );
  return ALL_ACTIONS.filter((action) => permissions.has(ACTION_SCOPES[action]));
};

class AgenticBlogQaController {
  constructor({ qaService = service } = {}) {
    this.service = qaService;
  }

  createBatch = async (req, res) => {
    new CREATED({
      message: "Create Agentic Blog QA batch success",
      metadata: await this.service.createBatch({
        payload: req.body,
        query: req.query,
        adminId: req.user?.userId,
        idempotencyKey: req.get("Idempotency-Key"),
      }),
    }).send(res);
  };

  listBatches = async (req, res) => {
    new SuccessResponse({
      message: "Get Agentic Blog QA batches success",
      metadata: await this.service.listBatches({
        query: req.query,
        actions: allowedActionsForRequest(req),
      }),
    }).send(res);
  };

  getBatch = async (req, res) => {
    new SuccessResponse({
      message: "Get Agentic Blog QA batch success",
      metadata: await this.service.getBatch({
        batchId: req.params.id,
        query: req.query,
      }),
    }).send(res);
  };

  runBatch = async (req, res) => {
    new CREATED({
      message: "Queue Agentic Blog QA batch success",
      metadata: await this.service.runBatch({
        batchId: req.params.id,
        payload: req.body,
        query: req.query,
        adminId: req.user?.userId,
        idempotencyKey: req.get("Idempotency-Key"),
        caseIds: null,
      }),
    }).send(res);
  };

  reviewBatch = async (req, res) => {
    new SuccessResponse({
      message: "Review Agentic Blog QA batch success",
      metadata: await this.service.reviewBatch({
        batchId: req.params.id,
        payload: req.body,
        query: req.query,
        adminId: req.user?.userId,
      }),
    }).send(res);
  };

  getReports = async (req, res) => {
    new SuccessResponse({
      message: "Get Senior Blog Acceptance reports success",
      metadata: await this.service.getReports({
        batchId: req.params.id,
        query: req.query,
      }),
    }).send(res);
  };

  planRemediation = async (req, res) => {
    new CREATED({
      message: "Plan Agentic Blog QA remediation success",
      metadata: await this.service.planRemediation({
        batchId: req.params.id,
        payload: req.body,
        query: req.query,
        adminId: req.user?.userId,
        idempotencyKey: req.get("Idempotency-Key"),
      }),
    }).send(res);
  };

  resumeRemediation = async (req, res) => {
    new CREATED({
      message: "Resume Agentic Blog QA remediation success",
      metadata: await this.service.resumeRemediation({
        batchId: req.params.id,
        attemptId: req.params.attemptId,
        payload: req.body,
        query: req.query,
        adminId: req.user?.userId,
      }),
    }).send(res);
  };
}

module.exports = new AgenticBlogQaController();
module.exports.AgenticBlogQaController = AgenticBlogQaController;
module.exports.allowedActionsForRequest = allowedActionsForRequest;
