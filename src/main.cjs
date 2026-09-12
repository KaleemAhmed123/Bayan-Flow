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

/**
 * Where the log the dialog points at actually lives.
 * Kept in step with writeEarlyFailure above.
 */
function earlyLogPath() {
  return path.join(process.env.APPDATA || os.tmpdir(), "BayanFlow", "logs", "early-startup.log");
}

/**
 * Tells the user the app could not start, then exits.
 *
 * Everything below this point runs before any window, tray icon or logger
 * exists, so without a dialog the only symptom is a double-click that does
 * nothing at all — no window, no error, nothing in the tray. The log explains it
 * perfectly, in a folder the user has no reason to know about and no menu to
 * reach, because the menu never appeared.
 *
 * The likeliest real cause is antivirus quarantining `uiohook-napi`. It installs
 * a low-level Windows keyboard hook, which is the same API a keylogger uses, and
 * BayanFlow is unsigned — so it is exactly the shape AV heuristics flag. The
 * hook is not optional, it is the product, so the honest answer is to say what
 * happened rather than to degrade silently.
 *
 * showErrorBox is documented as safe to call before the app "ready" event.
 */
function reportFatalStartupFailure(error) {
  writeEarlyFailure("import.main.failed", error);
  process.exitCode = 1;

  const electron = globalThis.__bayanFlowElectron;
  const message = String(error?.message || error);
  // A missing or blocked native module reports itself in a handful of shapes.
  const looksLikeBlockedNativeModule =
    /uiohook|libnut|\.node\b|MODULE_NOT_FOUND|dynamic link library|specified module could not be found/i.test(message);

  const detail = looksLikeBlockedNativeModule
    ? [
        "BayanFlow could not load the component it uses to watch for your hotkey.",
        "",
        "This is almost always antivirus or endpoint security quarantining the file.",
        "BayanFlow installs a global keyboard hook so the hotkey works in any app,",
        "and security software often blocks that in unsigned programs.",
        "",
        "To fix it: allow BayanFlow in your antivirus, then reinstall.",
        "",
        `Details were written to:\n${earlyLogPath()}`,
      ].join("\n")
    : [
        "BayanFlow could not start.",
        "",
        `Details were written to:\n${earlyLogPath()}`,
        "",
        message,
      ].join("\n");

  try {
    electron?.dialog?.showErrorBox("BayanFlow could not start", detail);
  } catch {
    // A dialog we cannot show must not replace the exit code with a crash.
  }

  try {
    electron?.app?.exit(1);
  } catch {
    process.exit(1);
  }
}

import("./main.bundle.js").catch(reportFatalStartupFailure);
