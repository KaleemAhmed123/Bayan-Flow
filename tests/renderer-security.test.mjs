import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

for (const file of ["recorder.html", "settings.html", "status.html"]) {
  test(`${file} uses external renderer assets and strict CSP`, async () => {
    const html = await readFile(path.join("src", "renderer", file), "utf8");
    assert.equal(html.includes("unsafe-inline"), false);
    assert.equal(/<script(?![^>]*\bsrc=)/i.test(html), false);
    assert.equal(/<style[\s>]/i.test(html), false);
  });
}
