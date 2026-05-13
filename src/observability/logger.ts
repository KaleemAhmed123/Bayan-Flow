import { appendFile, mkdir, readdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

export type LogEntry = {
  timestamp: string;
  level: LogLevel;
  event: string;
  fields?: LogFields;
};

export interface LogSink {
  write(entry: LogEntry): Promise<void>;
}

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_RETENTION_DAYS = 14;
const REDACTED = "[redacted]";

export class Logger {
  constructor(
    private sinks: LogSink[] = [],
    private level: LogLevel = "info",
  ) {}

  configure(sinks: LogSink[], level: LogLevel = "info"): void {
    this.sinks = sinks;
    this.level = level;
  }

  debug(event: string, fields?: LogFields): Promise<void> {
    return this.log("debug", event, fields);
  }

  info(event: string, fields?: LogFields): Promise<void> {
    return this.log("info", event, fields);
  }

  warn(event: string, fields?: LogFields): Promise<void> {
    return this.log("warn", event, fields);
  }

  error(event: string, fields?: LogFields): Promise<void> {
    return this.log("error", event, fields);
  }

  async log(level: LogLevel, event: string, fields?: LogFields): Promise<void> {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.level]) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      event,
      fields: sanitize(fields) as LogFields | undefined,
    };

    await Promise.all(this.sinks.map((sink) => sink.write(entry).catch(() => undefined)));
  }
}

export class FileLogSink implements LogSink {
  private readonly activePath: string;
  private initialized = false;

  constructor(
    private readonly directory: string,
    private readonly options: { maxBytes?: number; retentionDays?: number } = {},
  ) {
    this.activePath = path.join(directory, "app.log");
  }

  async write(entry: LogEntry): Promise<void> {
    await this.ensureInitialized();
    await this.rotateIfNeeded();
    await appendFile(this.activePath, `${JSON.stringify(entry)}\n`, "utf8");
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await mkdir(this.directory, { recursive: true });
    await this.pruneOldLogs();
    this.initialized = true;
  }

  private async rotateIfNeeded(): Promise<void> {
    const maxBytes = this.options.maxBytes ?? DEFAULT_MAX_BYTES;
    const current = await stat(this.activePath).catch(() => null);
    if (!current || current.size < maxBytes) {
      return;
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await rename(this.activePath, path.join(this.directory, `app-${stamp}.log`)).catch(() => undefined);
  }

  private async pruneOldLogs(): Promise<void> {
    const retentionMs = (this.options.retentionDays ?? DEFAULT_RETENTION_DAYS) * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - retentionMs;
    const files = await readdir(this.directory).catch(() => []);

    await Promise.all(
      files
        .filter((file) => file.endsWith(".log"))
        .map(async (file) => {
          const filePath = path.join(this.directory, file);
          const info = await stat(filePath).catch(() => null);
          if (info && info.mtimeMs < cutoff) {
            await unlink(filePath).catch(() => undefined);
          }
        }),
    );
  }
}

export function sanitize(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return looksSecret(value) ? REDACTED : value;
  }

  if (typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item));
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, fieldValue]) => [
      key,
      shouldRedactKey(key) ? REDACTED : sanitize(fieldValue),
    ]),
  );
}

function shouldRedactKey(key: string): boolean {
  return /api[-_]?key|authorization|secret|password|transcript|cleanedText|finalText|rawText/i.test(key) || /^token$/i.test(key);
}

function looksSecret(value: string): boolean {
  return /gsk_[a-z0-9_-]{12,}|sk-[a-z0-9_-]{12,}|bearer\s+[a-z0-9._-]{12,}/i.test(value);
}
