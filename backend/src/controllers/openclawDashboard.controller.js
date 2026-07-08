'use strict'

const { SuccessResponse, CREATED } = require('../core/success.response');
const { OpenClawDashboardService } = require('../services/openclawDashboard.service');

class OpenClawDashboardController {
    getDashboard = async (req, res) => {
        new SuccessResponse({
            message: 'Get OpenClaw dashboard success',
            metadata: OpenClawDashboardService.dashboard()
        }).send(res);
    };

    listRuns = async (req, res) => {
        new SuccessResponse({
            message: 'Get OpenClaw runs success',
            metadata: OpenClawDashboardService.listRuns()
        }).send(res);
    };

    getRun = async (req, res) => {
        new SuccessResponse({
            message: 'Get OpenClaw run success',
            metadata: OpenClawDashboardService.getRun({ runId: req.params.runId })
        }).send(res);
    };

    startRun = async (req, res) => {
        new CREATED({
            message: 'OpenClaw run started',
            metadata: OpenClawDashboardService.startRun({
                action: req.body?.action,
                profile: req.body?.profile
            })
        }).send(res);
    };
}

module.exports = new OpenClawDashboardController();
