'use strict';

// Creates the performance indexes the storefront list queries rely on.
//
// These are not correctness indexes, so they are deliberately kept out of
// PRODUCTION_INDEX_MANIFEST: that manifest is verified at boot and a missing entry
// refuses to start the API, which is the right behaviour for a uniqueness guarantee
// and the wrong one for a sort optimisation. Production runs with autoIndex off, so
// schema-declared indexes are created here instead - explicitly, and on demand.
//
// Safe to re-run: createIndexes() is idempotent and skips indexes that already exist.
//
//   node scripts/ensure-query-indexes.js [--dry-run]

const mongoose = require('mongoose');
const { blog } = require('../src/models/blog.model');
const { product } = require('../src/models/product.model');
const { loadRuntimeEnv } = require('../src/config/runtimeEnv');

loadRuntimeEnv();

const TARGETS = [
    { label: 'blogs', model: blog },
    { label: 'products', model: product }
];

const readIndexNames = async (model) => {
    try {
        const indexes = await model.collection.indexes();
        return new Set(indexes.map((index) => index?.name).filter(Boolean));
    } catch (error) {
        // An empty collection has no namespace yet; createIndexes still works.
        if (error?.code === 26 || error?.codeName === 'NamespaceNotFound') return new Set();
        throw error;
    }
};

const ensureQueryIndexes = async ({ dryRun = false } = {}) => {
    const uri = String(process.env.MONGODB_URI || '').trim();
    if (!uri) throw new Error('MONGODB_URI is required');

    await mongoose.connect(uri, { autoIndex: false, serverSelectionTimeoutMS: 30000 });
    try {
        for (const { label, model } of TARGETS) {
            const before = await readIndexNames(model);
            const declared = model.schema.indexes().map(([key, options = {}]) => ({
                key,
                name: options.name || Object.entries(key).map(([f, d]) => `${f}_${d}`).join('_')
            }));
            const missing = declared.filter((index) => !before.has(index.name));

            if (!missing.length) {
                console.info(`${label}: all ${declared.length} declared indexes already present`);
                continue;
            }

            console.info(
                `${label}: ${missing.length} missing -> ${missing.map((i) => i.name).join(', ')}`
            );
            if (dryRun) continue;

            const startedAt = Date.now();
            await model.createIndexes();
            const after = await readIndexNames(model);
            const created = missing.filter((index) => after.has(index.name));
            console.info(
                `${label}: created ${created.length}/${missing.length} in ${Date.now() - startedAt}ms`
            );
            const stillMissing = missing.filter((index) => !after.has(index.name));
            if (stillMissing.length) {
                throw new Error(
                    `${label}: index not created: ${stillMissing.map((i) => i.name).join(', ')}`
                );
            }
        }
    } finally {
        await mongoose.disconnect().catch(() => undefined);
    }
};

if (require.main === module) {
    const dryRun = process.argv.includes('--dry-run');
    ensureQueryIndexes({ dryRun })
        .then(() => {
            console.info(dryRun ? 'ensure-query-indexes: dry run complete' : 'ensure-query-indexes: done');
            process.exit(0);
        })
        .catch((error) => {
            console.error('ensure-query-indexes failed:', error?.message || error);
            process.exit(1);
        });
}

module.exports = { ensureQueryIndexes };
