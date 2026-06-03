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
import { InputAssistWindow } from "./input-assist-window.js";
import {
  shouldPreferClipboardSelectionOverUiaWhole,
  shouldPreferClipboardWholeOverUiaWhole,
} from "./input-assist/rewrite-source-selection.js";
import { getInputAssistSpeechReadiness } from "./input-assist/speech-readiness.js";
import { UiaHelperClient } from "./input-assist/uia-helper.js";
import { TextInserter } from "./insertion/text-inserter.js";
import { configureLogger, logger } from "./observability/app-logger.js";
import { normalizeError, type ErrorCategory } from "./observability/errors.js";
import { sanitize } from "./observability/logger.js";
import { GroqRewriteProvider } from "./rewrite/groq-rewrite-provider.js";
import { getRewriteAction, type RewriteActionId } from "./rewrite/rewrite-actions.js";
import { SettingsWindow } from "./settings-window.js";
import { StatusOverlay } from "./status-overlay.js";
import { GroqTranscriptionService } from "./transcription/groq-transcription-service.js";
import type { AppConfig, DictationResult, OperationContext, RuntimeState } from "./types.js";
import type { PasteTarget } from "./insertion/text-inserter.js";
import type { RecorderStopReason } from "./audio/recorder-ipc-payloads.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAX_RECORDING_DURATION_MS = 5 * 60 * 1_000;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const STALE_TEMP_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const INPUT_ASSIST_ACTION_TIMEOUT_MS = 60_000;

let tray: InstanceType<typeof Tray> | null = null;
let config: AppConfig;
let hotkeyListener: HotkeyListener | null = null;
let inputAssistHotkeyListener: HotkeyListener | null = null;
let isRecording = false;
let isProcessing = false;
let inputAssistEnabled = false;
let inputAssistInteractionActive = false;
let inputAssistActionInFlight = false;
let inputAssistActionTimer: NodeJS.Timeout | null = null;
let activeSessionId: string | null = null;
let activePasteTarget: PasteTarget | null = null;
let inputAssistOriginPasteTarget: PasteTarget | null = null;
let inputAssistOriginWindowHandle: number | null = null;
let recordingLimitTimer: NodeJS.Timeout | null = null;
let inputAssistPollTimer: NodeJS.Timeout | null = null;
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
let providerCache: {
  apiKey: string;
  transcriptionModel: string;
  cleanupModel: string;
  transcription: GroqTranscriptionService;
  cleanup: GroqCleanupProvider;
  rewrite: GroqRewriteProvider;
} | null = null;
let pendingRewrite: {
  targetKind: "uia" | "clipboard";
  sourceText: string;
  rewrittenText: string;
  scope: "selection" | "whole";
  targetId: string | null;
  pasteTarget: PasteTarget | null;
  actionId: RewriteActionId;
  customInstruction?: string;
  actionLabel: string;
} | null = null;

type RewriteTextSource = {
  targetKind: "uia" | "clipboard";
  scope: "selection" | "whole";
  text: string;
  targetId: string | null;
  pasteTarget: PasteTarget | null;
};

const recorder = new AudioRecorder();
const inserter = new TextInserter();
const statusOverlay = new StatusOverlay();
const inputAssistHelper = new UiaHelperClient();
const inputAssistWindow = new InputAssistWindow({
  onMenuOpened: () => {
    inputAssistInteractionActive = true;
    inputAssistWindow.showMenu();
  },
  onAction: (actionId, customInstruction) =>
    runInputAssistAction(`rewrite:${actionId}`, () => runInputAssistRewrite(actionId, customInstruction)),
  onSpeak: () => runInputAssistAction("speak", () => speakHere()),
  onReplace: () => runInputAssistAction("replace", () => replacePendingRewrite()),
  onCopy: () => runInputAssistAction("copy", () => copyPendingRewrite()),
  onRetry: () => runInputAssistAction("retry", () => retryPendingRewrite()),
  onCancel: () => closeInputAssistInteraction(),
  onBlur: () => handleInputAssistWindowBlur(),
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
      clearRecordingLimitTimer();
      activeSessionId = null;
      activePasteTarget = null;
      refreshTray();
      const normalized = normalizeError("recorder", error);
      void logger.error("dictation.recording.failed_async", { ...context, error: normalized });
      showStatus("error", formatUserError(normalized.userMessage, normalized.id));
    });

    await recorder.init();
    await statusOverlay.init();
    await inputAssistWindow.init();

    const settingsWindow = new SettingsWindow(
      configStore,
      async (nextConfig) => {
        config = nextConfig;
        applyLoginItemSettings(config);
        warmDictationProviders(config);
        restartHotkeyListener();
        refreshTray();
        showStatus("idle", "Settings saved");
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

    restartHotkeyListener();
    createTray(settingsWindow);
    await setInputAssistEnabled(config.inputAssistEnabledOnStartup, { silent: true });
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
  inputAssistHotkeyListener?.stop();
  clearRecordingLimitTimer();
  stopInputAssistPolling();
  recorder.destroy();
  statusOverlay.destroy();
  inputAssistWindow.destroy();
  inputAssistHelper.destroy();
});

