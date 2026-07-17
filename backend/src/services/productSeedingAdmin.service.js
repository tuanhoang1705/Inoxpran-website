'use strict'

const Admin = require('../models/admin.model');
const AdminAuditLog = require('../models/adminAuditLog.model');
const { ProductSeedPlan } = require('../models/productSeedPlan.model');
const { ProductSeedExposure } = require('../models/productSeedExposure.model');
const { ProductSeedingConfigService } = require('./productSeedingConfig.service');
const { ProductSeedPlanningService } = require('./productSeedPlanning.service');
const { ProductCatalogIntelligenceService } = require('./productCatalogIntelligence.service');
const { BadRequestError, NotFoundError } = require('../core/error.response');

const pageValues = (query = {}) => ({
    page: Math.max(Number(query.page) || 1, 1),
    limit: Math.min(Math.max(Number(query.limit) || 20, 1), 100)
});
const snapshot = (admin) => ({
    adminId: admin?._id ? String(admin._id) : null,
    name: admin?.name || null,
    email: admin?.email || null,
    status: admin?.status || null,
    roles: admin?.roles || []
});

const recordConfigAudit = async ({ adminId, reason, before, after }) => {
    const admin = await Admin.findById(adminId).select('name email status roles').lean();
    if (!admin) return;
    await AdminAuditLog.create({
        category: 'product_seeding', action: 'product_seeding_config_updated',
        actorAdmin: admin._id, actorSnapshot: snapshot(admin),
        targetAdmin: admin._id, targetSnapshot: snapshot(admin),
        summary: `Product seeding configuration updated: ${String(reason).slice(0, 300)}`,
        metadata: {
            reason: String(reason).slice(0, 500),
            changedKeys: Object.keys(after).filter((key) => JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key]))
        }
    });
};

class ProductSeedingAdminService {
    static async getConfig() {
        return ProductSeedingConfigService.getConfig();
    }

    static async updateConfig({ payload, adminId }) {
        const reason = String(payload?.reason || '').trim();
        if (!reason) throw new BadRequestError('reason is required for product-seeding configuration changes');
        const before = await ProductSeedingConfigService.getConfig();
        const after = await ProductSeedingConfigService.updateConfig({ payload, adminId });
        await recordConfigAudit({ adminId, reason, before, after });
        return after;
    }

    static async preview({ payload = {} }) {
        const topic = String(payload.topic || payload.primaryKeyword || '').trim();
        if (!topic) throw new BadRequestError('topic is required');
        const googleIntelSnapshotId = String(payload.googleIntelSnapshotId || '000000000000000000000000');
        const plan = await ProductSeedPlanningService.createPlan({
            brief: { ...payload, topic }, googleIntelSnapshotId, persist: false
        });
        return {
            mode: plan.mode, intensity: plan.intensity, decision: plan.decision,
            decisionReason: plan.decisionReason,
            selectedProducts: [plan.primaryProduct, ...(plan.supportingProducts || [])].filter(Boolean),
            topCandidates: (plan.candidateScores || []).slice(0, 10),
            rejectedCandidates: (plan.rejectedCandidates || []).slice(0, 10),
            placementPlan: plan.placementPlan || [], warnings: plan.warnings || [],
            commercialDensityLimits: plan.commercialDensityLimits || {}
        };
    }

    static async listPlans(query = {}) {
        const { page, limit } = pageValues(query);
        const filter = {};
        if (query.mode && ['off', 'auto', 'required'].includes(query.mode)) filter.mode = query.mode;
        if (query.decision) filter.decision = query.decision;
        const [items, total] = await Promise.all([
            ProductSeedPlan.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
            ProductSeedPlan.countDocuments(filter)
        ]);
        return { plans: items.map((item) => ({ ...item, id: String(item._id) })), pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } };
    }

    static async getPlan({ planId }) {
        if (!/^[a-f0-9]{24}$/i.test(String(planId || ''))) throw new BadRequestError('Invalid Product Seed Plan id');
        const item = await ProductSeedPlan.findById(planId).lean();
        if (!item) throw new NotFoundError('Product Seed Plan not found');
        return { ...item, id: String(item._id) };
    }

    static async listExposures(query = {}) {
        const { page, limit } = pageValues(query);
        const filter = {};
        if (query.productId) {
            if (!/^[a-f0-9]{24}$/i.test(String(query.productId))) throw new BadRequestError('Invalid product id');
            filter.productId = query.productId;
        }
        const [items, total] = await Promise.all([
            ProductSeedExposure.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
            ProductSeedExposure.countDocuments(filter)
        ]);
        return { exposures: items.map((item) => ({ ...item, id: String(item._id), productId: String(item.productId), blogId: String(item.blogId), executionId: String(item.executionId) })), pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } };
    }

    static async catalogStatus() {
        return ProductCatalogIntelligenceService.getStatus();
    }

    static async rebuildCatalog() {
        const config = await ProductSeedingConfigService.getConfig();
        const snapshotResult = await ProductCatalogIntelligenceService.ensureSnapshot({ force: true, config });
        return {
            id: String(snapshotResult._id || snapshotResult.id || ''), catalogHash: snapshotResult.catalogHash,
            productCount: snapshotResult.productCount, eligibleProductCount: snapshotResult.eligibleProductCount,
            status: snapshotResult.status, generatedAt: snapshotResult.generatedAt, error: snapshotResult.error || ''
        };
    }
}

module.exports = { ProductSeedingAdminService };
