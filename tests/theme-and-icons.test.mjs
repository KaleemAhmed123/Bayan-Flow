import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/*
 * Static guards for the theme and the icon.
 *
 * None of this is reachable from the unit suite: a stylesheet regression looks
 * like a colour nobody notices until a screenshot, and a broken .ico only shows
 * up in the tray of an installed build. Both failures are cheap to assert about
 * and expensive to discover late, which is the same reasoning behind
 * updater-packaging.test.mjs.
 */

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const readSrc = (rel) => readFile(path.join(root, rel), "utf8");
const readBin = (rel) => readFile(path.join(root, rel));

const ICON = "src/assets/tray-icon.ico";
const EXPECTED_SIZES = [16, 20, 24, 32, 48, 64, 256];

/** Parse an .ico directory. Format: 6-byte header, then 16 bytes per entry. */
function readIconDirectory(buffer) {
  assert.equal(buffer.readUInt16LE(0), 0, "reserved field must be zero");
  assert.equal(buffer.readUInt16LE(2), 1, "type must be 1, meaning icon");

  const count = buffer.readUInt16LE(4);
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    const at = 6 + i * 16;
    const offset = buffer.readUInt32LE(at + 12);
    const length = buffer.readUInt32LE(at + 8);
    entries.push({
      // A stored 0 means 256: the field is one byte and 256 does not fit.
      width: buffer.readUInt8(at) || 256,
      height: buffer.readUInt8(at + 1) || 256,
      bitCount: buffer.readUInt16LE(at + 6),
      offset,
      length,
      isPng: buffer.subarray(offset, offset + 8).equals(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    });
  }
  return entries;
}

test("the app icon carries every size Windows asks for, not one image to downscale", async () => {
  const entries = readIconDirectory(await readBin(ICON));

  assert.deepEqual(
    entries.map((entry) => entry.width),
    EXPECTED_SIZES,
    "a single-size .ico is the bug this file exists to prevent: Windows shrinks 256px to 16px and the mark turns to mush",
  );
  for (const entry of entries) {
    assert.equal(entry.width, entry.height, "every entry must be square");
    assert.equal(entry.bitCount, 32, "32bpp, so the icon keeps its alpha");
  }
});

/**
 * Walk the centre column of one uncompressed 32bpp icon entry.
 *
 * The centre column is where the pill is at full height and the lamp is not in
 * the way, so it measures two useful things at once: how tall the pill is, and
 * whether its top and bottom edges land on whole pixels. A "blended" row is one
 * that is neither tile nor pill but a grey average of the two — the signature of
 * geometry that straddles a half pixel and came out soft.
 */
function scanCentreColumn(buffer, entry) {
  const dib = buffer.subarray(entry.offset, entry.offset + entry.length);
  const width = dib.readInt32LE(4);
  // biHeight counts the colour bitmap and the 1bpp mask together.
  const height = dib.readInt32LE(8) / 2;
  const pixels = dib.subarray(dib.readUInt32LE(0));
  const centre = Math.floor(width / 2);

  let solid = 0;
  let blended = 0;
  for (let y = 0; y < height; y += 1) {
    // Stored BGRA. The pill is the only near-white thing in the mark.
    const value = pixels[(y * width + centre) * 4];
    if (value > 200) solid += 1;
    else if (value > 60) blended += 1;
  }
  return { ratio: solid / height, blended };
}

test("the small sizes are drawn thicker, not shrunk from the big one", async () => {
  const buffer = await readBin(ICON);
  const entries = readIconDirectory(buffer);
  const at = (size) =>
    scanCentreColumn(buffer, entries.find((entry) => entry.width === size));

  // A plain downscale hands every size the same ratio. The small entries are
  // deliberately fatter so the lamp keeps enough pixels to read as a lamp.
  assert.ok(
    at(16).ratio > at(48).ratio + 0.05,
    `the 16px pill fills ${(at(16).ratio * 100).toFixed(0)}% of its tile and the 48px one ${(at(48).ratio * 100).toFixed(0)}%; if those match, the small sizes are resized copies rather than drawn`,
  );
  assert.ok(
    at(48).ratio > 0.15 && at(48).ratio < 0.4,
    "the large pill should stay near a quarter of the tile",
  );
});

