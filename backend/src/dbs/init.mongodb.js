'use strict';

const mongoose = require('mongoose');
const { ensureApiKeys } = require('../helpers/bootstrapApiKey');
const { isProductionEnv, parseBooleanEnv } = require('../config/runtimeEnv');
const { verifyProductionIndexManifest } = require('./productionIndexManifest');

const boundedInteger = (value, fallback, { min, max }) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

class Database {
  constructor() {
    this.connectPromise = null;
  }

  async connect() {
    if (mongoose.connection.readyState === 1) return mongoose.connection;
    if (this.connectPromise) return this.connectPromise;

    const uri = String(process.env.MONGODB_URI || '').trim();
    if (!uri) {
      const error = new Error('MONGODB_URI is required');
      error.code = 'MONGODB_URI_MISSING';
      throw error;
    }

    const production = isProductionEnv();
    const autoIndex = production
      ? false
      : parseBooleanEnv(process.env.MONGOOSE_AUTO_INDEX, true);
    const maxPoolSize = boundedInteger(process.env.MONGODB_MAX_POOL_SIZE, 50, {
      min: 1,
      max: 200
    });
    const serverSelectionTimeoutMS = boundedInteger(
      process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS,
      15000,
      { min: 1000, max: 120000 }
    );

    mongoose.set(
      'debug',
      parseBooleanEnv(process.env.MONGOOSE_DEBUG, false) ? { color: !production } : false
    );

    this.connectPromise = mongoose.connect(uri, {
      autoIndex,
      maxPoolSize,
      serverSelectionTimeoutMS
    }).then(async () => {
      if (production) await verifyProductionIndexManifest();
      await ensureApiKeys();
      console.info('MongoDB connection ready');
      return mongoose.connection;
    }).catch(async (error) => {
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect().catch(() => undefined);
      }
      throw error;
    }).finally(() => {
      this.connectPromise = null;
    });

    return this.connectPromise;
  }

  isReady() {
    return mongoose.connection.readyState === 1;
  }

  status() {
    const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
    return states[mongoose.connection.readyState] || 'unknown';
  }

  async disconnect() {
    if (mongoose.connection.readyState === 0) return;
    await mongoose.disconnect();
  }
}

module.exports = new Database();
module.exports.Database = Database;
