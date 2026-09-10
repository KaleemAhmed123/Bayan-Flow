import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { app, safeStorage } from "./electron.js";
import { parseHotkey } from "./hotkey/hotkey-parser.js";
import { logger } from "./observability/app-logger.js";
import { normalizeError } from "./observability/errors.js";
import { DEFAULT_CONTEXT_BLOCKLIST, parseBlocklist, serializeBlocklist } from "./context/context-rules.js";
import type { AppConfig } from "./types.js";

const DEFAULT_CONFIG: AppConfig = {
  groqApiKey: "",
  hotkey: "Ctrl+Shift+Space",
  inputAssistHotkey: "Ctrl+Shift+Enter",
  // Off until measured: it relies on uiohook still seeing a key the OS is
  // suppressing, which is reasoned rather than proven.
  suppressHotkeyInOtherApps: false,
  showDock: true,
  autoPaste: true,
  historyEnabled: true,
  cleanupEnabled: true,
  openAtLogin: false,
  transcriptionModel: "whisper-large-v3",
  cleanupModel: "openai/gpt-oss-120b",
  // A smaller sibling of the primary: different capacity class, so a rate limit
  // on one is unlikely to apply to the other.
  cleanupFallbackModel: "openai/gpt-oss-20b",
  transcriptionLanguage: "",
  outputLanguage: "",
  customVocabulary: "",
  // Metadata context is on by default: a window title is a small exposure and a
  // large quality win. The screenshot is the opposite trade, so it is opt-in.
  contextCaptureEnabled: true,
  contextScreenshotEnabled: false,
  contextModel: "qwen/qwen3.6-27b",
  contextBlocklist: serializeBlocklist(DEFAULT_CONTEXT_BLOCKLIST),
  microphoneId: "",
  preserveExactWording: false,
  instructionGuardEnabled: true,
  debugCaptureEnabled: false,
};

/**
 * Language tags we accept, e.g. "en", "ur", "pt-BR". Deliberately permissive
 * about the exact tag: providers disagree on which ones they support, and a tag
 * the provider rejects produces a clear API error, whereas an over-strict
 * allowlist here silently drops a language the user actually needs.
 */
const LANGUAGE_TAG_PATTERN = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})?$/;

