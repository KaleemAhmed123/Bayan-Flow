/*
 * The BayanFlow window.
 *
 * Four pages behind one sidebar: Home, History, Stats, Settings. Only one is in
 * the document flow at a time; the others carry `hidden`.
 *
 * History and Stats both come from the same main-process store. Stats are not
 * counted here and not stored separately: they are derived from the same rows
 * the History page lists, so the two can never disagree.
 */

const fields = {
  groqApiKey: document.getElementById("groqApiKey"),
  hotkey: document.getElementById("hotkey"),
  inputAssistHotkey: document.getElementById("inputAssistHotkey"),
  transcriptionModel: document.getElementById("transcriptionModel"),
  cleanupModel: document.getElementById("cleanupModel"),
  cleanupFallbackModel: document.getElementById("cleanupFallbackModel"),
  transcriptionLanguage: document.getElementById("transcriptionLanguage"),
  outputLanguage: document.getElementById("outputLanguage"),
  customVocabulary: document.getElementById("customVocabulary"),
  contextCaptureEnabled: document.getElementById("contextCaptureEnabled"),
  contextScreenshotEnabled: document.getElementById("contextScreenshotEnabled"),
  contextBlocklist: document.getElementById("contextBlocklist"),
  contextModel: document.getElementById("contextModel"),
  preserveExactWording: document.getElementById("preserveExactWording"),
  instructionGuardEnabled: document.getElementById("instructionGuardEnabled"),
  microphoneId: document.getElementById("microphoneId"),
  debugCaptureEnabled: document.getElementById("debugCaptureEnabled"),
  showDock: document.getElementById("showDock"),
  autoPaste: document.getElementById("autoPaste"),
  cleanupEnabled: document.getElementById("cleanupEnabled"),
  historyEnabled: document.getElementById("historyEnabled"),
  openAtLogin: document.getElementById("openAtLogin"),
};

const statusLine = document.getElementById("status");
const health = document.getElementById("health");
const setupChecklist = document.getElementById("setupChecklist");
const setupNotice = document.getElementById("setupNotice");
const historyList = document.getElementById("historyList");
const historyEmpty = document.getElementById("historyEmpty");
const historyCount = document.getElementById("historyCount");
const historySearch = document.getElementById("historySearch");
const API_KEY_MASK = "********";
const STATUS_CLEAR_MS = 4000;

/** Newest-first entries as last loaded. The search box filters this copy. */
let entries = [];
let statusTimer = null;

/* ---------------- navigation ---------------- */

const pages = {
  home: document.getElementById("page-home"),
  history: document.getElementById("page-history"),
  stats: document.getElementById("page-stats"),
  settings: document.getElementById("page-settings"),
};

document.getElementById("nav").addEventListener("click", (event) => {
  const button = event.target.closest(".nav-item");
  if (button) {
    showPage(button.dataset.page);
  }
});

function showPage(name) {
  if (!pages[name]) {
    return;
  }

  for (const [key, node] of Object.entries(pages)) {
    node.hidden = key !== name;
  }

  for (const button of document.querySelectorAll(".nav-item")) {
    button.classList.toggle("is-active", button.dataset.page === name);
  }

  document.getElementById("content").scrollTop = 0;

  // Both pages read the store, so they reload on every visit rather than going
  // stale behind a dictation the user just finished in another window.
  if (name === "history") {
    void loadHistory();
  } else if (name === "stats") {
    void loadStats();
  }
}

/* ---------------- settings ---------------- */

