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

window.settingsBridge.load().then((config) => {
  fields.groqApiKey.value = config.groqApiKey || "";
  fields.hotkey.value = config.hotkey;
  fields.transcriptionModel.value = config.transcriptionModel;
  fields.cleanupModel.value = config.cleanupModel;
  fields.autoPaste.checked = config.autoPaste;
  fields.cleanupEnabled.checked = config.cleanupEnabled;
  fields.openAtLogin.checked = config.openAtLogin;
  fields.autoPasteConfirmed.checked = config.autoPaste;
  updateAutoPasteWarning();

  const localHealth = config.health || {};
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
  setStatus("", "");

  if (fields.autoPaste.checked && !fields.autoPasteConfirmed.checked) {
    setStatus("Review and confirm the auto-paste warning", "error");
    return;
  }

  save.disabled = true;

  try {
    await window.settingsBridge.save({
      groqApiKey: fields.groqApiKey.value.trim(),
      hotkey: fields.hotkey.value.trim() || "Ctrl+Shift+Space",
      transcriptionModel: fields.transcriptionModel.value.trim() || "whisper-large-v3",
      cleanupModel: fields.cleanupModel.value.trim() || "llama-3.3-70b-versatile",
      autoPaste: fields.autoPaste.checked,
      cleanupEnabled: fields.cleanupEnabled.checked,
      openAtLogin: fields.openAtLogin.checked,
    });
    setStatus("Saved", "success");
  } catch {
    setStatus("Could not save settings", "error");
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
    setStatus("Microphone ready", "success");
  } catch {
    setStatus("Microphone permission or device failed", "error");
  } finally {
    button.disabled = false;
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