/** Whole-field ceiling, so a paste accident cannot balloon every prompt we send. */
const MAX_VOCABULARY_CHARS = 2_000;
/** Per-term ceiling. A "term" longer than this is a sentence, not a vocabulary entry. */
export const MAX_VOCABULARY_TERM_CHARS = 80;
/** Term count ceiling. Beyond this the list stops helping the model and starts confusing it. */
export const MAX_VOCABULARY_TERMS = 100;

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
      suppressHotkeyInOtherApps: config.suppressHotkeyInOtherApps,
      showDock: config.showDock,
      autoPaste: config.autoPaste,
      historyEnabled: config.historyEnabled,
      cleanupEnabled: config.cleanupEnabled,
      openAtLogin: config.openAtLogin,
      transcriptionModel: config.transcriptionModel,
      cleanupModel: config.cleanupModel,
      cleanupFallbackModel: config.cleanupFallbackModel || "none",
      transcriptionLanguage: config.transcriptionLanguage || "auto",
      outputLanguage: config.outputLanguage || "same",
      // A count, never the terms themselves: vocabulary is user content and the
      // logger's job is to stay free of it.
      vocabularyTerms: parseVocabularyTerms(config.customVocabulary).length,
      contextCaptureEnabled: config.contextCaptureEnabled,
      contextScreenshotEnabled: config.contextScreenshotEnabled,
      contextModel: config.contextModel,
      contextBlocklistPatterns: parseBlocklist(config.contextBlocklist).length,
      hasMicrophoneId: Boolean(config.microphoneId),
      preserveExactWording: config.preserveExactWording,
      instructionGuardEnabled: config.instructionGuardEnabled,
      debugCaptureEnabled: config.debugCaptureEnabled,
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
    suppressHotkeyInOtherApps: booleanOr(input.suppressHotkeyInOtherApps, DEFAULT_CONFIG.suppressHotkeyInOtherApps),
    showDock: booleanOr(input.showDock, DEFAULT_CONFIG.showDock),
    autoPaste: booleanOr(input.autoPaste, DEFAULT_CONFIG.autoPaste),
    historyEnabled: booleanOr(input.historyEnabled, DEFAULT_CONFIG.historyEnabled),
    cleanupEnabled: booleanOr(input.cleanupEnabled, DEFAULT_CONFIG.cleanupEnabled),
    openAtLogin: booleanOr(input.openAtLogin, DEFAULT_CONFIG.openAtLogin),
    transcriptionModel: modelOr(input.transcriptionModel, DEFAULT_CONFIG.transcriptionModel),
    cleanupModel: modelOr(input.cleanupModel, DEFAULT_CONFIG.cleanupModel),
    // An empty fallback is a legitimate choice, so it is not replaced by the
    // default the way an invalid one is.
    cleanupFallbackModel: optionalModelOr(input.cleanupFallbackModel, DEFAULT_CONFIG.cleanupFallbackModel),
    transcriptionLanguage: languageOr(input.transcriptionLanguage),
    outputLanguage: languageOr(input.outputLanguage),
    customVocabulary: normalizeVocabulary(input.customVocabulary),
    contextCaptureEnabled: booleanOr(input.contextCaptureEnabled, DEFAULT_CONFIG.contextCaptureEnabled),
    contextScreenshotEnabled: booleanOr(input.contextScreenshotEnabled, DEFAULT_CONFIG.contextScreenshotEnabled),
    contextModel: modelOr(input.contextModel, DEFAULT_CONFIG.contextModel),
    // An empty blocklist is a real choice, but a MISSING one is not the same
    // thing: an older config that predates this setting must get the defaults,
    // not silently end up with no protection at all.
    contextBlocklist:
      typeof input.contextBlocklist === "string"
        ? serializeBlocklist(parseBlocklist(input.contextBlocklist))
        : DEFAULT_CONFIG.contextBlocklist,
    // Device ids are opaque browser strings, so the only sane validation is a
    // length cap; a stale id is handled at record time, not here.
    microphoneId: typeof input.microphoneId === "string" ? input.microphoneId.trim().slice(0, 200) : "",
    preserveExactWording: booleanOr(input.preserveExactWording, DEFAULT_CONFIG.preserveExactWording),
    instructionGuardEnabled: booleanOr(input.instructionGuardEnabled, DEFAULT_CONFIG.instructionGuardEnabled),
    debugCaptureEnabled: booleanOr(input.debugCaptureEnabled, DEFAULT_CONFIG.debugCaptureEnabled),
  };
}

/**
 * Splits the stored vocabulary blob into clean terms. One place, so the Settings
 * field, the transcription prompt, and the cleanup prompt can never disagree
 * about what counts as a term.
 */
export function parseVocabularyTerms(vocabulary: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];

  for (const line of vocabulary.split(/[\r\n]+/)) {
    const term = line.trim();
    if (!term || term.length > MAX_VOCABULARY_TERM_CHARS) {
      continue;
    }

    // Case-insensitive de-dupe, but the first spelling wins — the user typed
    // "GitHub" deliberately and we must not fold it into a later "github".
    const key = term.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    terms.push(term);
    if (terms.length >= MAX_VOCABULARY_TERMS) {
      break;
    }
  }

  return terms;
}

function normalizeVocabulary(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }

  return parseVocabularyTerms(value.slice(0, MAX_VOCABULARY_CHARS)).join("\n");
}

function languageOr(value: unknown): string {
  const language = typeof value === "string" ? value.trim() : "";
  // Empty is the meaningful default (auto-detect / no translation), so an
  // unrecognised tag falls back to empty rather than to a guess.
  return LANGUAGE_TAG_PATTERN.test(language) ? language : "";
}

function optionalModelOr(value: unknown, fallback: string): string {
  if (typeof value === "string" && !value.trim()) {
    return "";
  }

  return modelOr(value, fallback);
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