test("no icon size has a soft edge from landing on a half pixel", async () => {
  const buffer = await readBin(ICON);
  const entries = readIconDirectory(buffer);

  for (const entry of entries) {
    if (entry.isPng) continue;
    const { blended } = scanCentreColumn(buffer, entry);
    assert.equal(
      blended,
      0,
      `the ${entry.width}px entry has ${blended} blended row(s): its geometry does not land on whole pixels, so the pill edge renders grey instead of sharp`,
    );
  }
});

test("small icon entries stay uncompressed, because NSIS will not read PNG ones", async () => {
  const entries = readIconDirectory(await readBin(ICON));

  for (const entry of entries) {
    if (entry.width <= 64) {
      assert.equal(
        entry.isPng,
        false,
        `the ${entry.width}px entry is PNG-compressed; NSIS does not reliably decode those for an installer icon`,
      );
    }
  }
  assert.equal(
    entries.at(-1).isPng,
    true,
    "the 256px entry should be PNG, or the file grows by a quarter of a megabyte for nothing",
  );
});

test("the installer icon matches the app icon rather than being separate artwork", async () => {
  const app = readIconDirectory(await readBin(ICON));
  const installer = readIconDirectory(await readBin("build/installerHeaderIcon.ico"));

  const appBuf = await readBin(ICON);
  const insBuf = await readBin("build/installerHeaderIcon.ico");
  const payload = (buf, entry) =>
    buf.subarray(entry.offset, entry.offset + entry.length).toString("base64");

  for (const size of [16, 32, 48]) {
    const a = app.find((entry) => entry.width === size);
    const b = installer.find((entry) => entry.width === size);
    assert.ok(a && b, `both icons should carry a ${size}px entry`);
    assert.equal(
      payload(appBuf, a),
      payload(insBuf, b),
      `the ${size}px installer icon differs from the app icon; they drifted apart once already`,
    );
  }
});

test("the installer header stays light, because NSIS draws its header bar light", async () => {
  const bmp = await readBin("build/installerHeader.bmp");

  // BITMAPFILEHEADER is 14 bytes; the pixel offset lives at byte 10. Rows are
  // bottom-up, so the first pixel read is the bottom-left corner.
  const pixels = bmp.readUInt32LE(10);
  const [blue, green, red] = [bmp[pixels], bmp[pixels + 1], bmp[pixels + 2]];

  for (const channel of [red, green, blue]) {
    assert.ok(
      channel > 200,
      `the header's corner is dark (${red},${green},${blue}); it will float as a black rectangle in the installer's light header bar`,
    );
  }
});

test("the violet theme is fully gone, with no stray accent left behind", async () => {
  const files = ["src/renderer/tokens.css", "src/renderer/dock.css", "src/renderer/settings.css"];

  for (const file of files) {
    const css = await readSrc(file);
    for (const violet of ["#7c6aff", "#8f80ff", "124, 106, 255"]) {
      assert.ok(
        !css.toLowerCase().includes(violet),
        `${file} still contains ${violet}; the palette is meant to have no accent hue at all`,
      );
    }
  }
});

test("colour lives only in tokens.css, so the theme stays swappable", async () => {
  for (const file of ["src/renderer/dock.css", "src/renderer/settings.css"]) {
    const css = await readSrc(file);
    const hexes = css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    assert.deepEqual(
      hexes,
      [],
      `${file} hardcodes ${hexes.join(", ")}; every colour must come from a token or the next theme change misses it`,
    );
  }
});

