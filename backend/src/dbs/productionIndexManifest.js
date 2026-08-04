"use strict";

const { isDeepStrictEqual } = require("node:util");

const apiKeyModel = require("../models/apiKey.model");
const {
  BlogAutomationExecution,
} = require("../models/blogAutomationExecution.model");
const {
  BlogAutomationSchedule,
} = require("../models/blogAutomationSchedule.model");
const { BlogTopicRoadmap } = require("../models/blogTopicRoadmap.model");
const {
  BlogTopicRoadmapItem,
} = require("../models/blogTopicRoadmapItem.model");
const {
  BlogTopicRoadmapRegeneration,
} = require("../models/blogTopicRoadmapRegeneration.model");
const { TopicIdeationRun } = require("../models/topicIdeationRun.model");

const PRODUCTION_INDEX_MANIFEST = Object.freeze([
  {
    model: apiKeyModel,
    requirements: [{ id: "api_key_unique", key: { key: 1 }, unique: true }],
  },
  {
    model: BlogAutomationExecution,
    requirements: [
      { id: "execution_key_unique", key: { executionKey: 1 }, unique: true },
    ],
  },
  {
    model: BlogAutomationSchedule,
    requirements: [
      {
        id: "qa_schedule_case_unique",
        name: "qa_schedule_case_unique",
        key: { qaCaseId: 1 },
        unique: true,
        sparse: false,
        partialFilterExpression: { isQaTest: true },
      },
    ],
  },
  {
    model: BlogTopicRoadmap,
    requirements: [
      { id: "roadmap_schedule_unique", key: { scheduleId: 1 }, unique: true },
    ],
  },
  {
    model: BlogTopicRoadmapItem,
    requirements: [
      {
        id: "topic_roadmap_item_epoch_uniqueness",
        name: "topic_roadmap_item_epoch_uniqueness",
        key: { scheduleId: 1, uniquenessKey: 1, activationEpoch: 1 },
        unique: true,
        sparse: false,
        partialFilterExpression: null,
      },
    ],
  },
  {
    model: BlogTopicRoadmapRegeneration,
    requirements: [
      {
        id: "topic_roadmap_regeneration_idempotency_unique",
        name: "topic_roadmap_regeneration_idempotency_unique",
        key: { roadmapId: 1, idempotencyKeyHash: 1 },
        unique: true,
        sparse: false,
        partialFilterExpression: null,
      },
      {
        id: "topic_roadmap_regeneration_coalesced_idempotency_unique",
        name: "topic_roadmap_regeneration_coalesced_idempotency_unique",
        key: { roadmapId: 1, coalescedIdempotencyKeyHashes: 1 },
        unique: true,
        sparse: true,
        partialFilterExpression: null,
      },
      {
        id: "topic_roadmap_regeneration_active_unique",
        name: "topic_roadmap_regeneration_active_unique",
        key: { roadmapId: 1, activeFence: 1 },
        unique: true,
        sparse: false,
        partialFilterExpression: { activeFence: true },
      },
      {
        id: "topic_roadmap_regeneration_queue_lease",
        name: "topic_roadmap_regeneration_queue_lease",
        key: {
          activeFence: 1,
          status: 1,
          nextRetryAt: 1,
          leaseExpiresAt: 1,
          createdAt: 1,
        },
        unique: false,
        sparse: false,
        partialFilterExpression: null,
      },
    ],
  },
  {
    model: TopicIdeationRun,
    requirements: [
      {
        id: "topic_ideation_generation_unique",
        key: { roadmapId: 1, directionRevision: 1, generation: 1 },
        unique: true,
      },
    ],
  },
]);

const keysMatch = (actual = {}, expected = {}) => {
  const actualEntries = Object.entries(actual);
  const expectedEntries = Object.entries(expected);
  return (
    actualEntries.length === expectedEntries.length &&
    expectedEntries.every(
      ([key, value], index) =>
        actualEntries[index]?.[0] === key &&
        actualEntries[index]?.[1] === value,
    )
  );
};

const requirementMatches = (index, requirement) => {
  if (requirement.name && index?.name !== requirement.name) return false;
  if (requirement.key && !keysMatch(index?.key, requirement.key)) return false;
  if (
    Object.prototype.hasOwnProperty.call(requirement, "unique") &&
    Boolean(index?.unique) !== requirement.unique
  )
    return false;
  if (
    Object.prototype.hasOwnProperty.call(requirement, "sparse") &&
    Boolean(index?.sparse) !== requirement.sparse
  )
    return false;
  if (
    Object.prototype.hasOwnProperty.call(requirement, "partialFilterExpression")
  ) {
    const actualPartial = index?.partialFilterExpression ?? null;
    if (!isDeepStrictEqual(actualPartial, requirement.partialFilterExpression))
      return false;
  }
  return true;
};

const readIndexes = async (model) => {
  try {
    return await model.collection.indexes();
  } catch (error) {
    if (error?.code === 26 || error?.codeName === "NamespaceNotFound")
      return [];
    throw error;
  }
};

const verifyProductionIndexManifest = async () => {
  const missing = [];
  for (const entry of PRODUCTION_INDEX_MANIFEST) {
    const indexes = await readIndexes(entry.model);
    if (
      entry.model === apiKeyModel &&
      indexes.some(
        (index) =>
          index?.key?.createdAt === 1 &&
          Object.prototype.hasOwnProperty.call(index, "expireAfterSeconds"),
      )
    ) {
      missing.push(
        `${entry.model.collection.collectionName}:legacy_ttl_forbidden`,
      );
    }
    for (const requirement of entry.requirements) {
      if (!indexes.some((index) => requirementMatches(index, requirement))) {
        missing.push(
          `${entry.model.collection.collectionName}:${requirement.id}`,
        );
      }
    }
  }

  if (missing.length) {
    const error = new Error("Required production index manifest is incomplete");
    error.code = "PRODUCTION_INDEX_MANIFEST_INCOMPLETE";
    error.details = missing;
    throw error;
  }
  return true;
};

module.exports = {
  PRODUCTION_INDEX_MANIFEST,
  keysMatch,
  requirementMatches,
  verifyProductionIndexManifest,
};
