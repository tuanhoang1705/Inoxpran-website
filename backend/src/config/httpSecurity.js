'use strict';

const { isProductionEnv, normalizeEnvValue, parseBooleanEnv } = require('./runtimeEnv');

const normalizeOrigin = (value, { httpsOnly = false } = {}) => {
  const candidate = normalizeEnvValue(value);
  if (!candidate) return '';
  const parsed = new URL(candidate);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('CORS origin must be an http(s) origin without credentials');
  }
  if (httpsOnly && parsed.protocol !== 'https:') {
    throw new Error('Production CORS origins must use https');
  }
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('CORS origin must not contain a path, query, or fragment');
  }
  return parsed.origin;
};

const allowedOrigins = (env = process.env) => {
  const production = isProductionEnv(env);
  const configured = String(
    env.CORS_ORIGIN || (!production ? env.CORS_ALLOWED_ORIGINS : '') || ''
  )
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => normalizeOrigin(value, { httpsOnly: production }));
  if (configured.length) return new Set(configured);
  if (production) return new Set();
  return new Set([
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:4173',
    'http://127.0.0.1:4173'
  ]);
};

const buildCorsOptions = (env = process.env) => {
  const origins = allowedOrigins(env);
  return {
    credentials: true,
    maxAge: 600,
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      let normalized;
      try {
        normalized = normalizeOrigin(origin);
      } catch {
        normalized = '';
      }
      if (normalized && origins.has(normalized)) return callback(null, true);
      const error = new Error('Origin is not allowed');
      error.statusCode = 403;
      error.code = 'CORS_ORIGIN_DENIED';
      return callback(error);
    }
  };
};

const resolveTrustProxy = (env = process.env) => {
  const fallback = isProductionEnv(env) ? 1 : 0;
  const parsed = Number(env.TRUST_PROXY_HOPS ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 3) {
    throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 3');
  }
  return parsed;
};

const swaggerEnabled = (env = process.env) =>
  parseBooleanEnv(env.SWAGGER_ENABLED, !isProductionEnv(env));

module.exports = {
  allowedOrigins,
  buildCorsOptions,
  normalizeOrigin,
  resolveTrustProxy,
  swaggerEnabled
};
