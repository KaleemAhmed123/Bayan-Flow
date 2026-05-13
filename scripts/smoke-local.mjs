import { spawn } from "node:child_process";
import electronPath from "electron";

const env = { ...process.env };
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
  console.log("Local smoke passed: Electron stayed alive for 8 seconds.");
}, 8_000);

child.on("exit", (code, signal) => {
  clearTimeout(timeout);
  if (signal) {
    process.exit(0);
  }

  console.error(`Local smoke failed: Electron exited early with code ${code ?? "unknown"}.`);
  process.exit(code ?? 1);
});
