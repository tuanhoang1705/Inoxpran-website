// src/server.js
const path = require("path");
const dotenv = require("dotenv");
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, ".env"), override: true });

const app = require("./src/app");
const {
  cleanupExpiredPendingStorageUploads,
} = require("./src/services/pendingStorageUpload.service");
const {
  startBlogAutomationScheduler,
  stopBlogAutomationScheduler,
} = require("./src/services/blogAutomationScheduler.runtime");
const {
  startTelegramPolling,
  stopTelegramPolling,
} = require("./src/services/telegramPolling.runtime");
const {
  openClawRuntimeControlService,
} = require("./src/services/openclawRuntimeControl.service");
// import { connectDB } from './src/config/db.js';

const HOST = process.env.HOST || "0.0.0.0";
// Bind to localhost only
const PORT = Number(process.env.PORT) || 3056;

(async () => {
  try {
    // await connectDB(process.env.MONGODB_URI);
    try {
      const hydration = await openClawRuntimeControlService.hydrate({
        waitForConnection: true,
        timeoutMs: 15_000,
      });
      if (hydration.applied) {
        console.log(`OpenClaw runtime controls restored: ${hydration.applied}`);
      }
    } catch (error) {
      openClawRuntimeControlService.forceFailClosed();
      console.error(
        "OpenClaw runtime controls failed closed:",
        error?.message || error,
      );
    }

    const server = app.listen(PORT, HOST, () => {
      console.log(`API listening at http://${HOST}:${PORT}`);
    });
    const cleanupIntervalMs = Math.max(
      60_000,
      Number(process.env.PENDING_UPLOAD_CLEANUP_INTERVAL_MS || 60 * 60 * 1000),
    );
    const cleanupTimer = setInterval(() => {
      cleanupExpiredPendingStorageUploads().catch((error) => {
        console.error(
          "Pending upload cleanup failed:",
          error?.message || error,
        );
      });
    }, cleanupIntervalMs);
    cleanupTimer.unref();
    cleanupExpiredPendingStorageUploads().catch((error) => {
      console.error(
        "Initial pending upload cleanup failed:",
        error?.message || error,
      );
    });
    const blogScheduler = startBlogAutomationScheduler();
    if (blogScheduler.started) {
      console.log(`OpenClaw blog scheduler ready: ${blogScheduler.workerId}`);
    }
    const telegramPolling = startTelegramPolling();
    if (telegramPolling.started) console.log("Telegram approval polling ready");

    // Graceful shutdown
    const shutdown = (sig) => {
      console.log(`${sig} received. Shutting down...`);
      clearInterval(cleanupTimer);
      stopBlogAutomationScheduler();
      stopTelegramPolling();
      server.close(() => {
        console.log("HTTP server closed.");
        process.exit(0);
      });
      // Force exit if not closed in time
      setTimeout(() => process.exit(1), 10_000).unref();
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  } catch (err) {
    console.error("Startup error:", err);
    process.exit(1);
  }
})();
