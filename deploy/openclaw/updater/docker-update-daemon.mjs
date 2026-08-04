import { constants as fsConstants } from "node:fs";
import { access, rename, unlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const configuredRuntimeDir = String(
  process.env.OPENCLAW_UPDATE_RUNTIME_DIR || "",
).trim();
if (!configuredRuntimeDir || !path.isAbsolute(configuredRuntimeDir)) {
  throw new Error(
    "OPENCLAW_UPDATE_RUNTIME_DIR must be an explicit absolute directory for the manual updater",
  );
}
const runtimeDir = path.resolve(configuredRuntimeDir);
const requestFile = path.join(runtimeDir, "request.json");
const processingFile = path.join(runtimeDir, "processing.json");
const pollMs = Math.max(
  1000,
  Number(process.env.OPENCLAW_UPDATE_POLL_MS || 2000),
);

let stopping = false;
let worker = null;

const exists = async (filePath) => {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const runWorker = async () => {
  if (worker || stopping) return;

  if (!(await exists(processingFile))) {
    try {
      await rename(requestFile, processingFile);
    } catch (error) {
      if (error?.code !== "ENOENT")
        console.error("[openclaw-updater] claim failed:", error.message);
      return;
    }
  }

  worker = spawn(
    process.execPath,
    [path.join(scriptRoot, "docker-update-worker.mjs"), processingFile],
    {
      cwd: scriptRoot,
      env: process.env,
      stdio: "inherit",
    },
  );

  await new Promise((resolve) => {
    worker.once("error", (error) => {
      console.error(
        "[openclaw-updater] worker failed to start:",
        error.message,
      );
      resolve();
    });
    worker.once("close", (code) => {
      if (code !== 0)
        console.error(`[openclaw-updater] worker exited with code ${code}`);
      resolve();
    });
  });

  worker = null;
  await unlink(processingFile).catch(() => {});
};

const shutdown = (signal) => {
  stopping = true;
  if (worker && !worker.killed) worker.kill(signal);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

console.log(`[openclaw-updater] watching ${runtimeDir}`);
while (!stopping) {
  await runWorker();
  await sleep(pollMs);
}