window.settingsBridge.load().then((config) => {
  const localHealth = config.health || {};
  setApiKeyMasked(Boolean(localHealth.hasGroqApiKey));
  fields.hotkey.value = config.hotkey;
  fields.inputAssistHotkey.value = config.inputAssistHotkey;
  fields.transcriptionModel.value = config.transcriptionModel;
  fields.cleanupModel.value = config.cleanupModel;
  fields.cleanupFallbackModel.value = config.cleanupFallbackModel || "";
  // A saved language the dropdown has no option for would silently reset the
  // select to its first entry, so add it rather than lose the user's choice.
  setSelectValue(fields.transcriptionLanguage, config.transcriptionLanguage || "");
  setSelectValue(fields.outputLanguage, config.outputLanguage || "");
  fields.customVocabulary.value = config.customVocabulary || "";
  fields.contextCaptureEnabled.checked = config.contextCaptureEnabled;
  fields.contextScreenshotEnabled.checked = config.contextScreenshotEnabled;
  fields.contextBlocklist.value = config.contextBlocklist || "";
  fields.contextModel.value = config.contextModel || "";
  fields.preserveExactWording.checked = config.preserveExactWording;
  fields.instructionGuardEnabled.checked = config.instructionGuardEnabled;
  fields.debugCaptureEnabled.checked = config.debugCaptureEnabled;
  void populateMicrophones(config.microphoneId || "");
  syncScreenshotToggle();
  fields.showDock.checked = config.showDock;
  fields.autoPaste.checked = config.autoPaste;
  fields.cleanupEnabled.checked = config.cleanupEnabled;
  fields.historyEnabled.checked = config.historyEnabled;
  fields.openAtLogin.checked = config.openAtLogin;

  setupNotice.hidden = Boolean(localHealth.hasGroqApiKey);
  renderSetupChecklist(config, localHealth);
  renderHealth(config, localHealth);
  renderHomeHotkeys(config);
  renderNavState(localHealth);

  // The first thing the window shows is the Home summary, which needs numbers.
  void loadStats();
});

document.getElementById("save").addEventListener("click", async () => {
  const save = document.getElementById("save");
  setStatus("Saving...", "info");
  save.disabled = true;

  try {
    const submittedApiKey = getApiKeyValueForSave();
    const saved = await window.settingsBridge.save({
      groqApiKey: submittedApiKey,
      hotkey: fields.hotkey.value.trim() || "Ctrl+Shift+Space",
      inputAssistHotkey: fields.inputAssistHotkey.value.trim() || "Ctrl+Shift+Enter",
      transcriptionModel: fields.transcriptionModel.value.trim() || "whisper-large-v3",
      cleanupModel: fields.cleanupModel.value.trim() || "openai/gpt-oss-120b",
      // Empty is a real choice here: it turns the backup model off.
      cleanupFallbackModel: fields.cleanupFallbackModel.value.trim(),
      transcriptionLanguage: fields.transcriptionLanguage.value,
      outputLanguage: fields.outputLanguage.value,
      customVocabulary: fields.customVocabulary.value,
      contextCaptureEnabled: fields.contextCaptureEnabled.checked,
      // Sending a picture of the screen without the metadata context makes no
      // sense, so the parent toggle governs both.
      contextScreenshotEnabled: fields.contextCaptureEnabled.checked && fields.contextScreenshotEnabled.checked,
      contextBlocklist: fields.contextBlocklist.value,
      contextModel: fields.contextModel.value.trim() || "qwen/qwen3.6-27b",
      preserveExactWording: fields.preserveExactWording.checked,
      instructionGuardEnabled: fields.instructionGuardEnabled.checked,
      microphoneId: fields.microphoneId.value,
      debugCaptureEnabled: fields.debugCaptureEnabled.checked,
      showDock: fields.showDock.checked,
      autoPaste: fields.autoPaste.checked,
      cleanupEnabled: fields.cleanupEnabled.checked,
      historyEnabled: fields.historyEnabled.checked,
      openAtLogin: fields.openAtLogin.checked,
    });
    setApiKeyMasked(Boolean(saved?.health?.hasGroqApiKey || submittedApiKey));
    setupNotice.hidden = true;
    if (saved) {
      renderSetupChecklist(saved, saved.health || {});
      renderHealth(saved, saved.health || {});
      renderHomeHotkeys(saved);
      renderNavState(saved.health || {});
    }

    setStatus("Saved. BayanFlow is ready.", "success");
  } catch (error) {
    setStatus(error?.message || "Could not save. Check the key, hotkeys, and model names.", "error");
  } finally {
    save.disabled = false;
  }
});

document.getElementById("testMic").addEventListener("click", async () => {
  const button = document.getElementById("testMic");
  setStatus("Testing microphone...", "info");
  button.disabled = true;

  try {
    await window.settingsBridge.testMicrophone();
    setStatus("Microphone is ready.", "success");
  } catch {
    setStatus(
      "Microphone test failed. Open Windows Settings, Privacy & security, Microphone, and allow desktop apps.",
      "error",
    );
  } finally {
    button.disabled = false;
  }
});

fields.groqApiKey.addEventListener("focus", () => {
  if (isApiKeyMasked()) {
    fields.groqApiKey.select();
  }
});

fields.groqApiKey.addEventListener("input", () => {
  if (fields.groqApiKey.value !== API_KEY_MASK) {
    fields.groqApiKey.dataset.masked = "false";
  }
});

/* ---------------- history ---------------- */

