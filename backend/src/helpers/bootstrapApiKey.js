'use strict';

const apikeyModel = require('../models/apiKey.model');
const { isProductionEnv, parseBooleanEnv } = require('../config/runtimeEnv');

const API_KEY_TTL_FIELD = 'createdAt';
const VALID_PERMISSIONS = new Set(['PUBLIC', 'USER', 'ADMIN', 'ADMIN_SYSTEM']);
const SCOPED_KEY_DEFINITIONS = Object.freeze([
  { envName: 'PUBLIC_API_KEY', permissions: ['PUBLIC'] },
  { envName: 'USER_API_KEY', permissions: ['USER'] },
  { envName: 'ADMIN_BFF_API_KEY', permissions: ['ADMIN'] },
  // OpenClaw state-changing routes also require independent HMAC authentication.
  { envName: 'OPENCLAW_INTERNAL_API_KEY', permissions: ['ADMIN_SYSTEM'] }
]);

const normalizeKey = (value) => String(value || '').trim();

const parsePermissions = (value, fallback = ['PUBLIC']) => {
  const requested = String(value || '')
    .split(',')
    .map((permission) => permission.trim().toUpperCase())
    .filter(Boolean);
  if (!requested.length) return [...fallback];
  const invalid = requested.filter((permission) => !VALID_PERMISSIONS.has(permission));
  if (invalid.length) {
    const error = new Error('Legacy API key permissions contain unsupported values');
    error.code = 'API_KEY_PERMISSION_INVALID';
    throw error;
  }
  return [...new Set(requested)];
};

const getConfiguredApiKeyDefinitions = (env = process.env) => {
  const definitions = [];
  const seen = new Map();

  for (const definition of SCOPED_KEY_DEFINITIONS) {
    const key = normalizeKey(env[definition.envName]);
    if (!key) continue;
    if (seen.has(key)) {
      const error = new Error(
        `${definition.envName} duplicates ${seen.get(key)}; scoped keys must be distinct`
      );
      error.code = 'API_KEY_SCOPE_COLLISION';
      throw error;
    }
    seen.set(key, definition.envName);
    definitions.push({ ...definition, key, managed: true, legacy: false });
  }

  const legacyKey = normalizeKey(env.API_KEY);
  if (legacyKey && !seen.has(legacyKey)) {
    const hasExplicitLegacyPermissions = Boolean(
      String(env.API_KEY_LEGACY_PERMISSIONS || '').trim()
    );
    definitions.push({
      envName: 'API_KEY',
      key: legacyKey,
      permissions: parsePermissions(env.API_KEY_LEGACY_PERMISSIONS, ['PUBLIC']),
      managed: hasExplicitLegacyPermissions,
      legacy: true
    });
  }

  return definitions;
};

const getApiKey = (env = process.env) =>
  normalizeKey(env.API_KEY) || normalizeKey(env.PUBLIC_API_KEY);

const findConfiguredApiKeyDefinition = (key, env = process.env) => {
  const normalized = normalizeKey(key);
  if (!normalized) return null;
  return getConfiguredApiKeyDefinitions(env)
    .find((definition) => definition.key === normalized) || null;
};

const dropLegacyTtlIndex = async () => {
  try {
    const indexes = await apikeyModel.collection.indexes();
    const legacyIndex = indexes.find((index) => {
      const keys = index?.key || {};
      return keys[API_KEY_TTL_FIELD] === 1 &&
        Object.prototype.hasOwnProperty.call(index, 'expireAfterSeconds');
    });
    if (!legacyIndex?.name) return;
    await apikeyModel.collection.dropIndex(legacyIndex.name);
    console.info('Dropped legacy API key TTL index');
  } catch (error) {
    if (error?.code === 26 || error?.codeName === 'NamespaceNotFound') return;
    throw error;
  }
};

const ensureApiKeyUniqueIndex = async (env = process.env) => {
  let indexes = [];
  try {
    indexes = await apikeyModel.collection.indexes();
  } catch (error) {
    if (error?.code !== 26 && error?.codeName !== 'NamespaceNotFound') throw error;
  }
  const uniqueKeyIndex = indexes.some((index) =>
    index?.unique === true && index?.key?.key === 1
  );
  if (uniqueKeyIndex) return;

  const mayCreate = !isProductionEnv(env) ||
    parseBooleanEnv(env.BOOTSTRAP_CREATE_INDEXES, false);
  if (!mayCreate) {
    const error = new Error(
      'The unique API key index is missing; run the reviewed production index migration first'
    );
    error.code = 'API_KEY_UNIQUE_INDEX_MISSING';
    throw error;
  }
  await apikeyModel.createIndexes();
};

const upsertScopedApiKey = async (definition) => {
  const existing = await apikeyModel.findOne({ key: definition.key }).lean();
  if (definition.legacy && existing && !definition.managed) {
    await apikeyModel.updateOne(
      { _id: existing._id },
      { $set: { status: true } }
    );
    if ((existing.permissions || []).some((permission) => permission !== 'PUBLIC')) {
      console.warn(
        'Legacy API_KEY retains existing broad permissions; configure scoped keys and rotate it'
      );
    }
    return;
  }

  await apikeyModel.updateOne(
    { key: definition.key },
    {
      $set: {
        status: true,
        permissions: definition.permissions
      },
      $setOnInsert: { createdAt: new Date() }
    },
    { upsert: true }
  );
};

const ensureApiKeys = async (env = process.env) => {
  const definitions = getConfiguredApiKeyDefinitions(env);
  if (!definitions.length) {
    const error = new Error('No configured API key is available for bootstrap');
    error.code = 'API_KEY_MISSING';
    throw error;
  }

  if (!isProductionEnv(env)) await dropLegacyTtlIndex();
  await ensureApiKeyUniqueIndex(env);
  for (const definition of definitions) {
    await upsertScopedApiKey(definition);
  }
};

const ensureApiKey = async (key = getApiKey(), env = process.env) => {
  const definition = findConfiguredApiKeyDefinition(key, env);
  if (!definition) return false;
  if (!isProductionEnv(env)) await dropLegacyTtlIndex();
  await ensureApiKeyUniqueIndex(env);
  await upsertScopedApiKey(definition);
  return true;
};

module.exports = {
  dropLegacyTtlIndex,
  ensureApiKey,
  ensureApiKeys,
  ensureApiKeyUniqueIndex,
  findConfiguredApiKeyDefinition,
  getApiKey,
  getConfiguredApiKeyDefinitions,
  parsePermissions
};
