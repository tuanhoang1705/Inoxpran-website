import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const workflowDirectory = path.resolve(scriptDirectory, "..", "workflows");

const workflowFiles = fs
  .readdirSync(workflowDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.(?:ya?ml)$/i.test(entry.name))
  .map((entry) => path.join(workflowDirectory, entry.name))
  .sort();

const violations = [];
const forbiddenWorkflowPatterns = [
  ["pull_request_target is not permitted", /\bpull_request_target\s*:/i],
  [
    "container registry login is not permitted",
    /\b(?:docker|podman)\s+login\b/i,
  ],
  ["container push is not permitted", /\b(?:docker|podman)\s+push\b/i],
  ["package publishing is not permitted", /\b(?:npm|pnpm|yarn)\s+publish\b/i],
  [
    "GitHub release mutation is not permitted",
    /\bgh\s+release\s+(?:create|delete|edit|upload)\b/i,
  ],
  [
    "Kubernetes mutation is not permitted",
    /\bkubectl\s+(?:apply|create|delete|patch|replace|rollout|set)\b/i,
  ],
  [
    "Helm release mutation is not permitted",
    /\bhelm\s+(?:install|rollback|uninstall|upgrade)\b/i,
  ],
  [
    "deployment or publishing action is not permitted",
    /^\s*(?:-\s*)?uses:\s*\S*(?:deploy|publish|release|ssh-action)\S*@/im,
  ],
];

for (const workflowFile of workflowFiles) {
  const workflowName = path.relative(
    path.resolve(scriptDirectory, "..", ".."),
    workflowFile,
  );
  const source = fs.readFileSync(workflowFile, "utf8");
  const lines = source.split(/\r?\n/);

  if (path.basename(workflowFile) === "ci.yml") {
    const globalEnv =
      source.match(/^env:\s*\r?\n((?:^[ \t]+[^\r\n]*(?:\r?\n|$))*)/m)?.[1] ??
      "";
    for (const flag of [
      "SEO_AGENT_AUTO_PUBLISH",
      "INOXPRAN_SEO_AGENT_AUTO_PUBLISH",
      "AGENTIC_BLOG_QA_ALLOW_PUBLIC_PUBLISH",
      "OPENCLAW_BLOG_AUTO_PUBLISH",
      "CONTENT_LEARNING_AUTO_APPLY",
      "OPENCLAW_UPDATE_ENABLED",
    ]) {
      const hardFalse = new RegExp(
        String.raw`^\s{2}${flag}:\s*["']?false["']?\s*$`,
        "m",
      );
      if (!hardFalse.test(globalEnv)) {
        violations.push(
          `${workflowName}: global ${flag} must be hard-disabled`,
        );
      }
    }
    if (!/^\s{2}OPENCLAW_NO_AUTO_UPDATE:\s*["']?1["']?\s*$/m.test(globalEnv)) {
      violations.push(
        `${workflowName}: global OPENCLAW_NO_AUTO_UPDATE must equal 1`,
      );
    }
    if (
      !/^\s*run:\s*node --test deploy\/scripts\/validate-release-evidence\.test\.mjs\s*$/m.test(
        source,
      )
    ) {
      violations.push(
        `${workflowName}: read-only release-evidence contract tests are required`,
      );
    }

    for (const scope of ["current", "history"]) {
      const metadataOnlyGate = new RegExp(
        String.raw`secret-scan-metadata\.mjs[\s\S]{0,240}--scope\s+${scope}\b[\s\S]{0,120}--fail-on-findings\b`,
        "i",
      );
      if (!metadataOnlyGate.test(source)) {
        violations.push(
          `${workflowName}: metadata-only ${scope} secret scan must fail on findings`,
        );
      }
    }
    if (
      /["']?\$RUNNER_TEMP\/gitleaks["']?\s+(?:git|dir|detect)\b/i.test(source)
    ) {
      violations.push(
        `${workflowName}: workflows must not invoke raw Gitleaks finding output`,
      );
    }
    if (!/git\s+grep\s+--quiet\b[\s\S]{0,160}x-api-key:/i.test(source)) {
      violations.push(
        `${workflowName}: literal API-key fallback check must suppress matched lines`,
      );
    }

    const localComposeValidationIndex = source.search(
      /docker\s+compose\s+-f\s+docker-compose\.local\.yml\b/i,
    );
    const localEnvSeedIndex = source.search(
      /\bcp\s+\.env\.example\s+\.env\s*$/im,
    );
    if (
      localComposeValidationIndex !== -1 &&
      (localEnvSeedIndex === -1 ||
        localEnvSeedIndex > localComposeValidationIndex)
    ) {
      violations.push(
        `${workflowName}: clean-checkout local Compose validation must seed the ignored .env from .env.example before docker compose config`,
      );
    }
  }

  for (const [message, pattern] of forbiddenWorkflowPatterns) {
    if (pattern.test(source)) {
      violations.push(`${workflowName}: ${message}`);
    }
  }

  lines.forEach((line, index) => {
    if (/^\s*[A-Za-z0-9_-]+:\s*write\s*(?:#.*)?$/i.test(line)) {
      violations.push(
        `${workflowName}:${index + 1}: write permission is not permitted`,
      );
    }

    const usesMatch = line.match(/^\s*(?:-\s*)?uses:\s*([^\s#]+)/i);
    if (!usesMatch) return;

    const actionReference = usesMatch[1];
    if (actionReference.startsWith("./")) return;

    if (actionReference.startsWith("docker://")) {
      const digest = actionReference.match(/@sha256:([a-f0-9]{64})$/i)?.[1];
      if (!digest || /^0{64}$/i.test(digest)) {
        violations.push(
          `${workflowName}:${index + 1}: docker action must use a non-placeholder sha256 digest`,
        );
      }
      return;
    }

    if (!/@[a-f0-9]{40}$/i.test(actionReference)) {
      violations.push(
        `${workflowName}:${index + 1}: action must be pinned to a full 40-character commit SHA`,
      );
    }

    if (actionReference.startsWith("actions/checkout@")) {
      const followingStepLines = lines.slice(index + 1, index + 9).join("\n");
      if (!/persist-credentials:\s*false\b/i.test(followingStepLines)) {
        violations.push(
          `${workflowName}:${index + 1}: checkout must set persist-credentials: false`,
        );
      }
    }
  });
}

if (violations.length > 0) {
  process.stderr.write(
    `CI safety contract failed:\n- ${violations.join("\n- ")}\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `CI safety contract passed for ${workflowFiles.length} workflow file(s): pinned actions, read-only permissions, no publish/deploy mutation.\n`,
);
