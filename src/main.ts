import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { appendFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { assetsDir } from "./app-paths.js";
import { AudioRecorder } from "./audio/audio-recorder.js";
import { GroqCleanupProvider } from "./cleanup/groq-cleanup-provider.js";
import {
  ConfigStore,
  MAX_VOCABULARY_TERMS,
  MAX_VOCABULARY_TERM_CHARS,
  parseVocabularyTerms,
} from "./config-store.js";
import { ModelCooldownManager } from "./llm/model-cooldown.js";
import { AppContextService } from "./context/context-service.js";
import { writeCase, type DebugCase } from "./debug/case-export.js";
import { appNameFromTitle, parseBlocklist } from "./context/context-rules.js";
import { runDictationPipelineWithProviders } from "./dictation/dictation-pipeline.js";
import { app, clipboard, crashReporter, dialog, Menu, nativeImage, shell, Tray } from "./electron.js";
import { HistoryStore } from "./history/history-store.js";
import { HotkeyListener } from "./hotkey/hotkey-listener.js";
import { classifyPress } from "./hotkey/hotkey-parser.js";
import { TextInserter, isUsableTarget, replaceLastOccurrence } from "./insertion/text-inserter.js";
import { configureLogger, logger } from "./observability/app-logger.js";
import { normalizeError, setOnlineChecker, type ErrorCategory, type NormalizedError } from "./observability/errors.js";
import { isOnline, startNetworkMonitor } from "./observability/network-monitor.js";
import { sanitize } from "./observability/logger.js";
import { OverlayDock } from "./overlay/overlay-dock.js";
import {
  DOCK_SNOOZE_MS,
  recoveryForFailure,
  type DockFailure,
  type DockRecoveryAction,
} from "./overlay/overlay-state.js";
import { GroqRewriteProvider } from "./rewrite/groq-rewrite-provider.js";
import {
  MAX_REWRITE_INPUT_CHARS,
  buildRedoInstruction,
  getDockMenuActions,
  getRewriteAction,
  isRewriteActionId,
  type RewriteActionId,
} from "./rewrite/rewrite-actions.js";
import { SettingsWindow } from "./settings-window.js";
import { GroqTranscriptionService } from "./transcription/groq-transcription-service.js";
import type { AppConfig, DictationResult, OperationContext, RuntimeState } from "./types.js";
import type { AppContextSnapshot } from "./context/context-rules.js";
import type { PasteTarget } from "./insertion/text-inserter.js";
import type { RecorderStopReason } from "./audio/recorder-ipc-payloads.js";

const MAX_RECORDING_DURATION_MS = 5 * 60 * 1_000;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
/**
 * `recorder.stop()` waits for a start that is still in flight, so the time it
 * takes tells us whether the recording ever really ran. Measured: a normal stop
 * is 18-23ms, while a stop that sat waiting for a cold microphone was 819ms.
 * Above this, an empty recording means the device was not ready, not that the
 * user said nothing.
 */
const MIC_STILL_OPENING_MS = 250;
const STALE_TEMP_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

let tray: InstanceType<typeof Tray> | null = null;
let config: AppConfig;
let hotkeyListener: HotkeyListener | null = null;
let rewriteHotkeyListener: HotkeyListener | null = null;
let cancelHotkeyListener: HotkeyListener | null = null;
let isRecording = false;
let isProcessing = false;
let isLatched = false;
/**
 * Whether the microphone has actually opened. Opening it costs ~450ms even with
 * the device warmed at startup, and telling the user we are listening before
 * that loses whatever they say in the meantime.
 */
let isRecorderReady = false;
let rewriteInFlight = false;
let activeSessionId: string | null = null;
let activePasteTarget: PasteTarget | null = null;
let rewriteTarget: PasteTarget | null = null;
/** Last window that was genuinely the user's app, used when a capture returns our own overlay. */
let lastGoodTarget: PasteTarget | null = null;
let recordingLimitTimer: NodeJS.Timeout | null = null;
/** Wall-clock start of the current recording, used for the history duration. */
let recordingStartedAt = 0;
let hotkeyAvailable = false;
let lastErrorId = "";
let lastMicError = "";
let logDir = "";
let settingsWindowRef: SettingsWindow | null = null;
let pendingSecondInstanceNotice = false;
let lastPasteTargetCaptured = false;
let lastPasteUsedHandle = false;
let lastStopReason: RecorderStopReason | "" = "";
let configStore: ConfigStore;
let historyStore: HistoryStore;
let modelCooldown: ModelCooldownManager;

/**
 * The last dictation, kept only while debug capture is switched on.
 *
 * Holding this is the whole point of the setting, and the reason it is off by
 * default: it is the one place in the app that deliberately retains what
 * everything else refuses to store.
 */
let lastDebugCase: DebugCase | null = null;
/** Context actually used by the last cleanup, captured for the debug case. */
let lastUsedAppContext: AppContextSnapshot | null = null;
/** True when the guard rejected the last cleanup output. */
let lastGuardTripped = false;

/** Retry closure for the dock's "Try again" recovery button. */
let lastRetry: (() => Promise<void>) | null = null;

/** Set by "Hide for 1 hour" on the pill. Cleared when the timer fires. */
let dockSnoozeTimer: NodeJS.Timeout | null = null;

/**
 * What was last written into the user's document.
 *
 * Redo always rewrites `transcript` (the original speech), never the text it
 * produced last time, so repeated Redos cannot compound. `insertedText` is what
 * currently sits in the document, which is how Redo finds and replaces it.
 */
let lastInsertion: {
  transcript: string;
  insertedText: string;
  target: PasteTarget | null;
  attempt: number;
  pasted: boolean;
  /** Absent for dictation, where Redo re-polishes the raw transcript instead. */
  action?: { id: RewriteActionId; label: string; customInstruction?: string };
} | null = null;

let providerCache: {
  apiKey: string;
  transcriptionModel: string;
  cleanupModel: string;
  cleanupFallbackModel: string;
  transcription: GroqTranscriptionService;
  cleanup: GroqCleanupProvider;
  rewrite: GroqRewriteProvider;
} | null = null;

const recorder = new AudioRecorder();
const inserter = new TextInserter();
// Both hotkeys can be the one still under the user's fingers when we paste, so
// either holding its modifiers is enough to make a synthetic shortcut wait.
// Read through the module bindings rather than captured values, because
// restartHotkeyListeners() replaces the listener objects on every settings save.
inserter.setModifierGuard(
  () =>
    Boolean(hotkeyListener?.areHotkeyModifiersDown()) ||
    Boolean(rewriteHotkeyListener?.areHotkeyModifiersDown()),
);
/**
 * Reads the window signals from the paste target we already captured at the top
 * of `startRecording`, rather than querying the OS a second time. One window
 * lookup, two consumers, and no chance of the two disagreeing about which window
 * the user was actually in.
 */
const contextService = new AppContextService(async () => {
  const title = activePasteTarget?.title ?? "";
  return title ? { title, appName: appNameFromTitle(title) } : null;
});

const dock = new OverlayDock({
  onCancel: () => void cancelRecording(),
  onStop: () => void stopRecording(),
  onDictate: () => startRecording(),
  onMenu: () => openRewriteMenu(),
  onRedo: () => redoLastInsertion(),
  onAction: (actionId, customInstruction) => runRewrite(actionId, customInstruction),
  onRecovery: (action) => runRecovery(action),
  onSettings: async () => {
    dock.showRest();
    await settingsWindowRef?.show();
  },
  onSnooze: () => snoozeDock(),
  onDismiss: () => dock.showRest(),
});

app.setName("BayanFlow");
if (process.platform === "win32") {
  app.setAppUserModelId("com.bayanflow.app");
}
try {
  app.setPath("userData", process.env.BAYANFLOW_USER_DATA_DIR || path.join(app.getPath("appData"), "BayanFlow"));
} catch {
  writeEarlyStartupDiagnostic("user_data_path.fallback");
  // Fall back to Electron's default userData path if appData is unavailable early in startup.
}
configStore = new ConfigStore();
historyStore = new HistoryStore();
// Constructed after userData is settled, because it reads its persisted daily
// limits from there. One instance for the whole app: rate limits are per
// account, so every provider must consult and update the same state.
modelCooldown = new ModelCooldownManager();

if (!app.requestSingleInstanceLock()) {
  writeEarlyStartupDiagnostic("single_instance.already_running");
  app.quit();
}

app.on("second-instance", () => {
  void showAlreadyRunningNotice();
});

try {
  crashReporter.start({
    productName: "BayanFlow",
    companyName: "BayanFlow",
    submitURL: "https://example.invalid/bayanflow-crash",
    uploadToServer: false,
  });
} catch {
  writeEarlyStartupDiagnostic("crash_reporter.start_failed");
  // Crash reporting must not prevent the tray app from starting.
}

app.whenReady()
  .then(async () => {
    logDir = configureLogger(app.getPath("userData"));
    startNetworkMonitor();
    setOnlineChecker(isOnline);
    void logger.info("app.startup.begin");
    await cleanupStaleTempAudio();
    config = await configStore.load();
    applyLoginItemSettings(config);
    warmDictationProviders(config);

    recorder.setUnexpectedErrorHandler(async (error, context) => {
      if (!isRecording || context.sessionId !== activeSessionId) {
        return;
      }

      isRecording = false;
      isProcessing = false;
      isLatched = false;
      clearRecordingLimitTimer();
      activeSessionId = null;
      activePasteTarget = null;
      refreshTray();
      const normalized = normalizeError("recorder", error);
      void logger.error("dictation.recording.failed_async", { ...context, error: normalized });
      showFailure("recorder", formatUserError(normalized.userMessage, normalized.id));
    });

    await recorder.init();
    // Opening the device costs ~1.6s the first time and nothing afterwards, so
    // pay it here rather than inside the user's first dictation. Fire and
    // forget: startup never waits on it and never fails because of it.
    recorder.prewarm(config.microphoneId);
    await dock.init();

    const settingsWindow = new SettingsWindow(
      configStore,
      historyStore,
      async (nextConfig) => {
        const debugCaptureWasOn = config.debugCaptureEnabled;
        config = nextConfig;
        // Turning the setting off must drop what it was holding, or the audio
        // outlives the consent that allowed us to keep it.
        if (debugCaptureWasOn && !config.debugCaptureEnabled) {
          await discardDebugCase();
        }

        applyLoginItemSettings(config);
        warmDictationProviders(config);
        restartHotkeyListeners();
        refreshDockIdle();
        refreshTray();
        showDone("Settings saved", "ok", false);
      },
      () => ({
        hasGroqApiKey: Boolean(config.groqApiKey),
        hotkeyAvailable,
        lastErrorId,
        lastMicError,
        pasteMode: config.autoPaste ? "auto" : "copy",
        logDir,
      }),
      async () => {
        try {
          await recorder.testMicrophone();
          lastMicError = "";
          void logger.info("recorder.mic_test.success");
        } catch (error) {
          const normalized = normalizeError("recorder", error);
          lastErrorId = normalized.id;
          lastMicError = normalized.userMessage;
          void logger.error("recorder.mic_test.failed", { error: normalized });
          throw error;
        }
      },
      () => recorder.listMicrophones(),
    );
    settingsWindowRef = settingsWindow;

    restartHotkeyListeners();
    createTray(settingsWindow);
    refreshDockIdle();
    await showLaunchReadyNotice(settingsWindow);
    if (pendingSecondInstanceNotice) {
      pendingSecondInstanceNotice = false;
      await showAlreadyRunningNotice();
    }
    void logger.info("app.startup.success", { hotkey: config.hotkey, logDir });
  })
  .catch((error) => {
    const normalized = normalizeError("startup", error);
    void logger.error("app.startup.failed", { error: normalized });
    app.quit();
  });

app.on("will-quit", () => {
  void logger.info("app.shutdown.begin");
  hotkeyListener?.stop();
  rewriteHotkeyListener?.stop();
  cancelHotkeyListener?.stop();
  clearRecordingLimitTimer();
  clearDockSnooze();
  recorder.destroy();
  dock.destroy();
});

process.on("unhandledRejection", (error) => {
  void logger.error("process.unhandled_rejection", { error: normalizeError("startup", error) });
});

process.on("uncaughtException", (error) => {
  void logger.error("process.uncaught_exception", { error: normalizeError("startup", error) });
});

/* ------------------------------------------------------------------ *
 * Dock helpers. Every user-visible message goes through exactly one of
 * these, so no status can ever be shown on a surface the user is not
 * looking at.
 * ------------------------------------------------------------------ */

function showListening(): void {
  dock.setView({
    kind: "listening",
    latched: isLatched,
    // Both entry paths run through here — the initial view and the latch on
    // key-up — so the honest hint is decided in one place rather than at each
    // call site.
    hint: !isRecorderReady
      ? "Starting microphone…"
      : isLatched
        ? "Tap hotkey to finish"
        : "Release to finish · Esc cancels",
  });
}

function showWorking(label: string): void {
  dock.setView({ kind: "working", label, startedAt: Date.now() });
}

function showDone(label: string, tone: "ok" | "warn", canRedo: boolean): void {
  dock.setView({ kind: "done", label, tone, canRedo });
}

function showFailure(failure: DockFailure, message: string, retry?: () => Promise<void>): void {
  lastRetry = retry ?? null;
  dock.setView({ kind: "error", message, recovery: recoveryForFailure(failure) });
}

/**
 * Captures the window to act on, refusing our own overlay.
 *
 * The dock can be the foreground window immediately after the user clicks it, so
 * a raw capture sometimes returns BayanFlow instead of the app being typed into.
 * When that happens the last known good window is the right answer: it is the
 * app the user was actually working in.
 */
async function captureTarget(requestId: string): Promise<PasteTarget | null> {
  const captured = await inserter.captureActiveTarget({ requestId });
  if (isUsableTarget(captured)) {
    lastGoodTarget = captured;
    return captured;
  }

  void logger.warn("target.capture.rejected", {
    requestId,
    titleChars: captured?.title.length ?? 0,
    reusedPrevious: Boolean(lastGoodTarget),
  });
  return lastGoodTarget;
}

/**
 * The pill is shown whenever the user wants it and it is not snoozed. Its dot
 * turns grey when the app is not actually ready to dictate.
 */
function refreshDockIdle(): void {
  const enabled = config.showDock && dockSnoozeTimer === null;
  dock.setIdleEnabled(enabled, Boolean(config.groqApiKey) && hotkeyAvailable);
}

function snoozeDock(): void {
  clearDockSnooze();
  dock.hide();
  dockSnoozeTimer = setTimeout(() => {
    dockSnoozeTimer = null;
    refreshDockIdle();
    void logger.info("dock.snooze.expired");
  }, DOCK_SNOOZE_MS);
  void logger.info("dock.snooze.started", { minutes: Math.round(DOCK_SNOOZE_MS / 60000) });
  refreshTray();
}

function clearDockSnooze(): void {
  if (!dockSnoozeTimer) {
    return;
  }

  clearTimeout(dockSnoozeTimer);
  dockSnoozeTimer = null;
}

async function toggleShowDock(): Promise<void> {
  config = { ...config, showDock: !config.showDock };
  clearDockSnooze();
  await configStore.save(config);
  refreshDockIdle();
  refreshTray();
  void logger.info("dock.visibility.toggled", { showDock: config.showDock });
}

/**
 * A retired model id or a rejected key both fail identically on retry, so the
 * dock must offer Settings rather than a Try again button that cannot work.
 */
function failureForGroqError(normalized: NormalizedError, fallback: DockFailure): DockFailure {
  // Checked first: an offline machine produces provider-shaped errors, and
  // telling the user their provider is down sends them to the wrong place.
  if (!normalized.status && !isOnline()) {
    return "offline";
  }

  if (normalized.status === 404) {
    return "model_unavailable";
  }

  if (normalized.status === 401 || normalized.status === 403) {
    return "missing_api_key";
  }

  return fallback;
}

async function runRecovery(action: DockRecoveryAction): Promise<void> {
  switch (action) {
    case "settings":
      dock.showRest();
      await settingsWindowRef?.show();
      return;
    case "retry": {
      const retry = lastRetry;
      lastRetry = null;
      if (retry) {
        await retry();
        return;
      }

      dock.showRest();
      return;
    }
    case "redo":
      await redoLastInsertion();
      return;
    case "copy":
      if (lastInsertion) {
        inserter.copyText(lastInsertion.insertedText, { requestId: createId("recovery-copy") });
        showDone("Copied · press Ctrl+V", "ok", true);
        return;
      }

      dock.showRest();
      return;
    default:
      dock.showRest();
  }
}

/* ------------------------------------------------------------------ *
 * Tray
 * ------------------------------------------------------------------ */

function createTray(settingsWindow: SettingsWindow): void {
  tray?.destroy();
  tray = new Tray(createTrayIcon());
  tray.on("click", () => void settingsWindow.show());
  updateTrayMenu(settingsWindow);
}

function refreshTray(): void {
  const settingsWindow = settingsWindowRef;
  if (!tray || !settingsWindow) {
    return;
  }

  updateTrayMenu(settingsWindow);
}

function updateTrayMenu(settingsWindow: SettingsWindow): void {
  if (!tray) {
    return;
  }

  const runtimeState = getRuntimeState();
  tray.setToolTip(createTrayTooltip(runtimeState));
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Status: ${formatRuntimeState(runtimeState)}`, enabled: false },
      { label: `Dictate: hold ${config.hotkey}`, enabled: false },
      { label: `Rewrite menu: ${config.inputAssistHotkey}`, enabled: false },
      { label: `Hotkey status: ${hotkeyAvailable ? "Active" : "Unavailable"}`, enabled: false },
      { label: `Last error: ${lastErrorId || "None"}`, enabled: false },
      {
        label: "Show the pill",
        type: "checkbox",
        checked: config.showDock && dockSnoozeTimer === null,
        click: () => void toggleShowDock(),
      },
      {
        label: "Paste automatically",
        type: "checkbox",
        checked: config.autoPaste,
        click: () => void toggleAutoPaste(),
      },
      { label: "Add clipboard word to vocabulary", click: () => void addClipboardWordToVocabulary() },
      ...(config.debugCaptureEnabled
        ? [{ label: "Export last dictation for debugging", click: () => void exportDebugCase() }]
        : []),
      { label: "Settings", click: () => void settingsWindow.show() },
      { label: "Open Logs Folder", click: () => void openLogsFolder() },
      { label: "Export Diagnostics", click: () => void exportDiagnostics() },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ]),
  );
}

async function showLaunchReadyNotice(settingsWindow: SettingsWindow): Promise<void> {
  if (!config.groqApiKey) {
    showFailure("missing_api_key", "Add your Groq API key to start dictating.");
    showTrayBalloon("BayanFlow setup needed", "Add your Groq API key to start dictating.");
    await settingsWindow.show();
    void logger.info("app.launch_notice.settings_opened", { reason: "missing_groq_api_key" });
    return;
  }

  showDone(`Ready · hold ${config.hotkey} to dictate`, "ok", false);
  showTrayBalloon("BayanFlow is running", `Hold ${config.hotkey} to dictate. Left-click the tray icon for Settings.`);
  void logger.info("app.launch_notice.ready", { hotkey: config.hotkey });
}

async function showAlreadyRunningNotice(): Promise<void> {
  const settingsWindow = settingsWindowRef;
  if (!settingsWindow) {
    pendingSecondInstanceNotice = true;
    writeEarlyStartupDiagnostic("single_instance.second_instance_pending");
    return;
  }

  await settingsWindow.show();
  showDone("BayanFlow is already running", "ok", false);
  showTrayBalloon("BayanFlow is already running", "Settings opened in the existing app.");
  void logger.info("app.second_instance.notice_shown");
}

function showTrayBalloon(title: string, content: string): void {
  try {
    tray?.displayBalloon({ title, content, icon: createTrayIcon() });
  } catch (error) {
    void logger.debug("tray.balloon.skipped", { error: normalizeError("startup", error) });
  }
}

function createTrayTooltip(runtimeState: RuntimeState): string {
  const hotkey = config?.hotkey || "not configured";
  return `BayanFlow\nStatus: ${formatRuntimeState(runtimeState)}\nHotkey: ${hotkey}`;
}

function getRuntimeState(): RuntimeState {
  if (isRecording) {
    return "recording";
  }

  if (isProcessing || rewriteInFlight) {
    return "processing";
  }

  if (!config?.groqApiKey) {
    return "setup";
  }

  if (!hotkeyAvailable) {
    return "hotkey-unavailable";
  }

  if (lastErrorId) {
    return "error";
  }

  return "ready";
}

function formatRuntimeState(state: RuntimeState): string {
  if (state === "hotkey-unavailable") {
    return "Hotkey unavailable";
  }

  return state[0].toUpperCase() + state.slice(1);
}

/* ------------------------------------------------------------------ *
 * Hotkeys: hold to talk, tap to latch
 * ------------------------------------------------------------------ */

function restartHotkeyListeners(): void {
  hotkeyListener?.stop();
  rewriteHotkeyListener?.stop();
  cancelHotkeyListener?.stop();

  hotkeyListener = new HotkeyListener(config.hotkey, {
    onPressed: () => void handleDictationKeyDown(),
    onReleased: (heldMs) => handleDictationKeyUp(heldMs),
  });
  rewriteHotkeyListener = new HotkeyListener(config.inputAssistHotkey, {
    onPressed: () => void openRewriteMenu(),
  });
  // Esc is observed, not consumed, so the focused app still receives it.
  cancelHotkeyListener = new HotkeyListener("Esc", {
    onPressed: () => {
      if (isRecording) {
        void cancelRecording();
      }
    },
  });

  try {
    hotkeyListener.start();
    rewriteHotkeyListener.start();
    cancelHotkeyListener.start();
    hotkeyAvailable = true;
    refreshDockIdle();
    refreshTray();
  } catch (error) {
    hotkeyAvailable = false;
    const normalized = normalizeError("hotkey", error);
    lastErrorId = normalized.id;
    void logger.error("hotkey.listener.failed", { error: normalized });
    showFailure("hotkey", "Hotkey unavailable. Another app may be using that shortcut.");
    refreshTray();
  }
}

async function handleDictationKeyDown(): Promise<void> {
  if (isRecording) {
    // A second press while latched is the stop gesture.
    if (isLatched) {
      await stopRecording();
    }

    return;
  }

  isLatched = false;
  await startRecording();
}

function handleDictationKeyUp(heldMs: number): void {
  if (!isRecording) {
    return;
  }

  // A hold only means push-to-talk if there was something to talk into. When the
  // key comes up before the microphone finished opening, the press was spent
  // waiting on hardware rather than on speech, and stopping now ends the
  // dictation with an empty file. Latching instead keeps the intent — the user
  // pressed the key because they want to dictate — and costs them one extra tap
  // to finish.
  //
  // This is deliberately not another threshold. Measured presses ran from 128ms
  // to 1,365ms with no clean gap, so no single number separates a slow tap from
  // a short hold. Whether audio was actually being captured is a fact rather
  // than a guess, so the decision is made on that instead.
  const wantsPushToTalk = classifyPress(heldMs) === "hold" && isRecorderReady;

  if (wantsPushToTalk) {
    void logger.info("dictation.gesture", { gesture: "hold", heldMs });
    void stopRecording();
    return;
  }

  isLatched = true;
  void logger.info("dictation.gesture", {
    gesture: "tap_latch",
    heldMs,
    // Distinguishes "the user tapped" from "the user held, but too early to matter".
    latchedWhileStarting: !isRecorderReady,
  });
  showListening();
}

/* ------------------------------------------------------------------ *
 * Dictation
 * ------------------------------------------------------------------ */

async function startRecording(): Promise<void> {
  if (isRecording) {
    return;
  }

  if (isProcessing) {
    showWorking("Still finishing the previous recording");
    return;
  }

  if (!config.groqApiKey) {
    void logger.warn("dictation.start.blocked", { reason: "missing_groq_api_key" });
    showFailure("missing_api_key", "Add your Groq API key to start dictating.");
    return;
  }

  isRecording = true;
  isRecorderReady = false;
  recordingStartedAt = Date.now();
  activeSessionId = createId("session");
  const context = currentContext();
  activePasteTarget = await captureTarget(context.sessionId ?? createId("dictation-target"));
  lastPasteTargetCaptured = Boolean(activePasteTarget);
  lastPasteUsedHandle = activePasteTarget?.handle !== null && activePasteTarget?.handle !== undefined;
  lastStopReason = "";
  // Fired here, while the microphone opens, so it runs alongside the user
  // speaking instead of adding a second to the wait after they stop.
  contextService.start(
    {
      enabled: config.contextCaptureEnabled,
      screenshotEnabled: config.contextScreenshotEnabled,
      model: config.contextModel,
      blocklist: parseBlocklist(config.contextBlocklist),
      apiKey: config.groqApiKey,
    },
    context,
  );
  refreshTray();
  showListening();
  void logger.info("dictation.start", context);

  try {
    await recorder.start(context, {
      microphoneId: config.microphoneId,
      maxDurationMs: MAX_RECORDING_DURATION_MS + 10_000,
      maxAudioBytes: MAX_AUDIO_BYTES,
    });
    // The device is open now, so the prompt can stop hedging. Repainting also
    // covers a tap that latched while we were still waiting.
    isRecorderReady = true;
    if (isRecording) {
      showListening();
    }
    recordingLimitTimer = setTimeout(() => {
      if (isRecording && !isProcessing) {
        void logger.warn("dictation.recording.max_duration_reached", context);
        void stopRecording("max_duration");
      }
    }, MAX_RECORDING_DURATION_MS + 500);
  } catch (error) {
    isRecording = false;
    isLatched = false;
    activeSessionId = null;
    activePasteTarget = null;
    refreshTray();
    const normalized = normalizeError("recorder", error);
    lastErrorId = normalized.id;
    lastMicError = normalized.userMessage;
    void logger.error("dictation.start.failed", { ...context, error: normalized });
    showFailure("recorder", formatUserError(normalized.userMessage, normalized.id));
  }
}

async function cancelRecording(): Promise<void> {
  if (!isRecording || isProcessing) {
    return;
  }

  isRecording = false;
  isLatched = false;
  isProcessing = true;
  clearRecordingLimitTimer();
  contextService.cancel();
  dock.showRest();
  const context = currentContext();
  void logger.info("dictation.cancel", context);
  refreshTray();

  const stopResult = await recorder.stop(context, "manual").catch((error) => {
    void logger.warn("dictation.cancel.stop_failed", { ...context, error: normalizeError("recorder", error) });
    return null;
  });
  if (stopResult?.audioPath) {
    await deleteTempAudio(stopResult.audioPath, context);
  }

  isProcessing = false;
  activeSessionId = null;
  activePasteTarget = null;
  refreshTray();
}

async function stopRecording(reason: RecorderStopReason = "manual"): Promise<void> {
  if (!isRecording || isProcessing) {
    return;
  }

  isRecording = false;
  isLatched = false;
  isProcessing = true;
  clearRecordingLimitTimer();
  showWorking("Finishing recording");
  refreshTray();

  let audioPath: string | null = null;
  let pipelineResult: DictationResult | null = null;
  let failureCategory: ErrorCategory = "recorder";
  let failureKind: DockFailure = "recorder";
  const context = currentContext();
  const latencyStartedAt = Date.now();
  let recorderStopMs = 0;
  let pipelineMs = 0;
  let insertionMs = 0;

  try {
    const stopResult = await recorder.stop(context, reason);
    audioPath = stopResult.audioPath;
    lastStopReason = stopResult.stopReason;
    recorderStopMs = Date.now() - latencyStartedAt;
    if (!audioPath) {
      const micWasStillOpening = recorderStopMs >= MIC_STILL_OPENING_MS;
      void logger.info("dictation.no_speech", {
        ...context,
        stopReason: lastStopReason,
        recorderStopMs,
        micWasStillOpening,
      });
      showDone(formatEmptyRecordingMessage(lastStopReason, micWasStillOpening), "warn", false);
      return;
    }

    failureCategory = "transcription";
    failureKind = "transcription";
    lastUsedAppContext = null;
    lastGuardTripped = false;
    await assertAudioWithinLimits(audioPath);
    const pipelineStartedAt = Date.now();
    const result = await runDictationPipeline(audioPath, context);
    pipelineResult = result;
    pipelineMs = Date.now() - pipelineStartedAt;
    if (!result.finalText) {
      void logger.info("dictation.no_text", context);
      showDone("No text detected", "warn", false);
      return;
    }

    // Fire and forget on purpose: append() never rejects, and history is a
    // convenience that must not add a single millisecond before the paste.
    if (config.historyEnabled) {
      void historyStore.append({
        seconds: recordingStartedAt > 0 ? (latencyStartedAt - recordingStartedAt) / 1000 : 0,
        app: activePasteTarget?.title ?? "",
        raw: result.rawText,
        polished: result.finalText,
      });
    }

    failureCategory = "paste";
    failureKind = "paste_blocked";
    const insertionStartedAt = Date.now();
    await insertOrCopyText(result, context);
    insertionMs = Date.now() - insertionStartedAt;
    void logger.info("dictation.success", {
      ...context,
      autoPaste: config.autoPaste,
      stopReason: lastStopReason,
      rawChars: result.rawText.length,
      finalChars: result.finalText.length,
    });
  } catch (error) {
    const normalized = normalizeError(failureCategory, error);
    lastErrorId = normalized.id;
    void logger.error("dictation.failed", { ...context, error: normalized });
    // A blocked paste is not a lost transcript: pasteText leaves the text on the
    // clipboard, so say that rather than surfacing the raw category message.
    const message =
      failureKind === "paste_blocked"
        ? "Paste blocked. Your text is on the clipboard — press Ctrl+V."
        : formatUserError(normalized.userMessage, normalized.id);
    showFailure(failureForGroqError(normalized, failureKind), message, () => stopRecordingRetry());
  } finally {
    void logger.info("dictation.latency", {
      ...context,
      recorderStopMs,
      pipelineMs,
      insertionMs,
      totalMs: Date.now() - latencyStartedAt,
      cleanupEnabled: config.cleanupEnabled,
      autoPaste: config.autoPaste,
      stopReason: lastStopReason || reason,
    });
    isProcessing = false;
    if (audioPath) {
      if (config.debugCaptureEnabled) {
        await retainDebugCase(audioPath, pipelineResult, context, latencyStartedAt);
      } else {
        await deleteTempAudio(audioPath, context);
      }
    }
    activeSessionId = null;
    activePasteTarget = null;
    refreshTray();
  }
}

/**
 * Keeps the last dictation for export, and drops the one before it.
 *
 * Exactly one case is retained at a time. The alternative is an ever-growing
 * pile of audio on disk holding everything the user has ever said, which is the
 * opposite of what the rest of the app promises.
 */
async function retainDebugCase(
  audioPath: string,
  result: DictationResult | null,
  context: OperationContext,
  startedAt: number,
): Promise<void> {
  const previousAudio = lastDebugCase?.audioPath;
  if (previousAudio && previousAudio !== audioPath) {
    await deleteTempAudio(previousAudio, context);
  }

  lastDebugCase = {
    at: Date.now(),
    audioPath,
    rawText: result?.rawText ?? "",
    finalText: result?.finalText ?? "",
    transcriptionModel: config.transcriptionModel,
    cleanupModel: config.cleanupModel,
    cleanupFallbackModel: config.cleanupFallbackModel,
    transcriptionLanguage: config.transcriptionLanguage,
    outputLanguage: config.outputLanguage,
    vocabulary: parseVocabularyTerms(config.customVocabulary),
    appContext: lastUsedAppContext,
    cleanupEnabled: config.cleanupEnabled,
    preserveExactWording: config.preserveExactWording,
    durationMs: Date.now() - startedAt,
    cleanupError: result?.cleanupFallback ? "cleanup failed; raw transcript inserted" : undefined,
    instructionGuardTripped: lastGuardTripped,
  };

  void logger.info("debug.case.retained", { ...context, hasAudio: true });
}

/**
 * Writes the retained dictation to a folder the user picks.
 *
 * Only ever reachable from an explicit menu action, and only when the setting is
 * on. There is no automatic upload and no default location: the user chooses
 * where their own words go.
 */
/** Drops the retained case and its audio. */
async function discardDebugCase(): Promise<void> {
  const audioPath = lastDebugCase?.audioPath;
  lastDebugCase = null;
  if (audioPath) {
    await deleteTempAudio(audioPath, currentContext());
  }

  void logger.info("debug.case.discarded");
}

async function exportDebugCase(): Promise<void> {
  if (!config.debugCaptureEnabled) {
    showDone("Turn on Capture dictations for debugging in Settings first", "warn", false);
    return;
  }

  if (!lastDebugCase) {
    showDone("Nothing captured yet · dictate once, then export", "warn", false);
    return;
  }

  const picked = await dialog.showOpenDialog({
    title: "Where should the debug case be saved?",
    properties: ["openDirectory", "createDirectory"],
    buttonLabel: "Save case here",
  });

  if (picked.canceled || !picked.filePaths[0]) {
    return;
  }

  try {
    const caseDir = await writeCase(picked.filePaths[0], lastDebugCase);
    void logger.info("debug.case.exported");
    showDone("Debug case saved", "ok", false);
    await shell.openPath(caseDir);
  } catch (error) {
    const normalized = normalizeError("config", error);
    lastErrorId = normalized.id;
    void logger.error("debug.case.export_failed", { error: normalized });
    showFailure("generic", "Could not save the debug case.");
  }
}

/**
 * "Try again" after a failed dictation cannot re-run transcription, because the
 * temp audio is already deleted. It restarts the recording instead, which is
 * what the user wants and what the button implies.
 */
async function stopRecordingRetry(): Promise<void> {
  dock.showRest();
  await startRecording();
}

async function insertOrCopyText(result: DictationResult, context: OperationContext): Promise<void> {
  const text = result.finalText;
  const cleanupFallback = Boolean(result.cleanupFallback);
  const target = activePasteTarget;

  lastInsertion = {
    transcript: result.rawText,
    insertedText: text,
    target,
    attempt: 1,
    pasted: false,
  };

  if (!config.autoPaste) {
    inserter.copyText(text, context);
    showDone(cleanupFallback ? "Copied raw transcript · press Ctrl+V" : "Copied · press Ctrl+V", cleanupFallback ? "warn" : "ok", true);
    return;
  }

  try {
    // Bring the captured window forward first. The user may have finished the
    // recording by clicking the dock, and anything else that took focus in the
    // meantime would otherwise fail the target check inside pasteText.
    if (target) {
      await inserter.focusTargetWindow(target, context);
    }

    await inserter.pasteText(text, context, target);
    lastInsertion.pasted = true;
    showDone(cleanupFallback ? "Pasted raw transcript" : "Pasted", cleanupFallback ? "warn" : "ok", true);
  } catch (error) {
    // pasteText already left the text on the clipboard; stopRecording's catch
    // owns the user-facing message so it is only shown once.
    void logger.warn("dictation.paste.blocked_copied", { ...context, textChars: text.length });
    throw error;
  }
}

/**
 * Adds whatever is on the clipboard to the custom vocabulary.
 *
 * This lives in the tray menu rather than only in Settings on purpose. The
 * moment somebody notices a name came out wrong is the only moment they will
 * ever actually add it; making them open Settings and find a textarea means the
 * field stays empty forever.
 */
async function addClipboardWordToVocabulary(): Promise<void> {
  // First line only: people copy a word, but they also copy a word with a
  // trailing newline, and occasionally a whole paragraph by accident.
  const term = (clipboard.readText() || "").split(/[\r\n]+/)[0]?.trim() ?? "";

  if (!term) {
    showDone("Clipboard is empty · copy a word first", "warn", false);
    return;
  }

  if (term.length > MAX_VOCABULARY_TERM_CHARS) {
    showDone("That is too long for a vocabulary term", "warn", false);
    return;
  }

  const terms = parseVocabularyTerms(config.customVocabulary);
  if (terms.some((existing) => existing.toLowerCase() === term.toLowerCase())) {
    showDone(`Already in vocabulary · ${term}`, "ok", false);
    return;
  }

  if (terms.length >= MAX_VOCABULARY_TERMS) {
    showDone(`Vocabulary is full at ${MAX_VOCABULARY_TERMS} terms · remove one in Settings`, "warn", false);
    return;
  }

  config = { ...config, customVocabulary: [...terms, term].join("\n") };
  await configStore.save(config);
  // The term reaches the model through the prompt, which is rebuilt per request,
  // so nothing needs re-warming — but the count is worth recording.
  showDone(`Added to vocabulary · ${term}`, "ok", false);
  void logger.info("settings.vocabulary.added", { termChars: term.length, totalTerms: terms.length + 1 });
}

async function toggleAutoPaste(): Promise<void> {
  config = { ...config, autoPaste: !config.autoPaste };
  await configStore.save(config);
  refreshTray();
  showDone(config.autoPaste ? "Auto paste on" : "Auto paste off · copy only", "ok", false);
  void logger.info("settings.auto_paste.toggled", { autoPaste: config.autoPaste });
}

/* ------------------------------------------------------------------ *
 * Redo: undo the last paste, re-polish the original transcript, paste again
 * ------------------------------------------------------------------ */

async function redoLastInsertion(): Promise<void> {
  if (!lastInsertion) {
    showFailure("generic", "Nothing to redo yet.");
    return;
  }

  if (!config.groqApiKey) {
    showFailure("missing_api_key", "Add your Groq API key first.");
    return;
  }

  if (rewriteInFlight) {
    return;
  }

  const insertion = lastInsertion;
  const context = { requestId: createId("redo") };
  rewriteInFlight = true;
  insertion.attempt += 1;
  refreshTray();
  showWorking(`Rewriting · attempt ${insertion.attempt}`);

  try {
    // Redo repeats whatever produced the text. After Shorten it shortens again
    // with different wording; after a dictation there is no action, so it
    // re-polishes the raw transcript. Previously every Redo ran the same generic
    // rewrite, which is why a Shorten came back as something unrelated.
    const previous = insertion.action;
    const vocabulary = parseVocabularyTerms(config.customVocabulary);
    const rewritten = await getRewriteProvider(config).rewrite(
      insertion.transcript,
      previous
        ? {
            actionId: previous.id,
            customInstruction: previous.customInstruction,
            attempt: insertion.attempt,
            vocabulary,
          }
        : { actionId: "custom", customInstruction: buildRedoInstruction(insertion.attempt), vocabulary },
      context,
    );

    if (!insertion.pasted) {
      inserter.copyText(rewritten, context);
      insertion.insertedText = rewritten;
      showDone("New version copied · press Ctrl+V", "ok", true);
      return;
    }

    // Ctrl+Z used to be the mechanism here. It is unverifiable: when the host
    // app did not undo, the new version was pasted after the old one and every
    // Redo stacked another paraphrase. Instead, read the input back, splice the
    // previous insertion out of it, and write the result through the checked
    // whole-input path. If the old text is not there, nothing is overwritten.
    const replaced = await replaceInsertedText(insertion, rewritten, context);
    if (!replaced) {
      inserter.copyText(rewritten, context);
      insertion.insertedText = rewritten;
      showFailure("paste_blocked", "Could not find the previous text to replace. New version copied — press Ctrl+V.");
      return;
    }

    insertion.insertedText = rewritten;
    const label = insertion.action ? insertion.action.label : "Polish";
    showDone(`${label} · attempt ${insertion.attempt}`, "ok", true);
    void logger.info("redo.success", {
      attempt: insertion.attempt,
      actionId: insertion.action?.id ?? "dictation",
      outputChars: rewritten.length,
    });
  } catch (error) {
    const normalized = normalizeError("cleanup", error);
    lastErrorId = normalized.id;
    void logger.error("redo.failed", { attempt: insertion.attempt, error: normalized });
    inserter.copyText(insertion.insertedText, context);
    showFailure("paste_blocked", `Redo failed. ${normalized.userMessage} (${normalized.id})`);
  } finally {
    rewriteInFlight = false;
    refreshTray();
  }
}

/**
 * Swaps the text Redo inserted last time for a new version, without trusting an
 * undo that may never have happened.
 *
 * Returns false when the previous text is no longer in the input, or the input
 * is too large to rewrite wholesale. The caller then copies instead of guessing.
 */
async function replaceInsertedText(
  insertion: NonNullable<typeof lastInsertion>,
  nextText: string,
  context: OperationContext,
): Promise<boolean> {
  const target = insertion.target;
  if (!target) {
    return false;
  }

  const whole = await inserter.captureWholeText(target, context);
  if (!whole || !whole.includes(insertion.insertedText)) {
    void logger.warn("redo.previous_text_missing", {
      ...context,
      wholeChars: whole?.length ?? 0,
      previousChars: insertion.insertedText.length,
    });
    return false;
  }

  if (whole.length > MAX_REWRITE_INPUT_CHARS) {
    void logger.warn("redo.input_too_large", { ...context, wholeChars: whole.length });
    return false;
  }

  const next = replaceLastOccurrence(whole, insertion.insertedText, nextText);
  await inserter.replaceWholeTextByClipboard(whole, next, target, context);
  return true;
}

/* ------------------------------------------------------------------ *
 * Rewrite menu
 * ------------------------------------------------------------------ */

async function openRewriteMenu(): Promise<void> {
  if (isRecording || isProcessing) {
    showWorking("Finishing dictation first");
    return;
  }

  if (!config.groqApiKey) {
    showFailure("missing_api_key", "Add your Groq API key to use rewrite.");
    return;
  }

  // Capture the target BEFORE the menu takes focus, otherwise the active
  // window becomes the dock itself.
  rewriteTarget = await captureTarget(createId("rewrite-target"));
  if (!rewriteTarget) {
    showFailure("generic", "Click into the text box first, then press the rewrite hotkey.");
    return;
  }

  dock.setView({
    kind: "menu",
    actions: getDockMenuActions(),
    note: "Rewrites the text in your last input",
  });
}

async function runRewrite(actionId: string, customInstruction?: string): Promise<void> {
  if (!isRewriteActionId(actionId)) {
    void logger.warn("rewrite.unknown_action", { actionId });
    return;
  }

  if (rewriteInFlight) {
    return;
  }

  if (!config.groqApiKey) {
    showFailure("missing_api_key", "Add your Groq API key to use rewrite.");
    return;
  }

  const target = rewriteTarget;
  if (!target) {
    showFailure("generic", "Could not find the input. Click into it and press the rewrite hotkey again.");
    return;
  }

  const action = getRewriteAction(actionId);
  const context = { requestId: createId("rewrite") };
  // Local, not `lastInsertion`: a previous dictation leaves `lastInsertion` set,
  // and reading it here made a failed API call report "could not replace the
  // text" and copy the old dictation onto the clipboard.
  let rewritten: string | null = null;
  rewriteInFlight = true;
  refreshTray();
  showWorking("Reading your text");

  try {
    const { selection, whole } = await inserter.captureSelectionAndWhole(target, context);
    if (!whole || !whole.trim()) {
      showFailure("generic", "No text found in that input. Click into it and try again.");
      return;
    }

    // A copy that returns text does not prove a selection exists: VS Code copies
    // the caret's line when nothing is selected. Treating it as scoped is still
    // right (rewrite that line), but the write must go through the whole input.
    const scoped = Boolean(selection?.trim()) && selection!.trim() !== whole.trim();
    const sourceText = scoped ? selection! : whole;
    const scope = scoped ? "selection" : "whole";

    showWorking(`${action.label}...`);
    rewritten = await getRewriteProvider(config).rewrite(
      sourceText,
      { actionId, customInstruction, vocabulary: parseVocabularyTerms(config.customVocabulary) },
      context,
    );

    lastInsertion = {
      transcript: sourceText,
      insertedText: rewritten,
      target,
      attempt: 1,
      pasted: false,
      action: { id: actionId, label: action.label, customInstruction },
    };

    // Ctrl+A selects everything, so the paste always replaces and can never
    // append. Only a scoped rewrite is spliced back into the surrounding text.
    if (whole.length > MAX_REWRITE_INPUT_CHARS) {
      inserter.copyText(rewritten, context);
      void logger.warn("rewrite.whole_too_large", { ...context, wholeChars: whole.length });
      showFailure("paste_blocked", "That input is too long to edit safely. The rewrite is on your clipboard — press Ctrl+V.");
      return;
    }

    const nextWhole = scoped ? replaceLastOccurrence(whole, selection!, rewritten) : rewritten;
    await inserter.replaceWholeTextByClipboard(whole, nextWhole, target, context);

    lastInsertion.pasted = true;
    lastInsertion.insertedText = scoped ? rewritten : nextWhole;
    showDone(`${action.label} applied`, "ok", true);
    void logger.info("rewrite.success", {
      actionId,
      scope,
      inputChars: sourceText.length,
      outputChars: rewritten.length,
    });
  } catch (error) {
    const normalized = normalizeError("cleanup", error);
    lastErrorId = normalized.id;
    void logger.error("rewrite.failed", { actionId, error: normalized });

    // Only claim a replacement problem when THIS attempt actually produced text.
    if (rewritten) {
      inserter.copyText(rewritten, context);
      showFailure("paste_blocked", "Could not replace the text. The rewrite is on your clipboard — press Ctrl+V.");
      return;
    }

    showFailure(
      failureForGroqError(normalized, "transcription"),
      formatUserError(normalized.userMessage, normalized.id),
      () => runRewrite(actionId, customInstruction),
    );
  } finally {
    rewriteInFlight = false;
    refreshTray();
  }
}

/* ------------------------------------------------------------------ *
 * Providers
 * ------------------------------------------------------------------ */

async function runDictationPipeline(audioPath: string, context: OperationContext): Promise<DictationResult> {
  const providers = getDictationProviders(config);
  const pipeline = await runDictationPipelineWithProviders({
    audioPath,
    context,
    cleanupEnabled: config.cleanupEnabled,
    transcriptionRequestId: createId("transcription"),
    cleanupRequestId: createId("cleanup"),
    transcription: providers.transcription,
    cleanup: config.cleanupEnabled ? providers.cleanup : undefined,
    transcriptionLanguage: config.transcriptionLanguage,
    // Translation rides along with cleanup, so turning polish off also turns
    // translation off. Splitting them is task 17 in the capability audit.
    outputLanguage: config.outputLanguage,
    vocabulary: parseVocabularyTerms(config.customVocabulary),
    // Collected after transcription, so the capture had the whole recording plus
    // the transcription round trip to finish in.
    resolveAppContext: async () => {
      lastUsedAppContext = await contextService.result();
      return lastUsedAppContext;
    },
    preserveExactWording: config.preserveExactWording,
    instructionGuardEnabled: config.instructionGuardEnabled,
    onInstructionGuard: (rawText) => {
      // Not an error: the model answered the dictation instead of cleaning it,
      // and we chose the user's own words over its answer.
      lastGuardTripped = true;
      void logger.warn("dictation.instruction_guard.tripped", { ...context, rawChars: rawText.length });
    },
    onStage: (stage) => {
      showWorking(stage === "transcribing" ? "Transcribing" : "Polishing");
    },
    onCleanupFallback: (error, rawText) => {
      lastErrorId = error.id;
      void logger.error("dictation.cleanup.failed_raw_fallback", { ...context, error, rawChars: rawText.length });
    },
  });

  if (!config.cleanupEnabled) {
    void logger.info("dictation.cleanup.skipped", { ...context, rawChars: pipeline.result.rawText.length });
  }

  return pipeline.result;
}

function warmDictationProviders(nextConfig: AppConfig): void {
  if (!nextConfig.groqApiKey) {
    providerCache = null;
    return;
  }

  getDictationProviders(nextConfig);
}

function getDictationProviders(nextConfig: AppConfig): {
  transcription: GroqTranscriptionService;
  cleanup: GroqCleanupProvider;
  rewrite: GroqRewriteProvider;
} {
  if (
    providerCache &&
    providerCache.apiKey === nextConfig.groqApiKey &&
    providerCache.transcriptionModel === nextConfig.transcriptionModel &&
    providerCache.cleanupModel === nextConfig.cleanupModel &&
    providerCache.cleanupFallbackModel === nextConfig.cleanupFallbackModel
  ) {
    return providerCache;
  }

  providerCache = {
    apiKey: nextConfig.groqApiKey,
    transcriptionModel: nextConfig.transcriptionModel,
    cleanupModel: nextConfig.cleanupModel,
    cleanupFallbackModel: nextConfig.cleanupFallbackModel,
    transcription: new GroqTranscriptionService(nextConfig.groqApiKey, nextConfig.transcriptionModel),
    // One shared cooldown store across providers: rate limits are enforced per
    // account, not per object, so a limit one provider hits applies to them all.
    cleanup: new GroqCleanupProvider(
      nextConfig.groqApiKey,
      nextConfig.cleanupModel,
      nextConfig.cleanupFallbackModel,
      modelCooldown,
    ),
    rewrite: new GroqRewriteProvider(
      nextConfig.groqApiKey,
      nextConfig.cleanupModel,
      nextConfig.cleanupFallbackModel,
      modelCooldown,
    ),
  };
  void logger.info("dictation.providers.ready", {
    transcriptionModel: nextConfig.transcriptionModel,
    cleanupModel: nextConfig.cleanupModel,
    cleanupFallbackModel: nextConfig.cleanupFallbackModel || undefined,
    cleanupEnabled: nextConfig.cleanupEnabled,
  });
  return providerCache;
}

function getRewriteProvider(nextConfig: AppConfig): GroqRewriteProvider {
  return getDictationProviders(nextConfig).rewrite;
}

/* ------------------------------------------------------------------ *
 * Diagnostics, logs, temp files
 * ------------------------------------------------------------------ */

function createTrayIcon() {
  return nativeImage.createFromPath(path.join(assetsDir, "tray-icon.ico"));
}

async function openLogsFolder(): Promise<void> {
  const target = logDir || configureLogger(app.getPath("userData"));
  void logger.info("logs.open_folder", { logDir: target });
  await shell.openPath(target);
}

async function exportDiagnostics(): Promise<void> {
  const target = logDir || configureLogger(app.getPath("userData"));
  await mkdir(target, { recursive: true });
  const exportDir = path.join(target, `diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  await mkdir(exportDir, { recursive: true });
  const diagnostics = {
    appName: app.getName(),
    version: app.getVersion(),
    isPackaged: app.isPackaged,
    os: {
      platform: process.platform,
      arch: process.arch,
      release: os.release(),
      type: os.type(),
    },
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    },
    hotkey: {
      configured: config.hotkey,
      rewriteConfigured: config.inputAssistHotkey,
      available: hotkeyAvailable,
    },
    mic: {
      lastError: lastMicError || "",
    },
    paste: {
      lastTargetCaptured: lastPasteTargetCaptured,
      lastTargetUsedHandle: lastPasteUsedHandle,
    },
    recording: {
      active: isRecording,
      processing: isProcessing,
      latched: isLatched,
      lastStopReason,
    },
    dock: {
      view: dock.currentView().kind,
      visible: dock.isVisible(),
      rewriteInFlight,
      hasLastInsertion: Boolean(lastInsertion),
      lastInsertionAttempt: lastInsertion?.attempt ?? 0,
    },
    lastErrorId,
    settings: {
      hasGroqApiKey: Boolean(config.groqApiKey),
      autoPaste: config.autoPaste,
      cleanupEnabled: config.cleanupEnabled,
      openAtLogin: config.openAtLogin,
      transcriptionModel: config.transcriptionModel,
      cleanupModel: config.cleanupModel,
    },
    paths: {
      userData: app.getPath("userData"),
      logs: target,
      tempAudio: path.join(os.tmpdir(), "whispr-clone"),
    },
  };

  const diagnosticsPath = path.join(exportDir, "diagnostics.json");
  await writeFile(diagnosticsPath, `${JSON.stringify(diagnostics, null, 2)}\n`, "utf8");
  await exportSanitizedLogs(target, exportDir);
  void logger.info("diagnostics.export.success", { exportDir });
  showDone("Diagnostics exported", "ok", false);
  await shell.showItemInFolder(diagnosticsPath);
}

