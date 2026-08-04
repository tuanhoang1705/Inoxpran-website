import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const composePath = path.join(repositoryRoot, "docker-compose.yml");
const localComposePath = path.join(repositoryRoot, "docker-compose.local.yml");

const requiredImageVariables = [
  "NODE_RUNTIME_IMAGE",
  "REDIS_IMAGE",
  "NGINX_IMAGE",
  "CERTBOT_IMAGE",
  "OPENCLAW_IMAGE",
];

const n8nDisabledImageReference =
  "invalid.invalid/inoxpran/n8n-disabled@sha256:0000000000000000000000000000000000000000000000000000000000000000";
const automationImageIsConfigured = Boolean(process.env.N8N_IMAGE?.trim());
const reviewedImageVariables = automationImageIsConfigured
  ? [...requiredImageVariables, "N8N_IMAGE"]
  : requiredImageVariables;

const serviceImageVariables = new Map([
  ["redis", "REDIS_IMAGE"],
  ["telegram-relay", "NGINX_IMAGE"],
  ["openclaw", "OPENCLAW_IMAGE"],
  ["nginx", "NGINX_IMAGE"],
  ["certbot", "CERTBOT_IMAGE"],
]);

const violations = [];
const imageValues = new Map();

for (const variableName of reviewedImageVariables) {
  const value = process.env[variableName]?.trim() ?? "";
  const versionedDigest = value.match(
    /^(?<repository>[^\s@]+):(?<version>[^\s@/]+)@sha256:(?<digest>[a-f0-9]{64})$/i,
  );

  if (!versionedDigest) {
    violations.push(
      `${variableName} must include an explicit version tag and end in @sha256:<64 hex>`,
    );
    continue;
  }
  const { version, digest } = versionedDigest.groups;
  if (version.toLowerCase() === "latest") {
    violations.push(`${variableName} must not use the mutable latest tag`);
    continue;
  }
  if (/^0{64}$/i.test(digest)) {
    violations.push(
      `${variableName} must not use the all-zero placeholder digest`,
    );
    continue;
  }
  if (/[\s\r\n]/.test(value)) {
    violations.push(
      `${variableName} must not contain whitespace or control characters`,
    );
    continue;
  }

  imageValues.set(variableName, value);
}

const composeSource = fs.readFileSync(composePath, "utf8");
const localComposeSource = fs.readFileSync(localComposePath, "utf8");
for (const variableName of requiredImageVariables.filter(
  (name) => name !== "NODE_RUNTIME_IMAGE",
)) {
  const failClosedReference = new RegExp(
    String.raw`image:\s*\$\{${variableName}:\?[^}\r\n]+\}`,
    "m",
  );
  if (!failClosedReference.test(composeSource)) {
    violations.push(
      `docker-compose.yml must require ${variableName} with the fail-closed \${${variableName}:?...} form`,
    );
  }
}

const expectedDisabledN8nReference =
  "image: ${N8N_IMAGE:-" + n8nDisabledImageReference + "}";
if (!composeSource.includes(expectedDisabledN8nReference)) {
  violations.push(
    "docker-compose.yml must use the reviewed nonexistent n8n sentinel when automation is expected_disabled",
  );
}

