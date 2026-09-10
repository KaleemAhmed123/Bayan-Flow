import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { HistoryStore, countWords, dayKey, summarize } from "../dist/history/history-store.js";

const DAY_MS = 86_400_000;

async function tempStore() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "bayanflow-history-"));
  const file = path.join(dir, "history.jsonl");
  return { store: new HistoryStore(file), file };
}

function entry(overrides = {}) {
  return {
    id: `id-${Math.random().toString(36).slice(2)}`,
    at: Date.now(),
    seconds: 30,
    words: 60,
    chars: 300,
    app: "Notepad",
    raw: "raw",
    polished: "polished",
    ...overrides,
  };
}

test("an appended dictation comes back with counts filled in", async () => {
  const { store } = await tempStore();

  const saved = await store.append({
    seconds: 12.4,
    app: "Visual Studio Code",
    raw: "um so the thing is",
    polished: "So the thing is.",
  });

  assert.equal(saved.words, 4);
  assert.equal(saved.seconds, 12, "seconds are rounded, not stored as a float");
  assert.equal(saved.app, "Visual Studio Code");

  const listed = await store.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].raw, "um so the thing is");
  assert.equal(listed[0].polished, "So the thing is.");
});

test("empty text is never stored", async () => {
  const { store } = await tempStore();

  assert.equal(await store.append({ seconds: 1, app: "", raw: "", polished: "   " }), null);
  assert.deepEqual(await store.list(), []);
});

test("history reads newest first and can delete one entry or all of them", async () => {
  const { store } = await tempStore();

  const first = await store.append({ seconds: 5, app: "A", raw: "one", polished: "one" });
  const second = await store.append({ seconds: 5, app: "B", raw: "two", polished: "two" });

  const listed = await store.list();
  assert.deepEqual(
    listed.map((item) => item.polished),
    ["two", "one"],
    "newest first",
  );

  await store.remove(first.id);
  assert.deepEqual((await store.list()).map((item) => item.id), [second.id]);

  await store.clear();
  assert.deepEqual(await store.list(), []);
});

test("a torn final line from a crash does not lose the rest of the file", async () => {
  const { store, file } = await tempStore();

  await store.append({ seconds: 5, app: "A", raw: "kept", polished: "kept" });
  await writeFile(file, `${await readFile(file, "utf8")}{"id":"broken","at":`, "utf8");

  const listed = await store.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].polished, "kept");
});

test("the file is capped at the newest MAX_ENTRIES rows", async () => {
  const { store, file } = await tempStore();

  // Writing 505 rows by hand is far faster than 505 appends and exercises the
  // same trim path on the next append.
  const rows = [];
  for (let index = 0; index < 505; index += 1) {
    rows.push(JSON.stringify(entry({ id: `old-${index}`, at: 1_000 + index, polished: `row ${index}` })));
  }
  await writeFile(file, `${rows.join("\n")}\n`, "utf8");

  await store.append({ seconds: 1, app: "A", raw: "newest", polished: "newest" });

  const listed = await store.list();
  assert.equal(listed.length, 500);
  assert.equal(listed[0].polished, "newest", "the newest row survives");
  assert.equal(
    listed.some((item) => item.id === "old-0"),
    false,
    "the oldest rows are the ones dropped",
  );
});

test("word counting ignores extra whitespace", () => {
  assert.equal(countWords(""), 0);
  assert.equal(countWords("   "), 0);
  assert.equal(countWords("one"), 1);
  assert.equal(countWords("  two   words \n here "), 3);
});

test("stats add up and compare against typing at 40 wpm", () => {
  const now = new Date(2026, 8, 7, 12, 0, 0).getTime();
  const stats = summarize(
    [
      entry({ at: now, seconds: 60, words: 120, chars: 600, app: "Notepad" }),
      entry({ at: now - DAY_MS, seconds: 60, words: 80, chars: 400, app: "Notepad" }),
      entry({ at: now - DAY_MS, seconds: 60, words: 40, chars: 200, app: "Brave" }),
    ],
    now,
  );

  assert.equal(stats.entries, 3);
  assert.equal(stats.words, 240);
  assert.equal(stats.chars, 1200);
  assert.equal(stats.seconds, 180);
  assert.equal(stats.wordsPerMinute, 80, "240 words in 3 minutes");
  // 240 words is 6 minutes of typing at 40 wpm, and 3 minutes were spent speaking.
  assert.equal(stats.minutesSaved, 3);
  assert.equal(stats.longestWords, 120);
  assert.equal(stats.today.words, 120);
  assert.equal(stats.daysUsed, 2);
  assert.equal(stats.streakDays, 2);
  assert.equal(stats.activity.length, 7, "the chart is always a full week");
  assert.equal(stats.activity.at(-1).words, 120, "today is the last column");
  assert.deepEqual(stats.topApps, [
    { app: "Notepad", entries: 2 },
    { app: "Brave", entries: 1 },
  ]);
});

test("an empty history produces zeroes rather than NaN", () => {
  const stats = summarize([], Date.now());

  assert.equal(stats.entries, 0);
  assert.equal(stats.wordsPerMinute, 0);
  assert.equal(stats.minutesSaved, 0);
  assert.equal(stats.streakDays, 0);
  assert.equal(stats.activity.length, 7);
  assert.deepEqual(stats.topApps, []);
});

test("a streak survives the morning before the first dictation of the day", () => {
  const now = new Date(2026, 8, 7, 9, 0, 0).getTime();
  const stats = summarize(
    [entry({ at: now - DAY_MS }), entry({ at: now - 2 * DAY_MS })],
    now,
  );

  // Counting only from today would report 0 every morning and reset the streak.
  assert.equal(stats.streakDays, 2);
  assert.equal(stats.today.entries, 0);
});

test("a gap breaks the streak", () => {
  const now = new Date(2026, 8, 7, 12, 0, 0).getTime();
  const stats = summarize([entry({ at: now }), entry({ at: now - 3 * DAY_MS })], now);

  assert.equal(stats.streakDays, 1);
});

test("days are bucketed by the local calendar, not UTC", () => {
  const local = new Date(2026, 0, 31, 23, 30, 0);

  assert.equal(dayKey(local.getTime()), "2026-01-31");
});
