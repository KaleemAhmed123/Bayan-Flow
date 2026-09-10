/**
 * Dictation history.
 *
 * PRIVACY NOTE, READ BEFORE "FIXING" THIS FILE.
 *
 * Everywhere else in BayanFlow, spoken text is deliberately unrecoverable: the
 * logger redacts `transcript`, `rawText`, `finalText`, and `cleanedText`, and
 * temp audio is deleted on every exit path. This file is the one deliberate
 * exception, added at the user's explicit request so the History and Stats
 * pages can exist. It is NOT a leak to be closed.
 *
 * The boundaries that make it acceptable:
 *  - text is written here and nowhere else; the logger rules are untouched
 *  - the file never leaves the machine, and diagnostics export does not read it
 *  - `historyEnabled: false` stops recording entirely
 *  - Clear history deletes the file
 *  - the newest MAX_ENTRIES rows are kept, so it cannot grow without bound
 *
 * Storage is JSON Lines rather than one JSON array: appending a dictation is a
 * single `appendFile`, and a half-written final line can be dropped instead of
 * making the whole file unparseable.
 */

import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { app } from "../electron.js";
import { logger } from "../observability/app-logger.js";
import { normalizeError } from "../observability/errors.js";

/** Newest rows kept on disk. Old ones are dropped on the next append. */
export const MAX_ENTRIES = 500;

/** One stored transcript is capped so a stuck recording cannot bloat the file. */
export const MAX_ENTRY_CHARS = 20_000;

/** Days shown by the Stats page chart. */
export const ACTIVITY_DAYS = 7;

/**
 * Typing speed used for "time saved". A conservative sustained rate for prose
 * on a keyboard. The number is a comparison, not a measurement, and the UI says so.
 */
export const TYPING_WORDS_PER_MINUTE = 40;

export type HistoryEntry = {
  id: string;
  /** Epoch milliseconds. */
  at: number;
  /** How long the microphone was actually open. */
  seconds: number;
  words: number;
  chars: number;
  /** Window the text was sent to, or "" when the capture failed. */
  app: string;
  /** What speech-to-text heard. */
  raw: string;
  /** What was inserted: the polished text, or the raw text when polish is off. */
  polished: string;
};

export type HistoryDay = {
  /** Local YYYY-MM-DD. */
  date: string;
  entries: number;
  words: number;
  seconds: number;
};

export type HistoryStats = {
  entries: number;
  words: number;
  chars: number;
  seconds: number;
  /** Average speaking rate across every recorded session. */
  wordsPerMinute: number;
  /** Keyboard minutes avoided, minus the minutes actually spent speaking. */
  minutesSaved: number;
  longestWords: number;
  firstAt: number;
  lastAt: number;
  /** Consecutive days with at least one dictation, counting back from today. */
  streakDays: number;
  daysUsed: number;
  today: HistoryDay;
  activity: HistoryDay[];
  topApps: { app: string; entries: number }[];
};

export type NewHistoryEntry = {
  seconds: number;
  app: string;
  raw: string;
  polished: string;
};

export class HistoryStore {
  private readonly filePath: string;

  constructor(filePath = path.join(app.getPath("userData"), "history.jsonl")) {
    this.filePath = filePath;
  }

  get location(): string {
    return this.filePath;
  }

