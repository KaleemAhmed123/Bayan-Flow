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
import { TextInserter } from "./insertion/text-inserter.js";
import { configureLogger, logger } from "./observability/app-logger.js";
import { normalizeError, type ErrorCategory } from "./observability/errors.js";
import { sanitize } from "./observability/logger.js";
import { SettingsWindow } from "./settings-window.js";
import { StatusOverlay } from "./status-overlay.js";
import type { AppConfig, DictationResult, OperationContext } from "./types.js";
import type { PasteTarget } from "./insertion/text-inserter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAX_RECORDING_DURATION_MS = 5 * 60 * 1_000;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const STALE_TEMP_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

let tray: InstanceType<typeof Tray> | null = null;
let config: AppConfig;
let hotkeyListener: HotkeyListener | null = null;
let isRecording = false;
let isProcessing = false;
let activeSessionId: string | null = null;
let activePasteTarget: PasteTarget | null = null;
let recordingLimitTimer: NodeJS.Timeout | null = null;
let hotkeyAvailable = false;
let lastErrorId = "";
let lastMicError = "";
let logDir = "";

const configStore = new ConfigStore();
const recorder = new AudioRecorder();
const inserter = new TextInserter();
const statusOverlay = new StatusOverlay();

app.setName("BayanFlow");
try {
  app.setPath("userData", process.env.BAYANFLOW_USER_DATA_DIR || path.join(app.getPath("appData"), "BayanFlow"));
} catch {
  writeEarlyStartupDiagnostic("user_data_path.fallback");
  // Fall back to Electron's default userData path if appData is unavailable early in startup.
}

