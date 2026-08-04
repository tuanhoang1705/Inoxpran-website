import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const manifestModule = require("../src/dbs/productionIndexManifest");
const { PRODUCTION_INDEX_MANIFEST, requirementMatches } = manifestModule;

describe("production index manifest", () => {
  it("does not expose a schema-wide index creation bypass", () => {
    expect(manifestModule).not.toHaveProperty("createProductionIndexes");
  });

  it("describes every named safety index with its exact key and options", () => {
    const named = PRODUCTION_INDEX_MANIFEST.flatMap(
      (entry) => entry.requirements,
    ).filter((requirement) => requirement.name);
    expect(named.length).toBeGreaterThan(0);
    for (const requirement of named) {
      expect(requirement.key).toBeTruthy();
      expect(requirement).toHaveProperty("unique");
      expect(requirement).toHaveProperty("sparse");
      expect(requirement).toHaveProperty("partialFilterExpression");
    }
  });

  it("rejects an index that reuses the expected name with unsafe options", () => {
    const requirement = PRODUCTION_INDEX_MANIFEST.flatMap(
      (entry) => entry.requirements,
    ).find(
      (entry) => entry.name === "topic_roadmap_regeneration_active_unique",
    );
    const correct = {
      name: requirement.name,
      key: { ...requirement.key },
      unique: true,
      partialFilterExpression: { activeFence: true },
    };
    expect(requirementMatches(correct, requirement)).toBe(true);
    expect(
      requirementMatches(
        {
          ...correct,
          key: { roadmapId: 1, activeFence: -1 },
        },
        requirement,
      ),
    ).toBe(false);
    expect(
      requirementMatches(
        {
          ...correct,
          partialFilterExpression: { activeFence: false },
        },
        requirement,
      ),
    ).toBe(false);
    expect(requirementMatches({ ...correct, sparse: true }, requirement)).toBe(
      false,
    );
  });
});
