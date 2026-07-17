import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Module } = require('node:module');
const installMock = (modulePath, exports) => {
    const resolved = require.resolve(modulePath);
    const mocked = new Module(resolved);
    mocked.exports = exports;
    require.cache[resolved] = mocked;
};

describe('Product seeding pipeline order', () => {
    it('runs strict Google Intelligence before the product layer and blocks before writer planning', async () => {
        const calls = [];
        installMock('../src/services/googleIntelligence.service', {
            GoogleIntelligenceService: {
                ensureGoogleIntelligenceSnapshotForDate: vi.fn(async () => {
                    calls.push('google');
                    return { id: '507f1f77bcf86cd799439021', timezone: 'Asia/Ho_Chi_Minh' };
                })
            }
        });
        installMock('../src/services/productSeedPlanning.service', {
            ProductSeedPlanningService: {
                createPlan: vi.fn(async () => {
                    calls.push('product');
                    return {
                        _id: '507f1f77bcf86cd799439031', mode: 'required', intensity: 'light',
                        decision: 'blocked_no_suitable_product', decisionReason: 'No suitable product',
                        primaryProduct: null, supportingProducts: []
                    };
                })
            }
        });
        delete require.cache[require.resolve('../src/services/agenticBlogCore.service')];
        const { AgenticBlogCoreService } = require('../src/services/agenticBlogCore.service');
        const result = await AgenticBlogCoreService.prepareContext({
            topic: 'Unmatched topic', primaryKeyword: 'unmatched', articleType: 'how-to',
            productSeeding: { mode: 'required' }
        });
        expect(calls).toEqual(['google', 'product']);
        expect(result.blocked).toBe(true);
        expect(result).not.toHaveProperty('strategy');
    });
});