historySearch.addEventListener("input", () => renderHistory());

document.getElementById("historyClear").addEventListener("click", async () => {
  if (entries.length === 0) {
    setStatus("History is already empty.", "info");
    return;
  }

  // Deleting every transcript is not undoable, so it asks once.
  if (!window.confirm(`Delete all ${entries.length} saved dictations? This cannot be undone.`)) {
    return;
  }

  try {
    await window.settingsBridge.historyClear();
    entries = [];
    renderHistory();
    await loadStats();
    setStatus("History cleared.", "success");
  } catch (error) {
    setStatus(error?.message || "Could not clear history.", "error");
  }
});

async function loadHistory() {
  try {
    entries = await window.settingsBridge.historyList();
  } catch (error) {
    entries = [];
    setStatus(error?.message || "Could not read history.", "error");
  }

  renderHistory();
}

function renderHistory() {
  const query = historySearch.value.trim().toLowerCase();
  const visible = query
    ? entries.filter((entry) => `${entry.polished} ${entry.raw} ${entry.app}`.toLowerCase().includes(query))
    : entries;

  historyList.replaceChildren(...visible.map(createEntryRow));
  historyEmpty.hidden = visible.length > 0;
  historyEmpty.textContent = query
    ? "No dictation matches that search."
    : "Nothing here yet. Dictate something and it will show up.";

  if (entries.length === 0) {
    historyCount.textContent = "";
    return;
  }

  historyCount.textContent =
    visible.length === entries.length
      ? `${entries.length} ${entries.length === 1 ? "dictation" : "dictations"}`
      : `${visible.length} of ${entries.length}`;
}

/**
 * A native <details> is the open/close control. No toggle state to track, it
 * keeps keyboard and screen-reader behaviour for free, and only the open rows
 * pay for laying out their full text.
 */
function createEntryRow(entry) {
  const row = document.createElement("details");
  row.className = "entry";

  const summary = document.createElement("summary");

  const when = document.createElement("span");
  when.className = "entry-when";
  when.textContent = formatWhen(entry.at);

  const preview = document.createElement("span");
  preview.className = "entry-preview";
  preview.textContent = entry.polished;

  const meta = document.createElement("span");
  meta.className = "entry-meta";
  meta.textContent = `${entry.words} ${entry.words === 1 ? "word" : "words"} · ${formatClock(entry.seconds)}`;

  summary.append(when, preview, meta);
  row.append(summary, createEntryBody(entry, row));
  return row;
}

function createEntryBody(entry, row) {
  const body = document.createElement("div");
  body.className = "entry-body";

  const changed = entry.raw.trim() && entry.raw.trim() !== entry.polished.trim();
  body.append(
    createTextBlock("What you said", entry.raw || entry.polished, changed ? "" : "Polish was off or changed nothing"),
    createTextBlock("What was inserted", entry.polished, ""),
  );

  const footer = document.createElement("div");
  footer.className = "entry-foot";

  const where = document.createElement("span");
  where.className = "entry-app";
  where.textContent = entry.app ? `Sent to ${entry.app}` : "Target window unknown";

  const spacer = document.createElement("span");
  spacer.className = "spacer";

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "btn btn-danger btn-small";
  remove.textContent = "Delete";
  remove.addEventListener("click", async () => {
    try {
      await window.settingsBridge.historyRemove(entry.id);
      entries = entries.filter((item) => item.id !== entry.id);
      row.remove();
      renderHistory();
      await loadStats();
      setStatus("Dictation deleted.", "success");
    } catch (error) {
      setStatus(error?.message || "Could not delete that entry.", "error");
    }
  });

  footer.append(where, spacer, remove);
  body.append(footer);
  return body;
}

function createTextBlock(title, text, note) {
  const block = document.createElement("div");
  block.className = "text-block";

  const head = document.createElement("div");
  head.className = "text-head";

  const label = document.createElement("h4");
  label.textContent = title;

  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "btn btn-small";
  copy.textContent = "Copy";
  copy.addEventListener("click", () => copyText(text, copy));

  head.append(label, copy);

  const body = document.createElement("p");
  body.className = "text-body";
  body.textContent = text;

  block.append(head, body);

  if (note) {
    const hint = document.createElement("span");
    hint.className = "text-note";
    hint.textContent = note;
    block.append(hint);
  }

  return block;
}

/**
 * The window is loaded from file://, where the async clipboard API is not
 * guaranteed, so the old synchronous command is the fallback rather than the
 * other way round.
 */