  async append(entry: NewHistoryEntry): Promise<HistoryEntry | null> {
    const polished = clip(entry.polished);
    if (!polished.trim()) {
      return null;
    }

    const stored: HistoryEntry = {
      id: `h_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      at: Date.now(),
      seconds: Math.max(0, Math.round(Number(entry.seconds) || 0)),
      words: countWords(polished),
      chars: polished.length,
      app: clip(entry.app || "", 200),
      raw: clip(entry.raw || ""),
      polished,
    };

    try {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      await appendFile(this.filePath, `${JSON.stringify(stored)}\n`, "utf8");
      await this.trim();
      // Counts only. The whole point of this module is that the text stays here.
      void logger.info("history.append", { words: stored.words, seconds: stored.seconds });
      return stored;
    } catch (error) {
      // History is a convenience. Losing an entry must never fail a dictation.
      void logger.warn("history.append.failed", { error: normalizeError("config", error) });
      return null;
    }
  }

  /** Newest first. */
  async list(): Promise<HistoryEntry[]> {
    const entries = await this.readAll();
    return entries.sort((a, b) => b.at - a.at);
  }

  async remove(id: string): Promise<void> {
    const entries = await this.readAll();
    const kept = entries.filter((entry) => entry.id !== id);
    if (kept.length === entries.length) {
      return;
    }

    await this.writeAll(kept);
    void logger.info("history.remove", { removed: entries.length - kept.length });
  }

  async clear(): Promise<void> {
    await rm(this.filePath, { force: true });
    void logger.info("history.clear");
  }

  async stats(): Promise<HistoryStats> {
    return summarize(await this.readAll());
  }

  private async readAll(): Promise<HistoryEntry[]> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch {
      // No file yet is the normal first-run state, not a failure.
      return [];
    }

    const entries: HistoryEntry[] = [];
    for (const line of raw.split("\n")) {
      const entry = parseEntry(line);
      if (entry) {
        entries.push(entry);
      }
    }

    return entries;
  }

  private async writeAll(entries: HistoryEntry[]): Promise<void> {
    const body = entries.map((entry) => JSON.stringify(entry)).join("\n");
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, body ? `${body}\n` : "", "utf8");
  }

  /**
   * ponytail: re-reads the whole file after each append. At MAX_ENTRIES rows
   * that is nothing next to a multi-second Groq call. If the cap ever grows
   * past a few thousand, track the count in memory instead.
   */
  private async trim(): Promise<void> {
    const entries = await this.readAll();
    if (entries.length <= MAX_ENTRIES) {
      return;
    }

    const kept = entries.sort((a, b) => a.at - b.at).slice(-MAX_ENTRIES);
    await this.writeAll(kept);
    void logger.info("history.trim", { dropped: entries.length - kept.length, kept: kept.length });
  }
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }

  return trimmed.split(/\s+/).length;
}

/** Local calendar day, so "today" matches the clock on the wall and not UTC. */
export function dayKey(at: number): string {
  const date = new Date(at);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Pure so it can be unit-tested without touching the disk. Every number the
 * Stats page shows is derived here; there is no second counter to drift.
 */
export function summarize(entries: HistoryEntry[], now = Date.now()): HistoryStats {
  const byDay = new Map<string, HistoryDay>();
  const byApp = new Map<string, number>();
  let words = 0;
  let chars = 0;
  let seconds = 0;
  let longestWords = 0;
  let firstAt = 0;
  let lastAt = 0;

  for (const entry of entries) {
    words += entry.words;
    chars += entry.chars;
    seconds += entry.seconds;
    longestWords = Math.max(longestWords, entry.words);
    firstAt = firstAt === 0 ? entry.at : Math.min(firstAt, entry.at);
    lastAt = Math.max(lastAt, entry.at);

    const key = dayKey(entry.at);
    const day = byDay.get(key) ?? { date: key, entries: 0, words: 0, seconds: 0 };
    day.entries += 1;
    day.words += entry.words;
    day.seconds += entry.seconds;
    byDay.set(key, day);

    if (entry.app) {
      byApp.set(entry.app, (byApp.get(entry.app) ?? 0) + 1);
    }
  }

  const minutesSpoken = seconds / 60;
  const minutesTyping = words / TYPING_WORDS_PER_MINUTE;

  return {
    entries: entries.length,
    words,
    chars,
    seconds,
    wordsPerMinute: minutesSpoken > 0 ? Math.round(words / minutesSpoken) : 0,
    minutesSaved: Math.max(0, Math.round(minutesTyping - minutesSpoken)),
    longestWords,
    firstAt,
    lastAt,
    streakDays: countStreak(byDay, now),
    daysUsed: byDay.size,
    today: byDay.get(dayKey(now)) ?? { date: dayKey(now), entries: 0, words: 0, seconds: 0 },
    activity: buildActivity(byDay, now),
    topApps: [...byApp.entries()]
      .map(([appName, count]) => ({ app: appName, entries: count }))
      .sort((a, b) => b.entries - a.entries)
      .slice(0, 5),
  };
}

/** Oldest to newest, always ACTIVITY_DAYS long so the chart never changes shape. */
function buildActivity(byDay: Map<string, HistoryDay>, now: number): HistoryDay[] {
  const days: HistoryDay[] = [];
  for (let offset = ACTIVITY_DAYS - 1; offset >= 0; offset -= 1) {
    const key = dayKey(now - offset * 86_400_000);
    days.push(byDay.get(key) ?? { date: key, entries: 0, words: 0, seconds: 0 });
  }

  return days;
}

/**
 * A streak survives a day that has not happened yet: counting from today alone
 * would reset every morning before the first dictation, so an empty today falls
 * back to counting from yesterday.
 */
function countStreak(byDay: Map<string, HistoryDay>, now: number): number {
  if (byDay.size === 0) {
    return 0;
  }

  const startOffset = byDay.has(dayKey(now)) ? 0 : 1;
  let streak = 0;
  for (let offset = startOffset; offset < 3650; offset += 1) {
    if (!byDay.has(dayKey(now - offset * 86_400_000))) {
      break;
    }

    streak += 1;
  }

  return streak;
}

function parseEntry(line: string): HistoryEntry | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as Partial<HistoryEntry>;
    if (typeof parsed?.id !== "string" || typeof parsed.at !== "number" || typeof parsed.polished !== "string") {
      return null;
    }

    return {
      id: parsed.id,
      at: parsed.at,
      seconds: Number(parsed.seconds) || 0,
      words: Number(parsed.words) || countWords(parsed.polished),
      chars: Number(parsed.chars) || parsed.polished.length,
      app: typeof parsed.app === "string" ? parsed.app : "",
      raw: typeof parsed.raw === "string" ? parsed.raw : "",
      polished: parsed.polished,
    };
  } catch {
    // A torn last line from a crash mid-append. Drop it, keep the rest.
    return null;
  }
}

function clip(value: string, max = MAX_ENTRY_CHARS): string {
  return value.length > max ? value.slice(0, max) : value;
}
