import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { rendererDir } from "../app-paths.js";
import { BrowserWindow, ipcMain } from "../electron.js";
import { logger } from "../observability/app-logger.js";
import { normalizeError } from "../observability/errors.js";
import type { OperationContext } from "../types.js";
import {
  type RecorderStopReason,
  validateRecorderErrorPayload,
  validateRecorderMicTestedPayload,
  validateRecorderStartedPayload,
  validateRecorderStoppedPayload,
} from "./recorder-ipc-payloads.js";
import { RecorderSessionController, type RecorderStopResult } from "./recorder-session.js";

type TestMicResponse = {
  ok: boolean;
  requestId?: string;
  message?: string;
};

export type RecordingLimits = {
  maxDurationMs: number;
  maxAudioBytes: number;
  /** Chosen input device. Empty means whatever the OS considers the default. */
  microphoneId?: string;
};

export type AudioInputDevice = {
  deviceId: string;
  label: string;
};

const START_TIMEOUT_MS = 5_000;
const STOP_TIMEOUT_MS = 5_000;
const TEST_MIC_TIMEOUT_MS = 10_000;
const DEVICE_LIST_TIMEOUT_MS = 4_000;
const DEFAULT_LIMITS: RecordingLimits = {
  maxDurationMs: 5 * 60 * 1_000,
  maxAudioBytes: 25 * 1024 * 1024,
};

export class AudioRecorder {
  private window: InstanceType<typeof BrowserWindow> | null = null;
  private startTimer: NodeJS.Timeout | null = null;
  private stopTimer: NodeJS.Timeout | null = null;
  private testMicResolver: ((response: TestMicResponse) => void) | null = null;
  private testMicTimer: NodeJS.Timeout | null = null;
  private activeTestMicRequestId: string | null = null;
  private devicesResolver: ((devices: AudioInputDevice[]) => void) | null = null;
  private devicesTimer: NodeJS.Timeout | null = null;
  private activeMaxAudioBytes = DEFAULT_LIMITS.maxAudioBytes;
  /**
   * The start currently in flight, so `stop()` can wait for it. Settles either
   * way — `start()` has its own timeout — so awaiting it cannot hang.
   */
  private pendingStart: Promise<void> | null = null;
  private readonly session = new RecorderSessionController();
  private unexpectedErrorHandler: ((error: Error, context: OperationContext) => void | Promise<void>) | null = null;

  setUnexpectedErrorHandler(handler: (error: Error, context: OperationContext) => void | Promise<void>): void {
    this.unexpectedErrorHandler = handler;
  }

