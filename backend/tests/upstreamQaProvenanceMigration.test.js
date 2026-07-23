import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    APPLY_FLAG,
    CONFIRMATION_ENV,
    CONFIRMATION_VALUE,
    EXPECTED_DATABASE_ENV,
    INDEX_MIGRATIONS,
    buildIndexMigrationPlan,
    migrateUpstreamQaProvenanceIndexes,
    resolveExecutionMode,
    runCollectionMigration
} = require('../scripts/migrate-upstream-qa-provenance-indexes');

const legacyIndex = (definition) => ({
    name: definition.legacy.name,
    key: definition.legacy.key,
    unique: true
});
const targetIndex = (definition) => ({
    name: definition.target.name,
    key: definition.target.key,
    unique: true
});

describe('upstream QA provenance index migration safety', () => {
    it('covers every scoped snapshot index and the Opportunity Decision collision index', () => {
        expect(INDEX_MIGRATIONS.map((definition) => definition.collection)).toEqual([
            'GoogleIntelligenceSnapshots',
            'ContentOperationsDailySnapshots',
            'ContentInventorySnapshots',
            'ContentOpportunityDecisions'
        ]);
        expect(INDEX_MIGRATIONS.at(-1).target).toMatchObject({
            name: 'content_opportunity_scope_unique',
            key: {
                contentOperationsSnapshotId: 1,
                candidateId: 1,
                isQaTest: 1,
                qaBatchId: 1,
                qaCaseId: 1
            },
            unique: true
        });
    });

    it('is immutable dry-run by default even when the confirmation environment variable exists', () => {
        expect(resolveExecutionMode({
            argv: [],
            env: { [CONFIRMATION_ENV]: CONFIRMATION_VALUE }
        })).toEqual({ apply: false, dryRun: true });
    });

    it('requires both the narrowly named apply flag and exact environment confirmation', () => {
        expect(() => resolveExecutionMode({ argv: [APPLY_FLAG], env: {} }))
            .toThrow(expect.objectContaining({ code: 'UPSTREAM_QA_INDEX_MIGRATION_CONFIRMATION_REQUIRED' }));
        expect(() => resolveExecutionMode({
            argv: [APPLY_FLAG],
            env: { [CONFIRMATION_ENV]: CONFIRMATION_VALUE }
        })).toThrow(expect.objectContaining({ code: 'UPSTREAM_QA_INDEX_MIGRATION_DATABASE_CONFIRMATION_REQUIRED' }));
        expect(resolveExecutionMode({
            argv: [APPLY_FLAG],
            env: {
                [CONFIRMATION_ENV]: CONFIRMATION_VALUE,
                [EXPECTED_DATABASE_ENV]: 'inoxpran_qa'
            }
        })).toEqual({ apply: true, dryRun: false, expectedDatabaseName: 'inoxpran_qa' });
        expect(() => resolveExecutionMode({
            argv: [APPLY_FLAG],
            env: {
                [CONFIRMATION_ENV]: CONFIRMATION_VALUE,
                [EXPECTED_DATABASE_ENV]: '../unsafe database name'
            }
        })).toThrow(expect.objectContaining({ code: 'UPSTREAM_QA_INDEX_MIGRATION_DATABASE_CONFIRMATION_REQUIRED' }));
    });

    it('refuses an apply database mismatch before inspecting or mutating any collection', async () => {
        const db = { collection: vi.fn() };

        await expect(migrateUpstreamQaProvenanceIndexes({
            db,
            apply: true,
            expectedDatabaseName: 'inoxpran_qa',
            actualDatabaseName: 'inoxpran_production'
        })).rejects.toMatchObject({ code: 'UPSTREAM_QA_INDEX_MIGRATION_DATABASE_MISMATCH' });
        expect(db.collection).not.toHaveBeenCalled();
    });

    it('plans create-before-drop and never includes an unrelated index', () => {
        const definition = INDEX_MIGRATIONS[0];
        const plan = buildIndexMigrationPlan({
            definition,
            indexes: [
                { name: '_id_', key: { _id: 1 }, unique: true },
                { name: 'unrelated', key: { checkedAt: -1 } },
                legacyIndex(definition)
            ],
            productionBackfillCount: 4,
            incompleteQaCount: 0
        });
        expect(plan.operations.map((operation) => operation.type)).toEqual([
            'backfill_non_qa_provenance',
            'create_target_index',
            'drop_legacy_index'
        ]);
        expect(JSON.stringify(plan)).not.toContain('unrelated');
    });

    it('fails closed when exact legacy/target definitions or QA provenance do not match', () => {
        const definition = INDEX_MIGRATIONS[0];
        expect(() => buildIndexMigrationPlan({
            definition,
            indexes: [{ ...legacyIndex(definition), key: { snapshotDate: 1 } }]
        })).toThrow(expect.objectContaining({ code: 'UPSTREAM_QA_LEGACY_INDEX_KEY_MISMATCH' }));
        expect(() => buildIndexMigrationPlan({
            definition,
            indexes: [{ ...targetIndex(definition), unique: false }]
        })).toThrow(expect.objectContaining({ code: 'UPSTREAM_QA_TARGET_INDEX_UNIQUE_MISMATCH' }));
        expect(() => buildIndexMigrationPlan({
            definition,
            indexes: [legacyIndex(definition)],
            incompleteQaCount: 1
        })).toThrow(expect.objectContaining({ code: 'UPSTREAM_QA_INCOMPLETE_PROVENANCE_FOUND' }));
        expect(() => buildIndexMigrationPlan({
            definition,
            indexes: [{ ...targetIndex(definition), sparse: true }]
        })).toThrow(expect.objectContaining({ code: 'UPSTREAM_QA_TARGET_INDEX_SPARSE_MISMATCH' }));
        expect(() => buildIndexMigrationPlan({
            definition,
            indexes: [{
                ...targetIndex(definition),
                partialFilterExpression: { isQaTest: true }
            }]
        })).toThrow(expect.objectContaining({ code: 'UPSTREAM_QA_TARGET_INDEX_PARTIAL_FILTER_MISMATCH' }));
        expect(() => buildIndexMigrationPlan({
            definition,
            indexes: [{
                ...targetIndex(definition),
                collation: { locale: 'en', strength: 2 }
            }]
        })).toThrow(expect.objectContaining({ code: 'UPSTREAM_QA_TARGET_INDEX_COLLATION_MISMATCH' }));
    });

    it('performs read-only inspection and no writes in dry-run mode', async () => {
        const collections = new Map(INDEX_MIGRATIONS.map((definition) => {
            const collection = {
                indexes: vi.fn(async () => [
                    { name: '_id_', key: { _id: 1 }, unique: true },
                    legacyIndex(definition)
                ]),
                countDocuments: vi.fn(async () => 0),
                updateMany: vi.fn(),
                createIndex: vi.fn(),
                dropIndex: vi.fn()
            };
            return [definition.collection, collection];
        }));
        const db = { collection: vi.fn((name) => collections.get(name)) };

        const result = await migrateUpstreamQaProvenanceIndexes({ db, apply: false });

        expect(result).toMatchObject({ dryRun: true, applied: false });
        for (const collection of collections.values()) {
            expect(collection.indexes).toHaveBeenCalledTimes(1);
            expect(collection.countDocuments).toHaveBeenCalledTimes(2);
            expect(collection.updateMany).not.toHaveBeenCalled();
            expect(collection.createIndex).not.toHaveBeenCalled();
            expect(collection.dropIndex).not.toHaveBeenCalled();
        }
    });

    it('applies backfill and target creation before the exact legacy drop', async () => {
        const definition = INDEX_MIGRATIONS[3];
        const events = [];
        const collection = {
            indexes: vi.fn()
                .mockResolvedValueOnce([legacyIndex(definition)])
                .mockResolvedValueOnce([legacyIndex(definition), targetIndex(definition)])
                .mockResolvedValueOnce([targetIndex(definition)]),
            countDocuments: vi.fn()
                .mockResolvedValueOnce(2)
                .mockResolvedValueOnce(0),
            updateMany: vi.fn(async () => { events.push('backfill'); }),
            createIndex: vi.fn(async () => { events.push('create'); }),
            dropIndex: vi.fn(async () => { events.push('drop'); })
        };
        const db = { collection: vi.fn(() => collection) };

        await expect(runCollectionMigration({ db, definition, apply: true }))
            .resolves.toMatchObject({ applied: true });
        expect(events).toEqual(['backfill', 'create', 'drop']);
        expect(collection.dropIndex).toHaveBeenCalledWith(definition.legacy.name);
    });

    it('performs no write when incomplete QA provenance is found', async () => {
        const definition = INDEX_MIGRATIONS[3];
        const collection = {
            indexes: vi.fn(async () => [legacyIndex(definition)]),
            countDocuments: vi.fn()
                .mockResolvedValueOnce(0)
                .mockResolvedValueOnce(1),
            updateMany: vi.fn(),
            createIndex: vi.fn(),
            dropIndex: vi.fn()
        };
        const db = { collection: vi.fn(() => collection) };

        await expect(runCollectionMigration({ db, definition, apply: true }))
            .rejects.toMatchObject({ code: 'UPSTREAM_QA_INCOMPLETE_PROVENANCE_FOUND' });
        expect(collection.updateMany).not.toHaveBeenCalled();
        expect(collection.createIndex).not.toHaveBeenCalled();
        expect(collection.dropIndex).not.toHaveBeenCalled();
    });

    it('preflights every collection before writing and leaves earlier collections untouched when a later plan fails', async () => {
        const firstDefinition = INDEX_MIGRATIONS[0];
        const failingDefinition = INDEX_MIGRATIONS[1];
        const makeCollection = ({ definition, incompleteQaCount = 0 }) => ({
            indexes: vi.fn(async () => [legacyIndex(definition)]),
            countDocuments: vi.fn()
                .mockResolvedValueOnce(0)
                .mockResolvedValueOnce(incompleteQaCount),
            updateMany: vi.fn(),
            createIndex: vi.fn(),
            dropIndex: vi.fn()
        });
        const firstCollection = makeCollection({ definition: firstDefinition });
        const failingCollection = makeCollection({
            definition: failingDefinition,
            incompleteQaCount: 1
        });
        const collections = new Map([
            [firstDefinition.collection, firstCollection],
            [failingDefinition.collection, failingCollection]
        ]);
        const db = { collection: vi.fn((name) => collections.get(name)) };

        await expect(migrateUpstreamQaProvenanceIndexes({
            db,
            apply: true,
            expectedDatabaseName: 'inoxpran_production',
            actualDatabaseName: 'inoxpran_production'
        })).rejects.toMatchObject({ code: 'UPSTREAM_QA_INCOMPLETE_PROVENANCE_FOUND' });

        expect(firstCollection.updateMany).not.toHaveBeenCalled();
        expect(firstCollection.createIndex).not.toHaveBeenCalled();
        expect(firstCollection.dropIndex).not.toHaveBeenCalled();
        expect(failingCollection.updateMany).not.toHaveBeenCalled();
        expect(failingCollection.createIndex).not.toHaveBeenCalled();
        expect(failingCollection.dropIndex).not.toHaveBeenCalled();
    });
});
