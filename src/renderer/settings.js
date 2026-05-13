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
    const name = document.createElement("span");
    const state = document.createElement("strong");
    name.textContent = label;
    state.textContent = value;
    item.append(name, state);
    health.append(item);
  }
});

document.getElementById("save").addEventListener("click", async () => {
  const save = document.getElementById("save");
  status.textContent = "";

  if (fields.autoPaste.checked && !fields.autoPasteConfirmed.checked) {
    status.textContent = "Review and confirm the auto-paste warning";
    return;
  }

  save.disabled = true;

  try {
    await window.settingsBridge.save({
      groqApiKey: fields.groqApiKey.value.trim(),
      hotkey: fields.hotkey.value.trim() || "Ctrl+Shift+Space",
      transcriptionModel: fields.transcriptionModel.value.trim() || "whisper-large-v3-turbo",
      cleanupModel: fields.cleanupModel.value.trim() || "llama-3.3-70b-versatile",
      autoPaste: fields.autoPaste.checked,
      cleanupEnabled: fields.cleanupEnabled.checked,
      openAtLogin: fields.openAtLogin.checked,
    });
    status.textContent = "Saved";
  } catch {
    status.textContent = "Could not save settings";
  } finally {
    save.disabled = false;
  }
});

document.getElementById("testMic").addEventListener("click", async () => {
  const button = document.getElementById("testMic");
  status.textContent = "Testing microphone...";
  button.disabled = true;

  try {
    await window.settingsBridge.testMicrophone();
    status.textContent = "Microphone ready";
  } catch {
    status.textContent = "Microphone permission or device failed";
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
