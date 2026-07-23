'use strict'

const express = require('express')
const asyncHandler = require('../../helpers/asyncHandler')
const controller = require('../../controllers/agenticBlogQa.controller')
const { requireAdminPermission } = require('../../middleware/requireAdminRole')

const router = express.Router()

router.post(
  '/qa-batches',
  requireAdminPermission(['agentic_blog_qa.run']),
  asyncHandler(controller.createBatch)
)
router.get(
  '/qa-batches',
  requireAdminPermission(['agentic_blog_qa.view']),
  asyncHandler(controller.listBatches)
)
router.get(
  '/qa-batches/:id',
  requireAdminPermission(['agentic_blog_qa.view']),
  asyncHandler(controller.getBatch)
)
router.post(
  '/qa-batches/:id/run',
  requireAdminPermission(['agentic_blog_qa.run']),
  asyncHandler(controller.runBatch)
)
router.post(
  '/qa-batches/:id/review',
  requireAdminPermission(['agentic_blog_qa.review']),
  asyncHandler(controller.reviewBatch)
)
router.get(
  '/qa-batches/:id/reports',
  requireAdminPermission(['agentic_blog_qa.view']),
  asyncHandler(controller.getReports)
)
router.post(
  '/qa-batches/:id/remediate',
  requireAdminPermission(['agentic_blog_qa.remediate']),
  asyncHandler(controller.planRemediation)
)
router.post(
  '/qa-batches/:id/remediation/:attemptId/resume',
  requireAdminPermission(['agentic_blog_qa.remediate']),
  asyncHandler(controller.resumeRemediation)
)

module.exports = router
