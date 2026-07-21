import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    GoogleIntelligenceService,
    buildGoogleExecutionKey,
    createGoogleBuildLeaseHeartbeat,
    mapSnapshot,
    mapSource,
    reconcileCompletedGoogleRun,
    sourceGenerationFilter
} = require('../src/services/googleIntelligence.service');
const { GoogleIntelligenceSource } = require('../src/models/googleIntelligenceSource.model');
const {
    assertPersistableSourceUrl,
    sanitizeSourceUrlForRead
} = require('../src/utils/googleIntelligence.util');
const { assertSafeUrl } = require('../src/services/safeSourceFetch.service');

const queryOf = (value) => {
    const query = {};
    query.select = vi.fn(() => query);
    query.sort = vi.fn(() => query);
    query.lean = vi.fn(async () => typeof value === 'function' ? value() : value);
    return query;
};

const noOpBuildHeartbeat = () => ({
    beat: vi.fn(async () => true),
    stop: vi.fn(async () => undefined),
    ownershipLost: vi.fn(() => false)
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('Google Intelligence execution and build fencing', () => {
    it('reconciles a run left running after its exact snapshot generation completed', async () => {
        const RunModel = {
            updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 })
        };
        const completedAt = new Date('2026-07-21T03:00:00.000Z');
        const snapshot = {
            _id: '507f1f77bcf86cd799439070',
            runId: '507f1f77bcf86cd799439071',
            status: 'completed_with_changes',
            completedGeneration: 8,
            sourceHealth: [
                {
                    sourceId: 'source-1',
                    name: 'Official source',
                    url: 'https://developers.google.com/search/docs',
                    ok: true,
                    official: true,
                    required: true,
                    error: ''
                },
                {
                    sourceId: 'source-2',
                    name: 'Unavailable source',
                    url: 'https://status.search.google.com/',
                    ok: false,
                    official: true,
                    required: false,
                    error: 'request failed for token=secret'
                }
            ],
            officialChanges: [
                {
                    sourceUrl: 'https://developers.google.com/search/docs',
                    severity: 'critical'
                }
            ],
            thirdPartyObservations: [
                {
                    sourceUrl: 'https://example.com/observation',
                    severity: 'medium'
                }
            ]
        };

        await expect(reconcileCompletedGoogleRun({ RunModel, snapshot, completedAt })).resolves.toBe(true);
        expect(RunModel.updateOne).toHaveBeenCalledWith(
            {
                _id: snapshot.runId,
                status: 'running',
                snapshotId: snapshot._id,
                snapshotGeneration: 8
            },
            {
                $set: {
                    status: 'completed_with_changes',
                    completedAt,
                    sourceResults: [
                        {
                            sourceId: 'source-1',
                            name: 'Official source',
                            ok: true,
                            official: true,
                            required: true,
                            changed: true,
                            error: ''
                        },
                        {
                            sourceId: 'source-2',
                            name: 'Unavailable source',
                            ok: false,
                            official: true,
                            required: false,
                            changed: false,
                            error: 'GOOGLE_INTELLIGENCE_HISTORICAL_ERROR'
                        }
                    ],
                    changesDetected: 2,
                    criticalChanges: 1,
                    error: ''
                },
                $unset: { buildToken: '' }
            }
        );
    });

    it('bounds source results reconstructed during completed-run reconciliation', async () => {
        const RunModel = {
            updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 })
        };
        const snapshot = {
            _id: '507f1f77bcf86cd799439070',
            runId: '507f1f77bcf86cd799439071',
            status: 'partial',
            completedGeneration: 9,
            sourceHealth: Array.from({ length: 105 }, (_, index) => ({
                sourceId: `source-${index}`,
                name: `Source ${index}`,
                url: `https://example.com/source-${index}`,
                ok: true
            }))
        };

        await reconcileCompletedGoogleRun({ RunModel, snapshot });

        const update = RunModel.updateOne.mock.calls[0][1];
        expect(update.$set.sourceResults).toHaveLength(100);
        expect(update.$set.sourceResults.at(-1).sourceId).toBe('source-99');
    });

    it('uses one deterministic execution key for a scheduled due slot across generations and wall-clock dates', () => {
        const dueAt = new Date('2026-07-21T01:30:00.000Z');
        const first = buildGoogleExecutionKey({
            triggeredBy: 'scheduled',
            snapshotDate: '2026-07-21',
            timezone: 'Asia/Ho_Chi_Minh',
            dueAt,
            generation: 1
        });
        const reclaimed = buildGoogleExecutionKey({
            triggeredBy: 'scheduled',
            snapshotDate: '2026-07-22',
            timezone: 'Asia/Ho_Chi_Minh',
            dueAt,
            generation: 99
        });

        expect(reclaimed).toEqual(first);
        expect(first.executionKey).toContain(dueAt.toISOString());
    });

    it('heartbeats only the snapshot generation owned by the current build token', async () => {
        const SnapshotModel = {
            updateOne: vi.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }))
        };
        const heartbeat = createGoogleBuildLeaseHeartbeat({
            SnapshotModel,
            snapshotKey: { snapshotDate: '2026-07-21', timezone: 'Asia/Ho_Chi_Minh' },
            buildToken: 'build-owner-1',
            buildGeneration: 7,
            clock: () => new Date('2026-07-21T03:00:00.000Z'),
            setIntervalFn: vi.fn(() => ({ unref: vi.fn() })),
            clearIntervalFn: vi.fn()
        });

        expect(await heartbeat.beat()).toBe(true);
        await heartbeat.stop();
        expect(SnapshotModel.updateOne).toHaveBeenCalledWith(
            {
                snapshotDate: '2026-07-21',
                timezone: 'Asia/Ho_Chi_Minh',
                status: 'building',
                buildToken: 'build-owner-1',
                buildGeneration: 7
            },
            { $set: { leaseUntil: expect.any(Date) } }
        );
    });

    it('builds a source write fence that allows only an older-or-equal generation', () => {
        const filter = sourceGenerationFilter({
            sourceId: 'source-1',
            snapshotDate: '2026-07-21',
            buildGeneration: 8
        });

        expect(filter).toEqual({
            _id: 'source-1',
            $or: [
                { baselineSnapshotDate: { $exists: false } },
                { baselineSnapshotDate: '' },
                { baselineSnapshotDate: { $lt: '2026-07-21' } },
                { baselineSnapshotDate: '2026-07-21', baselineGeneration: { $exists: false } },
                { baselineSnapshotDate: '2026-07-21', baselineGeneration: { $lte: 8 } }
            ]
        });
    });

    it('keeps fetchSource pure and returns its baseline mutation as deferred state', async () => {
        const updateSpy = vi.spyOn(GoogleIntelligenceSource, 'updateOne');
        const fetchedAt = new Date('2026-07-21T04:00:00.000Z');
        const result = await GoogleIntelligenceService.fetchSource({
            source: {
                _id: 'source-1',
                name: 'Official docs',
                baseUrl: 'https://developers.google.com/search/docs',
                official: true,
                required: true,
                fetchMode: 'html',
                lastContentHash: '',
                lastExcerpt: ''
            },
            fetchOptions: {
                sourceFetcher: vi.fn(async () => ({
                    canonicalUrl: 'https://developers.google.com/search/docs',
                    body: '<html><h1>Verified update</h1></html>',
                    fetchedAt
                })),
                checkRobots: false
            }
        });

        expect(result.ok).toBe(true);
        expect(result.deferredSourceUpdate).toMatchObject({
            canonicalUrl: 'https://developers.google.com/search/docs',
            lastSuccessAt: fetchedAt,
            lastFetchedAt: fetchedAt,
            lastError: ''
        });
        expect(result.deferredSourceUpdate.lastContentHash).toMatch(/^[a-f0-9]{64}$/);
        expect(updateSpy).not.toHaveBeenCalled();
    });

    it('prevents a stale builder from finalizing the snapshot or committing source/change state', async () => {
        const now = new Date('2026-07-21T05:00:00.000Z');
        let snapshot = null;
        const SnapshotModel = {
            findOne: vi.fn(() => queryOf(() => snapshot && { ...snapshot })),
            findOneAndUpdate: vi.fn((filter, update) => {
                if (update.$inc?.buildGeneration) {
                    snapshot = {
                        _id: 'snapshot-1',
                        snapshotDate: '2026-07-21',
                        timezone: 'Asia/Ho_Chi_Minh',
                        status: 'building',
                        checkedAt: now,
                        contentHash: 'building',
                        buildToken: update.$set.buildToken,
                        buildGeneration: 1,
                        leaseUntil: update.$set.leaseUntil
                    };
                    return queryOf(() => ({ ...snapshot }));
                }
                const owns = snapshot?.status === filter.status &&
                    snapshot?.buildToken === filter.buildToken &&
                    snapshot?.buildGeneration === filter.buildGeneration;
                return queryOf(() => owns ? { ...snapshot, ...update.$set } : null);
            }),
            updateOne: vi.fn(async () => ({ matchedCount: 0, modifiedCount: 0 }))
        };
        const SourceModel = {
            find: vi.fn(() => queryOf([{
                _id: 'source-1',
                name: 'Official docs',
                baseUrl: 'https://developers.google.com/search/docs',
                official: true,
                required: true,
                fetchMode: 'html',
                lastContentHash: '',
                lastExcerpt: ''
            }])),
            updateOne: vi.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }))
        };
        const RunModel = {
            findOneAndUpdate: vi.fn(() => queryOf({
                _id: 'run-1',
                status: 'running',
                buildToken: snapshot.buildToken,
                snapshotGeneration: snapshot.buildGeneration
            })),
            updateOne: vi.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }))
        };
        const ChangeModel = {
            updateOne: vi.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }))
        };
        const sourceFetcher = vi.fn(async () => {
            snapshot = {
                ...snapshot,
                buildToken: 'newer-owner',
                buildGeneration: 2,
                leaseUntil: new Date('2026-07-21T06:00:00.000Z')
            };
            return {
                canonicalUrl: 'https://developers.google.com/search/docs',
                body: '<html><h1>Generation one result</h1></html>',
                fetchedAt: now
            };
        });

        await expect(GoogleIntelligenceService.executeWorkflow({
            now,
            fetchOptions: { sourceFetcher, checkRobots: false }
        }, {
            SourceModel,
            RunModel,
            SnapshotModel,
            ChangeModel,
            seedDefaultSources: vi.fn(async () => undefined),
            buildHeartbeatFactory: noOpBuildHeartbeat,
            clock: () => now,
            config: {
                enabled: true,
                timezone: 'Asia/Ho_Chi_Minh',
                strictGate: true,
                maxSnapshotAgeHours: 24,
                sourceTimeoutMs: 15_000,
                retryCount: 0,
                retryDelayMs: 100,
                sourceGroups: []
            }
        })).rejects.toMatchObject({ code: 'GOOGLE_INTELLIGENCE_BUILD_LEASE_LOST' });

        const terminalAttempt = SnapshotModel.findOneAndUpdate.mock.calls.find(([, update]) =>
            update?.$set?.completedGeneration === 1);
        expect(terminalAttempt?.[0]).toMatchObject({
            status: 'building',
            buildGeneration: 1
        });
        expect(SourceModel.updateOne).not.toHaveBeenCalled();
        expect(ChangeModel.updateOne).not.toHaveBeenCalled();
        expect(snapshot).toMatchObject({ buildToken: 'newer-owner', buildGeneration: 2, status: 'building' });
    });
});

