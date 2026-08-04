import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const readRepositoryFile = (relativePath) =>
  fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");

test("CI gates current source and history through the metadata-only wrapper", () => {
  const workflow = readRepositoryFile(".github/workflows/ci.yml");
  for (const scope of ["current", "history"]) {
    assert.match(
      workflow,
      new RegExp(
        String.raw`secret-scan-metadata\.mjs[\s\S]{0,240}--scope\s+${scope}\b[\s\S]{0,120}--fail-on-findings`,
        "i",
      ),
    );
  }
  assert.doesNotMatch(
    workflow,
    /["']?\$RUNNER_TEMP\/gitleaks["']?\s+(?:git|dir|detect)\b/i,
  );
  assert.match(workflow, /git\s+grep\s+--quiet\b/i);
});

test("Gitleaks report template cannot serialize secret-bearing fields", () => {
  const scannerSource = readRepositoryFile(
    ".github/scripts/secret-scan-metadata.mjs",
  );
  const template = scannerSource.match(
    /const reportTemplate = String\.raw`([\s\S]*?)`;/,
  )?.[1];
  assert.ok(template);
  for (const forbiddenField of [
    "Secret",
    "Match",
    "Author",
    "Email",
    "Message",
    "Fingerprint",
  ]) {
    assert.equal(template.includes(`.${forbiddenField}`), false);
  }
});

test("deploy preflight requires reference-only secret rotation evidence", () => {
  const deployScript = readRepositoryFile("deploy/scripts/deploy.sh");
  assert.match(deployScript, /\bSECRET_ROTATION_PROOF_REFERENCE\b/);
  assert.match(deployScript, /\bSECRET_ROTATION_PROOF_SHA256\b/);
  assert.match(
    deployScript,
    /SECRET_ROTATION_PROOF_SHA256 must be a non-placeholder SHA-256 digest/,
  );
});

test("tracked SEO helpers reject the legacy shared API key", () => {
  for (const relativePath of [
    "tmp/daily-seo-run-clean-inox.js",
    "tmp/daily-seo-run-induction-inox.js",
  ]) {
    const source = readRepositoryFile(relativePath);
    assert.doesNotMatch(source, /\benv\.API_KEY\b/);
    assert.match(source, /\benv\.OPENCLAW_INTERNAL_API_KEY\b/);
  }
});

test("proof schema rejects undeclared value-bearing fields", () => {
  const schema = JSON.parse(
    readRepositoryFile("deploy/security/secret-rotation-proof.schema.json"),
  );
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.status.const, "revoked_and_rotated");
  assert.equal(
    schema.properties.reviewedCommit.pattern,
    "^(?!0{40})[A-Fa-f0-9]{40}$",
  );
});
