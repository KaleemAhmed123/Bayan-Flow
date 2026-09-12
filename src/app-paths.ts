import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolved from this module's own location, which is dist/ both when tsc emits
 * one file per module and when esbuild collapses them into dist/main.bundle.js.
 *
 * Modules in subfolders must not work these out themselves. Bundling moves their
 * code to dist/, so a hand-written "../renderer" that was right in dist/overlay/
 * silently starts pointing outside the app.
 */
const distDir = path.dirname(fileURLToPath(import.meta.url));

export const rendererDir = path.join(distDir, "renderer");
export const assetsDir = path.join(distDir, "assets");

/**
 * Where in-flight recordings are written before upload.
 *
 * Named "whispr-clone" until 0.2.0 — a leftover from before the product had a
 * name, which shipped in %TEMP% and in every exported diagnostics.json. Nothing
 * was broken by it; it just read badly for an unsigned app people had granted
 * microphone access to.
 */
export const TEMP_AUDIO_DIR_NAME = "bayanflow";

/** The old name, still swept at startup so upgraders do not keep orphaned audio. */
export const LEGACY_TEMP_AUDIO_DIR_NAMES = ["whispr-clone"];