process.on("unhandledRejection", (error) => {
  void logger.error("process.unhandled_rejection", { error: normalizeError("startup", error) });
});

process.on("uncaughtException", (error) => {
  void logger.error("process.uncaught_exception", { error: normalizeError("startup", error) });
});

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
      { label: `Hotkey: ${config.hotkey}`, enabled: false },
      { label: `Input Assist: ${inputAssistEnabled ? "On" : "Off"} (${config.inputAssistHotkey})`, enabled: false },
      { label: `Hotkey status: ${hotkeyAvailable ? "Active" : "Unavailable"}`, enabled: false },
      { label: `Last error: ${lastErrorId || "None"}`, enabled: false },
      {
        label: "Toggle Input Assist",
        type: "checkbox",
        checked: inputAssistEnabled,
        click: () => void setInputAssistEnabled(!inputAssistEnabled),
      },
      {
        label: "Auto paste after recording",
        type: "checkbox",
        checked: config.autoPaste,
        click: () => void toggleAutoPaste(settingsWindow),
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
    showStatus("error", "Add your Groq API key");
    showTrayBalloon("BayanFlow setup needed", "Add your Groq API key to start dictating.");
    await settingsWindow.show();
    void logger.info("app.launch_notice.settings_opened", { reason: "missing_groq_api_key" });
    return;
  }

  const message = `BayanFlow running: ${config.hotkey}`;
  showStatus("idle", message);
  showTrayBalloon("BayanFlow is running", `Use ${config.hotkey} to dictate. Left-click the tray icon for Settings.`);
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
  showStatus("idle", "BayanFlow is already running");
  showTrayBalloon("BayanFlow is already running", "Settings opened in the existing app.");
  void logger.info("app.second_instance.notice_shown");
}

