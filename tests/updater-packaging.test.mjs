import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pkg = JSON.parse(await readFile("package.json", "utf8"));

test("electron-updater is a runtime dependency, not a dev one", async () => {
  // It has to be inside the packaged app. In devDependencies it would build fine
  // and be missing at runtime for every user.
  assert.ok(pkg.dependencies?.["electron-updater"], "electron-updater must be in dependencies");
  assert.equal(pkg.devDependencies?.["electron-updater"], undefined);
});

test("electron-updater stays out of the esbuild bundle", async () => {
  // It lazy-requires js-yaml and builder-util-runtime and reads its own
  // package.json at runtime, none of which survives being inlined.
  const bundler = await readFile("scripts/bundle-main.mjs", "utf8");
  assert.match(bundler, /const external = \[[^\]]*"electron-updater"/s);
});

test("the updater is imported through the CJS interop shim, not as a named export", async () => {
  // The exact failure this guards against, caught by packaged:smoke and invisible
  // to every other check:
  //   SyntaxError: Named export 'autoUpdater' not found. The requested module
  //   'electron-updater' is a CommonJS module...
  // The bundle is ESM and electron-updater is external CommonJS, so the named
  // form throws at startup in the packaged app while working fine in dev.
  const source = await readFile("src/updater.ts", "utf8");
  assert.equal(
    /^import \{[^}]*\} from "electron-updater"/m.test(source),
    false,
    "a named import from electron-updater breaks the packaged app",
  );
  assert.match(source, /import \* as \w+ from "electron-updater"/);
  assert.match(source, /\.default \?\? /, "must unwrap the interop default");
});

test("the installer filename matches what the update manifest asks for", async () => {
  // latest.yml refers to the artifact by name. The electron-builder default
  // ("BayanFlow Setup 0.2.0.exe", with spaces) does not match what the manifest
  // writes ("BayanFlow-Setup-0.2.0.exe"), so a hand-uploaded release 404s on
  // every update check.
  assert.equal(pkg.build.artifactName, "${productName}-Setup-${version}.${ext}");
});

test("update signature verification is explicitly off while the app is unsigned", async () => {
  // Defaults to true, which compares the downloaded installer's Authenticode
  // signature against a publisher name. This build is not signed, so leaving the
  // default on would fail every install. Turn this back on when signing lands.
  assert.equal(pkg.build.win.verifyUpdateCodeSignature, false);
  assert.equal(pkg.build.win.signExecutable, false, "the two must agree about signing");
});

test("publishing is deliberate, never a side effect of building", async () => {
  assert.match(pkg.scripts.dist, /--publish never/);
  assert.match(pkg.scripts.release, /--publish always/);
});

test("the publish target names the public repo the updater reads", async () => {
  const publish = Array.isArray(pkg.build.publish) ? pkg.build.publish[0] : pkg.build.publish;
  assert.equal(publish.provider, "github");
  assert.equal(publish.owner, "KaleemAhmed123");
  assert.equal(publish.repo, "Bayan-Flow");
});
