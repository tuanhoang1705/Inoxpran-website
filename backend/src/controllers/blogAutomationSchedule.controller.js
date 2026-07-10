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
            message: 'Run OpenClaw blog schedule success',
            metadata: await BlogAutomationScheduleService.runNow({
                scheduleId: req.params.scheduleId
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
}

module.exports = new BlogAutomationScheduleController();
