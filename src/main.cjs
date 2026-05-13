const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function writeEarlyFailure(stage, error) {
  try {
    const dir = path.join(process.env.APPDATA || os.tmpdir(), "BayanFlow", "logs");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(
      path.join(dir, "early-startup.log"),
      `${new Date().toISOString()} ${stage} ${error?.stack || error?.message || String(error)}\n`,
      "utf8",
    );
  } catch {
    // Nothing else is safe this early in app startup.
  }
}

process.on("uncaughtException", (error) => {
  writeEarlyFailure("uncaughtException", error);
});

process.on("unhandledRejection", (error) => {
  writeEarlyFailure("unhandledRejection", error);
});

try {
  globalThis.__bayanFlowElectron = require("electron");
} catch (error) {
  writeEarlyFailure("require.electron.failed", error);
}

import("./main.js").catch((error) => {
  writeEarlyFailure("import.main.failed", error);
  process.exitCode = 1;
});
