import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Module } = require('node:module');
const { sanitizeSeoBlogHtml } = require('../src/utils/seoBlogSanitizer');
const { ProductSeedingAdminService } = require('../src/services/productSeedingAdmin.service');

const loadPermissionMiddleware = (admin) => {
    const modelPath = require.resolve('../src/models/admin.model');
    const mocked = new Module(modelPath);
    mocked.exports = { findById: vi.fn(() => ({ select: vi.fn().mockResolvedValue(admin) })) };
    require.cache[modelPath] = mocked;
    delete require.cache[require.resolve('../src/middleware/requireAdminRole')];
    return require('../src/middleware/requireAdminRole');
};

describe('Product seeding security', () => {
    it('requires the product_seeding.preview scope for non-admin roles', async () => {
        const { requireAdminPermission } = loadPermissionMiddleware({ _id: 'a1', email: 'viewer@example.com', roles: ['VIEWER'], permissions: [] });
        const next = vi.fn();
        await requireAdminPermission(['product_seeding.preview'])({ user: { userId: 'a1' } }, {}, next);
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Insufficient permission' }));
    });

    it('keeps ADMIN as a backward-compatible RBAC fallback', async () => {
        const { requireAdminPermission } = loadPermissionMiddleware({ _id: 'a1', email: 'admin@example.com', roles: ['ADMIN'], permissions: [] });
        const next = vi.fn();
        await requireAdminPermission(['product_catalog_snapshot.rebuild'])({ user: { userId: 'a1' } }, {}, next);
        expect(next).toHaveBeenCalledWith();
    });

    it('rejects unsafe product URLs while preserving sanitizer protections', () => {
        const html = sanitizeSeoBlogHtml('<section data-block-type="product-recommendation" data-product-id="507f1f77bcf86cd799439011"><a href="javascript:alert(1)" data-link-type="product" onclick="alert(2)">Buy</a></section>');
        expect(html).not.toContain('javascript:');
        expect(html).not.toContain('onclick');
        expect(html).not.toContain('<a');
    });

    it('requires a reason before any configuration override and audit write', async () => {
        await expect(ProductSeedingAdminService.updateConfig({ payload: {}, adminId: '507f1f77bcf86cd799439011' })).rejects.toThrow('reason is required');
    });
});
