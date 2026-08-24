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
  "NINE_ROUTER_IMAGE",
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
  ["nine-router", "NINE_ROUTER_IMAGE"],
  ["openclaw", "OPENCLAW_IMAGE"],
  ["nginx", "NGINX_IMAGE"],
  ["certbot", "CERTBOT_IMAGE"],
]);

const violations = [];
const imageValues = new Map();
const nineRouterSecretVariables = [
  "NINE_ROUTER_API_KEY",
  "NINE_ROUTER_JWT_SECRET",
  "NINE_ROUTER_INITIAL_PASSWORD",
  "NINE_ROUTER_API_KEY_SECRET",
  "NINE_ROUTER_MACHINE_ID_SALT",
];
const placeholderSecretPattern =
  /change[-_]this|replace[-_]me|example[-_](?:secret|token)|your[-_](?:secret|token)/i;

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

const nineRouterSecretValues = new Map();
for (const variableName of nineRouterSecretVariables) {
  const value = process.env[variableName]?.trim() ?? "";
  if (value.length < 32) {
    violations.push(`${variableName} must contain at least 32 characters`);
    continue;
  }
  if (placeholderSecretPattern.test(value)) {
    violations.push(`${variableName} must not use a placeholder value`);
    continue;
  }
  if (/[\0\r\n]/.test(value)) {
    violations.push(`${variableName} must not contain control characters`);
    continue;
  }
  nineRouterSecretValues.set(variableName, value);
}
for (
  let leftIndex = 0;
  leftIndex < nineRouterSecretVariables.length;
  leftIndex += 1
) {
  for (
    let rightIndex = leftIndex + 1;
    rightIndex < nineRouterSecretVariables.length;
    rightIndex += 1
  ) {
    const leftName = nineRouterSecretVariables[leftIndex];
    const rightName = nineRouterSecretVariables[rightIndex];
    const leftValue = nineRouterSecretValues.get(leftName);
    const rightValue = nineRouterSecretValues.get(rightName);
    if (leftValue && rightValue && leftValue === rightValue) {
      violations.push(
        `9router secrets must be distinct: ${leftName} and ${rightName} collide`,
      );
    }
  }
}

const nineRouterDataHostPath =
  process.env.NINE_ROUTER_DATA_HOST_PATH?.trim() ?? "";
