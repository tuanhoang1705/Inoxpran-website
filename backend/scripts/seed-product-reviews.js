'use strict';

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

require('../src/dbs/init.mongodb');

const ProductService = require('../src/services/product.service');

const parseArgs = (argv = []) => {
    const args = { file: '' };
    for (let index = 0; index < argv.length; index += 1) {
        const current = argv[index];
        if (current === '--file' || current === '-f') {
            args.file = String(argv[index + 1] || '').trim();
            index += 1;
        }
    }
    return args;
};

const waitForMongo = async (timeoutMs = 20000) => {
    if (mongoose.connection.readyState === 1) return;

    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            cleanup();
            reject(new Error('Timed out waiting for MongoDB connection'));
        }, timeoutMs);

        const handleOpen = () => {
            cleanup();
            resolve();
        };

        const handleError = (error) => {
            cleanup();
            reject(error);
        };

        const cleanup = () => {
            clearTimeout(timeout);
            mongoose.connection.off('open', handleOpen);
            mongoose.connection.off('error', handleError);
        };

        mongoose.connection.on('open', handleOpen);
        mongoose.connection.on('error', handleError);
    });
};

const loadSeedEntries = (filePath) => {
    const resolved = path.resolve(process.cwd(), filePath);
    const raw = fs.readFileSync(resolved, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
        throw new Error('Seed file must contain an array of review entries');
    }
    return parsed;
};

const resolveProductLookup = (entry = {}) =>
    String(
        entry.productLookup ||
            entry.productSlug ||
            entry.productId ||
            entry.product_id ||
            ''
    ).trim();

const run = async () => {
    const args = parseArgs(process.argv.slice(2));
    if (!args.file) {
        throw new Error('Missing --file argument');
    }

    await waitForMongo();
    const entries = loadSeedEntries(args.file);
    const results = {
        created: 0,
        failed: 0
    };

    for (const [index, entry] of entries.entries()) {
        const productLookup = resolveProductLookup(entry);
        if (!productLookup) {
            results.failed += 1;
            console.error(`[${index + 1}] Missing product lookup`);
            continue;
        }

        try {
            const review = await ProductService.createAdminProductReview({
                product_id: productLookup,
                reviewerId: null,
                payload: {
                    ...entry,
                    source: 'seed'
                }
            });
            results.created += 1;
            console.log(
                `[${index + 1}] Created review for ${productLookup}: ${review.authorName} (${review.rating}/5)`
            );
        } catch (error) {
            results.failed += 1;
            console.error(
                `[${index + 1}] Failed for ${productLookup}: ${error?.message || error}`
            );
        }
    }

    console.log(`Created: ${results.created}`);
    console.log(`Failed: ${results.failed}`);
};

run()
    .catch((error) => {
        console.error(error?.message || error);
        process.exitCode = 1;
    })
    .finally(async () => {
        try {
            await mongoose.disconnect();
        } catch {
            // noop
        }
    });
