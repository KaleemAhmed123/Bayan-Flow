import { build } from "esbuild";
import { stat } from "node:fs/promises";
import path from "node:path";

const stub = path.resolve("scripts/empty-module.js");

/**
 * Native addons must stay real files inside node_modules.
 * uiohook-napi resolves its .node through node-gyp-build(join(__dirname, "..")),
 * and libnut-win32 through bindings("libnut"). Both walk the filesystem from
 * their own directory, so inlining their JS into dist/ breaks that lookup.
 */
const external = ["electron", "uiohook-napi", "@nut-tree-fork/libnut-win32"];

/**
 * Reachable from nut-js's require graph, never called by BayanFlow.
 *
 * - jimp: nut-js/dist/index.js pulls in lib/imageResources.function.js, which
 *   requires jimp at module load. We only use its keyboard and window APIs, so
 *   the 10.9 MB of image codecs is dead weight.
 * - default-clipboard-provider: nut-js registers it eagerly at import time, so
 *   stubbing alone is not enough. NUT_JS_DISABLE_DEFAULT_CLIPBOARD_PROVIDER is
 *   nut-js's own off-switch and stops that registration. We paste through
 *   Electron's clipboard, so nothing else needs it.
 *
 * The stub is deliberately an empty object rather than a constructible class:
 * if anything ever does reach for one of these, it should fail loudly at
 * startup rather than quietly register a provider that does nothing.
 */
const alias = {
  jimp: stub,
  "@nut-tree-fork/default-clipboard-provider": stub,
};

/**
 * esbuild leaves external CJS packages as bare require() calls, but an ESM
 * module has no require in scope, so libnut-win32 would throw at load time.
 * createRequire resolves relative to dist/, which is inside the asar.
 */
const banner = [
  'import { createRequire as __nodeCreateRequire } from "node:module";',
  "const require = __nodeCreateRequire(import.meta.url);",
  'process.env.NUT_JS_DISABLE_DEFAULT_CLIPBOARD_PROVIDER ??= "1";',
].join("\n");

await build({
  entryPoints: ["dist/main.js"],
  outfile: "dist/main.bundle.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  minify: true,
  legalComments: "none",
  external,
  alias,
  banner: { js: banner },
});

const { size } = await stat("dist/main.bundle.js");
console.log(`bundled dist/main.bundle.js (${(size / 1024).toFixed(0)} KB)`);
