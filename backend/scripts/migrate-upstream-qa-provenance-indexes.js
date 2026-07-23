'use strict';

const mongoose = require('mongoose');

const APPLY_FLAG = '--apply-upstream-qa-provenance-indexes';
const CONFIRMATION_ENV = 'CONFIRM_UPSTREAM_QA_PROVENANCE_INDEX_MIGRATION';
const CONFIRMATION_VALUE = 'APPLY_SCOPED_QA_SNAPSHOT_INDEXES';
const EXPECTED_DATABASE_ENV = 'EXPECTED_UPSTREAM_QA_PROVENANCE_DATABASE';
const SAFE_DATABASE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/;

const INDEX_MIGRATIONS = Object.freeze([
    Object.freeze({
        collection: 'GoogleIntelligenceSnapshots',
        legacy: Object.freeze({
            name: 'snapshotDate_1_timezone_1',
            key: Object.freeze({ snapshotDate: 1, timezone: 1 }),
            unique: true
        }),
        target: Object.freeze({
            name: 'google_snapshot_scope_unique',
            key: Object.freeze({ snapshotDate: 1, timezone: 1, isQaTest: 1, qaBatchId: 1, qaCaseId: 1 }),
            unique: true
        })
    }),
    Object.freeze({
        collection: 'ContentOperationsDailySnapshots',
        legacy: Object.freeze({
            name: 'snapshotDate_1_timezone_1',
            key: Object.freeze({ snapshotDate: 1, timezone: 1 }),
            unique: true
        }),
        target: Object.freeze({
            name: 'content_operations_snapshot_scope_unique',
            key: Object.freeze({ snapshotDate: 1, timezone: 1, isQaTest: 1, qaBatchId: 1, qaCaseId: 1 }),
            unique: true
        })
    }),
    Object.freeze({
        collection: 'ContentInventorySnapshots',
        legacy: Object.freeze({
            name: 'snapshotDate_1_timezone_1',
            key: Object.freeze({ snapshotDate: 1, timezone: 1 }),
            unique: true
        }),
        target: Object.freeze({
            name: 'content_inventory_snapshot_scope_unique',
            key: Object.freeze({ snapshotDate: 1, timezone: 1, isQaTest: 1, qaBatchId: 1, qaCaseId: 1 }),
            unique: true
        })
    }),
    Object.freeze({
        collection: 'ContentOpportunityDecisions',
        legacy: Object.freeze({
            name: 'contentOperationsSnapshotId_1_candidateId_1',
            key: Object.freeze({ contentOperationsSnapshotId: 1, candidateId: 1 }),
            unique: true
        }),
        target: Object.freeze({
            name: 'content_opportunity_scope_unique',
            key: Object.freeze({
                contentOperationsSnapshotId: 1,
                candidateId: 1,
                isQaTest: 1,
                qaBatchId: 1,
                qaCaseId: 1
            }),
            unique: true
        })
    })
]);

const migrationError = (code) => {
    const error = new Error(code);
    error.code = code;
    return error;
};

const keyEntries = (value = {}) => Object.entries(value).map(([key, direction]) => [key, Number(direction)]);
const keysEqual = (left, right) => {
    const leftEntries = keyEntries(left);
    const rightEntries = keyEntries(right);
    return leftEntries.length === rightEntries.length && leftEntries.every(([key, direction], index) => (
        rightEntries[index]?.[0] === key && rightEntries[index]?.[1] === direction
    ));
};

