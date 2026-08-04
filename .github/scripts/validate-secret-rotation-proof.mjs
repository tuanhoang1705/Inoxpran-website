import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const allowedFields = new Set([
  "schemaVersion",
  "status",
  "incidentReference",
  "reviewedCommit",
  "credentialClasses",
  "oldCredentialsRevokedAt",
  "newCredentialsActivatedAt",
  "secretStoreVersionReferences",
  "providerRevocationEvidenceReferences",
  "scopeVerificationReferences",
  "verifiedBy",
  "verifiedAt",
]);

const requiredArrayFields = [
  "credentialClasses",
  "secretStoreVersionReferences",
  "providerRevocationEvidenceReferences",
  "scopeVerificationReferences",
  "verifiedBy",
];

const referencePattern = /^[A-Za-z0-9][A-Za-z0-9._:/#-]{2,239}$/;
const credentialClassPattern = /^[A-Z][A-Z0-9_]{2,79}$/;
const commonSecretPatterns = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  /:\/\/[^/\s:@]+:[^/\s@]+@/,
];

function isIsoTimestamp(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function validateSafeReferenceList(proof, field, errors) {
  const value = proof[field];
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${field}: must be a non-empty array`);
    return;
  }
  if (
    value.some(
      (entry) =>
        typeof entry !== "string" ||
        !referencePattern.test(entry) ||
        commonSecretPatterns.some((pattern) => pattern.test(entry)),
    )
  ) {
    errors.push(`${field}: contains an unsafe or malformed reference`);
  }
}

export function validateSecretRotationProof(proof) {
  const errors = [];
  if (!proof || typeof proof !== "object" || Array.isArray(proof)) {
    return ["document: must be an object"];
  }

  for (const field of Object.keys(proof)) {
    if (!allowedFields.has(field)) {
      errors.push(`${field}: field is not permitted`);
    }
  }
  for (const field of allowedFields) {
    if (!(field in proof)) errors.push(`${field}: field is required`);
  }

  if (proof.schemaVersion !== 1) {
    errors.push("schemaVersion: must equal 1");
  }
  if (proof.status !== "revoked_and_rotated") {
    errors.push("status: must equal revoked_and_rotated");
  }
  if (
    typeof proof.reviewedCommit !== "string" ||
    !/^(?!0{40})[a-f0-9]{40}$/i.test(proof.reviewedCommit)
  ) {
    errors.push("reviewedCommit: must be a non-placeholder full commit SHA");
  }
  if (
    typeof proof.incidentReference !== "string" ||
    !referencePattern.test(proof.incidentReference)
  ) {
    errors.push("incidentReference: must be a safe opaque reference");
  }

  if (
    !Array.isArray(proof.credentialClasses) ||
    proof.credentialClasses.length === 0 ||
    proof.credentialClasses.some(
      (entry) =>
        typeof entry !== "string" || !credentialClassPattern.test(entry),
    )
  ) {
    errors.push(
      "credentialClasses: must contain environment-variable names only",
    );
  }

  for (const field of requiredArrayFields.filter(
    (field) => field !== "credentialClasses",
  )) {
    validateSafeReferenceList(proof, field, errors);
  }

  for (const field of [
    "oldCredentialsRevokedAt",
    "newCredentialsActivatedAt",
    "verifiedAt",
  ]) {
    if (!isIsoTimestamp(proof[field])) {
      errors.push(`${field}: must be an ISO-8601 UTC timestamp`);
    }
  }

  if (
    isIsoTimestamp(proof.verifiedAt) &&
    isIsoTimestamp(proof.oldCredentialsRevokedAt) &&
    Date.parse(proof.verifiedAt) < Date.parse(proof.oldCredentialsRevokedAt)
  ) {
    errors.push("verifiedAt: must not precede revocation");
  }
  if (
    isIsoTimestamp(proof.verifiedAt) &&
    isIsoTimestamp(proof.newCredentialsActivatedAt) &&
    Date.parse(proof.verifiedAt) < Date.parse(proof.newCredentialsActivatedAt)
  ) {
    errors.push("verifiedAt: must not precede activation");
  }

  const serialized = JSON.stringify(proof);
  if (commonSecretPatterns.some((pattern) => pattern.test(serialized))) {
    errors.push("document: resembles secret material rather than references");
  }

  return [...new Set(errors)].sort();
}

function runCli() {
  const proofArgument = process.argv[2];
  if (!proofArgument || process.argv.length !== 3) {
    process.stderr.write(
      "Usage: node validate-secret-rotation-proof.mjs <proof.json>\n",
    );
    process.exitCode = 2;
    return;
  }

  try {
    const proofPath = path.resolve(process.cwd(), proofArgument);
    const proof = JSON.parse(fs.readFileSync(proofPath, "utf8"));
    const errors = validateSecretRotationProof(proof);
    if (errors.length > 0) {
      process.stderr.write(
        `Secret rotation proof rejected:\n- ${errors.join("\n- ")}\n`,
      );
      process.exitCode = 1;
      return;
    }

    process.stdout.write(
      `${JSON.stringify({
        schemaVersion: 1,
        status: "valid",
        disclosureMode: "counts-and-metadata-only",
        credentialClassCount: proof.credentialClasses.length,
        secretStoreReferenceCount: proof.secretStoreVersionReferences.length,
        revocationEvidenceReferenceCount:
          proof.providerRevocationEvidenceReferences.length,
        scopeVerificationReferenceCount:
          proof.scopeVerificationReferences.length,
        verifierCount: proof.verifiedBy.length,
      })}\n`,
    );
  } catch {
    process.stderr.write(
      `${JSON.stringify({
        schemaVersion: 1,
        status: "error",
        disclosureMode: "counts-and-metadata-only",
        errorCode: "SECRET_ROTATION_PROOF_UNREADABLE",
      })}\n`,
    );
    process.exitCode = 2;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  runCli();
}
