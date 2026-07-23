'use strict';

const { SuccessResponse, CREATED } = require('../core/success.response');
const { BadRequestError } = require('../core/error.response');
const { OpenClawDashboardService } = require('../services/openclawDashboard.service');
const { OpenClawCapabilityHealthService } = require('../services/openclawCapabilityHealth.service');

const canCheckCapabilities = (req) => {
    const roles = new Set(Array.isArray(req.adminRoles) ? req.adminRoles : []);
    if (roles.has('ADMIN') || roles.has('SUPER_ADMIN')) return true;
    return Array.isArray(req.adminPermissions) && req.adminPermissions.includes('openclaw_capability.check');
};

const withCapabilityAccess = (req, health) => ({
    ...health,
    actions: { check: canCheckCapabilities(req) }
});

const assertEmptyQuery = (req) => {
    const query = req?.query;
    if (query != null && (typeof query !== 'object' || Array.isArray(query) || Object.keys(query).length)) {
        throw new BadRequestError('OpenClaw dashboard query parameters are not supported');
    }
};

const assertEmptyBody = (req) => {
    const body = req?.body;
    if (body === undefined) return;
    if (body === null || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) {
        throw new BadRequestError('OpenClaw capability request body must be empty');
    }
};

const exactRunRequest = (body) => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new BadRequestError('OpenClaw run body must be a JSON object');
    }
    const keys = Object.keys(body).sort();
    if (keys.length !== 2 || keys[0] !== 'action' || keys[1] !== 'profile') {
        throw new BadRequestError('OpenClaw run body must contain exactly action and profile');
    }
    if (typeof body.action !== 'string' || typeof body.profile !== 'string') {
        throw new BadRequestError('OpenClaw run action and profile must be strings');
    }
    return { action: body.action, profile: body.profile };
};

class OpenClawDashboardController {
    getDashboard = async (req, res) => {
        assertEmptyQuery(req);
        const dashboard = await OpenClawDashboardService.dashboard();
        dashboard.capabilityHealth = withCapabilityAccess(req, dashboard.capabilityHealth || {});
        new SuccessResponse({
            message: 'Get OpenClaw dashboard success',
            metadata: dashboard
        }).send(res);
    };

    getCapabilityStatus = async (req, res) => {
        assertEmptyQuery(req);
        new SuccessResponse({
            message: 'Get OpenClaw capability health success',
            metadata: withCapabilityAccess(req, await OpenClawCapabilityHealthService.getStatus())
        }).send(res);
    };

    checkCapabilities = async (req, res) => {
        assertEmptyQuery(req);
        assertEmptyBody(req);
        new SuccessResponse({
            message: 'Check OpenClaw capabilities success',
            metadata: withCapabilityAccess(req, await OpenClawCapabilityHealthService.checkAll())
        }).send(res);
    };

    checkCapability = async (req, res) => {
        assertEmptyQuery(req);
        assertEmptyBody(req);
        new SuccessResponse({
            message: 'Check OpenClaw capability success',
            metadata: await OpenClawCapabilityHealthService.checkOne({
                featureKey: req.params.featureKey
            })
        }).send(res);
    };

    listRuns = async (req, res) => {
        assertEmptyQuery(req);
        new SuccessResponse({
            message: 'Get OpenClaw runs success',
            metadata: await OpenClawDashboardService.listRuns()
        }).send(res);
    };

    getRun = async (req, res) => {
        assertEmptyQuery(req);
        new SuccessResponse({
            message: 'Get OpenClaw run success',
            metadata: await OpenClawDashboardService.getRun({
                runId: req.params.runId
            })
        }).send(res);
    };

    startRun = async (req, res) => {
        assertEmptyQuery(req);
        const request = exactRunRequest(req.body);
        new CREATED({
            message: 'OpenClaw run started',
            metadata: await OpenClawDashboardService.startRun({
                action: request.action,
                profile: request.profile,
                idempotencyKey: req.get('Idempotency-Key'),
                principalId: req.user?.userId
            })
        }).send(res);
    };
}

module.exports = new OpenClawDashboardController();
module.exports.canCheckCapabilities = canCheckCapabilities;
module.exports.assertEmptyBody = assertEmptyBody;
module.exports.assertEmptyQuery = assertEmptyQuery;
module.exports.exactRunRequest = exactRunRequest;