const assertExactIndex = (index, expected, codePrefix) => {
    if (!index) return false;
    if (index.name !== expected.name) throw migrationError(`${codePrefix}_NAME_MISMATCH`);
    if (!keysEqual(index.key, expected.key)) throw migrationError(`${codePrefix}_KEY_MISMATCH`);
    if (Boolean(index.unique) !== Boolean(expected.unique)) throw migrationError(`${codePrefix}_UNIQUE_MISMATCH`);
    if (Boolean(index.sparse) !== Boolean(expected.sparse)) {
        throw migrationError(`${codePrefix}_SPARSE_MISMATCH`);
    }
    if (index.partialFilterExpression != null || expected.partialFilterExpression != null) {
        throw migrationError(`${codePrefix}_PARTIAL_FILTER_MISMATCH`);
    }
    if (index.collation != null && String(index.collation?.locale || '') !== 'simple') {
        throw migrationError(`${codePrefix}_COLLATION_MISMATCH`);
    }
    return true;
};

const resolveExecutionMode = ({ argv = process.argv.slice(2), env = process.env } = {}) => {
    const apply = argv.includes(APPLY_FLAG);
    if (apply && env[CONFIRMATION_ENV] !== CONFIRMATION_VALUE) {
        throw migrationError('UPSTREAM_QA_INDEX_MIGRATION_CONFIRMATION_REQUIRED');
    }
    if (!apply) return Object.freeze({ apply: false, dryRun: true });
    const expectedDatabaseName = String(env[EXPECTED_DATABASE_ENV] || '').trim();
    if (!SAFE_DATABASE_NAME.test(expectedDatabaseName)) {
        throw migrationError('UPSTREAM_QA_INDEX_MIGRATION_DATABASE_CONFIRMATION_REQUIRED');
    }
    return Object.freeze({ apply: true, dryRun: false, expectedDatabaseName });
};

const assertExpectedDatabaseTarget = ({ apply = false, expectedDatabaseName = '', actualDatabaseName = '' } = {}) => {
    if (!apply) return true;
    if (!SAFE_DATABASE_NAME.test(String(expectedDatabaseName || ''))) {
        throw migrationError('UPSTREAM_QA_INDEX_MIGRATION_DATABASE_CONFIRMATION_REQUIRED');
    }
    if (String(actualDatabaseName || '') !== String(expectedDatabaseName)) {
        throw migrationError('UPSTREAM_QA_INDEX_MIGRATION_DATABASE_MISMATCH');
    }
    return true;
};

const buildIndexMigrationPlan = ({
    definition,
    indexes = [],
    productionBackfillCount = 0,
    incompleteQaCount = 0
} = {}) => {
    if (!definition) throw migrationError('UPSTREAM_QA_INDEX_DEFINITION_REQUIRED');
    const legacyByName = indexes.find((index) => index.name === definition.legacy.name) || null;
    const targetByName = indexes.find((index) => index.name === definition.target.name) || null;
    const unexpectedLegacy = indexes.find((index) => (
        index.name !== definition.legacy.name &&
        Boolean(index.unique) === definition.legacy.unique &&
        keysEqual(index.key, definition.legacy.key)
    ));
    const unexpectedTarget = indexes.find((index) => (
        index.name !== definition.target.name &&
        Boolean(index.unique) === definition.target.unique &&
        keysEqual(index.key, definition.target.key)
    ));
    if (unexpectedLegacy) throw migrationError('UPSTREAM_QA_LEGACY_INDEX_NAME_UNEXPECTED');
    if (unexpectedTarget) throw migrationError('UPSTREAM_QA_TARGET_INDEX_NAME_UNEXPECTED');
    if (legacyByName) assertExactIndex(legacyByName, definition.legacy, 'UPSTREAM_QA_LEGACY_INDEX');
    if (targetByName) assertExactIndex(targetByName, definition.target, 'UPSTREAM_QA_TARGET_INDEX');
    if (Number(incompleteQaCount) > 0) throw migrationError('UPSTREAM_QA_INCOMPLETE_PROVENANCE_FOUND');

    const operations = [];
    if (Number(productionBackfillCount) > 0) {
        operations.push({ type: 'backfill_non_qa_provenance', count: Number(productionBackfillCount) });
    }
    if (!targetByName) {
        operations.push({
            type: 'create_target_index',
            name: definition.target.name,
            key: definition.target.key,
            unique: true
        });
    }
    if (legacyByName) {
        operations.push({
            type: 'drop_legacy_index',
            name: definition.legacy.name,
            key: definition.legacy.key,
            unique: true
        });
    }
    return Object.freeze({
        collection: definition.collection,
        productionBackfillCount: Number(productionBackfillCount),
        incompleteQaCount: Number(incompleteQaCount),
        operations
    });
};

