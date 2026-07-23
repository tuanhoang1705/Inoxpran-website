import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const contentOperationsController = require('../src/controllers/contentOperations.controller');
const {
    ContentOperationsAdminService
} = require('../src/services/contentOperations/contentOperationsAdmin.service');
const {
    OpenClawCapabilityHealthService
} = require('../src/services/openclawCapabilityHealth.service');

const createResponse = () => {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    return { res: { status }, status, json };
};

describe('Content Operations capability-health authorization', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('does not disclose or probe capability health through content_operations.view alone', async () => {
        vi.spyOn(ContentOperationsAdminService, 'getStatus').mockResolvedValue({
            enabled: true,
            scheduleEnabled: false,
            capabilityHealth: {
                capabilities: {
                    telegram: { runtimeStatus: 'ready' }
                }
            }
        });
        const capabilityStatus = vi
            .spyOn(OpenClawCapabilityHealthService, 'getStatus')
            .mockResolvedValue({
                capabilities: {
                    telegram: { runtimeStatus: 'ready' }
                }
            });
        const { res, status, json } = createResponse();

        await contentOperationsController.status(
            {
                adminRoles: ['VIEWER'],
                adminPermissions: ['content_operations.view']
            },
            res
        );

        expect(capabilityStatus).not.toHaveBeenCalled();
        expect(status).toHaveBeenCalledWith(200);
        expect(json).toHaveBeenCalledWith(
            expect.objectContaining({
                metadata: {
                    enabled: true,
                    scheduleEnabled: false
                }
            })
        );
        expect(json.mock.calls[0][0].metadata).not.toHaveProperty('capabilityHealth');
    });

    it('honors the repository ADMIN fallback used by the dedicated capability route', async () => {
        vi.spyOn(ContentOperationsAdminService, 'getStatus').mockResolvedValue({
            enabled: true
        });
        const capabilityStatus = vi
            .spyOn(OpenClawCapabilityHealthService, 'getStatus')
            .mockResolvedValue({
                capabilities: {
                    openclawGateway: { runtimeStatus: 'ready' }
                }
            });
        const { res, json } = createResponse();

        await contentOperationsController.status(
            {
                adminRoles: ['ADMIN'],
                adminPermissions: ['content_operations.view']
            },
            res
        );

        expect(capabilityStatus).toHaveBeenCalledOnce();
        expect(json.mock.calls[0][0].metadata).toEqual({
            enabled: true,
            capabilityHealth: {
                capabilities: {
                    openclawGateway: { runtimeStatus: 'ready' }
                }
            }
        });
    });

    it('includes capability health only when openclaw_capability.view is explicitly present', async () => {
        vi.spyOn(ContentOperationsAdminService, 'getStatus').mockResolvedValue({
            enabled: true,
            scheduleEnabled: false
        });
        const health = {
            checkedAt: '2026-07-23T04:00:00.000Z',
            capabilities: {
                telegram: { runtimeStatus: 'ready' }
            }
        };
        const capabilityStatus = vi
            .spyOn(OpenClawCapabilityHealthService, 'getStatus')
            .mockResolvedValue(health);
        const { res, json } = createResponse();

        await contentOperationsController.status(
            {
                adminRoles: ['VIEWER'],
                adminPermissions: [
                    'content_operations.view',
                    'openclaw_capability.view'
                ]
            },
            res
        );

        expect(capabilityStatus).toHaveBeenCalledOnce();
        expect(json.mock.calls[0][0].metadata).toEqual({
            enabled: true,
            scheduleEnabled: false,
            capabilityHealth: health
        });
    });
});
