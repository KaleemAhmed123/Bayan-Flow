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
