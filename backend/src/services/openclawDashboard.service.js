"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createHash, randomUUID, timingSafeEqual } = require("node:crypto");
const {
  BadRequestError,
  ConflictRequestError,
  NotFoundError,
} = require("../core/error.response");
const {
  OpenClawDashboardRun,
} = require("../models/openclawDashboardRun.model");
const { TelegramApprovalService } = require("./telegramApproval.service");
const {
  BlogAutomationScheduleService,
} = require("./blogAutomationSchedule.service");
const {
  OpenClawCapabilityHealthService,
  buildCapabilityMatrix,
  capabilityStatus,
  probeOpenClawGateway,
  stripSensitiveUrlParts,
} = require("./openclawCapabilityHealth.service");

const REPO_ROOT = path.resolve(
  process.env.OPENCLAW_REPO_ROOT || path.resolve(__dirname, "../../.."),
);
const OPENCLAW_ROOT = path.resolve(
  process.env.OPENCLAW_ASSET_ROOT || path.join(REPO_ROOT, "deploy", "openclaw"),
);
const REPORT_FILE = path.join(OPENCLAW_ROOT, "SKILL_INSTALL_REPORT.md");
const SCRIPT_ROOT = path.join(REPO_ROOT, "scripts", "openclaw");
const DEFAULT_PROFILE = process.env.OPENCLAW_PROFILE || "inoxpran";
const MAX_RUNS = 30;
const MAX_LOG_CHARS = 18000;
const MAX_RAW_LOG_BYTES = 256 * 1024;
const ACTIVE_PROCESS_OUTPUT_PLACEHOLDER =
  "Process output is withheld until the action completes and secret redaction is finalized.";
const TRUNCATED_PROCESS_OUTPUT_PLACEHOLDER =
  "Process output was withheld because it exceeded the safe in-memory redaction limit.";
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const PRINCIPAL_ID_PATTERN = /^[A-Za-z0-9._:@-]{1,128}$/;
const DOCKER_UNAVAILABLE_ACTIONS = new Set([
  "stop-openclaw",
  "install-skills",
  "sync-agents",
  "smoke-test",
]);
const DOCKER_UPDATE_ACTIVE_STATES = new Set(["queued", "running"]);
const DOCKER_UPDATE_TERMINAL_STATES = new Set([
  "completed",
  "failed",
  "rolled_back",
]);
const DAILY_DRAFT_ACTIVE_STATES = new Set(["queued", "running"]);
const DAILY_DRAFT_SUCCESS_STATES = new Set([
  "draft_created",
  "maintenance_created",
  "completed",
  "published",
  "skipped",
]);
const SINGLE_FLIGHT_ACTIONS = new Set([
  "start-openclaw",
  "stop-openclaw",
  "install-skills",
  "sync-agents",
  "smoke-test",
  "daily-draft",
  "update-openclaw",
]);
const RUN_LEASE_GRACE_MS = 15 * 1000;
const DOCKER_UPDATE_QUEUE_LOCK_STALE_MS = 30 * 1000;
const SENSITIVE_ASSIGNMENT_NAME = [
  "[A-Za-z0-9_-]*(?:token|secret|password|credentials?|api[_-]?key|private[_-]?key|access[_-]?key)[A-Za-z0-9_-]*",
  "TOKEN",
  "SECRET",
  "PASSWORD",
  "CREDENTIALS?",
  "API_KEY",
  "PRIVATE_KEY",
  "ACCESS_KEY",
  "MONGODB_URI",
].join("|");
const SENSITIVE_ASSIGNMENT_KEY_PATTERN =
  /token|secret|password|credentials?|api[_-]?key|private[_-]?key|access[_-]?key|mongodb[_-]?uri/i;
const SENSITIVE_ENV_NAME_PATTERN =
  /(?:^|_)(?:TOKEN|SECRET|PASSWORD|CREDENTIALS?|API_KEY|PRIVATE_KEY|ACCESS_KEY)(?:_|$)|^MONGODB_URI$/i;

const isDockerManaged = () =>
  String(process.env.OPENCLAW_DEPLOYMENT_MODE || "")
    .trim()
    .toLowerCase() === "docker";
const isDockerUpdateEnabled = () =>
  isDockerManaged() &&
  ["1", "true", "yes", "on"].includes(
    String(process.env.OPENCLAW_UPDATE_ENABLED || "")
      .trim()
      .toLowerCase(),
  );
const getGatewayHttpUrl = () =>
  stripSensitiveUrlParts(
    String(
      process.env.OPENCLAW_GATEWAY_HTTP_URL ||
        (isDockerManaged()
          ? "http://app_openclaw:18789"
          : "http://127.0.0.1:18789"),
    ),
  ).replace(/\/+$/, "");

const sanitizeDashboardUrl = (value) => {
  const sanitized = stripSensitiveUrlParts(value);
  const gatewayToken = String(process.env.OPENCLAW_GATEWAY_TOKEN || "").trim();
  if (!sanitized || !gatewayToken) return sanitized;

  const containsGatewayToken = (candidate) => {
    let decoded = String(candidate || "");
    for (let depth = 0; depth <= 3; depth += 1) {
      if (decoded.includes(gatewayToken)) return true;
      if (depth === 3) break;
      try {
        const next = decodeURIComponent(decoded);
        if (next === decoded) break;
        decoded = next;
      } catch {
        break;
      }
    }
    return false;
  };

  try {
    const parsed = new URL(sanitized);
    if (containsGatewayToken(parsed.pathname)) {
      return `${parsed.origin}/`;
    }
    for (const [key, entry] of Array.from(parsed.searchParams.entries())) {
      if (
        containsGatewayToken(key) ||
        containsGatewayToken(entry)
      ) {
        parsed.searchParams.delete(key);
      }
    }
    return parsed.toString();
  } catch {
    return "";
  }
};

const getConfiguredDashboardUrl = () => {
  const rawUrl = String(
    process.env.OPENCLAW_DASHBOARD_URL ||
      (isDockerManaged() ? "" : "http://127.0.0.1:18789/"),
  ).trim();
  if (!rawUrl) return "";

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return "";
  }
  if (!["http:", "https:"].includes(parsed.protocol)) return "";
  if (isDockerManaged() && parsed.protocol !== "https:") return "";

  return sanitizeDashboardUrl(parsed.toString());
};

const runStore = new Map();
const runTasks = new Map();
let lastDashboardUrl = getConfiguredDashboardUrl();

const ACTIONS = {
  "start-openclaw": {
    label: "Start OpenClaw gateway",
    timeoutMs: 90 * 1000,
  },
  "stop-openclaw": {
    label: "Stop OpenClaw gateway",
    timeoutMs: 90 * 1000,
  },
  status: {
    label: "Refresh OpenClaw status",
    timeoutMs: 60 * 1000,
  },
  "install-skills": {
    label: "Install verified ClawHub skills",
    timeoutMs: 15 * 60 * 1000,
  },
  "sync-agents": {
    label: "Sync OpenClaw agents",
    timeoutMs: 10 * 60 * 1000,
  },
  "smoke-test": {
    label: "Create smoke-test draft",
    timeoutMs: 90 * 1000,
  },
  "daily-draft": {
    label: "Run daily draft workflow",
    timeoutMs: 35 * 60 * 1000,
  },
  "update-openclaw": {
    label: "Update OpenClaw Docker image",
    timeoutMs: 20 * 60 * 1000,
  },
};