const pathIsInsideRepository = (candidatePath) => {
  const relativeToRepository = path.relative(repositoryRoot, candidatePath);
  return (
    relativeToRepository === "" ||
    (!relativeToRepository.startsWith(`..${path.sep}`) &&
      relativeToRepository !== ".." &&
      !path.isAbsolute(relativeToRepository))
  );
};
if (!nineRouterDataHostPath || !path.isAbsolute(nineRouterDataHostPath)) {
  violations.push(
    "NINE_ROUTER_DATA_HOST_PATH must be an explicit absolute host directory",
  );
} else {
  try {
    const resolvedDataPath = fs.realpathSync(nineRouterDataHostPath);
    if (resolvedDataPath === path.parse(resolvedDataPath).root) {
      violations.push(
        "NINE_ROUTER_DATA_HOST_PATH must not resolve to a filesystem root",
      );
    }
    if (
      pathIsInsideRepository(path.resolve(nineRouterDataHostPath)) ||
      pathIsInsideRepository(resolvedDataPath)
    ) {
      violations.push(
        "NINE_ROUTER_DATA_HOST_PATH must remain outside the repository checkout",
      );
    }
    if (!fs.statSync(resolvedDataPath).isDirectory()) {
      violations.push("NINE_ROUTER_DATA_HOST_PATH must reference a directory");
    } else {
      fs.accessSync(resolvedDataPath, fs.constants.R_OK | fs.constants.W_OK);
    }
  } catch (error) {
    violations.push(
      `NINE_ROUTER_DATA_HOST_PATH must reference an existing readable and writable directory: ${error.code ?? error.message}`,
    );
  }
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
const redisServiceSource = composeSource.match(
  /^  redis:\s*$([\s\S]*?)(?=^  backend:\s*$)/m,
)?.[1];
if (
  !redisServiceSource ||
  !/^\s{4}user:\s*["']999:1000["']\s*$/m.test(redisServiceSource)
) {
  violations.push(
    "docker-compose.yml Redis must run as 999:1000 for its external TLS group access",
  );
}
if (!backendServiceSource) {
  violations.push("docker-compose.yml must define the backend service");
} else {
  for (const [description, pattern] of [
    ["enable Redis for production", /REDIS_ENABLED:\s*["']?true["']?/],
    ["require Redis for production", /REDIS_REQUIRED:\s*["']?true["']?/],
    ["use the Redis service DNS name", /REDIS_HOST:\s*redis/],
    ["require Redis TLS", /REDIS_TLS:\s*["']?true["']?/],
    [
      "receive the private 9router bearer key",
      /NINE_ROUTER_API_KEY:\s*\$\{NINE_ROUTER_API_KEY:\?[^}\r\n]+\}/,
    ],
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
  /^  n8n:\s*$([\s\S]*?)(?=^  nine-router:\s*$)/m,
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

const nineRouterServiceSource = composeSource.match(
  /^  nine-router:\s*$([\s\S]*?)(?=^  openclaw:\s*$)/m,
)?.[1];
if (!nineRouterServiceSource) {
  violations.push(
    "docker-compose.yml must define the private nine-router service",
  );
} else {
  for (const [description, pattern] of [
    ["require API-key authentication", /REQUIRE_API_KEY:\s*["']true["']/],
    ["disable request logging", /ENABLE_REQUEST_LOGS:\s*["']false["']/],
    ["disable observability export", /OBSERVABILITY_ENABLED:\s*["']false["']/],
    [
      "require NINE_ROUTER_JWT_SECRET",
      /JWT_SECRET:\s*\$\{NINE_ROUTER_JWT_SECRET:\?[^}\r\n]+\}/,
    ],
    [
      "require NINE_ROUTER_INITIAL_PASSWORD",
      /INITIAL_PASSWORD:\s*\$\{NINE_ROUTER_INITIAL_PASSWORD:\?[^}\r\n]+\}/,
    ],
    [
      "require NINE_ROUTER_API_KEY_SECRET",
      /API_KEY_SECRET:\s*\$\{NINE_ROUTER_API_KEY_SECRET:\?[^}\r\n]+\}/,
    ],
    [
      "require NINE_ROUTER_MACHINE_ID_SALT",
      /MACHINE_ID_SALT:\s*\$\{NINE_ROUTER_MACHINE_ID_SALT:\?[^}\r\n]+\}/,
    ],
    [
      "bind the fail-closed external data directory",
      /\$\{NINE_ROUTER_DATA_HOST_PATH:\?[^}\r\n]+\}:\/app\/data/,
    ],
    ["keep its root filesystem read-only", /^\s{4}read_only:\s*true\s*$/m],
    ["run as the external data owner", /^\s{4}user:\s*["']1000:1000["']\s*$/m],
    [
      "bypass the image privilege-dropping entrypoint",
      /^\s{4}entrypoint:\s*\[["']node["']\]\s*$/m,
    ],
    [
      "start the reviewed server directly",
      /^\s{4}command:\s*\[["']custom-server\.js["']\]\s*$/m,
    ],
    ["join only the dedicated model network", /^\s{6}- modelnet\s*$/m],
  ]) {
    if (!pattern.test(nineRouterServiceSource)) {
      violations.push(`docker-compose.yml nine-router must ${description}`);
    }
  }
  if (/^\s{4}ports:\s*$/m.test(nineRouterServiceSource)) {
    violations.push(
      "docker-compose.yml nine-router must not publish host ports",
    );
  }
  if (/^\s{6}- appnet\s*$/m.test(nineRouterServiceSource)) {
    violations.push("docker-compose.yml nine-router must not join appnet");
  }
}

const openclawServiceSource = composeSource.match(
  /^  openclaw:\s*$([\s\S]*?)(?=^  openclaw-worker:\s*$)/m,
)?.[1];
if (!openclawServiceSource) {
  violations.push("docker-compose.yml must define the openclaw service");
} else {
  for (const [description, pattern] of [
    [
      "require NINE_ROUTER_API_KEY",
      /NINE_ROUTER_API_KEY:\s*\$\{NINE_ROUTER_API_KEY:\?[^}\r\n]+\}/,
    ],
    ["join appnet", /^\s{6}- appnet\s*$/m],
    ["join the dedicated model network", /^\s{6}- modelnet\s*$/m],
  ]) {
    if (!pattern.test(openclawServiceSource)) {
      violations.push(`docker-compose.yml openclaw must ${description}`);
    }
  }
}

const modelNetworkSource = composeSource.match(
  /^  modelnet:\s*$([\s\S]*?)(?=^volumes:\s*$)/m,
)?.[1];
if (
  !modelNetworkSource ||
  !/^\s{4}driver:\s*bridge\s*$/m.test(modelNetworkSource)
) {
  violations.push(
    "docker-compose.yml must define modelnet as a bridge network",
  );
} else if (/^\s{4}internal:\s*true\s*$/m.test(modelNetworkSource)) {
  violations.push("docker-compose.yml modelnet must allow 9router egress");
}
if ((composeSource.match(/^\s{6}- modelnet\s*$/gm) ?? []).length !== 5) {
  violations.push(
    "docker-compose.yml must attach only backend, nginx, openclaw, openclaw-worker and nine-router to modelnet",
  );
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
const renderedNetworkNames = (service) => {
  const networks = service?.networks;
  if (Array.isArray(networks)) return [...networks].sort();
  if (networks && typeof networks === "object") {
    return Object.keys(networks).sort();
  }
  return [];
};
if (requireN8nService && !automationImageIsConfigured) {
  violations.push("--require-n8n requires a reviewed N8N_IMAGE");
}
if (composeJsonIndex !== -1) {
  const composeJsonArgument = process.argv[composeJsonIndex + 1];
  if (!composeJsonArgument) {
    violations.push("--compose-json requires a file path");
  } else {
    let renderedCompose;
    try {
      const composeJsonSource =
        composeJsonArgument === "-"
          ? fs.readFileSync(0, "utf8")
          : fs.readFileSync(
              path.resolve(process.cwd(), composeJsonArgument),
              "utf8",
            );
      renderedCompose = JSON.parse(composeJsonSource);
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
      if (
        renderedBackendEnvironment.NINE_ROUTER_API_KEY !==
        process.env.NINE_ROUTER_API_KEY
      ) {
        violations.push(
          "rendered backend must receive the reviewed NINE_ROUTER_API_KEY",
        );
      }
      if (
        JSON.stringify(renderedNetworkNames(renderedBackend)) !==
        JSON.stringify(["appnet", "modelnet"])
      ) {
        violations.push("rendered backend must join appnet and modelnet only");
      }
      const renderedOpenclawWorker = renderedCompose.services?.["openclaw-worker"];
      if (
        renderedOpenclawWorker?.environment?.NINE_ROUTER_API_KEY !==
        process.env.NINE_ROUTER_API_KEY
      ) {
        violations.push(
          "rendered openclaw-worker must receive the reviewed NINE_ROUTER_API_KEY",
        );
      }
      if (
        JSON.stringify(renderedNetworkNames(renderedOpenclawWorker)) !==
        JSON.stringify(["appnet", "modelnet"])
      ) {
        violations.push(
          "rendered openclaw-worker must join appnet and modelnet only",
        );
      }

      if (renderedCompose.services?.redis?.user !== "999:1000") {
        violations.push(
          "rendered Redis must run as 999:1000 for its external TLS group access",
        );
      }

      const renderedNineRouter = renderedCompose.services?.["nine-router"];
      if (!renderedNineRouter) {
        violations.push(
          "rendered Compose must include the private nine-router service",
        );
      } else {
        const routerEnvironment = renderedNineRouter.environment ?? {};
        for (const [name, expectedValue] of [
          ["REQUIRE_API_KEY", "true"],
          ["ENABLE_REQUEST_LOGS", "false"],
          ["OBSERVABILITY_ENABLED", "false"],
        ]) {
          if (String(routerEnvironment[name] ?? "") !== expectedValue) {
            violations.push(
              `rendered nine-router must set ${name} to ${expectedValue}`,
            );
          }
        }
        for (const [containerName, environmentName] of [
          ["JWT_SECRET", "NINE_ROUTER_JWT_SECRET"],
          ["INITIAL_PASSWORD", "NINE_ROUTER_INITIAL_PASSWORD"],
          ["API_KEY_SECRET", "NINE_ROUTER_API_KEY_SECRET"],
          ["MACHINE_ID_SALT", "NINE_ROUTER_MACHINE_ID_SALT"],
        ]) {
          if (
            routerEnvironment[containerName] !== process.env[environmentName]
          ) {
            violations.push(
              `rendered nine-router must receive the reviewed ${environmentName}`,
            );
          }
        }
        if (renderedNineRouter.read_only !== true) {
          violations.push(
            "rendered nine-router must keep its root filesystem read-only",
          );
        }
        if (renderedNineRouter.user !== "1000:1000") {
          violations.push(
            "rendered nine-router must run as 1000:1000 for external data access",
          );
        }
        if (
          JSON.stringify(renderedNineRouter.entrypoint) !==
            JSON.stringify(["node"]) ||
          JSON.stringify(renderedNineRouter.command) !==
            JSON.stringify(["custom-server.js"])
        ) {
          violations.push(
            "rendered nine-router must bypass the image su-exec entrypoint and start custom-server.js directly",
          );
        }
        if ((renderedNineRouter.ports ?? []).length > 0) {
          violations.push("rendered nine-router must not publish host ports");
        }
        const routerDataMount = renderedNineRouter.volumes?.find(
          (volume) => volume?.target === "/app/data",
        );
        if (
          routerDataMount?.source !== nineRouterDataHostPath ||
          routerDataMount?.read_only === true
        ) {
          violations.push(
            "rendered nine-router must use the exact reviewed writable external data directory",
          );
        }
        if (
          JSON.stringify(renderedNetworkNames(renderedNineRouter)) !==
          JSON.stringify(["modelnet"])
        ) {
          violations.push("rendered nine-router must join only modelnet");
        }
      }

      const renderedOpenclaw = renderedCompose.services?.openclaw;
      if (!renderedOpenclaw) {
        violations.push("rendered Compose must include the openclaw service");
      } else {
        if (
          renderedOpenclaw.environment?.NINE_ROUTER_API_KEY !==
          process.env.NINE_ROUTER_API_KEY
        ) {
          violations.push(
            "rendered openclaw must receive the reviewed NINE_ROUTER_API_KEY",
          );
        }
        if (
          JSON.stringify(renderedNetworkNames(renderedOpenclaw)) !==
          JSON.stringify(["appnet", "modelnet"])
        ) {
          violations.push(
            "rendered openclaw must join appnet and modelnet only",
          );
        }
        if (
          renderedOpenclaw.depends_on?.["nine-router"]?.condition !==
          "service_healthy"
        ) {
          violations.push(
            "rendered openclaw must wait for the nine-router healthcheck",
          );
        }
      }

      const renderedModelNetwork = renderedCompose.networks?.modelnet;
      if (
        renderedModelNetwork?.driver !== "bridge" ||
        renderedModelNetwork?.internal === true
      ) {
        violations.push(
          "rendered modelnet must be a non-internal bridge so private 9router keeps egress",
        );
      }
      const modelNetworkConsumers = Object.entries(
        renderedCompose.services ?? {},
      )
        .filter(([, service]) =>
          renderedNetworkNames(service).includes("modelnet"),
        )
        .map(([serviceName]) => serviceName)
        .sort();
      if (
        JSON.stringify(modelNetworkConsumers) !==
        JSON.stringify(["backend", "nginx", "nine-router", "openclaw", "openclaw-worker"])
      ) {
        violations.push(
          "rendered modelnet must be shared only by backend, nginx, openclaw, openclaw-worker and nine-router",
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
