import assert from "node:assert/strict";
import test from "node:test";

import { validateSecretRotationProof } from "./validate-secret-rotation-proof.mjs";

function validProof() {
  return {
    schemaVersion: 1,
    status: "revoked_and_rotated",
    incidentReference: "ticket://SEC-2026-0042",
    reviewedCommit: "a".repeat(40),
    credentialClasses: ["OPENAI_API_KEY", "ADMIN_BFF_API_KEY"],
    oldCredentialsRevokedAt: "2026-07-29T08:00:00Z",
    newCredentialsActivatedAt: "2026-07-29T08:05:00Z",
    secretStoreVersionReferences: [
      "secret-store://production/openai#version-2026-07-29",
      "secret-store://production/admin-bff#version-2026-07-29",
    ],
    providerRevocationEvidenceReferences: [
      "ticket://SEC-2026-0042#provider-revocation",
    ],
    scopeVerificationReferences: ["ci://run-12345#scope-smoke"],
    verifiedBy: ["team/security", "team/platform"],
    verifiedAt: "2026-07-29T08:30:00Z",
  };
}

test("accepts reference-only rotation proof", () => {
  assert.deepEqual(validateSecretRotationProof(validProof()), []);
});

test("rejects extra value-bearing fields without echoing their values", () => {
  const proof = {
    ...validProof(),
    tokenValue: "must-not-be-echoed",
  };
  const errors = validateSecretRotationProof(proof);

  assert.ok(errors.some((error) => error.startsWith("tokenValue:")));
  assert.equal(errors.join("\n").includes("must-not-be-echoed"), false);
});

test("rejects embedded secret material and placeholder commits", () => {
  const proof = validProof();
  proof.reviewedCommit = "0".repeat(40);
  proof.scopeVerificationReferences = [
    "https://operator:password@example.invalid/proof",
  ];
  const errors = validateSecretRotationProof(proof);

  assert.ok(errors.some((error) => error.startsWith("reviewedCommit:")));
  assert.ok(
    errors.some((error) => error.startsWith("scopeVerificationReferences:")),
  );
  assert.ok(errors.some((error) => error.startsWith("document:")));
});
