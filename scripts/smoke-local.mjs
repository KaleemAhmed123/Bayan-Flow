import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import electronPath from "electron";
import os from "node:os";
import path from "node:path";

const userDataDir = await mkdtemp(path.join(os.tmpdir(), "bayanflow-local-smoke-"));
const logPath = path.join(userDataDir, "logs", "app.log");
const env = { ...process.env, BAYANFLOW_USER_DATA_DIR: userDataDir };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ["."], {
  env,
  stdio: "inherit",
  windowsHide: true,
});

const timeout = setTimeout(() => {
  if (!child.killed) {
    child.kill();
  }
  void finishSuccess();
}, 8_000);

child.on("exit", (code, signal) => {
  clearTimeout(timeout);
  if (signal) {
    process.exit(0);
  }

  console.error(`Local smoke failed: Electron exited early with code ${code ?? "unknown"}.`);
  process.exit(code ?? 1);
});

async function finishSuccess() {
  const log = await readFile(logPath, "utf8").catch(() => "");
  await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
  if (!log.includes('"event":"app.startup.success"')) {
    console.error("Local smoke failed: startup success log was not written.");
    process.exit(1);
  }

  console.log("Local smoke passed: Electron stayed alive for 8 seconds and wrote startup log.");
}
