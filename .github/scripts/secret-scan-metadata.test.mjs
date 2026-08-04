import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyFindingPath,
  summarizeFindings,
} from "./secret-scan-metadata.mjs";

test("classifies fixtures, tooling, generated files, and production source", () => {
  assert.equal(
    classifyFindingPath("backend/tests/fixtures/provider-response.json"),
    "testFixture",
  );
  assert.equal(
    classifyFindingPath(".github/workflows/ci.yml"),
    "repositoryTooling",
  );
  assert.equal(
    classifyFindingPath("frontend/build/client/app.js"),
    "generatedArtifact",
  );
  assert.equal(
    classifyFindingPath("backend/src/config/runtimeEnv.js"),
    "productionSource",
  );
  assert.equal(
    classifyFindingPath("any/path", "local-ignored"),
    "localIgnoredArtifact",
  );
});

test("summary contains counts and safe metadata but never raw finding fields", () => {
  const sensitiveMarker = "must-not-appear-in-summary";
  const summary = summarizeFindings({
    scope: "history",
    gitleaksVersion: "8.30.1",
    includeLocationMetadata: true,
    scannedInputCount: null,
    findings: [
      {
        RuleID: "generic-api-key",
        File: "backend/src/config/example.js",
        Commit: "a".repeat(40),
        StartLine: 12,
        EndLine: 12,
        Secret: sensitiveMarker,
        Match: `api_key=${sensitiveMarker}`,
        Author: sensitiveMarker,
        Email: sensitiveMarker,
        Message: sensitiveMarker,
      },
      {
        RuleID: "generic-api-key",
        File: "backend/tests/fixture.js",
        Commit: "b".repeat(40),
      },
    ],
  });

  assert.equal(summary.totalFindings, 2);
  assert.equal(summary.affectedFileCount, 2);
  assert.equal(summary.affectedCommitCount, 2);
  assert.equal(summary.classificationCounts.productionSource, 1);
  assert.equal(summary.classificationCounts.testFixture, 1);
  assert.deepEqual(summary.ruleCounts, { "generic-api-key": 2 });
  assert.equal(summary.rawFindingOutput, false);
  assert.deepEqual(summary.locationMetadata[0], {
    ruleId: "generic-api-key",
    classification: "productionSource",
    startLine: 12,
    endLine: 12,
  });
  assert.equal(JSON.stringify(summary).includes(sensitiveMarker), false);
});

test("empty scans produce a pass summary", () => {
  const summary = summarizeFindings({
    findings: [],
    scope: "current",
    gitleaksVersion: "8.30.1",
    scannedInputCount: 42,
  });

  assert.equal(summary.status, "pass");
  assert.equal(summary.totalFindings, 0);
  assert.equal(summary.scannedInputCount, 42);
});