async function exportSanitizedLogs(sourceDir: string, exportDir: string): Promise<void> {
  const files = await readdir(sourceDir).catch(() => []);
  await Promise.all(
    files
      .filter((file) => file.endsWith(".log"))
      .map(async (file) => {
        const sourcePath = path.join(sourceDir, file);
        const targetPath = path.join(exportDir, file);
        const raw = await readFile(sourcePath, "utf8").catch(() => "");
        const sanitized = raw
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => sanitizeLogLine(line))
          .join("\n");
        await writeFile(targetPath, sanitized ? `${sanitized}\n` : "", "utf8");
      }),
  );
}

function sanitizeLogLine(line: string): string {
  try {
    return JSON.stringify(sanitize(JSON.parse(line)));
  } catch {
    return String(sanitize(line));
  }
}

async function deleteTempAudio(audioPath: string, context: OperationContext): Promise<void> {
  await unlink(audioPath)
    .then(() => logger.info("temp_audio.delete.success", context))
    .catch((error) => logger.warn("temp_audio.delete.failed", { ...context, error: normalizeError("recorder", error) }));
}

async function assertAudioWithinLimits(audioPath: string): Promise<void> {
  const info = await stat(audioPath);
  if (info.size > MAX_AUDIO_BYTES) {
    throw new Error("Recording is too large. Try a shorter dictation.");
  }
}