async function copyText(text, button) {
  const previous = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const scratch = document.createElement("textarea");
    scratch.value = text;
    scratch.setAttribute("readonly", "");
    scratch.className = "offscreen";
    document.body.append(scratch);
    scratch.select();
    document.execCommand("copy");
    scratch.remove();
  }

  button.textContent = "Copied";
  setTimeout(() => {
    button.textContent = previous;
  }, 1200);
}

/* ---------------- stats ---------------- */

async function loadStats() {
  let stats;
  try {
    stats = await window.settingsBridge.historyStats();
  } catch (error) {
    setStatus(error?.message || "Could not read stats.", "error");
    return;
  }

  renderHomeTiles(stats);
  renderStatTiles(stats);
  renderChart(stats.activity);
  renderTopApps(stats.topApps);
}

function renderHomeTiles(stats) {
  renderTiles(document.getElementById("homeTiles"), [
    ["Words today", formatNumber(stats.today.words), `${stats.today.entries} ${stats.today.entries === 1 ? "dictation" : "dictations"}`],
    ["Day streak", String(stats.streakDays), stats.streakDays > 0 ? "Keep it going" : "Dictate today to start one"],
    ["Words all time", formatNumber(stats.words), `across ${formatNumber(stats.entries)} dictations`],
    ["Typing time saved", formatMinutes(stats.minutesSaved), "vs typing at 40 wpm"],
  ]);
}

function renderStatTiles(stats) {
  renderTiles(document.getElementById("statTiles"), [
    ["Words dictated", formatNumber(stats.words), `${formatNumber(stats.chars)} characters`],
    ["Dictations", formatNumber(stats.entries), stats.longestWords > 0 ? `longest was ${formatNumber(stats.longestWords)} words` : ""],
    ["Time spoken", formatDuration(stats.seconds), `across ${stats.daysUsed} ${stats.daysUsed === 1 ? "day" : "days"}`],
    ["Speaking speed", stats.wordsPerMinute > 0 ? `${stats.wordsPerMinute} wpm` : "—", "words per minute, average"],
    ["Typing time saved", formatMinutes(stats.minutesSaved), "vs typing at 40 wpm"],
    ["Day streak", String(stats.streakDays), stats.lastAt ? `last used ${formatWhen(stats.lastAt)}` : ""],
  ]);
}

function renderTiles(target, rows) {
  target.replaceChildren(
    ...rows.map(([label, value, note]) => {
      const tile = document.createElement("div");
      tile.className = "tile";

      const name = document.createElement("span");
      name.className = "tile-label";
      name.textContent = label;

      const figure = document.createElement("strong");
      figure.className = "tile-value";
      figure.textContent = value;

      tile.append(name, figure);

      if (note) {
        const hint = document.createElement("span");
        hint.className = "tile-note";
        hint.textContent = note;
        tile.append(hint);
      }

      return tile;
    }),
  );
}

function renderChart(activity) {
  const days = Array.isArray(activity) ? activity : [];
  const peak = Math.max(1, ...days.map((day) => day.words));

  document.getElementById("chart").replaceChildren(
    ...days.map((day) => {
      const column = document.createElement("div");
      column.className = "chart-col";
      column.title = `${day.date}: ${day.words} words`;

      const bar = document.createElement("div");
      bar.className = "chart-bar";
      // Zero days keep a 2% stub so the baseline is visible and clickable.
      bar.style.height = `${Math.max(2, Math.round((day.words / peak) * 100))}%`;
      bar.dataset.empty = day.words === 0 ? "true" : "false";

      const value = document.createElement("span");
      value.className = "chart-value";
      value.textContent = day.words > 0 ? formatNumber(day.words) : "";

      const label = document.createElement("span");
      label.className = "chart-label";
      label.textContent = weekdayLabel(day.date);

      column.append(value, bar, label);
      return column;
    }),
  );
}

function renderTopApps(topApps) {
  const list = document.getElementById("topApps");
  const rows = Array.isArray(topApps) ? topApps : [];

  if (rows.length === 0) {
    const empty = document.createElement("li");
    empty.className = "apps-empty";
    empty.textContent = "No dictations recorded yet.";
    list.replaceChildren(empty);
    return;
  }

  const peak = Math.max(...rows.map((row) => row.entries));
  list.replaceChildren(
    ...rows.map((row) => {
      const item = document.createElement("li");

      const name = document.createElement("span");
      name.className = "apps-name";
      name.textContent = row.app;

      const meter = document.createElement("span");
      meter.className = "apps-meter";
      const fill = document.createElement("span");
      fill.style.width = `${Math.round((row.entries / peak) * 100)}%`;
      meter.append(fill);

      const count = document.createElement("strong");
      count.className = "apps-count";
      count.textContent = String(row.entries);

      item.append(name, meter, count);
      return item;
    }),
  );
}

