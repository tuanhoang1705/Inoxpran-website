'use strict'

const SiteSetting = require('../models/siteSetting.model');
const {
    applyProductSeedingConfigOverrides,
    buildEnvProductSeedingConfig
} = require('../config/productSeeding.config');

const SETTING_KEY = 'openclaw_product_seeding_config';

class ProductSeedingConfigService {
    static async getConfig() {
        const envConfig = buildEnvProductSeedingConfig();
        const setting = await SiteSetting.findOne({ key: SETTING_KEY }).lean();
        return {
            ...applyProductSeedingConfigOverrides(envConfig, setting?.value || {}),
            source: setting ? 'site_setting_with_env_guardrails' : 'environment_defaults',
            updatedAt: setting?.updatedAt || null
        };
    }

    static async updateConfig({ payload = {}, adminId }) {
        const reason = String(payload.reason || '').trim();
        if (!reason) throw new Error('Product seeding configuration update reason is required');
        const envConfig = buildEnvProductSeedingConfig();
        const normalized = applyProductSeedingConfigOverrides(envConfig, payload);
        await SiteSetting.updateOne(
            { key: SETTING_KEY },
            { $set: { value: normalized, updatedBy: adminId || null } },
            { upsert: true, runValidators: true }
        );
        return { ...normalized, source: 'site_setting_with_env_guardrails', updateReason: reason };
    }
}

module.exports = { ProductSeedingConfigService, PRODUCT_SEEDING_SETTING_KEY: SETTING_KEY };
