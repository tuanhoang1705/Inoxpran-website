import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Module } = require('node:module');

const discountMock = {
    findOne: vi.fn(),
    updateOne: vi.fn()
};
const discountUsageMock = {
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn()
};
const discountRepoMock = {
    checkDiscountExists: vi.fn(),
    findAllDiscountCodesSelect: vi.fn(),
    findAllDiscountCodesUnSelect: vi.fn()
};


const installMock = (modulePath, exports) => {
    const resolvedPath = require.resolve(modulePath);
    const mockModule = new Module(resolvedPath);
    mockModule.exports = exports;
    require.cache[resolvedPath] = mockModule;
};

installMock('../models/discount.model', discountMock);
installMock('../models/discountUsage.model', discountUsageMock);
installMock('../models/discountDeletion.model', {});
installMock('../models/repositories/discount.repo', discountRepoMock);

const servicePath = require.resolve('./discount.service');
delete require.cache[servicePath];
const DisscountService = require('./discount.service');
const { BadRequestError } = require('../core/error.response');

const buildDiscount = (overrides = {}) => ({
    _id: '507f1f77bcf86cd799439011',
    discount_code: 'SAVE10',
    discount_max_uses_per_user: 2,
    discount_is_active: true,
    discount_max_uses: 10,
    discount_min_order_value: 0,
    discount_startDate: new Date('2000-01-01'),
    discount_endDate: new Date('2099-01-01'),
    discount_uses_count: 0,
    discount_type: 'fixed_amount',
    discount_value: 100,
    ...overrides
});

beforeEach(() => {
    vi.clearAllMocks();
});

describe('DisscountService.getDiscountAmount', () => {
    it('blocks user when max uses per user reached', async () => {
        const discountData = buildDiscount({ discount_max_uses_per_user: 1 });
        discountRepoMock.checkDiscountExists.mockResolvedValue(discountData);
        discountUsageMock.findOne.mockReturnValue({
            select: () => ({
                lean: () => ({ usage_count: 1 })
            })
        });

        await expect(DisscountService.getDiscountAmount({
            codeId: discountData.discount_code,
            userId: '507f1f77bcf86cd799439012',
            shopId: '507f1f77bcf86cd799439013',
            products: [{ quantity: 1, price: 200 }]
        })).rejects.toThrow(BadRequestError);
    });

    it('returns discount amount when user can use code', async () => {
        const discountData = buildDiscount({
            discount_max_uses_per_user: 2,
            discount_min_order_value: 1
        });
        discountRepoMock.checkDiscountExists.mockResolvedValue(discountData);
        discountUsageMock.findOne.mockReturnValue({
            select: () => ({
                lean: () => ({ usage_count: 1 })
            })
        });

        const result = await DisscountService.getDiscountAmount({
            codeId: discountData.discount_code,
            userId: '507f1f77bcf86cd799439012',
            shopId: '507f1f77bcf86cd799439013',
            products: [{ quantity: 2, price: 200 }]
        });

        expect(result).toMatchObject({
            totalOrder: 400,
            discount: 100,
            totalPrice: 300
        });
    });
});

describe('DisscountService.recordDiscountUsage', () => {
    it('records usage and increments total usage count', async () => {
        const discountData = buildDiscount({
            discount_max_uses_per_user: 3,
            discount_uses_count: 2
        });
        discountMock.findOne.mockReturnValue({
            lean: () => discountData
        });
        discountMock.updateOne.mockResolvedValue({ acknowledged: true });
        discountUsageMock.findOneAndUpdate.mockResolvedValue({
            usage_discount_id: discountData._id,
            usage_user_id: '507f1f77bcf86cd799439012',
            usage_count: 3
        });

        const record = await DisscountService.recordDiscountUsage({
            discountId: discountData._id,
            userId: '507f1f77bcf86cd799439012',
            shopId: '507f1f77bcf86cd799439013'
        });

        expect(record).toMatchObject({ usage_count: 3 });
        expect(discountMock.updateOne).toHaveBeenCalledWith(
            { _id: expect.any(Object) },
            {
                $inc: { discount_uses_count: 1 },
                $addToSet: { discount_uses_used: expect.any(Object) }
            }
        );
    });

    it('throws when per-user usage limit reached during record', async () => {
        const discountData = buildDiscount({
            discount_max_uses_per_user: 1,
            discount_uses_count: 0
        });
        discountMock.findOne.mockReturnValue({
            lean: () => discountData
        });
        
        discountUsageMock.findOneAndUpdate.mockResolvedValue(null);

        await expect(DisscountService.recordDiscountUsage({
            discountId: discountData._id,
            userId: '507f1f77bcf86cd799439012',
            shopId: '507f1f77bcf86cd799439013'
        })).rejects.toThrow(BadRequestError);
    });
});
