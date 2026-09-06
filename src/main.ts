import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { appendFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AudioRecorder } from "./audio/audio-recorder.js";
import { GroqCleanupProvider } from "./cleanup/groq-cleanup-provider.js";
import { ConfigStore } from "./config-store.js";
import { runDictationPipelineWithProviders } from "./dictation/dictation-pipeline.js";
import { app, crashReporter, Menu, nativeImage, shell, Tray } from "./electron.js";
import { HotkeyListener } from "./hotkey/hotkey-listener.js";
import { classifyPress } from "./hotkey/hotkey-parser.js";
import { TextInserter } from "./insertion/text-inserter.js";
import { configureLogger, logger } from "./observability/app-logger.js";
import { normalizeError, type ErrorCategory, type NormalizedError } from "./observability/errors.js";
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
  buildRedoInstruction,
  getDockMenuActions,
  getRewriteAction,
  isRewriteActionId,
  type RewriteActionId,
} from "./rewrite/rewrite-actions.js";
import { SettingsWindow } from "./settings-window.js";
import { GroqTranscriptionService } from "./transcription/groq-transcription-service.js";
import type { AppConfig, DictationResult, OperationContext, RuntimeState } from "./types.js";
import type { PasteTarget } from "./insertion/text-inserter.js";
import type { RecorderStopReason } from "./audio/recorder-ipc-payloads.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAX_RECORDING_DURATION_MS = 5 * 60 * 1_000;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const STALE_TEMP_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

let tray: InstanceType<typeof Tray> | null = null;
let config: AppConfig;
let hotkeyListener: HotkeyListener | null = null;
let rewriteHotkeyListener: HotkeyListener | null = null;
let cancelHotkeyListener: HotkeyListener | null = null;
let isRecording = false;
let isProcessing = false;
let isLatched = false;
let rewriteInFlight = false;
let activeSessionId: string | null = null;
let activePasteTarget: PasteTarget | null = null;
let rewriteTarget: PasteTarget | null = null;
let recordingLimitTimer: NodeJS.Timeout | null = null;
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

/** Retry closure for the dock's "Try again" recovery button. */
let lastRetry: (() => Promise<void>) | null = null;

/** Set by "Hide for 1 hour" on the pill. Cleared when the timer fires. */
let dockSnoozeTimer: NodeJS.Timeout | null = null;

/**
 * What was last written into the user's document. Redo rewrites `transcript`
 * (the original speech), undoes the paste, and pastes the new version, so
 * repeated Redos never compound on an already-rewritten string.
 */
let lastInsertion: {
  transcript: string;
  insertedText: string;
  target: PasteTarget | null;
  attempt: number;
  pasted: boolean;
} | null = null;

let providerCache: {
  apiKey: string;
  transcriptionModel: string;
  cleanupModel: string;
  transcription: GroqTranscriptionService;
  cleanup: GroqCleanupProvider;
  rewrite: GroqRewriteProvider;
} | null = null;