  async init(): Promise<void> {
    this.window = new BrowserWindow({
      width: 320,
      height: 160,
      show: false,
      icon: path.join(rendererDir, "..", "assets", "tray-icon.ico"),
      webPreferences: {
        preload: path.join(rendererDir, "recorder-preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    hardenWindow(this.window);

    this.window.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
      callback(permission === "media" && webContents.id === this.window?.webContents.id);
    });

    ipcMain.handle("recorder:started", (_event, response: unknown) => {
      this.assertSender(_event.sender.id);
      let payload;
      try {
        payload = validateRecorderStartedPayload(response, this.session.snapshot().activeSessionId);
      } catch (error) {
        void logger.warn("recorder.started.invalid", { error: normalizeError("recorder", error) });
        return;
      }

      this.session.acceptStart(payload.sessionId);
    });

    ipcMain.handle("recorder:stopped", async (_event, response: unknown) => {
      this.assertSender(_event.sender.id);
      let payload;
      try {
        payload = validateRecorderStoppedPayload(
          response,
          this.session.snapshot().activeSessionId,
          this.activeMaxAudioBytes,
        );
      } catch (error) {
        const normalized = normalizeError("recorder", error);
        void logger.warn("recorder.stopped.invalid", { error: normalized });
        const activeSessionId = this.session.snapshot().activeSessionId;
        if (activeSessionId) {
          this.session.failStop(activeSessionId, normalized.userMessage);
        }
        return;
      }

      try {
        const audioPath = await this.saveAudio(payload.audio);
        this.session.acceptStop(payload.sessionId, { audioPath: audioPath || null, stopReason: payload.stopReason });
      } catch (error) {
        const normalized = normalizeError("recorder", error);
        void logger.error("recorder.save.failed", { sessionId: payload.sessionId, error: normalized });
        this.session.failStop(payload.sessionId, normalized.userMessage);
      }
    });

    ipcMain.handle("recorder:devices", (_event, response: unknown) => {
      this.assertSender(_event.sender.id);
      const devices = Array.isArray((response as { devices?: unknown })?.devices)
        ? ((response as { devices: unknown[] }).devices
            .filter((device): device is AudioInputDevice =>
              typeof (device as AudioInputDevice)?.deviceId === "string" &&
              typeof (device as AudioInputDevice)?.label === "string")
            .slice(0, 32))
        : [];
      this.resolveDevices(devices);
    });

    ipcMain.handle("recorder:error", (_event, response: unknown) => {
      this.assertSender(_event.sender.id);
      let payload;
      try {
        payload = validateRecorderErrorPayload(response, this.session.snapshot().activeSessionId);
      } catch (error) {
        void logger.warn("recorder.error.invalid", { error: normalizeError("recorder", error) });
        return;
      }

      const message = payload.message;
      const error = new Error(message);
      void logger.error("recorder.renderer.error", { sessionId: payload.sessionId, error: normalizeError("recorder", error) });
      this.session.fail(payload.sessionId, message);
      void this.unexpectedErrorHandler?.(error, { sessionId: payload.sessionId });
    });

    ipcMain.handle("recorder:mic-tested", (_event, response: unknown) => {
      this.assertSender(_event.sender.id);
      let payload;
      try {
        payload = validateRecorderMicTestedPayload(response, this.activeTestMicRequestId);
      } catch (error) {
        void logger.warn("recorder.mic_test.invalid", { error: normalizeError("recorder", error) });
        return;
      }

      this.resolveTestMic(payload);
    });

    await this.window.loadFile(path.join(rendererDir, "recorder.html"));
    void logger.info("recorder.init.success");
  }

  /**
   * Opens and immediately drops the audio device, so the first real recording
   * does not pay the cold-start cost. Measured at 1,646ms on first use against
   * 18-23ms once warm, which is long enough that a short press captured nothing
   * at all.
   *
   * Fire and forget by design: there is no acknowledgement, nothing waits on
   * it, and a failure stays silent because the next real recording reports any
   * genuine microphone problem itself. Warming must never be a way to fail.
   */
  prewarm(microphoneId = ""): void {
    this.window?.webContents.send("recorder:prewarm", { microphoneId });
  }

  testMicrophone(): Promise<void> {
    if (!this.window) {
      throw new Error("Recorder window is not initialized.");
    }

    if (this.session.snapshot().activeSessionId) {
      throw new Error("Finish the current recording before testing the microphone.");
    }

    const requestId = createId("mic-test");
    this.activeTestMicRequestId = requestId;

    return new Promise((resolve, reject) => {
      this.clearTestMicTimer();
      this.testMicTimer = setTimeout(() => {
        this.resolveTestMic({ ok: false, requestId, message: "Microphone test timed out." });
      }, TEST_MIC_TIMEOUT_MS);

      this.testMicResolver = (response) => {
        this.clearTestMicTimer();
        this.activeTestMicRequestId = null;
        if (!response.ok) {
          reject(new Error(response.message || "Microphone test failed."));
          return;
        }

        resolve();
      };

      void logger.info("recorder.mic_test.start", { requestId });
      this.window?.webContents.send("recorder:test-mic", { requestId });
    });
  }

  /**
   * Lists audio inputs.
   *
   * Enumeration happens in the recorder window because it is the only one
   * granted media permission, and without permission the browser returns
   * devices with blank labels — a list of unnamed entries the user cannot choose
   * between. Never rejects: an empty list degrades Settings to "system default",
   * which is exactly the behaviour before this feature existed.
   */
  listMicrophones(): Promise<AudioInputDevice[]> {
    if (!this.window) {
      return Promise.resolve([]);
    }

    return new Promise((resolve) => {
      this.clearDevicesTimer();
      this.devicesTimer = setTimeout(() => this.resolveDevices([]), DEVICE_LIST_TIMEOUT_MS);
      this.devicesResolver = resolve;
      this.window?.webContents.send("recorder:list-devices", {});
    });
  }

  private resolveDevices(devices: AudioInputDevice[]): void {
    this.clearDevicesTimer();
    this.devicesResolver?.(devices);
    this.devicesResolver = null;
  }

  private clearDevicesTimer(): void {
    if (!this.devicesTimer) {
      return;
    }

    clearTimeout(this.devicesTimer);
    this.devicesTimer = null;
  }

  start(context: OperationContext = {}, limits: RecordingLimits = DEFAULT_LIMITS): Promise<void> {
    if (!this.window) {
      throw new Error("Recorder window is not initialized.");
    }

    if (!context.sessionId) {
      throw new Error("Recorder session ID is required.");
    }

    this.activeMaxAudioBytes = limits.maxAudioBytes;
    this.session.begin(context.sessionId);

    const started = this.session.waitForStart();
    this.clearStartTimer();
    this.startTimer = setTimeout(() => {
      this.session.fail(context.sessionId || "", "Recording timed out while starting.");
    }, START_TIMEOUT_MS);

    void logger.info("recorder.start", {
      ...context,
      maxDurationMs: limits.maxDurationMs,
      maxAudioBytes: limits.maxAudioBytes,
    });
    this.window?.webContents.send("recorder:start", {
      sessionId: context.sessionId,
      maxDurationMs: limits.maxDurationMs,
      maxAudioBytes: limits.maxAudioBytes,
      microphoneId: limits.microphoneId || "",
    });

    this.pendingStart = started.finally(() => this.clearStartTimer());
    return this.pendingStart;
  }

  async stop(context: OperationContext = {}, reason: RecorderStopReason = "manual"): Promise<RecorderStopResult> {
    if (!this.window) {
      throw new Error("Recorder window is not initialized.");
    }

    // Opening a microphone takes the renderer several hundred milliseconds. A
    // press shorter than that used to stop a recorder that had not started:
    // `recorder:stop` arrived while the renderer was still inside
    // getUserMedia, so it wrote either nothing or a headerless fragment that
    // Groq rejects with "could not process file - is it a valid media file?",
    // and the late `recorder:started` came back for a session already torn
    // down, logging "Invalid recorder sessionId". Waiting here means the
    // MediaRecorder is always running before we ask it to stop.
    await this.pendingStart?.catch(() => {});

    if (!context.sessionId || context.sessionId !== this.session.snapshot().activeSessionId) {
      throw new Error("Recorder session is not active.");
    }

    const stopped = this.session.waitForStop();
    this.clearStopTimer();
    this.stopTimer = setTimeout(() => {
      this.session.failStop(context.sessionId || "", "Recording timed out while stopping.");
    }, STOP_TIMEOUT_MS);

    void logger.info("recorder.stop", context);
    this.window?.webContents.send("recorder:stop", { sessionId: context.sessionId, reason });

    return stopped.finally(() => this.clearStopTimer());
  }

  destroy(): void {
    this.window?.destroy();
    this.window = null;
    this.clearStartTimer();
    this.clearStopTimer();
    this.clearTestMicTimer();
    this.resolveTestMic({ ok: false, error: "Recorder was closed." } as TestMicResponse);
    this.session.reset("Recorder was closed.");
    ipcMain.removeHandler("recorder:started");
    ipcMain.removeHandler("recorder:stopped");
    ipcMain.removeHandler("recorder:error");
    ipcMain.removeHandler("recorder:mic-tested");
    void logger.info("recorder.destroy");
  }

  private async saveAudio(audio: ArrayBuffer): Promise<string | undefined> {
    if (audio.byteLength < 128) {
      void logger.info("recorder.audio.empty", { audioBytes: audio.byteLength });
      return undefined;
    }

    const dir = path.join(os.tmpdir(), "whispr-clone");
    await mkdir(dir, { recursive: true });

    const audioPath = path.join(dir, `dictation-${Date.now()}.webm`);
    await writeFile(audioPath, Buffer.from(audio));
    void logger.info("recorder.audio.saved", { audioBytes: audio.byteLength });
    return audioPath;
  }

  private clearStopTimer(): void {
    if (!this.stopTimer) {
      return;
    }

    clearTimeout(this.stopTimer);
    this.stopTimer = null;
  }

  private clearStartTimer(): void {
    if (!this.startTimer) {
      return;
    }

    clearTimeout(this.startTimer);
    this.startTimer = null;
  }

  private resolveTestMic(response: TestMicResponse): void {
    this.testMicResolver?.(response);
    this.testMicResolver = null;
  }

  private clearTestMicTimer(): void {
    if (!this.testMicTimer) {
      return;
    }

    clearTimeout(this.testMicTimer);
    this.testMicTimer = null;
  }

  private assertSender(senderId: number): void {
    if (senderId !== this.window?.webContents.id) {
      throw new Error("Invalid recorder IPC sender.");
    }
  }
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function hardenWindow(window: InstanceType<typeof BrowserWindow>): void {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
}