function showTrayBalloon(title: string, content: string): void {
  try {
    tray?.displayBalloon({
      title,
      content,
      icon: createTrayIcon(),
    });
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

  if (isProcessing) {
    return "processing";
  }

  if (inputAssistEnabled) {
    return "input-assist";
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

function restartHotkeyListener(): void {
  hotkeyListener?.stop();
  inputAssistHotkeyListener?.stop();
  hotkeyListener = new HotkeyListener(config.hotkey, {
    onPressed: () => void toggleRecording(),
  });
  inputAssistHotkeyListener = new HotkeyListener(config.inputAssistHotkey, {
    onPressed: () => void setInputAssistEnabled(!inputAssistEnabled),
  });

  try {
    hotkeyListener.start();
    inputAssistHotkeyListener.start();
    hotkeyAvailable = true;
    refreshTray();
  } catch (error) {
    hotkeyAvailable = false;
    const normalized = normalizeError("hotkey", error);
    lastErrorId = normalized.id;
    void logger.error("hotkey.listener.failed", { error: normalized });
    showStatus("error", formatUserError(normalized.userMessage, normalized.id));
    refreshTray();
  }
}

async function toggleRecording(): Promise<void> {
  if (isRecording) {
    if (statusOverlay.acceptPendingConfirm()) {
      return;
    }

    await stopRecording();
    return;
  }

  await startRecording();
}

async function startRecording(): Promise<void> {
  if (isRecording) {
    return;
  }

  if (isProcessing) {
    showStatus("processing", "Still processing previous recording...");
    return;
  }

  if (!config.groqApiKey) {
    void logger.warn("dictation.start.blocked", { reason: "missing_groq_api_key" });
    showStatus("error", "Add your Groq API key");
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
    void waitForRecordingDecision();
  } catch (error) {
    isRecording = false;
    activeSessionId = null;
    activePasteTarget = null;
    refreshTray();
    const normalized = normalizeError("recorder", error);
    lastErrorId = normalized.id;
    lastMicError = normalized.userMessage;
    void logger.error("dictation.start.failed", { ...context, error: normalized });
    showStatus("error", formatUserError(normalized.userMessage, normalized.id));
  }
}

async function waitForRecordingDecision(): Promise<void> {
  const accepted = await statusOverlay.confirm("Recording - press hotkey again or check to finish");

  if (accepted) {
    await stopRecording();
    return;
  }

  await cancelRecording();
}

async function cancelRecording(): Promise<void> {
  if (!isRecording || isProcessing) {
    return;
  }

  isRecording = false;
  isProcessing = true;
  clearRecordingLimitTimer();
  showStatus("idle", "Canceled");
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
  isProcessing = true;
  clearRecordingLimitTimer();
  showStatus("processing", "Preparing recording...");
  refreshTray();

  let audioPath: string | null = null;
  let failureCategory: ErrorCategory = "recorder";
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
      showStatus("idle", formatEmptyRecordingMessage(lastStopReason));
      return;
    }

    failureCategory = "transcription";
    await assertAudioWithinLimits(audioPath);
    const pipelineStartedAt = Date.now();
    const result = await runDictationPipeline(audioPath, context);
    pipelineMs = Date.now() - pipelineStartedAt;
    if (!result.finalText) {
      void logger.info("dictation.no_text", context);
      showStatus("idle", "No text detected");
      return;
    }

    failureCategory = "paste";
    const insertionStartedAt = Date.now();
    await insertOrCopyText(result.finalText, context, Boolean(result.cleanupFallback));
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
    showStatus("error", formatUserError(normalized.userMessage, normalized.id));
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

async function insertOrCopyText(text: string, context: OperationContext, cleanupFallback = false): Promise<void> {
  if (!config.autoPaste) {
    inserter.copyText(text, context);
    showStatus("idle", cleanupFallback ? "Copied raw transcript; review/edit" : "Copied");
    return;
  }

  showStatus("pasting", "Pasting...");
  try {
    await inserter.pasteText(text, context, activePasteTarget);
    showStatus("idle", cleanupFallback ? "Pasted raw transcript; review/edit" : "Pasted");
  } catch (error) {
    showStatus("error", "Paste blocked; text copied. Press Ctrl+V manually.");
    throw error;
  }
}

async function toggleAutoPaste(settingsWindow: SettingsWindow): Promise<void> {
  if (!config.autoPaste) {
    showStatus("idle", "Review auto-paste warning in Settings");
    await settingsWindow.show();
    return;
  }

  config = {
    ...config,
    autoPaste: false,
  };
  await configStore.save(config);
  refreshTray();
  showStatus("idle", "Auto paste off");
  void logger.info("settings.auto_paste.toggled", { autoPaste: config.autoPaste });
}

async function setInputAssistEnabled(enabled: boolean, options: { silent?: boolean } = {}): Promise<void> {
  if (inputAssistEnabled === enabled) {
    return;
  }

  inputAssistEnabled = enabled;
  inputAssistInteractionActive = false;
  inputAssistActionInFlight = false;
  clearInputAssistActionTimer();
  pendingRewrite = null;
  if (enabled) {
    inputAssistOriginPasteTarget = await inserter.captureActiveTarget({ requestId: createId("input-assist-origin") });
    inputAssistWindow.setContextBounds(inputAssistOriginPasteTarget?.bounds);
    inputAssistOriginWindowHandle = null;
    startInputAssistPolling();
    if (!options.silent) {
      showStatus("idle", "Input Assist on");
    }
    void logger.info("input_assist.enabled");
  } else {
    stopInputAssistPolling();
    inputAssistOriginPasteTarget = null;
    inputAssistOriginWindowHandle = null;
    inputAssistWindow.hide();
    if (!options.silent) {
      showStatus("idle", "Input Assist off");
    }
    void logger.info("input_assist.disabled");
  }

  refreshTray();
}

function startInputAssistPolling(): void {
  stopInputAssistPolling();
  inputAssistPollTimer = setInterval(() => {
    void refreshInputAssistTarget();
  }, 500);
  void refreshInputAssistTarget();
}

function stopInputAssistPolling(): void {
  if (inputAssistPollTimer) {
    clearInterval(inputAssistPollTimer);
    inputAssistPollTimer = null;
  }
}

async function refreshInputAssistTarget(): Promise<void> {
  if (!inputAssistEnabled || inputAssistInteractionActive || isRecording || isProcessing) {
    return;
  }

  try {
    const target = await inputAssistHelper.getTarget();
    if (!target) {
      inputAssistWindow.showFallbackIcon(inputAssistOriginPasteTarget?.bounds);
      return;
    }

    if (shouldDisableInputAssistForWindowChange(target.windowHandle)) {
      void logger.info("input_assist.auto_disabled", { reason: "target_window_changed" });
      await setInputAssistEnabled(false);
      return;
    }

    inputAssistWindow.showIcon(target);
  } catch (error) {
    void logger.debug("input_assist.target.skipped", { error: normalizeError("startup", error) });
    inputAssistWindow.showFallbackIcon(inputAssistOriginPasteTarget?.bounds);
  }
}

async function runInputAssistAction(actionName: string, action: () => Promise<void>): Promise<void> {
  if (inputAssistActionInFlight) {
    inputAssistWindow.showLoading("Still working...");
    void logger.warn("input_assist.action.ignored_busy", { actionName });
    return;
  }

  const startedAt = Date.now();
  inputAssistActionInFlight = true;
  void logger.info("input_assist.action.start", { actionName });
  inputAssistActionTimer = setTimeout(() => {
    if (!inputAssistActionInFlight) {
      return;
    }

    inputAssistActionInFlight = false;
    inputAssistActionTimer = null;
    pendingRewrite = null;
    inputAssistWindow.showError("Action timed out. Click the input and try again.");
    void logger.warn("input_assist.action.timeout", { actionName, timeoutMs: INPUT_ASSIST_ACTION_TIMEOUT_MS });
    refreshTray();
  }, INPUT_ASSIST_ACTION_TIMEOUT_MS);

  try {
    await action();
    void logger.info("input_assist.action.finish", { actionName, durationMs: Date.now() - startedAt });
  } catch (error) {
    const normalized = normalizeError("startup", error);
    lastErrorId = normalized.id;
    void logger.error("input_assist.action.failed", {
      actionName,
      durationMs: Date.now() - startedAt,
      error: normalized,
    });
    inputAssistWindow.showError(formatUserError(normalized.userMessage, normalized.id));
  } finally {
    clearInputAssistActionTimer();
    inputAssistActionInFlight = false;
    refreshTray();
  }
}

function clearInputAssistActionTimer(): void {
  if (!inputAssistActionTimer) {
    return;
  }

  clearTimeout(inputAssistActionTimer);
  inputAssistActionTimer = null;
}

function handleInputAssistWindowBlur(): void {
  if (!inputAssistEnabled || !inputAssistInteractionActive || inputAssistActionInFlight) {
    return;
  }

  void logger.info("input_assist.auto_disabled", { reason: "assist_window_blur" });
  void setInputAssistEnabled(false);
}

function shouldDisableInputAssistForWindowChange(windowHandle: number): boolean {
  if (!isUsableWindowHandle(windowHandle)) {
    return false;
  }

  if (inputAssistOriginWindowHandle === null) {
    inputAssistOriginWindowHandle = windowHandle;
    return false;
  }

  return windowHandle !== inputAssistOriginWindowHandle;
}

function isUsableWindowHandle(windowHandle: number): boolean {
  return Number.isFinite(windowHandle) && windowHandle > 0;
}

async function captureInputAssistRewriteSource(): Promise<RewriteTextSource | null> {
  let uiaSource: RewriteTextSource | null = null;

  try {
    const source = await inputAssistHelper.captureText();
    if (source) {
      uiaSource = {
        targetKind: "uia",
        scope: source.scope,
        text: source.text,
        targetId: source.target.targetId,
        pasteTarget: inputAssistOriginPasteTarget,
      };
      void logger.info("input_assist.capture.success", {
        source: "uia",
        scope: source.scope,
        textChars: source.text.length,
        hasTargetId: Boolean(source.target.targetId),
      });

      if (source.scope === "selection") {
        return uiaSource;
      }
    }
  } catch (error) {
    void logger.debug("input_assist.capture.uia_skipped", { error: normalizeError("startup", error) });
  }

  const clipboardSource = await captureInputAssistClipboardSource();
  if (uiaSource?.scope === "whole") {
    if (
      clipboardSource?.scope === "selection" &&
      shouldPreferClipboardSelectionOverUiaWhole(clipboardSource.text, uiaSource.text)
    ) {
      void logger.info("input_assist.capture.selection_override", {
        source: "clipboard",
        previousSource: "uia",
        textChars: clipboardSource.text.length,
      });
      return clipboardSource;
    }

    if (clipboardSource?.scope === "selection") {
      void logger.info("input_assist.capture.selection_ignored", {
        reason: "likely_implicit_line_copy",
        textChars: clipboardSource.text.length,
      });
    }

    if (
      clipboardSource?.scope === "whole" &&
      shouldPreferClipboardWholeOverUiaWhole(clipboardSource.text, uiaSource.text)
    ) {
      void logger.info("input_assist.capture.whole_override", {
        source: "clipboard",
        previousSource: "uia",
        clipboardChars: clipboardSource.text.length,
        uiaChars: uiaSource.text.length,
      });
      return clipboardSource;
    }

    if (uiaSource.text.trim()) {
      return uiaSource;
    }
  }

  return clipboardSource;
}

async function captureInputAssistClipboardSource(): Promise<RewriteTextSource | null> {
  if (!inputAssistOriginPasteTarget) {
    return null;
  }

  try {
    const source = await inserter.captureTextFromTargetByClipboard(inputAssistOriginPasteTarget, {
      requestId: createId("rewrite-capture-fallback"),
    });
    if (!source) {
      return null;
    }

    void logger.info("input_assist.capture.success", {
      source: "clipboard",
      scope: source.scope,
      textChars: source.text.length,
      hasPasteTarget: Boolean(inputAssistOriginPasteTarget),
    });
    return {
      targetKind: "clipboard",
      scope: source.scope,
      text: source.text,
      targetId: null,
      pasteTarget: inputAssistOriginPasteTarget,
    };
  } catch (error) {
    void logger.debug("input_assist.capture.clipboard_skipped", { error: normalizeError("paste", error) });
    return null;
  }
}

async function runInputAssistRewrite(actionId: RewriteActionId, customInstruction?: string): Promise<void> {
  if (!config.groqApiKey) {
    inputAssistWindow.showError("Add your Groq API key before using rewrite.");
    return;
  }

  inputAssistWindow.showLoading("Preparing selected text...");
  try {
    const source = await captureInputAssistRewriteSource();
    if (!source || !source.text.trim()) {
      inputAssistWindow.showError("Type or select text first.");
      return;
    }

    const action = getRewriteAction(actionId);
    inputAssistWindow.showLoading(`${action.label}...`);
    const rewrittenText = await getRewriteProvider(config).rewrite(
      source.text,
      { actionId, customInstruction },
      { requestId: createId("rewrite") },
    );

    pendingRewrite = {
      targetKind: source.targetKind,
      sourceText: source.text,
      rewrittenText,
      scope: source.scope,
      targetId: source.targetId,
      pasteTarget: source.pasteTarget,
      actionId,
      customInstruction,
      actionLabel: action.label,
    };
    inputAssistWindow.showPreview({
      scope: source.scope,
      actionLabel: action.label,
      originalChars: source.text.length,
      rewrittenText,
      safeReplace: source.targetKind === "uia" || Boolean(source.pasteTarget),
      replaceMode: source.targetKind === "uia" ? "verified" : source.pasteTarget ? "window" : "copy",
    });
    void logger.info("input_assist.rewrite.preview_ready", {
      actionId,
      scope: source.scope,
      inputChars: source.text.length,
      outputChars: rewrittenText.length,
    });
  } catch (error) {
    const normalized = normalizeError("cleanup", error);
    lastErrorId = normalized.id;
    void logger.error("input_assist.rewrite.failed", { actionId, error: normalized });
    inputAssistWindow.showError(formatUserError(normalized.userMessage, normalized.id));
  } finally {
    refreshTray();
  }
}

async function replacePendingRewrite(): Promise<void> {
  if (!pendingRewrite) {
    inputAssistWindow.showError("No rewrite preview is ready.");
    return;
  }

  const rewrite = pendingRewrite;

  if (rewrite.targetKind === "clipboard") {
    if (!rewrite.pasteTarget) {
      inserter.copyText(rewrite.rewrittenText, { requestId: createId("rewrite-copy-unverified") });
      void logger.warn("input_assist.replace.unverified_copied", {
        actionId: rewrite.actionId,
        scope: rewrite.scope,
        outputChars: rewrite.rewrittenText.length,
      });
      closeInputAssistInteraction({ silentDisable: true });
      showStatus("error", "Could not refocus the input; rewritten text copied. Press Ctrl+V manually.");
      return;
    }

    try {
      const context = { requestId: createId("rewrite-window-paste") };
      await inserter.focusTargetWindow(rewrite.pasteTarget, context);
      await inserter.pasteText(rewrite.rewrittenText, context, rewrite.pasteTarget);
      void logger.info("input_assist.replace.window_paste_success", {
        actionId: rewrite.actionId,
        scope: rewrite.scope,
        outputChars: rewrite.rewrittenText.length,
      });
      closeInputAssistInteraction({ silentDisable: true });
      showStatus("idle", "Pasted");
      return;
    } catch (error) {
      inserter.copyText(rewrite.rewrittenText, { requestId: createId("rewrite-copy-window-fallback") });
      const normalized = normalizeError("paste", error);
      lastErrorId = normalized.id;
      void logger.error("input_assist.replace.window_paste_fallback_copied", {
        actionId: rewrite.actionId,
        scope: rewrite.scope,
        outputChars: rewrite.rewrittenText.length,
        error: normalized,
      });
      closeInputAssistInteraction({ silentDisable: true });
      showStatus("error", "Paste blocked; rewritten text copied. Press Ctrl+V manually.");
      return;
    }
  }

  if (!rewrite.targetId) {
    inserter.copyText(rewrite.rewrittenText, { requestId: createId("rewrite-copy-unverified") });
    void logger.warn("input_assist.replace.unverified_copied", {
      actionId: rewrite.actionId,
      scope: rewrite.scope,
      outputChars: rewrite.rewrittenText.length,
    });
    closeInputAssistInteraction({ silentDisable: true });
    showStatus("error", "Input not verified; rewritten text copied. Press Ctrl+V manually.");
    return;
  }

  try {
    if (rewrite.scope === "whole") {
      await replaceWholeInputAssistText(rewrite);
    } else {
      await inputAssistHelper.verifySelection(rewrite.targetId, rewrite.sourceText);
      await inserter.pasteText(rewrite.rewrittenText, { requestId: createId("rewrite-paste") }, null);
    }

    void logger.info("input_assist.replace.success", {
      actionId: rewrite.actionId,
      scope: rewrite.scope,
      outputChars: rewrite.rewrittenText.length,
    });
    closeInputAssistInteraction({ silentDisable: true });
    showStatus("idle", "Replaced");
  } catch (error) {
    inserter.copyText(rewrite.rewrittenText, { requestId: createId("rewrite-copy-fallback") });
    const normalized = normalizeError("paste", error);
    lastErrorId = normalized.id;
    void logger.error("input_assist.replace.fallback_copied", {
      actionId: rewrite.actionId,
      scope: rewrite.scope,
      outputChars: rewrite.rewrittenText.length,
      error: normalized,
    });
    closeInputAssistInteraction({ silentDisable: true });
    showStatus("error", formatRewriteReplaceFallbackMessage(rewrite.scope));
  }
}

async function replaceWholeInputAssistText(rewrite: NonNullable<typeof pendingRewrite>): Promise<void> {
  try {
    await inputAssistHelper.replaceWholeText(rewrite.targetId || "", rewrite.sourceText, rewrite.rewrittenText);
    return;
  } catch (error) {
    void logger.warn("input_assist.replace.direct_whole_skipped", {
      actionId: rewrite.actionId,
      error: normalizeError("paste", error),
    });
  }

  if (!rewrite.pasteTarget) {
    throw new Error("Input cannot be replaced directly.");
  }

  await inserter.replaceWholeTextByClipboard(
    rewrite.sourceText,
    rewrite.rewrittenText,
    rewrite.pasteTarget,
    { requestId: createId("rewrite-whole-clipboard") },
  );
}

function formatRewriteReplaceFallbackMessage(scope: "selection" | "whole"): string {
  if (scope === "selection") {
    return "Selection changed; rewritten text copied. Press Ctrl+V manually.";
  }

  return "Input changed or blocked replacement; rewritten text copied. Press Ctrl+V manually.";
}

async function copyPendingRewrite(): Promise<void> {
  if (!pendingRewrite) {
    inputAssistWindow.showError("No rewrite preview is ready.");
    return;
  }

  inserter.copyText(pendingRewrite.rewrittenText, { requestId: createId("rewrite-copy") });
  void logger.info("input_assist.copy.success", {
    actionId: pendingRewrite.actionId,
    scope: pendingRewrite.scope,
    outputChars: pendingRewrite.rewrittenText.length,
  });
  closeInputAssistInteraction({ silentDisable: true });
  showStatus("idle", "Copied");
}

async function retryPendingRewrite(): Promise<void> {
  if (!pendingRewrite) {
    inputAssistWindow.showError("No rewrite preview is ready.");
    return;
  }

  await runInputAssistRewrite(pendingRewrite.actionId, pendingRewrite.customInstruction);
}

async function speakHere(): Promise<void> {
  try {
    const readiness = getInputAssistSpeechReadiness({
      hasGroqApiKey: Boolean(config.groqApiKey),
      isRecording,
      isProcessing,
    });

    if (readiness === "blocked_missing_api_key") {
      void logger.warn("input_assist.speak_here.blocked", { reason: readiness });
      inputAssistWindow.showError("Add your Groq API key before using Speak here.");
      return;
    }

    if (readiness === "blocked_processing") {
      void logger.warn("input_assist.speak_here.blocked", { reason: readiness });
      inputAssistWindow.showError("Speech-to-text is still processing. Try again after it finishes.");
      return;
    }

    if (readiness === "cancel_active_recording") {
      void logger.info("input_assist.speak_here.cancel_active_recording");
      inputAssistWindow.showLoading("Stopping current recording...");
      await cancelRecording();
    }

    const focused = await focusInputAssistTargetForSpeech();
    if (!focused) {
      inputAssistWindow.showError("Could not refocus the input. Click the field and try again.");
      return;
    }

    closeInputAssistInteraction({ silentDisable: true });
    await startRecording();
  } catch (error) {
    const normalized = normalizeError("recorder", error);
    lastErrorId = normalized.id;
    void logger.error("input_assist.speak_here.failed", { error: normalized });
    inputAssistWindow.showError(formatUserError(normalized.userMessage, normalized.id));
  }
}

async function focusInputAssistTargetForSpeech(): Promise<boolean> {
  try {
    const source = await inputAssistHelper.captureText();
    if (source) {
      await inputAssistHelper.focusTarget(source.target.targetId);
      return true;
    }
  } catch (error) {
    void logger.debug("input_assist.speak_here.uia_focus_skipped", { error: normalizeError("recorder", error) });
  }

  if (!inputAssistOriginPasteTarget) {
    return false;
  }

  try {
    await inserter.focusTargetWindow(inputAssistOriginPasteTarget, { requestId: createId("speak-here-focus") });
    return true;
  } catch (error) {
    void logger.debug("input_assist.speak_here.window_focus_skipped", { error: normalizeError("paste", error) });
    return false;
  }
}

function closeInputAssistInteraction(options: { keepEnabled?: boolean; silentDisable?: boolean } = {}): void {
  pendingRewrite = null;
  inputAssistInteractionActive = false;
  inputAssistWindow.hide();
  if (!options.keepEnabled && inputAssistEnabled) {
    void setInputAssistEnabled(false, { silent: options.silentDisable === true });
    return;
  }

  if (inputAssistEnabled) {
    void refreshInputAssistTarget();
  }
}

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
      if (stage === "transcribing") {
        showStatus("processing", "Converting speech to text...");
        return;
      }

      showStatus("processing", "Polishing transcript...");
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

function showStatus(status: "idle" | "listening" | "processing" | "confirm" | "pasting" | "error", message: string): void {
  statusOverlay.show({ status, message });
}

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
      inputAssistConfigured: config.inputAssistHotkey,
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
      lastStopReason,
    },
    inputAssist: {
      enabled: inputAssistEnabled,
      interactionActive: inputAssistInteractionActive,
      hasPendingRewrite: Boolean(pendingRewrite),
    },
    lastErrorId,
    settings: {
      hasGroqApiKey: Boolean(config.groqApiKey),
      autoPaste: config.autoPaste,
      cleanupEnabled: config.cleanupEnabled,
      openAtLogin: config.openAtLogin,
      inputAssistEnabledOnStartup: config.inputAssistEnabledOnStartup,
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
  showStatus("idle", "Diagnostics exported");
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
    return "Stopped after silence; no speech captured";
  }

  if (reason === "max_duration") {
    return "Recording limit reached; no speech captured";
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
