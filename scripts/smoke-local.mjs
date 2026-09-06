import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import electronPath from "electron";
import os from "node:os";
import path from "node:path";

const userDataDir = await mkdtemp(path.join(os.tmpdir(), "bayanflow-local-smoke-"));
const logPath = path.join(userDataDir, "logs", "app.log");
// Makes the dock capture its own pixels after each view so this smoke test can
// prove it actually renders. A blank dock is invisible to every other check:
// the window still reports visible:true with correct bounds.
const env = { ...process.env, BAYANFLOW_USER_DATA_DIR: userDataDir, BAYANFLOW_DOCK_CAPTURE: "1" };
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

  const captures = log
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((entry) => entry?.event === "dock.capture");

  if (captures.length === 0) {
    console.error("Local smoke failed: the dock never reported a rendered frame.");
    process.exit(1);
  }

  const blank = captures.filter((entry) => entry.fields?.isBlank);
  if (blank.length > 0) {
    console.error(
      `Local smoke failed: the dock rendered ${blank.length} blank frame(s) ` +
        `(${blank.map((entry) => entry.fields.kind).join(", ")}). ` +
        "The window is visible and correctly sized but paints nothing.",
    );
    process.exit(1);
  }

  console.log(
    `Local smoke passed: Electron stayed alive for 8 seconds, wrote startup log, ` +
      `and painted ${captures.length} non-blank dock frame(s).`,
  );
}
