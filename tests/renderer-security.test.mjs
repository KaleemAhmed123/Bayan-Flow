import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

for (const file of ["input-assist.html", "recorder.html", "settings.html", "status.html"]) {
  test(`${file} uses external renderer assets and strict CSP`, async () => {
    const html = await readFile(path.join("src", "renderer", file), "utf8");
    assert.equal(html.includes("unsafe-inline"), false);
    assert.equal(/<script(?![^>]*\bsrc=)/i.test(html), false);
    assert.equal(/<style[\s>]/i.test(html), false);
  });
}

test("input assist css preserves hidden state above display utilities", async () => {
  const css = await readFile(path.join("src", "renderer", "input-assist.css"), "utf8");
  assert.match(css, /\[hidden\]\s*{[^}]*display:\s*none\s*!important;[^}]*}/s);
});

test("input assist panel is draggable without stealing control clicks", async () => {
  const css = await readFile(path.join("src", "renderer", "input-assist.css"), "utf8");
  assert.match(css, /\.panel\s*{[^}]*-webkit-app-region:\s*drag;[^}]*}/s);
  assert.match(css, /button,\s*[\r\n]+input,\s*[\r\n]+textarea,[^}]*-webkit-app-region:\s*no-drag;[^}]*}/s);
});
