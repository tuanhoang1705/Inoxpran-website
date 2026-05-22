'use strict';

require('dotenv').config();

const mongoose = require('mongoose');
const { product } = require('../src/models/product.model');

const roundToOneDecimal = (value) => Math.round(value * 10) / 10;

const normalizeRatingsSnapshot = (source = {}) => {
    const rawCount = Number(source.product_ratingsCount);
    const nextCount = Number.isFinite(rawCount) && rawCount > 0 ? Math.floor(rawCount) : 0;

    const rawAverage = Number(source.product_ratingsAverage);
    const nextAverage =
        nextCount > 0 && Number.isFinite(rawAverage) && rawAverage >= 0
            ? roundToOneDecimal(Math.min(rawAverage, 5))
            : 0;

    return {
        product_ratingsAverage: nextAverage,
        product_ratingsCount: nextCount
    };
};

const shouldUpdateRatings = (source = {}, normalized = {}) => {
    const currentAverage = Number(source.product_ratingsAverage);
    const currentCount = Number(source.product_ratingsCount);
    return (
        !Number.isFinite(currentAverage) ||
        !Number.isFinite(currentCount) ||
        roundToOneDecimal(Math.max(0, Math.min(currentAverage, 5))) !==
            normalized.product_ratingsAverage ||
        Math.max(0, Math.floor(currentCount)) !== normalized.product_ratingsCount
    );
};

const migrateProductRatings = async ({ dryRun = false } = {}) => {
    const connectString = process.env.MONGODB_URI;
    if (!connectString) {
        throw new Error('Missing MONGODB_URI');
    }

    await mongoose.connect(connectString, {
        autoIndex: true,
        maxPoolSize: 10
    });

    const products = await product
        .find({}, { _id: 1, product_name: 1, product_ratingsAverage: 1, product_ratingsCount: 1 })
        .lean()
        .exec();

    const operations = products
        .map((item) => {
            const normalized = normalizeRatingsSnapshot(item);
            if (!shouldUpdateRatings(item, normalized)) return null;

            return {
                updateOne: {
                    filter: { _id: item._id },
                    update: { $set: normalized }
                }
            };
        })
        .filter(Boolean);

    const summary = {
        dryRun,
        scanned: products.length,
        matched: operations.length,
        modified: 0
    };

    if (!dryRun && operations.length) {
        const result = await product.bulkWrite(operations, { ordered: false });
        summary.modified = Number(result.modifiedCount || 0);
    }

    return summary;
};

const main = async () => {
    const dryRun = process.argv.includes('--dry-run');

    try {
        const summary = await migrateProductRatings({ dryRun });
        console.log(
            JSON.stringify(
                {
                    ok: true,
                    ...summary
                },
                null,
                2
            )
        );
    } catch (error) {
        console.error(
            JSON.stringify(
                {
                    ok: false,
                    message: error?.message || String(error)
                },
                null,
                2
            )
        );
        process.exitCode = 1;
    } finally {
        await mongoose.disconnect().catch(() => {});
    }
};

if (require.main === module) {
    main();
}

module.exports = {
    migrateProductRatings,
    normalizeRatingsSnapshot
};