const productionBackfillFilter = Object.freeze({
    isQaTest: { $ne: true },
    $or: [
        { isQaTest: { $exists: false } },
        { qaBatchId: { $exists: false } },
        { qaBatchId: { $ne: null } },
        { qaCaseId: { $exists: false } },
        { qaCaseId: { $ne: null } },
        { environment: { $exists: false } },
        { environment: { $ne: '' } },
        { executionMode: { $exists: false } },
        { executionMode: { $ne: '' } },
        { originalTopicSeed: { $exists: false } },
        { originalTopicSeed: { $ne: '' } },
        { normalizedTopicKey: { $exists: false } },
        { normalizedTopicKey: { $ne: '' } }
    ]
});

const incompleteQaFilter = Object.freeze({
    isQaTest: true,
    $or: [
        { qaBatchId: null },
        { qaBatchId: { $exists: false } },
        { qaBatchId: { $not: { $type: 'objectId' } } },
        { qaCaseId: null },
        { qaCaseId: { $exists: false } },
        { qaCaseId: { $not: { $type: 'objectId' } } },
        { environment: { $nin: ['local', 'staging'] } },
        { executionMode: { $nin: ['run_now', 'schedule_run_now', 'actual_schedule'] } },
        { originalTopicSeed: null },
        { originalTopicSeed: '' },
        { originalTopicSeed: { $exists: false } },
        { originalTopicSeed: { $not: /\S/ } },
        {
            $expr: {
                $gt: [
                    {
                        $strLenCP: {
                            $convert: { input: '$originalTopicSeed', to: 'string', onError: '', onNull: '' }
                        }
                    },
                    300
                ]
            }
        },
        { normalizedTopicKey: null },
        { normalizedTopicKey: '' },
        { normalizedTopicKey: { $exists: false } },
        { normalizedTopicKey: { $not: /\S/ } },
        {
            $expr: {
                $gt: [
                    {
                        $strLenCP: {
                            $convert: { input: '$normalizedTopicKey', to: 'string', onError: '', onNull: '' }
                        }
                    },
                    320
                ]
            }
        }
    ]
});

const productionDefaults = Object.freeze({
    isQaTest: false,
    qaBatchId: null,
    qaCaseId: null,
    environment: '',
    executionMode: '',
    originalTopicSeed: '',
    normalizedTopicKey: ''
});

const listIndexesSafe = async (collection) => {
    try {
        return await collection.indexes();
    } catch (error) {
        if (error?.codeName === 'NamespaceNotFound' || error?.code === 26) return [];
        throw error;
    }
};

const inspectCollectionMigration = async ({ db, definition } = {}) => {
    const collection = db.collection(definition.collection);
    const [indexes, productionBackfillCount, incompleteQaCount] = await Promise.all([
        listIndexesSafe(collection),
        collection.countDocuments(productionBackfillFilter),
        collection.countDocuments(incompleteQaFilter)
    ]);
    const plan = buildIndexMigrationPlan({
        definition,
        indexes,
        productionBackfillCount,
        incompleteQaCount
    });
    return { collection, definition, plan };
};