const recorder = new AudioRecorder();
const inserter = new TextInserter();
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
    await dock.init();

    const settingsWindow = new SettingsWindow(
      configStore,
      async (nextConfig) => {
        config = nextConfig;
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
    hint: isLatched ? "Tap hotkey to finish" : "Release to finish · Esc cancels",
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

  if (classifyPress(heldMs) === "hold") {
    void logger.info("dictation.gesture", { gesture: "hold", heldMs });
    void stopRecording();
    return;
  }

  isLatched = true;
  void logger.info("dictation.gesture", { gesture: "tap_latch", heldMs });
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
  activeSessionId = createId("session");
  const context = currentContext();
  activePasteTarget = await inserter.captureActiveTarget(context);
  lastPasteTargetCaptured = Boolean(activePasteTarget);
  lastPasteUsedHandle = activePasteTarget?.handle !== null && activePasteTarget?.handle !== undefined;
  lastStopReason = "";
  refreshTray();
  showListening();
  void logger.info("dictation.start", context);

  try {
    await recorder.start(context, {
      maxDurationMs: MAX_RECORDING_DURATION_MS + 10_000,
      maxAudioBytes: MAX_AUDIO_BYTES,
    });
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
      void logger.info("dictation.no_speech", { ...context, stopReason: lastStopReason });
      showDone(formatEmptyRecordingMessage(lastStopReason), "warn", false);
      return;
    }

    failureCategory = "transcription";
    failureKind = "transcription";
    await assertAudioWithinLimits(audioPath);
    const pipelineStartedAt = Date.now();
    const result = await runDictationPipeline(audioPath, context);
    pipelineMs = Date.now() - pipelineStartedAt;
    if (!result.finalText) {
      void logger.info("dictation.no_text", context);
      showDone("No text detected", "warn", false);
      return;
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
      await deleteTempAudio(audioPath, context);
    }
    activeSessionId = null;
    activePasteTarget = null;
    refreshTray();
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
    const rewritten = await getRewriteProvider(config).rewrite(
      insertion.transcript,
      { actionId: "custom", customInstruction: buildRedoInstruction(insertion.attempt) },
      context,
    );

    if (!insertion.pasted) {
      inserter.copyText(rewritten, context);
      insertion.insertedText = rewritten;
      showDone("New version copied · press Ctrl+V", "ok", true);
      return;
    }

    await inserter.sendUndo(context, insertion.target);
    await inserter.pasteText(rewritten, context, insertion.target);
    insertion.insertedText = rewritten;
    showDone(`Replaced · attempt ${insertion.attempt}`, "ok", true);
    void logger.info("redo.success", { attempt: insertion.attempt, outputChars: rewritten.length });
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
  rewriteTarget = await inserter.captureActiveTarget({ requestId: createId("rewrite-target") });

  dock.setView({
    kind: "menu",
    actions: getDockMenuActions(),
    expanded: false,
    note: rewriteTarget ? "Rewrites the text in your last input" : "No input detected · result will be copied",
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
    const source = await inserter.captureTextFromTargetByClipboard(target, context);
    if (!source || !source.text.trim()) {
      showFailure("generic", "No text found in that input. Type or select something first.");
      return;
    }

    showWorking(`${action.label}...`);
    rewritten = await getRewriteProvider(config).rewrite(
      source.text,
      { actionId, customInstruction },
      context,
    );

    lastInsertion = {
      transcript: source.text,
      insertedText: rewritten,
      target,
      attempt: 1,
      pasted: false,
    };

    // captureTextFromTargetByClipboard leaves the source text selected, but a
    // network round-trip has passed since. replaceWholeTextByClipboard
    // re-verifies the input before overwriting; a plain selection paste asserts
    // the window instead. Either way a mismatch falls back to copy.
    if (source.scope === "whole") {
      await inserter.replaceWholeTextByClipboard(source.text, rewritten, target, context);
    } else {
      await inserter.focusTargetWindow(target, context);
      await inserter.pasteText(rewritten, context, target);
    }

    lastInsertion.pasted = true;
    showDone(`${action.label} applied`, "ok", true);
    void logger.info("rewrite.success", {
      actionId,
      scope: source.scope,
      inputChars: source.text.length,
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
    providerCache.cleanupModel === nextConfig.cleanupModel
  ) {
    return providerCache;
  }

  providerCache = {
    apiKey: nextConfig.groqApiKey,
    transcriptionModel: nextConfig.transcriptionModel,
    cleanupModel: nextConfig.cleanupModel,
    transcription: new GroqTranscriptionService(nextConfig.groqApiKey, nextConfig.transcriptionModel),
    cleanup: new GroqCleanupProvider(nextConfig.groqApiKey, nextConfig.cleanupModel),
    rewrite: new GroqRewriteProvider(nextConfig.groqApiKey, nextConfig.cleanupModel),
  };
  void logger.info("dictation.providers.ready", {
    transcriptionModel: nextConfig.transcriptionModel,
    cleanupModel: nextConfig.cleanupModel,
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
  return nativeImage.createFromPath(path.join(__dirname, "assets", "tray-icon.ico"));
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

function formatEmptyRecordingMessage(reason: RecorderStopReason): string {
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
