'use strict'

const { OK, CREATED } = require('../core/success.response')
const { BadRequestError } = require('../core/error.response')
const { ContentOperationsAdminService } = require('../services/contentOperations/contentOperationsAdmin.service')
const { OpenClawCapabilityHealthService } = require('../services/openclawCapabilityHealth.service')

const hasCapabilityViewPermission = req => (
    (Array.isArray(req?.adminPermissions) && req.adminPermissions.includes('openclaw_capability.view'))
    || (Array.isArray(req?.adminRoles) && req.adminRoles.some(role => ['ADMIN', 'SUPER_ADMIN'].includes(role)))
)

class ContentOperationsController {
    status = async (req, res) => {
        const status = await ContentOperationsAdminService.getStatus()
        if (!hasCapabilityViewPermission(req)) {
            const contentOperationsStatus = { ...(status || {}) }
            delete contentOperationsStatus.capabilityHealth
            return new OK({ metadata: contentOperationsStatus }).send(res)
        }
        const capabilityHealth = await OpenClawCapabilityHealthService.getStatus()
        return new OK({ metadata: { ...status, capabilityHealth } }).send(res)
    }
    preview = async (req, res) => new CREATED({ metadata: await ContentOperationsAdminService.preview({ payload: req.body || {}, adminId: req.user.userId }) }).send(res)
    runNow = async (req, res) => new CREATED({ metadata: await ContentOperationsAdminService.runNow({ payload: req.body || {}, adminId: req.user.userId }) }).send(res)

    listSnapshots = async (req, res) => new OK({ metadata: await ContentOperationsAdminService.listSnapshots(req.query) }).send(res)
    getSnapshot = async (req, res) => new OK({ metadata: await ContentOperationsAdminService.getSnapshot(req.params.snapshotId) }).send(res)

    listOpportunities = async (req, res) => new OK({ metadata: await ContentOperationsAdminService.listOpportunities(req.query) }).send(res)
    getOpportunity = async (req, res) => new OK({ metadata: await ContentOperationsAdminService.getOpportunity(req.params.opportunityId) }).send(res)
    updateOpportunity = async (req, res) => {
        const status = String(req.body?.status || '')
        const operation = status === 'dismissed' ? 'dismiss' : status === 'accepted' ? 'accept' : status === 'converted' ? 'convert' : ''
        if (!operation) throw new BadRequestError('status must be accepted, dismissed, or converted')
        const { status: _status, ...payload } = req.body || {}
        return new OK({ metadata: await ContentOperationsAdminService.transitionOpportunity({
            id: req.params.opportunityId, operation, payload, adminId: req.user.userId, ip: req.ip
        }) }).send(res)
    }
    transitionOpportunity = async (req, res) => new OK({ metadata: await ContentOperationsAdminService.transitionOpportunity({
        id: req.params.opportunityId, operation: req.params.operation, payload: req.body || {}, adminId: req.user.userId, ip: req.ip
    }) }).send(res)

    listWorkOrders = async (req, res) => new OK({ metadata: await ContentOperationsAdminService.listWorkOrders(req.query) }).send(res)
    createWorkOrder = async (req, res) => new CREATED({ metadata: await ContentOperationsAdminService.createWorkOrder({
        payload: req.body || {}, adminId: req.user.userId, ip: req.ip
    }) }).send(res)
    getWorkOrder = async (req, res) => new OK({ metadata: await ContentOperationsAdminService.getWorkOrder(req.params.workOrderId) }).send(res)
    updateWorkOrder = async (req, res) => new OK({ metadata: await ContentOperationsAdminService.updateWorkOrder({
        id: req.params.workOrderId, payload: req.body || {}, adminId: req.user.userId, ip: req.ip
    }) }).send(res)
    approveWorkOrder = async (req, res) => new OK({ metadata: await ContentOperationsAdminService.approveWorkOrder({
        id: req.params.workOrderId, payload: req.body || {}, adminId: req.user.userId, ip: req.ip
    }) }).send(res)
    runWorkOrder = async (req, res) => new CREATED({ metadata: await ContentOperationsAdminService.runWorkOrder({
        id: req.params.workOrderId, payload: req.body || {}, adminId: req.user.userId, ip: req.ip
    }) }).send(res)

    listSignals = async (req, res) => new OK({ metadata: await ContentOperationsAdminService.listSignals(req.query) }).send(res)
    createSignal = async (req, res) => new CREATED({ metadata: await ContentOperationsAdminService.createSignal({
        payload: req.body || {}, adminId: req.user.userId, ip: req.ip
    }) }).send(res)
    updateSignal = async (req, res) => new OK({ metadata: await ContentOperationsAdminService.updateSignal({
        id: req.params.signalId, payload: req.body || {}, adminId: req.user.userId, ip: req.ip
    }) }).send(res)

    inventory = async (req, res) => new OK({ metadata: await ContentOperationsAdminService.getInventory(req.query) }).send(res)
    rebuildInventory = async (req, res) => new CREATED({ metadata: await ContentOperationsAdminService.rebuildInventory({
        adminId: req.user.userId, ip: req.ip
    }) }).send(res)

    performance = async (req, res) => new OK({ metadata: await ContentOperationsAdminService.getPerformance(req.params.blogId) }).send(res)
    learning = async (req, res) => new OK({ metadata: await ContentOperationsAdminService.getLearning(req.params.blogId) }).send(res)

    schedule = async (_req, res) => new OK({ metadata: await ContentOperationsAdminService.getSchedule() }).send(res)
    updateSchedule = async (req, res) => new OK({ metadata: await ContentOperationsAdminService.updateSchedule({
        payload: req.body || {}, adminId: req.user.userId, ip: req.ip
    }) }).send(res)
    enableSchedule = async (req, res) => new OK({ metadata: await ContentOperationsAdminService.toggleSchedule({ enabled: true, adminId: req.user.userId, ip: req.ip }) }).send(res)
    disableSchedule = async (req, res) => new OK({ metadata: await ContentOperationsAdminService.toggleSchedule({ enabled: false, adminId: req.user.userId, ip: req.ip }) }).send(res)
}

module.exports = new ContentOperationsController()