test("the token set keeps the pieces the stylesheets depend on", async () => {
  const css = await readSrc("src/renderer/tokens.css");

  for (const token of ["--bf-accent", "--bf-live", "--bf-font", "--bf-font-mono", "--bf-hit"]) {
    assert.ok(css.includes(`${token}:`), `tokens.css is missing ${token}`);
  }

  // The accent is paper-white and the label on it is near-black. If these ever
  // swap back to a coloured fill, the theme has quietly been undone.
  assert.match(css, /--bf-accent:\s*#e7e7e3;/);
  assert.match(css, /--bf-accent-text:\s*#08080a;/);
  assert.match(css, /--bf-live:\s*#3fe08a;/);
});

test("only the rewrite chips go under the comfortable click target", async () => {
  const css = await readSrc("src/renderer/dock.css");

  assert.match(
    css,
    /\.btn-compact\s*\{[^}]*min-height:\s*28px;/,
    "the chips should be 28px, the one deliberate exception",
  );
  assert.match(
    css,
    /\.btn\s*\{[^}]*min-height:\s*var\(--bf-hit\);/,
    "every other button must keep the full target height",
  );

  const hit = await readSrc("src/renderer/tokens.css");
  assert.match(hit, /--bf-hit:\s*32px;/, "the comfort floor itself must not be lowered");
});

test("no stylesheet loads an image, because the renderer CSP forbids it", async () => {
  // Learned the hard way: the checkbox tick was first written as an inline
  // `url("data:image/svg+xml,...")`. It looked right in the stylesheet and drew
  // absolutely nothing in the app, because both renderer pages set
  // `img-src 'self'` and a data: URI is not 'self'. The rule failed silently —
  // no layout shift, no error unless the console was open.
  for (const file of ["src/renderer/tokens.css", "src/renderer/dock.css", "src/renderer/settings.css"]) {
    const css = await readSrc(file);
    const matches = css.match(/url\(\s*["']?(data:|https?:)/g) ?? [];
    assert.deepEqual(
      matches,
      [],
      `${file} loads an image through url(); the pages' Content-Security-Policy is img-src 'self', so it will render nothing at all`,
    );
  }
});

test("the first-run view exists and every control it scripts is in the markup", async () => {
  const html = await readSrc("src/renderer/settings.html");
  const js = await readSrc("src/renderer/settings.js");

  assert.match(html, /id="page-firstrun"/, "the first-run page is missing");

  // settings.js attaches listeners by id without null-checking; a renamed or
  // deleted element throws during load and takes the whole window down.
  const ids = [...js.matchAll(/getElementById\("(fr_[a-zA-Z]+|stepRail|step-[a-z]+)"\)/g)].map((m) => m[1]);
  assert.ok(ids.length > 0, "expected the first-run controller to look up elements by id");

  for (const id of new Set(ids)) {
    assert.ok(
      html.includes(`id="${id}"`),
      `settings.js looks up #${id} but settings.html has no such element; the listener would throw on load`,
    );
  }
});

test("first run never becomes a permanent page in the sidebar", async () => {
  const html = await readSrc("src/renderer/settings.html");

  // It is meant to vanish once setup is done. A nav entry would make it a place
  // you can go back to, which is the opposite of the agreed behaviour.
  assert.ok(
    !html.includes('data-page="firstrun"'),
    "first run has a sidebar entry; it is supposed to disappear permanently once setup is complete",
  );
});

test("every searchable settings row type is in both search selectors", async () => {
  const js = await readSrc("src/renderer/settings.js");

  // Settings search keeps two lists: one prebuilt for resetting, one queried per
  // card while filtering. They must agree. When .byok was added to only the
  // filter loop, searching "microphone" hid every real row in the Connection
  // card and left the BYOK note floating there by itself.
  const selectors = [...js.matchAll(/querySelectorAll\("((?:\.[a-z-]+,\s*)+\.[a-z-]+)"\)/g)]
    .map((match) => match[1])
    .filter((selector) => selector.includes(".field") && selector.includes(".toggle"));

  assert.ok(selectors.length >= 2, "expected both the reset list and the filter loop to select rows");

  const normalise = (selector) => selector.split(",").map((part) => part.trim()).sort().join(",");
  const [first, ...rest] = selectors.map(normalise);
  for (const other of rest) {
    assert.equal(
      other,
      first,
      "the settings search row selectors disagree; a row type in one but not the other either never resets or never filters",
    );
  }
});

test("the BYOK note explains the acronym and does not overclaim", async () => {
  const html = await readSrc("src/renderer/settings.html");

  const notes = [...html.matchAll(/<div class="byok"[\s\S]*?<\/div>/g)].map((m) => m[0]);
  assert.ok(notes.length >= 2, "expected the BYOK note on first run and in Connection settings");

  for (const note of notes) {
    assert.match(
      note,
      /Bring your own key/i,
      "the acronym must never appear without the plain-English phrase next to it",
    );

    // BYOK means "your key, your account, no middleman". It does NOT mean the
    // audio stays on the machine, and saying so would be a false privacy claim
    // that contradicts the Privacy tab.
    for (const overclaim of ["never leaves", "stays on your PC", "fully local", "offline", "no data is sent"]) {
      assert.ok(
        !note.toLowerCase().includes(overclaim.toLowerCase()),
        `the BYOK note claims "${overclaim}"; audio is still sent to Groq, and implying otherwise is false`,
      );
    }
  }
});
