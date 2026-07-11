'use strict'

const { SuccessResponse, CREATED } = require('../core/success.response');
const { GoogleIntelligenceService } = require('../services/googleIntelligence.service');

class GoogleIntelligenceController {
    getStatus = async (req, res) => new SuccessResponse({
        message: 'Get Google Intelligence status success',
        metadata: await GoogleIntelligenceService.getStatus()
    }).send(res);

    listSnapshots = async (req, res) => new SuccessResponse({
        message: 'Get Google Intelligence snapshots success',
        metadata: await GoogleIntelligenceService.listSnapshots(req.query || {})
    }).send(res);

    getSnapshot = async (req, res) => new SuccessResponse({
        message: 'Get Google Intelligence snapshot success',
        metadata: await GoogleIntelligenceService.getSnapshot({ snapshotId: req.params.snapshotId })
    }).send(res);

    runNow = async (req, res) => new CREATED({
        message: 'Google Intelligence run completed',
        metadata: await GoogleIntelligenceService.runNow({ adminId: req.user?.userId })
    }).send(res);

    listSources = async (req, res) => new SuccessResponse({
        message: 'Get Google Intelligence sources success',
        metadata: await GoogleIntelligenceService.listSources()
    }).send(res);

    createSource = async (req, res) => new CREATED({
        message: 'Create Google Intelligence source success',
        metadata: await GoogleIntelligenceService.createSource({ payload: req.body || {} })
    }).send(res);

    updateSource = async (req, res) => new SuccessResponse({
        message: 'Update Google Intelligence source success',
        metadata: await GoogleIntelligenceService.updateSource({ sourceId: req.params.sourceId, payload: req.body || {} })
    }).send(res);

    runSourceNow = async (req, res) => new CREATED({
        message: 'Google Intelligence source check completed',
        metadata: await GoogleIntelligenceService.runSourceNow({ sourceId: req.params.sourceId })
    }).send(res);

    getSchedule = async (req, res) => new SuccessResponse({
        message: 'Get Google Intelligence schedule success',
        metadata: await GoogleIntelligenceService.getSchedule()
    }).send(res);

    updateSchedule = async (req, res) => new SuccessResponse({
        message: 'Update Google Intelligence schedule success',
        metadata: await GoogleIntelligenceService.updateSchedule({ payload: req.body || {}, adminId: req.user?.userId })
    }).send(res);

    enableSchedule = async (req, res) => new SuccessResponse({
        message: 'Enable Google Intelligence schedule success',
        metadata: await GoogleIntelligenceService.setScheduleEnabled({ enabled: true, adminId: req.user?.userId })
    }).send(res);

    disableSchedule = async (req, res) => new SuccessResponse({
        message: 'Disable Google Intelligence schedule success',
        metadata: await GoogleIntelligenceService.setScheduleEnabled({ enabled: false, adminId: req.user?.userId })
    }).send(res);

    overrideSnapshot = async (req, res) => new SuccessResponse({
        message: 'Override Google Intelligence gate success',
        metadata: await GoogleIntelligenceService.overrideSnapshot({
            snapshotId: req.params.snapshotId,
            reason: req.body?.reason,
            adminId: req.user?.userId
        })
    }).send(res);

    listExecutions = async (req, res) => new SuccessResponse({
        message: 'Get Google Intelligence executions success',
        metadata: await GoogleIntelligenceService.listExecutions(req.query || {})
    }).send(res);
}

module.exports = new GoogleIntelligenceController();
