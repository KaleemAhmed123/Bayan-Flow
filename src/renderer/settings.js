const fields = {
  groqApiKey: document.getElementById("groqApiKey"),
  hotkey: document.getElementById("hotkey"),
  transcriptionModel: document.getElementById("transcriptionModel"),
  cleanupModel: document.getElementById("cleanupModel"),
  autoPaste: document.getElementById("autoPaste"),
  autoPasteConfirmed: document.getElementById("autoPasteConfirmed"),
  cleanupEnabled: document.getElementById("cleanupEnabled"),
  openAtLogin: document.getElementById("openAtLogin"),
};

const status = document.getElementById("status");
const health = document.getElementById("health");
const autoPasteWarning = document.getElementById("autoPasteWarning");
const setupNotice = document.getElementById("setupNotice");
const API_KEY_MASK = "********";

window.settingsBridge.load().then((config) => {
  const localHealth = config.health || {};
  setApiKeyMasked(Boolean(localHealth.hasGroqApiKey));
  fields.hotkey.value = config.hotkey;
  fields.transcriptionModel.value = config.transcriptionModel;
  fields.cleanupModel.value = config.cleanupModel;
  fields.autoPaste.checked = config.autoPaste;
  fields.cleanupEnabled.checked = config.cleanupEnabled;
  fields.openAtLogin.checked = config.openAtLogin;
  fields.autoPasteConfirmed.checked = config.autoPaste;
  updateAutoPasteWarning();

  setupNotice.hidden = localHealth.hasGroqApiKey;
  health.innerHTML = "";
  for (const [label, value] of [
    ["API key", localHealth.hasGroqApiKey ? "Present" : "Missing"],
    ["Hotkey", localHealth.hotkeyAvailable ? "Active" : "Unavailable"],
    ["Paste mode", localHealth.pasteMode === "auto" ? "Auto paste" : "Copy only"],
    ["Last mic error", localHealth.lastMicError || "None"],
    ["Last error", localHealth.lastErrorId || "None"],
    ["Logs", localHealth.logDir || "Not initialized"],
  ]) {
    const item = document.createElement("li");
    item.dataset.state = resolveHealthState(label, value);

    const name = document.createElement("span");
    name.className = "health-label";
    name.textContent = label;

    const state = document.createElement("strong");
    state.className = "health-value";
    state.textContent = value;

    item.append(name, state);
    health.append(item);
  }
});

document.getElementById("save").addEventListener("click", async () => {
  const save = document.getElementById("save");
  setStatus("Saving settings...", "info");

  if (fields.autoPaste.checked && !fields.autoPasteConfirmed.checked) {
    setStatus("Review and confirm the auto-paste warning", "error");
    return;
  }

  save.disabled = true;

  try {
    const submittedApiKey = getApiKeyValueForSave();
    const saved = await window.settingsBridge.save({
      groqApiKey: submittedApiKey,
      hotkey: fields.hotkey.value.trim() || "Ctrl+Shift+Space",
      transcriptionModel: fields.transcriptionModel.value.trim() || "whisper-large-v3",
      cleanupModel: fields.cleanupModel.value.trim() || "llama-3.3-70b-versatile",
      autoPaste: fields.autoPaste.checked,
      cleanupEnabled: fields.cleanupEnabled.checked,
      openAtLogin: fields.openAtLogin.checked,
    });
    setApiKeyMasked(Boolean(saved?.health?.hasGroqApiKey || submittedApiKey));
    setupNotice.hidden = true;
    setStatus("Settings saved. BayanFlow is ready.", "success");
  } catch {
    setStatus("Could not save settings. Check the key and model names.", "error");
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
    setStatus("Microphone test failed. Check Windows microphone permission and selected input device.", "error");
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

fields.autoPaste.addEventListener("change", () => {
  if (!fields.autoPaste.checked) {
    fields.autoPasteConfirmed.checked = false;
  }

  updateAutoPasteWarning();
});

function updateAutoPasteWarning() {
  autoPasteWarning.hidden = !fields.autoPaste.checked;
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
  status.textContent = message;
  if (state) {
    status.dataset.state = state;
    return;
  }

  delete status.dataset.state;
}

function resolveHealthState(label, value) {
  if ((label === "API key" || label === "Hotkey") && value !== "Present" && value !== "Active") {
    return "warning";
  }

  if ((label === "Last mic error" || label === "Last error") && value !== "None") {
    return "error";
  }

  if (label === "Paste mode" && value === "Auto paste") {
    return "warning";
  }

  return "good";
}
