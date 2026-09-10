/*
 * Dock renderer logic.
 *
 * Owns three things:
 *  1. which section is visible for the current view
 *  2. local tickers (recording time, processing elapsed) so the main process
 *     does not have to send a message every second
 *  3. reporting its own measured height back to the main process
 *
 * It never decides where the window goes. That is overlay-state.ts.
 */

// Owned here, not in overlay-state.ts: only the renderer runs these tickers.
const ELAPSED_AFTER_MS = 3000;
const SLOW_AFTER_MS = 8000;

const dock = document.getElementById("dock");

const HOVER_COLLAPSE_MS = 350;

const sections = {
  idle: document.getElementById("view-idle"),
  listening: document.getElementById("view-listening"),
  working: document.getElementById("view-working"),
  done: document.getElementById("view-done"),
  menu: document.getElementById("view-menu"),
  error: document.getElementById("view-error"),
};

const el = {
  pillDot: document.getElementById("pillDot"),
  listenTimer: document.getElementById("listenTimer"),
  listenHint: document.getElementById("listenHint"),
  workingLabel: document.getElementById("workingLabel"),
  workingElapsed: document.getElementById("workingElapsed"),
  doneDot: document.getElementById("doneDot"),
  doneLabel: document.getElementById("doneLabel"),
  doneRedo: document.getElementById("doneRedo"),
  menuNote: document.getElementById("menuNote"),
  menuActions: document.getElementById("menuActions"),
  customRow: document.getElementById("customRow"),
  customInput: document.getElementById("customInput"),
  errorMessage: document.getElementById("errorMessage"),
  errorAction: document.getElementById("errorAction"),
  errorActionLabel: document.getElementById("errorActionLabel"),
};

let view = { kind: "hidden" };
let ticker = null;
let listeningStartedAt = 0;
let pendingRecovery = null;
let collapseTimer = null;

/* ---------- transport ---------- */

function send(name, payload) {
  Promise.resolve(window.dockBridge.send(name, payload)).catch(() => {
    /* Main logs command failures; the renderer has nothing useful to add. */
  });
}

/* ---------- rendering ---------- */

window.dockBridge.onView((next) => {
  view = next && typeof next.kind === "string" ? next : { kind: "hidden" };
  render();
});

function render() {
  stopTicker();
  clearCollapseTimer();
  dock.dataset.view = view.kind;
  // Every state change starts collapsed; hovering is what expands the pill.
  dock.dataset.hover = "false";

  for (const [kind, node] of Object.entries(sections)) {
    node.hidden = kind !== view.kind;
  }

  if (view.kind === "idle") {
    el.pillDot.dataset.ready = view.ready === false ? "false" : "true";
  } else if (view.kind === "listening") {
    renderListening();
  }

  if (view.kind === "working") {
    renderWorking();
  } else if (view.kind === "done") {
    renderDone();
  } else if (view.kind === "menu") {
    renderMenu();
  } else if (view.kind === "error") {
    renderError();
  }

  reportSize();
}

function renderListening() {
  listeningStartedAt = Date.now();
  el.listenHint.textContent = view.hint || "";
  el.listenTimer.textContent = "0:00";
  startTicker(() => {
    el.listenTimer.textContent = formatClock(Date.now() - listeningStartedAt);
  });
}

function renderWorking() {
  el.workingLabel.textContent = view.label || "Working";
  el.workingElapsed.textContent = "";
  const startedAt = Number(view.startedAt) || Date.now();

  startTicker(() => {
    const elapsed = Date.now() - startedAt;
    if (elapsed >= SLOW_AFTER_MS) {
      el.workingElapsed.textContent = `${formatClock(elapsed)} · taking longer than usual`;
      return;
    }

    el.workingElapsed.textContent = elapsed >= ELAPSED_AFTER_MS ? formatClock(elapsed) : "";
  });
}

function renderDone() {
  el.doneLabel.textContent = view.label || "Done";
  el.doneDot.className = view.tone === "warn" ? "dot dot-warn" : "dot";
  el.doneRedo.hidden = view.canRedo === false;
}