const readFileIfExists = (filePath) => {
  try {
    if (!fs.existsSync(filePath)) return "";
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
};

const listMarkdownNames = (directory) => {
  try {
    if (!fs.existsSync(directory)) return [];
    return fs
      .readdirSync(directory)
      .filter((name) => name.endsWith(".md"))
      .map((name) => name.replace(/\.md$/i, ""))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
};

const listDirectoryNames = (directory) => {
  try {
    if (!fs.existsSync(directory)) return [];
    return fs
      .readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
};

const parseBoolean = (value) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
};

const hasConfiguredValue = (value) => Boolean(String(value || "").trim());

const readJsonIfExists = (filePath) => {
  const content = readFileIfExists(filePath);
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
};

const writeJsonAtomic = (filePath, payload) => {
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, {
    mode: 0o660,
  });
  fs.renameSync(tempPath, filePath);
};

const acquireDockerUpdateQueueLock = ({ updateDir, runId, now }) => {
  const lockFile = path.join(updateDir, ".queue.lock");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const lockId = randomUUID();
      const descriptor = fs.openSync(lockFile, "wx", 0o600);
      fs.writeFileSync(
        descriptor,
        `${JSON.stringify({
          schemaVersion: 1,
          lockId,
          runId,
          acquiredAt: now.toISOString(),
        })}\n`,
      );
      return { descriptor, lockFile, lockId };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;

      let stale = false;
      try {
        const lockStat = fs.statSync(lockFile);
        stale =
          now.getTime() - lockStat.mtimeMs >= DOCKER_UPDATE_QUEUE_LOCK_STALE_MS;
      } catch (statError) {
        if (statError?.code === "ENOENT") continue;
        throw statError;
      }
      if (!stale) {
        throw new BadRequestError(
          "An OpenClaw Docker update request is already being evaluated",
        );
      }

      const staleFile = `${lockFile}.stale.${process.pid}.${randomUUID()}`;
      try {
        fs.renameSync(lockFile, staleFile);
        fs.rmSync(staleFile, { force: true });
      } catch (recoveryError) {
        if (
          recoveryError?.code === "ENOENT" ||
          recoveryError?.code === "EEXIST"
        )
          continue;
        throw recoveryError;
      }
    }
  }
  throw new BadRequestError(
    "Unable to acquire the OpenClaw Docker update request lock",
  );
};

const releaseDockerUpdateQueueLock = ({ descriptor, lockFile, lockId }) => {
  try {
    fs.closeSync(descriptor);
  } finally {
    try {
      const currentOwner = readJsonIfExists(lockFile);
      if (currentOwner?.lockId === lockId) {
        fs.rmSync(lockFile, { force: true });
      }
    } catch {
      // A stale-lock recovery may already have transferred ownership.
    }
  }
};

const getDockerUpdateRuntimeDir = (runtimeDir) =>
  path.resolve(
    runtimeDir ||
      process.env.OPENCLAW_UPDATE_RUNTIME_DIR ||
      path.join(REPO_ROOT, "deploy", "openclaw", "update-runtime"),
  );

const queueDockerUpdateRequest = ({ runId, runtimeDir, now = new Date() }) => {
  const updateDir = getDockerUpdateRuntimeDir(runtimeDir);
  fs.mkdirSync(updateDir, { recursive: true, mode: 0o770 });
  const queueLock = acquireDockerUpdateQueueLock({ updateDir, runId, now });
  try {
    const requestFile = path.join(updateDir, "request.json");
    const processingFile = path.join(updateDir, "processing.json");
    const statusFile = path.join(updateDir, "status.json");
    const existingStatus = readJsonIfExists(statusFile);
    const existingUpdatedAt = new Date(
      existingStatus?.updatedAt || 0,
    ).getTime();
    const activeStatusIsFresh =
      DOCKER_UPDATE_ACTIVE_STATES.has(existingStatus?.state) &&
      Number.isFinite(existingUpdatedAt) &&
      now.getTime() - existingUpdatedAt < ACTIONS["update-openclaw"].timeoutMs;

    if (
      activeStatusIsFresh ||
      fs.existsSync(requestFile) ||
      fs.existsSync(processingFile)
    ) {
      throw new BadRequestError(
        "An OpenClaw Docker update is already queued or running",
      );
    }

    const request = {
      schemaVersion: 1,
      action: "update-openclaw",
      requestId: runId,
      requestedAt: now.toISOString(),
    };
    const queuedStatus = {
      schemaVersion: 1,
      requestId: runId,
      state: "queued",
      phase: "queued",
      message:
        "Update request accepted. Waiting for the isolated Docker updater.",
      fromVersion: "",
      toVersion: "",
      backupDir: "",
      error: "",
      startedAt: now.toISOString(),
      updatedAt: now.toISOString(),
      finishedAt: "",
    };

    writeJsonAtomic(statusFile, queuedStatus);
    writeJsonAtomic(requestFile, request);
    return { request, status: queuedStatus, requestFile, statusFile };
  } finally {
    releaseDockerUpdateQueueLock(queueLock);
  }
};

const formatDockerUpdateStatus = (status) => {
  const lines = [];
  if (status?.message) lines.push(status.message);
  if (status?.fromVersion) lines.push(`From: ${status.fromVersion}`);
  if (status?.toVersion) lines.push(`To: ${status.toVersion}`);
  if (status?.backupDir) lines.push(`Backup: ${status.backupDir}`);
  if (status?.error) lines.push(`Error: ${status.error}`);
  return redactForDashboard(lines.join("\n"));
};

const replaceExactOutsideRedactionMarkers = (
  value,
  exactValue,
  replacement,
) => {
  const source = String(value || "");
  const needle = String(exactValue || "");
  if (!needle || !source.includes(needle)) return source;

  const markerRanges = Array.from(
    source.matchAll(/\[redacted(?:-[a-z-]+)?\]/gi),
    (match) => ({
      start: match.index,
      end: match.index + match[0].length,
    }),
  );
  const parts = [];
  let cursor = 0;
  let matchIndex = source.indexOf(needle, cursor);
  while (matchIndex !== -1) {
    const matchEnd = matchIndex + needle.length;
    const isInsideExistingMarker = markerRanges.some(
      (range) => matchIndex >= range.start && matchEnd <= range.end,
    );
    parts.push(source.slice(cursor, matchIndex));
    parts.push(isInsideExistingMarker ? needle : replacement);
    cursor = matchEnd;
    matchIndex = source.indexOf(needle, cursor);
  }
  parts.push(source.slice(cursor));
  return parts.join("");
};

const sanitizeParsedJsonCredentials = (value, depth = 0) => {
  if (depth > 12 || value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((entry) =>
      sanitizeParsedJsonCredentials(entry, depth + 1),
    );
  }
  if (typeof value === "object") {
    for (const key of Object.keys(value)) {
      value[key] = SENSITIVE_ASSIGNMENT_KEY_PATTERN.test(key)
        ? "[redacted]"
        : sanitizeParsedJsonCredentials(value[key], depth + 1);
    }
    return value;
  }
  if (typeof value !== "string" || depth >= 4) return value;

  const trimmed = value.trim();
  if (!trimmed || !["{", "[", '"'].includes(trimmed[0])) return value;
  try {
    const parsed = JSON.parse(trimmed);
    return JSON.stringify(sanitizeParsedJsonCredentials(parsed, depth + 1));
  } catch {
    return value;
  }
};

const redactJsonCredentialObjects = (value) => {
  const source = String(value || "");
  if (!source || source.length > MAX_RAW_LOG_BYTES) return source;
  try {
    return JSON.stringify(
      sanitizeParsedJsonCredentials(JSON.parse(source), 0),
    );
  } catch {
    return source;
  }
};

