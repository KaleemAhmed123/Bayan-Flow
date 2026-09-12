import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

for (const file of ["dock.html", "recorder.html", "settings.html"]) {
  test(`${file} uses external renderer assets and strict CSP`, async () => {
    const html = await readFile(path.join("src", "renderer", file), "utf8");
    assert.equal(html.includes("unsafe-inline"), false);
    assert.equal(/<script(?![^>]*\bsrc=)/i.test(html), false);
    assert.equal(/<style[\s>]/i.test(html), false);
  });
}

test("dock css preserves hidden state above display utilities", async () => {
  const css = await readFile(path.join("src", "renderer", "dock.css"), "utf8");
  assert.match(css, /\[hidden\]\s*{[^}]*display:\s*none\s*!important;[^}]*}/s);
});

test("dock and settings both build on the shared token file", async () => {
  for (const file of ["dock.html", "settings.html"]) {
    const html = await readFile(path.join("src", "renderer", file), "utf8");
    assert.match(html, /href="\.\/tokens\.css"/);
  }
});

test("the dock size has exactly one owner", async () => {
  // The defect this guards against: the old status overlay set its window size in
  // TypeScript while CSS sized the card independently, and the two disagreed in
  // every state (worst case a 156px card inside a 304px window).
  //
  // The rule now is that CSS owns the size, the renderer measures it, and the
  // main process only positions what it is told. So overlay-dock.ts must resize
  // from the measured value and from nothing else.
  const dockSource = await readFile(path.join("src", "overlay", "overlay-dock.ts"), "utf8");

  // The hand-written tween is gone, so the rule is now stricter than it was:
  // there is exactly one setBounds in the file and it lives inside applyBounds.
  const start = dockSource.indexOf("private applyBounds(");
  const end = dockSource.indexOf("private workAreaForSession(");
  assert.ok(start > -1 && end > start, "expected applyBounds before workAreaForSession");

  const applyBounds = dockSource.slice(start, end);
  const total = (dockSource.match(/\.setBounds\(/g) ?? []).length;
  const inside = (applyBounds.match(/\.setBounds\(/g) ?? []).length;

  assert.equal(total, 1, "the dock must position itself in exactly one place");
  assert.equal(inside, total, "every setBounds call must live inside applyBounds");

  // No timer may drive geometry. An animated resize on an always-on-top window
  // steals focus from the app being typed into, which is the bug that removed it.
  assert.equal(/setInterval\(/.test(applyBounds), false, "applyBounds must not animate");
  assert.match(dockSource, /clampDockSize\(this\.lastSize, workArea\)/, "size must come from the measured value");
  assert.equal(/\.setSize\(/.test(dockSource), false, "no second sizing path");

  // CSS is the owner, so it is the one place a pixel width may appear.
  const css = await readFile(path.join("src", "renderer", "dock.css"), "utf8");
  assert.match(/\.dock\s*{([^}]*)}/s.exec(css)?.[1] ?? "", /width:\s*\d+px/);
});

test("the dock reports its own measured size to the main process", async () => {
  const js = await readFile(path.join("src", "renderer", "dock.js"), "utf8");
  assert.match(js, /getBoundingClientRect\(\)/);
  assert.match(js, /reportSize\(\{ width, height \}\)/);
  assert.match(js, /new ResizeObserver\(/);
});
