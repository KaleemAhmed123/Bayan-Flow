import type { OperationContext } from "../types.js";

export type RecorderLike = {
  start(context?: OperationContext, limits?: { maxDurationMs: number; maxAudioBytes: number }): Promise<void>;
  stop(context?: OperationContext): Promise<string | null>;
  destroy(): void;
};

export type RecorderSessionSnapshot = {
  activeSessionId: string | null;
  isStarting: boolean;
  isStopping: boolean;
};

export class RecorderSessionController {
  private activeSessionId: string | null = null;
  private startResolver: ((response: { ok: boolean; error?: string }) => void) | null = null;
  private stopResolver: ((response: { ok: boolean; audioPath?: string | null; error?: string }) => void) | null = null;
  private completedStop: { ok: boolean; audioPath?: string | null; error?: string } | null = null;

  begin(sessionId: string): void {
    if (this.activeSessionId) {
      throw new Error("Recording session is already active.");
    }

    this.activeSessionId = sessionId;
    this.completedStop = null;
  }

  waitForStart(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.startResolver = (response) => {
        this.startResolver = null;
        if (!response.ok) {
          this.activeSessionId = null;
          reject(new Error(response.error || "Recording failed to start."));
          return;
        }

        resolve();
      };
    });
  }

  waitForStop(): Promise<string | null> {
    if (this.completedStop) {
      const response = this.completedStop;
      this.completedStop = null;
      this.activeSessionId = null;
      if (!response.ok) {
        return Promise.reject(new Error(response.error || "Recording failed."));
      }

      return Promise.resolve(response.audioPath || null);
    }

    return new Promise((resolve, reject) => {
      this.stopResolver = (response) => {
        this.stopResolver = null;
        const audioPath = response.audioPath || null;
        this.activeSessionId = null;
        if (!response.ok) {
          reject(new Error(response.error || "Recording failed."));
          return;
        }

        resolve(audioPath);
      };
    });
  }

  acceptStart(sessionId: string): boolean {
    if (sessionId !== this.activeSessionId) {
      return false;
    }

    this.startResolver?.({ ok: true });
    return true;
  }

  fail(sessionId: string, message: string): boolean {
    if (sessionId !== this.activeSessionId) {
      return false;
    }

    this.startResolver?.({ ok: false, error: message });
    this.stopResolver?.({ ok: false, error: message });
    this.activeSessionId = null;
    return true;
  }

  acceptStop(sessionId: string, audioPath?: string | null): boolean {
    if (sessionId !== this.activeSessionId) {
      return false;
    }

    if (this.stopResolver) {
      this.stopResolver({ ok: true, audioPath });
      return true;
    }

    this.completedStop = { ok: true, audioPath };
    return true;
  }

  failStop(sessionId: string, message: string): boolean {
    if (sessionId !== this.activeSessionId) {
      return false;
    }

    if (this.stopResolver) {
      this.stopResolver({ ok: false, error: message });
      return true;
    }

    this.completedStop = { ok: false, error: message };
    return true;
  }

  reset(message = "Recorder session was reset."): void {
    this.startResolver?.({ ok: false, error: message });
    this.stopResolver?.({ ok: false, error: message });
    this.startResolver = null;
    this.stopResolver = null;
    this.completedStop = null;
    this.activeSessionId = null;
  }

  snapshot(): RecorderSessionSnapshot {
    return {
      activeSessionId: this.activeSessionId,
      isStarting: Boolean(this.startResolver),
      isStopping: Boolean(this.stopResolver),
    };
  }
}
