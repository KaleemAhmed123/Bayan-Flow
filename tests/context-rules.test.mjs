import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_CONTEXT_BLOCKLIST,
  appNameFromTitle,
  buildContextSection,
  hasUsableContext,
  isBlockedWindow,
  normalizeActivitySummary,
  parseBlocklist,
  stripThinkTags,
  truncateTitle,
} from "../dist/context/context-rules.js";

/* ---------------------------------------------------------------- *
 * The blocklist — the part that decides what never leaves the machine
 * ---------------------------------------------------------------- */

test("the default blocklist covers vaults, private browsing, and money", () => {
  for (const title of [
    "1Password",
    "Vault — Bitwarden",
    "LastPass Password Manager",
    "Google Chrome — Incognito",
    "Edge — InPrivate",
    "Firefox Private Browsing",
    "Chase Bank — Accounts",
    "MetaMask Wallet",
    "PayPal — Summary",
  ]) {
    assert.equal(isBlockedWindow(title, DEFAULT_CONTEXT_BLOCKLIST), true, `expected "${title}" to be blocked`);
  }
});

test("ordinary working windows are not blocked", () => {
  for (const title of [
    "auth.ts - BayanFlow - Visual Studio Code",
    "Inbox (3) - Gmail - Google Chrome",
    "general | Acme - Slack",
    "Untitled document - Google Docs",
  ]) {
    assert.equal(isBlockedWindow(title, DEFAULT_CONTEXT_BLOCKLIST), false, `expected "${title}" to be allowed`);
  }
});

test("an untitled window is blocked rather than guessed at", () => {
  // We cannot reason about a window with no title, so we do not look at it.
  assert.equal(isBlockedWindow("", DEFAULT_CONTEXT_BLOCKLIST), true);
  assert.equal(isBlockedWindow("   ", DEFAULT_CONTEXT_BLOCKLIST), true);
});

test("blocklist matching ignores case", () => {
  assert.equal(isBlockedWindow("MY BANK PORTAL", ["bank"]), true);
  assert.equal(isBlockedWindow("my bank portal", ["BANK"]), true);
});

test("an empty blocklist blocks nothing except untitled windows", () => {
  assert.equal(isBlockedWindow("Chase Bank", []), false);
  assert.equal(isBlockedWindow("", []), true);
});

test("parseBlocklist lowercases, trims, drops blanks, and de-duplicates", () => {
  assert.deepEqual(parseBlocklist("  Bank \n\nbank\n1Password\n   \nBITWARDEN"), [
    "bank",
    "1password",
    "bitwarden",
  ]);
});

/* ---------------------------------------------------------------- *
 * Summaries
 * ---------------------------------------------------------------- */

test("activity summaries are trimmed to two sentences", () => {
  const summary = normalizeActivitySummary(
    "The user is writing an email. They are replying to Ayesha about the budget. They also have a terminal open. And a fourth sentence.",
  );

  assert.equal(summary, "The user is writing an email. They are replying to Ayesha about the budget.");
});

test("a one or two sentence summary is left alone", () => {
  assert.equal(normalizeActivitySummary("Writing a commit message."), "Writing a commit message.");
  assert.equal(normalizeActivitySummary("Writing code. In an editor."), "Writing code. In an editor.");
});

test("think tags are stripped, closed or not", () => {
  assert.equal(stripThinkTags("<think>hmm let me see</think>The answer."), "The answer.");
  assert.equal(stripThinkTags("<think>ran out of tokens mid thought"), "");
  assert.equal(stripThinkTags("No tags here."), "No tags here.");
});

test("an empty or whitespace summary becomes empty", () => {
  assert.equal(normalizeActivitySummary("   "), "");
  assert.equal(normalizeActivitySummary("<think>only thinking</think>"), "");
});

/* ---------------------------------------------------------------- *
 * App name guessing
 * ---------------------------------------------------------------- */

test("the app name is guessed from the last title segment", () => {
  assert.equal(appNameFromTitle("auth.ts - BayanFlow - Visual Studio Code"), "Visual Studio Code");
  assert.equal(appNameFromTitle("Inbox (3) - Gmail - Google Chrome"), "Google Chrome");
  assert.equal(appNameFromTitle("general | Acme - Slack"), "Slack");
});

test("a title with no separator yields no guess", () => {
  assert.equal(appNameFromTitle("Notepad"), "");
  assert.equal(appNameFromTitle(""), "");
});

test("a long trailing segment is not mistaken for an app name", () => {
  // "...- and then I told him the whole story about the thing" is a sentence,
  // not an application.
  assert.equal(appNameFromTitle("Notes - and then I told him the whole long story about the thing"), "");
});

/* ---------------------------------------------------------------- *
 * The prompt section
 * ---------------------------------------------------------------- */

const context = {
  appName: "Google Chrome",
  windowTitle: "Inbox (3) - Gmail - Google Chrome",
  activity: "The user is replying to an email from Ayesha.",
  visibleNames: [],
  usedScreenshot: false,
  blocked: false,
};

test("the context section carries the never-add rule", () => {
  const section = buildContextSection(context);

  assert.match(section, /Google Chrome/);
  assert.match(section, /replying to an email from Ayesha/);
  // Without this the model writes ABOUT the screen instead of cleaning speech.
  assert.match(section, /NEVER add a name, fact, or detail from the context/);
  assert.match(section, /background, not content/);
});

test("a blocked context produces no section at all", () => {
  assert.equal(buildContextSection({ ...context, blocked: true }), "");
  assert.equal(hasUsableContext({ ...context, blocked: true }), false);
});