function renderMenu() {
  const actions = Array.isArray(view.actions) ? view.actions : [];
  el.menuNote.textContent = view.note || "";
  el.customRow.hidden = true;
  el.customInput.value = "";

  // Every action at once. There is no More button any more: the grid wraps.
  el.menuActions.replaceChildren(...actions.map(createActionButton));
}

function renderError() {
  el.errorMessage.textContent = view.message || "Something went wrong.";
  pendingRecovery = view.recovery && view.recovery.action ? view.recovery.action : null;

  if (!pendingRecovery || pendingRecovery === "dismiss") {
    el.errorAction.hidden = true;
    return;
  }

  el.errorAction.hidden = false;
  el.errorActionLabel.textContent = view.recovery.label || "Retry";
}

function createActionButton(action) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-compact";
  button.dataset.actionId = action.id;

  const label = document.createElement("span");
  label.textContent = action.label;
  button.append(label);

  button.addEventListener("click", () => {
    if (action.id === "custom") {
      el.customRow.hidden = false;
      el.customInput.focus();
      reportSize();
      return;
    }

    send("action", { actionId: action.id });
  });

  return button;
}

/* ---------- tickers ---------- */

function startTicker(tick) {
  tick();
  ticker = setInterval(tick, 250);
}

function stopTicker() {
  if (ticker) {
    clearInterval(ticker);
    ticker = null;
  }
}

function formatClock(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/* ---------- self-measurement ---------- */

function reportSize() {
  const rect = dock.getBoundingClientRect();
  const width = Math.ceil(rect.width);
  const height = Math.ceil(rect.height);
  if (width > 0 && height > 0) {
    window.dockBridge.reportSize({ width, height });
  }
}

new ResizeObserver(() => reportSize()).observe(dock);

/* ---------- idle pill hover ---------- */

function clearCollapseTimer() {
  if (collapseTimer) {
    clearTimeout(collapseTimer);
    collapseTimer = null;
  }
}

dock.addEventListener("mouseenter", () => {
  if (view.kind !== "idle") {
    return;
  }

  clearCollapseTimer();
  dock.dataset.hover = "true";
  reportSize();
});

dock.addEventListener("mouseleave", () => {
  if (view.kind !== "idle") {
    return;
  }

  // Short grace period so crossing a gap between controls does not collapse it.
  clearCollapseTimer();
  collapseTimer = setTimeout(() => {
    dock.dataset.hover = "false";
    reportSize();
  }, HOVER_COLLAPSE_MS);
});

/* ---------- controls ---------- */

document.getElementById("pillCore").addEventListener("click", () => send("dictate"));
document.getElementById("pillDictate").addEventListener("click", () => send("dictate"));
document.getElementById("pillRewrite").addEventListener("click", () => send("menu"));
document.getElementById("pillSettings").addEventListener("click", () => send("settings"));
document.getElementById("pillSnooze").addEventListener("click", () => send("snooze"));
document.getElementById("listenStop").addEventListener("click", () => send("stop"));
document.getElementById("listenCancel").addEventListener("click", () => send("cancel"));
document.getElementById("workingCancel").addEventListener("click", () => send("cancel"));
document.getElementById("doneRedo").addEventListener("click", () => send("redo"));
document.getElementById("donePolish").addEventListener("click", () => send("menu"));
document.getElementById("doneClose").addEventListener("click", () => send("dismiss"));
document.getElementById("menuClose").addEventListener("click", () => send("dismiss"));
document.getElementById("errorClose").addEventListener("click", () => send("dismiss"));

el.errorAction.addEventListener("click", () => {
  if (pendingRecovery) {
    send("recovery", pendingRecovery);
  }
});

document.getElementById("customRun").addEventListener("click", runCustom);

el.customInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    runCustom();
  }
});

function runCustom() {
  const instruction = el.customInput.value.trim();
  if (!instruction) {
    el.customInput.focus();
    return;
  }

  send("action", { actionId: "custom", customInstruction: instruction });
}

/* Only the menu takes focus, so this is the only view where keydown reaches us. */
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    send("dismiss");
  }
});