const applyInspectedCollectionMigration = async ({ collection, definition, plan } = {}) => {
    const productionBackfillCount = Number(plan?.productionBackfillCount || 0);

    if (productionBackfillCount > 0) {
        await collection.updateMany(productionBackfillFilter, { $set: productionDefaults });
    }
    if (plan.operations.some((operation) => operation.type === 'create_target_index')) {
        await collection.createIndex(definition.target.key, {
            name: definition.target.name,
            unique: true
        });
    }
    const afterCreate = await listIndexesSafe(collection);
    assertExactIndex(
        afterCreate.find((index) => index.name === definition.target.name),
        definition.target,
        'UPSTREAM_QA_TARGET_INDEX'
    );
    if (plan.operations.some((operation) => operation.type === 'drop_legacy_index')) {
        const legacy = afterCreate.find((index) => index.name === definition.legacy.name);
        assertExactIndex(legacy, definition.legacy, 'UPSTREAM_QA_LEGACY_INDEX');
        await collection.dropIndex(definition.legacy.name);
    }
    const finalIndexes = await listIndexesSafe(collection);
    assertExactIndex(
        finalIndexes.find((index) => index.name === definition.target.name),
        definition.target,
        'UPSTREAM_QA_TARGET_INDEX'
    );
    if (finalIndexes.some((index) => index.name === definition.legacy.name)) {
        throw migrationError('UPSTREAM_QA_LEGACY_INDEX_STILL_PRESENT');
    }
    return { ...plan, applied: true };
};

const runCollectionMigration = async ({ db, definition, apply = false } = {}) => {
    const inspected = await inspectCollectionMigration({ db, definition });
    if (!apply) return { ...inspected.plan, applied: false };
    return applyInspectedCollectionMigration(inspected);
};

const migrateUpstreamQaProvenanceIndexes = async ({
    db,
    apply = false,
    expectedDatabaseName = '',
    actualDatabaseName = ''
} = {}) => {
    if (!db || typeof db.collection !== 'function') throw migrationError('UPSTREAM_QA_MIGRATION_DB_REQUIRED');
    assertExpectedDatabaseTarget({ apply, expectedDatabaseName, actualDatabaseName });
    const inspectedCollections = [];
    for (const definition of INDEX_MIGRATIONS) {
        inspectedCollections.push(await inspectCollectionMigration({ db, definition }));
    }
    if (!apply) {
        return {
            dryRun: true,
            applied: false,
            collections: inspectedCollections.map(({ plan }) => ({ ...plan, applied: false }))
        };
    }
    const collections = [];
    for (const inspected of inspectedCollections) {
        collections.push(await applyInspectedCollectionMigration(inspected));
    }
    return { dryRun: !apply, applied: apply, collections };
};

const main = async () => {
    let connected = false;
    try {
        require('dotenv').config();
        const mode = resolveExecutionMode();
        if (!process.env.MONGODB_URI) throw migrationError('MONGODB_URI_REQUIRED');
        await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, autoCreate: false, maxPoolSize: 2 });
        connected = true;
        const summary = await migrateUpstreamQaProvenanceIndexes({
            db: mongoose.connection.db,
            apply: mode.apply,
            expectedDatabaseName: mode.expectedDatabaseName,
            actualDatabaseName: mongoose.connection.name
        });
        console.log(JSON.stringify({ ok: true, ...summary }, null, 2));
    } catch (error) {
        console.error(JSON.stringify({
            ok: false,
            code: String(error?.code || 'UPSTREAM_QA_INDEX_MIGRATION_FAILED').slice(0, 120)
        }, null, 2));
        process.exitCode = 1;
    } finally {
        if (connected) await mongoose.disconnect().catch(() => {});
    }
};

if (require.main === module) main();

module.exports = {
    APPLY_FLAG,
    CONFIRMATION_ENV,
    CONFIRMATION_VALUE,
    EXPECTED_DATABASE_ENV,
    INDEX_MIGRATIONS,
    applyInspectedCollectionMigration,
    assertExpectedDatabaseTarget,
    assertExactIndex,
    buildIndexMigrationPlan,
    keysEqual,
    migrateUpstreamQaProvenanceIndexes,
    inspectCollectionMigration,
    resolveExecutionMode,
    runCollectionMigration
};
