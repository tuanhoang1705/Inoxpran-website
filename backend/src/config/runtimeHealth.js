"use strict";

const database = require("../dbs/init.mongodb");
const { getRedisHealth } = require("./redis");

let applicationReady = false;
let shuttingDown = false;
const startedAt = Date.now();

const markApplicationReady = () => {
  applicationReady = true;
  shuttingDown = false;
};

const markApplicationNotReady = ({ shutdown = false } = {}) => {
  applicationReady = false;
  shuttingDown = shutdown;
};

const liveness = () => ({
  status: "alive",
  uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
});

const readiness = () => {
  const redis = getRedisHealth();
  const checks = {
    application: applicationReady && !shuttingDown ? "ready" : "not_ready",
    mongodb: database.isReady() ? "ready" : database.status(),
    redis: redis.required
      ? redis.ready
        ? "ready"
        : "not_ready"
      : redis.ready
        ? "ready"
        : redis.enabled
          ? "degraded_optional"
          : "disabled_optional",
  };
  const ready =
    checks.application === "ready" &&
    checks.mongodb === "ready" &&
    (!redis.required || checks.redis === "ready");

  return {
    ready,
    payload: {
      status: ready ? "ready" : "not_ready",
      checks,
    },
  };
};

module.exports = {
  liveness,
  markApplicationNotReady,
  markApplicationReady,
  readiness,
};
