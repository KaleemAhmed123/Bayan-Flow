import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const exePath = path.resolve("release", "win-unpacked", "BayanFlow.exe");

if (!existsSync(exePath)) {
  console.error(`Packaged smoke failed: ${exePath} does not exist.`);
  process.exit(1);
}

const userDataDir = await mkdtemp(path.join(os.tmpdir(), "bayanflow-packaged-smoke-"));
const logPath = path.join(userDataDir, "logs", "app.log");
const env = {
  ...process.env,
  BAYANFLOW_USER_DATA_DIR: userDataDir,
};
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(exePath, [], {
  env,
  stdio: "ignore",
  windowsHide: true,
});

const timeoutAt = Date.now() + 15_000;
let passed = false;

try {
  while (Date.now() < timeoutAt) {
    const log = await readFile(logPath, "utf8").catch(() => "");
    if (log.includes('"event":"app.startup.success"')) {
      passed = true;
      break;
    }

    if (log.includes('"event":"app.startup.failed"')) {
      break;
    }

    await sleep(500);
  }
} finally {
  if (!child.killed) {
    child.kill();
  }
}

if (!passed) {
  const log = await readFile(logPath, "utf8").catch(() => "");
  console.error("Packaged smoke failed: startup success log was not written.");
  if (log) {
    console.error(log.split(/\r?\n/).filter(Boolean).slice(-5).join("\n"));
  }
  await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
  process.exit(1);
}

await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
console.log("Packaged smoke passed: startup success log found.");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
