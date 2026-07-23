import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    OpenClawDashboardService,
    buildActionIdempotencyIdentity,
    validateActionIdempotencyKey
} = require('../src/services/openclawDashboard.service');
const openclawDashboardController = require('../src/controllers/openclawDashboard.controller');
const { OpenClawDashboardRun, openclawDashboardRunSchema } = require('../src/models/openclawDashboardRun.model');
const { BlogAutomationScheduleService } = require('../src/services/blogAutomationSchedule.service');
const {
    OpenClawCapabilityHealthService
} = require('../src/services/openclawCapabilityHealth.service');

const principalId = '507f1f77bcf86cd799439099';
const profile = 'inoxpran';

const duplicateKeyError = () => Object.assign(new Error('duplicate key'), { code: 11000 });
const leanResult = (value) => ({ lean: vi.fn().mockResolvedValue(value) });

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('OpenClaw dashboard action idempotency', () => {
    beforeEach(() => {
        vi.spyOn(OpenClawDashboardRun, 'init').mockResolvedValue(OpenClawDashboardRun);
        vi.spyOn(OpenClawDashboardRun, 'updateMany').mockResolvedValue({
            acknowledged: true,
            matchedCount: 0
        });
    });

    it('requires one bounded safe key and never stores or returns the raw key', async () => {
        const idempotencyKey = 'openclaw-action-secret-001';
        let persisted = null;
        vi.spyOn(OpenClawDashboardRun, 'create').mockImplementation(async (payload) => {
            persisted = { ...payload };
            return payload;
        });
        vi.spyOn(OpenClawDashboardRun, 'findOne').mockReturnValue(leanResult(null));
        const updateOne = vi
            .spyOn(OpenClawDashboardRun, 'updateOne')
            .mockResolvedValue({ acknowledged: true, matchedCount: 1 });
        vi.spyOn(BlogAutomationScheduleService, 'listSchedules').mockResolvedValue({
            schedules: []
        });

        const previousMode = process.env.OPENCLAW_DEPLOYMENT_MODE;
        process.env.OPENCLAW_DEPLOYMENT_MODE = 'docker';
        try {
            const started = await OpenClawDashboardService.startRun({
                action: 'daily-draft',
                profile,
                principalId,
                idempotencyKey
            });

            expect(started.id).toMatch(/^[0-9a-f-]{36}$/);
            expect(started.idempotentReplay).toBe(false);
            expect(JSON.stringify(started)).not.toContain(idempotencyKey);
            expect(JSON.stringify(persisted)).not.toContain(idempotencyKey);
            expect(persisted).toMatchObject({
                principalId,
                action: 'daily-draft',
                profile,
                idempotencyKeyHash: expect.stringMatching(/^[a-f0-9]{64}$/),
                bindingHash: expect.stringMatching(/^[a-f0-9]{64}$/)
            });
            await vi.waitFor(() => expect(updateOne).toHaveBeenCalled());
        } finally {
            if (previousMode === undefined) delete process.env.OPENCLAW_DEPLOYMENT_MODE;
            else process.env.OPENCLAW_DEPLOYMENT_MODE = previousMode;
        }

        expect(() => validateActionIdempotencyKey('short')).toThrow(
            'Idempotency-Key must be 8-128 safe ASCII characters'
        );
        expect(() => validateActionIdempotencyKey('unsafe key value')).toThrow(
            'Idempotency-Key must be 8-128 safe ASCII characters'
        );
    });

    it('replays a prior durable run after process memory is unavailable without redispatching', async () => {
        const idempotencyKey = 'durable-replay-001';
        const identity = buildActionIdempotencyIdentity({
            principalId,
            action: 'status',
            profile,
            idempotencyKey
        });
        const prior = {
            runId: 'bb9c1a7e-1771-47ba-99c4-bc7d3f8512fa',
            principalId,
            ...identity,
            action: 'status',
            profile,
            status: 'completed',
            exitCode: 0,
            startedAt: new Date('2026-07-23T01:00:00.000Z'),
            finishedAt: new Date('2026-07-23T01:00:01.000Z'),
            command: 'GET http://app_openclaw:18789/healthz + /readyz',
            output: 'OpenClaw Docker gateway is running and ready.',
            error: ''
        };
        vi.spyOn(OpenClawDashboardRun, 'create').mockRejectedValue(duplicateKeyError());
        const findOne = vi.spyOn(OpenClawDashboardRun, 'findOne').mockReturnValue(leanResult(prior));
        const fetchImpl = vi.fn();
        vi.stubGlobal('fetch', fetchImpl);

        const previousMode = process.env.OPENCLAW_DEPLOYMENT_MODE;
        process.env.OPENCLAW_DEPLOYMENT_MODE = 'docker';
        try {
            const replay = await OpenClawDashboardService.startRun({
                action: 'status',
                profile,
                principalId,
                idempotencyKey
            });
            expect(replay).toMatchObject({
                id: prior.runId,
                action: 'status',
                status: 'completed',
                idempotentReplay: true
            });
            expect(findOne).toHaveBeenCalledWith({
                principalId,
                idempotencyKeyHash: identity.idempotencyKeyHash
            });
            expect(fetchImpl).not.toHaveBeenCalled();
        } finally {
            if (previousMode === undefined) delete process.env.OPENCLAW_DEPLOYMENT_MODE;
            else process.env.OPENCLAW_DEPLOYMENT_MODE = previousMode;
        }
    });

    it('fails closed when one principal reuses a key for a different action binding', async () => {
        const idempotencyKey = 'binding-conflict-001';
        const priorIdentity = buildActionIdempotencyIdentity({
            principalId,
            action: 'daily-draft',
            profile,
            idempotencyKey
        });
        vi.spyOn(OpenClawDashboardRun, 'create').mockRejectedValue(duplicateKeyError());
        vi.spyOn(OpenClawDashboardRun, 'findOne').mockReturnValue(
            leanResult({
                runId: 'dbd7be67-9fdb-4edf-8e17-27410dd43412',
                principalId,
                ...priorIdentity,
                action: 'daily-draft',
                profile,
                status: 'running',
                startedAt: new Date()
            })
        );
        const fetchImpl = vi.fn();
        vi.stubGlobal('fetch', fetchImpl);

        const previousMode = process.env.OPENCLAW_DEPLOYMENT_MODE;
        process.env.OPENCLAW_DEPLOYMENT_MODE = 'docker';
        try {
            await expect(
                OpenClawDashboardService.startRun({
                    action: 'status',
                    profile,
                    principalId,
                    idempotencyKey
                })
            ).rejects.toMatchObject({
                status: 409,
                message: 'Idempotency-Key was already used for a different OpenClaw action request'
            });
            expect(fetchImpl).not.toHaveBeenCalled();
        } finally {
            if (previousMode === undefined) delete process.env.OPENCLAW_DEPLOYMENT_MODE;
            else process.env.OPENCLAW_DEPLOYMENT_MODE = previousMode;
        }
    });

    it('declares immutable hashes and a unique principal/key index', () => {
        expect(openclawDashboardRunSchema.path('idempotencyKeyHash').options.immutable).toBe(true);
        expect(openclawDashboardRunSchema.path('bindingHash').options.immutable).toBe(true);
        expect(openclawDashboardRunSchema.path('leaseTokenHash').options.immutable).toBe(true);
        expect(openclawDashboardRunSchema.path('leaseExpiresAt').options.required).toBe(true);
        expect(openclawDashboardRunSchema.indexes()).toEqual(
            expect.arrayContaining([
                [
                    { principalId: 1, idempotencyKeyHash: 1 },
                    expect.objectContaining({
                        unique: true,
                        name: 'openclaw_run_principal_idempotency_unique'
                    })
                ],
                [
                    { action: 1, profile: 1, activeFence: 1 },
                    expect.objectContaining({
                        unique: true,
                        partialFilterExpression: { activeFence: true },
                        name: 'openclaw_run_active_action_unique'
                    })
                ]
            ])
        );
    });

    it('replays one fresh running lease during a concurrent reservation race without redispatch', async () => {
        let reserved = null;
        vi.spyOn(OpenClawDashboardRun, 'create').mockImplementation(async (payload) => {
            if (reserved) throw duplicateKeyError();
            reserved = { ...payload };
            return payload;
        });
        vi.spyOn(OpenClawDashboardRun, 'findOne').mockImplementation(() => leanResult(reserved));
        const updateOne = vi
            .spyOn(OpenClawDashboardRun, 'updateOne')
            .mockResolvedValue({ acknowledged: true, matchedCount: 1 });
        const fetchImpl = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: vi.fn().mockResolvedValue({ status: 'ok' }),
            text: vi.fn().mockResolvedValue('')
        });
        vi.stubGlobal('fetch', fetchImpl);

        const previousMode = process.env.OPENCLAW_DEPLOYMENT_MODE;
        process.env.OPENCLAW_DEPLOYMENT_MODE = 'docker';
        try {
            const request = {
                action: 'status',
                profile,
                principalId,
                idempotencyKey: 'concurrent-race-key-001'
            };
            const [first, replay] = await Promise.all([
                OpenClawDashboardService.startRun(request),
                OpenClawDashboardService.startRun(request)
            ]);
            expect(first.id).toBe(replay.id);
            expect([first.idempotentReplay, replay.idempotentReplay].sort()).toEqual([false, true]);
            await vi.waitFor(() => expect(updateOne).toHaveBeenCalledTimes(1));
            expect(fetchImpl).toHaveBeenCalledTimes(2);
        } finally {
            if (previousMode === undefined) delete process.env.OPENCLAW_DEPLOYMENT_MODE;
            else process.env.OPENCLAW_DEPLOYMENT_MODE = previousMode;
        }
    });

    it('atomically terminalizes an expired worker lease and never redispatches the stale run', async () => {
        const idempotencyKey = 'stale-worker-recovery-001';
        const identity = buildActionIdempotencyIdentity({
            principalId,
            action: 'status',
            profile,
            idempotencyKey
        });
        const stale = {
            runId: '13dfb68c-8020-4bb2-b532-145dfb90d136',
            principalId,
            ...identity,
            action: 'status',
            profile,
            status: 'running',
            exitCode: null,
            startedAt: new Date('2026-07-23T01:00:00.000Z'),
            leaseExpiresAt: new Date('2000-01-01T01:01:15.000Z'),
            lastHeartbeatAt: new Date('2000-01-01T01:00:00.000Z'),
            leaseTokenHash: 'a'.repeat(64),
            command: 'GET gateway health'
        };
        const recovered = {
            ...stale,
            status: 'timed_out',
            exitCode: 1,
            finishedAt: new Date(),
            error: 'The previous OpenClaw action worker lease expired before durable completion.'
        };
        vi.spyOn(OpenClawDashboardRun, 'create').mockRejectedValue(duplicateKeyError());
        vi.spyOn(OpenClawDashboardRun, 'findOne')
            .mockReturnValueOnce(leanResult(stale))
            .mockReturnValueOnce(leanResult(recovered));
        const updateOne = vi
            .spyOn(OpenClawDashboardRun, 'updateOne')
            .mockResolvedValue({ acknowledged: true, matchedCount: 1 });
        const fetchImpl = vi.fn();
        vi.stubGlobal('fetch', fetchImpl);
        const previousMode = process.env.OPENCLAW_DEPLOYMENT_MODE;
        process.env.OPENCLAW_DEPLOYMENT_MODE = 'docker';
        try {
            const replay = await OpenClawDashboardService.startRun({
                action: 'status',
                profile,
                principalId,
                idempotencyKey
            });
            expect(replay).toMatchObject({
                id: stale.runId,
                status: 'timed_out',
                idempotentReplay: true
            });
            expect(updateOne).toHaveBeenCalledWith(
                expect.objectContaining({
                    runId: stale.runId,
                    status: 'running',
                    bindingHash: identity.bindingHash,
                    $or: expect.any(Array)
                }),
                expect.objectContaining({
                    $set: expect.objectContaining({ status: 'timed_out', exitCode: 1 })
                }),
                { runValidators: true }
            );
            expect(fetchImpl).not.toHaveBeenCalled();
        } finally {
            if (previousMode === undefined) delete process.env.OPENCLAW_DEPLOYMENT_MODE;
            else process.env.OPENCLAW_DEPLOYMENT_MODE = previousMode;
        }
    });

    it('keeps the in-memory run non-terminal until the terminal database write resolves', async () => {
        let resolvePersistence;
        const persisted = new Promise((resolve) => {
            resolvePersistence = resolve;
        });
        vi.spyOn(OpenClawDashboardRun, 'create').mockImplementation(async (payload) => payload);
        vi.spyOn(OpenClawDashboardRun, 'findOne').mockReturnValue(leanResult(null));
        const updateOne = vi.spyOn(OpenClawDashboardRun, 'updateOne').mockReturnValue(persisted);
        vi.spyOn(BlogAutomationScheduleService, 'listSchedules').mockRejectedValue(
            new Error('PASSWORD=terminal-persistence-canary')
        );

        const previousMode = process.env.OPENCLAW_DEPLOYMENT_MODE;
        process.env.OPENCLAW_DEPLOYMENT_MODE = 'docker';
        try {
            const started = await OpenClawDashboardService.startRun({
                action: 'daily-draft',
                profile,
                principalId,
                idempotencyKey: 'await-terminal-write-001'
            });
            await vi.waitFor(() => expect(updateOne).toHaveBeenCalled());
            expect(await OpenClawDashboardService.getRun({ runId: started.id })).toMatchObject({
                status: 'running'
            });

            const persistedPayload = updateOne.mock.calls[0][1].$set;
            expect(JSON.stringify(persistedPayload)).not.toContain('terminal-persistence-canary');
            resolvePersistence({ acknowledged: true, matchedCount: 1 });
            await vi.waitFor(async () => {
                expect(await OpenClawDashboardService.getRun({ runId: started.id })).toMatchObject({
                    status: 'failed',
                    error: expect.stringContaining('[redacted]')
                });
            });
        } finally {
            if (previousMode === undefined) delete process.env.OPENCLAW_DEPLOYMENT_MODE;
            else process.env.OPENCLAW_DEPLOYMENT_MODE = previousMode;
        }
    });

    it('rejects a second key while the same single-flight action is durably running', async () => {
        let reserved;
        let finishDispatch;
        const dispatchBlocked = new Promise((resolve) => {
            finishDispatch = resolve;
        });
        vi.spyOn(OpenClawDashboardRun, 'create').mockImplementation(async (payload) => {
            if (reserved) throw duplicateKeyError();
            reserved = { ...payload };
            return payload;
        });
        vi.spyOn(OpenClawDashboardRun, 'findOne').mockImplementation((filter) => {
            if (filter?.activeFence?.$ne === true) return leanResult(null);
            if (filter?.principalId) return leanResult(null);
            if (filter?.activeFence === true) return leanResult(reserved);
            return leanResult(null);
        });
        vi.spyOn(OpenClawDashboardRun, 'updateOne').mockResolvedValue({
            acknowledged: true,
            matchedCount: 1
        });
        const listSchedules = vi
            .spyOn(BlogAutomationScheduleService, 'listSchedules')
            .mockImplementation(() => dispatchBlocked);

        const previousMode = process.env.OPENCLAW_DEPLOYMENT_MODE;
        process.env.OPENCLAW_DEPLOYMENT_MODE = 'docker';
        try {
            const first = await OpenClawDashboardService.startRun({
                action: 'daily-draft',
                profile,
                principalId,
                idempotencyKey: 'single-flight-first-001'
            });
            await expect(
                OpenClawDashboardService.startRun({
                    action: 'daily-draft',
                    profile,
                    principalId,
                    idempotencyKey: 'single-flight-second-001'
                })
            ).rejects.toMatchObject({
                status: 409,
                message: 'An OpenClaw action with the same action and profile is already running'
            });
            expect(first.status).toBe('running');
            expect(listSchedules).toHaveBeenCalledTimes(1);
        } finally {
            finishDispatch({ schedules: [] });
            await vi.waitFor(() => expect(OpenClawDashboardRun.updateOne).toHaveBeenCalled());
            if (previousMode === undefined) delete process.env.OPENCLAW_DEPLOYMENT_MODE;
            else process.env.OPENCLAW_DEPLOYMENT_MODE = previousMode;
        }
    });

    it('cleans stale pre-fence rows but still blocks when another recent legacy run exists', async () => {
        const priorIdentity = buildActionIdempotencyIdentity({
            principalId,
            action: 'daily-draft',
            profile,
            idempotencyKey: 'legacy-active-original-001'
        });
        const legacyActive = {
            runId: '94cb106e-e4fa-4791-bf10-709374745639',
            principalId,
            ...priorIdentity,
            action: 'daily-draft',
            profile,
            status: 'running',
            startedAt: new Date(),
            leaseExpiresAt: new Date('2099-01-01T00:00:00.000Z'),
            leaseTokenHash: 'd'.repeat(64),
            activeFence: false
        };
        vi.spyOn(OpenClawDashboardRun, 'findOne').mockReturnValue(leanResult(legacyActive));
        OpenClawDashboardRun.updateMany.mockResolvedValueOnce({
            acknowledged: true,
            matchedCount: 1
        });
        const create = vi.spyOn(OpenClawDashboardRun, 'create');
        const dispatch = vi.spyOn(BlogAutomationScheduleService, 'listSchedules');
        const previousMode = process.env.OPENCLAW_DEPLOYMENT_MODE;
        process.env.OPENCLAW_DEPLOYMENT_MODE = 'docker';
        try {
            await expect(
                OpenClawDashboardService.startRun({
                    action: 'daily-draft',
                    profile,
                    principalId,
                    idempotencyKey: 'legacy-active-new-key-001'
                })
            ).rejects.toMatchObject({ status: 409 });
            expect(create).not.toHaveBeenCalled();
            expect(dispatch).not.toHaveBeenCalled();
            expect(OpenClawDashboardRun.updateMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    action: 'daily-draft',
                    profile,
                    status: 'running',
                    activeFence: { $ne: true },
                    $or: expect.any(Array)
                }),
                expect.objectContaining({
                    $set: expect.objectContaining({
                        status: 'timed_out',
                        activeFence: false
                    })
                }),
                { runValidators: true }
            );
        } finally {
            if (previousMode === undefined) delete process.env.OPENCLAW_DEPLOYMENT_MODE;
            else process.env.OPENCLAW_DEPLOYMENT_MODE = previousMode;
        }
    });

    it('recovers an expired persisted lease during GET polling without redispatch', async () => {
        const stale = {
            runId: '6074baf8-34d3-4462-bb63-95182be5790b',
            action: 'daily-draft',
            profile,
            status: 'running',
            startedAt: new Date('2000-01-01T00:00:00.000Z'),
            leaseExpiresAt: new Date('2000-01-01T00:35:15.000Z'),
            lastHeartbeatAt: new Date('2000-01-01T00:00:00.000Z'),
            leaseTokenHash: 'b'.repeat(64),
            activeFence: true
        };
        const recovered = {
            ...stale,
            status: 'timed_out',
            activeFence: false,
            exitCode: 1,
            finishedAt: new Date(),
            error: 'worker lease expired'
        };
        vi.spyOn(OpenClawDashboardRun, 'findOne')
            .mockReturnValueOnce(leanResult(stale))
            .mockReturnValueOnce(leanResult(recovered));
        const updateOne = vi
            .spyOn(OpenClawDashboardRun, 'updateOne')
            .mockResolvedValue({ acknowledged: true, matchedCount: 1 });
        const dispatch = vi.spyOn(BlogAutomationScheduleService, 'listSchedules');

        const result = await OpenClawDashboardService.getRun({
            runId: stale.runId
        });

        expect(result).toMatchObject({ id: stale.runId, status: 'timed_out' });
        expect(updateOne).toHaveBeenCalledWith(
            expect.objectContaining({
                runId: stale.runId,
                status: 'running',
                leaseTokenHash: stale.leaseTokenHash
            }),
            expect.objectContaining({
                $set: expect.objectContaining({
                    status: 'timed_out',
                    activeFence: false
                })
            }),
            { runValidators: true }
        );
        expect(dispatch).not.toHaveBeenCalled();
    });

    it('recovers expired leases while listing runs after a process restart', async () => {
        const stale = {
            runId: '65959028-5ce0-4904-a6e4-546267d929ee',
            action: 'sync-agents',
            profile,
            status: 'running',
            startedAt: new Date('2000-01-01T00:00:00.000Z'),
            leaseExpiresAt: new Date('2000-01-01T00:10:15.000Z'),
            lastHeartbeatAt: new Date('2000-01-01T00:00:00.000Z'),
            leaseTokenHash: 'c'.repeat(64),
            activeFence: true
        };
        const recovered = {
            ...stale,
            status: 'timed_out',
            activeFence: false,
            exitCode: 1,
            finishedAt: new Date()
        };
        const chain = {
            sort: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            lean: vi.fn().mockResolvedValue([stale])
        };
        vi.spyOn(OpenClawDashboardRun, 'find').mockReturnValue(chain);
        vi.spyOn(OpenClawDashboardRun, 'findOne').mockReturnValue(leanResult(recovered));
        vi.spyOn(OpenClawDashboardRun, 'updateOne').mockResolvedValue({
            acknowledged: true,
            matchedCount: 1
        });

        const listed = await OpenClawDashboardService.listRuns();
        expect(listed.runs.find((run) => run.id === stale.runId)).toMatchObject({
            status: 'timed_out'
        });
    });

    it('fails closed until the durable uniqueness indexes initialize', async () => {
        OpenClawDashboardRun.init.mockRejectedValueOnce(new Error('index build failed'));
        const create = vi.spyOn(OpenClawDashboardRun, 'create');
        const previousMode = process.env.OPENCLAW_DEPLOYMENT_MODE;
        process.env.OPENCLAW_DEPLOYMENT_MODE = 'docker';
        try {
            await expect(
                OpenClawDashboardService.startRun({
                    action: 'status',
                    profile,
                    principalId,
                    idempotencyKey: 'index-readiness-failure-001'
                })
            ).rejects.toThrow('index build failed');
            expect(create).not.toHaveBeenCalled();
        } finally {
            if (previousMode === undefined) delete process.env.OPENCLAW_DEPLOYMENT_MODE;
            else process.env.OPENCLAW_DEPLOYMENT_MODE = previousMode;
        }
    });

    it('forwards the authenticated principal and Idempotency-Key from the controller', async () => {
        const started = {
            id: 'a7a5a56d-0183-4b6b-9d1e-d6f43648cd87',
            action: 'status',
            status: 'running'
        };
        const startRun = vi.spyOn(OpenClawDashboardService, 'startRun').mockResolvedValue(started);
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis()
        };

        await openclawDashboardController.startRun(
            {
                body: { action: 'status', profile },
                user: { userId: principalId },
                get: vi.fn((name) => (name === 'Idempotency-Key' ? 'controller-key-001' : undefined))
            },
            res
        );

        expect(startRun).toHaveBeenCalledWith({
            action: 'status',
            profile,
            idempotencyKey: 'controller-key-001',
            principalId
        });
        expect(res.status).toHaveBeenCalledWith(201);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ metadata: started }));
    });

    it.each([
        [null],
        [[]],
        [{ action: ['status'], profile }],
        [{ action: 'status', profile: [profile] }],
        [{ action: 1, profile }],
        [{ action: 'status' }],
        [{ action: 'status', profile, unexpected: true }]
    ])('rejects non-exact OpenClaw run request bodies: %j', (body) => {
        expect(() => openclawDashboardController.exactRunRequest(body)).toThrow();
    });

    it('rejects all dashboard run query parameters before service dispatch', async () => {
        const startRun = vi.spyOn(OpenClawDashboardService, 'startRun');
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis()
        };
        await expect(
            openclawDashboardController.startRun(
                {
                    body: { action: 'status', profile },
                    query: { retry: ['1', '2'] },
                    user: { userId: principalId },
                    get: vi.fn(() => 'controller-query-key-001')
                },
                res
            )
        ).rejects.toThrow('OpenClaw dashboard query parameters are not supported');
        expect(startRun).not.toHaveBeenCalled();
    });

    it.each([
        ['status', 'getCapabilityStatus', 'getStatus', { query: { refresh: '1' } }],
        ['check-all query', 'checkCapabilities', 'checkAll', { query: { force: '1' }, body: {} }],
        ['check-all body', 'checkCapabilities', 'checkAll', { query: {}, body: { force: true } }],
        [
            'check-one query',
            'checkCapability',
            'checkOne',
            { query: { force: '1' }, body: {}, params: { featureKey: 'seo_agent' } }
        ],
        [
            'check-one body',
            'checkCapability',
            'checkOne',
            { query: {}, body: ['unexpected'], params: { featureKey: 'seo_agent' } }
        ]
    ])('rejects non-exact capability %s requests before service dispatch', async (_label, handler, serviceMethod, req) => {
        const dispatch = vi.spyOn(OpenClawCapabilityHealthService, serviceMethod);
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis()
        };

        await expect(openclawDashboardController[handler](req, res)).rejects.toThrow();
        expect(dispatch).not.toHaveBeenCalled();
    });

    it('rejects a null capability body as a controlled bad request before service dispatch', async () => {
        const dispatch = vi.spyOn(OpenClawCapabilityHealthService, 'checkAll');
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis()
        };

        await expect(
            openclawDashboardController.checkCapabilities({ query: {}, body: null }, res)
        ).rejects.toMatchObject({
            status: 400,
            message: 'OpenClaw capability request body must be empty'
        });
        expect(dispatch).not.toHaveBeenCalled();
    });

    it.each([undefined, {}])('accepts an omitted or exact empty capability check body: %j', async (body) => {
        const report = { checkedAt: new Date().toISOString(), capabilities: {} };
        const dispatch = vi.spyOn(OpenClawCapabilityHealthService, 'checkAll').mockResolvedValue(report);
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis()
        };

        await openclawDashboardController.checkCapabilities({ query: {}, body }, res);

        expect(dispatch).toHaveBeenCalledTimes(1);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining(report) }));
    });
});