/* ---------------- shared rendering ---------------- */

function renderHomeHotkeys(config) {
  document.getElementById("howDictate").textContent = config.hotkey || "Ctrl+Shift+Space";
  document.getElementById("howRewrite").textContent = config.inputAssistHotkey || "Ctrl+Shift+Enter";
  document.getElementById("homeGreeting").textContent = config.health?.hasGroqApiKey
    ? "Welcome back"
    : "Let us get you set up";
}

function renderNavState(localHealth) {
  const ready = Boolean(localHealth.hasGroqApiKey) && Boolean(localHealth.hotkeyAvailable);
  document.getElementById("navDot").dataset.state = ready ? "good" : "warning";
  document.getElementById("navState").textContent = ready
    ? "Ready"
    : localHealth.hasGroqApiKey
      ? "Hotkey unavailable"
      : "API key needed";
}

function renderSetupChecklist(config, localHealth) {
  const items = [
    {
      done: Boolean(localHealth.hasGroqApiKey),
      title: "Add your Groq API key",
      copy: "Create one in the Groq console, paste it into Settings, then save.",
    },
    {
      done: !localHealth.lastMicError,
      title: "Test the microphone",
      copy: "Use the button at the top of the Settings page before your first real recording.",
    },
    {
      done: Boolean(localHealth.hotkeyAvailable),
      title: "Try the dictation hotkey",
      copy: `Hold ${config.hotkey || "Ctrl+Shift+Space"} in Notepad, say one sentence, release.`,
    },
    {
      done: Boolean(config.inputAssistHotkey),
      title: "Try the rewrite hotkey",
      copy: `Type a rough sentence, press ${config.inputAssistHotkey || "Ctrl+Shift+Enter"}, pick Polish.`,
    },
  ];

  setupChecklist.replaceChildren();
  for (const item of items) {
    const row = document.createElement("li");
    row.dataset.state = item.done ? "done" : "todo";

    const icon = document.createElement("span");
    icon.className = "check-icon";
    icon.textContent = item.done ? "✓" : "!";

    const copy = document.createElement("span");
    const title = document.createElement("span");
    title.className = "check-title";
    title.textContent = item.title;
    const detail = document.createElement("span");
    detail.className = "check-copy";
    detail.textContent = item.copy;
    copy.append(title, detail);

    row.append(icon, copy);
    setupChecklist.append(row);
  }
}

function renderHealth(config, localHealth) {
  const rows = [
    ["API key", localHealth.hasGroqApiKey ? "Present" : "Missing", localHealth.hasGroqApiKey ? "good" : "warning"],
    ["Hotkeys", localHealth.hotkeyAvailable ? "Active" : "Unavailable", localHealth.hotkeyAvailable ? "good" : "warning"],
    [
      "Insertion",
      localHealth.pasteMode === "auto" ? "Paste into app" : "Copy only",
      localHealth.pasteMode === "auto" ? "good" : "neutral",
    ],
    ["Polish", config.cleanupEnabled ? "On" : "Off", config.cleanupEnabled ? "good" : "neutral"],
    ["History", config.historyEnabled ? "Recording" : "Off", config.historyEnabled ? "good" : "neutral"],
    ["Pill", config.showDock ? "On screen" : "Hidden", config.showDock ? "good" : "neutral"],
    ["Last mic error", localHealth.lastMicError || "None", localHealth.lastMicError ? "error" : "good"],
    ["Last error", localHealth.lastErrorId || "None", localHealth.lastErrorId ? "error" : "good"],
    ["Logs", localHealth.logDir || "Not initialized", "neutral"],
  ];

  health.replaceChildren();
  for (const [label, value, state] of rows) {
    const item = document.createElement("li");
    item.dataset.state = state;

    const name = document.createElement("span");
    name.className = "health-label";
    name.textContent = label;

    const valueNode = document.createElement("strong");
    valueNode.className = "health-value";
    valueNode.textContent = value;

    item.append(name, valueNode);
    health.append(item);
  }
}

function setApiKeyMasked(hasKey) {
  fields.groqApiKey.value = hasKey ? API_KEY_MASK : "";
  fields.groqApiKey.dataset.masked = hasKey ? "true" : "false";
  fields.groqApiKey.placeholder = hasKey ? "Saved API key" : "Paste your Groq API key";
}

