'use strict';

const crypto = require('node:crypto');

const SAFE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const safeRequestId = (value) => {
  const candidate = String(value || '').trim();
  return SAFE_REQUEST_ID.test(candidate) ? candidate : '';
};

const requestContext = (req, res, next) => {
  const upstreamId = safeRequestId(req.get('x-request-id'));
  req.requestId = upstreamId || crypto.randomUUID();
  res.set('X-Request-Id', req.requestId);
  next();
};

module.exports = { requestContext, safeRequestId };