const redactRawDashboardText = (value) => {
  let output = String(value || "");
  const sentinelValues = new Map();
  const sentinelNonce = randomUUID().replace(/-/g, "");
  let sentinelIndex = 0;
  const protectValue = (safeValue) => {
    let sentinel;
    do {
      sentinel = `\uE000${sentinelNonce}:${sentinelIndex}\uE001`;
      sentinelIndex += 1;
    } while (output.includes(sentinel) || sentinelValues.has(sentinel));
    sentinelValues.set(sentinel, safeValue);
    return sentinel;
  };

  const exactSecrets = new Map();
  const addExactSecret = (configuredValue, marker, priority = 0) => {
    const rawValue = String(configuredValue ?? "");
    const candidates = new Set([rawValue, rawValue.trim()]);
    for (const candidate of candidates) {
      if (candidate.length < 4 || candidate.trim().length < 4) continue;
      const exactValues = new Set([candidate, encodeURIComponent(candidate)]);
      for (const exactValue of exactValues) {
        if (!exactValue) continue;
        const existing = exactSecrets.get(exactValue);
        if (!existing || priority > existing.priority) {
          exactSecrets.set(exactValue, { marker, priority });
        }
      }
    }
  };

  for (const [name, configuredValue] of Object.entries(process.env)) {
    if (!SENSITIVE_ENV_NAME_PATTERN.test(name)) continue;
    addExactSecret(configuredValue, "[redacted-env-secret]", 1);
  }
  addExactSecret(
    process.env.OPENCLAW_GATEWAY_TOKEN,
    "[redacted-gateway-token]",
    2,
  );

  const sortedExactSecrets = Array.from(exactSecrets.entries())
    .map(([exactValue, metadata]) => ({ exactValue, ...metadata }))
    .sort(
      (left, right) =>
        right.exactValue.length - left.exactValue.length ||
        right.priority - left.priority,
    );
  for (const { exactValue, marker } of sortedExactSecrets) {
    const sentinel = protectValue(marker);
    output = replaceExactOutsideRedactionMarkers(output, exactValue, sentinel);
  }

  output = redactJsonCredentialObjects(output);
  output = output.replace(/\[redacted(?:-[a-z-]+)?\]/gi, (marker) =>
    protectValue(marker),
  );
  output = output.replace(/https?:\/\/[^\s"'<>]+/gi, (url) =>
    stripSensitiveUrlParts(url),
  );
  output = output.replace(/\bsk-[A-Za-z0-9_-]+/gi, "[redacted-openai-key]");
  output = output.replace(
    /mongodb(\+srv)?:\/\/[^\s"']+/gi,
    "[redacted-mongodb-uri]",
  );
  output = output.replace(
    /-----BEGIN ([A-Z0-9 ]*PRIVATE KEY)-----[\s\S]*?(?:-----END \1-----|$)/gi,
    "[redacted-private-key]",
  );
  output = output.replace(
    /\b(authorization\s*[:=]\s*)(?:Bearer|Basic)\s+[^\s,;"']+/gi,
    "$1[redacted]",
  );
  output = output.replace(
    /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/-]+={0,2}/gi,
    "[redacted-auth]",
  );
  output = output.replace(
    /([?#&](?:token|auth|access_token)=)[^&#\s"']+/gi,
    "$1[redacted]",
  );
  output = output.replace(
    new RegExp(
      `(["']?\\b(?:${SENSITIVE_ASSIGNMENT_NAME})["']?\\s*[:=]\\s*)("(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*')`,
      "gis",
    ),
    (_match, prefix, quotedValue) =>
      `${prefix}${quotedValue[0]}[redacted]${quotedValue[0]}`,
  );
  output = output.replace(
    new RegExp(
      `(["']?\\b(?:${SENSITIVE_ASSIGNMENT_NAME})["']?\\s*[:=]\\s*)([^,;&}"']+)`,
      "gi",
    ),
    "$1[redacted]",
  );
  output = output.replace(
    /\b(x-api-key|x-seo-agent-key|x-openclaw-signature|authorization)(\s*:\s*)([^\s,;"']+)/gi,
    "$1$2[redacted]",
  );
  for (const [sentinel, safeValue] of sentinelValues) {
    output = output.split(sentinel).join(safeValue);
  }
  return output;
};

const tolerantPercentDecode = (value) =>
  String(value || "").replace(/(?:%[0-9a-f]{2})+/gi, (encoded) => {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  });

const redactForDashboard = (value) => {
  let output = String(value || "");
  for (let pass = 0; pass < 3; pass += 1) {
    output = redactRawDashboardText(output);
    const decoded = tolerantPercentDecode(output);
    if (decoded === output) break;
    output = decoded;
  }
  output = redactRawDashboardText(output);
  return output.length > MAX_LOG_CHARS
    ? `${output.slice(-MAX_LOG_CHARS)}\n[log truncated]`
    : output;
};

const appendDashboardRunOutput = (run, chunk) => {
  if (run.rawOutputFinalized || run.rawOutputTruncated) return;

  if (!Array.isArray(run.rawOutputBuffers)) {
    run.rawOutputBuffers = [];
  }
  if (!Number.isSafeInteger(run.rawOutputBytes) || run.rawOutputBytes < 0) {
    run.rawOutputBytes = run.rawOutputBuffers.reduce(
      (total, buffer) =>
        total +
        (Buffer.isBuffer(buffer)
          ? buffer.length
          : Buffer.byteLength(String(buffer || ""))),
      0,
    );
  }
  if (run.rawOutput) {
    const legacyBuffer = Buffer.from(String(run.rawOutput), "utf8");
    run.rawOutputBuffers.push(legacyBuffer);
    run.rawOutputBytes += legacyBuffer.length;
    run.rawOutput = "";
  }

  const chunkBuffer = Buffer.isBuffer(chunk)
    ? Buffer.from(chunk)
    : Buffer.from(String(chunk ?? ""), "utf8");
  if (run.rawOutputBytes + chunkBuffer.length > MAX_RAW_LOG_BYTES) {
    run.rawOutput = "";
    run.rawOutputBuffers = [];
    run.rawOutputBytes = 0;
    run.rawOutputTruncated = true;
    run.output = TRUNCATED_PROCESS_OUTPUT_PLACEHOLDER;
    return;
  }
  run.rawOutputBuffers.push(chunkBuffer);
  run.rawOutputBytes += chunkBuffer.length;
  run.output = ACTIVE_PROCESS_OUTPUT_PLACEHOLDER;
};

const decodeDashboardRunOutput = (run) => {
  if (run.rawOutputTruncated) return { output: "", truncated: true };

  const buffers = [];
  let totalBytes = 0;
  const appendBuffer = (value) => {
    const buffer = Buffer.isBuffer(value)
      ? value
      : Buffer.from(String(value || ""), "utf8");
    totalBytes += buffer.length;
    if (totalBytes > MAX_RAW_LOG_BYTES) return false;
    buffers.push(buffer);
    return true;
  };

  if (run.rawOutput && !appendBuffer(run.rawOutput)) {
    return { output: "", truncated: true };
  }
  for (const buffer of Array.isArray(run.rawOutputBuffers)
    ? run.rawOutputBuffers
    : []) {
    if (!appendBuffer(buffer)) return { output: "", truncated: true };
  }

  return {
    output: Buffer.concat(buffers, totalBytes).toString("utf8"),
    truncated: false,
  };
};

const finalizeDashboardRunOutput = (
  run,
  decodedSnapshot = decodeDashboardRunOutput(run),
) => {
  if (run.rawOutputFinalized) return String(run.output || "");
  const outputWasTruncated =
    run.rawOutputTruncated || decodedSnapshot.truncated;
  const safeOutput = outputWasTruncated
    ? TRUNCATED_PROCESS_OUTPUT_PLACEHOLDER
    : redactForDashboard(decodedSnapshot.output);
  run.rawOutput = "";
  run.rawOutputBuffers = [];
  run.rawOutputBytes = 0;
  run.rawOutputTruncated = outputWasTruncated;
  run.rawOutputFinalized = true;
  run.output = safeOutput;
  return safeOutput;
};

const extractDashboardUrl = (value) => {
  const output = String(value || "");
  const explicitMatch = output.match(
    /OPENCLAW_DASHBOARD_URL=(https?:\/\/127\.0\.0\.1:\d+\/[^\s"'<>]*)/i,
  );
  if (explicitMatch) return sanitizeDashboardUrl(explicitMatch[1]);

  const urls = Array.from(
    output.matchAll(/https?:\/\/127\.0\.0\.1:\d+\/[^\s"'<>]*/gi),
  ).map((match) => match[0]);
  const selected =
    urls.find((url) => /[?#&](token|auth|access_token)=/i.test(url)) ||
    urls[0] ||
    "";
  return sanitizeDashboardUrl(selected);
};

const normalizeProfile = (profile) => {
  const activeProfile =
    String(profile || DEFAULT_PROFILE || "").trim() || "inoxpran";
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(activeProfile)) {
    throw new BadRequestError("Invalid OpenClaw profile");
  }
  return activeProfile;
};

const validateActionPrincipal = (value) => {
  const principalId = String(value || "").trim();
  if (!PRINCIPAL_ID_PATTERN.test(principalId)) {
    throw new BadRequestError(
      "Authenticated OpenClaw action principal is required",
    );
  }
  return principalId;
};

const validateActionIdempotencyKey = (value) => {
  const idempotencyKey = String(value || "").trim();
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    throw new BadRequestError(
      "Idempotency-Key must be 8-128 safe ASCII characters",
    );
  }
  return idempotencyKey;
};

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const buildActionIdempotencyIdentity = ({
  principalId,
  action,
  profile,
  idempotencyKey,
}) => {
  const normalizedPrincipalId = validateActionPrincipal(principalId);
  const normalizedKey = validateActionIdempotencyKey(idempotencyKey);
  const normalizedAction = String(action || "").trim();
  const normalizedProfile = normalizeProfile(profile);
  return {
    principalId: normalizedPrincipalId,
    idempotencyKeyHash: sha256(`openclaw-action-key-v1\0${normalizedKey}`),
    bindingHash: sha256(
      `openclaw-action-binding-v1\0${normalizedPrincipalId}\0${normalizedAction}\0${normalizedProfile}`,
    ),
  };
};

const equalHash = (left, right) => {
  if (
    !/^[a-f0-9]{64}$/.test(String(left || "")) ||
    !/^[a-f0-9]{64}$/.test(String(right || ""))
  ) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
};

const powerShellOpenClawCommand = (
  openclawArgs,
  { captureDashboardClipboard = false } = {},
) => {
  const quotedArgs = openclawArgs
    .map((arg) => `'${String(arg).replace(/'/g, "''")}'`)
    .join(", ");
  const clipboardScript = captureDashboardClipboard
    ? `
$exitCode = $LASTEXITCODE
try {
    $dashboardClipboard = Get-Clipboard -Raw -ErrorAction Stop
    if ($dashboardClipboard -match '^https?://127\\.0\\.0\\.1:\\d+/') {
        Write-Output "OPENCLAW_DASHBOARD_URL=$dashboardClipboard"
    }
} catch {}
exit $exitCode`
    : "";

  return {
    executable: "powershell.exe",
    args: [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `$openclawArgs = @(${quotedArgs}); & openclaw @openclawArgs${clipboardScript}`,
    ],
  };
};

const parseSkillReport = () => {
  const report = readFileIfExists(REPORT_FILE);
  const installed = [];
  const alreadyInstalled = [];
  const skipped = [];
  const notInstalled = [];

  for (const line of report.split(/\r?\n/)) {
    const installedMatch = line.match(/^INSTALLED:\s*(.+)$/);
    if (installedMatch) installed.push(installedMatch[1].trim());

    const alreadyInstalledMatch = line.match(/^ALREADY INSTALLED:\s*(.+)$/);
    if (alreadyInstalledMatch) {
      const skill = alreadyInstalledMatch[1].trim();
      alreadyInstalled.push(skill);
      installed.push(skill);
    }

    const skipMatch = line.match(/^SKIP:\s*(.+)$/);
    if (skipMatch) skipped.push(skipMatch[1].trim());

    const notInstalledMatch = line.match(/^- `([^`]+)`:\s*(.+)$/);
    if (notInstalledMatch) {
      notInstalled.push({
        skill: notInstalledMatch[1],
        reason: notInstalledMatch[2],
      });
    }
  }

  return {
    path: path.relative(REPO_ROOT, REPORT_FILE),
    exists: Boolean(report),
    installed: Array.from(new Set(installed)),
    alreadyInstalled,
    skipped,
    notInstalled,
    preview: redactForDashboard(report).slice(0, 8000),
  };
};

const getScriptPath = (baseName) => {
  if (process.platform === "win32") {
    const ps1Path = path.join(SCRIPT_ROOT, `${baseName}.ps1`);
    if (fs.existsSync(ps1Path)) return ps1Path;
  }
  return path.join(SCRIPT_ROOT, `${baseName}.sh`);
};

const buildCommand = ({ action, profile }) => {
  const activeProfile = normalizeProfile(profile);

  if (action === "update-openclaw") {
    if (!isDockerUpdateEnabled()) {
      throw new BadRequestError(
        "The isolated OpenClaw Docker updater is not enabled for this deployment",
      );
    }
    return {
      internal: "docker-update-request",
      display:
        "OpenClaw Docker updater: pull stable image, health-check, rollback on failure",
    };
  }

  if (
    action === "status" ||
    action === "start-openclaw" ||
    action === "stop-openclaw"
  ) {
    if (isDockerManaged()) {
      if (action === "stop-openclaw") {
        throw new BadRequestError(
          "OpenClaw is managed by Docker Compose; stopping it from the web console is disabled",
        );
      }
      return {
        internal: "gateway-probe",
        display: `GET ${getGatewayHttpUrl()}/healthz + /readyz + /v1/models (authenticated)`,
      };
    }
    const gatewayActionByDashboardAction = {
      "start-openclaw": ["dashboard", "--yes", "--no-open"],
      "stop-openclaw": ["gateway", "stop"],
    };
    const openclawArgs = gatewayActionByDashboardAction[action] || ["status"];
    const args = ["--profile", activeProfile, ...openclawArgs];

    if (process.platform === "win32") {
      return {
        ...powerShellOpenClawCommand(args, {
          captureDashboardClipboard: action === "start-openclaw",
        }),
        display: `openclaw --profile ${activeProfile} ${openclawArgs.join(" ")}`,
      };
    }

    return {
      executable: "openclaw",
      args,
      display: `openclaw --profile ${activeProfile} ${openclawArgs.join(" ")}`,
    };
  }

  if (action === "daily-draft" && isDockerManaged()) {
    return {
      internal: "blog-schedule-run",
      display:
        "Run saved Daily Draft schedule through the audited backend pipeline",
    };
  }

  const scriptByAction = {
    "install-skills": "install-skills",
    "sync-agents": "sync-agents",
    "smoke-test": "smoke-test-publish",
    "daily-draft": "run-daily-draft",
  };
  const script = getScriptPath(scriptByAction[action]);
  if (!fs.existsSync(script)) {
    throw new BadRequestError(`Missing script for action: ${action}`);
  }

  if (process.platform === "win32") {
    const args = ["-ExecutionPolicy", "Bypass", "-File", script];
    if (
      action === "install-skills" ||
      action === "sync-agents" ||
      action === "daily-draft"
    ) {
      args.push("-Profile", activeProfile);
    }
    return {
      executable: "powershell.exe",
      args,
      display: `powershell -ExecutionPolicy Bypass -File ${path.relative(REPO_ROOT, script)}`,
    };
  }

  return {
    executable: "bash",
    args: [script],
    display: `bash ${path.relative(REPO_ROOT, script)}`,
  };
};

const toIsoString = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const normalizeRun = (run, { idempotentReplay = false } = {}) => ({
  id: run.id || run.runId,
  action: run.action,
  label: ACTIONS[run.action]?.label || run.action,
  profile: run.profile || DEFAULT_PROFILE,
  status: run.status,
  exitCode: run.exitCode,
  startedAt: toIsoString(run.startedAt),
  finishedAt: toIsoString(run.finishedAt),
  command: redactForDashboard(run.command),
  durationMs: run.finishedAt
    ? new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()
    : null,
  dashboardUrl: sanitizeDashboardUrl(run.dashboardUrl || ""),
  scheduleId: run.scheduleId || "",
  executionId: run.executionId || "",
  blogId: run.blogId || "",
  blogSlug: redactForDashboard(run.blogSlug || ""),
  blogTitle: redactForDashboard(run.blogTitle || ""),
  output: redactForDashboard(run.output),
  error: run.error ? redactForDashboard(run.error) : "",
  idempotentReplay,
});

const runtimeRunFromPersisted = (record) => ({
  id: String(record?.runId || ""),
  action: String(record?.action || ""),
  profile: String(record?.profile || DEFAULT_PROFILE),
  status: String(record?.status || "running"),
  exitCode: record?.exitCode ?? null,
  startedAt: toIsoString(record?.startedAt),
  finishedAt: toIsoString(record?.finishedAt),
  command: String(record?.command || ""),
  rawOutput: "",
  rawOutputBuffers: [],
  rawOutputBytes: 0,
  rawOutputTruncated: false,
  rawOutputFinalized: true,
  dashboardUrl: String(record?.dashboardUrl || ""),
  scheduleId: String(record?.scheduleId || ""),
  executionId: String(record?.executionId || ""),
  blogId: String(record?.blogId || ""),
  blogSlug: String(record?.blogSlug || ""),
  blogTitle: String(record?.blogTitle || ""),
  output: String(record?.output || ""),
  error: String(record?.error || ""),
  leaseTokenHash: String(record?.leaseTokenHash || ""),
  leaseExpiresAt: toIsoString(record?.leaseExpiresAt),
  lastHeartbeatAt: toIsoString(record?.lastHeartbeatAt),
  activeFence: record?.activeFence === true,
});

const persistedRunFields = (run) => ({
  status: run.status,
  exitCode: run.exitCode ?? null,
  startedAt: new Date(run.startedAt),
  finishedAt: run.finishedAt ? new Date(run.finishedAt) : null,
  command: redactForDashboard(run.command).slice(0, 2000),
  dashboardUrl: sanitizeDashboardUrl(run.dashboardUrl || "").slice(0, 2000),
  scheduleId: String(run.scheduleId || "").slice(0, 128),
  executionId: String(run.executionId || "").slice(0, 128),
  blogId: String(run.blogId || "").slice(0, 128),
  blogSlug: redactForDashboard(run.blogSlug || "").slice(0, 300),
  blogTitle: redactForDashboard(run.blogTitle || "").slice(0, 500),
  output: redactForDashboard(run.output).slice(-MAX_LOG_CHARS),
  error: redactForDashboard(run.error).slice(-4000),
  leaseExpiresAt: new Date(run.leaseExpiresAt),
  lastHeartbeatAt: new Date(run.lastHeartbeatAt || run.startedAt),
  activeFence: run.activeFence === true,
});

const ensureDashboardRunIndexes = async () => {
  // Mongoose Model.init() is internally one-time/inflight and rejects when the
  // unique index cannot be guaranteed. Reservations therefore fail closed.
  await OpenClawDashboardRun.init();
};

const trackRunTask = (runId, task) => {
  const tracked = Promise.resolve(task);
  runTasks.set(runId, tracked);
  tracked.then(
    () => {
      if (runTasks.get(runId) === tracked) runTasks.delete(runId);
    },
    () => {
      if (runTasks.get(runId) === tracked) runTasks.delete(runId);
    },
  );
  return tracked;
};

const resolveLean = async (query) => {
  if (query && typeof query.lean === "function") return query.lean();
  return query;
};

const findPersistedRunByIdentity = ({ principalId, idempotencyKeyHash }) =>
  resolveLean(
    OpenClawDashboardRun.findOne({ principalId, idempotencyKeyHash }),
  );

const isDuplicateKeyError = (error) => Number(error?.code) === 11000;

const buildLeaseExpiry = ({ action, startedAt }) =>
  new Date(
    new Date(startedAt).getTime() +
      ACTIONS[action].timeoutMs +
      RUN_LEASE_GRACE_MS,
  );

const durableFinalizeRun = async (run, terminalFields) => {
  const terminalRun = {
    ...run,
    ...terminalFields,
    finishedAt: terminalFields.finishedAt || new Date().toISOString(),
    lastHeartbeatAt: terminalFields.finishedAt || new Date().toISOString(),
    activeFence: false,
  };
  const persistedFields = persistedRunFields(terminalRun);
  const result = await OpenClawDashboardRun.updateOne(
    {
      runId: run.id,
      status: "running",
      leaseTokenHash: run.leaseTokenHash,
    },
    { $set: persistedFields },
    { runValidators: true },
  );
  if (Number(result?.matchedCount) === 0) {
    const persisted = await resolveLean(
      OpenClawDashboardRun.findOne({ runId: run.id }),
    );
    if (persisted) Object.assign(run, runtimeRunFromPersisted(persisted));
    return false;
  }
  Object.assign(run, terminalRun);
  return true;
};

const durablePersistRunProgress = async (run) => {
  const heartbeatAt = new Date().toISOString();
  const progressRun = { ...run, lastHeartbeatAt: heartbeatAt };
  const result = await OpenClawDashboardRun.updateOne(
    {
      runId: run.id,
      status: "running",
      leaseTokenHash: run.leaseTokenHash,
    },
    { $set: persistedRunFields(progressRun) },
    { runValidators: true },
  );
  if (Number(result?.matchedCount) === 0) return false;
  run.lastHeartbeatAt = heartbeatAt;
  return true;
};

const isPersistedRunLeaseStale = (record, now = new Date()) => {
  if (String(record?.status || "") !== "running") return false;
  const explicitExpiry = new Date(record?.leaseExpiresAt || 0).getTime();
  if (Number.isFinite(explicitExpiry) && explicitExpiry > 0) {
    return explicitExpiry <= now.getTime();
  }
  const action = String(record?.action || "");
  const startedAt = new Date(record?.startedAt || 0).getTime();
  return Boolean(
    ACTIONS[action] &&
    Number.isFinite(startedAt) &&
    startedAt + ACTIONS[action].timeoutMs + RUN_LEASE_GRACE_MS <= now.getTime(),
  );
};

const recoverStalePersistedRunRecord = async ({
  existing,
  identity = null,
  now = new Date(),
}) => {
  if (!isPersistedRunLeaseStale(existing, now)) return existing;

  const action = String(existing.action || "");
  const existingRunId = String(existing.runId || existing.id || "");
  const legacyCutoff = new Date(
    now.getTime() - (ACTIONS[action]?.timeoutMs || 0) - RUN_LEASE_GRACE_MS,
  );
  const filter = {
    runId: existingRunId,
    status: "running",
    ...(existing.leaseTokenHash
      ? { leaseTokenHash: existing.leaseTokenHash }
      : {}),
    ...(identity
      ? {
          principalId: identity.principalId,
          idempotencyKeyHash: identity.idempotencyKeyHash,
          bindingHash: identity.bindingHash,
        }
      : {}),
    $or: [
      { leaseExpiresAt: { $lte: now } },
      {
        leaseExpiresAt: { $exists: false },
        startedAt: { $lte: legacyCutoff },
      },
    ],
  };
  await OpenClawDashboardRun.updateOne(
    filter,
    {
      $set: {
        status: "timed_out",
        activeFence: false,
        exitCode: 1,
        finishedAt: now,
        lastHeartbeatAt: now,
        error:
          "The previous OpenClaw action worker lease expired before durable completion. Review current system state before starting a new action.",
      },
    },
    { runValidators: true },
  );

  const refreshed = identity
    ? await findPersistedRunByIdentity(identity)
    : await resolveLean(OpenClawDashboardRun.findOne({ runId: existingRunId }));
  return refreshed || existing;
};

const recoverStalePersistedRun = async ({
  existing,
  identity,
  now = new Date(),
}) => recoverStalePersistedRunRecord({ existing, identity, now });

const reserveIdempotentRun = async ({
  action,
  profile,
  principalId,
  idempotencyKey,
  command,
}) => {
  await ensureDashboardRunIndexes();
  const identity = buildActionIdempotencyIdentity({
    principalId,
    action,
    profile,
    idempotencyKey,
  });
  const startedAt = new Date().toISOString();
  const leaseTokenHash = sha256(`openclaw-action-lease-v1\0${randomUUID()}`);
  const run = {
    id: randomUUID(),
    action,
    profile,
    status: "running",
    exitCode: null,
    startedAt,
    finishedAt: null,
    command: command.display,
    rawOutput: "",
    rawOutputBuffers: [],
    rawOutputBytes: 0,
    rawOutputTruncated: false,
    rawOutputFinalized: false,
    dashboardUrl: "",
    output: "",
    error: "",
    leaseTokenHash,
    leaseExpiresAt: buildLeaseExpiry({ action, startedAt }).toISOString(),
    lastHeartbeatAt: startedAt,
    activeFence: SINGLE_FLIGHT_ACTIONS.has(action),
  };

  if (SINGLE_FLIGHT_ACTIONS.has(action)) {
    const now = new Date();
    const legacyCutoff = new Date(
      now.getTime() - ACTIONS[action].timeoutMs - RUN_LEASE_GRACE_MS,
    );
    await OpenClawDashboardRun.updateMany(
      {
        action,
        profile,
        status: "running",
        activeFence: { $ne: true },
        $or: [
          { leaseExpiresAt: { $lte: now } },
          {
            leaseExpiresAt: { $exists: false },
            startedAt: { $lte: legacyCutoff },
          },
        ],
      },
      {
        $set: {
          status: "timed_out",
          activeFence: false,
          exitCode: 1,
          finishedAt: now,
          lastHeartbeatAt: now,
          error:
            "The previous OpenClaw action worker lease expired before durable completion. Review current system state before starting a new action.",
        },
      },
      { runValidators: true },
    );
    const legacyActive = await resolveLean(
      OpenClawDashboardRun.findOne({
        action,
        profile,
        status: "running",
        activeFence: { $ne: true },
      }),
    );
    if (legacyActive) {
      if (String(legacyActive.status || "") === "running") {
        const sameRequest =
          equalHash(legacyActive.bindingHash, identity.bindingHash) &&
          String(legacyActive.principalId || "") === identity.principalId &&
          String(legacyActive.idempotencyKeyHash || "") ===
            identity.idempotencyKeyHash;
        if (sameRequest) {
          return {
            run: runtimeRunFromPersisted(legacyActive),
            replay: true,
            principalId: identity.principalId,
          };
        }
        throw new ConflictRequestError(
          "An OpenClaw action with the same action and profile is already running",
        );
      }
    }
  }

  try {
    await OpenClawDashboardRun.create({
      runId: run.id,
      principalId: identity.principalId,
      idempotencyKeyHash: identity.idempotencyKeyHash,
      bindingHash: identity.bindingHash,
      leaseTokenHash,
      action,
      profile,
      ...persistedRunFields(run),
    });
    return { run, replay: false, principalId: identity.principalId };
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;

    let existing = await findPersistedRunByIdentity(identity);
    if (!existing && SINGLE_FLIGHT_ACTIONS.has(action)) {
      const active = await resolveLean(
        OpenClawDashboardRun.findOne({
          action,
          profile,
          activeFence: true,
        }),
      );
      if (active) {
        await recoverStalePersistedRunRecord({ existing: active });
        throw new ConflictRequestError(
          "An OpenClaw action with the same action and profile is already running",
        );
      }
    }
    if (
      !existing ||
      !equalHash(existing.bindingHash, identity.bindingHash) ||
      String(existing.action || "") !== action ||
      String(existing.profile || "") !== profile
    ) {
      throw new ConflictRequestError(
        "Idempotency-Key was already used for a different OpenClaw action request",
      );
    }

    existing = await recoverStalePersistedRun({ existing, identity });
    const inMemory = runStore.get(String(existing.runId || ""));
    if (inMemory && String(existing.status || "") !== "running") {
      Object.assign(inMemory, runtimeRunFromPersisted(existing));
    }
    return {
      run:
        inMemory && String(existing.status || "") === "running"
          ? inMemory
          : runtimeRunFromPersisted(existing),
      replay: true,
      principalId: identity.principalId,
    };
  }
};

const trimRunStore = () => {
  const runs = Array.from(runStore.values()).sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
  );
  runs.slice(MAX_RUNS).forEach((run) => runStore.delete(run.id));
};

const getRecentRuns = () =>
  Array.from(runStore.values())
    .sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    )
    .map(normalizeRun);

const buildDashboard = ({ capabilities: checkedCapabilities = null } = {}) => {
  const localAgents = listMarkdownNames(path.join(OPENCLAW_ROOT, "agents"));
  const localSkills = listDirectoryNames(path.join(OPENCLAW_ROOT, "skills"));
  const skillReport = parseSkillReport();
  const telegramStatus = TelegramApprovalService.status();
  const capabilities =
    checkedCapabilities || buildCapabilityMatrix(process.env, telegramStatus);
  const requiredEnv = [
    "OPENCLAW_INTERNAL_API_KEY",
    "SEO_AGENT_API_KEY",
    "SEO_AGENT_HMAC_SECRET",
    "OPENAI_API_KEY",
    "FIRECRAWL_API_KEY",
    "IMAGE_SEARCH_API_KEY",
    "AI_IMAGE_API_KEY",
    "NINE_ROUTER_API_KEY",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_WEBHOOK_SECRET",
    "TELEGRAM_ALLOWED_CHAT_IDS",
    "TELEGRAM_ALLOWED_USER_IDS",
    "ADMIN_BASE_URL",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "SEARCH_CONSOLE_PROPERTY",
  ];
  const featureFlags = Object.fromEntries(
    [
      "SEO_AGENT_ENABLED",
      "SEO_AGENT_AUTO_PUBLISH",
      "CONTENT_OPERATIONS_ENABLED",
      "CONTENT_OPERATIONS_CRON_ENABLED",
      "GOOGLE_INTELLIGENCE_ENABLED",
      "GOOGLE_INTELLIGENCE_STRICT_GATE",
      "SEARCH_CONSOLE_ENABLED",
      "CONTENT_ANALYTICS_ENABLED",
      "CONTENT_TRENDS_ENABLED",
      "CONTENT_INVENTORY_ENABLED",
      "CONTENT_SIGNALS_ENABLED",
      "CONTENT_PERFORMANCE_MONITORING_ENABLED",
      "CONTENT_LEARNING_ENABLED",
      "CONTENT_LEARNING_AUTO_APPLY",
      "CONTENT_PUBLISH_READINESS_ENABLED",
      "CONTENT_POST_PUBLISH_VERIFY_ENABLED",
      "OPENCLAW_BLOG_CRON_ENABLED",
      "OPENCLAW_IMAGE_PIPELINE_ENABLED",
      "OPENCLAW_REQUIRE_COVER_IMAGE_FOR_PUBLISH",
      "TELEGRAM_BOT_ENABLED",
      "OPENCLAW_UPDATE_ENABLED",
    ].map((name) => [name, parseBoolean(process.env[name])]),
  );

  return {
    profile: DEFAULT_PROFILE,
    platform: {
      os: os.platform(),
      node: process.version,
      repoRoot: REPO_ROOT,
    },
    automation: {
      enabled: parseBoolean(process.env.SEO_AGENT_ENABLED),
      autoPublish: parseBoolean(process.env.SEO_AGENT_AUTO_PUBLISH),
      minSeoScore: Number(process.env.SEO_AGENT_MIN_SEO_SCORE || 85),
      minWords: Number(process.env.SEO_AGENT_MIN_WORDS || 800),
      maxWords: Number(process.env.SEO_AGENT_MAX_WORDS || 1800),
      defaultImage: process.env.SEO_AGENT_DEFAULT_BLOG_IMAGE || "/og-image.png",
      imagePipelineEnabled: parseBoolean(
        process.env.OPENCLAW_IMAGE_PIPELINE_ENABLED,
      ),
      requireCoverForPublish: parseBoolean(
        process.env.OPENCLAW_REQUIRE_COVER_IMAGE_FOR_PUBLISH ?? "true",
      ),
      imageSearchProvider: process.env.IMAGE_SEARCH_PROVIDER || "disabled",
      aiImageProvider: process.env.AI_IMAGE_PROVIDER || "disabled",
      blogCronEnabled: parseBoolean(process.env.OPENCLAW_BLOG_CRON_ENABLED),
      telegramEnabled: parseBoolean(process.env.TELEGRAM_BOT_ENABLED),
    },
    telegram: telegramStatus,
    env: Object.fromEntries(
      requiredEnv.map((name) => [name, hasConfiguredValue(process.env[name])]),
    ),
    featureFlags,
    capabilities,
    openclaw: {
      dashboardUrl: lastDashboardUrl || getConfiguredDashboardUrl(),
      gatewayUrl: isDockerManaged()
        ? "ws://app_openclaw:18789"
        : "ws://127.0.0.1:18789",
      deploymentMode: isDockerManaged() ? "docker" : "local",
      configPath: path.relative(
        REPO_ROOT,
        path.join(OPENCLAW_ROOT, "openclaw.json5"),
      ),
      promptPath: path.relative(
        REPO_ROOT,
        path.join(OPENCLAW_ROOT, "prompts", "daily-seo-blog.md"),
      ),
      configExists: fs.existsSync(path.join(OPENCLAW_ROOT, "openclaw.json5")),
      promptExists: fs.existsSync(
        path.join(OPENCLAW_ROOT, "prompts", "daily-seo-blog.md"),
      ),
    },
    actions: Object.entries(ACTIONS)
      .filter(
        ([id]) => !isDockerManaged() || !DOCKER_UNAVAILABLE_ACTIONS.has(id),
      )
      .filter(([id]) => id !== "update-openclaw" || isDockerUpdateEnabled())
      .map(([id, action]) => ({
        id,
        label: action.label,
        timeoutMs: action.timeoutMs,
      })),
    agents: localAgents,
    localSkills,
    skillReport,
    runs: getRecentRuns(),
  };
};

class OpenClawDashboardService {
  static async dashboard() {
    const capabilityHealth = await OpenClawCapabilityHealthService.getStatus();
    const dashboard = buildDashboard({
      capabilities: capabilityHealth.capabilities,
    });
    const gateway = dashboard.capabilities.openclawGateway;
    dashboard.openclaw.health = {
      reachable: Boolean(gateway?.safeDetails?.reachable),
      live: Boolean(gateway?.safeDetails?.live),
      ready: Boolean(gateway?.safeDetails?.ready),
      livenessStatus: gateway?.safeDetails?.livenessStatus || null,
      readinessStatus: gateway?.safeDetails?.readinessStatus || null,
      checkedAt: gateway?.lastCheckedAt || null,
      error:
        gateway?.status === "healthy"
          ? ""
          : gateway?.reasonCode || "gateway_not_ready",
    };
    dashboard.capabilityHealth = {
      checkedAt: capabilityHealth.checkedAt,
      cacheSeconds: capabilityHealth.cacheSeconds,
      timeoutMs: capabilityHealth.timeoutMs,
      healthEnabled: capabilityHealth.healthEnabled === true,
      healthConfigurationValid:
        capabilityHealth.healthConfigurationValid !== false,
      healthConfigurationReasonCode:
        capabilityHealth.healthConfigurationReasonCode || null,
      capabilities: capabilityHealth.capabilities,
    };
    return dashboard;
  }

  static async listRuns() {
    const persisted = await OpenClawDashboardRun.find({})
      .sort({ startedAt: -1, _id: -1 })
      .limit(MAX_RUNS)
      .lean();
    const reconciled = await Promise.all(
      (Array.isArray(persisted) ? persisted : []).map((record) =>
        recoverStalePersistedRunRecord({ existing: record }),
      ),
    );
    const merged = new Map(
      reconciled.map((record) => [
        String(record.runId || ""),
        runtimeRunFromPersisted(record),
      ]),
    );
    for (const run of runStore.values()) {
      const reconciledRun = merged.get(run.id);
      if (reconciledRun && String(reconciledRun.status || "") !== "running") {
        Object.assign(run, reconciledRun);
      }
      merged.set(run.id, run);
    }
    return {
      runs: Array.from(merged.values())
        .sort(
          (a, b) =>
            new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
        )
        .slice(0, MAX_RUNS)
        .map((run) => normalizeRun(run)),
    };
  }

  static async getRun({ runId }) {
    const normalizedRunId = String(runId || "").trim();
    const run = runStore.get(normalizedRunId);
    if (run) {
      const reconciled = await recoverStalePersistedRunRecord({
        existing: run,
      });
      if (String(reconciled?.status || "") !== "running") {
        Object.assign(run, runtimeRunFromPersisted(reconciled));
      }
      return normalizeRun(run);
    }

    let persisted = await resolveLean(
      OpenClawDashboardRun.findOne({ runId: normalizedRunId }),
    );
    if (!persisted) throw new NotFoundError("OpenClaw run not found");
    persisted = await recoverStalePersistedRunRecord({ existing: persisted });
    return normalizeRun(runtimeRunFromPersisted(persisted));
  }

  static async startRun({ action, profile, idempotencyKey, principalId }) {
    const normalizedAction = String(action || "").trim();
    if (!ACTIONS[normalizedAction]) {
      throw new BadRequestError("Unsupported OpenClaw action");
    }

    const normalizedProfile = normalizeProfile(profile);
    validateActionPrincipal(principalId);
    validateActionIdempotencyKey(idempotencyKey);
    const command = buildCommand({
      action: normalizedAction,
      profile: normalizedProfile,
    });
    const reservation = await reserveIdempotentRun({
      action: normalizedAction,
      profile: normalizedProfile,
      principalId,
      idempotencyKey,
      command,
    });
    const { run } = reservation;
    if (reservation.replay) {
      return normalizeRun(run, { idempotentReplay: true });
    }

    runStore.set(run.id, run);
    trimRunStore();

    if (command.internal === "gateway-probe") {
      trackRunTask(
        run.id,
        (async () => {
          try {
            const health = await probeOpenClawGateway({
              timeoutMs: ACTIONS[normalizedAction].timeoutMs,
            });
            await durableFinalizeRun(run, {
              exitCode: health.ready ? 0 : 1,
              status: health.ready ? "completed" : "failed",
              output: redactForDashboard(
                [
                  health.ready
                    ? "OpenClaw Docker gateway is running and ready."
                    : "OpenClaw Docker gateway is not ready.",
                  JSON.stringify(health, null, 2),
                ].join("\n"),
              ),
              error: health.ready
                ? ""
                : redactForDashboard(health.error || "gateway_not_ready"),
              dashboardUrl:
                health.ready && lastDashboardUrl
                  ? lastDashboardUrl
                  : run.dashboardUrl,
            });
          } catch (error) {
            await durableFinalizeRun(run, {
              status: "failed",
              exitCode: 1,
              error: redactForDashboard(
                error?.message || "Unable to probe the OpenClaw gateway",
              ),
            });
          }
        })(),
      );
      return normalizeRun(run);
    }

    if (command.internal === "blog-schedule-run") {
      trackRunTask(
        run.id,
        (async () => {
          try {
            const listed = await BlogAutomationScheduleService.listSchedules({
              limit: 100,
              page: 1,
            });
            const schedules = Array.isArray(listed?.schedules)
              ? listed.schedules
              : [];
            const schedule =
              schedules.find((item) => item.enabled) || schedules[0];
            if (!schedule?.id) {
              throw new BadRequestError(
                "Create and save a blog schedule before running Daily Draft",
              );
            }

            const queued = await BlogAutomationScheduleService.runNow({
              scheduleId: schedule.id,
              idempotencyKey: `dashboard:${run.id}`,
              adminId: reservation.principalId,
            });
            const queuedAt = new Date(
              queued?.startedAt || run.startedAt,
            ).getTime();
            run.scheduleId = String(queued?.scheduleId || schedule.id);
            run.output = redactForDashboard(
              queued?.message ||
                "Daily Draft was queued in the audited blog automation pipeline.",
            );
            if (!(await durablePersistRunProgress(run))) return;

            const deadline = Date.now() + ACTIONS[normalizedAction].timeoutMs;
            while (Date.now() < deadline) {
              const history =
                await BlogAutomationScheduleService.listExecutions({
                  scheduleId: run.scheduleId,
                  limit: 20,
                });
              const execution = (history?.executions || []).find((item) => {
                const createdAt = new Date(
                  item?.createdAt || item?.startedAt || 0,
                ).getTime();
                return (
                  Number.isFinite(createdAt) && createdAt >= queuedAt - 5000
                );
              });

              if (execution) {
                run.executionId = execution.id || "";
                run.blogId = execution.blogId || "";
                run.blogSlug = execution.blogSlug || "";
                run.blogTitle = execution.blogTitle || "";
                run.output = redactForDashboard(
                  [
                    `Daily Draft execution: ${execution.status || "running"}`,
                    execution.id ? `Execution ID: ${execution.id}` : "",
                    execution.contentAction
                      ? `Content action: ${execution.contentAction}`
                      : "",
                    execution.blogTitle ? `Blog: ${execution.blogTitle}` : "",
                    execution.blogId ? `/admin/blogs/${execution.blogId}` : "",
                    execution.telegramNotificationStatus
                      ? `Telegram: ${execution.telegramNotificationStatus}`
                      : "",
                  ]
                    .filter(Boolean)
                    .join("\n"),
                );

                if (!DAILY_DRAFT_ACTIVE_STATES.has(execution.status)) {
                  const exitCode = DAILY_DRAFT_SUCCESS_STATES.has(
                    execution.status,
                  )
                    ? 0
                    : 1;
                  await durableFinalizeRun(run, {
                    finishedAt:
                      execution.completedAt || new Date().toISOString(),
                    exitCode,
                    status: exitCode === 0 ? "completed" : "failed",
                    error:
                      exitCode === 0
                        ? ""
                        : redactForDashboard(
                            execution.error ||
                              `daily_draft_${execution.status || "failed"}`,
                          ),
                  });
                  return;
                }
                if (!(await durablePersistRunProgress(run))) return;
              }

              await new Promise((resolve) => setTimeout(resolve, 2000));
            }

            await durableFinalizeRun(run, {
              status: "timed_out",
              exitCode: 1,
              error:
                "Daily Draft tracking timed out. Check schedule execution history before retrying.",
            });
          } catch (error) {
            await durableFinalizeRun(run, {
              status: "failed",
              exitCode: 1,
              error: redactForDashboard(
                error?.message || "Unable to start Daily Draft schedule",
              ),
            });
          }
        })(),
      );
      return normalizeRun(run);
    }

    if (command.internal === "docker-update-request") {
      trackRunTask(
        run.id,
        (async () => {
          try {
            const queued = queueDockerUpdateRequest({ runId: run.id });
            run.output = redactForDashboard(
              queued?.status?.message || "Docker update queued.",
            );
            if (!(await durablePersistRunProgress(run))) return;
            const deadline = Date.now() + ACTIONS[normalizedAction].timeoutMs;
            let lastPhase = "";
            const progressLines = [];

            while (Date.now() < deadline) {
              const status = readJsonIfExists(queued.statusFile);
              if (status?.requestId === run.id) {
                const phase = `${status.state || ""}:${status.phase || ""}:${status.updatedAt || ""}`;
                if (phase !== lastPhase) {
                  const formatted = formatDockerUpdateStatus(status);
                  if (formatted)
                    progressLines.push(
                      `[${status.phase || status.state}] ${formatted}`,
                    );
                  lastPhase = phase;
                  run.rawOutput = progressLines.join("\n\n");
                  run.output = redactForDashboard(run.rawOutput);
                }

                if (DOCKER_UPDATE_TERMINAL_STATES.has(status.state)) {
                  const completed = status.state === "completed";
                  await durableFinalizeRun(run, {
                    finishedAt: status.finishedAt || new Date().toISOString(),
                    exitCode: completed ? 0 : 1,
                    status: completed ? "completed" : "failed",
                    error: completed
                      ? ""
                      : redactForDashboard(
                          status.error ||
                            status.message ||
                            "OpenClaw update failed",
                        ),
                  });
                  return;
                }
              }
              await new Promise((resolve) => setTimeout(resolve, 2000));
            }

            await durableFinalizeRun(run, {
              status: "timed_out",
              exitCode: 1,
              error: "OpenClaw Docker update timed out",
            });
          } catch (error) {
            await durableFinalizeRun(run, {
              status: "failed",
              exitCode: 1,
              error: redactForDashboard(error.message),
            });
          }
        })(),
      );
      return normalizeRun(run);
    }

    let child;
    try {
      child = spawn(command.executable, command.args, {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          OPENCLAW_PROFILE: normalizeProfile(profile),
        },
        windowsHide: true,
      });
    } catch (error) {
      await durableFinalizeRun(run, {
        status: "failed",
        exitCode: 1,
        error: redactForDashboard(error.message),
      });
      return normalizeRun(run);
    }

    const appendOutput = (chunk) => {
      appendDashboardRunOutput(run, chunk);
    };

    child.stdout.on("data", appendOutput);
    child.stderr.on("data", appendOutput);
    const childTask = new Promise((resolve, reject) => {
      let settled = false;
      let timeout;
      const finish = (terminalFields, { terminate = false } = {}) => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        const output = terminalFields.output ?? finalizeDashboardRunOutput(run);
        if (terminate) child.kill("SIGTERM");
        durableFinalizeRun(run, { ...terminalFields, output }).then(
          resolve,
          reject,
        );
      };

      child.on("error", (error) => {
        finish({
          status: "failed",
          exitCode: 1,
          error: redactForDashboard(error.message),
        });
      });
      child.on("close", (code) => {
        if (settled) return;
        const decodedProcessOutput = decodeDashboardRunOutput(run);
        let dashboardUrl = run.dashboardUrl;
        if (normalizedAction === "start-openclaw") {
          const discoveredUrl = decodedProcessOutput.truncated
            ? ""
            : extractDashboardUrl(decodedProcessOutput.output);
          if (discoveredUrl) {
            dashboardUrl = discoveredUrl;
            lastDashboardUrl = discoveredUrl;
          }
        }
        const processOutput = finalizeDashboardRunOutput(
          run,
          decodedProcessOutput,
        );
        let output = processOutput;
        if (normalizedAction === "install-skills") {
          output = redactForDashboard(
            `${processOutput}\n\n${readFileIfExists(REPORT_FILE)}`,
          );
        }
        finish({
          exitCode: code,
          status: code === 0 ? "completed" : "failed",
          dashboardUrl,
          output,
        });
      });

      timeout = setTimeout(() => {
        finish(
          {
            status: "timed_out",
            exitCode: 1,
            error: `Timed out after ${ACTIONS[normalizedAction].timeoutMs}ms`,
          },
          { terminate: true },
        );
      }, ACTIONS[normalizedAction].timeoutMs);
      timeout.unref?.();
    });
    trackRunTask(run.id, childTask);

    return normalizeRun(run);
  }
}

module.exports = {
  OpenClawDashboardService,
  appendDashboardRunOutput,
  buildActionIdempotencyIdentity,
  buildCapabilityMatrix,
  capabilityStatus,
  decodeDashboardRunOutput,
  extractDashboardUrl,
  getConfiguredDashboardUrl,
  formatDockerUpdateStatus,
  finalizeDashboardRunOutput,
  probeOpenClawGateway,
  queueDockerUpdateRequest,
  redactForDashboard,
  releaseDockerUpdateQueueLock,
  validateActionIdempotencyKey,
};