const backendServiceSource = composeSource.match(
  /^  backend:\s*$([\s\S]*?)(?=^  frontend:\s*$)/m,
)?.[1];
if (!backendServiceSource) {
  violations.push("docker-compose.yml must define the backend service");
} else {
  for (const [description, pattern] of [
    ["enable Redis for production", /REDIS_ENABLED:\s*["']?true["']?/],
    ["require Redis for production", /REDIS_REQUIRED:\s*["']?true["']?/],
    ["use the Redis service DNS name", /REDIS_HOST:\s*redis/],
    ["require Redis TLS", /REDIS_TLS:\s*["']?true["']?/],
    [
      "mount the Redis CA path",
      /REDIS_TLS_CA_FILE:\s*\/run\/secrets\/redis-ca\.crt/,
    ],
  ]) {
    if (!pattern.test(backendServiceSource)) {
      violations.push(`docker-compose.yml backend must ${description}`);
    }
  }
}

const localBackendServiceSource = localComposeSource.match(
  /^  backend:\s*$([\s\S]*?)(?=^  n8n:\s*$)/m,
)?.[1];
if (!localBackendServiceSource) {
  violations.push("docker-compose.local.yml must define the backend service");
} else {
  for (const [description, pattern] of [
    ["run as development", /NODE_ENV:\s*development/],
    ["enable Redis explicitly", /REDIS_ENABLED:\s*["']?true["']?/],
    ["require its local Redis dependency", /REDIS_REQUIRED:\s*["']?true["']?/],
    ["use the local Compose Redis DNS name", /REDIS_HOST:\s*redis/],
    ["keep local-only Redis TLS disabled", /REDIS_TLS:\s*["']?false["']?/],
    ["clear the legacy shared API key", /API_KEY:\s*["']{2}/],
    [
      "wait for the local Redis healthcheck",
      /depends_on:[\s\S]*redis:[\s\S]*condition:\s*service_healthy/,
    ],
  ]) {
    if (!pattern.test(localBackendServiceSource)) {
      violations.push(`docker-compose.local.yml backend must ${description}`);
    }
  }
}

const localRedisServiceSource = localComposeSource.match(
  /^  redis:\s*$([\s\S]*?)(?=^  backend:\s*$)/m,
)?.[1];
if (!localRedisServiceSource || !/healthcheck:/.test(localRedisServiceSource)) {
  violations.push(
    "docker-compose.local.yml Redis service must define a healthcheck",
  );
}

const localN8nServiceSource = localComposeSource.match(
  /^  n8n:\s*$([\s\S]*?)(?=^  frontend:\s*$)/m,
)?.[1];
if (!localN8nServiceSource) {
  violations.push("docker-compose.local.yml must define opt-in n8n");
} else {
  for (const [description, pattern] of [
    ["keep n8n behind the automation profile", /profiles:[\s\S]*- automation/],
    [
      "block env access in n8n nodes",
      /N8N_BLOCK_ENV_ACCESS_IN_NODE:\s*["']true["']/,
    ],
    [
      "clear the n8n builtin allowlist",
      /NODE_FUNCTION_ALLOW_BUILTIN:\s*["']{2}/,
    ],
    ["keep the n8n root filesystem read-only", /read_only:\s*true/],
    ["require external n8n data configuration", /N8N_DATA_HOST_PATH/],
  ]) {
    if (!pattern.test(localN8nServiceSource)) {
      violations.push(`docker-compose.local.yml must ${description}`);
    }
  }
  if (
    /change-this|N8N_BLOCK_ENV_ACCESS_IN_NODE:\s*\$\{/i.test(
      localN8nServiceSource,
    )
  ) {
    violations.push(
      "docker-compose.local.yml must not restore insecure n8n fallback settings",
    );
  }
}

const n8nServiceSource = composeSource.match(
  /^  n8n:\s*$([\s\S]*?)(?=^  openclaw:\s*$)/m,
)?.[1];
if (!n8nServiceSource) {
  violations.push("docker-compose.yml must define the opt-in n8n service");
} else {
  for (const [description, pattern] of [
    [
      "require N8N_DATA_HOST_PATH before n8n starts",
      /test -n "\$\$\{N8N_DATA_HOST_PATH\}"/,
    ],
    [
      "pass N8N_DATA_HOST_PATH into the n8n container",
      /N8N_DATA_HOST_PATH:\s*\$\{N8N_DATA_HOST_PATH:-\}/,
    ],
    [
      "bind the reviewed n8n data directory",
      /\$\{N8N_DATA_HOST_PATH:-\.\/deploy\/n8n\/disabled-data\}:\/home\/node\/\.n8n/,
    ],
    ["keep the n8n root filesystem read-only", /^\s{4}read_only:\s*true\s*$/m],
    [
      "provide a bounded n8n temporary filesystem",
      /\/tmp:rw,noexec,nosuid,size=128m/,
    ],
  ]) {
    if (!pattern.test(n8nServiceSource)) {
      violations.push(`docker-compose.yml must ${description}`);
    }
  }
}

const buildArgumentReference =
  /NODE_RUNTIME_IMAGE:\s*\$\{NODE_RUNTIME_IMAGE:\?[^}\r\n]+\}/gm;
if ((composeSource.match(buildArgumentReference) ?? []).length !== 2) {
  violations.push(
    "docker-compose.yml must require NODE_RUNTIME_IMAGE for both backend and frontend builds",
  );
}

for (const relativeDockerfile of [
  "backend/Dockerfile",
  "frontend/Dockerfile",
]) {
  const dockerfilePath = path.join(repositoryRoot, relativeDockerfile);
  const dockerfileSource = fs.readFileSync(dockerfilePath, "utf8");
  const defaultRuntimeImage = dockerfileSource.match(
    /^ARG NODE_RUNTIME_IMAGE=(\S+)\s*$/m,
  )?.[1];

  if (!defaultRuntimeImage) {
    violations.push(
      `${relativeDockerfile} must define a pinned NODE_RUNTIME_IMAGE default`,
    );
    continue;
  }
  if (defaultRuntimeImage !== imageValues.get("NODE_RUNTIME_IMAGE")) {
    violations.push(
      `${relativeDockerfile} NODE_RUNTIME_IMAGE default must match the CI-reviewed NODE_RUNTIME_IMAGE`,
    );
  }
  if (
    !/^FROM \$\{NODE_RUNTIME_IMAGE\}(?:\s+AS\s+\S+)?\s*$/im.test(
      dockerfileSource,
    )
  ) {
    violations.push(
      `${relativeDockerfile} must build FROM the reviewed NODE_RUNTIME_IMAGE`,
    );
  }
}

const composeJsonIndex = process.argv.indexOf("--compose-json");
const requireN8nService = process.argv.includes("--require-n8n");
if (requireN8nService && !automationImageIsConfigured) {
  violations.push("--require-n8n requires a reviewed N8N_IMAGE");
}
if (composeJsonIndex !== -1) {
  const composeJsonArgument = process.argv[composeJsonIndex + 1];
  if (!composeJsonArgument) {
    violations.push("--compose-json requires a file path");
  } else {
    const composeJsonPath = path.resolve(process.cwd(), composeJsonArgument);
    let renderedCompose;
    try {
      renderedCompose = JSON.parse(fs.readFileSync(composeJsonPath, "utf8"));
    } catch (error) {
      violations.push(`could not read rendered Compose JSON: ${error.message}`);
    }

    if (renderedCompose) {
      for (const [serviceName, variableName] of serviceImageVariables) {
        const renderedImage = renderedCompose.services?.[serviceName]?.image;
        if (renderedImage !== imageValues.get(variableName)) {
          violations.push(
            `rendered service ${serviceName} must use the exact reviewed ${variableName} reference`,
          );
        }
      }

      for (const serviceName of ["backend", "frontend"]) {
        const renderedBuildArgument =
          renderedCompose.services?.[serviceName]?.build?.args
            ?.NODE_RUNTIME_IMAGE;
        if (renderedBuildArgument !== imageValues.get("NODE_RUNTIME_IMAGE")) {
          violations.push(
            `rendered service ${serviceName} must build with the exact reviewed NODE_RUNTIME_IMAGE`,
          );
        }
      }

      const renderedBackend = renderedCompose.services?.backend;
      const renderedBackendEnvironment = renderedBackend?.environment ?? {};
      for (const [name, expectedValue] of [
        ["REDIS_ENABLED", "true"],
        ["REDIS_REQUIRED", "true"],
        ["REDIS_HOST", "redis"],
        ["REDIS_TLS", "true"],
        ["REDIS_TLS_CA_FILE", "/run/secrets/redis-ca.crt"],
      ]) {
        if (String(renderedBackendEnvironment[name] ?? "") !== expectedValue) {
          violations.push(
            `rendered backend must set ${name} to the production Redis contract value`,
          );
        }
      }
      if (renderedBackend?.depends_on?.redis?.condition !== "service_healthy") {
        violations.push(
          "rendered backend must wait for the Redis service healthcheck",
        );
      }

      const renderedN8n = renderedCompose.services?.n8n;
      if (requireN8nService && !renderedN8n) {
        violations.push(
          "rendered automation profile must include the reviewed n8n service",
        );
      }
      if (renderedN8n) {
        if (
          !automationImageIsConfigured ||
          renderedN8n.image !== imageValues.get("N8N_IMAGE")
        ) {
          violations.push(
            "rendered n8n service must use the exact reviewed N8N_IMAGE reference",
          );
        }
        const n8nService = renderedCompose.services?.n8n;
        if (n8nService?.read_only !== true) {
          violations.push(
            "rendered n8n service must keep its root filesystem read-only",
          );
        }
        if (
          n8nService?.environment?.N8N_DATA_HOST_PATH !==
          process.env.N8N_DATA_HOST_PATH
        ) {
          violations.push(
            "rendered n8n service must receive the reviewed N8N_DATA_HOST_PATH",
          );
        }
        const n8nDataMount = n8nService?.volumes?.find(
          (volume) => volume?.target === "/home/node/.n8n",
        );
        if (
          !process.env.N8N_DATA_HOST_PATH ||
          n8nDataMount?.source !== process.env.N8N_DATA_HOST_PATH ||
          n8nDataMount?.read_only === true
        ) {
          violations.push(
            "rendered n8n service must use the exact reviewed writable external data directory",
          );
        }
      }
    }
  }
}

if (violations.length > 0) {
  process.stderr.write(
    `Container contract failed:\n- ${violations.join("\n- ")}\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `Container contract passed for ${reviewedImageVariables.length} versioned immutable image references and ${serviceImageVariables.size + (automationImageIsConfigured ? 1 : 0)} external services; n8n=${automationImageIsConfigured ? "reviewed" : "expected_disabled"}.\n`,
);
