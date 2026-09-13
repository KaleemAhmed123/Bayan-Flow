import * as electronUpdaterModule from "electron-updater";
import { app } from "./electron.js";

/**
 * electron-updater is CommonJS and stays external to the esbuild bundle, which
 * is ESM. A named import therefore fails at runtime in the packaged app with
 * "Named export 'autoUpdater' not found" — caught by `npm run packaged:smoke`,
 * which is the only check that runs the real bundle. Unwrapping the interop
 * default is the same thing `src/electron.ts` does for `electron` itself.
 */
const { autoUpdater } = (electronUpdaterModule as typeof import("electron-updater") & {
  default?: typeof import("electron-updater");
}).default ?? electronUpdaterModule;
import { logger } from "./observability/logger.js";
import { normalizeError } from "./observability/errors.js";

/**
 * Background updates from GitHub Releases.
 *
 * The repository is public, so no token is embedded in the app and the update
 * check is an anonymous HTTPS request. `app-update.yml` is written into the
 * package by electron-builder from the `publish` block, which is what tells the
 * updater where to look.
 *
 * SECURITY NOTE, READ BEFORE CHANGING `verifyUpdateCodeSignature`.
 *
 * That option defaults to TRUE, and it would break every update here: it
 * compares the Authenticode signature of the downloaded installer against the
 * publisher name baked in at build time, and BayanFlow is not code signed, so
 * there is no signature to compare. It is therefore switched off in the build
 * config, and what remains protecting an update is HTTPS to GitHub plus the
 * SHA-512 in the release metadata. That is honest for a private beta among
 * people who know the author. It is NOT enough for public distribution: sign the
 * builds and turn verification back on before this goes further than friends.
 */

/** First check. Late enough that it never competes with the first dictation. */
const FIRST_CHECK_DELAY_MS = 45_000;
/** Then once every few hours. A tray app can run for weeks without restarting. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;

export type UpdaterCallbacks = {
  /** An update is downloaded and will install on quit. */
  onReady: (version: string) => void;
  /** True while a dictation is mid-flight, so a restart prompt can wait. */
  isBusy: () => boolean;
};

let downloadedVersion = "";
let timer: NodeJS.Timeout | null = null;

/** Version sitting on disk waiting to install, or "" when there is none. */
export function pendingUpdateVersion(): string {
  return downloadedVersion;
}

export function startUpdater(callbacks: UpdaterCallbacks): void {
  // In development the app is not packaged, there is no app-update.yml, and the
  // updater throws rather than no-opping. Nothing to do.
  if (!app.isPackaged) {
    void logger.info("updater.skipped_unpackaged");
    return;
  }

  autoUpdater.autoDownload = true;
  // Installing on quit rather than mid-session: the user is dictating into other
  // applications, and swapping the binary underneath them is never urgent enough
  // to justify interrupting that.
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;

  autoUpdater.on("checking-for-update", () => void logger.info("updater.checking"));

  autoUpdater.on("update-available", (info) => {
    void logger.info("updater.available", { version: info?.version });
  });

  autoUpdater.on("update-not-available", () => void logger.info("updater.up_to_date"));

  autoUpdater.on("update-downloaded", (info) => {
    downloadedVersion = String(info?.version ?? "");
    void logger.info("updater.downloaded", { version: downloadedVersion });
    // Telling somebody mid-sentence that a restart is available is exactly the
    // interruption this app exists to avoid. The tray entry is always there, so
    // nothing is lost by staying quiet until they are idle.
    if (!callbacks.isBusy()) {
      callbacks.onReady(downloadedVersion);
    }
  });

  autoUpdater.on("error", (error) => {
    // An update that cannot be fetched is not a problem the user can act on, and
    // a tray app that nags about its own updater is worse than one that is
    // quietly a version behind. Logged only.
    void logger.warn("updater.failed", { error: normalizeError("startup", error) });
  });

  timer = setTimeout(() => {
    void check();
    timer = setInterval(() => void check(), CHECK_INTERVAL_MS);
  }, FIRST_CHECK_DELAY_MS);
}

/** Checks now. Never throws: a failed check must not reach the dictation path. */
export async function check(): Promise<void> {
  if (!app.isPackaged) {
    return;
  }

  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    void logger.warn("updater.check_failed", { error: normalizeError("startup", error) });
  }
}

/** Quits and installs the downloaded update. No-op when nothing is waiting. */
export function installNow(): void {
  if (!downloadedVersion) {
    return;
  }

  void logger.info("updater.installing", { version: downloadedVersion });
  // `isSilent: false` on purpose. The installer is the assisted NSIS one
  // (`oneClick: false`), so a silent install is not what the user gets anyway,
  // and showing the wizard makes it obvious what is happening to an unsigned app
  // that Windows already warns about.
  autoUpdater.quitAndInstall(false, true);
}

export function stopUpdater(): void {
  if (!timer) {
    return;
  }

  clearTimeout(timer);
  clearInterval(timer);
  timer = null;
}
