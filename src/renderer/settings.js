const fields = {
  groqApiKey: document.getElementById("groqApiKey"),
  hotkey: document.getElementById("hotkey"),
  inputAssistHotkey: document.getElementById("inputAssistHotkey"),
  transcriptionModel: document.getElementById("transcriptionModel"),
  cleanupModel: document.getElementById("cleanupModel"),
  showDock: document.getElementById("showDock"),
  autoPaste: document.getElementById("autoPaste"),
  cleanupEnabled: document.getElementById("cleanupEnabled"),
  openAtLogin: document.getElementById("openAtLogin"),
};

const statusLine = document.getElementById("status");
const health = document.getElementById("health");
const setupChecklist = document.getElementById("setupChecklist");
const setupNotice = document.getElementById("setupNotice");
const API_KEY_MASK = "********";

window.settingsBridge.load().then((config) => {
  const localHealth = config.health || {};
  setApiKeyMasked(Boolean(localHealth.hasGroqApiKey));
  fields.hotkey.value = config.hotkey;
  fields.inputAssistHotkey.value = config.inputAssistHotkey;
  fields.transcriptionModel.value = config.transcriptionModel;
  fields.cleanupModel.value = config.cleanupModel;
  fields.showDock.checked = config.showDock;
  fields.autoPaste.checked = config.autoPaste;
  fields.cleanupEnabled.checked = config.cleanupEnabled;
  fields.openAtLogin.checked = config.openAtLogin;

  setupNotice.hidden = Boolean(localHealth.hasGroqApiKey);
  renderSetupChecklist(config, localHealth);
  renderHealth(config, localHealth);
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
      showDock: fields.showDock.checked,
      autoPaste: fields.autoPaste.checked,
      cleanupEnabled: fields.cleanupEnabled.checked,
      openAtLogin: fields.openAtLogin.checked,
    });
    setApiKeyMasked(Boolean(saved?.health?.hasGroqApiKey || submittedApiKey));
    setupNotice.hidden = true;
    if (saved) {
      renderSetupChecklist(saved, saved.health || {});
      renderHealth(saved, saved.health || {});
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

function renderSetupChecklist(config, localHealth) {
  const items = [
    {
      done: Boolean(localHealth.hasGroqApiKey),
      title: "Add your Groq API key",
      copy: "Create one in the Groq console, paste it above, then save.",
    },
    {
      done: !localHealth.lastMicError,
      title: "Test the microphone",
      copy: "Use the button at the top right before your first real recording.",
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

function setStatus(message, state) {
  statusLine.textContent = message;
  if (state) {
    statusLine.dataset.state = state;
    return;
  }

  delete statusLine.dataset.state;
}
