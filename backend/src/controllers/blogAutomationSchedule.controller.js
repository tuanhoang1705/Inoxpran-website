'use strict'

const { SuccessResponse, CREATED } = require('../core/success.response');
const { BlogAutomationScheduleService } = require('../services/blogAutomationSchedule.service');

class BlogAutomationScheduleController {
    listSchedules = async (req, res) => {
        new SuccessResponse({
            message: 'Get OpenClaw blog schedules success',
            metadata: await BlogAutomationScheduleService.listSchedules(req.query || {})
        }).send(res);
    };

    getSchedule = async (req, res) => {
        new SuccessResponse({
            message: 'Get OpenClaw blog schedule success',
            metadata: await BlogAutomationScheduleService.getSchedule({
                scheduleId: req.params.scheduleId
            })
        }).send(res);
    };

    createSchedule = async (req, res) => {
        new CREATED({
            message: 'Create OpenClaw blog schedule success',
            metadata: await BlogAutomationScheduleService.createSchedule({
                payload: req.body || {},
                adminId: req.user?.userId
            })
        }).send(res);
    };

    updateSchedule = async (req, res) => {
        new SuccessResponse({
            message: 'Update OpenClaw blog schedule success',
            metadata: await BlogAutomationScheduleService.updateSchedule({
                scheduleId: req.params.scheduleId,
                payload: req.body || {}
            })
        }).send(res);
    };

    deleteSchedule = async (req, res) => {
        new SuccessResponse({
            message: 'Delete OpenClaw blog schedule success',
            metadata: await BlogAutomationScheduleService.deleteSchedule({
                scheduleId: req.params.scheduleId
            })
        }).send(res);
    };

    enableSchedule = async (req, res) => {
        new SuccessResponse({
            message: 'Enable OpenClaw blog schedule success',
            metadata: await BlogAutomationScheduleService.setEnabled({
                scheduleId: req.params.scheduleId,
                enabled: true
            })
        }).send(res);
    };

    disableSchedule = async (req, res) => {
        new SuccessResponse({
            message: 'Disable OpenClaw blog schedule success',
            metadata: await BlogAutomationScheduleService.setEnabled({
                scheduleId: req.params.scheduleId,
                enabled: false
            })
        }).send(res);
    };

    runNow = async (req, res) => {
        new CREATED({
            statusCode: 202,
            message: 'Run OpenClaw blog schedule queued',
            metadata: await BlogAutomationScheduleService.runNow({
                scheduleId: req.params.scheduleId,
                idempotencyKey: req.get('Idempotency-Key'),
                adminId: req.user?.userId,
                requestId: req.requestId
            })
        }).send(res);
    };

    listExecutions = async (req, res) => {
        new SuccessResponse({
            message: 'Get OpenClaw blog schedule executions success',
            metadata: await BlogAutomationScheduleService.listExecutions({
                scheduleId: req.params.scheduleId,
                limit: req.query?.limit
            })
        }).send(res);
    };

    listExecutionSummaries = async (req, res) => {
        new SuccessResponse({
            message: 'Get OpenClaw blog schedule execution summaries success',
            metadata: await BlogAutomationScheduleService.listExecutionSummaries({
                scheduleIds: req.query?.scheduleIds,
                limit: req.query?.limit
            })
        }).send(res);
    };

    getTopicRoadmap = async (req, res) => {
        new SuccessResponse({
            message: 'Get OpenClaw Blog topic roadmap success',
            metadata: await BlogAutomationScheduleService.getTopicRoadmap({
                scheduleId: req.params.scheduleId,
                limit: req.query?.limit
            })
        }).send(res);
    };

    regenerateTopicRoadmap = async (req, res) => {
        new CREATED({
            statusCode: 202,
            message: 'Regenerate OpenClaw Blog topic roadmap queued',
            metadata: await BlogAutomationScheduleService.regenerateTopicRoadmap({
                scheduleId: req.params.scheduleId,
                idempotencyKey: req.get('Idempotency-Key'),
                adminId: req.user?.userId,
                requestId: req.requestId,
                reason: req.body?.reason
            })
        }).send(res);
    };

    dismissTopicRoadmapItem = async (req, res) => {
        new SuccessResponse({
            message: 'Dismiss OpenClaw Blog topic roadmap item success',
            metadata: await BlogAutomationScheduleService.dismissTopicRoadmapItem({
                scheduleId: req.params.scheduleId,
                itemId: req.params.itemId,
                reason: req.body?.reason
            })
        }).send(res);
    };
}

module.exports = new BlogAutomationScheduleController();
