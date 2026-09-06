import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { app, safeStorage } from "./electron.js";
import { parseHotkey } from "./hotkey/hotkey-parser.js";
import { logger } from "./observability/app-logger.js";
import { normalizeError } from "./observability/errors.js";
import type { AppConfig } from "./types.js";

const DEFAULT_CONFIG: AppConfig = {
  groqApiKey: "",
  hotkey: "Ctrl+Shift+Space",
  inputAssistHotkey: "Ctrl+Shift+Enter",
  showDock: true,
  autoPaste: true,
  cleanupEnabled: true,
  openAtLogin: false,
  transcriptionModel: "whisper-large-v3",
  cleanupModel: "openai/gpt-oss-120b",
};

/**
 * Groq retires models and then answers them with 404 `model_not_found`, which
 * surfaces to the user as polish and rewrite silently failing. Changing the
 * default alone does not help anyone who already has the old id saved, so load
 * and save both remap through this table.
 *
 * Source: https://console.groq.com/docs/deprecations
 */
const RETIRED_MODELS = new Map<string, string>([
  ["llama-3.3-70b-versatile", "openai/gpt-oss-120b"],
  ["llama-3.1-70b-versatile", "openai/gpt-oss-120b"],
  ["llama-3.1-8b-instant", "openai/gpt-oss-20b"],
  ["qwen/qwen3-32b", "openai/gpt-oss-120b"],
  ["meta-llama/llama-4-scout-17b-16e-instruct", "openai/gpt-oss-120b"],
  ["deepseek-r1-distill-llama-70b", "openai/gpt-oss-120b"],
]);

const DEFAULT_MODEL_PATTERN = /^[a-zA-Z0-9._:/-]+$/;
const MAX_MODEL_LENGTH = 120;
const ENCRYPTED_PREFIX = "safeStorage:v1:";

type StoredConfig = Partial<AppConfig> & {
  groqApiKeyEncrypted?: string;
};

export type SecureStorage = {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
};

export class ConfigStore {
  private readonly filePath: string;

  constructor(
    filePath = path.join(app.getPath("userData"), "config.json"),
    private readonly secureStorage: SecureStorage | undefined = safeStorage,
  ) {
    this.filePath = filePath;
  }

  async load(): Promise<AppConfig> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as StoredConfig;
      void logger.info("config.load.success");
      return normalizeConfig({
        ...parsed,
        groqApiKey: readStoredApiKey(parsed, this.secureStorage),
      });
    } catch (error) {
      const normalized = normalizeError("config", error);
      void logger.warn("config.load.fallback", { error: normalized });
      return normalizeConfig({});
    }
  }

  async save(nextConfig: AppConfig): Promise<void> {
    const config = normalizeConfig(nextConfig);
    const encryptedApiKey = encryptApiKey(config.groqApiKey, this.secureStorage);
    const storedConfig: StoredConfig = {
      ...config,
      groqApiKey: encryptedApiKey ? "" : config.groqApiKey,
      groqApiKeyEncrypted: encryptedApiKey,
    };
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(storedConfig, null, 2)}\n`, "utf8");
    void logger.info("config.save.success", {
      hasGroqApiKey: Boolean(config.groqApiKey),
      apiKeyStorage: encryptedApiKey ? "encrypted" : config.groqApiKey ? "plaintext_fallback" : "empty",
      hotkey: config.hotkey,
      inputAssistHotkey: config.inputAssistHotkey,
      showDock: config.showDock,
      autoPaste: config.autoPaste,
      cleanupEnabled: config.cleanupEnabled,
      openAtLogin: config.openAtLogin,
      transcriptionModel: config.transcriptionModel,
      cleanupModel: config.cleanupModel,
    });
  }
}

function readStoredApiKey(config: StoredConfig, secureStorage: SecureStorage | undefined): string {
  if (config.groqApiKeyEncrypted) {
    try {
      const decrypted = decryptApiKey(config.groqApiKeyEncrypted, secureStorage);
      if (decrypted) {
        return decrypted;
      }
    } catch (error) {
      void logger.warn("config.api_key.decrypt_failed", { error: normalizeError("config", error) });
    }
  }

  const plaintextKey = typeof config.groqApiKey === "string" ? config.groqApiKey.trim() : "";
  return plaintextKey || process.env.GROQ_API_KEY || "";
}

function encryptApiKey(apiKey: string, secureStorage: SecureStorage | undefined): string {
  if (!apiKey) {
    return "";
  }

  if (!secureStorage?.isEncryptionAvailable?.()) {
    return "";
  }

  return `${ENCRYPTED_PREFIX}${secureStorage.encryptString(apiKey).toString("base64")}`;
}

function decryptApiKey(value: string, secureStorage: SecureStorage | undefined): string {
  if (!value.startsWith(ENCRYPTED_PREFIX)) {
    return "";
  }

  if (!secureStorage?.isEncryptionAvailable?.()) {
    throw new Error("Secure credential storage is not available on this system.");
  }

  const encrypted = Buffer.from(value.slice(ENCRYPTED_PREFIX.length), "base64");
  return secureStorage.decryptString(encrypted);
}

export function normalizeConfig(input: Partial<AppConfig>): AppConfig {
  return {
    groqApiKey: stringOr(input.groqApiKey, process.env.GROQ_API_KEY || ""),
    hotkey: hotkeyOr(input.hotkey, DEFAULT_CONFIG.hotkey),
    inputAssistHotkey: hotkeyOr(input.inputAssistHotkey, DEFAULT_CONFIG.inputAssistHotkey),
    showDock: booleanOr(input.showDock, DEFAULT_CONFIG.showDock),
    autoPaste: booleanOr(input.autoPaste, DEFAULT_CONFIG.autoPaste),
    cleanupEnabled: booleanOr(input.cleanupEnabled, DEFAULT_CONFIG.cleanupEnabled),
    openAtLogin: booleanOr(input.openAtLogin, DEFAULT_CONFIG.openAtLogin),
    transcriptionModel: modelOr(input.transcriptionModel, DEFAULT_CONFIG.transcriptionModel),
    cleanupModel: modelOr(input.cleanupModel, DEFAULT_CONFIG.cleanupModel),
  };
}

function hotkeyOr(value: unknown, fallback: string): string {
  const hotkey = stringOr(value, fallback);
  try {
    parseHotkey(hotkey);
    return hotkey;
  } catch {
    return fallback;
  }
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function modelOr(value: unknown, fallback: string): string {
  const model = stringOr(value, fallback);
  if (model.length > MAX_MODEL_LENGTH || !DEFAULT_MODEL_PATTERN.test(model)) {
    return fallback;
  }

  return RETIRED_MODELS.get(model) ?? model;
}