describe('Google Intelligence source URL and historical read safety', () => {
    it('rejects URL credentials and sensitive query keys before any fetch', async () => {
        expect(() => assertPersistableSourceUrl('https://user:password@developers.google.com/search/docs'))
            .toThrow('GOOGLE_SOURCE_URL_CREDENTIALS_NOT_ALLOWED');
        expect(() => assertPersistableSourceUrl('https://developers.google.com/search/docs?access_token=secret'))
            .toThrow('GOOGLE_SOURCE_URL_SENSITIVE_QUERY_NOT_ALLOWED');
        await expect(assertSafeUrl('https://developers.google.com/search/docs?X-Goog-Signature=secret'))
            .rejects.toThrow('GOOGLE_SOURCE_URL_SENSITIVE_QUERY_NOT_ALLOWED');
    });

    it('redacts historical URL credentials, sensitive queries and non-code errors on read', () => {
        const unsafeUrl = 'https://user:password@developers.google.com/search/docs?token=secret&hl=en';
        expect(sanitizeSourceUrlForRead(unsafeUrl)).toBe('https://developers.google.com/search/docs?hl=en');

        const source = mapSource({
            _id: 'source-1',
            name: 'Legacy source',
            sourceType: 'documentation',
            baseUrl: unsafeUrl,
            canonicalUrl: unsafeUrl,
            lastError: 'request failed for token=secret'
        });
        expect(source.baseUrl).not.toContain('secret');
        expect(source.baseUrl).not.toContain('password');
        expect(source.lastError).toBe('GOOGLE_INTELLIGENCE_HISTORICAL_ERROR');

        const snapshot = mapSnapshot({
            _id: 'snapshot-1',
            snapshotDate: '2026-07-21',
            timezone: 'Asia/Ho_Chi_Minh',
            status: 'partial',
            checkedAt: new Date(),
            contentHash: 'hash',
            sourceHealth: [{ url: unsafeUrl, error: 'https://host.invalid?token=secret' }],
            officialChanges: [{ sourceUrl: unsafeUrl }],
            recommendations: [{ sourceUrl: unsafeUrl }],
            requiredActions: [{ sourceUrl: unsafeUrl }]
        });
        expect(JSON.stringify(snapshot)).not.toContain('secret');
        expect(snapshot.sourceHealth[0].error).toBe('GOOGLE_INTELLIGENCE_HISTORICAL_ERROR');
    });
});