async function cleanupStaleTempAudio(): Promise<void> {
  const dir = path.join(os.tmpdir(), "whispr-clone");
  await mkdir(dir, { recursive: true }).catch(() => undefined);
  const files = await readdir(dir).catch(() => []);
  const cutoff = Date.now() - STALE_TEMP_MAX_AGE_MS;

  await Promise.all(
    files
      .filter((file) => file.endsWith(".webm"))
      .map(async (file) => {
        const filePath = path.join(dir, file);
        const info = await stat(filePath).catch(() => null);
        if (info && info.mtimeMs < cutoff) {
          await unlink(filePath)
            .then(() => logger.info("temp_audio.stale_delete.success"))
            .catch((error) => logger.warn("temp_audio.stale_delete.failed", { error: normalizeError("recorder", error) }));
        }
      }),
  );
}

function clearRecordingLimitTimer(): void {
  if (!recordingLimitTimer) {
    return;
  }

  clearTimeout(recordingLimitTimer);
  recordingLimitTimer = null;
}

function currentContext(): OperationContext {
  return activeSessionId ? { sessionId: activeSessionId } : {};
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function applyLoginItemSettings(nextConfig: AppConfig): void {
  if (!app.isPackaged) {
    void logger.info("startup.login_item.skipped_local", { openAtLogin: nextConfig.openAtLogin });
    return;
  }

  app.setLoginItemSettings({
    openAtLogin: nextConfig.openAtLogin,
    path: process.execPath,
    args: [],
  });
  void logger.info("startup.login_item.updated", { openAtLogin: nextConfig.openAtLogin, isPackaged: app.isPackaged });
}

function formatUserError(message: string, id: string): string {
  return `${message} (${id})`;
}

function formatEmptyRecordingMessage(reason: RecorderStopReason, micWasStillOpening: boolean): string {
  // Blaming the user for silence when the microphone simply had not opened yet
  // sends them looking for a fault that is not theirs. Telling them to press
  // again is also actionable: the device is warm by the time they read it.
  if (micWasStillOpening) {
    return "Microphone was still starting · try again";
  }

  if (reason === "silence") {
    return "Stopped after silence · no speech captured";
  }

  if (reason === "max_duration") {
    return "Recording limit reached · no speech captured";
  }

  return "No speech captured";
}

function writeEarlyStartupDiagnostic(event: string): void {
  try {
    const dir = path.join(process.env.APPDATA || os.tmpdir(), "BayanFlow", "logs");
    mkdirSync(dir, { recursive: true });
    appendFileSync(path.join(dir, "early-startup.log"), `${new Date().toISOString()} ${event}\n`, "utf8");
  } catch {
    // Early diagnostics are best-effort only.
  }
}
