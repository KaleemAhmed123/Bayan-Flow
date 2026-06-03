import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { logger } from "../observability/app-logger.js";
import { normalizeInputAssistTarget, type InputAssistTarget, type InputAssistTextSource } from "./input-assist-types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REQUEST_TIMEOUT_MS = 2_500;

type HelperResponse = {
  id: string;
  ok: boolean;
  data?: unknown;
  error?: string;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export class UiaHelperClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private readonly pending = new Map<string, PendingRequest>();

  async getTarget(): Promise<InputAssistTarget | null> {
    const data = await this.request("getTarget");
    const target = normalizeInputAssistTarget(data);
    return target?.canReadText ? target : null;
  }

  async captureText(): Promise<InputAssistTextSource | null> {
    const data = await this.request("captureText");
    if (!data || typeof data !== "object") {
      return null;
    }

    const candidate = data as { target?: unknown; scope?: unknown; text?: unknown };
    const target = normalizeInputAssistTarget(candidate.target);
    if (!target || (candidate.scope !== "selection" && candidate.scope !== "whole") || typeof candidate.text !== "string") {
      return null;
    }

    return { target, scope: candidate.scope, text: candidate.text };
  }

  async verifySelection(targetId: string, sourceText: string): Promise<void> {
    await this.request("verifySelection", { targetId, sourceText });
  }

  async replaceWholeText(targetId: string, sourceText: string, replacementText: string): Promise<void> {
    await this.request("replaceWholeText", { targetId, sourceText, replacementText });
  }

  async focusTarget(targetId: string): Promise<void> {
    await this.request("focusTarget", { targetId });
  }

  destroy(): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Input Assist helper was stopped."));
      this.pending.delete(id);
    }

    this.child?.kill();
    this.child = null;
  }

  private request(type: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    if (process.platform !== "win32") {
      return Promise.reject(new Error("Input Assist is only available on Windows."));
    }

    const child = this.ensureStarted();
    const id = `uia-${this.nextId++}`;
    const message = JSON.stringify({ id, type, payload });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Input Assist helper timed out."));
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${message}\n`, "utf8", (error) => {
        if (!error) {
          return;
        }

        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  private ensureStarted(): ChildProcessWithoutNullStreams {
    if (this.child && !this.child.killed) {
      return this.child;
    }

    const helperPath = path.join(__dirname, "..", "helpers", "input-assist-helper.ps1");
    this.child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", helperPath],
      { windowsHide: true },
    );

    const stdout = readline.createInterface({ input: this.child.stdout });
    stdout.on("line", (line) => this.handleLine(line));
    this.child.stderr.on("data", (chunk) => {
      void logger.warn("input_assist.helper.stderr", { bytes: Buffer.byteLength(chunk) });
    });
    this.child.on("exit", (code) => {
      void logger.warn("input_assist.helper.exited", { code });
      this.child = null;
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error("Input Assist helper exited."));
        this.pending.delete(id);
      }
    });

    void logger.info("input_assist.helper.started");
    return this.child;
  }

  private handleLine(line: string): void {
    let response: HelperResponse;
    try {
      response = JSON.parse(line) as HelperResponse;
    } catch {
      void logger.warn("input_assist.helper.invalid_json");
      return;
    }

    const pending = this.pending.get(response.id);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timer);
    this.pending.delete(response.id);
    if (!response.ok) {
      pending.reject(new Error(response.error || "Input Assist helper failed."));
      return;
    }

    pending.resolve(response.data);
  }
}
