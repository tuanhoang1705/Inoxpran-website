import path from "node:path";

const IMMUTABLE_IMAGE_REFERENCE =
  /^(?<repository>[^\s@]+):(?<tag>[^\s@/]+)@sha256:(?<digest>[a-f0-9]{64})$/i;
const RELEASE_COMMIT = /^[a-f0-9]{40}$/i;
const REQUEST_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_MAX_AGE_MS = 15 * 60 * 1000;

const normalized = (value) => String(value ?? "").trim();

const reviewedImage = (value) => {
  const image = normalized(value);
  const match = image.match(IMMUTABLE_IMAGE_REFERENCE);
  if (!match) {
    throw new Error(
      "OPENCLAW_UPDATE_IMAGE must include an explicit version tag and immutable sha256 digest",
    );
  }
  if (match.groups.tag.toLowerCase() === "latest") {
    throw new Error(
      "OPENCLAW_UPDATE_IMAGE must not use the mutable latest tag",
    );
  }
  if (/^0{64}$/.test(match.groups.digest)) {
    throw new Error(
      "OPENCLAW_UPDATE_IMAGE must not use an all-zero placeholder digest",
    );
  }
  return {
    image,
    digest: match.groups.digest.toLowerCase(),
  };
};

const approvalForDigest = (digest) =>
  `APPROVE_OPENCLAW_UPDATE_${digest.slice(0, 16).toUpperCase()}`;

const externalDirectory = (name, value, projectRoot) => {
  const candidate = normalized(value);
  if (!candidate || !path.isAbsolute(candidate)) {
    throw new Error(`${name} must be an explicit absolute directory`);
  }
  const resolved = path.resolve(candidate);
  const root = path.parse(resolved).root;
  if (resolved === root) {
    throw new Error(`${name} must not reference a filesystem root`);
  }
  const checkout = path.resolve(projectRoot);
  const relative = path.relative(checkout, resolved);
  if (!relative || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new Error(`${name} must remain outside the repository checkout`);
  }
  return resolved;
};

const resolveManualUpdatePolicy = (
  env = process.env,
  { projectRoot = process.cwd() } = {},
) => {
  const { image, digest } = reviewedImage(env.OPENCLAW_UPDATE_IMAGE);
  const configuredComposeImage = normalized(env.OPENCLAW_IMAGE);
  if (configuredComposeImage !== image) {
    throw new Error(
      "OPENCLAW_IMAGE must exactly match the reviewed OPENCLAW_UPDATE_IMAGE",
    );
  }
  if (normalized(env.OPENCLAW_NO_AUTO_UPDATE) !== "1") {
    throw new Error(
      "OPENCLAW_NO_AUTO_UPDATE must equal 1 during a manual update",
    );
  }
  if (normalized(env.OPENCLAW_UPDATE_ENABLED).toLowerCase() !== "false") {
    throw new Error(
      "OPENCLAW_UPDATE_ENABLED must remain false; use only the audited manual updater",
    );
  }

  const releaseCommit = normalized(env.RELEASE_COMMIT).toLowerCase();
  if (!RELEASE_COMMIT.test(releaseCommit)) {
    throw new Error("RELEASE_COMMIT must be the reviewed full Git commit");
  }

  const approval = approvalForDigest(digest);
  if (normalized(env.OPENCLAW_MANUAL_UPDATE_APPROVAL) !== approval) {
    throw new Error(
      "OPENCLAW_MANUAL_UPDATE_APPROVAL does not acknowledge the reviewed image digest",
    );
  }

  const runtimeDir = externalDirectory(
    "OPENCLAW_UPDATE_RUNTIME_DIR",
    env.OPENCLAW_UPDATE_RUNTIME_DIR,
    projectRoot,
  );
  const backupRoot = externalDirectory(
    "OPENCLAW_UPDATE_BACKUP_DIR",
    env.OPENCLAW_UPDATE_BACKUP_DIR,
    projectRoot,
  );
  if (
    runtimeDir === backupRoot ||
    runtimeDir.startsWith(`${backupRoot}${path.sep}`) ||
    backupRoot.startsWith(`${runtimeDir}${path.sep}`)
  ) {
    throw new Error(
      "OpenClaw update runtime and backup directories must be distinct and non-overlapping",
    );
  }

  return Object.freeze({
    approval,
    backupRoot,
    digest,
    image,
    releaseCommit,
    runtimeDir,
  });
};

const validateManualUpdateRequest = (
  payload,
  policy,
  { now = Date.now() } = {},
) => {
  if (
    !payload ||
    payload.schemaVersion !== 2 ||
    payload.action !== "update-openclaw-manual"
  ) {
    throw new Error("Unsupported manual update request");
  }
  if (!REQUEST_ID.test(normalized(payload.requestId))) {
    throw new Error("Invalid manual update request id");
  }

  const requestedAt = new Date(payload.requestedAt).getTime();
  if (
    !Number.isFinite(requestedAt) ||
    Math.abs(Number(now) - requestedAt) > REQUEST_MAX_AGE_MS
  ) {
    throw new Error("Expired manual update request");
  }
  if (normalized(payload.targetImage) !== policy.image) {
    throw new Error("Manual update target does not match the reviewed image");
  }
  if (
    normalized(payload.releaseCommit).toLowerCase() !== policy.releaseCommit
  ) {
    throw new Error(
      "Manual update request is not bound to the reviewed release commit",
    );
  }
  if (normalized(payload.approval) !== policy.approval) {
    throw new Error("Manual update request approval is invalid");
  }
  return Object.freeze({
    ...payload,
    releaseCommit: policy.releaseCommit,
    targetImage: policy.image,
  });
};

export {
  IMMUTABLE_IMAGE_REFERENCE,
  REQUEST_MAX_AGE_MS,
  approvalForDigest,
  externalDirectory,
  resolveManualUpdatePolicy,
  reviewedImage,
  validateManualUpdateRequest,
};