function isApiKeyMasked() {
  return fields.groqApiKey.dataset.masked === "true" && fields.groqApiKey.value === API_KEY_MASK;
}

function getApiKeyValueForSave() {
  return isApiKeyMasked() ? "" : fields.groqApiKey.value.trim();
}

/** One status bar for every page, so no page needs its own message area. */
function setStatus(message, state) {
  statusLine.textContent = message;
  statusLine.hidden = !message;

  if (state) {
    statusLine.dataset.state = state;
  } else {
    delete statusLine.dataset.state;
  }

  clearTimeout(statusTimer);
  if (message && state !== "info") {
    statusTimer = setTimeout(() => {
      statusLine.hidden = true;
      statusLine.textContent = "";
    }, STATUS_CLEAR_MS);
  }
}

/* ---------------- formatting ---------------- */

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function formatClock(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.round((total % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return total < 60 ? `${total}s` : `${minutes}m`;
}

function formatMinutes(minutes) {
  const value = Math.max(0, Math.round(Number(minutes) || 0));
  if (value < 60) {
    return `${value}m`;
  }

  return `${Math.floor(value / 60)}h ${value % 60}m`;
}

/** Today and yesterday are named; anything older gets its date. */
function formatWhen(at) {
  const date = new Date(at);
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400000);

  if (isSameDay(date, today)) {
    return `Today ${time}`;
  }

  if (isSameDay(date, yesterday)) {
    return `Yesterday ${time}`;
  }

  return `${date.toLocaleDateString([], { day: "numeric", month: "short" })} ${time}`;
}

function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

/** The store sends a local YYYY-MM-DD, so it is parsed as local, not as UTC. */
function weekdayLabel(date) {
  const [year, month, day] = String(date).split("-").map(Number);
  if (!year || !month || !day) {
    return "";
  }

  return new Date(year, month - 1, day).toLocaleDateString([], { weekday: "short" });
}

/**
 * Selects a value, adding an option for it when the list does not already have
 * one. Without this a language saved by hand in config.json, or removed from the
 * list in a later build, would be quietly replaced by whichever option is first.
 */
function setSelectValue(select, value) {
  if (value && !Array.from(select.options).some((option) => option.value === value)) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  }

  select.value = value;
}

/**
 * The screenshot toggle is meaningless with context capture off, so it is
 * disabled rather than left clickable and silently ignored.
 */
function syncScreenshotToggle() {
  const enabled = fields.contextCaptureEnabled.checked;
  fields.contextScreenshotEnabled.disabled = !enabled;
  if (!enabled) {
    fields.contextScreenshotEnabled.checked = false;
  }
}

fields.contextCaptureEnabled.addEventListener("change", syncScreenshotToggle);

/**
 * Fills the microphone list and reports a saved device that is no longer here.
 *
 * Recording already falls back to the system default when the chosen device has
 * been unplugged, so dictation keeps working. Saying so HERE is what stops that
 * being a silent switch: this is the screen the user opens when the wrong
 * microphone is being used, so it is the right place to find out why.
 */
async function populateMicrophones(savedId) {
  const help = document.getElementById("microphoneHelp");
  const defaultHelp = "Pick the input to record from. Leave on system default unless the wrong one is used.";

  let devices = [];
  try {
    devices = (await window.settingsBridge.listMicrophones()) || [];
  } catch {
    devices = [];
  }

  fields.microphoneId.innerHTML = "";
  const systemDefault = document.createElement("option");
  systemDefault.value = "";
  systemDefault.textContent = "System default";
  fields.microphoneId.append(systemDefault);

  for (const device of devices) {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = device.label;
    fields.microphoneId.append(option);
  }

  const savedIsPresent = !savedId || devices.some((device) => device.deviceId === savedId);
  if (savedIsPresent) {
    fields.microphoneId.value = savedId;
    help.textContent = devices.length
      ? defaultHelp
      : "Could not read your microphone list. Recording still uses the system default.";
    return;
  }

  // Keep the saved value selected rather than silently resetting it to default:
  // the device may simply be unplugged and coming back.
  const missing = document.createElement("option");
  missing.value = savedId;
  missing.textContent = "Saved microphone (not connected)";
  fields.microphoneId.append(missing);
  fields.microphoneId.value = savedId;
  help.textContent = "Your saved microphone is not connected. Recording is using the system default until it returns.";
}