if (!app.requestSingleInstanceLock()) {
  writeEarlyStartupDiagnostic("single_instance.lock_failed");
  app.quit();
}

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

    recorder.setUnexpectedErrorHandler(async (error, context) => {
      if (!isRecording || context.sessionId !== activeSessionId) {
        return;
      }

      isRecording = false;
      isProcessing = false;
      clearRecordingLimitTimer();
      activeSessionId = null;
      activePasteTarget = null;
      const normalized = normalizeError("recorder", error);
      void logger.error("dictation.recording.failed_async", { ...context, error: normalized });
      showStatus("error", formatUserError(normalized.userMessage, normalized.id));
    });

    await recorder.init();
    await statusOverlay.init();

    const settingsWindow = new SettingsWindow(
      configStore,
      async (nextConfig) => {
        config = nextConfig;
        applyLoginItemSettings(config);
        restartHotkeyListener();
        createTray(settingsWindow);
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
          showStatus("idle", "Microphone ready");
          void logger.info("recorder.mic_test.success");
        } catch (error) {
          const normalized = normalizeError("recorder", error);
          lastErrorId = normalized.id;
          lastMicError = normalized.userMessage;
          void logger.error("recorder.mic_test.failed", { error: normalized });
          showStatus("error", formatUserError(normalized.userMessage, normalized.id));
          throw error;
        }
      },
    );

    restartHotkeyListener();
    createTray(settingsWindow);
    showStatus("idle", `Ready: ${config.hotkey}`);
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
  clearRecordingLimitTimer();
  recorder.destroy();
  statusOverlay.destroy();
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
  tray.setToolTip("BayanFlow");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Hotkey: ${config.hotkey}`, enabled: false },
      { label: `Hotkey status: ${hotkeyAvailable ? "Active" : "Unavailable"}`, enabled: false },
      { label: `Last error: ${lastErrorId || "None"}`, enabled: false },
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

function restartHotkeyListener(): void {
  hotkeyListener?.stop();
  hotkeyListener = new HotkeyListener(config.hotkey, {
    onPressed: () => void toggleRecording(),
  });

  try {
    hotkeyListener.start();
    hotkeyAvailable = true;
  } catch (error) {
    hotkeyAvailable = false;
    const normalized = normalizeError("hotkey", error);
    lastErrorId = normalized.id;
    void logger.error("hotkey.listener.failed", { error: normalized });
    showStatus("error", formatUserError(normalized.userMessage, normalized.id));
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
  if (isRecording || isProcessing) {
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
  void logger.info("dictation.start", context);

  try {
    await recorder.start(context, {
      maxDurationMs: MAX_RECORDING_DURATION_MS + 10_000,
      maxAudioBytes: MAX_AUDIO_BYTES,
    });
    recordingLimitTimer = setTimeout(() => {
      if (isRecording && !isProcessing) {
        void logger.warn("dictation.recording.max_duration_reached", context);
        void stopRecording();
      }
    }, MAX_RECORDING_DURATION_MS + 500);
    void waitForRecordingDecision();
  } catch (error) {
    isRecording = false;
    activeSessionId = null;
    activePasteTarget = null;
    const normalized = normalizeError("recorder", error);
    lastErrorId = normalized.id;
    lastMicError = normalized.userMessage;
    void logger.error("dictation.start.failed", { ...context, error: normalized });
    showStatus("error", formatUserError(normalized.userMessage, normalized.id));
  }
}

async function waitForRecordingDecision(): Promise<void> {
  const accepted = await statusOverlay.confirm("Listening...");

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

  const audioPath = await recorder.stop(context).catch((error) => {
    void logger.warn("dictation.cancel.stop_failed", { ...context, error: normalizeError("recorder", error) });
    return null;
  });
  if (audioPath) {
    await deleteTempAudio(audioPath, context);
  }

  isProcessing = false;
  activeSessionId = null;
  activePasteTarget = null;
}

async function stopRecording(): Promise<void> {
  if (!isRecording || isProcessing) {
    return;
  }

  isRecording = false;
  isProcessing = true;
  clearRecordingLimitTimer();
  showStatus("processing", "Processing...");

  let audioPath: string | null = null;
  let failureCategory: ErrorCategory = "recorder";
  const context = currentContext();

  try {
    audioPath = await recorder.stop(context);
    if (!audioPath) {
      void logger.info("dictation.no_speech", context);
      showStatus("idle", "No speech captured");
      return;
    }

    failureCategory = "transcription";
    await assertAudioWithinLimits(audioPath);
    const result = await runDictationPipeline(audioPath, context);
    if (!result.finalText) {
      void logger.info("dictation.no_text", context);
      showStatus("idle", "No text detected");
      return;
    }

    failureCategory = "paste";
    await insertOrCopyText(result.finalText, context, Boolean(result.cleanupFallback));
    void logger.info("dictation.success", {
      ...context,
      autoPaste: config.autoPaste,
      rawChars: result.rawText.length,
      finalChars: result.finalText.length,
    });
  } catch (error) {
    const normalized = normalizeError(failureCategory, error);
    lastErrorId = normalized.id;
    void logger.error("dictation.failed", { ...context, error: normalized });
    showStatus("error", formatUserError(normalized.userMessage, normalized.id));
  } finally {
    isProcessing = false;
    if (audioPath) {
      await deleteTempAudio(audioPath, context);
    }
    activeSessionId = null;
    activePasteTarget = null;
  }
}

async function insertOrCopyText(text: string, context: OperationContext, cleanupFallback = false): Promise<void> {
  if (!config.autoPaste) {
    inserter.copyText(text, context);
    showStatus("idle", cleanupFallback ? "Copied raw transcript; review/edit" : "Copied");
    return;
  }

  showStatus("pasting", "Pasting...");
  await inserter.pasteText(text, context, activePasteTarget);
  showStatus("idle", cleanupFallback ? "Pasted raw transcript; review/edit" : "Pasted");
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
  createTray(settingsWindow);
  showStatus("idle", "Auto paste off");
  void logger.info("settings.auto_paste.toggled", { autoPaste: config.autoPaste });
}

async function runDictationPipeline(audioPath: string, context: OperationContext): Promise<DictationResult> {
  const { GroqTranscriptionService } = await import("./transcription/groq-transcription-service.js");
  const transcription = new GroqTranscriptionService(config.groqApiKey, config.transcriptionModel);
  const cleanupProvider = config.cleanupEnabled ? new GroqCleanupProvider(config.groqApiKey, config.cleanupModel) : undefined;
  const pipeline = await runDictationPipelineWithProviders({
    audioPath,
    context,
    cleanupEnabled: config.cleanupEnabled,
    transcriptionRequestId: createId("transcription"),
    cleanupRequestId: createId("cleanup"),
    transcription,
    cleanup: cleanupProvider,
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
      available: hotkeyAvailable,
    },
    mic: {
      lastError: lastMicError || "",
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

function writeEarlyStartupDiagnostic(event: string): void {
  try {
    const dir = path.join(process.env.APPDATA || os.tmpdir(), "BayanFlow", "logs");
    mkdirSync(dir, { recursive: true });
    appendFileSync(path.join(dir, "early-startup.log"), `${new Date().toISOString()} ${event}\n`, "utf8");
  } catch {
    // Early diagnostics are best-effort only.
  }
}
