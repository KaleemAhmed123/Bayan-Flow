const root = document.getElementById("root");
const magic = document.getElementById("magic");
const menu = document.getElementById("menu");
const loading = document.getElementById("loading");
const loadingMessage = document.getElementById("loadingMessage");
const error = document.getElementById("error");
const errorMessage = document.getElementById("errorMessage");
const preview = document.getElementById("preview");
const previewTitle = document.getElementById("previewTitle");
const previewMeta = document.getElementById("previewMeta");
const previewText = document.getElementById("previewText");
const replaceButton = document.getElementById("replace");
const actions = document.getElementById("actions");
const customRow = document.getElementById("customRow");
const customInput = document.getElementById("customInput");
let commandStartedAt = 0;

const actionItems = [
  ["fix_grammar", "Fix grammar"],
  ["polish", "Polish"],
  ["professional", "Professional"],
  ["friendly", "Friendly/Casual"],
  ["shorten", "Shorten"],
  ["expand", "Expand"],
  ["simplify", "Simplify"],
  ["custom", "Custom"],
];

for (const [id, label] of actionItems) {
  const button = document.createElement("button");
  button.className = "action";
  button.type = "button";
  button.textContent = label;
  bindButtonCommand(button, () => {
    if (id === "custom") {
      customRow.hidden = false;
      customInput.focus();
      return;
    }

    showInlineLoading("Preparing text...");
    runBridgeCommand(window.inputAssistBridge.runAction(id));
  });
  actions.append(button);
}

bindButtonCommand(magic, () => runBridgeCommand(window.inputAssistBridge.openMenu()));
bindButtonCommand(document.getElementById("speak"), () => {
  showInlineLoading("Starting recording...");
  runBridgeCommand(window.inputAssistBridge.speak());
});
bindButtonCommand(document.getElementById("closeMenu"), () => runBridgeCommand(window.inputAssistBridge.cancel()));
bindButtonCommand(document.getElementById("dismissError"), () => runBridgeCommand(window.inputAssistBridge.cancel()));
bindButtonCommand(document.getElementById("closePreview"), () => runBridgeCommand(window.inputAssistBridge.cancel()));
bindButtonCommand(replaceButton, () => {
  showInlineLoading(replaceButton.textContent === "Copy fallback" ? "Copying text..." : "Replacing text...");
  runBridgeCommand(window.inputAssistBridge.replace());
});
bindButtonCommand(document.getElementById("copy"), () => {
  showInlineLoading("Copying text...");
  runBridgeCommand(window.inputAssistBridge.copy());
});
bindButtonCommand(document.getElementById("retry"), () => {
  showInlineLoading("Retrying...");
  runBridgeCommand(window.inputAssistBridge.retry());
});
bindButtonCommand(document.getElementById("customRun"), () => runCustomInstruction());
customInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.shiftKey) {
    return;
  }

  event.preventDefault();
  runCustomInstruction();
});

function bindButtonCommand(button, command) {
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    commandStartedAt = Date.now();
    command();
  });
  button.addEventListener("click", (event) => {
    event.preventDefault();
    if (Date.now() - commandStartedAt < 350) {
      return;
    }

    commandStartedAt = Date.now();
    command();
  });
}

function runCustomInstruction() {
  if (!customInput.value.trim()) {
    showInlineError("Enter a custom instruction.");
    return;
  }

  showInlineLoading("Preparing text...");
  runBridgeCommand(window.inputAssistBridge.runAction("custom", customInput.value));
}

function runBridgeCommand(promise) {
  Promise.resolve(promise).catch(() => {
    showInlineError("Action failed. Try again from the focused input.");
  });
}

function showInlineLoading(message) {
  root.dataset.view = "loading";
  magic.hidden = true;
  menu.hidden = true;
  loading.hidden = false;
  error.hidden = true;
  preview.hidden = true;
  loadingMessage.textContent = message;
}

function showInlineError(message) {
  root.dataset.view = "error";
  magic.hidden = true;
  menu.hidden = true;
  loading.hidden = true;
  error.hidden = false;
  preview.hidden = true;
  errorMessage.textContent = message;
}

window.inputAssistBridge.onState((state) => {
  root.dataset.view = state.view;
  magic.hidden = state.view !== "icon";
  menu.hidden = state.view !== "menu";
  loading.hidden = state.view !== "loading";
  error.hidden = state.view !== "error";
  preview.hidden = state.view !== "preview";

  if (state.view === "menu") {
    customRow.hidden = true;
    customInput.value = "";
  }

  if (state.view === "loading") {
    loadingMessage.textContent = state.message || "Working...";
  }

  if (state.view === "error") {
    errorMessage.textContent = state.message || "Could not complete action.";
  }

  if (state.view === "preview") {
    previewTitle.textContent = `${state.actionLabel || "Rewrite"} preview`;
    const scope = state.scope === "whole" ? "Whole input" : "Selected text";
    const safety =
      state.replaceMode === "window"
        ? "window paste"
        : state.safeReplace === false || state.replaceMode === "copy"
          ? "manual paste"
          : "verified";
    previewMeta.textContent = `${scope} - ${state.originalChars || 0} chars - ${safety}`;
    previewText.value = state.rewrittenText || "";
    replaceButton.textContent =
      state.safeReplace === false || state.replaceMode === "copy"
        ? "Copy fallback"
        : state.replaceMode === "window"
          ? "Paste"
          : "Replace";
  }
});