test("an empty context produces no section", () => {
  assert.equal(buildContextSection(null), "");
  assert.equal(buildContextSection(undefined), "");
  assert.equal(buildContextSection({ ...context, windowTitle: "", activity: "" }), "");
});

test("metadata alone is still usable context", () => {
  const metadataOnly = { ...context, activity: "" };
  assert.equal(hasUsableContext(metadataOnly), true);
  assert.match(buildContextSection(metadataOnly), /Inbox \(3\)/);
});

test("a runaway window title is truncated", () => {
  const long = "x".repeat(500);
  assert.ok(truncateTitle(long).length < 320);
  assert.equal(truncateTitle("  normal  "), "normal");
});

/* ---------------------------------------------------------------- *
 * Precedence: the user's list beats what happens to be on screen
 * ---------------------------------------------------------------- */

test("the context rule defers to the known-spellings list", async () => {
  const { buildCleanupPrompt } = await import("../dist/cleanup/cleanup-provider.js");

  const prompt = buildCleanupPrompt("email aisha about the budget", {
    mode: "default",
    vocabulary: ["Aisha"],
    appContext: { ...context, windowTitle: "Compose: ayeesha@allenhouse.ac.in - Gmail" },
  });

  // Two rules that each say "use my spelling" with nothing saying which loses
  // is undefined behaviour: the model picks arbitrarily, differently each run.
  assert.match(prompt, /known-spellings list is the final authority/);
  assert.match(prompt, /use the spelling from the list/);
  assert.match(prompt, /unless a known-spellings list below gives a different spelling/);
});

test("no precedence block when only one source of spellings exists", async () => {
  const { buildCleanupPrompt } = await import("../dist/cleanup/cleanup-provider.js");

  const vocabularyOnly = buildCleanupPrompt("hi", { mode: "default", vocabulary: ["Aisha"] });
  const contextOnly = buildCleanupPrompt("hi", { mode: "default", appContext: context });

  // The question only arises when both are present; stating it otherwise is
  // prompt weight spent on a conflict that cannot happen.
  assert.doesNotMatch(vocabularyOnly, /final authority/);
  assert.doesNotMatch(contextOnly, /final authority/);
});

/* ---------------------------------------------------------------- *
 * Exact names — the part that survives summarisation
 * ---------------------------------------------------------------- */

test("the two-part answer is split into a summary and exact names", async () => {
  const { parseContextAnswer } = await import("../dist/context/context-rules.js");

  const parsed = parseContextAnswer(
    "ACTIVITY: The user is composing an email. They are about to write a short message.\nNAMES: Ayeesha, Astrea IT Services, Grafana",
  );

  assert.match(parsed.activity, /composing an email/);
  // The whole point: the unusual spelling arrives untouched, because it never
  // passed through prose.
  assert.deepEqual(parsed.visibleNames, ["Ayeesha", "Astrea IT Services", "Grafana"]);
});

test("an unusual spelling is never normalised on the way through", async () => {
  const { parseContextAnswer, buildContextSection } = await import("../dist/context/context-rules.js");

  const parsed = parseContextAnswer("ACTIVITY: Writing an email.\nNAMES: Ayeesha");
  const section = buildContextSection({
    appName: "Google Chrome",
    windowTitle: "New Message - Gmail",
    activity: parsed.activity,
    visibleNames: parsed.visibleNames,
    usedScreenshot: true,
    blocked: false,
  });

  assert.match(section, /Ayeesha/);
  assert.match(section, /EXACT spelling above, character for character/);
  assert.match(section, /never "Ayesha"/);
});

test("NONE and blanks yield no names", async () => {
  const { parseContextAnswer } = await import("../dist/context/context-rules.js");

  assert.deepEqual(parseContextAnswer("ACTIVITY: Reading docs.\nNAMES: NONE").visibleNames, []);
  assert.deepEqual(parseContextAnswer("ACTIVITY: Reading docs.\nNAMES:   ").visibleNames, []);
  assert.deepEqual(parseContextAnswer("").visibleNames, []);
});

test("a model that ignores the format still yields a usable summary", async () => {
  // Getting fewer names is a far smaller loss than getting nothing at all.
  const { parseContextAnswer } = await import("../dist/context/context-rules.js");

  const parsed = parseContextAnswer("The user is writing a commit message in an editor.");
  assert.match(parsed.activity, /commit message/);
  assert.deepEqual(parsed.visibleNames, []);
});

test("names are de-duplicated, trimmed, and capped", async () => {
  const { parseContextAnswer } = await import("../dist/context/context-rules.js");

  const parsed = parseContextAnswer('ACTIVITY: x.\nNAMES: "Ayeesha" , ayeesha, Grafana, , Prometheus');
  assert.deepEqual(parsed.visibleNames, ["Ayeesha", "Grafana", "Prometheus"]);

  const many = Array.from({ length: 30 }, (_, i) => `Name${i}`).join(", ");
  assert.ok(parseContextAnswer(`ACTIVITY: x.\nNAMES: ${many}`).visibleNames.length <= 12);
});

test("a missing visibleNames field cannot crash the cleanup path", async () => {
  const { buildContextSection, hasUsableContext } = await import("../dist/context/context-rules.js");
  // A snapshot stored before this field existed must degrade, not throw.
  const legacy = { appName: "Chrome", windowTitle: "Inbox - Gmail", activity: "", usedScreenshot: false, blocked: false };

  assert.equal(hasUsableContext(legacy), true);
  assert.match(buildContextSection(legacy), /Inbox - Gmail/);
});
