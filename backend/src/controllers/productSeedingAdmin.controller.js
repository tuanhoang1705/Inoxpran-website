'use strict'

const { SuccessResponse, CREATED } = require('../core/success.response');
const { ProductSeedingAdminService } = require('../services/productSeedingAdmin.service');

class ProductSeedingAdminController {
    getConfig = async (req, res) => new SuccessResponse({ message: 'Get product seeding config success', metadata: await ProductSeedingAdminService.getConfig() }).send(res);
    updateConfig = async (req, res) => new SuccessResponse({ message: 'Update product seeding config success', metadata: await ProductSeedingAdminService.updateConfig({ payload: req.body || {}, adminId: req.user?.userId }) }).send(res);
    preview = async (req, res) => new SuccessResponse({ message: 'Preview product matching success', metadata: await ProductSeedingAdminService.preview({ payload: req.body || {} }) }).send(res);
    listPlans = async (req, res) => new SuccessResponse({ message: 'Get product seed plans success', metadata: await ProductSeedingAdminService.listPlans(req.query || {}) }).send(res);
    getPlan = async (req, res) => new SuccessResponse({ message: 'Get product seed plan success', metadata: await ProductSeedingAdminService.getPlan({ planId: req.params.id }) }).send(res);
    listPlacementPlans = async (req, res) => new SuccessResponse({ message: 'Get editorial product placement plans success', metadata: await ProductSeedingAdminService.listPlacementPlans(req.query || {}) }).send(res);
    getPlacementPlan = async (req, res) => new SuccessResponse({ message: 'Get editorial product placement plan success', metadata: await ProductSeedingAdminService.getPlacementPlan({ planId: req.params.id }) }).send(res);
    listExposures = async (req, res) => new SuccessResponse({ message: 'Get product seed exposures success', metadata: await ProductSeedingAdminService.listExposures(req.query || {}) }).send(res);
    catalogStatus = async (req, res) => new SuccessResponse({ message: 'Get product catalog snapshot status success', metadata: await ProductSeedingAdminService.catalogStatus() }).send(res);
    rebuildCatalog = async (req, res) => new CREATED({ message: 'Rebuild product catalog snapshot success', metadata: await ProductSeedingAdminService.rebuildCatalog() }).send(res);
}

module.exports = new ProductSeedingAdminController();
