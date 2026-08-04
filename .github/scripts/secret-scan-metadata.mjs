import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");

const supportedScopes = new Set(["current", "history", "local-ignored"]);
const localIgnoredTargets = Object.freeze([
  ".env",
  "backend/.env",
  "frontend/.env",
  ".local-secret-backups",
  ".tmp-chrome-trace",
  "deploy/openclaw-lab",
  "deploy/openclaw/data/.gateway-token",
]);

const reportTemplate = String.raw`[
{{- range $index, $finding := . }}
{{- if $index}},{{end}}
{"RuleID":{{printf "%q" $finding.RuleID}},"File":{{printf "%q" $finding.File}},"Commit":{{printf "%q" $finding.Commit}},"StartLine":{{$finding.StartLine}},"EndLine":{{$finding.EndLine}}}
{{- end }}
]`;

function normalizeFindingPath(filePath) {
  return String(filePath ?? "")
    .replaceAll("\\", "/")
    .replace(/^\.?\//, "");
}

export function classifyFindingPath(filePath, scope = "current") {
  if (scope === "local-ignored") return "localIgnoredArtifact";

  const normalized = `/${normalizeFindingPath(filePath)}`;
  if (
    /\/(?:test|tests|__tests__|fixtures?|mocks?|__mocks__)(?:\/|$)/i.test(
      normalized,
    ) ||
    /\.(?:snap|fixture)\.[^/]+$/i.test(normalized)
  ) {
    return "testFixture";
  }
  if (
    /\/(?:build|dist|coverage|output|test-results|playwright-report)(?:\/|$)/i.test(
      normalized,
    )
  ) {
    return "generatedArtifact";
  }
  if (/\/(?:\.github|deploy|scripts)(?:\/|$)/i.test(normalized)) {
    return "repositoryTooling";
  }
  return "productionSource";
}

export function summarizeFindings({
  findings,
  scope,
  gitleaksVersion,
  includeLocationMetadata = false,
  scannedInputCount = null,
}) {
  const ruleCounts = {};
  const classificationCounts = {
    productionSource: 0,
    testFixture: 0,
    repositoryTooling: 0,
    generatedArtifact: 0,
    localIgnoredArtifact: 0,
  };
  const uniqueFiles = new Set();
  const uniqueCommits = new Set();

  for (const finding of findings) {
    const ruleId =
      typeof finding.RuleID === "string" && finding.RuleID.trim()
        ? finding.RuleID.trim()
        : "unknown-rule";
    const normalizedFile = normalizeFindingPath(finding.File);
    const classification = classifyFindingPath(normalizedFile, scope);

    ruleCounts[ruleId] = (ruleCounts[ruleId] ?? 0) + 1;
    classificationCounts[classification] += 1;
    if (normalizedFile) uniqueFiles.add(normalizedFile);
    if (typeof finding.Commit === "string" && finding.Commit.trim()) {
      uniqueCommits.add(finding.Commit.trim());
    }
  }

  const sortedRuleCounts = Object.fromEntries(
    Object.entries(ruleCounts).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );

  const summary = {
    schemaVersion: 1,
    scope,
    scanner: "gitleaks",
    scannerVersion: gitleaksVersion,
    disclosureMode: "counts-and-metadata-only",
    rawFindingOutput: false,
    status: findings.length === 0 ? "pass" : "findings_detected",
    totalFindings: findings.length,
    affectedFileCount: uniqueFiles.size,
    affectedCommitCount: uniqueCommits.size,
    scannedInputCount,
    classificationCounts,
    ruleCounts: sortedRuleCounts,
  };
  if (includeLocationMetadata) {
    summary.locationMetadata = findings.map((finding) => ({
      ruleId:
        typeof finding.RuleID === "string" && finding.RuleID.trim()
          ? finding.RuleID.trim()
          : "unknown-rule",
      classification: classifyFindingPath(finding.File, scope),
      startLine: Number.isSafeInteger(finding.StartLine)
        ? finding.StartLine
        : null,
      endLine: Number.isSafeInteger(finding.EndLine) ? finding.EndLine : null,
    }));
  }
  return summary;
}

function parseArguments(argv) {
  const result = {
    failOnFindings: false,
    gitleaksPath: "",
    includeLocationMetadata: false,
    pathPrefix: "",
    scope: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--fail-on-findings") {
      result.failOnFindings = true;
      continue;
    }
    if (argument === "--location-metadata") {
      result.includeLocationMetadata = true;
      continue;
    }
    if (
      argument === "--gitleaks" ||
      argument === "--scope" ||
      argument === "--path-prefix"
    ) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} requires a value`);
      }
      index += 1;
      if (argument === "--gitleaks") result.gitleaksPath = value;
      if (argument === "--scope") result.scope = value;
      if (argument === "--path-prefix") result.pathPrefix = value;
      continue;
    }
    throw new Error(`unsupported argument: ${argument}`);
  }

  if (!result.gitleaksPath) throw new Error("--gitleaks is required");
  if (!supportedScopes.has(result.scope)) {
    throw new Error("--scope must be current, history, or local-ignored");
  }
  if (result.pathPrefix && result.scope !== "current") {
    throw new Error("--path-prefix is supported only with --scope current");
  }
  if (result.pathPrefix) {
    const normalizedPrefix = normalizeFindingPath(result.pathPrefix).replace(
      /\/+$/,
      "",
    );
    if (
      !normalizedPrefix ||
      path.isAbsolute(result.pathPrefix) ||
      normalizedPrefix === ".." ||
      normalizedPrefix.startsWith("../") ||
      normalizedPrefix.includes("/../")
    ) {
      throw new Error("--path-prefix must stay inside the repository");
    }
    result.pathPrefix = normalizedPrefix;
  }
  return result;
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
    ...options,
  });
  if (result.error || result.status !== 0) {
    const error = new Error("external command failed");
    error.code = "SECRET_SCAN_TOOL_FAILED";
    throw error;
  }
  return result;
}

function resolveScannerVersion(gitleaksPath) {
  const result = runCommand(gitleaksPath, ["version"]);
  const version = String(result.stdout ?? "").match(
    /\bv?(\d+\.\d+\.\d+)\b/,
  )?.[1];
  if (!version) {
    const error = new Error("could not resolve scanner version");
    error.code = "SECRET_SCAN_VERSION_UNAVAILABLE";
    throw error;
  }
  return version;
}

function writeMetadataTemplate(temporaryDirectory) {
  const templatePath = path.join(temporaryDirectory, "metadata-only.tmpl");
  fs.writeFileSync(templatePath, reportTemplate, {
    encoding: "utf8",
    mode: 0o600,
  });
  return templatePath;
}

function readMetadataReport(reportPath) {
  if (!fs.existsSync(reportPath)) return [];
  const parsed = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  if (!Array.isArray(parsed)) throw new Error("invalid metadata report shape");
  return parsed.map((finding) => ({
    RuleID: typeof finding?.RuleID === "string" ? finding.RuleID : "",
    File: typeof finding?.File === "string" ? finding.File : "",
    Commit: typeof finding?.Commit === "string" ? finding.Commit : "",
    StartLine: Number.isSafeInteger(finding?.StartLine)
      ? finding.StartLine
      : null,
    EndLine: Number.isSafeInteger(finding?.EndLine) ? finding.EndLine : null,
  }));
}

function runGitleaks({
  gitleaksPath,
  scanCommand,
  scanTarget,
  reportPath,
  templatePath,
}) {
  runCommand(
    gitleaksPath,
    [
      scanCommand,
      "--no-banner",
      "--redact",
      "--exit-code",
      "0",
      "--report-format",
      "template",
      "--report-template",
      templatePath,
      "--report-path",
      reportPath,
      scanTarget,
    ],
    {
      // Never pass the scanner's finding log through to CI or the terminal.
      stdio: "ignore",
    },
  );
  return readMetadataReport(reportPath);
}

function isWithinRepository(absolutePath) {
  const relativePath = path.relative(repositoryRoot, absolutePath);
  return (
    relativePath !== "" &&
    !relativePath.startsWith(`..${path.sep}`) &&
    relativePath !== ".." &&
    !path.isAbsolute(relativePath)
  );
}

function createCurrentSourceSnapshot(snapshotRoot, pathPrefix = "") {
  const listed = runCommand("git", [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
  ]);
  const repositoryPaths = String(listed.stdout ?? "")
    .split("\0")
    .filter(Boolean);
  let copiedFileCount = 0;

  for (const repositoryPath of repositoryPaths) {
    const normalizedRepositoryPath = normalizeFindingPath(repositoryPath);
    if (
      pathPrefix &&
      normalizedRepositoryPath !== pathPrefix &&
      !normalizedRepositoryPath.startsWith(`${pathPrefix}/`)
    ) {
      continue;
    }
    const sourcePath = path.resolve(repositoryRoot, repositoryPath);
    if (!isWithinRepository(sourcePath) || !fs.existsSync(sourcePath)) continue;

    const sourceStat = fs.lstatSync(sourcePath);
    if (sourceStat.isSymbolicLink()) {
      const error = new Error("source snapshot contains a symbolic link");
      error.code = "SECRET_SCAN_SYMLINK_REJECTED";
      throw error;
    }
    if (!sourceStat.isFile()) continue;

    const destinationPath = path.resolve(snapshotRoot, repositoryPath);
    const relativeDestination = path.relative(snapshotRoot, destinationPath);
    if (
      relativeDestination.startsWith(`..${path.sep}`) ||
      relativeDestination === ".." ||
      path.isAbsolute(relativeDestination)
    ) {
      const error = new Error("source snapshot path escaped its root");
      error.code = "SECRET_SCAN_PATH_REJECTED";
      throw error;
    }

    fs.mkdirSync(path.dirname(destinationPath), {
      recursive: true,
      mode: 0o700,
    });
    fs.copyFileSync(sourcePath, destinationPath);
    copiedFileCount += 1;
  }
  return copiedFileCount;
}

function scanCurrentSource({
  gitleaksPath,
  pathPrefix,
  temporaryDirectory,
  templatePath,
}) {
  const snapshotRoot = path.join(temporaryDirectory, "current-source");
  fs.mkdirSync(snapshotRoot, { recursive: true, mode: 0o700 });
  const copiedFileCount = createCurrentSourceSnapshot(snapshotRoot, pathPrefix);
  const reportPath = path.join(temporaryDirectory, "current-report.json");
  const findings = runGitleaks({
    gitleaksPath,
    scanCommand: "dir",
    scanTarget: snapshotRoot,
    reportPath,
    templatePath,
  });
  return { findings, scannedInputCount: copiedFileCount };
}

function scanHistory({ gitleaksPath, temporaryDirectory, templatePath }) {
  const reportPath = path.join(temporaryDirectory, "history-report.json");
  return {
    findings: runGitleaks({
      gitleaksPath,
      scanCommand: "git",
      scanTarget: repositoryRoot,
      reportPath,
      templatePath,
    }),
    scannedInputCount: null,
  };
}

function scanLocalIgnored({ gitleaksPath, temporaryDirectory, templatePath }) {
  const findings = [];
  let scannedInputCount = 0;

  for (const [index, repositoryPath] of localIgnoredTargets.entries()) {
    const targetPath = path.resolve(repositoryRoot, repositoryPath);
    if (!isWithinRepository(targetPath) || !fs.existsSync(targetPath)) continue;

    const targetStat = fs.lstatSync(targetPath);
    if (targetStat.isSymbolicLink()) {
      const error = new Error("local ignored target is a symbolic link");
      error.code = "SECRET_SCAN_SYMLINK_REJECTED";
      throw error;
    }

    scannedInputCount += 1;
    const reportPath = path.join(
      temporaryDirectory,
      `local-report-${index}.json`,
    );
    findings.push(
      ...runGitleaks({
        gitleaksPath,
        scanCommand: "dir",
        scanTarget: targetPath,
        reportPath,
        templatePath,
      }),
    );
  }

  return { findings, scannedInputCount };
}

function runCli() {
  let temporaryDirectory;
  try {
    const options = parseArguments(process.argv.slice(2));
    const gitleaksPath = path.resolve(process.cwd(), options.gitleaksPath);
    if (!fs.existsSync(gitleaksPath) || !fs.statSync(gitleaksPath).isFile()) {
      throw Object.assign(new Error("scanner binary unavailable"), {
        code: "SECRET_SCAN_BINARY_UNAVAILABLE",
      });
    }

    const gitleaksVersion = resolveScannerVersion(gitleaksPath);
    temporaryDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "inoxpran-secret-scan-"),
    );
    fs.chmodSync(temporaryDirectory, 0o700);
    const templatePath = writeMetadataTemplate(temporaryDirectory);

    const scanResult =
      options.scope === "current"
        ? scanCurrentSource({
            gitleaksPath,
            pathPrefix: options.pathPrefix,
            temporaryDirectory,
            templatePath,
          })
        : options.scope === "history"
          ? scanHistory({
              gitleaksPath,
              temporaryDirectory,
              templatePath,
            })
          : scanLocalIgnored({
              gitleaksPath,
              temporaryDirectory,
              templatePath,
            });

    const summary = summarizeFindings({
      ...scanResult,
      scope: options.scope,
      gitleaksVersion,
      includeLocationMetadata: options.includeLocationMetadata,
    });
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    if (options.failOnFindings && summary.totalFindings > 0) {
      process.exitCode = 1;
    }
  } catch (error) {
    const safeCode =
      typeof error?.code === "string" &&
      /^SECRET_SCAN_[A-Z_]+$/.test(error.code)
        ? error.code
        : "SECRET_SCAN_FAILED";
    process.stderr.write(
      `${JSON.stringify({
        schemaVersion: 1,
        scanner: "gitleaks",
        disclosureMode: "counts-and-metadata-only",
        rawFindingOutput: false,
        status: "error",
        errorCode: safeCode,
      })}\n`,
    );
    process.exitCode = 2;
  } finally {
    if (temporaryDirectory) {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  runCli();
}
