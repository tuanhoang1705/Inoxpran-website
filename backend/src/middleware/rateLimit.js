'use strict';

const { RateLimiterMemory } = require('rate-limiter-flexible');

const boundedInteger = (value, fallback, { min, max }) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const buildLimiter = ({ points, durationSeconds, blockSeconds, keyPrefix }) => {
  const limiter = new RateLimiterMemory({
    points,
    duration: durationSeconds,
    blockDuration: blockSeconds,
    keyPrefix
  });

  return async (req, res, next) => {
    const key = String(req.ip || req.socket?.remoteAddress || 'unknown').slice(0, 128);
    try {
      const result = await limiter.consume(key);
      res.set('RateLimit-Limit', String(points));
      res.set('RateLimit-Remaining', String(Math.max(0, result.remainingPoints)));
      res.set('RateLimit-Reset', String(Math.ceil(result.msBeforeNext / 1000)));
      return next();
    } catch (result) {
      const retryAfter = Math.max(1, Math.ceil(Number(result?.msBeforeNext || 1000) / 1000));
      res.set('Retry-After', String(retryAfter));
      res.set('RateLimit-Limit', String(points));
      res.set('RateLimit-Remaining', '0');
      res.set('RateLimit-Reset', String(retryAfter));
      return res.status(429).json({
        status: 'error',
        code: 429,
        errorCode: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests',
        requestId: req.requestId
      });
    }
  };
};

const rateLimitCommon = buildLimiter({
  points: boundedInteger(process.env.RATE_LIMIT_MAX, 300, { min: 10, max: 10000 }),
  durationSeconds: boundedInteger(process.env.RATE_LIMIT_WINDOW_SECONDS, 60, { min: 1, max: 3600 }),
  blockSeconds: boundedInteger(process.env.RATE_LIMIT_BLOCK_SECONDS, 60, { min: 1, max: 86400 }),
  keyPrefix: 'http-common'
});

const rateLimitStrict = buildLimiter({
  points: boundedInteger(process.env.AUTH_RATE_LIMIT_MAX, 10, { min: 1, max: 1000 }),
  durationSeconds: boundedInteger(process.env.AUTH_RATE_LIMIT_WINDOW_SECONDS, 60, { min: 1, max: 3600 }),
  blockSeconds: boundedInteger(process.env.AUTH_RATE_LIMIT_BLOCK_SECONDS, 300, { min: 1, max: 86400 }),
  keyPrefix: 'http-auth'
});

module.exports = { buildLimiter, rateLimitCommon, rateLimitStrict };
